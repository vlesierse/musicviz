import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { SHAPES, dotTexture, drawText, sampleShape } from '../core/shapes';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const COUNT = 70000;
// Base colour per shape (keeps each shape recognisable); the skull is a dimmer lilac bone so it doesn't blow out.
const SHAPE_COLORS = [PALETTE.pumpkin, new THREE.Color(0xc8b8f0).multiplyScalar(0.62), PALETTE.purple, PALETTE.toxic];
/** Accent colours marbled through the shape; cycled every 32 beats and on drops. */
const ACCENTS = [
  new THREE.Color(0xff2f9a),
  new THREE.Color(0x30d8ff),
  PALETTE.toxic.clone(),
  new THREE.Color(0xd0001c),
  new THREE.Color(0xffc040),
  new THREE.Color(0x9b30ff),
];
const MORPH_TIME = 1.4;
const BEATS_PER_SHAPE = 16;
const MAX_SHAPE_TIME = 12;

/** 2. ~70k particles morphing between a jack-o'-lantern, skull, bat and "BOO!", exploding on beats. */
export class PumpkinMorphVisual extends Visual {
  readonly name = 'Pumpkin Particle Morph';
  private material!: THREE.ShaderMaterial;
  private bg!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private points!: THREE.Points;
  private glow!: THREE.Sprite;
  private from = 0;
  private to = 0;
  private morph = 1;
  private beatsOnShape = 0;
  private shapeTime = 0;
  private explode = 0;
  private spin = 0;
  private spectrum = new SpectrumTexture(64);
  private midAges = new THREE.Vector2(9, 9);
  private accent = 0;
  private accentFrom = 0;
  private accentMix = 1;
  private accentSpeed = 0.35;
  private beatsInAccent = 0;
  private accentCol = ACCENTS[0].clone();
  private tmp = new THREE.Color();

  protected setup() {
    const geo = new THREE.BufferGeometry();
    const scale = (arr: Float32Array, s: number) => {
      for (let i = 0; i < arr.length; i++) arr[i] *= s;
      return arr;
    };
    geo.setAttribute('position', new THREE.BufferAttribute(scale(sampleShape(SHAPES.pumpkin, COUNT, 0.12), 2.5), 3));
    geo.setAttribute('aSkull', new THREE.BufferAttribute(scale(sampleShape(SHAPES.skull, COUNT, 0.12), 2.5), 3));
    geo.setAttribute('aBat', new THREE.BufferAttribute(scale(sampleShape(SHAPES.bat, COUNT, 0.08), 2.9), 3));
    geo.setAttribute('aBoo', new THREE.BufferAttribute(scale(sampleShape(drawText('BOO!'), COUNT, 0.08), 3.0), 3));
    const rnd = new Float32Array(COUNT * 4);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    geo.setAttribute('aRandom', new THREE.BufferAttribute(rnd, 4));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        wFrom: { value: new THREE.Vector4(1, 0, 0, 0) },
        wTo: { value: new THREE.Vector4(1, 0, 0, 0) },
        morph: { value: 1 },
        explode: { value: 0 },
        bass: { value: 0 },
        treble: { value: 0 },
        beat: { value: 0 },
        pixelRatio: { value: 1 },
        colFrom: { value: SHAPE_COLORS[0].clone() },
        colTo: { value: SHAPE_COLORS[0].clone() },
        accent: { value: this.accentCol },
        accentAmt: { value: 0.35 },
        midAges: { value: this.midAges },
        glint: { value: 0 },
        glintSeed: { value: 0 },
        tSpectrum: { value: this.spectrum.texture },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSkull; attribute vec3 aBat; attribute vec3 aBoo; attribute vec4 aRandom;
        uniform float time, morph, explode, bass, treble, beat, pixelRatio, accentAmt, glint, glintSeed;
        uniform vec4 wFrom, wTo;
        uniform vec2 midAges;
        uniform vec3 colFrom, colTo, accent;
        uniform sampler2D tSpectrum;
        varying vec3 vColor;
        varying float vAlpha;
        ${GLSL_NOISE}
        vec3 pick(vec4 w) { return position * w.x + aSkull * w.y + aBat * w.z + aBoo * w.w; }
        float wave(float age, float d) {
          float R = 0.2 + age * 4.5;
          return exp(-pow((d - R) / 0.35, 2.0)) * exp(-age * 1.6) * step(age, 3.0);
        }
        void main() {
          float delay = aRandom.x * 0.35;
          float m = clamp((morph - delay) / 0.65, 0.0, 1.0);
          m = m * m * (3.0 - 2.0 * m);
          vec3 pos = mix(pick(wFrom), pick(wTo), m);
          float midMorph = sin(m * 3.14159);
          vec3 swirl = vec3(snoise(pos * 0.6 + time * 0.2), snoise(pos * 0.6 + 17.0 + time * 0.2), snoise(pos * 0.6 + 41.0));
          pos += swirl * (midMorph * 1.2 + 0.008 + treble * 0.03);
          vec3 dir = normalize(pos + (aRandom.yzw - 0.5) * 0.8);
          // each direction around the shape follows its own band: lows at the bottom, highs on top
          float ang = abs(atan(pos.x, -pos.y)) / 3.14159;
          float spec = texture2D(tSpectrum, vec2(0.02 + ang * 0.85, 0.5)).r;
          pos += dir * spec * spec * 0.18 * (0.4 + aRandom.y);
          // snare shockwaves rippling outward through the particles
          float d = length(pos.xy);
          float wv = wave(midAges.x, d) + wave(midAges.y, d);
          pos += dir * wv * 0.3;
          pos.z += wv * 0.25 * (aRandom.z - 0.5);
          pos += dir * explode * (0.4 + aRandom.y * 2.5);
          // hi-hat glints on a random handful of particles
          float gh = fract(sin(aRandom.x * 91.37 + glintSeed * 7.17) * 43758.5453);
          float g = step(0.986, gh) * glint;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = (0.9 + aRandom.z * 1.3) * (1.0 + bass * 0.4 + explode * 0.3 + g * 1.4);
          gl_PointSize = size * pixelRatio * (8.0 / -mv.z);
          vec3 col = mix(colFrom, colTo, m);
          float marble = smoothstep(0.05, 0.7, snoise(pos * 0.45 + vec3(0.0, time * 0.12, time * 0.05)));
          col = mix(col, accent, marble * accentAmt);
          col = mix(col, ${glslColor(PALETTE.candle)}, step(0.93, aRandom.w) * 0.8);
          vColor = col * (0.3 + beat * 0.35 + aRandom.y * 0.3 + spec * 0.15);
          vColor += accent * wv * 0.55;
          vColor += mix(accent, vec3(1.0, 0.95, 0.85), 0.6) * g * 1.6;
          vAlpha = 0.5 + 0.5 * aRandom.w;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(vColor * smoothstep(0.25, 0.0, d) * vAlpha, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Candle light inside the shape, visible through the carved holes.
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: dotTexture(), color: PALETTE.candle, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.glow.position.z = -0.6;
    this.points.add(this.glow);

    this.bg = fullscreenQuad(
      /* glsl */ `
      uniform float time, bass, mid, aspect;
      uniform vec3 accent;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        float r = length(p);
        float n = fbm(vec3(p * 2.0, time * 0.05));
        vec3 col = mix(${glslColor(PALETTE.violet)} * 0.3, ${glslColor(PALETTE.night)}, smoothstep(0.0, 0.8, r));
        col += ${glslColor(PALETTE.purple)} * 0.1 * (n * 0.5 + 0.5) * (0.6 + bass);
        float n2 = fbm(vec3(p * 3.0 + 9.0, time * 0.08));
        col += accent * 0.05 * smoothstep(0.0, 0.7, n2) * (0.4 + mid) * smoothstep(1.0, 0.2, r);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, bass: { value: 0 }, mid: { value: 0 }, aspect: { value: 1 }, accent: { value: this.accentCol } },
    );
    this.scene.add(this.bg);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 50;
    cam.position.set(0, 0, 6.5);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.bg) this.bg.material.uniforms.aspect.value = w / h;
  }

  private nextShape() {
    this.from = this.to;
    this.to = (this.to + 1) % SHAPE_COLORS.length;
    this.morph = 0;
    this.beatsOnShape = 0;
    this.shapeTime = 0;
    const u = this.material.uniforms;
    const oneHot = (i: number) => new THREE.Vector4(+(i === 0), +(i === 1), +(i === 2), +(i === 3));
    u.wFrom.value = oneHot(this.from);
    u.wTo.value = oneHot(this.to);
    u.colFrom.value = SHAPE_COLORS[this.from];
    u.colTo.value = SHAPE_COLORS[this.to];
  }

  private updateAccent(dt: number, audio: AudioFeatures) {
    if (audio.beat) this.beatsInAccent++;
    if (audio.drop || this.beatsInAccent >= 32) {
      this.accentFrom = this.accent;
      this.accent = (this.accent + 1 + (audio.drop ? Math.floor(Math.random() * 3) : 0)) % ACCENTS.length;
      this.accentMix = 0;
      this.accentSpeed = audio.drop ? 2.5 : 0.35;
      this.beatsInAccent = 0;
    }
    this.accentMix = Math.min(1, this.accentMix + dt * this.accentSpeed);
    const m = this.accentMix * this.accentMix * (3 - 2 * this.accentMix);
    this.accentCol.copy(ACCENTS[this.accentFrom]).lerp(ACCENTS[this.accent], m);
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.updateAccent(dt, audio);
    this.spectrum.update(audio.bands);
    if (audio.midHit) this.midAges.set(0, this.midAges.x);
    this.midAges.addScalar(dt);
    this.shapeTime += dt;
    if (audio.beat) {
      this.beatsOnShape++;
      this.explode = Math.min(this.explode + 0.15 + audio.bass * 0.25, 0.8);
    }
    if (this.morph >= 1 && (audio.drop || this.beatsOnShape >= BEATS_PER_SHAPE || this.shapeTime > MAX_SHAPE_TIME)) {
      this.nextShape();
    }
    this.morph = Math.min(1, this.morph + dt / MORPH_TIME);
    this.explode = damp(this.explode, 0, 7, dt);

    const u = this.material.uniforms;
    u.time.value = time;
    u.morph.value = this.morph;
    u.explode.value = this.explode + audio.dropPulse * audio.dropPulse * 2.0;
    u.bass.value = audio.bass;
    u.treble.value = audio.treble;
    u.beat.value = audio.beatPulse;
    // brighter music marbles more of the accent through the shape
    u.accentAmt.value = damp(u.accentAmt.value, 0.3 + audio.brightness * 0.35 + audio.dropPulse * 0.25, 3, dt);
    if (audio.trebleHit) {
      u.glint.value = 1;
      u.glintSeed.value = audio.trebleHitCount % 1000;
    }
    u.glint.value = damp(u.glint.value, 0, 5, dt);
    u.pixelRatio.value = this.renderer.getPixelRatio();
    this.bg.material.uniforms.time.value = time;
    this.bg.material.uniforms.bass.value = audio.bass;
    this.bg.material.uniforms.mid.value = damp(this.bg.material.uniforms.mid.value, audio.mid + audio.midPulse * 0.5, 6, dt);

    this.spin += dt * (0.25 + audio.mid * 0.6);
    this.points.rotation.y = Math.sin(this.spin) * 0.55;
    this.points.rotation.x = Math.sin(time * 0.3) * 0.08;
    this.points.scale.setScalar(1 + audio.bass * 0.08);
    const flicker = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3);
    this.glow.scale.setScalar(3.2 + audio.bass * 1.5);
    this.tmp.copy(SHAPE_COLORS[this.morph < 0.5 ? this.from : this.to]).lerp(PALETTE.candle, 0.5);
    this.glow.material.color.copy(this.tmp).lerp(this.accentCol, 0.25 + audio.midPulse * 0.5);
    this.glow.material.opacity = (0.35 + audio.bass * 0.5 + audio.beatPulse * 0.3 + audio.midPulse * 0.2) * flicker;
  }
}
