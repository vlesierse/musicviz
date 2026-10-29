import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { batTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const MY = 0.03; // mouth centre (screen-height units, y up)
const MW = 0.56; // mouth half width
const FANG_X = 0.17;
const FANG_LEN = 0.23;
const DROPS = 220;
const BATS = 70;
const SPLATS = 10;

/** Inner edge of the upper lip (mirrors the shader). */
function yTop(x: number, open: number) {
  const xn = x / MW;
  const s = Math.sqrt(Math.max(1 - xn * xn, 0));
  return MY + 0.008 + Math.pow(s, 0.7) * (0.02 + 0.12 * open);
}

const MOUTH_FRAG = /* glsl */ `
uniform float time, aspect, open, gum, bass, beatPulse, dropPulse, glow, blood, flicker, px;
varying vec2 vUv;
${GLSL_NOISE}
#define MY ${MY.toFixed(3)}
#define W ${MW.toFixed(3)}

float sEll(float x) { float xn = x / W; return sqrt(max(1.0 - xn * xn, 0.0)); }
float yTopF(float x) { return MY + 0.008 + pow(sEll(x), 0.7) * (0.02 + 0.12 * open); }
float yBotF(float x) { return MY - 0.008 - pow(sEll(x), 0.7) * (0.02 + 0.26 * open); }

const float UX[7] = float[7](0.034, 0.1, ${FANG_X.toFixed(3)}, 0.236, 0.292, 0.344, 0.392);
const float UW[7] = float[7](0.031, 0.029, 0.036, 0.026, 0.024, 0.022, 0.02);
const float UL[7] = float[7](0.06, 0.05, ${FANG_LEN.toFixed(3)}, 0.042, 0.036, 0.032, 0.028);
const float LX[6] = float[6](0.030, 0.086, 0.140, 0.196, 0.250, 0.300);
const float LW[6] = float[6](0.027, 0.026, 0.027, 0.025, 0.023, 0.021);
const float LL[6] = float[6](0.040, 0.040, 0.095, 0.036, 0.032, 0.028);

const vec3 KEY = normalize(vec3(-0.35, 0.45, 1.0));
const vec3 CANDLE = normalize(vec3(0.3, -0.8, 0.6));

// Returns vec4(coverage, nx, t, fang) for a tooth row.
vec4 tooth(float ax, float y, float cx, float hw, float len, float g, float dir, bool fang) {
  float t = (g - y) * dir / len;
  if (t < -0.3 || t > 1.0) return vec4(0.0);
  float c = cx - (fang ? 0.014 * t * t * dir : 0.0);
  float w;
  if (fang) w = hw * (1.0 - pow(max(t, 0.0), 1.25) * 0.97);
  else {
    w = hw * (1.0 - 0.08 * t);
    float r = clamp((t - 0.72) / 0.28, 0.0, 1.0);
    w *= sqrt(max(1.0 - r * r, 0.0));
  }
  float nx = (ax - c) / max(w, 1e-4);
  float edge = px / max(w, 1e-4) * 1.5;
  float cov = smoothstep(1.0, 1.0 - edge - 0.06, abs(nx));
  return vec4(cov, nx, t, fang ? 1.0 : 0.0);
}

vec3 shadeTooth(vec4 tt, float sx, float depth, bool upper) {
  float nx = tt.y * sx;
  float t = tt.z;
  vec3 N = normalize(vec3(nx * 0.85, (upper ? -0.15 + 0.35 * t : 0.15 - 0.35 * t), sqrt(max(1.0 - nx * nx * 0.72, 0.05))));
  vec3 enamel = mix(vec3(0.3, 0.27, 0.2), vec3(0.5, 0.49, 0.46), smoothstep(0.0, 0.5, t));
  enamel = mix(enamel, vec3(0.42, 0.45, 0.5), smoothstep(0.75, 1.0, t) * 0.6);
  float diff = 0.35 + 0.65 * max(dot(N, KEY), 0.0);
  vec3 col = enamel * diff;
  col += vec3(0.25, 0.12, 0.04) * max(dot(N, CANDLE), 0.0) * flicker;
  float spec = pow(max(dot(reflect(-KEY, N), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
  col += vec3(1.0, 0.95, 0.9) * spec * 0.7;
  // red glow from the throat bleeding round the edges
  col += vec3(0.5, 0.02, 0.02) * pow(abs(tt.y), 4.0) * glow * 0.6;
  col *= mix(1.0, 0.35, depth);
  col *= 0.55 + 0.45 * smoothstep(-0.3, 0.15, t);
  // fresh blood coating the fangs
  if (tt.w > 0.5) {
    float edgeB = 0.62 - blood * 0.35 + 0.06 * sin(nx * 4.0 + 1.3) + 0.03 * sin(nx * 11.0);
    float b = smoothstep(edgeB, edgeB + 0.02, t);
    vec3 bc = vec3(0.16, 0.0, 0.01) * diff + vec3(1.0, 0.7, 0.7) * spec * 1.1 + vec3(0.3, 0.0, 0.02) * pow(abs(nx), 2.0);
    col = mix(col, bc, b);
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float ax = abs(p.x);
  float sx = sign(p.x);

  // ---- background: velvet gloom lit by a guttering candle ----
  float n = fbm(vec3(p * vec2(2.5, 1.2), time * 0.05));
  vec3 col = vec3(0.025, 0.002, 0.008) + vec3(0.04, 0.002, 0.01) * smoothstep(-0.3, 0.6, n);
  col += vec3(0.12, 0.04, 0.01) * flicker * exp(-length(p - vec2(0.0, -0.7)) * 2.5);

  // high cape collar (red satin inside, black outside)
  float cl = -0.48 - (p.y + 0.5) * 0.42 + 0.02 * sin(p.y * 6.0);
  float cIn = smoothstep(cl + px, cl - px, -ax) * step(p.y, 0.47 - (ax - 0.62) * 0.8);
  if (ax > 0.5 && cIn > 0.0) {
    float along = (ax - 0.5) * 6.0 + p.y * 2.0;
    float sheen = pow(0.5 + 0.5 * sin(along * 3.0 + p.y * 4.0), 3.0);
    vec3 satin = vec3(0.12, 0.0, 0.012) + vec3(0.32, 0.01, 0.03) * sheen * (0.6 + 0.4 * flicker);
    satin *= smoothstep(0.85, 0.55, ax) * 0.7 + 0.3;
    col = mix(col, satin, cIn);
    float rim = smoothstep(0.012, 0.0, abs(-ax - cl));
    col += vec3(0.4, 0.05, 0.05) * rim * 0.4;
  }

  // ---- face: pale skin lit from below by the candle, fading into the dark ----
  float chinC = MY - 0.12;
  float chinR = 0.33 + 0.1 * open;
  float fw = 0.66 + 0.04 * p.y;
  float fd = p.y > chinC ? ax / fw : length(vec2(p.x / fw, (p.y - chinC) / chinR));
  float face = smoothstep(1.0 + px * 2.0, 1.0 - px * 2.0, fd);
  if (face > 0.0) {
    float fx = ax / fw;
    float fy = p.y > chinC ? 0.0 : (p.y - chinC) / chinR;
    float roundness = sqrt(max(1.0 - fx * fx - fy * fy, 0.0));
    float light = exp(-dot((p - vec2(-0.05, MY - 0.06)) / vec2(0.75, 0.5), (p - vec2(-0.05, MY - 0.06)) / vec2(0.75, 0.5)) * 1.4);
    vec3 skin = vec3(0.1, 0.098, 0.12) * (0.25 + 0.75 * roundness) * (0.25 + 0.95 * light);
    skin *= 0.88 + 0.12 * fbm(vec3(p * 22.0, 1.0));
    skin += vec3(0.07, 0.03, 0.008) * flicker * smoothstep(0.1, -0.45, p.y) * roundness * light;
    // shadow under the lower lip and in the chin cleft
    float lowerOuter = yBotF(p.x) - (0.012 + 0.07 * pow(sEll(p.x), 1.3)) * pow(sEll(p.x), 0.55);
    skin *= 1.0 - 0.6 * exp(-max(lowerOuter - p.y, 0.0) * 22.0) * step(p.y, lowerOuter) * smoothstep(W * 1.05, 0.0, ax);
    // nasolabial creases + philtrum
    float crease = abs(ax - (W + 0.04 + (p.y - MY) * 0.3));
    skin *= 1.0 - 0.45 * exp(-crease * 70.0) * smoothstep(0.3, 0.0, abs(p.y - MY - 0.05));
    skin *= 1.0 - 0.25 * exp(-ax * 30.0) * smoothstep(0.12, 0.2, p.y - MY) ;
    col = mix(col, skin, face);
  }

  // ---- mouth ----
  float s = sEll(p.x);
  float yT = yTopF(p.x);
  float yB = yBotF(p.x);
  float taper = pow(s, 0.55);
  float yUo = yT + (0.012 + 0.03 * s - 0.014 * exp(-p.x * p.x / 0.0012) + 0.01 * exp(-pow(ax - 0.06, 2.0) / 0.0015)) * taper;
  float yLo = yB - (0.012 + 0.07 * pow(s, 1.3)) * taper;
  float inMouth = smoothstep(yT + px, yT - px, p.y) * smoothstep(yB - px, yB + px, p.y) * step(ax, W);

  if (inMouth > 0.0) {
    float yT0 = yTopF(0.0), yB0 = yBotF(0.0);
    vec2 c = vec2(0.0, mix(yB0, yT0, 0.55));
    float r = length((p - c) / vec2(W * 0.75, (yT0 - yB0) * 0.5 + 0.02));
    vec3 throat = mix(vec3(0.95, 0.04, 0.02) * glow, vec3(0.05, 0.0, 0.006), smoothstep(0.0, 0.85, r));
    throat *= 0.4 + 0.6 * smoothstep(0.0, 0.25, r); // deep hole
    throat *= smoothstep(0.0, 0.03, yT - p.y) * 0.6 + 0.4;
    // tongue
    vec2 tq = (p - vec2(0.0, yB0 + 0.01)) / vec2(0.24, 0.045 + 0.05 * open);
    float tl = length(tq);
    if (tl < 1.0) {
      float tz = sqrt(1.0 - tl * tl);
      vec3 tN = normalize(vec3(tq * 0.8, tz));
      vec3 tc = vec3(0.24, 0.025, 0.045) * (0.3 + 0.7 * max(dot(tN, KEY), 0.0));
      tc += vec3(0.6, 0.3, 0.3) * pow(max(dot(reflect(-KEY, tN), vec3(0.0, 0.0, 1.0)), 0.0), 30.0) * 0.4;
      tc *= 1.0 - 0.5 * exp(-ax * 40.0) * smoothstep(0.2, 0.9, tq.y + 0.5);
      tc += vec3(0.4, 0.02, 0.02) * glow * 0.2;
      throat = mix(throat, tc, smoothstep(1.0, 0.94, tl));
    }
    vec3 m = throat;
    // lower teeth
    float gL = 0.0;
    for (int i = 0; i < 6; i++) {
      float g = yBotF(LX[i]) + 0.01 + gum * 0.6;
      gL = max(gL, 0.0);
      vec4 tt = tooth(ax, p.y, LX[i], LW[i], LL[i], g, -1.0, i == 2);
      if (tt.x > 0.0) m = mix(m, shadeTooth(tt, sx, LX[i] / W, false), tt.x);
    }
    // lower gum
    float lg = yB + 0.012 + gum * 0.6 + 0.006 * cos(ax * 110.0);
    if (p.y < lg) m = mix(m, vec3(0.32, 0.08, 0.1) * (0.5 + 0.5 * s), smoothstep(lg, lg - px * 2.0, p.y));
    // upper teeth (fangs drawn later, over the lower lip)
    for (int i = 0; i < 7; i++) {
      if (i == 2) continue;
      float g = yTopF(UX[i]) - 0.01 - gum;
      vec4 tt = tooth(ax, p.y, UX[i], UW[i], UL[i], g, 1.0, false);
      if (tt.x > 0.0) m = mix(m, shadeTooth(tt, sx, UX[i] / W, true), tt.x);
    }
    col = mix(col, m, inMouth);
  }

  // upper gum (scalloped between teeth)
  float ug = yT - 0.012 - gum - 0.007 * cos(ax * 100.0);
  if (p.y < yT && p.y > ug - px && ax < W) {
    float gt = (yT - p.y) / max(yT - ug, 1e-3);
    vec3 gc = vec3(0.42, 0.13, 0.15) * (0.55 + 0.45 * gt) * (0.5 + 0.5 * s);
    gc += vec3(0.6, 0.4, 0.4) * pow(gt, 6.0) * 0.15;
    col = mix(col, gc, smoothstep(ug - px, ug + px, p.y));
  }

  // lips
  vec3 lipBase = vec3(0.13, 0.003, 0.014) * (0.85 + 0.15 * sin(p.x * 260.0 + sin(p.x * 40.0) * 2.0));
  if (p.y > yT - px && p.y < yUo + px && ax < W) {
    float t = clamp((p.y - yT) / max(yUo - yT, 1e-3), 0.0, 1.0);
    vec3 N = normalize(vec3(p.x * 0.6, mix(-0.75, 0.55, t), 0.7));
    float d = max(dot(N, KEY), 0.0);
    vec3 lc = lipBase * (0.25 + 0.95 * d) + vec3(1.0, 0.75, 0.75) * pow(max(dot(reflect(-KEY, N), vec3(0.0, 0.0, 1.0)), 0.0), 40.0) * 0.45;
    lc *= 0.6 + 0.4 * smoothstep(0.0, 0.3, t);
    float a = smoothstep(yT - px, yT + px, p.y) * smoothstep(yUo + px, yUo - px, p.y);
    col = mix(col, lc, a);
  }
  if (p.y < yB + px && p.y > yLo - px && ax < W) {
    float t = clamp((yB - p.y) / max(yB - yLo, 1e-3), 0.0, 1.0);
    vec3 N = normalize(vec3(p.x * 0.6, mix(0.8, -0.65, t), 0.65));
    float d = max(dot(N, KEY), 0.0);
    float sp = pow(max(dot(reflect(-KEY, N), vec3(0.0, 0.0, 1.0)), 0.0), 35.0);
    vec3 lc = lipBase * (0.25 + 0.95 * d) + vec3(1.0, 0.75, 0.75) * sp * 0.7;
    lc += vec3(0.15, 0.05, 0.0) * max(dot(N, CANDLE), 0.0) * flicker * 0.3;
    lc *= 0.55 + 0.45 * smoothstep(0.0, 0.25, t);
    float a = smoothstep(yB + px, yB - px, p.y) * smoothstep(yLo - px, yLo + px, p.y);
    col = mix(col, lc, a);
  }

  // the two long upper fangs hang over the lower lip
  {
    float g = yTopF(UX[2]) - 0.01 - gum;
    vec4 tt = tooth(ax, p.y, UX[2], UW[2], UL[2], g, 1.0, true);
    float a = tt.x * step(p.y, yT + 0.002);
    if (a > 0.0) {
      // soft shadow cast onto the lower lip
      col = mix(col, shadeTooth(tt, sx, 0.0, true), a);
    } else {
      vec4 sh = tooth(ax - 0.006, p.y + 0.008, UX[2], UW[2] * 1.2, UL[2], g, 1.0, true);
      col *= 1.0 - 0.45 * sh.x * step(p.y, yB);
    }
  }

  // chomp flash
  col += vec3(0.25, 0.0, 0.01) * dropPulse * dropPulse * exp(-length(p) * 2.0);
  col *= 1.0 - 0.55 * dot(p, p);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPLAT_FRAG = /* glsl */ `
uniform float time, aspect, px;
uniform vec4 splats[${SPLATS}];
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float best = 1e9;
  float alpha = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < ${SPLATS}; i++) {
    vec4 s = splats[i];
    float age = time - s.w;
    if (age < 0.0 || age > 6.0 || s.z <= 0.0) continue;
    float seed = float(i) * 7.31 + s.w;
    vec2 q = p - s.xy;
    q.y += age * age * 0.004; // slowly sliding down
    float d = length(q);
    if (d > s.z * 3.2) continue;
    float a = atan(q.y, q.x);
    float rr = s.z * (0.75 + 0.3 * snoise(vec3(cos(a) * 1.5, sin(a) * 1.5, seed)) + 0.45 * pow(max(snoise(vec3(cos(a) * 5.0, sin(a) * 5.0, seed + 3.0)), 0.0), 2.0));
    float sd = d - rr;
    // satellite droplets and streaks along rays
    float sec = floor((a + 3.14159) / 6.28318 * 22.0);
    float h = hash21(vec2(sec, seed));
    float ang = (sec + 0.5) / 22.0 * 6.28318 - 3.14159 + (h - 0.5) * 0.2;
    vec2 dir = vec2(cos(ang), sin(ang));
    float dist = s.z * (1.3 + h * 1.6);
    vec2 sc = dir * dist;
    float sr = s.z * (0.05 + 0.12 * hash21(vec2(seed, sec + 9.0)));
    vec2 rel = q - sc;
    float along = dot(rel, dir);
    float perp = dot(rel, vec2(-dir.y, dir.x));
    float sat = length(vec2(along * (along < 0.0 ? 0.35 : 1.0), perp)) - sr;
    sd = min(sd, sat);
    float fade = 1.0 - smoothstep(4.0, 6.0, age);
    float aa = smoothstep(px * 1.5, -px * 1.5, sd) * fade * min(1.0, age * 30.0);
    if (aa > alpha) {
      alpha = aa;
      best = sd;
      grad = normalize(q + 1e-4) * clamp(1.0 + sd / (s.z * 0.25), 0.0, 1.0);
    }
  }
  if (alpha <= 0.0) discard;
  vec3 N = normalize(vec3(grad * 0.8, 1.0));
  float spec = pow(max(dot(N, normalize(vec3(-0.4, 0.5, 1.0))), 0.0), 90.0);
  vec3 col = vec3(0.13, 0.0, 0.008) + vec3(0.18, 0.0, 0.01) * smoothstep(0.0, -0.02, best);
  col += vec3(1.0, 0.6, 0.55) * spec * 0.35;
  gl_FragColor = vec4(col, alpha * 0.95);
}
`;

/** 12. A huge vampire mouth: the jaw rides the bass, fangs drip blood, drops chomp and release bats. */
export class DraculaFangsVisual extends Visual {
  readonly name = "Dracula's Bite";
  bloom = 0.6;
  private quad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private splat!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private splats: THREE.Vector4[] = [];
  private splatIdx = 0;
  private drops!: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private dPos = new Float32Array(DROPS * 4);
  private dVel = new Float32Array(DROPS * 4);
  private dAttrPos!: THREE.InstancedBufferAttribute;
  private dAttrVel!: THREE.InstancedBufferAttribute;
  private dropIdx = 2;
  private tipGrow = [0, 0];
  private tipRate = [0.4, 0.5];
  private bats!: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private batPos = new Float32Array(BATS * 2);
  private batVel = new Float32Array(BATS * 2);
  private batAge = new Float32Array(BATS).fill(99);
  private batDelay = new Float32Array(BATS);
  private batPhase = new Float32Array(BATS);
  private dummy = new THREE.Object3D();
  private open = 0.3;
  private chomp = 0;
  private wide = 0;
  private blood = 0.2;
  private glow = 0.6;
  private shake = new THREE.Vector2();
  private ortho = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);

  protected setup() {
    this.camera = this.ortho;
    for (let i = 0; i < SPLATS; i++) this.splats.push(new THREE.Vector4(0, 0, 0, -100));

    this.quad = fullscreenQuad(MOUTH_FRAG, {
      time: { value: 0 },
      aspect: { value: 1 },
      open: { value: 0.3 },
      gum: { value: 0.0 },
      bass: { value: 0 },
      beatPulse: { value: 0 },
      dropPulse: { value: 0 },
      glow: { value: 0.6 },
      blood: { value: 0.2 },
      flicker: { value: 1 },
      px: { value: 0.001 },
    });
    this.scene.add(this.quad);

    // blood drops (screen space)
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.dAttrPos = new THREE.InstancedBufferAttribute(this.dPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.dAttrVel = new THREE.InstancedBufferAttribute(this.dVel, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.dAttrPos);
    geo.setAttribute('aVel', this.dAttrVel);
    geo.instanceCount = DROPS;
    this.drops = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute vec4 aPos; // xy, z unused, size (radius)
          attribute vec4 aVel; // xy velocity, stretch, alpha
          varying vec2 vQ;
          varying float vLen, vAlpha;
          void main() {
            vec2 d = aVel.xy;
            float sp = length(d);
            vec2 dir = sp > 1e-4 ? -d / sp : vec2(0.0, 1.0);
            vec2 side = vec2(dir.y, -dir.x);
            float w = aPos.w;
            float len = w + sp * aVel.z;
            vec2 pos = aPos.xy + side * position.x * 2.0 * w + dir * position.y * 2.0 * len;
            vQ = position.xy * 2.0;
            vLen = len / w;
            vAlpha = aVel.w;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vQ;
          varying float vLen, vAlpha;
          void main() {
            if (vAlpha <= 0.0) discard;
            float py = vQ.y * vLen;
            float c = -vLen + 1.0;
            vec3 n;
            float cover;
            if (py < c) {
              vec2 q = vec2(vQ.x, py - c);
              float r = length(q);
              cover = 1.0 - smoothstep(0.85, 1.0, r);
              n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
            } else {
              float t = clamp((py - c) / max(2.0 * vLen - 1.0, 0.001), 0.0, 1.0);
              float rad = sqrt(max(1.0 - t, 0.0)) * 0.95;
              float xr = vQ.x / max(rad, 0.01);
              cover = 1.0 - smoothstep(0.75, 1.0, abs(xr));
              n = vec3(xr, 0.1, sqrt(max(1.0 - xr * xr, 0.0)));
            }
            if (cover <= 0.01) discard;
            n = normalize(n);
            vec3 L = normalize(vec3(-0.45, 0.5, 0.8));
            float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 140.0);
            float rim = pow(1.0 - n.z, 2.0);
            vec3 col = vec3(0.14, 0.0, 0.006) + vec3(0.45, 0.01, 0.03) * rim;
            col += vec3(1.0, 0.6, 0.55) * spec * 0.3;
            gl_FragColor = vec4(col, cover * vAlpha);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 10;
    this.scene.add(this.drops);

    // bats
    const bgeo = new THREE.PlaneGeometry(1, 1, 8, 1);
    this.bats = new THREE.InstancedMesh(
      bgeo,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: batTexture() } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          varying vec2 vUv;
          void main() {
            float a = texture2D(map, vUv).a;
            if (a < 0.02) discard;
            vec3 col = vec3(0.012, 0.004, 0.012);
            vec2 e = vec2(abs(vUv.x - 0.5) - 0.022, vUv.y - 0.565);
            col += vec3(3.0, 0.1, 0.05) * smoothstep(0.02, 0.0, length(e));
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
      BATS,
    );
    this.bats.frustumCulled = false;
    this.bats.renderOrder = 20;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < BATS; i++) this.bats.setMatrixAt(i, this.dummy.matrix);
    this.scene.add(this.bats);

    this.splat = fullscreenQuad(SPLAT_FRAG, {
      time: { value: 0 },
      aspect: { value: 1 },
      px: { value: 0.001 },
      splats: { value: this.splats },
    });
    this.splat.material.transparent = true;
    this.splat.renderOrder = 30;
    this.scene.add(this.splat);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    const a = w / h;
    this.ortho.left = -a / 2;
    this.ortho.right = a / 2;
    this.ortho.updateProjectionMatrix();
    for (const m of [this.quad, this.splat]) {
      m.material.uniforms.aspect.value = a;
      m.material.uniforms.px.value = 1 / h;
    }
  }

  onEnter() {
    this.batAge.fill(99);
  }

  private tip(side: number) {
    const g = yTop(FANG_X, this.open) - 0.01 - this.quad.material.uniforms.gum.value;
    return { x: side * (FANG_X - 0.014), y: g - FANG_LEN };
  }

  private emitDrop(x: number, y: number, vx: number, vy: number, r: number) {
    const i = this.dropIdx;
    this.dropIdx = this.dropIdx + 1 >= DROPS ? 2 : this.dropIdx + 1;
    const b = i * 4;
    this.dPos[b] = x;
    this.dPos[b + 1] = y;
    this.dPos[b + 3] = r;
    this.dVel[b] = vx;
    this.dVel[b + 1] = vy;
    this.dVel[b + 2] = 0.012;
    this.dVel[b + 3] = 1;
  }

  private splatAt(x: number, y: number, r: number, time: number) {
    this.splats[this.splatIdx].set(x, y, r, time);
    this.splatIdx = (this.splatIdx + 1) % SPLATS;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    const aspect = this.width / this.height;
    // jaw: opens with the bass, snaps shut on beats, chomps on drops then gapes wide
    if (audio.drop) {
      this.chomp = 1;
      this.wide = 1;
      for (let i = 0; i < BATS; i++) {
        this.batAge[i] = 0;
        this.batDelay[i] = 0.18 + Math.random() * 0.9;
        const a = Math.random() * Math.PI * 2;
        const sp = 0.25 + Math.random() * 0.5;
        this.batVel[i * 2] = Math.cos(a) * sp * aspect * 0.8;
        this.batVel[i * 2 + 1] = Math.sin(a) * sp * 0.6 + 0.1;
        this.batPhase[i] = Math.random() * 10;
      }
      for (let k = 0; k < 7; k++) {
        this.splatAt((Math.random() - 0.5) * aspect * 0.95, (Math.random() - 0.5) * 0.9, 0.04 + Math.random() * 0.08, time + 0.12 + k * 0.03);
      }
    }
    this.chomp = Math.max(0, this.chomp - dt * 3.2);
    this.wide = damp(this.wide, 0, 0.5, dt);
    const snap = audio.beatPulse * audio.beatPulse * 0.7;
    const target = Math.min(1.15, 0.18 + audio.bass * 0.75 + this.wide * 0.5);
    this.open = damp(this.open, target, 10, dt);
    const chompClose = this.chomp > 0.6 ? 1 : this.chomp / 0.6;
    const shownOpen = Math.max(0, this.open * (1 - snap) * (1 - chompClose));
    this.blood = Math.min(1, damp(this.blood, 0.25 + audio.level * 0.3 + audio.dropPulse * 0.5, 0.6, dt));
    this.glow = damp(this.glow, 0.45 + audio.bass * 0.5 + audio.dropPulse * 0.6, 4, dt);

    // shake on chomp
    const sh = audio.dropPulse * 0.012 + audio.beatPulse * 0.002;
    this.shake.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    this.ortho.position.set(this.shake.x, this.shake.y, 0);

    const u = this.quad.material.uniforms;
    u.time.value = time;
    u.open.value = shownOpen;
    u.gum.value = damp(u.gum.value, 0.004 + audio.bass * 0.012 + this.wide * 0.012, 6, dt);
    u.bass.value = audio.bass;
    u.beatPulse.value = audio.beatPulse;
    u.dropPulse.value = audio.dropPulse;
    u.glow.value = this.glow;
    u.blood.value = this.blood;
    u.flicker.value = 0.85 + 0.1 * Math.sin(time * 9.1) * Math.sin(time * 5.3) + 0.08 * Math.sin(time * 23.7);

    // blood forming at the fang tips
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const tp = this.tip(side);
      this.tipGrow[s] += dt * this.tipRate[s] * (0.4 + audio.level * 1.2);
      const r = 0.003 + Math.min(1, this.tipGrow[s]) * 0.009;
      const b = s * 4;
      this.dPos[b] = tp.x + side * 0.001;
      this.dPos[b + 1] = tp.y - r * 0.6;
      this.dPos[b + 3] = r;
      this.dVel[b] = 0;
      this.dVel[b + 1] = 0;
      this.dVel[b + 3] = 0.3 + Math.min(1, this.tipGrow[s] * 1.5) * 0.7;
      const release = this.tipGrow[s] >= 1 || (audio.beat && this.tipGrow[s] > 0.35) || (audio.drop && this.tipGrow[s] > 0.1);
      if (release) {
        this.emitDrop(tp.x, tp.y - r * 0.6, 0, -0.05, r);
        this.tipGrow[s] = 0;
        this.tipRate[s] = 0.35 + Math.random() * 0.5;
      }
    }
    if (audio.beat && audio.bass > 0.3) {
      // a little spray off the fangs
      for (let k = 0; k < 3; k++) {
        const tp = this.tip(Math.random() < 0.5 ? -1 : 1);
        this.emitDrop(tp.x, tp.y, (Math.random() - 0.5) * 0.3, -0.1 - Math.random() * 0.3, 0.002 + Math.random() * 0.003);
      }
    }
    if (audio.drop) {
      for (let k = 0; k < 60; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.3 + Math.random() * 1.2;
        this.emitDrop((Math.random() - 0.5) * 0.4, MY + (Math.random() - 0.5) * 0.05, Math.cos(a) * sp * 0.9, Math.sin(a) * sp * 0.7 + 0.3, 0.003 + Math.random() * 0.008);
      }
    }
    for (let i = 2; i < DROPS; i++) {
      const b = i * 4;
      if (this.dVel[b + 3] <= 0) continue;
      this.dVel[b + 1] -= 1.4 * dt;
      this.dPos[b] += this.dVel[b] * dt;
      this.dPos[b + 1] += this.dVel[b + 1] * dt;
      if (this.dPos[b + 1] < -0.6) this.dVel[b + 3] = 0;
    }
    this.dAttrPos.needsUpdate = true;
    this.dAttrVel.needsUpdate = true;

    // bats flying out of the mouth towards the viewer
    let anyBat = false;
    for (let i = 0; i < BATS; i++) {
      const age = this.batAge[i];
      if (age > 3.2) continue;
      anyBat = true;
      this.batAge[i] += dt;
      const t = age - this.batDelay[i];
      if (t < 0) {
        this.dummy.scale.set(0, 0, 0);
        this.batPos[i * 2] = (Math.random() - 0.5) * 0.25;
        this.batPos[i * 2 + 1] = MY - 0.05 + (Math.random() - 0.5) * 0.06;
      } else {
        const grow = Math.pow(t, 1.6);
        this.batPos[i * 2] += this.batVel[i * 2] * dt * (0.4 + grow * 1.5);
        this.batPos[i * 2 + 1] += this.batVel[i * 2 + 1] * dt * (0.4 + grow * 1.5);
        const sz = 0.03 + grow * 0.22;
        const flap = Math.sin(time * 26 + this.batPhase[i]);
        this.dummy.position.set(this.batPos[i * 2], this.batPos[i * 2 + 1], 0);
        this.dummy.rotation.z = Math.atan2(this.batVel[i * 2 + 1], this.batVel[i * 2]) * 0.15 + Math.sin(time * 3 + this.batPhase[i]) * 0.2;
        this.dummy.scale.set(sz * (0.75 + 0.25 * flap), sz * (0.75 - 0.25 * flap), 1);
      }
      this.dummy.updateMatrix();
      this.bats.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyBat) this.bats.instanceMatrix.needsUpdate = true;
    this.splat.material.uniforms.time.value = time;
  }
}
