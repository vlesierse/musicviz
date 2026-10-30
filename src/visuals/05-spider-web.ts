import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const HUB = new THREE.Vector2(0, 0.04);
const HANG_Y = -0.26;

const C = (hex: number) => new THREE.Color(hex);
/** Web colour schemes [low spokes, high spokes, kick ripple, snare pluck, dew, mist]; cycled every 32 beats and on drops. */
const SCHEMES: THREE.Color[][] = [
  [PALETTE.pumpkin.clone(), C(0xffd040), PALETTE.toxic.clone(), C(0xff2fb0), C(0xd8f0ff), C(0x5a2a90)],
  [C(0xff2fb0), C(0x9b30ff), C(0x30d8ff), C(0xffd040), C(0xffd0f0), C(0x7a1a70)],
  [C(0xd0001c), C(0xff7a10), C(0xffb347), C(0x9b30ff), C(0xffe0c0), C(0x701020)],
  [C(0x00e0c0), C(0x3a5cff), PALETTE.toxic.clone(), C(0xff7a10), C(0xc0fff0), C(0x104a60)],
  [PALETTE.toxic.clone(), C(0xd0ff40), C(0x9b30ff), C(0x30d8ff), C(0xe0ffd0), C(0x1a5020)],
];

function spiderTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const legs = () => {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const y0 = -8 + k * 5;
        ctx.beginPath();
        ctx.moveTo(side * 7, y0);
        ctx.lineTo(side * (28 + k * 2), y0 - 20 + k * 9);
        ctx.lineTo(side * (50 - k * 3), y0 + 4 + k * 10);
        ctx.stroke();
      }
    }
  };
  const body = () => {
    ctx.beginPath();
    ctx.ellipse(0, 16, 17, 21, 0, 0, Math.PI * 2);
    ctx.moveTo(11, -9);
    ctx.ellipse(0, -9, 11, 10, 0, 0, Math.PI * 2);
  };
  ctx.strokeStyle = 'rgba(200,180,240,0.55)';
  ctx.lineWidth = 6;
  legs();
  body();
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#140d1a';
  ctx.lineWidth = 3.5;
  legs();
  ctx.fillStyle = '#140d1a';
  body();
  ctx.fill();
  // red hourglass and eyes (the shader makes pure red glow)
  ctx.fillStyle = '#ff1010';
  ctx.beginPath();
  ctx.moveTo(-6, 8);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 16);
  ctx.lineTo(6, 24);
  ctx.lineTo(-6, 24);
  ctx.lineTo(0, 16);
  ctx.fill();
  for (const [x, y, r] of [[-4, -13, 2.4], [4, -13, 2.4], [-7.5, -9, 1.6], [7.5, -9, 1.6]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 5. A spider web whose spokes are the spectrum; chords vibrate, dew sparkles, a spider drops on drops. */
export class SpiderWebVisual extends Visual {
  readonly name = 'Spider-Web Spectrum';
  private quad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private spectrum = new SpectrumTexture(64);
  private kickAges = new THREE.Vector2(10, 10);
  private plucks = [new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, 10)];
  private pluckIdx = 0;
  private cols = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private scheme = 0;
  private schemeFrom = 0;
  private schemeMix = 1;
  private schemeSpeed = 0.35;
  private beatsInScheme = 0;
  private spiderY = HUB.y;
  private spiderV = 0;
  private hangUntil = -1;
  private lastDescent = -100;

  protected setup() {
    this.updateScheme(0, null);
    this.quad = fullscreenQuad(
      /* glsl */ `
      uniform sampler2D spectrum, spiderTex;
      uniform float time, aspect, px, bass, treble, beatPulse, dropPulse, rot, brightness, dewFlash, dewSeed, mid;
      uniform vec2 spiderPos, kickAges;
      uniform vec3 pluck0, pluck1;
      uniform vec3 colLow, colHigh, colRipple, colPluck, colDew, colMist;
      uniform float spiderSize, spiderRot;
      varying vec2 vUv;
      #define PI 3.14159265
      #define SPOKES 24.0
      #define RINGS 15
      ${GLSL_NOISE}

      float bandT(float i) { return abs(mod(i, SPOKES) / (SPOKES * 0.5) - 1.0); }
      float band(float i) {
        return texture2D(spectrum, vec2(mix(0.03, 0.9, bandT(i)), 0.5)).r;
      }
      float pluckRing(vec3 pl, vec2 q) {
        float R = 0.01 + pl.z * 0.45;
        float d = length(q - pl.xy);
        return exp(-pow((d - R) / (0.012 + pl.z * 0.03), 2.0)) * exp(-pl.z * 2.2) + exp(-d * 30.0) * exp(-pl.z * 5.0);
      }
      float sdSeg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }
      float thread(float d, float w) {
        return exp(-(d * d) / (w * w)) + 0.06 * exp(-d / (w * 5.0));
      }

      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);

        // Night sky, mist and a pale moon behind the web.
        vec3 col = mix(vec3(0.03, 0.012, 0.05), vec3(0.006, 0.003, 0.012), vUv.y);
        float mist = fbm(vec3(p * 2.0 + vec2(time * 0.02, 0.0), time * 0.04));
        col += colMist * 0.1 * (0.8 + mid * 0.6) * smoothstep(-0.2, 0.8, mist);
        vec2 mc = vec2(0.5 * aspect / 1.78, 0.24);
        float mr = length(p - mc);
        float craters = fbm(vec3((p - mc) * 9.0, 2.0)) * 0.5 + 0.5;
        float disc = smoothstep(0.15, 0.146, mr);
        col = mix(col, ${glslColor(PALETTE.moon)} * (0.22 + 0.3 * craters) * (1.0 + bass * 0.3), disc);
        col += ${glslColor(PALETTE.moon)} * exp(-max(mr - 0.15, 0.0) * 9.0) * 0.1 * (1.0 - disc);

        // Web in polar coordinates around the hub.
        float scale = 1.0 + bass * 0.04 + beatPulse * 0.015;
        vec2 q = (p - vec2(${HUB.x.toFixed(3)}, ${HUB.y.toFixed(3)})) / scale;
        float r = length(q);
        float sa = 2.0 * PI / SPOKES;
        float base = -PI * 0.5 + rot;
        float i0 = floor((atan(q.y, q.x) - base) / sa);
        float i1 = i0 + 1.0;
        float a0 = base + i0 * sa, a1 = a0 + sa;
        vec2 d0 = vec2(cos(a0), sin(a0)), d1 = vec2(cos(a1), sin(a1));
        float b0 = band(i0), b1 = band(i1);
        float w = px * 1.1;

        float web = 0.0;
        vec3 tint = vec3(0.0);
        // spokes (anchor threads continue off screen)
        for (int k = 0; k < 2; k++) {
          vec2 d = k == 0 ? d0 : d1;
          float b = k == 0 ? b0 : b1;
          float along = dot(q, d);
          float perp = abs(d.x * q.y - d.y * q.x + b * 0.005 * sin(along * 45.0 - time * 30.0));
          float s = thread(perp, w) * step(0.0, along) * (0.2 + b * 0.9) * (1.0 - smoothstep(0.8, 1.3, along));
          web += s;
          tint += s * b * mix(colLow, colHigh, bandT(k == 0 ? i0 : i1));
        }

        // sagging ring chords + dew drops at the joints
        float bj = 0.5 * (b0 + b1);
        float dew = 0.0;
        for (int j = 1; j <= RINGS; j++) {
          float fj = float(j);
          float rj = 0.07 + 0.36 * pow(fj / float(RINGS), 1.05);
          vec2 P0 = d0 * rj, P1 = d1 * rj;
          vec2 mid = 0.5 * (P0 + P1);
          float sag = 0.035 + 0.025 * sin(fj * 3.1 + mod(i0, SPOKES) * 1.7);
          float vib = bj * 0.012 * sin(time * (16.0 + fj * 2.0) + i0 * 2.3 + fj);
          // quadratic curve P0 -> C -> P1 whose midpoint sags toward the hub
          vec2 C = mid * (1.0 - 2.0 * sag) + normalize(mid) * vib * 2.0;
          vec2 Q1 = mix(mix(P0, C, 0.25), mix(C, P1, 0.25), 0.25);
          vec2 Q2 = mix(mix(P0, C, 0.5), mix(C, P1, 0.5), 0.5);
          vec2 Q3 = mix(mix(P0, C, 0.75), mix(C, P1, 0.75), 0.75);
          float torn = step(0.06, hash21(vec2(mod(i0, SPOKES), fj)));
          float d = min(min(sdSeg(q, P0, Q1), sdSeg(q, Q1, Q2)), min(sdSeg(q, Q2, Q3), sdSeg(q, Q3, P1)));
          float rip = exp(-abs(rj - kickAges.x * 0.7) * 25.0) * exp(-kickAges.x * 1.5)
                    + exp(-abs(rj - kickAges.y * 0.7) * 25.0) * exp(-kickAges.y * 1.5);
          float s = thread(d, w) * (0.14 + bj * 0.55 + rip * 2.0) * torn;
          web += s;
          tint += s * (rip * colRipple * 2.0 + bj * 0.5 * mix(colLow, colHigh, bandT(i0 + 0.5)));
          for (int k = 0; k < 2; k++) {
            vec2 P = k == 0 ? P0 : P1;
            float h = hash21(vec2(mod(k == 0 ? i0 : i1, SPOKES), fj + 31.0));
            if (h > 0.6) {
              float tw = 0.5 + 0.5 * sin(time * (4.0 + h * 6.0) + h * 60.0);
              // a different handful of dew drops flashes on every hi-hat
              float fl = dewFlash * step(0.55, fract(h * 97.0 + dewSeed * 0.618));
              dew += exp(-pow(length(q - P) / (px * (2.6 + fl * 1.5)), 2.0)) * (0.5 + tw * (0.6 + treble * 2.0) + fl * 3.0);
            }
          }
        }
        // hub
        web += thread(abs(r - 0.03), w) * 1.2 + thread(abs(r - 0.05), w) * 1.0;

        web *= 0.35 + 0.65 * smoothstep(0.0, 0.2, r);
        // thread colour temperature follows the music's brightness
        vec3 silver = mix(vec3(0.72, 0.74, 0.88), mix(colLow, colHigh, brightness) * 0.85, 0.22);
        float pl = pluckRing(pluck0, q) + pluckRing(pluck1, q);
        col += silver * web * 0.45 + tint * 1.0 + colDew * dew * 0.95;
        col += colPluck * web * pl * 2.2;
        col += ${glslColor(PALETTE.slime)} * web * dropPulse * 0.8;

        // spider + its silk thread
        if (spiderPos.y < ${HUB.y.toFixed(3)} - 0.02) {
          float sd = sdSeg(p, vec2(spiderPos.x * 0.3, ${HUB.y.toFixed(3)}), spiderPos + vec2(0.0, spiderSize * 0.15));
          col += silver * thread(sd, w) * 0.9;
        }
        vec2 sp = (p - spiderPos) / spiderSize;
        float cs = cos(spiderRot), sn = sin(spiderRot);
        sp = mat2(cs, -sn, sn, cs) * sp + 0.5;
        if (all(greaterThan(sp, vec2(0.0))) && all(lessThan(sp, vec2(1.0)))) {
          vec4 t = texture2D(spiderTex, vec2(sp.x, 1.0 - sp.y));
          col = mix(col, t.rgb, t.a);
          float eye = t.a * smoothstep(0.3, 0.8, t.r - t.g);
          col += vec3(3.0, 0.15, 0.05) * eye * (0.6 + beatPulse * 1.2);
        }

        col *= 1.0 - 0.45 * dot(p, p);
        gl_FragColor = vec4(col, 1.0);
      }`,
      {
        spectrum: { value: this.spectrum.texture },
        spiderTex: { value: spiderTexture() },
        time: { value: 0 },
        aspect: { value: 1 },
        px: { value: 0.001 },
        bass: { value: 0 },
        treble: { value: 0 },
        beatPulse: { value: 0 },
        dropPulse: { value: 0 },
        kickAges: { value: this.kickAges },
        pluck0: { value: this.plucks[0] },
        pluck1: { value: this.plucks[1] },
        brightness: { value: 0.5 },
        mid: { value: 0 },
        dewFlash: { value: 0 },
        dewSeed: { value: 0 },
        colLow: { value: this.cols[0] },
        colHigh: { value: this.cols[1] },
        colRipple: { value: this.cols[2] },
        colPluck: { value: this.cols[3] },
        colDew: { value: this.cols[4] },
        colMist: { value: this.cols[5] },
        rot: { value: 0 },
        spiderPos: { value: new THREE.Vector2(HUB.x, HUB.y) },
        spiderSize: { value: 0.15 },
        spiderRot: { value: 0 },
      },
    );
    this.scene.add(this.quad);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    this.quad.material.uniforms.aspect.value = w / h;
    this.quad.material.uniforms.px.value = 1 / h;
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
    for (let k = 0; k < 6; k++) this.cols[k].copy(SCHEMES[this.schemeFrom][k]).lerp(SCHEMES[this.scheme][k], m);
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.updateScheme(dt, audio);
    this.spectrum.update(audio.bands);
    // kicks send rings out from the hub; they overlap instead of restarting
    if (audio.beat) this.kickAges.set(0, this.kickAges.x);
    this.kickAges.addScalar(dt);
    // snares/claps pluck the web at a random spot, as if something got caught
    if (audio.midHit) {
      const p = this.plucks[this.pluckIdx];
      this.pluckIdx = 1 - this.pluckIdx;
      const a = Math.random() * Math.PI * 2;
      const r = 0.1 + Math.random() * 0.3;
      p.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    for (const p of this.plucks) p.z += dt;

    // The spider drops down on its thread on a drop (or every so often), then climbs back.
    if (audio.drop || (audio.beat && audio.beatCount % 64 === 32 && time - this.lastDescent > 20)) {
      this.hangUntil = time + 6;
      this.lastDescent = time;
    }
    const hanging = time < this.hangUntil;
    const target = hanging ? HANG_Y + Math.sin(time * 2) * 0.01 - audio.beatPulse * 0.02 : HUB.y;
    const k = hanging ? 40 : 3;
    const c = hanging ? 3 : 3.5;
    this.spiderV += ((target - this.spiderY) * k - this.spiderV * c) * dt;
    if (!hanging) this.spiderV = Math.min(this.spiderV, 0.12); // slow climb
    this.spiderY += this.spiderV * dt;

    const u = this.quad.material.uniforms;
    const away = Math.min(1, (HUB.y - this.spiderY) / 0.1);
    u.spiderPos.value.set(Math.sin(time * 1.3) * 0.012 * away, this.spiderY);
    u.spiderRot.value = Math.sin(time * 1.3) * 0.12 * away + Math.sin(time * 9) * audio.beatPulse * 0.05 + Math.sin(time * 37) * audio.midPulse * 0.08;
    u.time.value = time;
    u.bass.value = audio.bass;
    u.treble.value = audio.treble;
    u.beatPulse.value = audio.beatPulse;
    u.dropPulse.value = audio.dropPulse;
    u.brightness.value = audio.brightness;
    u.mid.value = damp(u.mid.value, audio.mid, 4, dt);
    if (audio.trebleHit) {
      u.dewFlash.value = 1;
      u.dewSeed.value = audio.trebleHitCount % 1000;
    }
    u.dewFlash.value = damp(u.dewFlash.value, 0, 6, dt);
    u.rot.value = damp(u.rot.value, Math.sin(time * 0.15) * 0.06, 2, dt);
  }
}
