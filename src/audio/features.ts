export const BAND_COUNT = 64;
const MIN_FREQ = 30;
const MAX_FREQ = 16000;

export interface AudioFeatures {
  /** Log-spaced, gain-normalized and smoothed bands (0..1). */
  bands: Float32Array;
  /** Time-domain waveform (-1..1). */
  waveform: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  /** Overall loudness (0..1). */
  level: number;
  /** True only on the frame a beat (onset in the low end) is detected. */
  beat: boolean;
  /** 1 on a beat, decays exponentially towards 0. */
  beatPulse: number;
  beatCount: number;
  /** True on the frame of an onset in the mids (snares, claps, vocals, synth stabs). */
  midHit: boolean;
  /** 1 on a mid onset, decays fast (exp(-9·dt)). */
  midPulse: number;
  midHitCount: number;
  /** True on the frame of an onset in the highs (hi-hats, cymbals, shakers). */
  trebleHit: boolean;
  /** 1 on a treble onset, decays very fast (exp(-12·dt)). */
  treblePulse: number;
  trebleHitCount: number;
  /**
   * Spectral "brightness" (0..1): where the energy sits, from dark/bassy (0) to bright/airy (1).
   * Auto-ranged against the track's recent spread, so it actually moves; good for colour.
   */
  brightness: number;
  /** True only on the frame a "drop" (big energy jump after a lull) is detected. */
  drop: boolean;
  /** 1 on a drop, decays slowly towards 0. */
  dropPulse: number;
  /** Short-term vs long-term energy; > 1 means the track is building/hitting. */
  energyRatio: number;
  silent: boolean;
  /** Seconds since the extractor started. */
  time: number;
}

export function createEmptyFeatures(waveformSize = 2048): AudioFeatures {
  return {
    bands: new Float32Array(BAND_COUNT),
    waveform: new Float32Array(waveformSize),
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    beat: false,
    beatPulse: 0,
    beatCount: 0,
    midHit: false,
    midPulse: 0,
    midHitCount: 0,
    trebleHit: false,
    treblePulse: 0,
    trebleHitCount: 0,
    brightness: 0.5,
    drop: false,
    dropPulse: 0,
    energyRatio: 1,
    silent: true,
    time: 0,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Exponential smoothing factor for a time constant `tau` (s) over `dt` (s). */
const ema = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

/** Spectral-flux onset detector with an adaptive (mean + k·std over the last second) threshold. */
class OnsetDetector {
  private history: Array<{ t: number; v: number }> = [];
  private last = -1;
  constructor(
    private readonly k: number,
    private readonly floor: number,
    private readonly minGap: number,
  ) {}

  detect(flux: number, t: number, gate: boolean): boolean {
    const h = this.history;
    h.push({ t, v: flux });
    while (h.length && t - h[0].t > 1.0) h.shift();
    let mean = 0;
    for (const e of h) mean += e.v;
    mean /= h.length;
    let variance = 0;
    for (const e of h) variance += (e.v - mean) * (e.v - mean);
    const std = Math.sqrt(variance / h.length);
    const hit = gate && flux > mean + Math.max(this.k * std, this.floor * 0.5) && flux > this.floor && t - this.last > this.minGap;
    if (hit) this.last = t;
    return hit;
  }
}

export interface ExtractorOptions {
  sampleRate: number;
  fftSize: number;
}

/**
 * Turns raw analyser data into musically useful features.
 * Pure (no Web Audio dependency) so it can be unit tested.
 */
export class FeatureExtractor {
  readonly features: AudioFeatures;
  private readonly bandRanges: Array<[number, number]> = [];
  private readonly bandFreqs: number[] = [];
  private readonly raw = new Float32Array(BAND_COUNT);
  private readonly prevRaw = new Float32Array(BAND_COUNT);
  private gainRef = 0.5;
  /** Per-band running peak, so quieter (usually higher) bands still use their full range. */
  private readonly bandRef = new Float32Array(BAND_COUNT).fill(0.3);
  private readonly beatDetector = new OnsetDetector(1.4, 0.025, 0.27);
  private readonly midDetector = new OnsetDetector(1.5, 0.02, 0.15);
  private readonly trebleDetector = new OnsetDetector(1.5, 0.02, 0.1);
  private centroidLo = 0.3;
  private centroidHi = 0.5;
  private centroid = 0.4;
  private lastDrop = -100;
  private shortEnergy = 0;
  private longEnergy = 0;
  private lastLull = -100;
  private quietSince = 0;

  constructor(opts: ExtractorOptions) {
    this.features = createEmptyFeatures(opts.fftSize);
    const binCount = opts.fftSize / 2;
    const hzPerBin = opts.sampleRate / opts.fftSize;
    let prevEnd = 1;
    for (let i = 0; i < BAND_COUNT; i++) {
      const f0 = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / BAND_COUNT);
      const f1 = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 1) / BAND_COUNT);
      let start = Math.max(prevEnd, Math.floor(f0 / hzPerBin));
      let end = Math.max(start + 1, Math.floor(f1 / hzPerBin));
      start = Math.min(start, binCount - 1);
      end = Math.min(end, binCount);
      if (end <= start) end = start + 1;
      this.bandRanges.push([start, end]);
      this.bandFreqs.push(Math.sqrt(f0 * f1));
      prevEnd = end;
    }
  }

  /** Centre frequency (Hz) of a band. */
  bandFrequency(i: number): number {
    return this.bandFreqs[i];
  }

  /**
   * @param freq byte frequency data (0..255, dB scaled) from AnalyserNode
   * @param wave float time-domain data (-1..1)
   * @param dt seconds since last call
   */
  process(freq: Uint8Array, wave: Float32Array | null, dt: number): AudioFeatures {
    const f = this.features;
    dt = Math.min(Math.max(dt, 1 / 240), 0.1);
    f.time += dt;
    const t = f.time;
    if (wave) f.waveform.set(wave.subarray(0, f.waveform.length));

    // 1. Raw band magnitudes (0..1, still dB scaled).
    let peak = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      const [s, e] = this.bandRanges[i];
      let sum = 0;
      for (let b = s; b < e; b++) sum += freq[b];
      const v = sum / ((e - s) * 255);
      this.raw[i] = v;
      if (v > peak) peak = v;
    }

    // 2. Automatic gain: follow the loudest band quickly, forget slowly.
    this.gainRef = Math.max(peak, this.gainRef + (0.25 - this.gainRef) * ema(dt, 12));
    this.gainRef = Math.max(this.gainRef, 0.2);
    const ref = this.gainRef;

    // 3. Normalized + smoothed bands, band groups and spectral flux per range.
    //    Each band is normalized against its own recent peak, but never against less than
    //    50% of the global reference, so the naturally quieter mids/highs get their full
    //    0..1 range without amplifying near-silent bands into noise.
    let bass = 0, mid = 0, treble = 0, nb = 0, nm = 0, nt = 0;
    let flux = 0, fluxN = 0, midFlux = 0, midN = 0, trebleFlux = 0, trebleN = 0;
    let cSum = 0, cW = 0;
    const attack = ema(dt, 0.02);
    const release = ema(dt, 0.18);
    const refDecay = ema(dt, 10);
    for (let i = 0; i < BAND_COUNT; i++) {
      const r = this.raw[i];
      this.bandRef[i] = Math.max(r, this.bandRef[i] + (0.15 - this.bandRef[i]) * refDecay);
      const bref = Math.max(this.bandRef[i], ref * 0.5, 0.12);
      const n = clamp01((r - bref * 0.35) / (bref * 0.65));
      const cur = f.bands[i];
      f.bands[i] = cur + (n - cur) * (n > cur ? attack : release);
      const hz = this.bandFreqs[i];
      if (hz < 160) { bass += n; nb++; }
      else if (hz < 2500) { mid += n; nm++; }
      else { treble += n; nt++; }
      cSum += n * n * i;
      cW += n * n;
      const d = Math.max(0, r - this.prevRaw[i]) / bref;
      if (hz < 200) { flux += r - this.prevRaw[i] > 0 ? r - this.prevRaw[i] : 0; fluxN++; }
      else if (hz < 2500) { midFlux += d; midN++; }
      else { trebleFlux += d; trebleN++; }
      this.prevRaw[i] = r;
    }
    bass /= nb || 1; mid /= nm || 1; treble /= nt || 1;
    flux /= fluxN || 1;
    midFlux /= midN || 1;
    trebleFlux /= trebleN || 1;
    const level = clamp01(bass * 0.45 + mid * 0.4 + treble * 0.15);

    const smooth = (cur: number, v: number) => cur + (v - cur) * (v > cur ? ema(dt, 0.03) : ema(dt, 0.2));
    f.bass = smooth(f.bass, bass);
    f.mid = smooth(f.mid, mid);
    f.treble = smooth(f.treble, treble);
    f.level = smooth(f.level, level);

    // 4. Onsets: kick (low end), snare/vocal (mids) and hats (highs).
    f.beat = this.beatDetector.detect(flux, t, bass > 0.12);
    if (f.beat) {
      f.beatCount++;
      f.beatPulse = 1;
    } else {
      f.beatPulse *= Math.exp(-dt * 7);
    }
    f.midHit = this.midDetector.detect(midFlux, t, mid > 0.1);
    if (f.midHit) {
      f.midHitCount++;
      f.midPulse = 1;
    } else {
      f.midPulse *= Math.exp(-dt * 9);
    }
    f.trebleHit = this.trebleDetector.detect(trebleFlux, t, treble > 0.08);
    if (f.trebleHit) {
      f.trebleHitCount++;
      f.treblePulse = 1;
    } else {
      f.treblePulse *= Math.exp(-dt * 12);
    }

    // Brightness: energy-weighted band centroid, auto-ranged to the track's recent min/max.
    if (cW > 0.05) {
      const c = cSum / cW / (BAND_COUNT - 1);
      this.centroid += (c - this.centroid) * ema(dt, 0.25);
      const spread = ema(dt, 6);
      this.centroidLo = Math.min(this.centroid, this.centroidLo + (this.centroid - this.centroidLo) * spread);
      this.centroidHi = Math.max(this.centroid, this.centroidHi + (this.centroid - this.centroidHi) * spread);
    }
    const span = Math.max(this.centroidHi - this.centroidLo, 0.08);
    const mid0 = (this.centroidHi + this.centroidLo) / 2;
    const bright = clamp01(0.5 + (this.centroid - mid0) / span);
    f.brightness += (bright - f.brightness) * ema(dt, 0.3);

    // 5. Drop detection: a beat while short-term energy jumps well above the long-term
    //    average shortly after a lull (breakdown / build-up).
    this.shortEnergy += (level - this.shortEnergy) * ema(dt, 0.35);
    this.longEnergy += (level - this.longEnergy) * ema(dt, 8);
    if (this.shortEnergy < this.longEnergy * 0.75) this.lastLull = t;
    f.energyRatio = this.longEnergy > 0.01 ? this.shortEnergy / this.longEnergy : 1;
    f.drop =
      f.beat &&
      this.longEnergy > 0.05 &&
      f.energyRatio > 1.2 &&
      t - this.lastLull < 10 &&
      t - this.lastDrop > 8;
    if (f.drop) {
      this.lastDrop = t;
      f.dropPulse = 1;
    } else {
      f.dropPulse *= Math.exp(-dt * 1.5);
    }

    // 6. Silence.
    if (peak > 0.08) this.quietSince = t;
    f.silent = t - this.quietSince > 1.5;

    return f;
  }
}
