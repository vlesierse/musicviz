import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { batTexture, dotTexture } from '../core/shapes';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const BATS = 70;
const SOULS = 1800;
const NEAR = 4;
const FAR = -80;

/** 1. An endless twisting tunnel; bats and green souls fly past. */
export class WormholeVisual extends Visual {
  readonly name = 'Wormhole of Souls';
  private spectrum = new SpectrumTexture(64);
  private uniforms!: Record<string, THREE.IUniform>;
  private bats!: THREE.InstancedMesh;
  private batState: { x: number; y: number; z: number; phase: number; speed: number; spin: number }[] = [];
  private souls!: THREE.Points;
  private travel = 0;
  private speed = 0.5;
  private twist = 0;
  private dummy = new THREE.Object3D();

  protected setup() {
    this.uniforms = {
      time: { value: 0 },
      travel: { value: 0 },
      twist: { value: 0 },
      bass: { value: 0 },
      beat: { value: 0 },
      aspect: { value: 1 },
      tSpectrum: { value: this.spectrum.texture },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, travel, twist, bass, beat, aspect;
        uniform sampler2D tSpectrum;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          p += 0.06 * vec2(sin(time * 0.37), cos(time * 0.29));
          float r = length(p);
          float a = atan(p.y, p.x);
          float depth = 0.32 / max(r, 0.002);
          float u = a / 6.2831853 + 0.5;
          float v = depth + travel;
          float swirl = u + twist * depth * 0.08 + time * 0.02;
          float ang = swirl * 6.2831853;
          float n = fbm(vec3(cos(ang) * 1.6, sin(ang) * 1.6, v * 0.5));
          float ring = pow(1.0 - abs(fract(v * 1.2) - 0.5) * 2.0, 28.0) * smoothstep(0.05, 0.25, r);
          float arms = pow(0.5 + 0.5 * sin(ang * 5.0 + v * 2.5), 8.0);
          float spec = texture2D(tSpectrum, vec2(abs(u * 2.0 - 1.0) * 0.85 + 0.02, 0.5)).r;
          vec3 col = mix(${glslColor(PALETTE.violet)}, ${glslColor(PALETTE.pumpkin)}, smoothstep(-0.2, 0.7, n));
          col *= 0.08 + 0.5 * pow(n * 0.5 + 0.5, 2.0);
          col += ring * mix(${glslColor(PALETTE.pumpkin)}, ${glslColor(PALETTE.toxic)}, spec) * (0.4 + spec * 3.0 + beat * 1.5);
          col += arms * ${glslColor(PALETTE.purple)} * (0.25 + bass * 1.2);
          col *= smoothstep(0.02, 0.5, r) * smoothstep(1.4, 0.3, r * 0.8 + 0.2);
          float core = 0.0025 / (r * r + 0.003);
          col += ${glslColor(PALETTE.candle)} * core * (0.3 + bass * 1.2 + beat * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.uniforms,
      ),
    );

    // Bats: dark silhouettes flying out of the tunnel.
    const batMat = new THREE.MeshBasicMaterial({
      map: batTexture(),
      color: 0x0a0208,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.bats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), batMat, BATS);
    this.bats.frustumCulled = false;
    for (let i = 0; i < BATS; i++) this.batState.push(this.spawnBat(THREE.MathUtils.lerp(FAR, NEAR, Math.random())));
    this.scene.add(this.bats);

    // Souls: glowing streaks.
    const pos = new Float32Array(SOULS * 3);
    for (let i = 0; i < SOULS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 7;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = THREE.MathUtils.lerp(FAR, NEAR, Math.random());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.souls = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.18,
        map: dotTexture(),
        color: PALETTE.toxic.clone().multiplyScalar(1.6),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.souls.frustumCulled = false;
    this.scene.add(this.souls);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 75;
    cam.position.set(0, 0, 5);
  }

  private spawnBat(z = FAR) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 3.5;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z,
      phase: Math.random() * Math.PI * 2,
      speed: 0.7 + Math.random() * 0.6,
      spin: (Math.random() - 0.5) * 0.6,
    };
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.uniforms) this.uniforms.aspect.value = w / h;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.speed = damp(this.speed, 0.35 + audio.bass * 1.6 + audio.beatPulse * 0.9 + audio.dropPulse * 2, 4, dt);
    this.twist = damp(this.twist, audio.mid * 6 - 1.5, 1.5, dt);
    this.travel += this.speed * dt;
    this.spectrum.update(audio.bands);
    const u = this.uniforms;
    u.time.value = time;
    u.travel.value = this.travel;
    u.twist.value = this.twist;
    u.bass.value = audio.bass;
    u.beat.value = audio.beatPulse;

    const worldSpeed = this.speed * 22;
    for (let i = 0; i < BATS; i++) {
      const b = this.batState[i];
      b.z += worldSpeed * b.speed * dt;
      b.phase += dt * (14 + audio.level * 10);
      if (b.z > NEAR) this.batState[i] = this.spawnBat();
      const flap = 0.7 + 0.3 * Math.sin(b.phase);
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(0, 0, b.spin + Math.sin(b.phase * 0.3) * 0.2);
      this.dummy.scale.set(1.4, 1.4 * flap, 1);
      this.dummy.updateMatrix();
      this.bats.setMatrixAt(i, this.dummy.matrix);
    }
    this.bats.instanceMatrix.needsUpdate = true;

    const pos = this.souls.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < SOULS; i++) {
      arr[i * 3 + 2] += worldSpeed * 1.4 * dt;
      if (arr[i * 3 + 2] > NEAR) arr[i * 3 + 2] = FAR;
    }
    pos.needsUpdate = true;
    (this.souls.material as THREE.PointsMaterial).size = 0.12 + audio.treble * 0.25;

    this.camera.rotation.z += dt * (0.05 + audio.mid * 0.3);
  }
}
