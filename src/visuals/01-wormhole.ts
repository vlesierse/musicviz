import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { batTexture, dotTexture } from '../core/shapes';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const BATS = 70;
const SOULS = 1800;
const NEAR = 4;
const FAR = -80;
const SPARKS_PER_HAT = 110;

/** Tunnel colour schemes: [deep, warm, ring, arms, soul]. Cycled every 32 beats and on drops. */
const SCHEMES: Array<[THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color]> = [
  [PALETTE.violet.clone(), PALETTE.pumpkin.clone(), PALETTE.toxic.clone(), PALETTE.purple.clone(), PALETTE.toxic.clone()],
  [new THREE.Color(0x5a0010), new THREE.Color(0xd0001c), new THREE.Color(0xff7a10), new THREE.Color(0xff2f9a), new THREE.Color(0xff5a20)],
  [new THREE.Color(0x002a40), new THREE.Color(0x00c0b0), new THREE.Color(0x30d8ff), new THREE.Color(0x3a5cff), new THREE.Color(0x7fe8ff)],
  [new THREE.Color(0x3a0050), new THREE.Color(0xff2fb0), new THREE.Color(0xffd040), new THREE.Color(0x9b30ff), new THREE.Color(0xff6ad5)],
  [new THREE.Color(0x0a2a00), new THREE.Color(0x39c010), new THREE.Color(0xd0ff40), new THREE.Color(0x8a2be2), new THREE.Color(0xb070ff)],
];

/** 1. An endless twisting tunnel; bats and souls fly past. */
export class WormholeVisual extends Visual {
  readonly name = 'Wormhole of Souls';
  private spectrum = new SpectrumTexture(64);
  private uniforms!: Record<string, THREE.IUniform>;
  private bats!: THREE.InstancedMesh;
  private batState: { x: number; y: number; z: number; phase: number; speed: number; spin: number }[] = [];
  private souls!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private soulBand = new Uint8Array(SOULS);
  private soulSeed = new Float32Array(SOULS);
  private soulSpark = new Float32Array(SOULS);
  private travel = 0;
  private speed = 0.5;
  private twist = 0;
  private batJolt = 0;
  private midRings = new THREE.Vector3(9, 9, 9);
  private dummy = new THREE.Object3D();
  // colour scheme crossfade
  private scheme = 0;
  private schemeFrom = 0;
  private schemeMix = 1;
  private schemeSpeed = 0.35;
  private beatsInScheme = 0;
  private cols = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private core = new THREE.Color();
  private tmp = new THREE.Color();

  protected setup() {
    this.updateScheme(0, null);
    this.uniforms = {
      time: { value: 0 },
      travel: { value: 0 },
      twist: { value: 0 },
      bass: { value: 0 },
      beat: { value: 0 },
      treble: { value: 0 },
      trebleHit: { value: 0 },
      midRings: { value: this.midRings },
      aspect: { value: 1 },
      tSpectrum: { value: this.spectrum.texture },
      colDeep: { value: this.cols[0] },
      colWarm: { value: this.cols[1] },
      colRing: { value: this.cols[2] },
      colArms: { value: this.cols[3] },
      colSoul: { value: this.cols[4] },
      colCore: { value: this.core },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, travel, twist, bass, beat, treble, trebleHit, aspect;
        uniform vec3 midRings;
        uniform vec3 colDeep, colWarm, colRing, colArms, colSoul, colCore;
        uniform sampler2D tSpectrum;
        varying vec2 vUv;
        ${GLSL_NOISE}
        float midRing(float age, float r, float a) {
          float rr = 0.035 * exp(age * 3.0) * (1.0 + 0.06 * sin(a * 7.0 + age * 9.0));
          float w = rr * 0.06 + 0.004;
          return exp(-pow((r - rr) / w, 2.0)) * exp(-age * 1.8) * step(age, 2.5);
        }
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
          vec3 col = mix(colDeep, colWarm, smoothstep(-0.2, 0.7, n));
          col *= 0.08 + 0.5 * pow(n * 0.5 + 0.5, 2.0);
          col += ring * mix(colWarm, colRing, spec) * (0.4 + spec * 3.0 + beat * 1.5);
          col += arms * colArms * (0.25 + bass * 1.2);
          // hi-hat glitter on the tunnel wall
          vec2 cell = vec2(floor(swirl * 90.0), floor(v * 10.0));
          float h = hash21(cell);
          vec2 f = fract(vec2(swirl * 90.0, v * 10.0)) - 0.5;
          float glint = step(0.93, h) * exp(-dot(f, f) * 30.0) * (0.15 + treble * 0.5 + trebleHit * 2.0 * step(0.97, fract(h * 37.0 + floor(time * 8.0) * 0.13)));
          col += glint * mix(colSoul, vec3(1.0), 0.3) * smoothstep(0.08, 0.3, r);
          col *= smoothstep(0.02, 0.5, r) * smoothstep(1.4, 0.3, r * 0.8 + 0.2);
          // snare shockwaves rushing out of the tunnel
          float mr = midRing(midRings.x, r, a) + midRing(midRings.y, r, a) + midRing(midRings.z, r, a);
          col += mr * mix(colArms, colSoul, 0.5) * 1.6;
          float core = 0.0025 / (r * r + 0.003);
          col += colCore * core * (0.3 + bass * 1.2 + beat * 0.6);
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

    // Souls: glowing streaks, each tied to the spectrum band of its angle around the tunnel.
    const pos = new Float32Array(SOULS * 3);
    for (let i = 0; i < SOULS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 7;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = THREE.MathUtils.lerp(FAR, NEAR, Math.random());
      const t = Math.abs(a / Math.PI - 1);
      this.soulBand[i] = Math.min(63, Math.floor((0.02 + t * 0.85) * 64));
      this.soulSeed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SOULS * 3), 3));
    this.souls = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.18,
        map: dotTexture(),
        vertexColors: true,
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

  private updateScheme(dt: number, audio: AudioFeatures | null) {
    if (audio) {
      if (audio.beat) this.beatsInScheme++;
      if (audio.drop || this.beatsInScheme >= 32) {
        this.schemeFrom = this.scheme;
        this.scheme = (this.scheme + 1 + (audio.drop ? Math.floor(Math.random() * 2) : 0)) % SCHEMES.length;
        this.schemeMix = 0;
        this.schemeSpeed = audio.drop ? 2.5 : 0.35;
        this.beatsInScheme = 0;
      }
    }
    this.schemeMix = Math.min(1, this.schemeMix + dt * this.schemeSpeed);
    const m = this.schemeMix * this.schemeMix * (3 - 2 * this.schemeMix);
    const from = SCHEMES[this.schemeFrom];
    const to = SCHEMES[this.scheme];
    for (let k = 0; k < 5; k++) this.cols[k].copy(from[k]).lerp(to[k], m);
    const bright = audio ? audio.brightness : 0.5;
    // brighter music warms the walls toward the ring colour and the arms toward the souls
    this.cols[1].lerp(this.cols[2], bright * 0.35);
    this.cols[3].lerp(this.cols[4], bright * 0.3);
    this.core.copy(PALETTE.candle).lerp(this.cols[1], 0.35);
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.updateScheme(dt, audio);
    if (audio.midHit) {
      this.midRings.set(0, this.midRings.x, this.midRings.y);
      this.batJolt = 1;
      this.twist += audio.midHitCount % 2 ? 1.2 : -1.2;
    }
    this.midRings.addScalar(dt);
    this.batJolt = damp(this.batJolt, 0, 4, dt);

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
    u.treble.value = audio.treble;
    u.trebleHit.value = damp(u.trebleHit.value, audio.treblePulse, 20, dt);

    const worldSpeed = this.speed * 22;
    for (let i = 0; i < BATS; i++) {
      const b = this.batState[i];
      b.z += worldSpeed * b.speed * dt;
      b.phase += dt * (14 + audio.level * 10 + audio.mid * 8);
      if (b.z > NEAR) this.batState[i] = this.spawnBat();
      const flap = 0.7 + 0.3 * Math.sin(b.phase);
      const jolt = this.batJolt * Math.sin(b.phase * 0.5 + i);
      this.dummy.position.set(b.x + jolt * 0.25, b.y + this.batJolt * 0.3, b.z);
      this.dummy.rotation.set(0, 0, b.spin + Math.sin(b.phase * 0.3) * 0.2 + jolt * 0.7);
      this.dummy.scale.set(1.4, 1.4 * flap, 1);
      this.dummy.updateMatrix();
      this.bats.setMatrixAt(i, this.dummy.matrix);
    }
    this.bats.instanceMatrix.needsUpdate = true;

    // Hi-hats light up a random handful of souls.
    if (audio.trebleHit) {
      for (let k = 0; k < SPARKS_PER_HAT; k++) this.soulSpark[Math.floor(Math.random() * SOULS)] = 1;
    }
    const sparkDecay = Math.exp(-4 * dt);
    const pos = this.souls.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const colAttr = this.souls.geometry.attributes.color as THREE.BufferAttribute;
    const col = colAttr.array as Float32Array;
    const soul = this.cols[4];
    const alt = this.cols[2];
    for (let i = 0; i < SOULS; i++) {
      arr[i * 3 + 2] += worldSpeed * 1.4 * dt;
      if (arr[i * 3 + 2] > NEAR) arr[i * 3 + 2] = FAR;
      const s = (this.soulSpark[i] *= sparkDecay);
      const band = audio.bands[this.soulBand[i]];
      const k = 0.55 + band * 1.3 + s * 2.2;
      const mixT = this.soulSeed[i] * 0.5 + s * 0.4;
      this.tmp.copy(soul).lerp(alt, mixT);
      col[i * 3] = this.tmp.r * k;
      col[i * 3 + 1] = this.tmp.g * k;
      col[i * 3 + 2] = this.tmp.b * k;
    }
    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.souls.material.size = 0.12 + audio.treble * 0.2 + audio.treblePulse * 0.06;

    this.camera.rotation.z += dt * (0.05 + audio.mid * 0.3);
  }
}
