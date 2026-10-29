import { describe, expect, it } from 'vitest';
import { BAND_COUNT, FeatureExtractor } from './features';
import { SyntheticSignal } from './synthetic';

const FPS = 60;
const DT = 1 / FPS;

function run(seconds: number, signal: SyntheticSignal | null, start = 0) {
  const ex = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
  const freq = new Uint8Array(1024);
  const wave = new Float32Array(2048);
  const beats: number[] = [];
  const drops: number[] = [];
  let maxBand = 0;
  let minBand = 1;
  for (let i = 0; i < seconds * FPS; i++) {
    const t = start + i * DT;
    if (signal) signal.frame(t, freq, wave);
    const f = ex.process(freq, wave, DT);
    if (f.beat) beats.push(t);
    if (f.drop) drops.push(t);
    for (const b of f.bands) {
      maxBand = Math.max(maxBand, b);
      minBand = Math.min(minBand, b);
    }
  }
  return { ex, beats, drops, maxBand, minBand };
}

describe('FeatureExtractor', () => {
  it('creates log-spaced bands from low to high', () => {
    const ex = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    expect(ex.bandFrequency(0)).toBeGreaterThan(25);
    expect(ex.bandFrequency(BAND_COUNT - 1)).toBeGreaterThan(10000);
    for (let i = 1; i < BAND_COUNT; i++) expect(ex.bandFrequency(i)).toBeGreaterThan(ex.bandFrequency(i - 1));
  });

  it('detects beats at the tempo of the track', () => {
    const sig = new SyntheticSignal(1024, 48000, 120, [1000, 1001]);
    const { beats } = run(12, sig);
    const steady = beats.filter((t) => t > 2);
    // 10 seconds at 120 BPM = 20 beats.
    expect(steady.length).toBeGreaterThanOrEqual(18);
    expect(steady.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < steady.length; i++) {
      expect(steady[i] - steady[i - 1]).toBeCloseTo(0.5, 1);
    }
  });

  it('keeps band values normalized', () => {
    const { maxBand, minBand } = run(5, new SyntheticSignal());
    expect(maxBand).toBeLessThanOrEqual(1);
    expect(minBand).toBeGreaterThanOrEqual(0);
    expect(maxBand).toBeGreaterThan(0.5);
  });

  it('reports bass stronger than treble on a kick', () => {
    const ex = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    const sig = new SyntheticSignal(1024, 48000, 120, [1000, 1001]);
    const freq = new Uint8Array(1024);
    let bassOnKick = 0;
    for (let i = 0; i < 4 * FPS; i++) {
      const t = i * DT;
      sig.frame(t, freq);
      const f = ex.process(freq, null, DT);
      if (f.beat) bassOnKick = Math.max(bassOnKick, f.bass - f.treble);
    }
    expect(bassOnKick).toBeGreaterThan(0.2);
  });

  it('stays quiet on silence', () => {
    const { beats, drops, ex } = run(5, null);
    expect(beats).toHaveLength(0);
    expect(drops).toHaveLength(0);
    expect(ex.features.silent).toBe(true);
    expect(ex.features.level).toBe(0);
  });

  it('detects a drop when the track comes back after a breakdown', () => {
    const sig = new SyntheticSignal(1024, 48000, 124, [16, 24], 1000);
    const { drops } = run(30, sig);
    expect(drops.length).toBeGreaterThanOrEqual(1);
    const afterBreakdown = drops.filter((t) => t >= 24 && t < 27);
    expect(afterBreakdown.length).toBe(1);
    // No drop during the breakdown itself.
    expect(drops.filter((t) => t >= 16 && t < 24)).toHaveLength(0);
  });

  it('detects snare and hi-hat onsets separately from the kick', () => {
    const ex = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    const sig = new SyntheticSignal(1024, 48000, 120, [1000, 1001]);
    const freq = new Uint8Array(1024);
    let mids = 0, highs = 0, maxTreble = 0;
    for (let i = 0; i < 12 * FPS; i++) {
      const t = i * DT;
      sig.frame(t, freq);
      const f = ex.process(freq, null, DT);
      if (t < 2) continue;
      if (f.midHit) mids++;
      if (f.trebleHit) highs++;
      maxTreble = Math.max(maxTreble, f.treble);
    }
    // 10 s at 120 BPM: snares on every other beat (10), hats on every off-beat (20).
    expect(mids).toBeGreaterThanOrEqual(8);
    expect(mids).toBeLessThanOrEqual(24);
    expect(highs).toBeGreaterThanOrEqual(15);
    expect(highs).toBeLessThanOrEqual(30);
    // Highs use a meaningful part of their range instead of sitting near zero.
    expect(maxTreble).toBeGreaterThan(0.3);
  });

  it('keeps brightness within 0..1', () => {
    const ex = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    const sig = new SyntheticSignal();
    const freq = new Uint8Array(1024);
    let lo = 1, hi = 0;
    for (let i = 0; i < 40 * FPS; i++) {
      sig.frame(i * DT, freq);
      const f = ex.process(freq, null, DT);
      lo = Math.min(lo, f.brightness);
      hi = Math.max(hi, f.brightness);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.2);
  });
});
