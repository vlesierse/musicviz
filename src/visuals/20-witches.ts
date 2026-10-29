import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const FW = 512; // witch frame size
const FH = 256;
const FRAMES = 3;
const FLYERS = 8;
const FLOCK = 14;
const WITCHES = FLYERS + FLOCK;
const SPARKS = 4500;
const MOON = { x: 0.2, y: 0.12, r: 0.27 };
// broom tail in sprite-local units (sprite height = 1, width = 2)
const TAIL_X = -0.74;
const TAIL_Y = -0.2;

function rngFrom(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function drawWitch(ctx: CanvasRenderingContext2D, k: number, rnd: () => number) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ph = (k / FRAMES) * Math.PI * 2;
  // broom stick
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(100, 178);
  ctx.lineTo(478, 150);
  ctx.stroke();
  // bristles fanning out behind
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const ex = 12 + rnd() * 26 + Math.abs(t - 0.5) * 18;
    const ey = 148 + t * 70 + Math.sin(ph + t * 3) * 3;
    ctx.beginPath();
    ctx.moveTo(122, 177);
    ctx.quadraticCurveTo(80, 176 + (t - 0.5) * 18, ex, ey);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(118, 177, 7, 12, 0.1, 0, Math.PI * 2);
  ctx.fill();
  // cat riding on the tail of the broom
  ctx.beginPath();
  ctx.ellipse(168, 160, 17, 12, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(184, 143, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(177, 138);
  ctx.lineTo(178, 126);
  ctx.lineTo(185, 135);
  ctx.lineTo(190, 126);
  ctx.lineTo(192, 140);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(152, 162);
  ctx.bezierCurveTo(135, 160, 140 + Math.sin(ph) * 6, 135, 128 + Math.sin(ph + 1) * 8, 128);
  ctx.stroke();
  // cape streaming behind
  const amp = 9;
  ctx.beginPath();
  ctx.moveTo(270, 94);
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let x = 262; x >= 150; x -= 8) {
    const f = (262 - x) / 112;
    top.push([x, 94 + f * 2 + amp * f * Math.sin(f * 5 - ph * 1)]);
    bot.push([x, 150 - f * 18 + amp * 1.3 * f * Math.sin(f * 5 - ph + 0.9)]);
  }
  for (const [x, y] of top) ctx.lineTo(x, y);
  // ragged tail tips
  const [lx, ly] = top[top.length - 1];
  const [bx, by] = bot[bot.length - 1];
  ctx.lineTo(lx - 14, ly + 4);
  ctx.lineTo(lx + 4, (ly + by) / 2);
  ctx.lineTo(bx - 12, by + 2);
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.lineTo(240, 165);
  ctx.closePath();
  ctx.fill();
  // dress over the broom
  ctx.beginPath();
  ctx.moveTo(222, 160);
  ctx.lineTo(290, 152);
  ctx.lineTo(306, 192);
  ctx.quadraticCurveTo(290, 200, 276, 196);
  ctx.quadraticCurveTo(262, 206, 248, 198);
  ctx.quadraticCurveTo(232, 204, 222, 196);
  ctx.closePath();
  ctx.fill();
  // leg + pointy boot
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(290, 178);
  ctx.lineTo(326, 202);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(318, 194);
  ctx.lineTo(344, 196);
  ctx.quadraticCurveTo(356, 192, 360, 182);
  ctx.quadraticCurveTo(352, 205, 322, 210);
  ctx.closePath();
  ctx.fill();
  // torso leaning forward
  ctx.beginPath();
  ctx.moveTo(226, 162);
  ctx.lineTo(282, 158);
  ctx.quadraticCurveTo(294, 128, 288, 104);
  ctx.lineTo(262, 92);
  ctx.quadraticCurveTo(240, 110, 226, 162);
  ctx.fill();
  // arm reaching to the broom
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(280, 106);
  ctx.quadraticCurveTo(312, 120, 334, 150);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(338, 152, 7, 0, Math.PI * 2);
  ctx.fill();
  // hair streaming back
  ctx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    ctx.beginPath();
    ctx.moveTo(274, 72 + t * 14);
    ctx.bezierCurveTo(255, 78 + t * 20, 238, 90 + t * 26 + Math.sin(ph + t * 4) * 4, 214 + t * 10, 92 + t * 34 + Math.sin(ph + t * 3) * 7);
    ctx.stroke();
  }
  // head, hooked nose, pointed chin
  ctx.beginPath();
  ctx.arc(284, 82, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(294, 74);
  ctx.quadraticCurveTo(312, 80, 320, 92);
  ctx.quadraticCurveTo(306, 90, 296, 88);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(290, 92);
  ctx.quadraticCurveTo(300, 100, 308, 104);
  ctx.quadraticCurveTo(294, 104, 282, 96);
  ctx.fill();
  // hat: wide tilted brim + crooked cone flopping back
  ctx.beginPath();
  ctx.ellipse(284, 68, 46, 7, -0.12, 0, Math.PI * 2);
  ctx.fill();
  const tipX = 222 - Math.sin(ph) * 8;
  const tipY = 34 + Math.cos(ph) * 6;
  ctx.beginPath();
  ctx.moveTo(264, 68);
  ctx.bezierCurveTo(262, 50, 258, 34, 250, 24);
  ctx.quadraticCurveTo(238, 16, tipX, tipY);
  ctx.quadraticCurveTo(250, 8, 266, 18);
  ctx.bezierCurveTo(284, 30, 296, 48, 304, 64);
  ctx.closePath();
  ctx.fill();
}

function witchAtlas() {
  const c = document.createElement('canvas');
  c.width = FW;
  c.height = FH * FRAMES;
  const ctx = c.getContext('2d')!;
  for (let k = 0; k < FRAMES; k++) {
    ctx.save();
    ctx.translate(0, k * FH);
    ctx.beginPath();
    ctx.rect(0, 2, FW, FH - 4);
    ctx.clip();
    drawWitch(ctx, k, rngFrom(11));
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawTree(ctx: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, a: number, len: number, w: number, depth: number) {
  if (depth === 0 || w < 0.8) return;
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo((x + ex) / 2 + (rnd() - 0.5) * len * 0.4, (y + ey) / 2 + (rnd() - 0.5) * len * 0.3, ex, ey);
  ctx.stroke();
  const n = rnd() < 0.5 ? 2 : 3;
  for (let i = 0; i < n; i++) drawTree(ctx, rnd, ex, ey, a + (i / (n - 1) - 0.5) * 1.3 + (rnd() - 0.5) * 0.5, len * (0.62 + rnd() * 0.15), w * 0.6, depth - 1);
}

function villageTexture() {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rnd = rngFrom(77);
  const lit = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.shadowColor = 'rgba(255,140,30,0.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgb(255,170,60)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };
  // distant hills (hazy)
  ctx.fillStyle = 'rgb(30,12,38)';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 16) ctx.lineTo(x, 380 - 40 * Math.sin(x * 0.0021 + 1.2) - 18 * Math.sin(x * 0.007));
  ctx.lineTo(W, H);
  ctx.fill();
  // far village houses on the right
  const silo = 'rgb(9,4,14)';
  const house = (x: number, base: number, w: number, h: number, roof: number, lean: number) => {
    ctx.fillStyle = silo;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x + lean, base - h);
    ctx.lineTo(x + w / 2 + lean * 1.5, base - h - roof);
    ctx.lineTo(x + w + lean, base - h);
    ctx.lineTo(x + w, base);
    ctx.fill();
    ctx.fillRect(x + w * 0.7 + lean, base - h - roof * 0.9, w * 0.12, roof * 0.6);
    const nw = Math.max(1, Math.floor(w / 26));
    for (let i = 0; i < nw; i++) if (rnd() < 0.6) lit(x + 8 + i * 24 + lean * 0.5, base - h * 0.7, 9, 12);
  };
  // near hill with the crooked house
  ctx.fillStyle = silo;
  ctx.beginPath();
  ctx.moveTo(0, H);
  const hill = (x: number) => 470 - 210 * Math.exp(-(((x - 640) / 380) ** 2)) - 60 * Math.exp(-(((x - 1700) / 300) ** 2)) - 6 * Math.sin(x * 0.03);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, hill(x));
  ctx.lineTo(W, H);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const x = 1240 + i * 88 + rnd() * 20;
    house(x, hill(x) + 6, 56 + rnd() * 30, 40 + rnd() * 30, 26 + rnd() * 18, (rnd() - 0.5) * 10);
  }
  // church with a spire
  {
    const x = 1620;
    const b = hill(x) + 4;
    ctx.fillStyle = silo;
    ctx.fillRect(x, b - 80, 70, 80);
    ctx.beginPath();
    ctx.moveTo(x - 6, b - 80);
    ctx.lineTo(x + 35, b - 118);
    ctx.lineTo(x + 76, b - 80);
    ctx.fill();
    ctx.fillRect(x + 50, b - 150, 26, 70);
    ctx.beginPath();
    ctx.moveTo(x + 46, b - 150);
    ctx.lineTo(x + 63, b - 230);
    ctx.lineTo(x + 80, b - 150);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = silo;
    ctx.beginPath();
    ctx.moveTo(x + 63, b - 230);
    ctx.lineTo(x + 63, b - 252);
    ctx.moveTo(x + 55, b - 244);
    ctx.lineTo(x + 71, b - 244);
    ctx.stroke();
    lit(x + 58, b - 135, 10, 18);
    lit(x + 14, b - 60, 10, 22);
    lit(x + 34, b - 60, 10, 22);
  }
  // crooked haunted house on the hilltop
  {
    const cx = 640;
    const b = hill(cx) + 10;
    ctx.fillStyle = silo;
    ctx.beginPath();
    ctx.moveTo(cx - 110, b);
    ctx.lineTo(cx - 98, b - 120);
    ctx.lineTo(cx + 92, b - 132);
    ctx.lineTo(cx + 104, b);
    ctx.fill();
    // sagging main roof
    ctx.beginPath();
    ctx.moveTo(cx - 122, b - 116);
    ctx.quadraticCurveTo(cx - 40, b - 200, cx - 6, b - 230);
    ctx.quadraticCurveTo(cx + 50, b - 190, cx + 112, b - 128);
    ctx.fill();
    // leaning tower with witch-hat roof
    ctx.beginPath();
    ctx.moveTo(cx + 40, b - 120);
    ctx.lineTo(cx + 52, b - 260);
    ctx.lineTo(cx + 104, b - 254);
    ctx.lineTo(cx + 96, b - 120);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 40, b - 256);
    ctx.quadraticCurveTo(cx + 70, b - 300, cx + 98, b - 352);
    ctx.quadraticCurveTo(cx + 92, b - 300, cx + 116, b - 250);
    ctx.fill();
    // crooked chimney
    ctx.beginPath();
    ctx.moveTo(cx - 74, b - 160);
    ctx.lineTo(cx - 86, b - 222);
    ctx.lineTo(cx - 64, b - 226);
    ctx.lineTo(cx - 54, b - 172);
    ctx.fill();
    // dormer
    ctx.beginPath();
    ctx.moveTo(cx - 52, b - 160);
    ctx.lineTo(cx - 30, b - 196);
    ctx.lineTo(cx - 8, b - 160);
    ctx.fill();
    lit(cx - 36, b - 178, 12, 14);
    lit(cx - 76, b - 92, 18, 26);
    lit(cx - 30, b - 96, 18, 26);
    lit(cx + 62, b - 220, 12, 22);
    lit(cx + 64, b - 92, 16, 26);
    lit(cx + 8, b - 48, 20, 48);
    // window crossbars
    ctx.fillStyle = silo;
    for (const [x, y, w, h] of [
      [cx - 76, b - 92, 18, 26],
      [cx - 30, b - 96, 18, 26],
      [cx + 64, b - 92, 16, 26],
    ]) {
      ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
      ctx.fillRect(x, y + h / 2 - 1.5, w, 3);
    }
  }
  // dead tree on the slope
  ctx.strokeStyle = silo;
  ctx.lineCap = 'round';
  drawTree(ctx, rnd, 330, hill(330) + 10, -Math.PI / 2 - 0.15, 90, 22, 6);
  drawTree(ctx, rnd, 1050, hill(1050) + 10, -Math.PI / 2 + 0.2, 60, 14, 5);
  // fence and gravestones
  ctx.lineWidth = 4;
  for (let x = 820; x < 1010; x += 18) {
    const y = hill(x);
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + (rnd() - 0.5) * 6, y - 26 - rnd() * 6);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(820, hill(820) - 16);
  for (let x = 820; x < 1010; x += 18) ctx.lineTo(x, hill(x) - 16);
  ctx.stroke();
  ctx.fillStyle = silo;
  for (const x of [880, 925, 975, 200, 250]) {
    const y = hill(x);
    ctx.save();
    ctx.translate(x, y + 6);
    ctx.rotate((rnd() - 0.5) * 0.3);
    if (rnd() < 0.5) {
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-10, -26);
      ctx.arc(0, -26, 10, Math.PI, 0);
      ctx.lineTo(10, 0);
      ctx.fill();
    } else {
      ctx.fillRect(-3, -40, 6, 40);
      ctx.fillRect(-13, -30, 26, 6);
    }
    ctx.restore();
  }
  // glowing jack-o'-lanterns on the path
  for (const x of [520, 770]) {
    const y = hill(x) - 4;
    ctx.save();
    ctx.shadowColor = 'rgba(255,120,20,1)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgb(120,40,6)';
    ctx.beginPath();
    ctx.ellipse(x, y, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgb(255,190,70)';
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 4);
    ctx.lineTo(x - 4, y - 8);
    ctx.lineTo(x - 2, y - 2);
    ctx.moveTo(x + 9, y - 4);
    ctx.lineTo(x + 4, y - 8);
    ctx.lineTo(x + 2, y - 2);
    ctx.fill();
    ctx.fillRect(x - 8, y + 3, 16, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SKY_FRAG = /* glsl */ `
uniform float time, aspect, bass, treble, glow, drop;
varying vec2 vUv;
${GLSL_NOISE}
float fbm4(vec3 p) { float f = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; } return f; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  // purple night fading to a smouldering orange horizon
  vec3 col = mix(vec3(0.075, 0.02, 0.1), vec3(0.012, 0.005, 0.03), smoothstep(-0.25, 0.5, p.y));
  col = mix(col, vec3(0.32, 0.09, 0.03), smoothstep(-0.05, -0.45, p.y));
  // stars
  vec2 g = p * 70.0;
  vec2 cell = floor(g);
  float h = hash21(cell);
  if (h > 0.955) {
    vec2 sp = cell + 0.5 + (hash22(cell) - 0.5) * 0.6;
    float d = length(g - sp);
    float tw = 0.55 + 0.45 * sin(time * (2.0 + h * 6.0) + h * 60.0);
    tw = mix(tw, tw * tw * 1.8, treble);
    col += vec3(0.85, 0.85, 1.0) * exp(-d * d * 22.0) * tw * (0.25 + 0.6 * fract(h * 37.0)) * smoothstep(-0.2, 0.15, p.y);
  }
  // huge full moon
  vec2 mc = vec2(${MOON.x.toFixed(2)}, ${MOON.y.toFixed(2)});
  float R = ${MOON.r.toFixed(2)} * (1.0 + bass * 0.015);
  vec2 mq = p - mc;
  float md = length(mq);
  vec3 moonC = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.55, 0.2), drop * 0.5);
  col += moonC * (0.05 + 0.1 * glow) * exp(-max(md - R, 0.0) * 4.0);
  col += moonC * 0.06 * glow * exp(-max(md - R, 0.0) * 16.0);
  if (md < R + 0.01) {
    vec2 mu = mq / R;
    float n = fbm4(vec3(mu * 2.6, 3.0));
    float mare = smoothstep(-0.1, 0.4, n);
    float crater = smoothstep(0.55, 0.7, snoise(vec3(mu * 9.0, 1.0))) * 0.12;
    float limb = sqrt(max(1.0 - dot(mu, mu), 0.0));
    vec3 surf = moonC * (0.62 - 0.17 * mare - crater) * (0.72 + 0.28 * limb);
    col = mix(col, surf, smoothstep(R + 0.002, R - 0.002, md));
  }
  // drifting clouds, lit from behind by the moon
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 cp = p * vec2(1.3, 3.6) + vec2(time * (0.012 + fi * 0.01) + fi * 7.3, fi * 2.1);
    float n = fbm4(vec3(cp, time * 0.01 + fi));
    float band = smoothstep(0.12, -0.05, abs(p.y - (0.2 - fi * 0.38)) - 0.06);
    float c = smoothstep(0.0, 0.45, n + 0.25 * band - 0.15) * (0.55 + 0.45 * band);
    vec3 cc = mix(vec3(0.03, 0.01, 0.05), vec3(0.11, 0.035, 0.05), smoothstep(0.1, -0.4, p.y));
    cc += moonC * 0.45 * exp(-md * 3.5) * smoothstep(0.15, 0.6, n);
    col = mix(col, cc, c * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** 20. Witches on broomsticks streak across a giant moon, trailing magic sparkles. */
export class WitchFlightVisual extends Visual {
  readonly name = "Witches' Flight";
  bloom = 0.65;
  private quad!: THREE.Mesh;
  private skyU!: Record<string, THREE.IUniform>;
  private village!: THREE.Mesh;
  private witchMesh!: THREE.Mesh;
  private wPos = new Float32Array(WITCHES * 4);
  private wAnim = new Float32Array(WITCHES * 4);
  private wPosAttr!: THREE.InstancedBufferAttribute;
  private wAnimAttr!: THREE.InstancedBufferAttribute;
  private witchU!: Record<string, THREE.IUniform>;
  // flyer state
  private fx = new Float32Array(WITCHES);
  private fy = new Float32Array(WITCHES);
  private fvx = new Float32Array(WITCHES);
  private fvy = new Float32Array(WITCHES);
  private fsize = new Float32Array(WITCHES);
  private fdir = new Float32Array(WITCHES);
  private fphase = new Float32Array(WITCHES);
  private fbaseY = new Float32Array(WITCHES);
  private fspark = new Float32Array(WITCHES);
  private tailX = new Float32Array(WITCHES);
  private tailY = new Float32Array(WITCHES);
  // sparks
  private sPos = new Float32Array(SPARKS * 3);
  private sVel = new Float32Array(SPARKS * 2);
  private sLife = new Float32Array(SPARKS);
  private sMax = new Float32Array(SPARKS);
  private sBase = new Float32Array(SPARKS * 3);
  private sCol = new Float32Array(SPARKS * 4);
  private sSize = new Float32Array(SPARKS);
  private sPosAttr!: THREE.BufferAttribute;
  private sColAttr!: THREE.BufferAttribute;
  private sSizeAttr!: THREE.BufferAttribute;
  private sparkU!: Record<string, THREE.IUniform>;
  private sHead = 0;
  private speed = 1;
  private glow = 0;
  private swoopT = -1;
  private swoopDir = 1;

  protected setup() {
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
    this.skyU = { time: { value: 0 }, aspect: { value: 1 }, bass: { value: 0 }, treble: { value: 0 }, glow: { value: 0 }, drop: { value: 0 } };
    this.quad = fullscreenQuad(SKY_FRAG, this.skyU);
    this.scene.add(this.quad);

    // witches behind the village (far flyers) use the same mesh; the village is drawn in between via renderOrder
    this.village = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: villageTexture(), transparent: true, depthTest: false, depthWrite: false }),
    );
    this.village.renderOrder = 1;
    this.scene.add(this.village);

    // sparkles
    const sg = new THREE.BufferGeometry();
    this.sPosAttr = new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sColAttr = new THREE.BufferAttribute(this.sCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.sSizeAttr = new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.sPosAttr);
    sg.setAttribute('aCol', this.sColAttr);
    sg.setAttribute('aSize', this.sSizeAttr);
    this.sparkU = { scale: { value: 720 }, time: { value: 0 }, treble: { value: 0 } };
    const sparks = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: this.sparkU,
        vertexShader: /* glsl */ `
          attribute vec4 aCol;
          attribute float aSize;
          uniform float scale;
          varying vec4 vCol;
          void main() {
            vCol = aCol;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
            gl_PointSize = aSize * scale;
            if (aCol.a <= 0.0) gl_PointSize = 0.0;
          }`,
        fragmentShader: /* glsl */ `
          uniform float time, treble;
          varying vec4 vCol;
          void main() {
            vec2 q = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(q, q);
            if (r2 > 1.0) discard;
            float core = exp(-r2 * 30.0);
            float halo = exp(-r2 * 6.0) * 0.25;
            float tw = 0.5 + 0.5 * sin(time * 17.0 + vCol.a * 400.0);
            float cross = (exp(-abs(q.x) * 28.0) * exp(-abs(q.y) * 2.5) + exp(-abs(q.y) * 28.0) * exp(-abs(q.x) * 2.5)) * (0.35 + 0.9 * treble * tw);
            float i = core + halo + cross * 0.6;
            gl_FragColor = vec4(vCol.rgb * i * (0.75 + 0.5 * tw * treble), 1.0);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sparks.frustumCulled = false;
    sparks.renderOrder = 2;
    this.scene.add(sparks);

    // witches
    const base = new THREE.PlaneGeometry(2, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.wPosAttr = new THREE.InstancedBufferAttribute(this.wPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.wAnimAttr = new THREE.InstancedBufferAttribute(this.wAnim, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.wPosAttr);
    geo.setAttribute('aAnim', this.wAnimAttr);
    geo.instanceCount = WITCHES;
    this.witchU = { atlas: { value: witchAtlas() }, moon: { value: new THREE.Vector2(MOON.x, MOON.y) } };
    this.witchMesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.witchU,
        vertexShader: /* glsl */ `
          attribute vec4 aPos;  // x, y, size, dir
          attribute vec4 aAnim; // frame, angle, haze, alpha
          uniform vec2 moon;
          varying vec2 vUv;
          varying vec2 vLight;
          varying vec4 vAnim;
          void main() {
            vec2 l = position.xy * aPos.z;
            l.x *= aPos.w;
            float c = cos(aAnim.y), s = sin(aAnim.y);
            vec2 w = vec2(c * l.x - s * l.y, s * l.x + c * l.y) + aPos.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 0.0, 1.0);
            vec2 md = normalize(moon - aPos.xy);
            md = vec2(c * md.x + s * md.y, -s * md.x + c * md.y);
            md.x *= aPos.w;
            vLight = md * vec2(0.5, 1.0) * 0.012;
            vUv = uv;
            vAnim = aAnim;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D atlas;
          varying vec2 vUv;
          varying vec2 vLight;
          varying vec4 vAnim;
          vec2 fuv(vec2 uv) { return vec2(uv.x, (${FRAMES - 1}.0 - vAnim.x + clamp(uv.y, 0.01, 0.99)) / ${FRAMES}.0); }
          void main() {
            float a = texture2D(atlas, fuv(vUv)).a;
            if (a < 0.01) discard;
            float a2 = texture2D(atlas, fuv(vUv + vLight)).a;
            float rim = a * (1.0 - a2);
            vec3 col = mix(vec3(0.004, 0.002, 0.008), vec3(0.07, 0.035, 0.1), vAnim.z);
            col += vec3(1.0, 0.75, 0.45) * rim * 0.55;
            gl_FragColor = vec4(col * a, a * vAnim.w);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.witchMesh.frustumCulled = false;
    this.witchMesh.renderOrder = 3;
    this.scene.add(this.witchMesh);

    for (let i = 0; i < FLYERS; i++) this.spawnFlyer(i, true);
    for (let i = FLYERS; i < WITCHES; i++) this.wAnim[i * 4 + 3] = 0;
  }

  private spawnFlyer(i: number, anywhere: boolean) {
    const aspect = this.width / this.height || 16 / 9;
    const dir = Math.random() < 0.5 ? 1 : -1;
    // a few big ones, most small and distant
    const near = Math.random();
    const size = 0.06 + near * near * 0.13;
    this.fsize[i] = size;
    this.fdir[i] = dir;
    // bias paths across the moon
    const y = Math.random() < 0.45 ? MOON.y + (Math.random() - 0.5) * MOON.r * 1.4 : -0.08 + Math.random() * 0.5;
    this.fbaseY[i] = y;
    this.fx[i] = anywhere ? (Math.random() - 0.5) * aspect : -dir * (aspect / 2 + size * 1.2 + Math.random() * 0.4);
    this.fy[i] = y;
    this.fphase[i] = Math.random() * 100;
  }

  private emit(x: number, y: number, vx: number, vy: number, size: number, life: number) {
    const i = this.sHead;
    this.sHead = (this.sHead + 1) % SPARKS;
    this.sPos[i * 3] = x;
    this.sPos[i * 3 + 1] = y;
    this.sVel[i * 2] = vx;
    this.sVel[i * 2 + 1] = vy;
    this.sLife[i] = life;
    this.sMax[i] = life;
    this.sSize[i] = size;
    const r = Math.random();
    const c = r < 0.4 ? [0.25, 1.0, 0.18] : r < 0.75 ? [0.75, 0.22, 1.0] : [1.0, 0.45, 0.08];
    const k = 0.38;
    this.sBase[i * 3] = c[0] * k;
    this.sBase[i * 3 + 1] = c[1] * k;
    this.sBase[i * 3 + 2] = c[2] * k;
  }

  onEnter() {
    this.swoopT = -1;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    const aspect = this.width / this.height;
    this.speed = damp(this.speed, 0.5 + audio.level * 1.5, 2, dt);
    this.glow = damp(this.glow, audio.bass * 1.2 + audio.beatPulse * 0.3, 6, dt);

    if (audio.drop) {
      this.swoopT = 0;
      this.swoopDir = Math.random() < 0.5 ? 1 : -1;
    }

    // regular flyers
    for (let i = 0; i < FLYERS; i++) {
      const size = this.fsize[i];
      const dir = this.fdir[i];
      const v = (0.1 + size * 2.2) * this.speed;
      this.fphase[i] += dt * (0.6 + this.speed * 0.5);
      const ph = this.fphase[i];
      const vx = dir * v;
      const ny = this.fbaseY[i] + Math.sin(ph * 0.9) * 0.04 + Math.sin(ph * 0.37) * 0.05;
      const vy = (ny - this.fy[i]) / Math.max(dt, 1e-3);
      this.fx[i] += vx * dt;
      this.fy[i] = ny;
      this.fvx[i] = vx;
      this.fvy[i] = vy;
      if ((dir > 0 && this.fx[i] > aspect / 2 + size * 1.5) || (dir < 0 && this.fx[i] < -aspect / 2 - size * 1.5)) this.spawnFlyer(i, false);
      this.writeWitch(i, this.fx[i], this.fy[i], size, dir, vx, vy, ph * 3.2, 1 - Math.min(1, (size - 0.06) / 0.1), 1);
    }

    // drop: a flock swoops past right in front of the camera
    if (this.swoopT >= 0) {
      this.swoopT += dt / 3.2;
      if (this.swoopT > 1.8) this.swoopT = -1;
    }
    for (let j = 0; j < FLOCK; j++) {
      const i = FLYERS + j;
      if (this.swoopT < 0) {
        this.wAnim[i * 4 + 3] = 0;
        this.fspark[i] = 0;
        continue;
      }
      const rank = Math.floor((j + 1) / 2);
      const side = j % 2 ? 1 : -1;
      const t = this.swoopT - rank * 0.085 - (j % 3) * 0.02;
      const dir = this.swoopDir;
      const size = 0.08 + (1 - rank / 7) * 0.17 + (j === 0 ? 0.1 : 0);
      const span = aspect / 2 + size * 1.4;
      const x = dir * (-span + t * 2 * span) - dir * rank * 0.05;
      const y = 0.3 - 0.5 * Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI) + side * rank * 0.06 + 0.04 * Math.sin(time * 2 + j);
      const vx = dir * (2 * span) / 3.2;
      const vy = -0.55 * Math.PI * Math.cos(Math.min(Math.max(t, 0), 1) * Math.PI) / 3.2;
      const vis = t > -0.1 && t < 1.15 ? 1 : 0;
      this.fspark[i] = vis;
      this.writeWitch(i, x, y, size, dir, vx, vy, time * 9 + j, 0, vis);
    }
    this.wPosAttr.needsUpdate = true;
    this.wAnimAttr.needsUpdate = true;

    // sparkle emission from every broom tail
    for (let i = 0; i < WITCHES; i++) {
      const alpha = this.wAnim[i * 4 + 3];
      if (alpha <= 0) continue;
      const size = this.wPos[i * 4 + 2];
      const rate = (40 + size * 420) * (0.5 + this.speed * 0.6) * (i >= FLYERS ? 1.8 : 1);
      let n = rate * dt;
      if (audio.beat) n += 12 + size * 120;
      if (audio.drop) n += 40;
      const whole = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
      const vx = this.fvx[i];
      const vy = this.fvy[i];
      const burst = audio.beat ? 1 : 0;
      for (let k = 0; k < whole; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.01 + Math.random() * 0.04) * (1 + burst * 3 * Math.random()) * (0.5 + size * 6);
        this.emit(
          this.tailX[i] + (Math.random() - 0.5) * size * 0.15,
          this.tailY[i] + (Math.random() - 0.5) * size * 0.15,
          -vx * 0.12 + Math.cos(a) * sp,
          -vy * 0.05 + Math.sin(a) * sp,
          (0.007 + Math.random() * 0.012) * (0.6 + size * 5),
          0.8 + Math.random() * 1.8,
        );
      }
    }

    // integrate sparks
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < SPARKS; i++) {
      let life = this.sLife[i];
      if (life <= 0) {
        this.sCol[i * 4 + 3] = 0;
        continue;
      }
      life -= dt;
      this.sLife[i] = life;
      this.sVel[i * 2] *= drag;
      this.sVel[i * 2 + 1] = this.sVel[i * 2 + 1] * drag - 0.012 * dt;
      this.sPos[i * 3] += this.sVel[i * 2] * dt;
      this.sPos[i * 3 + 1] += this.sVel[i * 2 + 1] * dt;
      const f = Math.max(0, life / this.sMax[i]);
      const fade = f * Math.min(1, (1 - f) * 12);
      this.sCol[i * 4] = this.sBase[i * 3] * fade;
      this.sCol[i * 4 + 1] = this.sBase[i * 3 + 1] * fade;
      this.sCol[i * 4 + 2] = this.sBase[i * 3 + 2] * fade;
      this.sCol[i * 4 + 3] = life > 0 ? 0.001 + (i % 97) / 97 : 0;
    }
    this.sPosAttr.needsUpdate = true;
    this.sColAttr.needsUpdate = true;
    this.sSizeAttr.needsUpdate = true;

    this.skyU.time.value = time;
    this.skyU.bass.value = audio.bass;
    this.skyU.treble.value = audio.treble;
    this.skyU.glow.value = this.glow;
    this.skyU.drop.value = audio.dropPulse;
    this.sparkU.time.value = time;
    this.sparkU.treble.value = Math.min(1, audio.treble * 1.5);
  }

  private writeWitch(i: number, x: number, y: number, size: number, dir: number, vx: number, vy: number, flap: number, haze: number, alpha: number) {
    const ang = Math.max(-0.5, Math.min(0.5, dir > 0 ? Math.atan2(vy, vx) : Math.atan2(-vy, -vx)));
    this.wPos[i * 4] = x;
    this.wPos[i * 4 + 1] = y;
    this.wPos[i * 4 + 2] = size;
    this.wPos[i * 4 + 3] = dir;
    const f = Math.floor(flap) % 4;
    this.wAnim[i * 4] = f === 3 ? 1 : f;
    this.wAnim[i * 4 + 1] = ang;
    this.wAnim[i * 4 + 2] = haze;
    this.wAnim[i * 4 + 3] = alpha;
    this.fvx[i] = vx;
    this.fvy[i] = vy;
    const lx = TAIL_X * size * dir;
    const ly = TAIL_Y * size;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    this.tailX[i] = x + c * lx - s * ly;
    this.tailY[i] = y + s * lx + c * ly;
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    const a = w / h;
    const cam = this.camera as THREE.OrthographicCamera;
    cam.left = -a / 2;
    cam.right = a / 2;
    cam.updateProjectionMatrix();
    this.skyU.aspect.value = a;
    this.village.scale.set(a, a / 4, 1);
    this.village.position.set(0, -0.5 + a / 8, 0);
    this.sparkU.scale.value = h;
  }
}
