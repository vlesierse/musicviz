import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import type { Visual } from './Visual';

export interface ManagerOptions {
  /** Earliest moment (s) an automatic switch may happen (waits for a drop / strong beat). */
  minDuration: number;
  /** Latest moment (s) a switch is forced. Randomized per visual between min..max of this range. */
  maxDuration: [number, number];
  fadeDuration: number;
}

const DEFAULTS: ManagerOptions = { minDuration: 60, maxDuration: [90, 120], fadeDuration: 2.5 };

/** Owns all visuals, decides when to switch, and drives the crossfade. */
export class VisualManager {
  current = 0;
  next = -1;
  fade = 0;
  auto = true;
  elapsed = 0;
  onChange?: (index: number, visual: Visual) => void;
  private readonly opts: ManagerOptions;
  private maxForCurrent: number;
  private readonly history: number[] = [];

  constructor(readonly visuals: Visual[], opts: Partial<ManagerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.maxForCurrent = this.randomMax();
  }

  get isFading() {
    return this.next >= 0;
  }

  get active() {
    return this.visuals[this.isFading && this.fade > 0.5 ? this.next : this.current];
  }

  get bloom() {
    const a = this.visuals[this.current].bloom;
    return this.isFading ? a + (this.visuals[this.next].bloom - a) * this.fade : a;
  }

  init(renderer: THREE.WebGLRenderer, width: number, height: number) {
    for (const v of this.visuals) {
      v.init({ renderer, width, height });
      // Pre-compile shaders so switching never stutters mid-party.
      renderer.compile(v.scene, v.camera);
    }
    this.visuals[this.current].onEnter();
  }

  resize(width: number, height: number) {
    for (const v of this.visuals) v.resize(width, height);
  }

  goTo(index: number) {
    index = ((index % this.visuals.length) + this.visuals.length) % this.visuals.length;
    if (this.isFading) {
      // Finish the running transition instantly before starting a new one.
      this.current = this.next;
      this.next = -1;
    }
    if (index === this.current) return;
    this.next = index;
    this.fade = 0;
    this.visuals[index].onEnter();
    this.onChange?.(index, this.visuals[index]);
  }

  step(delta: number) {
    this.goTo((this.isFading ? this.next : this.current) + delta);
  }

  /** Picks a random visual not shown recently. */
  pickNext(): number {
    const n = this.visuals.length;
    const avoid = new Set([this.current, ...this.history.slice(-Math.min(4, n - 2))]);
    const options = [...Array(n).keys()].filter((i) => !avoid.has(i));
    const pool = options.length ? options : [...Array(n).keys()].filter((i) => i !== this.current);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.elapsed += dt;
    if (this.auto && !this.isFading) {
      const { minDuration } = this.opts;
      const onDrop = this.elapsed >= minDuration && audio.drop;
      const onStrongBeat = this.elapsed >= minDuration + 10 && audio.beat && audio.bass > 0.55;
      const forced = this.elapsed >= this.maxForCurrent;
      if (onDrop || onStrongBeat || forced) this.goTo(this.pickNext());
    }

    this.visuals[this.current].update(dt, time, audio);
    if (this.isFading) {
      this.visuals[this.next].update(dt, time, audio);
      this.fade += dt / this.opts.fadeDuration;
      if (this.fade >= 1) {
        this.history.push(this.current);
        if (this.history.length > 10) this.history.shift();
        this.current = this.next;
        this.next = -1;
        this.fade = 0;
        this.elapsed = 0;
        this.maxForCurrent = this.randomMax();
      }
    }
  }

  private randomMax() {
    const [a, b] = this.opts.maxDuration;
    return a + Math.random() * (b - a);
  }
}
