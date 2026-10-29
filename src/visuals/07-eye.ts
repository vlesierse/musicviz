import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

/** 7. A giant bloodshot eye that darts around on beats and blinks on drops. */
export class EyeVisual extends Visual {
  readonly name = 'The Eye';
  bloom = 0.85;
  private uniforms!: Record<string, THREE.IUniform>;
  private gaze = new THREE.Vector2();
  private gazeTarget = new THREE.Vector2();
  private pupil = 0.38;
  private veinGlow = 0;
  private blinkT = 1;
  private blinkSpeed = 4;
  private nextIdleMove = 0;
  private nextIdleBlink = 4;
  private lastBlinkBeat = 0;

  protected setup() {
    this.uniforms = {
      time: { value: 0 },
      aspect: { value: 1 },
      gaze: { value: this.gaze },
      pupil: { value: 0.38 },
      blink: { value: 0 },
      veinGlow: { value: 0 },
      beat: { value: 0 },
      drop: { value: 0 },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect, pupil, blink, veinGlow, beat, drop;
        uniform vec2 gaze;
        varying vec2 vUv;
        ${GLSL_NOISE}
        float fbm3(vec3 p) {
          float f = 0.0, a = 0.5;
          for (int i = 0; i < 3; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; }
          return f;
        }
        float dust(vec2 p, float scale, float speed) {
          vec2 g = p * scale + vec2(time * speed, time * speed * 0.6);
          vec2 cell = floor(g);
          vec2 f = fract(g);
          vec2 rnd = hash22(cell);
          rnd = 0.2 + 0.6 * rnd + 0.15 * vec2(sin(time * 0.7 + rnd.x * 9.0), cos(time * 0.6 + rnd.y * 7.0));
          float on = step(0.72, hash21(cell + 3.7));
          float tw = 0.5 + 0.5 * sin(time * 2.0 + hash21(cell) * 40.0);
          return smoothstep(0.09, 0.0, length(f - rnd)) * on * tw;
        }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
          vec2 q = p - vec2(0.0, -0.04);
          float W = 1.42;
          float xn = clamp(q.x / W, -1.0, 1.0);
          float shape = pow(max(1.0 - xn * xn, 0.0), 0.72);
          float open = 1.0 - blink;
          float upper = shape * mix(-0.33, 0.8, open) + 0.04 * xn * shape;
          float lower = -shape * mix(0.3, 0.5, open);
          float e = 0.006;
          float inEye = smoothstep(-e, e, upper - q.y) * smoothstep(-e, e, q.y - lower);
          vec3 col = vec3(0.0);

          if (inEye > 0.0) {
            float ER = 1.55;
            vec2 sp = q / ER;
            vec3 n = vec3(sp, sqrt(max(1.0 - dot(sp, sp), 0.0)));
            vec3 g = normalize(vec3(gaze, 1.0));
            vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), g));
            vec3 t2 = cross(g, t1);
            float cosT = dot(n, g);
            float theta = acos(clamp(cosT, -1.0, 1.0));
            float irisAng = 0.37;
            float rad = theta / irisAng;
            vec3 ne = vec3(dot(n, t1), dot(n, t2), cosT);
            float phi = atan(ne.y, ne.x);

            // sclera with veins anchored to the eyeball
            vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
            float diff = 0.3 + 0.7 * max(dot(n, L), 0.0);
            vec3 sclera = mix(${glslColor(PALETTE.bone)} * 0.24, vec3(0.3, 0.08, 0.07), smoothstep(1.2, 3.0, rad));
            sclera *= (0.5 + 0.5 * n.z) * mix(0.35, 1.0, smoothstep(1.45, 0.55, abs(q.x)));
            sclera = mix(sclera, sclera * vec3(1.15, 0.6, 0.55), smoothstep(-0.2, 0.7, snoise(ne * 5.0 + 20.0)) * smoothstep(1.1, 2.5, rad) * 0.7);
            vec3 w = ne * 3.0 + 0.35 * vec3(snoise(ne * 2.0 + 4.0), snoise(ne * 2.0 + 9.0), 0.0);
            float v1 = 1.0 - abs(snoise(w));
            float v2 = 1.0 - abs(snoise(w * 2.6 + 11.0));
            float veins = pow(v1, 14.0) + pow(v2, 16.0) * 0.7 * smoothstep(0.6, 0.95, v1);
            veins *= smoothstep(1.15, 2.4, rad);
            veins = clamp(veins, 0.0, 1.0);
            vec3 ball = sclera * diff;
            ball = mix(ball, vec3(0.28, 0.01, 0.02), veins * 0.9);
            ball += ${glslColor(PALETTE.blood)} * veins * veinGlow * 3.5;

            // iris
            float pr = pupil;
            float ir = clamp((rad - pr) / (1.0 - pr), 0.0, 1.0);
            float f1 = snoise(vec3(cos(phi) * 14.0, sin(phi) * 14.0, ir * 2.5 + time * 0.03));
            float f2 = snoise(vec3(cos(phi) * 38.0, sin(phi) * 38.0, ir * 5.0));
            float fib = 0.5 + 0.5 * (0.6 * f1 + 0.4 * f2);
            vec3 iris = mix(${glslColor(PALETTE.candle)} * 1.1, ${glslColor(PALETTE.pumpkin)} * 0.8, smoothstep(0.05, 0.45, ir));
            iris = mix(iris, ${glslColor(PALETTE.ember)} * 0.7, smoothstep(0.45, 0.7, ir));
            iris = mix(iris, ${glslColor(PALETTE.toxic)} * 0.7, smoothstep(0.7, 0.92, ir));
            float crypt = smoothstep(0.1, 0.5, snoise(vec3(cos(phi) * 6.0, sin(phi) * 6.0, ir * 4.0 + 3.0)));
            iris *= (0.08 + 1.3 * fib * fib) * (1.0 - 0.6 * crypt);
            float collar = smoothstep(0.08, 0.0, abs(ir - 0.32 - 0.05 * f1));
            iris += ${glslColor(PALETTE.candle)} * collar * (0.5 + 0.5 * fib);
            iris *= 0.85 + beat * 0.6 + drop * 0.5;
            iris *= smoothstep(1.0, 0.86, rad) * 0.85 + 0.15;
            float irisMask = smoothstep(1.02, 0.97, rad);
            ball = mix(ball, iris, irisMask);
            float pupilMask = smoothstep(pr + 0.02, pr - 0.02, rad);
            ball = mix(ball, vec3(0.004, 0.0, 0.002) + vec3(0.03, 0.0, 0.004) * pow(rad / pr, 6.0), pupilMask);

            // wet cornea highlights
            vec3 nc = normalize(n + g * 0.35 * smoothstep(1.4, 0.0, rad));
            vec3 h1 = normalize(normalize(vec3(-0.5, 0.55, 1.0)) + vec3(0.0, 0.0, 1.0));
            float spec = smoothstep(0.9965, 0.9985, dot(nc, h1)) * 0.6;
            vec3 h2 = normalize(normalize(vec3(-0.3, 0.42, 1.0)) + vec3(0.0, 0.0, 1.0));
            spec += smoothstep(0.9993, 0.9998, dot(nc, h2)) * 0.9;
            spec += pow(max(dot(nc, h1), 0.0), 40.0) * 0.03;
            ball += vec3(1.0, 0.95, 0.9) * spec;

            // lid shadows
            float sh = smoothstep(0.0, 0.22, upper - q.y) * smoothstep(0.0, 0.07, q.y - lower);
            ball *= mix(0.12, 1.0, sh);
            col = ball * inEye;
          }

          // fleshy lids and surroundings
          if (inEye < 1.0) {
            float du = q.y - upper;
            float dl = lower - q.y;
            float sk = fbm3(vec3(p * vec2(3.0, 6.0), 1.7));
            vec3 skin = vec3(0.09, 0.022, 0.03) * (0.7 + 0.5 * sk);
            float crease = smoothstep(0.05, 0.0, abs(du - 0.22 - 0.05 * sk)) * shape;
            skin *= 1.0 - crease * 0.7;
            float lidBulge = smoothstep(0.32, 0.05, du) * step(0.0, du) + smoothstep(0.2, 0.03, dl) * step(0.0, dl);
            skin += vec3(0.12, 0.03, 0.035) * lidBulge * shape;
            float margin = smoothstep(0.035, 0.0, min(abs(du), abs(dl))) * shape;
            skin += vec3(0.35, 0.06, 0.07) * margin;
            vec3 bp = vec3(p * 1.6, time * 0.03);
            bp.xy += 0.4 * vec2(snoise(bp * 1.3 + 5.0), snoise(bp * 1.3 + 8.0));
            float veinsBg = pow(1.0 - abs(snoise(bp)), 22.0) + 0.6 * pow(1.0 - abs(snoise(bp * 2.7 + 2.0)), 26.0);
            float far = smoothstep(0.2, 0.9, length(q * vec2(0.55, 1.0)));
            skin = mix(skin, vec3(0.05, 0.008, 0.03) * (0.6 + 0.6 * sk), far * 0.6);
            skin += ${glslColor(PALETTE.blood)} * veinsBg * (0.08 + beat * 0.35 + veinGlow * 0.5) * far;
            col = mix(skin, col, inEye);
          }

          float dd = dust(p, 6.0, 0.05) + dust(p + 3.1, 11.0, -0.03) * 0.6;
          col += ${glslColor(PALETTE.candle)} * dd * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.uniforms,
      ),
    );
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.uniforms) this.uniforms.aspect.value = w / h;
  }

  onEnter() {
    this.blinkT = 0;
    this.blinkSpeed = 2.2;
  }

  private look() {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    this.gazeTarget.set(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.2);
  }

  private startBlink(speed: number) {
    if (this.blinkT < 1) return;
    this.blinkT = 0;
    this.blinkSpeed = speed;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    if (audio.beat && Math.random() < 0.6) this.look();
    if (time > this.nextIdleMove) {
      if (audio.silent || audio.level < 0.05) this.look();
      this.nextIdleMove = time + 1.2 + Math.random() * 2;
    }
    if (audio.drop) this.startBlink(3.2);
    if (audio.beat && audio.beatCount - this.lastBlinkBeat >= 32) {
      this.lastBlinkBeat = audio.beatCount;
      this.startBlink(4);
    }
    if (time > this.nextIdleBlink) {
      this.startBlink(4.5);
      this.nextIdleBlink = time + 4 + Math.random() * 5;
    }
    this.blinkT = Math.min(1, this.blinkT + dt * this.blinkSpeed);
    const blink = Math.pow(Math.sin(Math.PI * this.blinkT), 0.6);

    this.gaze.x = damp(this.gaze.x, this.gazeTarget.x, 14, dt);
    this.gaze.y = damp(this.gaze.y, this.gazeTarget.y, 14, dt);
    this.pupil = damp(this.pupil, 0.3 + audio.bass * 0.32 + audio.dropPulse * 0.15 + Math.sin(time * 0.9) * 0.02, 6, dt);
    this.veinGlow = damp(this.veinGlow, audio.treble * 1.2 + audio.beatPulse * 0.25 + audio.dropPulse * 0.5, 8, dt);

    const u = this.uniforms;
    u.time.value = time;
    u.pupil.value = this.pupil;
    u.blink.value = blink;
    u.veinGlow.value = this.veinGlow;
    u.beat.value = audio.beatPulse;
    u.drop.value = audio.dropPulse;
  }
}
