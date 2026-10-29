import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { FULLSCREEN_VERT } from './glsl';

export interface VisualContext {
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
}

/** A single music-reactive scene. */
export abstract class Visual {
  abstract readonly name: string;
  /** Multiplier applied to the global bloom strength while this visual is shown. */
  bloom = 1;
  readonly scene = new THREE.Scene();
  camera: THREE.Camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  protected width = 1;
  protected height = 1;
  protected renderer!: THREE.WebGLRenderer;

  init(ctx: VisualContext) {
    this.renderer = ctx.renderer;
    this.setup();
    this.resize(ctx.width, ctx.height);
  }

  /** Build the scene. */
  protected abstract setup(): void;

  /** Called whenever this visual becomes visible. */
  onEnter(): void {}

  abstract update(dt: number, time: number, audio: AudioFeatures): void;

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat) => mat.dispose());
    });
  }
}

/** A fullscreen quad with a custom fragment shader (rendered behind everything else). */
export function fullscreenQuad(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/** Copies the given bands into a 1D float DataTexture (for spectrum-driven shaders). */
export class SpectrumTexture {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  constructor(readonly size = 64) {
    this.data = new Uint8Array(size * 4);
    this.texture = new THREE.DataTexture(this.data, size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }
  update(bands: Float32Array) {
    for (let i = 0; i < this.size; i++) {
      const v = Math.round(bands[Math.floor((i / this.size) * bands.length)] * 255);
      this.data[i * 4] = this.data[i * 4 + 1] = this.data[i * 4 + 2] = v;
      this.data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
