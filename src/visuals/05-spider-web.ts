import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const HUB = new THREE.Vector2(0, 0.04);
const HANG_Y = -0.26;

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
  private rippleT = 10;
  private spiderY = HUB.y;
  private spiderV = 0;
  private hangUntil = -1;
  private lastDescent = -100;

  protected setup() {
    this.quad = fullscreenQuad(
      /* glsl */ `
      uniform sampler2D spectrum, spiderTex;
      uniform float time, aspect, px, bass, treble, beatPulse, dropPulse, ripple, rot;
      uniform vec2 spiderPos;
      uniform float spiderSize, spiderRot;
      varying vec2 vUv;
      #define PI 3.14159265
      #define SPOKES 24.0
      #define RINGS 15
      ${GLSL_NOISE}

      float band(float i) {
        float t = abs(mod(i, SPOKES) / (SPOKES * 0.5) - 1.0);
        return texture2D(spectrum, vec2(mix(0.03, 0.9, t), 0.5)).r;
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
        col += vec3(0.05, 0.03, 0.08) * smoothstep(-0.2, 0.8, mist);
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
          float s = thread(perp, w) * step(0.0, along) * (0.22 + b * 1.5) * (1.0 - smoothstep(0.8, 1.3, along));
          web += s;
          tint += s * b * ${glslColor(PALETTE.pumpkin)};
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
          float rip = exp(-abs(rj - ripple * 0.7) * 25.0) * exp(-ripple * 1.5);
          float s = thread(d, w) * (0.16 + bj * 0.9 + rip * 2.0) * torn;
          web += s;
          tint += s * rip * ${glslColor(PALETTE.toxic)} * 2.0;
          for (int k = 0; k < 2; k++) {
            vec2 P = k == 0 ? P0 : P1;
            float h = hash21(vec2(mod(k == 0 ? i0 : i1, SPOKES), fj + 31.0));
            if (h > 0.6) {
              float tw = 0.5 + 0.5 * sin(time * (4.0 + h * 6.0) + h * 60.0);
              dew += exp(-pow(length(q - P) / (px * 2.6), 2.0)) * (0.5 + tw * (0.6 + treble * 2.0));
            }
          }
        }
        // hub
        web += thread(abs(r - 0.03), w) * 1.2 + thread(abs(r - 0.05), w) * 1.0;

        web *= 0.35 + 0.65 * smoothstep(0.0, 0.2, r);
        vec3 silver = vec3(0.72, 0.74, 0.88);
        col += silver * web + tint * 0.8 + vec3(0.85, 0.95, 1.0) * dew * 1.3;
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
        ripple: { value: 10 },
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

  update(dt: number, time: number, audio: AudioFeatures) {
    this.spectrum.update(audio.bands);
    if (audio.beat) this.rippleT = 0;
    this.rippleT += dt;

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
    u.spiderRot.value = Math.sin(time * 1.3) * 0.12 * away + Math.sin(time * 9) * audio.beatPulse * 0.05;
    u.time.value = time;
    u.bass.value = audio.bass;
    u.treble.value = audio.treble;
    u.beatPulse.value = audio.beatPulse;
    u.dropPulse.value = audio.dropPulse;
    u.ripple.value = this.rippleT;
    u.rot.value = damp(u.rot.value, Math.sin(time * 0.15) * 0.06, 2, dt);
  }
}
