import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE, FULLSCREEN_VERT } from '../core/glsl';
import { Visual, damp, fullscreenQuad, lerp } from '../core/Visual';

const EXT = 3.2; // quad half-extent in eye half-widths (room for the glow halo)
const MAX_EYES = 300;

type EyeType = 0 | 1 | 2; // 0 cat slit, 1 goat bar, 2 spider orb

interface Group {
  eyes: number[];
  offs: number[]; // local offsets (x, y) per eye, in eye-size units
  sizes: number[]; // per-eye size multiplier
  layer: number; // 0 far, 1 mid, 2 near
  bx: number; // base position (x in aspect-normalised units -0.5..0.5)
  by: number;
  size: number;
  depth: number;
  band: number;
  hidden: boolean;
  type: EyeType;
  seed: number;
  open: number;
  bright: number;
  energy: number;
  blinkStart: number;
  nextBlink: number;
  flare: number; // mid-hit "noticed you": eyes snap wide, pupils pinch, glow surges
}

const SLOTS = 6; // iris colour slots; slot 6 is the spiders
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
/** Iris palettes (LDR, boosted x1.6 in the shader) + fog tint. Cycles every 32 beats, snaps on drops. */
interface Mood {
  iris: THREE.Color[]; // SLOTS + 1 (spider)
  fog: THREE.Color;
}
const MOODS: Mood[] = [
  {
    // classic: blood, ember, amber, sulphur, toxic
    iris: [C(1, 0.035, 0.012), C(0.94, 0.075, 0.012), C(0.94, 0.39, 0.03), C(0.85, 0.66, 0.05), C(0.28, 0.94, 0.05), C(0.5, 0.9, 0.075), C(1, 0.06, 0.03)],
    fog: C(0.02, 0.026, 0.032),
  },
  {
    // witchfire: violets and magentas with the odd green
    iris: [C(0.6, 0.1, 1), C(1, 0.1, 0.7), C(0.45, 0.05, 0.9), C(1, 0.3, 0.85), C(0.3, 1, 0.1), C(1, 0.5, 0.05), C(0.3, 1, 0.15)],
    fog: C(0.026, 0.017, 0.036),
  },
  {
    // spectral: ghost cyan and ice
    iris: [C(0.05, 0.75, 1), C(0.25, 0.55, 1), C(0.03, 0.9, 0.65), C(0.1, 0.3, 1), C(0.45, 0.8, 1), C(0.55, 0.2, 1), C(0.8, 0.2, 1)],
    fog: C(0.015, 0.027, 0.04),
  },
  {
    // hellfire: crimson, scarlet, molten gold
    iris: [C(1, 0.02, 0.05), C(1, 0.1, 0.02), C(1, 0.35, 0.02), C(1, 0.7, 0.1), C(1, 0.15, 0.3), C(0.9, 0.25, 0.02), C(1, 0.8, 0.15)],
    fog: C(0.032, 0.015, 0.017),
  },
  {
    // swamp: acid greens with a violet stranger
    iris: [C(0.35, 0.95, 0.04), C(0.55, 0.9, 0.06), C(0.08, 0.9, 0.45), C(0.9, 0.75, 0.05), C(0.05, 0.85, 0.25), C(0.7, 0.15, 1), C(1, 0.25, 0.05)],
    fog: C(0.017, 0.03, 0.021),
  },
];

/** Seeded RNG so the forest layout is the same every time. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawBranch(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  depth: number,
  spread: number,
) {
  if (depth <= 0 || w < 0.7) return;
  const steps = 5;
  let cx = x;
  let cy = y;
  let a = ang;
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 0.45;
    const nx = cx + (Math.cos(a) * len) / steps;
    const ny = cy + (Math.sin(a) * len) / steps;
    ctx.lineWidth = w * (1 - (i / steps) * 0.38);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    // little twigs
    if (depth <= 3 && rng() < 0.35) {
      const ta = a + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6);
      const tl = len * (0.12 + rng() * 0.15);
      ctx.lineWidth = Math.max(0.6, w * 0.3);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.quadraticCurveTo(nx + Math.cos(ta) * tl * 0.5, ny + Math.sin(ta) * tl * 0.5 + tl * 0.1, nx + Math.cos(ta) * tl, ny + Math.sin(ta) * tl);
      ctx.stroke();
    }
    cx = nx;
    cy = ny;
  }
  const n = rng() < 0.45 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const da = (k / (n - 1) - 0.5) * spread + (rng() - 0.5) * 0.5;
    drawBranch(ctx, rng, cx, cy, a + da, len * (0.62 + rng() * 0.2), w * 0.62, depth - 1, spread);
  }
}

function treeCanvas(foreground: boolean) {
  const W = 1920;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const rng = mulberry32(foreground ? 1337 : 4242);
  if (foreground) {
    // heavy gnarled trunks framing the left and right edges + branches reaching in from the top
    drawBranch(ctx, rng, W * 0.035, H + 30, -Math.PI / 2 + 0.06, 420, 95, 7, 1.0);
    drawBranch(ctx, rng, W * 0.965, H + 30, -Math.PI / 2 - 0.08, 380, 80, 7, 1.0);
    drawBranch(ctx, rng, -20, H * 0.12, 0.25, 330, 34, 6, 1.1);
    drawBranch(ctx, rng, W + 20, H * 0.2, Math.PI - 0.2, 300, 30, 6, 1.1);
    drawBranch(ctx, rng, W * 0.42, -30, Math.PI / 2 - 0.5, 160, 16, 5, 1.3);
    // roots / ground
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      const y = H - 18 - 22 * Math.sin(x * 0.004) - 14 * Math.sin(x * 0.013 + 1) - 10 * rng();
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.fill();
  } else {
    const xs = [0.12, 0.2, 0.31, 0.44, 0.55, 0.63, 0.74, 0.83, 0.9];
    for (const fx of xs) {
      const w = 10 + rng() * 16;
      drawBranch(ctx, rng, W * (fx + (rng() - 0.5) * 0.03), H + 20, -Math.PI / 2 + (rng() - 0.5) * 0.12, 260 + rng() * 120, w, 6, 0.9);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const BG_FRAG = /* glsl */ `
uniform float time, aspect, pan, dropPulse, glow;
uniform vec3 uFog;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  vec3 col = vec3(0.0015, 0.002, 0.004);
  // a pale moon smothered by fog high in the trees
  vec2 mp = vec2(aspect * 0.23 + pan * 0.2, 0.36);
  float md = length(p - mp);
  col += vec3(0.04, 0.05, 0.06) * exp(-md * 4.0);
  col += vec3(0.1, 0.105, 0.11) * smoothstep(0.052, 0.048, md);
  // drifting fog banks, thicker near the ground
  float f = fbm(vec3(p * vec2(1.4, 2.4) + vec2(time * 0.025 + pan, 0.0), time * 0.03));
  float fogAmt = smoothstep(-0.5, 0.7, f) * (0.35 + 0.9 * smoothstep(0.25, -0.5, p.y));
  vec3 fogC = uFog * (1.0 + glow * 0.8);
  col = mix(col, fogC + col * 0.5, clamp(fogAmt, 0.0, 1.0));
  col += vec3(0.05, 0.0, 0.004) * dropPulse * fogAmt;
  gl_FragColor = vec4(col, 1.0);
}`;

const TREE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float pan, aspect, parallax, tone, time, glow, mist;
uniform vec3 uFog;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec2 uv = (vUv - 0.5) * 0.94 + 0.5 + vec2(pan * parallax / aspect, 0.0);
  float a = texture2D(map, uv).a * tone;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  vec3 mc = vec3(0.0);
  if (mist > 0.0) {
    float m = fbm(vec3(p.x * 1.6 + time * 0.05, p.y * 4.5, time * 0.04));
    float amt = smoothstep(-0.3, 0.8, m) * smoothstep(-0.1, -0.5, p.y);
    mc = uFog * 1.35 * amt * mist * (1.0 + glow);
  }
  // premultiplied: black silhouettes over everything, mist added on top
  gl_FragColor = vec4(mc * (1.0 - a), a);
}`;

const EYE_VERT = /* glsl */ `
attribute vec4 aPos;   // x (aspect-normalised), y, size, depth
attribute vec4 aShape; // angle, height, type, seed
attribute vec4 aState; // open, bright, dilate, glint
attribute float aSlot;  // palette slot
uniform vec3 uPal[${SLOTS + 1}];
uniform float aspect, time, stare, pan;
uniform vec2 target;
varying vec2 vQ;
varying vec2 vLook;
varying vec4 vState;
varying vec4 vShape;
varying vec3 vCol;
${GLSL_NOISE}
void main() {
  vec2 q = position.xy * ${EXT.toFixed(1)};
  vec2 center = vec2(aPos.x * aspect + pan * (0.3 + aPos.w), aPos.y);
  float c = cos(aShape.x), s = sin(aShape.x);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(center + r * aPos.z, 0.0, 1.0);
  vQ = q;
  vec2 tw = vec2(target.x * aspect, target.y) - center;
  vec2 look = tw / (length(tw) + 0.3);
  // occasional saccades
  float k = floor(time * 0.6 + aShape.w * 7.0);
  look += 0.35 * (vec2(hash11(k + aShape.w * 91.0), hash11(k * 1.7 + aShape.w * 13.0)) - 0.5);
  look = vec2(c * look.x + s * look.y, -s * look.x + c * look.y);
  look *= 1.0 - stare;
  vLook = look * vec2(0.42, 0.22);
  vState = aState;
  vShape = aShape;
  int si = int(aSlot + 0.5);
  vec3 pc = uPal[0];
  for (int k = 1; k <= ${SLOTS}; k++) if (k == si) pc = uPal[k];
  vCol = pc * 1.6;
}`;

const EYE_FRAG = /* glsl */ `
uniform float stare, treble;
varying vec2 vQ;
varying vec2 vLook;
varying vec4 vState;
varying vec4 vShape;
varying vec3 vCol;
void main() {
  vec2 q = vQ;
  float type = vShape.z;
  float seed = vShape.w;
  float open = vState.x;
  float bright = vState.y;
  float dil = vState.z;
  float glint = vState.w;
  float spec = 0.75 + 0.6 * treble + 2.2 * glint;
  float aa = fwidth(q.x) * 1.2;
  vec3 col = vec3(0.0);
  float d;
  if (type < 1.5) {
    float h0 = vShape.y;
    float o = clamp(open, 0.0, 1.7);
    float h = max(h0 * o, 0.03);
    vec2 qq = q - vec2(0.0, -(1.0 - min(o, 1.0)) * h0 * 0.3);
    float R = (1.0 + h * h) / (2.0 * h);
    d = max(length(qq - vec2(0.0, h - R)), length(qq - vec2(0.0, R - h))) - R;
    // heavy brow: lid cut that dips toward the inner corner
    float inner = -sign(vShape.x);
    d = max(d, qq.y - (h0 * (0.7 + 0.8 * stare) * min(o, 1.0) - h0 * 0.3 * (1.0 - stare) * inner * qq.x + 0.02));
    float vis = smoothstep(0.02, 0.1, o);
    if (d < aa) {
      vec2 pq = qq - vLook;
      float rr = length(pq);
      vec3 iris = vCol * (0.3 + 1.3 * exp(-rr * rr * 2.2));
      float ang = atan(pq.y, pq.x);
      iris *= 0.72 + 0.28 * sin(ang * 23.0 + seed * 50.0) * sin(ang * 7.0 + rr * 14.0 + seed * 9.0);
      iris *= 0.35 + 0.65 * smoothstep(0.0, -0.3 * h, d); // dark rim
      iris *= 1.0 - 0.55 * smoothstep(-0.3 * h, h, qq.y); // shadow under the upper lid
      float pd;
      if (type < 0.5) {
        float pw = mix(0.06, 0.4, dil);
        pd = length(vec2(pq.x / pw, pq.y / (h0 * 1.1))) - 1.0;
        pd *= pw * 4.0;
      } else {
        vec2 b = abs(pq) - vec2(0.42, mix(0.05, 0.16, dil));
        pd = (length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.05) * 3.0;
      }
      float pupil = smoothstep(0.05 + aa, -0.05, pd);
      iris *= 1.0 - 0.97 * pupil;
      iris += vCol * 0.6 * exp(-abs(pd) * 18.0) * (1.0 - pupil); // hot ring around the pupil
      vec2 sp = qq - vec2(-0.32, h * 0.32);
      iris += vec3(1.0, 0.95, 0.85) * exp(-dot(sp, sp) * 90.0) * spec;
      col = iris * smoothstep(aa, -aa, d) * vis;
    }
    // hi-hat glint: a tiny four-point star off the wet highlight
    vec2 gs = abs(qq - vec2(-0.32, h * 0.32));
    col += vec3(1.0, 0.97, 0.9) * glint * vis * min(o, 1.0) * 0.55 *
      (exp(-gs.y * 40.0 - gs.x * 3.2) + exp(-gs.x * 40.0 - gs.y * 3.2));
    col += vCol * 0.07 * (1.0 - 0.6 * stare) * exp(-max(d, 0.0) * 2.4) * smoothstep(${EXT.toFixed(1)}, 1.5, length(q)) * vis;
  } else {
    // spider: glassy orb with eyeshine
    float r = length(q);
    d = r - 1.0;
    if (d < aa) {
      float n = sqrt(max(1.0 - r * r, 0.0));
      vec3 c = vCol * (0.02 + 0.35 * pow(1.0 - n, 3.0)) + vCol * 0.9 * exp(-dot(q - vec2(0.12, -0.25), q - vec2(0.12, -0.25)) * 6.0);
      vec2 sp = q - vec2(-0.35, 0.38);
      c += vec3(1.0, 0.95, 0.9) * exp(-dot(sp, sp) * 40.0) * 1.4 * spec / 0.9;
      col = c * smoothstep(aa, -aa, d);
    }
    vec2 gs = abs(q - vec2(-0.35, 0.38));
    col += vec3(1.0, 0.97, 0.9) * glint * 0.5 * (exp(-gs.y * 30.0 - gs.x * 2.6) + exp(-gs.x * 30.0 - gs.y * 2.6));
    col += vCol * 0.05 * exp(-max(d, 0.0) * 2.0) * smoothstep(${EXT.toFixed(1)}, 1.5, r);
  }
  gl_FragColor = vec4(col * bright, 1.0);
}`;

/** 16. A pitch-black forest full of glowing creature eyes that blink, track and stare. */
export class EyesInTheDarkVisual extends Visual {
  readonly name = 'Eyes in the Dark';
  bloom = 0.85;
  private quad!: THREE.Mesh;
  private bgU!: Record<string, THREE.IUniform>;
  private eyeU!: Record<string, THREE.IUniform>;
  private treeMats: THREE.ShaderMaterial[] = [];
  private meshes: THREE.Mesh[] = [];
  private geos: THREE.InstancedBufferGeometry[] = [];
  private groups: Group[] = [];
  private pos = new Float32Array(MAX_EYES * 4);
  private shape = new Float32Array(MAX_EYES * 4);
  private state = new Float32Array(MAX_EYES * 4);
  private slot = new Float32Array(MAX_EYES);
  private glint = new Float32Array(MAX_EYES);
  private pal: THREE.Color[] = Array.from({ length: SLOTS + 1 }, () => new THREE.Color());
  private fog = new THREE.Color();
  private mood = 0;
  private moodFrom = 0;
  private moodMix = 1;
  private moodSpeed = 0.35;
  private beatsInMood = 0;
  private posAttr!: THREE.InstancedBufferAttribute;
  private stateAttr!: THREE.InstancedBufferAttribute;
  private count = 0;
  private stare = 0;
  private stareTimer = 0;
  private reveal = 0;
  private level = 0;
  private glow = 0;
  private rng = mulberry32(99);

  protected setup() {
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
    this.applyMood(0.5);
    this.bgU = { time: { value: 0 }, aspect: { value: 1 }, pan: { value: 0 }, dropPulse: { value: 0 }, glow: { value: 0 }, uFog: { value: this.fog } };
    this.quad = fullscreenQuad(BG_FRAG, this.bgU);
    this.scene.add(this.quad);

    this.buildGroups();

    // two eye layers (far / mid+near) with a tree layer between them
    const base = new THREE.PlaneGeometry(2, 2);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.stateAttr = new THREE.InstancedBufferAttribute(this.state, 4).setUsage(THREE.DynamicDrawUsage);
    const shapeAttr = new THREE.InstancedBufferAttribute(this.shape, 4);
    const slotAttr = new THREE.InstancedBufferAttribute(this.slot, 1);
    this.eyeU = {
      uPal: { value: this.pal },
      treble: { value: 0 },
      aspect: { value: 1 },
      time: { value: 0 },
      stare: { value: 0 },
      pan: { value: 0 },
      target: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: EYE_VERT,
      fragmentShader: EYE_FRAG,
      uniforms: this.eyeU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // eyes are sorted far-first in buildGroups; split the draw range at the first non-far eye
    let split = 0;
    for (const g of this.groups) if (g.layer === 0) split += g.eyes.length;
    const ranges: [number, number][] = [
      [split, 1],
      [this.count - split, 3],
    ];
    for (const [n, order] of ranges) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('aPos', this.posAttr);
      geo.setAttribute('aShape', shapeAttr);
      geo.setAttribute('aState', this.stateAttr);
      geo.setAttribute('aSlot', slotAttr);
      geo.instanceCount = n;
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = order;
      this.meshes.push(m);
      this.scene.add(m);
    }
    this.fixRanges(split);

    const addTrees = (fg: boolean, order: number) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: TREE_FRAG,
        uniforms: {
          map: { value: treeCanvas(fg) },
          pan: { value: 0 },
          aspect: { value: 1 },
          parallax: { value: fg ? 2.2 : 0.8 },
          tone: { value: fg ? 1.0 : 0.92 },
          time: { value: 0 },
          glow: { value: 0 },
          mist: { value: fg ? 1.0 : 0.0 },
          uFog: { value: this.fog },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.treeMats.push(m);
      this.scene.add(mesh);
    };
    addTrees(false, 2);
    addTrees(true, 4);
  }

  /** Give the second (mid/near) geometry its own attribute views starting at `split`. */
  private fixRanges(split: number) {
    const geo = this.geos[1];
    const sub = (arr: Float32Array, size: number, usage: boolean) => {
      const a = new THREE.InstancedBufferAttribute(arr.subarray(split * size), size);
      if (usage) a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.farMidAttrs = [sub(this.pos, 4, true), sub(this.state, 4, true)];
    geo.setAttribute('aPos', this.farMidAttrs[0]);
    geo.setAttribute('aState', this.farMidAttrs[1]);
    geo.setAttribute('aShape', sub(this.shape, 4, false));
    geo.setAttribute('aSlot', sub(this.slot, 1, false));
  }
  private farMidAttrs: THREE.InstancedBufferAttribute[] = [];

  private buildGroups() {
    const rng = mulberry32(2024);
    const placed: { x: number; y: number; r: number; l: number }[] = [];
    const tryPlace = (r: number, l: number, yMin: number, yMax: number, aspect = 1.78) => {
      for (let k = 0; k < 60; k++) {
        const x = (rng() - 0.5) * 0.92;
        const y = yMin + rng() * (yMax - yMin);
        let ok = true;
        for (const p of placed) {
          const dx = (p.x - x) * aspect;
          const rr = (p.r + r) * (p.l === l ? 1 : 0.45);
          if (dx * dx + (p.y - y) ** 2 < rr * rr) {
            ok = false;
            break;
          }
        }
        if (ok) {
          placed.push({ x, y, r, l });
          return { x, y };
        }
      }
      return null;
    };
    const specs: { layer: number; n: number; sMin: number; sMax: number }[] = [
      { layer: 2, n: 12, sMin: 0.035, sMax: 0.055 },
      { layer: 1, n: 40, sMin: 0.016, sMax: 0.026 },
      { layer: 0, n: 70, sMin: 0.008, sMax: 0.013 },
    ];
    const groups: Group[] = [];
    for (const spec of specs) {
      for (let i = 0; i < spec.n; i++) {
        const size = spec.sMin + rng() * (spec.sMax - spec.sMin);
        const spider = spec.layer > 0 && i < (spec.layer === 2 ? 1 : 3);
        const spacing = spider ? 1.9 : 1.75 + rng() * 0.6;
        const yMax = spec.layer === 0 ? 0.28 : 0.22;
        const at = tryPlace(size * (spacing + 1.2), spec.layer, -0.4, yMax);
        if (!at) continue;
        const g: Group = {
          eyes: [],
          offs: [],
          sizes: [],
          layer: spec.layer,
          bx: at.x,
          by: at.y,
          size,
          depth: [1, 0.5, 0][spec.layer],
          band: Math.max(1, Math.min(52, Math.floor((at.x + 0.5) * 46 + 2 + (rng() - 0.5) * 8))),
          hidden: !spider && rng() < 0.22,
          type: spider ? 2 : rng() < 0.22 ? 1 : 0,
          seed: rng(),
          open: 0,
          bright: 0,
          energy: 0,
          blinkStart: -10,
          nextBlink: rng() * 6,
          flare: 0,
        };
        if (spider) {
          const s = size * 0.42;
          const layout = [
            [-0.55, 0, 0.5],
            [0.55, 0, 0.5],
            [-1.35, 0.3, 0.28],
            [1.35, 0.3, 0.28],
            [-0.85, 0.95, 0.22],
            [0.85, 0.95, 0.22],
            [-0.28, 0.82, 0.15],
            [0.28, 0.82, 0.15],
          ];
          for (const [ox, oy, r] of layout) {
            g.offs.push(ox * s * 2, oy * s * 2);
            g.sizes.push(r * s * 2);
          }
        } else {
          g.offs.push(-size * spacing, 0, size * spacing, 0);
          g.sizes.push(size, size);
        }
        groups.push(g);
      }
    }
    // far layer first so it can be drawn behind the distant trees
    groups.sort((a, b) => a.layer - b.layer);
    let idx = 0;
    for (const g of groups) {
      const c = Math.floor(rng() * SLOTS);
      const tilt = 0.12 + rng() * 0.22;
      const h = g.type === 1 ? 0.55 : 0.42 + rng() * 0.16;
      for (let e = 0; e < g.sizes.length; e++) {
        if (idx >= MAX_EYES) break;
        g.eyes.push(idx);
        const left = g.offs[e * 2] < 0;
        this.shape[idx * 4] = g.type === 2 ? 0.001 : left ? -tilt : tilt;
        this.shape[idx * 4 + 1] = h;
        this.shape[idx * 4 + 2] = g.type;
        this.shape[idx * 4 + 3] = g.seed + e * 0.137;
        this.slot[idx] = g.type === 2 ? SLOTS : c;
        idx++;
      }
    }
    this.count = idx;
    this.groups = groups;
  }

  onEnter() {
    this.stare = 0;
    this.stareTimer = 0;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    const aspect = this.width / this.height;
    this.level = damp(this.level, audio.level, 3, dt);
    this.updateMood(dt, audio);

    // a mid hit: a few creatures suddenly notice you (hidden ones peek out)
    if (audio.midHit && this.stareTimer <= 0) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) this.groups[Math.floor(Math.random() * this.groups.length)].flare = 1;
    }
    // hi-hats catch the wet highlight on a scatter of eyes
    if (audio.trebleHit) {
      for (let i = 0; i < this.count; i++) if (Math.random() < 0.2) this.glint[i] = 1;
    }
    const glintDecay = Math.exp(-dt * 9);
    if (audio.drop) {
      this.stareTimer = 3.2;
      for (const g of this.groups) {
        g.blinkStart = -10;
        g.nextBlink = time + 3.2 + Math.random() * 2;
      }
    }
    this.stareTimer = Math.max(0, this.stareTimer - dt);
    const stareT = this.stareTimer > 0 ? 1 : 0;
    this.stare = damp(this.stare, stareT, stareT > this.stare ? 25 : 2.5, dt);
    this.reveal = damp(this.reveal, Math.max(stareT, smoothstep(0.55, 0.85, this.level)), 3, dt);

    // a beat sends a wave of blinks across a patch of the forest
    if (audio.beat && this.stareTimer <= 0 && Math.random() < 0.8) {
      const cx = Math.random() - 0.5;
      const reach = 0.18 + Math.random() * 0.25;
      for (const g of this.groups) {
        const dist = Math.abs(g.bx - cx);
        if (dist < reach && time - g.blinkStart > 0.3) g.blinkStart = time + dist * 0.6;
      }
    }

    let glowSum = 0;
    for (const g of this.groups) {
      g.energy = damp(g.energy, audio.bands[g.band], 12, dt);
      const e = smoothstep(0.05, 0.45, g.energy);
      g.flare = Math.max(0, g.flare - dt * 2.4);
      const fl = g.flare * g.flare;
      const vis = g.hidden ? Math.max(this.reveal, fl) : 1;
      let openT = (0.3 + 0.75 * e + 0.55 * fl) * vis;
      let brightT = (0.4 + 0.9 * e + audio.beatPulse * 0.15 + 1.1 * fl) * vis;
      openT = lerp(openT, g.type === 1 ? 1.25 : 1.4, this.stare);
      brightT = lerp(brightT, 0.62, this.stare);
      g.open = damp(g.open, openT, this.stare > 0.5 ? 18 : 9, dt);
      g.bright = damp(g.bright, brightT, 8, dt);

      // blinking
      if (time >= g.nextBlink && time - g.blinkStart > 0.3) {
        g.blinkStart = time;
        g.nextBlink = time + 1.8 + Math.random() * 6;
      }
      const bp = (time - g.blinkStart) / 0.22;
      let lid = bp >= 0 && bp < 1 ? 1 - Math.sin(Math.PI * bp) : 1;
      if (bp >= 0.5 && bp < 0.55 && !g.hidden && g.layer === 0 && this.rng() < 0.08) {
        // vanish and reappear elsewhere while the lids are shut
        g.bx = (this.rng() - 0.5) * 0.9;
        g.by = -0.36 + this.rng() * 0.62;
      }
      lid = Math.max(0, lid);
      const fogDim = 1 - g.depth * 0.3;
      const dil = lerp(lerp(0.35 + e * 0.45, 0.0, fl), 0.05, this.stare);
      const sway = 0.004 + (2 - g.layer) * 0.0015;
      const sx = Math.sin(time * 0.31 + g.seed * 20) * sway;
      const sy = Math.sin(time * 0.23 + g.seed * 31) * sway * 0.5;
      for (let k = 0; k < g.eyes.length; k++) {
        const i = g.eyes[k];
        this.pos[i * 4] = g.bx + sx + g.offs[k * 2] / aspect;
        this.pos[i * 4 + 1] = g.by + sy + g.offs[k * 2 + 1];
        this.pos[i * 4 + 2] = g.sizes[k] * (1 + this.stare * 0.25);
        this.pos[i * 4 + 3] = g.depth;
        this.state[i * 4] = g.type === 2 ? 1 : g.open * lid;
        this.state[i * 4 + 1] = g.bright * fogDim * (g.type === 2 ? 0.4 + 0.6 * lid : 1);
        this.state[i * 4 + 2] = dil;
        this.glint[i] *= glintDecay;
        this.state[i * 4 + 3] = this.glint[i];
      }
      glowSum += g.bright * g.open * (g.layer + 1);
    }
    this.posAttr.needsUpdate = true;
    this.stateAttr.needsUpdate = true;
    for (const a of this.farMidAttrs) a.needsUpdate = true;
    this.glow = damp(this.glow, Math.min(1, glowSum / (this.groups.length * 1.6)), 4, dt);
    this.bloom = 0.85 - 0.35 * this.stare;

    const pan = Math.sin(time * 0.045) * 0.035 + Math.sin(time * 0.11) * 0.01;
    this.bgU.time.value = time;
    this.bgU.pan.value = pan;
    this.bgU.dropPulse.value = audio.dropPulse;
    this.bgU.glow.value = this.glow;
    this.eyeU.time.value = time;
    this.eyeU.pan.value = pan;
    this.eyeU.stare.value = this.stare;
    this.eyeU.treble.value = audio.treble;
    (this.eyeU.target.value as THREE.Vector2).set(
      0.32 * Math.sin(time * 0.21) + 0.12 * Math.sin(time * 0.57 + 1.3),
      0.18 * Math.sin(time * 0.29 + 0.7) - 0.05 + 0.08 * Math.sin(time * 0.71),
    );
    for (const m of this.treeMats) {
      m.uniforms.pan.value = pan;
      m.uniforms.time.value = time;
      m.uniforms.glow.value = this.glow;
    }
  }

  private applyMood(brightness: number) {
    const m = this.moodMix * this.moodMix * (3 - 2 * this.moodMix);
    const a = MOODS[this.moodFrom], b = MOODS[this.mood];
    // airy music nudges every iris hue one way, dark bassy music the other
    const h = (brightness - 0.5) * 0.08;
    for (let k = 0; k <= SLOTS; k++) this.pal[k].copy(a.iris[k]).lerp(b.iris[k], m).offsetHSL(h, 0, 0);
    this.fog.copy(a.fog).lerp(b.fog, m);
  }

  private updateMood(dt: number, audio: AudioFeatures) {
    if (audio.beat) this.beatsInMood++;
    if (audio.drop || this.beatsInMood >= 32) {
      this.moodFrom = this.mood;
      this.mood = (this.mood + 1 + (audio.drop ? Math.floor(Math.random() * 2) : 0)) % MOODS.length;
      this.moodMix = 0;
      this.moodSpeed = audio.drop ? 2.5 : 0.35;
      this.beatsInMood = 0;
    }
    this.moodMix = Math.min(1, this.moodMix + dt * this.moodSpeed);
    this.applyMood(audio.brightness);
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    const a = w / h;
    const cam = this.camera as THREE.OrthographicCamera;
    cam.left = -a / 2;
    cam.right = a / 2;
    cam.top = 0.5;
    cam.bottom = -0.5;
    cam.updateProjectionMatrix();
    this.bgU.aspect.value = a;
    this.eyeU.aspect.value = a;
    for (const m of this.treeMats) m.uniforms.aspect.value = a;
  }
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
