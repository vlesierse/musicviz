import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { drawSkull } from '../core/shapes';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const WAVE_N = 256;

/** Per-channel phosphor casts [picture tint, accent (trace / EQ / colour bleed)]. Index 0 is the drop's cursed channel. */
const CASTS: Array<[THREE.Color, THREE.Color]> = [
  [new THREE.Color(1.0, 0.25, 0.22), new THREE.Color(1.0, 0.7, 0.2)],
  [new THREE.Color(0.75, 0.88, 1.0), new THREE.Color(0.35, 1.0, 0.55)],
  [new THREE.Color(0.42, 1.0, 0.45), new THREE.Color(1.0, 0.25, 0.85)],
  [new THREE.Color(0.72, 0.42, 1.0), new THREE.Color(0.4, 1.0, 0.25)],
  [new THREE.Color(0.3, 1.0, 0.92), new THREE.Color(1.0, 0.45, 0.1)],
  [new THREE.Color(1.0, 0.38, 0.85), new THREE.Color(0.25, 0.8, 1.0)],
  [new THREE.Color(1.0, 0.68, 0.3), new THREE.Color(0.7, 0.25, 1.0)],
];

/** Pale long-haired girl (left half) and a skull (right half), each 512×384, white-on-transparent. */
function faceTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  const ctx = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // --- girl ---
  const cx = 256;
  const cy = 200;
  // hair mass behind the face
  ctx.fillStyle = 'rgb(6,6,6)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 60, 125, 120, 0, Math.PI, 0);
  ctx.lineTo(cx + 150, 384);
  ctx.lineTo(cx - 150, 384);
  ctx.closePath();
  ctx.fill();
  // face
  const g = ctx.createRadialGradient(cx - 10, cy - 20, 10, cx, cy, 110);
  g.addColorStop(0, 'rgb(235,235,228)');
  g.addColorStop(0.6, 'rgb(190,192,188)');
  g.addColorStop(1, 'rgb(90,92,92)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 78, 105, 0, 0, Math.PI * 2);
  ctx.fill();
  // hollow eyes
  for (const s of [-1, 1]) {
    const eg = ctx.createRadialGradient(cx + s * 30, cy - 15, 2, cx + s * 30, cy - 15, 30);
    eg.addColorStop(0, 'rgb(0,0,0)');
    eg.addColorStop(0.55, 'rgb(10,10,10)');
    eg.addColorStop(1, 'rgba(60,60,60,0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.ellipse(cx + s * 30, cy - 15, 30, 24, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.beginPath();
    ctx.arc(cx + s * 28, cy - 13, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // gaping mouth
  const mg = ctx.createRadialGradient(cx, cy + 58, 2, cx, cy + 58, 26);
  mg.addColorStop(0, 'rgb(0,0,0)');
  mg.addColorStop(0.7, 'rgb(15,15,15)');
  mg.addColorStop(1, 'rgba(80,80,80,0)');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 58, 17, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  // nose shadow
  ctx.fillStyle = 'rgba(40,40,40,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 22, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // hair strands falling over the face, parted in the middle
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const side = i % 2 ? 1 : -1;
    const x0 = cx + side * (6 + rnd() * 30);
    const spread = 25 + rnd() * 120;
    const x1 = cx + side * (spread * (0.5 + rnd() * 0.7));
    ctx.strokeStyle = `rgba(${4 + rnd() * 20},${4 + rnd() * 20},${4 + rnd() * 20},${0.5 + rnd() * 0.5})`;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x0, cy - 150);
    ctx.bezierCurveTo(cx + side * (85 + rnd() * 30), cy - 90, cx + side * (80 + rnd() * 40), cy + 60, x1 + side * 60 + (rnd() - 0.5) * 30, 384);
    ctx.stroke();
  }
  // a few strands across the eyes
  for (let i = 0; i < 14; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    ctx.strokeStyle = 'rgba(5,5,5,0.85)';
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    const x = cx + side * (35 + rnd() * 45);
    ctx.moveTo(cx + side * 5, cy - 110);
    ctx.quadraticCurveTo(x, cy - 30, x + side * rnd() * 25, 384);
    ctx.stroke();
  }

  // --- skull ---
  ctx.fillStyle = 'rgb(225,225,215)';
  drawSkull(ctx, 768, 185, 150);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const FRAG = /* glsl */ `
uniform sampler2D faceTex, waveTex, osdTex, specTex;
uniform float time, aspect, frame, staticAmt, waveAmp, glitch, face, faceSel, faceZoom, drop, osd, zoom, roll, tvLight, trackY, bass;
uniform float eqAmt, tear, tearY, dropout, dropSeed, chroma, led, treble;
uniform vec3 tint, accent, lightCol;
uniform vec2 shake;
varying vec2 vUv;
${GLSL_NOISE}

const vec2 BC = vec2(0.0, -0.02);   // TV body centre
const vec2 BH = vec2(0.56, 0.36);   // body half size
const vec2 SC = vec2(-0.1, 0.0);    // screen centre
const vec2 SH = vec2(0.37, 0.28);   // screen half size
const float FLOOR = -0.5;

float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float wave(float x) { return texture2D(waveTex, vec2(x, 0.5)).r * 2.0 - 1.0; }

vec3 content(vec2 uv, vec2 nuv) {
  vec2 cell = floor(nuv * vec2(300.0, 225.0));
  float n = hash21(cell + frame * vec2(37.1, 17.3));
  float st = n * n * (0.15 + 0.85 * staticAmt);
  // the face emerging from the snow
  vec2 fuv = (uv - 0.5) * faceZoom + 0.5;
  fuv.x += sin(uv.y * 40.0 + time * 9.0) * 0.004 * (1.0 + glitch * 4.0);
  vec4 f = texture2D(faceTex, vec2(faceSel * 0.5 + clamp(fuv.x, 0.001, 0.999) * 0.5, clamp(fuv.y, 0.0, 1.0)));
  float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
  float m = f.a * face * inside;
  float img = mix(st, f.r * (0.7 + 0.6 * n), m);
  // chroma noise: some snow grains bleed into the accent colour
  float bleed = step(0.82 - chroma * 0.25, hash21(cell * 1.37 + frame * vec2(5.3, 11.9)));
  vec3 c = vec3(img) * mix(tint, accent * 1.2, bleed * (1.0 - m) * 0.7);
  // ghostly equaliser rising through the snow
  float col32 = floor(uv.x * 32.0);
  float bh = texture2D(specTex, vec2((col32 + 0.5) / 32.0, 0.5)).r;
  float seg = step(0.28, fract(uv.y * 36.0)) * step(0.14, fract(uv.x * 32.0)) * step(fract(uv.x * 32.0), 0.86);
  float bh2 = bh * bh * 0.75;
  float bar = step(uv.y, 0.03 + bh2) * seg;
  float cap = smoothstep(0.03, 0.0, abs(uv.y - 0.03 - bh2)) * seg;
  vec3 eqc = mix(accent, tint, smoothstep(0.05, 0.7, uv.y));
  c = mix(c, c * 0.35, bar * eqAmt * (1.0 - m));
  c += eqc * (bar * (0.9 + 0.5 * n) + cap * 1.5) * eqAmt * (1.0 - m * 0.85);
  // oscilloscope
  float y = 0.5 + wave(uv.x) * 0.36 * waveAmp;
  float dy = (wave(uv.x + 1.0 / ${WAVE_N}.0) - wave(uv.x - 1.0 / ${WAVE_N}.0)) * 0.36 * waveAmp * ${WAVE_N / 2}.0;
  float dist = abs(uv.y - y) / sqrt(1.0 + dy * dy);
  float line = exp(-pow(dist / 0.0045, 2.0)) + 0.25 * exp(-dist * 90.0);
  c += accent * line * (0.25 + 0.75 * waveAmp) * (1.0 - m * 0.7);
  // rolling hum bar
  c *= 0.8 + 0.35 * smoothstep(0.4, 1.0, sin((uv.y + time * 0.11) * 6.2832));
  // scanlines
  c *= 0.72 + 0.28 * sin(uv.y * 120.0 * 6.2832);
  return c;
}

vec3 screen(vec2 suv) {
  vec2 uv = suv * 0.5 + 0.5;
  uv.y = fract(uv.y + roll);
  float ln = floor(uv.y * 225.0);
  float jit = (hash11(ln + frame * 13.0) - 0.5) * 0.004 * (0.4 + staticAmt);
  float band = exp(-pow((uv.y - trackY) * 14.0, 2.0));
  uv.x += jit + band * (0.025 + glitch * 0.12) * (hash11(ln * 0.31 + frame) - 0.5) * 2.0;
  float seg = floor(uv.y * 14.0 + floor(time * 24.0) * 3.0);
  uv.x += glitch * (hash11(seg) - 0.5) * 0.25 * step(0.55, hash11(seg * 3.1));
  // snare/clap: a hard tear slices a block of lines sideways
  float tb = smoothstep(0.09, 0.07, abs(uv.y - tearY));
  uv.x += tb * tear * (0.08 + 0.05 * sin(uv.y * 90.0 + time * 40.0));
  float sh = 0.0025 + glitch * 0.02 + drop * 0.008 + tear * 0.012;
  vec3 c;
  c.r = content(uv + vec2(sh, 0.0), uv).r;
  c.g = content(uv, uv).g;
  c.b = content(uv - vec2(sh, 0.0), uv).b;
  c += accent * 0.08 * band * (1.0 + glitch); // tracking band noise
  c += accent * tb * tear * 0.35;
  // hi-hats: bright VHS dropout streaks on random lines
  float dl = floor(uv.y * 160.0);
  float dh = hash11(dl * 7.31 + dropSeed * 3.7);
  float x0 = hash11(dl * 1.9 + dropSeed);
  float streak = step(0.955 - treble * 0.02, dh) * smoothstep(0.0, 0.02, uv.x - x0) * smoothstep(0.0, 0.08, x0 + 0.08 + dh * 0.25 - uv.x);
  c += mix(vec3(1.0), accent, step(0.985, dh)) * streak * dropout * 1.3;
  vec4 o = texture2D(osdTex, suv * 0.5 + 0.5);
  c = mix(c, o.rgb * 1.6, o.a * osd);
  return c;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 1.3 / zoom + shake + vec2(-0.1, 0.0) * (zoom - 1.0) + vec2(0.0, -0.06);
  float flick = 0.9 + 0.1 * hash11(frame * 0.71);
  vec3 L = lightCol * tvLight * flick;

  // ---- room: wallpaper + floorboards lit by the TV ----
  vec3 col;
  vec2 lp = (p - SC) * vec2(0.55, 1.0);
  float fall = 1.0 / (1.0 + dot(lp, lp) * 9.0);
  if (p.y > FLOOR) {
    vec2 w = p * 11.0;
    float dam = smoothstep(0.25, 0.6, abs(sin(w.x) * sin(w.y * 0.7) + 0.5 * sin(w.x * 2.0 + w.y * 1.4)));
    float stripes = 0.85 + 0.15 * step(0.5, fract(p.x * 7.0));
    float stain = 0.7 + 0.3 * smoothstep(-0.4, 0.5, fbm(vec3(p * 3.0, 2.0)));
    vec3 alb = vec3(0.16, 0.13, 0.15) * (0.7 + 0.3 * dam) * stripes * stain;
    col = alb * (0.012 + L * fall * 0.9);
    // skirting board
    col *= mix(1.0, 0.4, smoothstep(FLOOR + 0.05, FLOOR + 0.04, p.y));
  } else {
    float fy = FLOOR - p.y;
    float z = 0.12 / max(fy, 0.002);
    vec2 fp = vec2(p.x * z, z);
    float board = fract(fp.x * 2.5);
    float seam = smoothstep(0.0, 0.03, board) * smoothstep(1.0, 0.97, board);
    vec3 wood = vec3(0.12, 0.07, 0.04) * (0.7 + 0.3 * hash11(floor(fp.x * 2.5))) * (0.85 + 0.15 * sin(fp.y * 30.0 + fp.x * 5.0)) * (0.5 + 0.5 * seam);
    vec2 flp = vec2((p.x - SC.x) * 0.5, (p.y - FLOOR) * 2.2 + 0.25);
    float ffall = 1.0 / (1.0 + dot(flp, flp) * 14.0);
    col = wood * (0.01 + L * ffall * 0.8);
    // glossy reflection streak of the screen
    col += L * 0.06 * exp(-pow((p.x - SC.x) / 0.25, 2.0)) * smoothstep(-0.6, FLOOR, p.y);
    // contact shadow under the set
    col *= 1.0 - 0.8 * exp(-pow((p.x - BC.x) / (BH.x * 1.05), 8.0)) * smoothstep(0.08, 0.0, fy);
  }

  // ---- rabbit-ear antenna ----
  vec2 ab = BC + vec2(0.18, BH.y + 0.01);
  vec2 tipL = ab + vec2(-0.25, 0.42);
  vec2 tipR = ab + vec2(0.3, 0.36);
  float ant = min(sdSeg(p, ab, tipL), sdSeg(p, ab, tipR));
  col = mix(col, vec3(0.05) + L * 0.12, smoothstep(0.004, 0.002, ant));
  col = mix(col, vec3(0.08) + L * 0.25, smoothstep(0.009, 0.007, min(length(p - tipL), length(p - tipR))));
  float dome = length((p - ab) * vec2(1.0, 1.6)) - 0.045;
  col = mix(col, vec3(0.025, 0.02, 0.018) + L * 0.08 * smoothstep(-0.04, 0.0, p.y - ab.y - 0.01), smoothstep(0.003, 0.0, dome) * step(ab.y - 0.01, p.y));

  // ---- legs ----
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    vec2 a = vec2(BC.x + s * (BH.x - 0.1), BC.y - BH.y + 0.01);
    vec2 b = vec2(BC.x + s * (BH.x - 0.04), FLOOR - 0.06);
    float leg = sdSeg(p, a, b) - mix(0.012, 0.006, clamp((a.y - p.y) / (a.y - b.y), 0.0, 1.0));
    col = mix(col, vec3(0.03, 0.018, 0.01) + L * 0.03, smoothstep(0.002, 0.0, leg));
  }

  // ---- cabinet ----
  float body = sdBox(p - BC, BH, 0.06);
  if (body < 0.003) {
    vec2 q = p - BC;
    float grain = 0.8 + 0.2 * sin(q.x * 160.0 + 6.0 * snoise(vec3(q * vec2(4.0, 40.0), 1.0)));
    vec3 wood = vec3(0.09, 0.05, 0.025) * grain;
    vec3 bc = wood * (0.025 + L * 0.06);
    bc += L * 0.05 * smoothstep(-0.02, 0.0, body) * smoothstep(-0.3, 0.3, q.y); // rim catching the glow
    // control panel on the right
    vec2 kp = p - vec2(SC.x + SH.x + 0.13, 0.0);
    float panel = sdBox(kp, vec2(0.07, 0.29), 0.02);
    bc = mix(bc, vec3(0.012) + L * 0.02, smoothstep(0.002, 0.0, panel));
    for (int k = 0; k < 2; k++) {
      vec2 kc = kp - vec2(0.0, 0.17 - float(k) * 0.12);
      float kr = length(kc);
      float ridges = 0.7 + 0.3 * sin(atan(kc.y, kc.x) * 18.0);
      vec3 knob = vec3(0.04) * ridges + L * 0.1 * smoothstep(0.0, 0.04, kc.y + 0.02);
      bc = mix(bc, vec3(0.005), smoothstep(0.042, 0.038, kr));
      bc = mix(bc, knob, smoothstep(0.036, 0.033, kr));
      bc = mix(bc, vec3(0.12) + L * 0.2, smoothstep(0.004, 0.0, sdSeg(kc, vec2(0.0), vec2(0.0, 0.03))));
    }
    // speaker grille
    vec2 gp = kp - vec2(0.0, -0.15);
    float grille = sdBox(gp, vec2(0.05, 0.1), 0.01);
    float slots = smoothstep(0.3, 0.5, abs(fract(gp.y * 60.0) - 0.5) * 2.0);
    bc = mix(bc, vec3(0.006) + L * 0.015 * slots, smoothstep(0.002, 0.0, grille));
    // red standby LED
    bc += vec3(1.5, 0.05, 0.02) * (1.0 + led * 2.5) * smoothstep(0.006 + led * 0.002, 0.003, length(kp - vec2(0.0, -0.27)));
    col = mix(col, bc, smoothstep(0.003, 0.0, body));
  }

  // ---- curved glass screen ----
  vec2 sp = (p - SC) / SH;
  float r2 = dot(sp, sp);
  vec2 cs = sp * (1.0 + 0.07 * r2);
  float sd = sdBox(sp * SH, SH, 0.045);
  float bezel = sdBox(sp * SH, SH + 0.022, 0.06);
  if (bezel < 0.0) {
    // inner bevel lit by the picture
    float bev = clamp(-bezel / 0.022, 0.0, 1.0);
    col = mix(col, vec3(0.008) + L * (0.03 + 0.12 * bev * bev) * (0.7 + 0.3 * sp.y), smoothstep(0.002, -0.002, bezel));
  }
  if (sd < 0.004) {
    vec3 sc = screen(cs);
    float vig = 1.0 - pow(min(length(cs) * 0.72, 1.0), 4.0);
    sc *= vig;
    // glass: dark phosphor colour + reflection of the room
    sc += vec3(0.02, 0.025, 0.03) + vec3(0.06, 0.07, 0.08) * exp(-dot(sp - vec2(-0.5, 0.6), sp - vec2(-0.5, 0.6)) * 3.0);
    col = mix(col, sc, smoothstep(0.003, -0.002, sd));
  }
  // vignette
  vec2 vq = (vUv - 0.5) * vec2(aspect, 1.0);
  col *= 1.0 - 0.6 * smoothstep(0.35, 1.0, length(vq * vec2(0.8, 1.2)));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 18. A haunted CRT: snow, rolling bars, VHS tracking glitches and something trying to come through. */
export class PossessedTvVisual extends Visual {
  readonly name = 'Possessed TV';
  bloom = 0.75;
  private quad!: THREE.Mesh;
  private u!: Record<string, THREE.IUniform>;
  private waveData = new Uint8Array(WAVE_N * 4);
  private waveTex!: THREE.DataTexture;
  private osdCanvas!: HTMLCanvasElement;
  private osdTex!: THREE.CanvasTexture;
  private channel = 3;
  private osdTimer = 0;
  private faceFlash = 0;
  private faceSel = 0;
  private glitch = 0;
  private dropT = 0;
  private staticAmt = 0.5;
  private waveAmp = 0.3;
  private trackY = 0.3;
  private roll = 0;
  private rollVel = 0;
  private zoom = 1;
  private light = 0.5;
  private spec = new SpectrumTexture(64);
  private cast = 1;
  private castFrom = 1;
  private castMix = 1;
  private castSpeed = 3;
  private tint = new THREE.Color();
  private accent = new THREE.Color();
  private lightCol = new THREE.Color();
  private tear = 0;
  private tearY = 0.5;
  private dropout = 0;
  private chroma = 0;
  private led = 0;
  private eqAmt = 0.3;

  protected setup() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.waveTex = new THREE.DataTexture(this.waveData, WAVE_N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.waveTex.magFilter = THREE.LinearFilter;
    this.waveTex.minFilter = THREE.LinearFilter;
    this.waveTex.needsUpdate = true;
    this.osdCanvas = document.createElement('canvas');
    this.osdCanvas.width = 512;
    this.osdCanvas.height = 384;
    this.osdTex = new THREE.CanvasTexture(this.osdCanvas);
    this.osdTex.minFilter = THREE.LinearFilter;
    this.osdTex.generateMipmaps = false;
    this.drawOsd(this.channel);
    this.u = {
      faceTex: { value: faceTexture() },
      waveTex: { value: this.waveTex },
      osdTex: { value: this.osdTex },
      time: { value: 0 },
      aspect: { value: 1 },
      frame: { value: 0 },
      staticAmt: { value: 0.5 },
      waveAmp: { value: 0.3 },
      glitch: { value: 0 },
      face: { value: 0 },
      faceSel: { value: 0 },
      faceZoom: { value: 1 },
      drop: { value: 0 },
      osd: { value: 0 },
      zoom: { value: 1 },
      roll: { value: 0 },
      tvLight: { value: 0.5 },
      trackY: { value: 0.3 },
      bass: { value: 0 },
      shake: { value: new THREE.Vector2() },
      specTex: { value: this.spec.texture },
      eqAmt: { value: 0.3 },
      tear: { value: 0 },
      tearY: { value: 0.5 },
      dropout: { value: 0 },
      dropSeed: { value: 0 },
      chroma: { value: 0 },
      led: { value: 0 },
      treble: { value: 0 },
      tint: { value: this.tint },
      accent: { value: this.accent },
      lightCol: { value: this.lightCol },
    };
    this.quad = fullscreenQuad(FRAG, this.u);
    this.scene.add(this.quad);
  }

  private setCast(i: number, speed: number) {
    if (i === this.cast) return;
    this.castFrom = this.cast;
    this.cast = i;
    this.castMix = 0;
    this.castSpeed = speed;
  }

  private drawOsd(ch: number) {
    const ctx = this.osdCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 384);
    ctx.font = 'bold 54px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const txt = `CH ${String(ch).padStart(2, '0')}`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.strokeText(txt, 470, 36);
    ctx.fillStyle = ch === 13 ? 'rgb(255,40,30)' : 'rgb(60,255,90)';
    ctx.fillText(txt, 470, 36);
    if (ch === 13) {
      ctx.font = 'bold 30px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'left';
      ctx.strokeText('▶ PLAY', 40, 310);
      ctx.fillStyle = 'rgb(235,235,235)';
      ctx.fillText('▶ PLAY', 40, 310);
    }
    this.osdTex.needsUpdate = true;
  }

  onEnter() {
    this.dropT = 0;
    this.faceFlash = 0;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    // waveform: trigger on a rising zero crossing so the trace stands still
    const w = audio.waveform;
    const step = Math.max(1, Math.floor(w.length / 2 / WAVE_N));
    let start = 0;
    for (let i = 1; i < w.length / 2; i++) {
      if (w[i - 1] < 0 && w[i] >= 0) {
        start = i;
        break;
      }
    }
    let peak = 0;
    for (let i = 0; i < WAVE_N; i++) {
      const v = w[Math.min(w.length - 1, start + i * step)] || 0;
      peak = Math.max(peak, Math.abs(v));
      const b = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
      this.waveData[i * 4] = b;
    }
    this.waveTex.needsUpdate = true;

    if (audio.drop) {
      this.dropT = 3.2;
      this.faceSel = 0;
      this.channel = 13;
      this.drawOsd(13);
      this.osdTimer = 3.5;
      this.rollVel = 2.5;
      this.setCast(0, 4);
    }
    this.dropT = Math.max(0, this.dropT - dt);
    const inDrop = this.dropT > 0 ? 1 : 0;

    if (audio.beat) {
      this.glitch = 1;
      if (Math.random() < 0.2 && !inDrop) {
        this.faceFlash = 1;
        this.faceSel = Math.random() < 0.65 ? 0 : 1;
      }
      if (audio.beatCount % 16 === 0 && !inDrop) {
        this.channel = [2, 3, 4, 6, 7, 9, 11][Math.floor(Math.random() * 7)];
        this.drawOsd(this.channel);
        this.osdTimer = 1.5;
        this.rollVel = 1.2;
        // every channel has its own phosphor cast
        this.setCast(1 + ((this.cast + Math.floor(Math.random() * (CASTS.length - 2))) % (CASTS.length - 1)), 3);
      }
    }
    // snare/clap: the picture tears and something tries to come through
    if (audio.midHit) {
      this.tear = 1;
      this.tearY = 0.1 + Math.random() * 0.8;
      this.chroma = 1;
      if (Math.random() < 0.4 && !inDrop) {
        this.faceFlash = Math.max(this.faceFlash, 0.9);
        this.faceSel = Math.random() < 0.65 ? 0 : 1;
      }
    }
    // hi-hats: VHS dropout streaks and the standby LED blinks
    if (audio.trebleHit) {
      this.dropout = 1;
      this.led = 1;
      this.u.dropSeed.value = audio.trebleHitCount % 997;
    }
    this.glitch *= Math.exp(-9 * dt);
    this.faceFlash *= Math.exp(-3.5 * dt);
    this.tear *= Math.exp(-5 * dt);
    this.chroma *= Math.exp(-3 * dt);
    this.dropout *= Math.exp(-6 * dt);
    this.led *= Math.exp(-8 * dt);

    this.castMix = Math.min(1, this.castMix + dt * this.castSpeed);
    const cm = this.castMix * this.castMix * (3 - 2 * this.castMix);
    this.tint.copy(CASTS[this.castFrom][0]).lerp(CASTS[this.cast][0], cm);
    this.accent.copy(CASTS[this.castFrom][1]).lerp(CASTS[this.cast][1], cm);
    // brighter music bleeds the accent into the picture
    this.tint.lerp(this.accent, audio.brightness * 0.25);
    this.lightCol.setRGB(0.38, 0.58, 1.0).lerp(this.tint, 0.6).lerp(this.accent, this.chroma * 0.25);
    this.spec.update(audio.bands);
    this.eqAmt = damp(this.eqAmt, 0.18 + audio.mid * 0.35 + audio.level * 0.25, 6, dt);
    this.osdTimer = Math.max(0, this.osdTimer - dt);

    // vertical hold slips after channel changes / drops
    this.roll = (this.roll + this.rollVel * dt) % 1;
    this.rollVel *= Math.exp(-2.5 * dt);
    if (this.rollVel < 0.02) this.roll = damp(this.roll, this.roll > 0.5 ? 1 : 0, 6, dt);

    this.staticAmt = damp(this.staticAmt, 0.25 + audio.level * 0.85 + this.glitch * 0.3, 8, dt);
    this.waveAmp = damp(this.waveAmp, Math.min(1, 0.15 + peak * 1.3), 12, dt);
    this.trackY = (this.trackY + dt * (0.07 + audio.treble * 0.25)) % 1.2;
    const face = Math.max(this.faceFlash * 0.85, inDrop ? 0.95 : 0);
    this.zoom = damp(this.zoom, 1 + inDrop * 0.14 + audio.bass * 0.02, inDrop ? 3 : 1.5, dt);
    this.light = damp(this.light, 0.55 + this.staticAmt * 0.5 + face * 0.6 + audio.beatPulse * 0.25, 14, dt);

    const u = this.u;
    u.time.value = time;
    u.frame.value = Math.floor(time * 30);
    u.staticAmt.value = this.staticAmt;
    u.waveAmp.value = this.waveAmp * (1 - face * 0.6);
    u.glitch.value = Math.min(1.5, this.glitch * 0.6 + inDrop * (Math.random() < 0.12 ? 0.8 : 0.08));
    u.face.value = face;
    u.faceSel.value = this.faceSel;
    u.faceZoom.value = inDrop ? 1 - (1 - this.dropT / 3.2) * 0.35 : 1;
    u.drop.value = inDrop;
    u.osd.value = this.osdTimer > 0 ? Math.min(1, this.osdTimer * 3) * (Math.floor(time * 4) % 2 || this.channel !== 13 ? 1 : 0.6) : 0;
    u.zoom.value = this.zoom;
    u.roll.value = this.roll;
    u.tvLight.value = this.light;
    u.trackY.value = this.trackY - 0.1;
    u.bass.value = audio.bass;
    u.eqAmt.value = this.eqAmt * (1 - face * 0.7);
    u.tear.value = this.tear;
    u.tearY.value = this.tearY;
    u.dropout.value = this.dropout;
    u.chroma.value = this.chroma;
    u.led.value = this.led;
    u.treble.value = audio.treble;
    const shake = inDrop * 0.006 + this.glitch * 0.002;
    (u.shake.value as THREE.Vector2).set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    this.u.aspect.value = w / h;
  }
}
