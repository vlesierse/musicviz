import * as THREE from 'three';

/** Procedural Halloween shapes drawn with Canvas2D: used for sprites and particle targets. */

type Draw = (ctx: CanvasRenderingContext2D, size: number) => void;

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

export function drawBat(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number) {
  const s = w / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.12);
  // right wing top edge
  ctx.quadraticCurveTo(cx + s * 0.35, cy - s * 0.45, cx + s * 1.0, cy - s * 0.3);
  // scalloped bottom edge
  ctx.quadraticCurveTo(cx + s * 0.82, cy - s * 0.12, cx + s * 0.84, cy + s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.66, cy - s * 0.02, cx + s * 0.55, cy + s * 0.14);
  ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.0, cx + s * 0.25, cy + s * 0.2);
  ctx.quadraticCurveTo(cx + s * 0.15, cy + s * 0.08, cx + s * 0.06, cy + s * 0.22);
  // body bottom
  ctx.lineTo(cx, cy + s * 0.3);
  ctx.lineTo(cx - s * 0.06, cy + s * 0.22);
  ctx.quadraticCurveTo(cx - s * 0.15, cy + s * 0.08, cx - s * 0.25, cy + s * 0.2);
  ctx.quadraticCurveTo(cx - s * 0.4, cy + s * 0.0, cx - s * 0.55, cy + s * 0.14);
  ctx.quadraticCurveTo(cx - s * 0.66, cy - s * 0.02, cx - s * 0.84, cy + s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.82, cy - s * 0.12, cx - s * 1.0, cy - s * 0.3);
  ctx.quadraticCurveTo(cx - s * 0.35, cy - s * 0.45, cx, cy - s * 0.12);
  ctx.fill();
  // head + ears
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.12, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy - s * 0.15);
  ctx.lineTo(cx - s * 0.08, cy - s * 0.32);
  ctx.lineTo(cx - s * 0.02, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.02, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.08, cy - s * 0.32);
  ctx.lineTo(cx + s * 0.1, cy - s * 0.15);
  ctx.fill();
}

export function drawPumpkin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, carve = true) {
  ctx.save();
  // ribs
  const ribs = [
    [0, 0.42, 0.95],
    [-0.38, 0.4, 0.9],
    [0.38, 0.4, 0.9],
    [-0.62, 0.32, 0.8],
    [0.62, 0.32, 0.8],
  ];
  for (const [dx, rx, ry] of ribs) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * r, cy + r * 0.08, rx * r, ry * r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // stem
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.08, cy - r * 0.62);
  ctx.quadraticCurveTo(cx - r * 0.05, cy - r * 0.9, cx + r * 0.12, cy - r * 1.0);
  ctx.lineTo(cx + r * 0.16, cy - r * 0.92);
  ctx.quadraticCurveTo(cx + r * 0.06, cy - r * 0.82, cx + r * 0.09, cy - r * 0.6);
  ctx.fill();
  if (carve) {
    ctx.globalCompositeOperation = 'destination-out';
    // eyes
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * r * 0.18, cy - r * 0.05);
      ctx.lineTo(cx + side * r * 0.52, cy - r * 0.05);
      ctx.lineTo(cx + side * r * 0.36, cy - r * 0.38);
      ctx.closePath();
      ctx.fill();
    }
    // nose
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.09, cy + r * 0.12);
    ctx.lineTo(cx + r * 0.09, cy + r * 0.12);
    ctx.lineTo(cx, cy - r * 0.02);
    ctx.closePath();
    ctx.fill();
    // jagged mouth
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.62, cy + r * 0.22);
    ctx.quadraticCurveTo(cx, cy + r * 0.42, cx + r * 0.62, cy + r * 0.22);
    ctx.quadraticCurveTo(cx + r * 0.45, cy + r * 0.62, cx, cy + r * 0.66);
    ctx.quadraticCurveTo(cx - r * 0.45, cy + r * 0.62, cx - r * 0.62, cy + r * 0.22);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // teeth
    for (const tx of [-0.28, 0.22]) {
      ctx.fillRect(cx + tx * r, cy + r * 0.28, r * 0.1, r * 0.13);
    }
    ctx.fillRect(cx - r * 0.04, cy + r * 0.5, r * 0.1, r * 0.17);
  }
  ctx.restore();
}

export function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.15, r * 0.78, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  // cheekbones + jaw
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy + r * 0.1);
  ctx.quadraticCurveTo(cx - r * 0.58, cy + r * 0.45, cx - r * 0.38, cy + r * 0.52);
  ctx.lineTo(cx - r * 0.36, cy + r * 0.85);
  ctx.quadraticCurveTo(cx, cy + r * 0.98, cx + r * 0.36, cy + r * 0.85);
  ctx.lineTo(cx + r * 0.38, cy + r * 0.52);
  ctx.quadraticCurveTo(cx + r * 0.58, cy + r * 0.45, cx + r * 0.62, cy + r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * r * 0.3, cy + r * 0.02, r * 0.2, r * 0.23, side * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.22);
  ctx.lineTo(cx - r * 0.09, cy + r * 0.42);
  ctx.lineTo(cx + r * 0.09, cy + r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = r * 0.035;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * r * 0.1, cy + r * 0.6);
    ctx.lineTo(cx + i * r * 0.1, cy + r * 0.85);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.36, cy + r * 0.72);
  ctx.lineTo(cx + r * 0.36, cy + r * 0.72);
  ctx.stroke();
  ctx.restore();
}

export function drawGhost(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, face = true) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy + r * 0.8);
  ctx.lineTo(cx - r * 0.6, cy - r * 0.1);
  ctx.arc(cx, cy - r * 0.1, r * 0.6, Math.PI, 0);
  ctx.lineTo(cx + r * 0.6, cy + r * 0.8);
  const waves = 4;
  for (let i = 0; i < waves; i++) {
    const x0 = cx + r * 0.6 - (i * 1.2 * r) / waves;
    const x1 = x0 - (1.2 * r) / waves;
    ctx.quadraticCurveTo((x0 + x1) / 2, cy + r * (i % 2 ? 0.95 : 0.6), x1, cy + r * 0.8);
  }
  ctx.closePath();
  ctx.fill();
  if (face) {
    ctx.globalCompositeOperation = 'destination-out';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * r * 0.22, cy - r * 0.12, r * 0.1, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.2, r * 0.12, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawText(text: string): Draw {
  return (ctx, size) => {
    ctx.font = `900 ${size * 0.4}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2, size * 0.95);
  };
}

export const SHAPES: Record<'pumpkin' | 'skull' | 'bat' | 'ghost', Draw> = {
  pumpkin: (ctx, s) => drawPumpkin(ctx, s / 2, s * 0.53, s * 0.42),
  skull: (ctx, s) => drawSkull(ctx, s / 2, s * 0.45, s * 0.45),
  bat: (ctx, s) => drawBat(ctx, s / 2, s / 2, s * 0.95),
  ghost: (ctx, s) => drawGhost(ctx, s / 2, s * 0.45, s * 0.5),
};

/**
 * Samples `count` points inside a drawn shape. Returns xyz positions in roughly [-1, 1]
 * with a bulging z so the shape has some volume.
 */
export function sampleShape(draw: Draw, count: number, depth = 0.25, size = 384): Float32Array {
  const c = canvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  draw(ctx, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const filled: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const out = new Float32Array(count * 3);
  const n = filled.length / 2;
  for (let i = 0; i < count; i++) {
    if (n === 0) break;
    const k = Math.floor(Math.random() * n) * 2;
    const x = ((filled[k] + Math.random()) / size) * 2 - 1;
    const y = 1 - ((filled[k + 1] + Math.random()) / size) * 2;
    const r2 = Math.min(1, x * x + y * y);
    const bulge = Math.sqrt(1 - r2);
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = (Math.random() * 2 - 1) * depth * (0.3 + bulge);
  }
  return out;
}

const textureCache = new Map<string, THREE.Texture>();

function cachedTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  let tex = textureCache.get(key);
  if (!tex) {
    const c = canvas(size);
    draw(c.getContext('2d')!, size);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    textureCache.set(key, tex);
  }
  return tex;
}

/** Soft round glow sprite (white). */
export const dotTexture = () =>
  cachedTexture('dot', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

export const batTexture = () =>
  cachedTexture('bat', 128, (ctx, s) => {
    ctx.fillStyle = '#fff';
    drawBat(ctx, s / 2, s / 2, s * 0.96);
  });

export const ghostTexture = () =>
  cachedTexture('ghost', 128, (ctx, s) => {
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = s * 0.08;
    ctx.fillStyle = '#fff';
    drawGhost(ctx, s / 2, s * 0.45, s * 0.42);
  });
