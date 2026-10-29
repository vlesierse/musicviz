/**
 * Deterministic fake "analyser" data with a kick drum, bass line, mids and hi-hats,
 * including a breakdown section. Used by unit tests and the dev-only ?debug mode
 * (never as a user-facing audio source).
 */
export class SyntheticSignal {
  constructor(
    readonly binCount = 1024,
    readonly sampleRate = 48000,
    readonly bpm = 124,
    /** Song structure: [startSec, endSec) where the track is in a quiet breakdown (looped every `loop` s). */
    readonly breakdown: [number, number] = [16, 24],
    readonly loop = 32,
  ) {}

  private section(t: number) {
    const lt = t % this.loop;
    return lt >= this.breakdown[0] && lt < this.breakdown[1] ? 'breakdown' : 'full';
  }

  frame(t: number, freq: Uint8Array, wave?: Float32Array) {
    const beat = (t * this.bpm) / 60;
    const phase = beat % 1;
    const full = this.section(t) === 'full';
    const kick = full ? Math.exp(-phase * 10) : 0;
    const hat = full ? Math.exp(-((phase + 0.5) % 1) * 18) : 0.15;
    // Snare / clap on beats 2 and 4.
    const snare = full && Math.floor(beat) % 2 === 1 ? Math.exp(-phase * 12) : 0;
    const intensity = full ? 1 : 0.35;
    const hzPerBin = this.sampleRate / (this.binCount * 2);
    for (let i = 0; i < this.binCount; i++) {
      const hz = i * hzPerBin;
      let v: number;
      if (hz < 150) v = 90 + 160 * kick + 40 * intensity;
      else if (hz < 2500) v = (95 + 35 * Math.sin(t * 2.3 + hz * 0.004)) * (0.6 + 0.4 * intensity) + (hz > 300 ? 70 * snare : 0);
      else v = (55 + 90 * hat) * Math.max(0, 1 - hz / 20000) + 10 + (hz < 6000 ? 40 * snare : 0);
      freq[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
    if (wave) {
      for (let i = 0; i < wave.length; i++) {
        const x = t + i / this.sampleRate;
        wave[i] =
          0.6 * kick * Math.sin(2 * Math.PI * 55 * x) +
          0.25 * intensity * Math.sin(2 * Math.PI * 220 * x + Math.sin(x * 3)) +
          0.1 * hat * Math.sin(2 * Math.PI * 4000 * x) +
          0.2 * snare * Math.sin(2 * Math.PI * 900 * x + 7 * Math.sin(x * 1700));
      }
    }
  }
}
