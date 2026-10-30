import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const EMBERS = 2000;

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
/** Portal palettes: [fire dark, fire mid, fire hot, fire white-hot, void arms, void highlight, core]. */
const GATES: THREE.Color[][] = [
  [C(0.35, 0.01, 0), C(1.1, 0.16, 0.01), C(1.9, 0.7, 0.08), C(2.6, 1.9, 0.8), C(0.07, 0.009, 0.2), C(0.25, 0.02, 0.76), C(0.9, 0.2, 1.2)], // hellfire
  [C(0.01, 0.12, 0), C(0.08, 0.5, 0.02), C(0.4, 1.1, 0.06), C(1.2, 1.9, 0.5), C(0.006, 0.07, 0.05), C(0.03, 0.32, 0.2), C(0.3, 0.85, 0.3)], // toxic
  [C(0, 0.07, 0.32), C(0.04, 0.4, 1.1), C(0.3, 1.0, 1.8), C(1.3, 2.0, 2.5), C(0.07, 0.02, 0.22), C(0.25, 0.1, 0.85), C(0.5, 0.9, 1.5)], // ghost fire
  [C(0.28, 0, 0.18), C(1.15, 0.06, 0.7), C(2.0, 0.45, 1.5), C(2.6, 1.6, 2.4), C(0.13, 0, 0.14), C(0.5, 0.04, 0.55), C(1.4, 0.3, 1.0)], // witch-fire
  [C(0.25, 0, 0), C(1.0, 0.02, 0.02), C(1.8, 0.14, 0.07), C(2.6, 1.0, 0.7), C(0.09, 0, 0.02), C(0.45, 0.02, 0.08), C(1.2, 0.15, 0.2)], // blood
];

/** 10. A ring of hellfire around a swirling void; embers are sucked in along spirals. */
export class PortalVisual extends Visual {
  readonly name = 'Portal to the Underworld';
  private spectrum = new SpectrumTexture(64);
  private uniforms!: Record<string, THREE.IUniform>;
  private emberUniforms!: Record<string, THREE.IUniform>;
  private radius = 0.55;
  private heat = 0;
  private spin = 0;
  private suck = 0;
  private swirlSpeed = 0.3;
  private shake = new THREE.Vector2();
  private gate = GATES[0].map((c) => c.clone());
  private gateIdx = 0;
  private gateFrom = 0;
  private gateMix = 1;
  private gateSpeed = 0.35;
  private lastGateBeat = 0;
  private wave = 9;
  private waveAmp = 0;
  private sparkle = 0;
  bloom = 0.75;

  protected setup() {
    this.uniforms = {
      time: { value: 0 },
      aspect: { value: 1 },
      radius: { value: 0.55 },
      heat: { value: 0 },
      spin: { value: 0 },
      suck: { value: 0 },
      flare: { value: 0 },
      beat: { value: 0 },
      shake: { value: this.shake },
      tSpectrum: { value: this.spectrum.texture },
      fA: { value: this.gate[0] },
      fB: { value: this.gate[1] },
      fC: { value: this.gate[2] },
      fD: { value: this.gate[3] },
      voidA: { value: this.gate[4] },
      voidB: { value: this.gate[5] },
      coreC: { value: this.gate[6] },
      wave: { value: 9 },
      waveAmp: { value: 0 },
      sparkle: { value: 0 },
      seed: { value: 0 },
      bright: { value: 0 },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect, radius, heat, spin, suck, flare, beat, wave, waveAmp, sparkle, seed, bright;
        uniform vec3 fA, fB, fC, fD, voidA, voidB, coreC;
        uniform vec2 shake;
        uniform sampler2D tSpectrum;
        varying vec2 vUv;
        ${GLSL_NOISE}
        float fbm3(vec3 p) {
          float f = 0.0, a = 0.5;
          for (int i = 0; i < 3; i++) { f += a * snoise(p); p *= 2.07; a *= 0.5; }
          return f;
        }
        vec3 fireRamp(float t) {
          vec3 c = mix(vec3(0.0), fA, smoothstep(0.0, 0.35, t));
          c = mix(c, fB, smoothstep(0.35, 0.65, t));
          c = mix(c, fC, smoothstep(0.65, 0.9, t));
          c = mix(c, fD, smoothstep(0.92, 1.1, t));
          return c;
        }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0 + shake;
          float r = length(p);
          float a = atan(p.y, p.x);
          float R = radius;
          float lr = log(max(r, 1e-3));
          vec3 col = vec3(0.0);

          // --- the void: log spiral arms drifting inward
          float inside = smoothstep(R + 0.02, R - 0.06, r);
          if (inside > 0.0) {
            float ang = a + lr * 2.6 + spin;
            float n = fbm3(vec3(cos(ang) * 1.3, sin(ang) * 1.3, lr * 1.6 + suck));
            float arms = pow(0.5 + 0.5 * sin(ang * 3.0 + n * 2.5), 3.0);
            float depth = smoothstep(0.0, R, r);
            vec3 v = ${glslColor(PALETTE.night)} * 2.0;
            v += voidA * (0.25 + 0.6 * arms) * (0.4 + 0.6 * (n * 0.5 + 0.5)) * depth;
            v += voidB * pow(arms, 3.0) * depth * depth * (0.35 + heat * 0.6);
            v *= 0.25 + 0.75 * depth;
            float core = 0.004 / (r * r + 0.004);
            v += coreC * core * (0.25 + beat * 0.6);
            // spectrum bars pointing inward from the rim
            float u = a / 6.2831853 + 0.5;
            float nb = 72.0;
            float idx = floor(u * nb);
            float m = 1.0 - abs(fract(idx * 2.0 / nb - 0.5) * 2.0 - 1.0);
            float s = sqrt(texture2D(tSpectrum, vec2(m * 0.78 + 0.02, 0.5)).r);
            float cell = fract(u * nb);
            float barW = smoothstep(0.12, 0.25, cell) * smoothstep(0.88, 0.75, cell);
            float inner = R - 0.04 - s * 0.36 * R;
            float bar = barW * smoothstep(inner - 0.01, inner + 0.01, r) * smoothstep(R - 0.02, R - 0.05, r);
            float tip = smoothstep(inner + 0.04, inner, r);
            v += bar * mix(voidB * 1.6, fC * 1.15, tip) * (0.25 + s * 1.1);
            col += v * inside;
          }

          // --- hellfire ring
          float d = (r - R) / R;
          float fa = a + spin * 0.25 + d * 1.4;
          vec2 cs = vec2(cos(fa), sin(fa));
          float n1 = fbm3(vec3(cs * 2.2, d * 2.6 - time * 1.6));
          float n2 = 1.0 - abs(snoise(vec3(cs * 9.0, d * 6.0 - time * 3.2)));
          // each angle's flame tongue reaches out with its own spectrum band (mirrored left/right)
          float fu = abs(fract((a + 1.5707963) / 6.2831853 + 0.5) * 2.0 - 1.0);
          float fs = texture2D(tSpectrum, vec2(fu * 0.78 + 0.02, 0.5)).r;
          float len = 0.08 + 0.36 * smoothstep(-0.4, 0.6, n1) * (0.6 + 0.4 * n2) + fs * fs * 0.32 + heat * 0.1 + flare * 0.45;
          float outer = clamp(1.0 - d / len, 0.0, 1.0);
          float t = d > 0.0 ? pow(outer, 1.6) * (0.55 + 0.45 * n2) : exp(d * 30.0) * 0.95;
          t *= 0.8 + heat * 0.3 + flare * 0.3 + beat * 0.12 + bright * 0.12;
          col += fireRamp(t);

          // snare: a shockwave ring blasts outward from the rim
          float wr = R * (1.0 + wave);
          float wd = (r - wr) / (0.02 + wave * 0.05);
          float ring = exp(-wd * wd) * waveAmp * exp(-wave * 1.3) * (0.75 + 0.25 * n2);
          col += mix(fC, fD, 0.4) * ring * 0.55 + fB * exp(-wd * wd * 0.15) * waveAmp * exp(-wave * 1.3) * 0.08;

          // hats: crackling sparks right on the rim
          float ca = floor((a + 3.1415927) * 26.0);
          float cr = step(0.86, hash11(ca * 1.37 + seed)) * sparkle;
          float cj = (hash11(ca + seed * 3.1) - 0.5) * 0.06;
          col += fD * cr * exp(-pow((r - R * (1.02 + cj)) * 70.0, 2.0)) * smoothstep(0.45, 0.0, abs(fract((a + 3.1415927) * 26.0) - 0.5)) * 1.4;

          // --- smoky surroundings with a hot glow
          if (d > 0.0) {
            float sm = fbm3(vec3(p * 1.4 + vec2(0.0, time * 0.05), time * 0.07));
            vec3 bg = ${glslColor(PALETTE.blood)} * (0.03 + 0.07 * (sm * 0.5 + 0.5));
            bg += mix(${glslColor(PALETTE.ember)}, fB, 0.4) * exp(-d * 4.0) * (0.03 + heat * 0.05 + flare * 0.15);
            col += bg * (1.0 - smoothstep(0.0, 0.05, t) * 0.5);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.uniforms,
      ),
    );

    // Embers: positions are fully computed on the GPU from a seed and an accumulated suck progress.
    const seeds = new Float32Array(EMBERS * 4);
    for (let i = 0; i < EMBERS; i++) {
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = 0.5 + Math.random() * 0.9;
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.emberUniforms = {
      suck: { value: 0 },
      spin: { value: 0 },
      aspect: { value: 1 },
      resY: { value: 1 },
      radius: { value: 0.55 },
      burst: { value: 0 },
      shake: { value: this.shake },
      fB: { value: this.gate[1] },
      fC: { value: this.gate[2] },
      coreC: { value: this.gate[6] },
      sparkle: { value: 0 },
      seed: { value: 0 },
    };
    const embers = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.emberUniforms,
        vertexShader: /* glsl */ `
          uniform float suck, spin, aspect, resY, radius, burst, sparkle, seed;
          uniform vec3 fB, fC, coreC;
          uniform vec2 shake;
          attribute vec4 aSeed;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float life = fract(aSeed.y * suck * 0.35 + aSeed.x * 7.13);
            float r0 = 1.7 + aSeed.z * 0.7;
            float r = r0 * pow(1.0 - life, 0.75);
            r *= 1.0 + burst * (0.15 + 0.45 * aSeed.w);
            float a = aSeed.x * 6.2831853 + 1.4 / (r + 0.3) + spin * 0.6;
            vec2 pos = vec2(cos(a), sin(a)) * r - shake;
            float fadeIn = smoothstep(0.0, 0.08, life);
            float swallow = smoothstep(radius * 0.15, radius * 0.9, r);
            vAlpha = fadeIn * (0.25 + 0.75 * swallow);
            vec3 hot = mix(fB * 2.2, fC * 1.35, aSeed.w * aSeed.w);
            // hats: a random subset of embers twinkles bright white-hot
            float tw = step(0.85, fract(sin(aSeed.x * 311.7 + seed) * 43758.5453)) * sparkle;
            vColor = mix(coreC * 1.5, hot, smoothstep(radius * 0.7, radius * 1.1, r)) * (1.0 + burst) + vec3(1.8, 1.6, 1.4) * tw;
            gl_PointSize = resY * (0.002 + aSeed.z * aSeed.z * 0.005) * (0.5 + 0.5 * smoothstep(0.0, radius, r)) * (1.0 + tw * 0.8);
            gl_Position = vec4(pos.x / aspect, pos.y, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float g = smoothstep(1.0, 0.0, d);
            gl_FragColor = vec4(vColor * g * g * vAlpha, 1.0);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    embers.frustumCulled = false;
    this.scene.add(embers);
  }

  onEnter() {
    this.gateMix = 1;
    this.applyGate(0, 0);
  }

  private nextGate(speed: number, jump = 1) {
    this.gateFrom = this.gateIdx;
    this.gateIdx = (this.gateIdx + jump) % GATES.length;
    this.gateMix = 0;
    this.gateSpeed = speed;
  }

  private applyGate(dt: number, brightness: number) {
    this.gateMix = Math.min(1, this.gateMix + dt * this.gateSpeed);
    const m = this.gateMix * this.gateMix * (3 - 2 * this.gateMix);
    const a = GATES[this.gateFrom];
    const b = GATES[this.gateIdx];
    for (let k = 0; k < 7; k++) this.gate[k].copy(a[k]).lerp(b[k], m);
    // brighter music pushes the flames toward their hotter hues
    this.gate[0].lerp(this.gate[1], brightness * 0.3);
    this.gate[1].lerp(this.gate[2], brightness * 0.25);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.uniforms) return;
    this.uniforms.aspect.value = w / h;
    this.emberUniforms.aspect.value = w / h;
    this.emberUniforms.resY.value = h;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.spectrum.update(audio.bands);
    const targetR = 0.58 + audio.bass * 0.12 + audio.beatPulse * 0.03 + audio.dropPulse * 0.22 + Math.sin(time * 0.7) * 0.015;
    this.radius = damp(this.radius, targetR, 6, dt);
    this.heat = damp(this.heat, audio.bass * 0.8 + audio.level * 0.4, 5, dt);
    this.swirlSpeed = damp(this.swirlSpeed, 0.25 + audio.mid * 1.6 + audio.dropPulse * 1.5, 3, dt);
    this.spin += this.swirlSpeed * dt;

    if (audio.drop) {
      this.nextGate(2.5, 1 + Math.floor(Math.random() * 2));
      this.lastGateBeat = audio.beatCount;
    } else if (audio.beat && audio.beatCount - this.lastGateBeat >= 32) {
      this.nextGate(0.35);
      this.lastGateBeat = audio.beatCount;
    }
    this.applyGate(dt, audio.brightness);

    // snare: shockwave out of the rim and a jolt to the swirl
    if (audio.midHit) {
      this.wave = 0;
      this.waveAmp = 0.7 + audio.mid * 0.6;
      this.swirlSpeed += 1.2 + audio.mid * 1.5;
    }
    this.wave += dt * (1.1 + this.wave * 1.2);
    this.waveAmp *= Math.exp(-3 * dt);
    if (audio.trebleHit) {
      this.sparkle = Math.min(1.3, this.sparkle + 0.6 + audio.treble * 0.6);
      this.uniforms.seed.value = this.emberUniforms.seed.value = Math.random() * 100;
    }
    this.sparkle = damp(this.sparkle, audio.treble * 0.2, 6, dt);
    this.suck += (0.35 + audio.level * 1.1 + audio.dropPulse) * dt;

    const shakeAmt = audio.beatPulse * 0.018 + audio.dropPulse * 0.02;
    this.shake.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);

    const u = this.uniforms;
    u.time.value = time;
    u.radius.value = this.radius;
    u.heat.value = this.heat;
    u.spin.value = this.spin;
    u.suck.value = this.suck * 0.5;
    u.flare.value = audio.dropPulse;
    u.beat.value = audio.beatPulse;
    u.wave.value = this.wave;
    u.waveAmp.value = this.waveAmp;
    u.sparkle.value = this.sparkle;
    u.bright.value = audio.brightness;

    const e = this.emberUniforms;
    e.suck.value = this.suck;
    e.spin.value = this.spin;
    e.radius.value = this.radius;
    e.burst.value = audio.beatPulse * 0.6 + audio.dropPulse * 0.8;
    e.sparkle.value = this.sparkle;
  }
}
