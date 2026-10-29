import { FeatureExtractor, type AudioFeatures } from './features';
import { SyntheticSignal } from './synthetic';

export class NoAudioTrackError extends Error {
  constructor() {
    super('No audio was shared. Tick "Also share system audio" (or "Share tab audio") in the Chrome sharing dialog.');
    this.name = 'NoAudioTrackError';
  }
}

export class UnsupportedError extends Error {
  constructor() {
    super('This browser cannot capture system audio. Use Google Chrome 141+ on macOS 14.2+ (or Chrome/Edge on Windows).');
    this.name = 'UnsupportedError';
  }
}

export interface AudioSource {
  readonly features: AudioFeatures;
  update(dt: number): AudioFeatures;
  stop(): void;
  onEnded?: () => void;
}

/**
 * Captures the laptop's system audio (not the microphone) through the screen-capture API.
 * Chrome requires a video surface to be picked; we keep that track at 1 fps and never use it.
 */
export class SystemAudioSource implements AudioSource {
  onEnded?: () => void;
  private ctx!: AudioContext;
  private analyser!: AnalyserNode;
  private stream!: MediaStream;
  private extractor!: FeatureExtractor;
  private freq!: Uint8Array<ArrayBuffer>;
  private wave!: Float32Array<ArrayBuffer>;

  static isSupported() {
    return !!navigator.mediaDevices?.getDisplayMedia && typeof AudioContext !== 'undefined';
  }

  get features() {
    return this.extractor.features;
  }

  async start() {
    if (!SystemAudioSource.isSupported()) throw new UnsupportedError();
    const options = {
      video: { frameRate: 1, width: 320, height: 180 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false,
      },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    } as DisplayMediaStreamOptions;
    this.stream = await navigator.mediaDevices.getDisplayMedia(options);

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.stream.getTracks().forEach((t) => t.stop());
      throw new NoAudioTrackError();
    }
    // Keep the video track alive (stopping it can end the whole capture) but idle.
    this.stream.getVideoTracks().forEach((t) => (t.enabled = false));

    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(new MediaStream(audioTracks));
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -15;
    // Intentionally NOT connected to ctx.destination: no echo / double playback.
    src.connect(this.analyser);

    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.analyser.fftSize);
    this.extractor = new FeatureExtractor({ sampleRate: this.ctx.sampleRate, fftSize: this.analyser.fftSize });

    const ended = () => {
      this.stop();
      this.onEnded?.();
    };
    this.stream.getTracks().forEach((t) => t.addEventListener('ended', ended, { once: true }));
  }

  update(dt: number) {
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.wave);
    return this.extractor.process(this.freq, this.wave, dt);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
  }
}

/** Dev-only fake source for screenshots / development without music. */
export class SyntheticSource implements AudioSource {
  private readonly signal = new SyntheticSignal();
  private readonly extractor = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
  private readonly freq = new Uint8Array(1024);
  private readonly wave = new Float32Array(2048);
  private t = 0;

  get features() {
    return this.extractor.features;
  }

  update(dt: number) {
    this.t += dt;
    this.signal.frame(this.t, this.freq, this.wave);
    return this.extractor.process(this.freq, this.wave, dt);
  }

  stop() {}
}
