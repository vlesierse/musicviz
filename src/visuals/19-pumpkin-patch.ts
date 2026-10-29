import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { dotTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const COLS = 16;
const ROWS = 4;
const N = COLS * ROWS;
const EMBERS = 1600;
const WAVES = 4;
const HISTORY = 64;
const ARC_C = new THREE.Vector3(0, 0, 14);
const FOG_COLOR = new THREE.Color(0x0e0712);

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const heightAt = (x: number, z: number) =>
  1.7 * smooth(3.5, -4.5, z) + 0.12 * Math.sin(x * 0.5 + z * 0.3) + 2.0 * Math.exp(-((x - 3) ** 2 + (z + 13) ** 2) / 20);

/** Four carved expressions stacked vertically (v cells 0..3); face centred at u = 0.25 so it faces +z. */
function faceAtlas() {
  const W = 512, CH = 256;
  const make = (emissive: boolean) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = CH * 4;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = emissive ? '#000' : '#e2781a';
    ctx.fillRect(0, 0, W, CH * 4);
    for (let f = 0; f < 4; f++) {
      const top = (3 - f) * CH;
      if (!emissive) {
        for (let i = 0; i < 16; i++) {
          const g = ctx.createLinearGradient((i / 16) * W, 0, ((i + 1) / 16) * W, 0);
          g.addColorStop(0, 'rgba(70,20,0,0.55)');
          g.addColorStop(0.5, 'rgba(255,170,60,0.12)');
          g.addColorStop(1, 'rgba(70,20,0,0.55)');
          ctx.fillStyle = g;
          ctx.fillRect((i / 16) * W, top, W / 16, CH);
        }
      }
      ctx.fillStyle = emissive ? '#ffd27a' : '#2a0b00';
      const cx = W * 0.25, cy = top + CH * 0.52;
      ctx.beginPath();
      if (f === 0) {
        // classic: triangle eyes, triangle nose, toothy grin
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * 12, cy - 12);
          ctx.lineTo(cx + s * 46, cy - 12);
          ctx.lineTo(cx + s * 29, cy - 44);
          ctx.closePath();
        }
        ctx.moveTo(cx - 8, cy + 2);
        ctx.lineTo(cx + 8, cy + 2);
        ctx.lineTo(cx, cy - 10);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 52, cy + 12);
        ctx.quadraticCurveTo(cx, cy + 34, cx + 52, cy + 12);
        ctx.quadraticCurveTo(cx, cy + 64, cx - 52, cy + 12);
        ctx.fill();
        ctx.fillStyle = emissive ? '#000' : '#e2781a';
        ctx.fillRect(cx - 18, cy + 22, 12, 12);
        ctx.fillRect(cx + 8, cy + 26, 12, 14);
      } else if (f === 1) {
        // angry: slanted eyes, jagged mouth
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * 10, cy - 10);
          ctx.lineTo(cx + s * 50, cy - 30);
          ctx.lineTo(cx + s * 36, cy - 4);
          ctx.closePath();
        }
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 56, cy + 14);
        for (let k = 0; k <= 8; k++) ctx.lineTo(cx - 56 + k * 14, cy + (k % 2 ? 2 : 22));
        ctx.lineTo(cx + 56, cy + 30);
        for (let k = 8; k >= 0; k--) ctx.lineTo(cx - 56 + k * 14, cy + (k % 2 ? 52 : 38));
        ctx.closePath();
        ctx.fill();
      } else if (f === 2) {
        // cheeky: crescent eyes, wide smile
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * 50, cy - 18);
          ctx.quadraticCurveTo(cx + s * 30, cy - 52, cx + s * 10, cy - 18);
          ctx.quadraticCurveTo(cx + s * 30, cy - 34, cx + s * 50, cy - 18);
        }
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 60, cy - 2);
        ctx.quadraticCurveTo(cx, cy + 30, cx + 60, cy - 2);
        ctx.quadraticCurveTo(cx, cy + 70, cx - 60, cy - 2);
        ctx.fill();
      } else {
        // screaming: huge eyes, open mouth
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * 30 + 18, cy - 30);
          ctx.ellipse(cx + s * 30, cy - 30, 18, 24, s * 0.3, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 32, 28, 38, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(false), emissiveMap: make(true) };
}

function cornTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const rand = rng(55);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  for (let i = 0; i < 70; i++) {
    const x = rand() * 1024;
    const h = 120 + rand() * 120;
    const lean = (rand() - 0.5) * 30;
    ctx.lineWidth = 3 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.5, x + lean, 256 - h);
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const t = 0.25 + k * 0.12;
      const lx = x + lean * t * t;
      const ly = 256 - h * t;
      const s = k % 2 ? 1 : -1;
      const len = 30 + rand() * 30;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(lx + s * len * 0.6, ly - 18, lx + s * len, ly + 10 + rand() * 18);
      ctx.quadraticCurveTo(lx + s * len * 0.5, ly - 8, lx, ly + 4);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** 19. A field of jack-o'-lanterns acting as a spectrum equalizer. */
export class PumpkinPatchVisual extends Visual {
  readonly name = 'Pumpkin Patch EQ';
  bloom = 0.85;
  private sky!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moon!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private pumpkins!: THREE.InstancedMesh;
  private stems!: THREE.InstancedMesh;
  private flames!: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private faceAttr!: THREE.InstancedBufferAttribute;
  private glowAttr!: THREE.InstancedBufferAttribute;
  private flameAttr!: THREE.InstancedBufferAttribute;
  private base = new Float32Array(N * 4); // x, y, z, rotY
  private scaleBase = new Float32Array(N);
  private bias = new Float32Array(N);
  private level = new Float32Array(N);
  private history = new Float32Array(HISTORY * COLS);
  private histHead = 0;
  private histTimer = 0;
  private colLevel = new Float32Array(COLS);
  private waves = new Float32Array(WAVES).fill(-100);
  private waveAmp = new Float32Array(WAVES);
  private waveCursor = 0;
  private embers!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private ePos = new Float32Array(EMBERS * 3);
  private eVel = new Float32Array(EMBERS * 3);
  private eLife = new Float32Array(EMBERS);
  private eCursor = 0;
  private lights: THREE.PointLight[] = [];
  private fogLayers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private scarecrowEyes!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;
  private dropTime = -100;
  private dummy = new THREE.Object3D();
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private drift = 0;

  protected setup() {
    const rand = rng(9001);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.022);

    this.sky = fullscreenQuad(
      /* glsl */ `
      uniform float time, aspect, flash;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec3 col = mix(vec3(0.11, 0.035, 0.03), vec3(0.025, 0.008, 0.04), smoothstep(-0.25, 0.15, p.y));
        col = mix(col, vec3(0.004, 0.002, 0.014), smoothstep(0.1, 0.5, p.y));
        float n = fbm(vec3(p * vec2(1.2, 4.0) + vec2(time * 0.015, 0.0), time * 0.02));
        col += vec3(0.07, 0.025, 0.05) * smoothstep(0.1, 0.7, n) * smoothstep(-0.2, 0.25, p.y) * (1.0 - smoothstep(0.25, 0.5, p.y));
        vec2 sp = floor(vUv * vec2(aspect, 1.0) * 230.0);
        float h = hash21(sp);
        col += step(0.9972, h) * smoothstep(0.05, 0.45, p.y) * (0.5 + 0.4 * sin(time * 2.5 + h * 60.0));
        col += flash * vec3(0.25, 0.08, 0.02);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, aspect: { value: 1 }, flash: { value: 0 } },
    );
    this.scene.add(this.sky);

    // Harvest moon
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { glow: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float glow;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float disc = smoothstep(0.36, 0.355, r);
            float craters = fbm(vec3(p * 3.5, 2.0)) * 0.5 + 0.5;
            vec3 tint = vec3(1.0, 0.55, 0.22);
            vec3 moon = tint * (0.45 + 0.4 * craters) * (0.95 + 0.25 * (1.0 - r));
            float halo = exp(-max(r - 0.35, 0.0) * 5.0) * (0.22 + glow * 0.3);
            vec3 col = moon * disc + tint * halo * (1.0 - disc) * 0.5;
            gl_FragColor = vec4(col, max(disc, halo));
          }`,
      }),
    );
    this.moon.renderOrder = -500;
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0x4a3060, 0x0a0505, 0.45);
    this.scene.add(this.hemi);
    const moonLight = new THREE.DirectionalLight(0xffa860, 0.9);
    moonLight.position.set(10, 14, -90).normalize().multiplyScalar(50);
    this.scene.add(moonLight);

    // Ground
    const ground = new THREE.PlaneGeometry(160, 160, 120, 120);
    ground.rotateX(-Math.PI / 2);
    const gp = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)));
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 1 })));

    // Pumpkins
    const pg = new THREE.SphereGeometry(0.42, 40, 20);
    const pp = pg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const k = 1 - 0.07 * Math.abs(Math.sin(Math.atan2(z, x) * 6));
      const dent = y > 0 ? 1 - 0.25 * Math.pow(Math.max(0, 1 - Math.hypot(x, z) / 0.42), 2) : 1;
      pp.setXYZ(i, x * k, y * 0.74 * dent, z * k);
    }
    pg.computeVertexNormals();
    pg.translate(0, 0.31, 0);
    const faces = new Float32Array(N);
    const glows = new Float32Array(N);
    this.faceAttr = new THREE.InstancedBufferAttribute(faces, 1);
    this.glowAttr = new THREE.InstancedBufferAttribute(glows, 1);
    this.faceAttr.setUsage(THREE.DynamicDrawUsage);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aFace', this.faceAttr);
    pg.setAttribute('aGlow', this.glowAttr);
    const { map, emissiveMap } = faceAtlas();
    const mat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, roughness: 0.65 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFace;\nattribute float aGlow;\nvarying float vGlow;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vMapUv.y = (clamp(vMapUv.y, 0.02, 0.98) + aFace) * 0.25;
          vEmissiveMapUv.y = (clamp(vEmissiveMapUv.y, 0.02, 0.98) + aFace) * 0.25;
          vGlow = aGlow;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance *= vGlow;
          totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * 0.035 * vGlow;`,
        );
    };
    this.pumpkins = new THREE.InstancedMesh(pg, mat, N);
    this.pumpkins.frustumCulled = false;
    this.scene.add(this.pumpkins);

    const stemGeo = new THREE.CylinderGeometry(0.035, 0.06, 0.2, 6, 3);
    const sp = stemGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) + Math.pow(sp.getY(i) + 0.1, 2) * 1.2);
    stemGeo.computeVertexNormals();
    stemGeo.translate(0, 0.62, 0);
    this.stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x2e3a12, roughness: 0.9 }), N);
    this.stems.frustumCulled = false;
    this.scene.add(this.stems);

    for (let r = 0; r < ROWS; r++) {
      const R = 10 + r * 1.8;
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const th = (c / (COLS - 1) - 0.5) * 1.45 + (rand() - 0.5) * 0.02;
        const x = ARC_C.x + Math.sin(th) * R;
        const z = ARC_C.z - Math.cos(th) * R;
        this.base[i * 4] = x;
        this.base[i * 4 + 1] = heightAt(x, z) - 0.04;
        this.base[i * 4 + 2] = z;
        this.base[i * 4 + 3] = -th + (rand() - 0.5) * 0.25;
        this.scaleBase[i] = (0.95 + r * 0.14) * (0.88 + rand() * 0.22);
        this.bias[i] = rand() * 0.7;
        faces[i] = Math.floor(rand() * 2);
      }
    }

    // Flame billboards above every pumpkin
    const flameAmt = new Float32Array(N);
    this.flameAttr = new THREE.InstancedBufferAttribute(flameAmt, 1);
    this.flameAttr.setUsage(THREE.DynamicDrawUsage);
    const fg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    fg.setAttribute('aFlame', this.flameAttr);
    this.flames = new THREE.InstancedMesh(
      fg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uRight: { value: this.camRight }, uUp: { value: this.camUp } },
        vertexShader: /* glsl */ `
          uniform vec3 uRight, uUp;
          attribute float aFlame;
          varying vec2 vUv;
          varying float vAmt;
          varying float vSeed;
          void main() {
            vUv = uv;
            vAmt = aFlame;
            vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vSeed = c.x * 1.7 + c.z * 3.1;
            float w = 0.55 + aFlame * 0.35;
            float h = aFlame * 2.4;
            vec3 p = c.xyz + uRight * position.x * w + uUp * position.y * h;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying float vAmt;
          varying float vSeed;
          ${GLSL_NOISE}
          void main() {
            if (vAmt < 0.01) discard;
            vec2 p = vUv;
            float n = snoise(vec3(p.x * 4.0, p.y * 3.0 - uTime * 5.0, vSeed));
            float width = (1.0 - p.y) * 0.42 * (0.7 + 0.3 * n) * smoothstep(0.0, 0.12, p.y);
            float x = abs(p.x - 0.5 + n * 0.08 * p.y);
            float body = smoothstep(width, width * 0.3, x);
            float core = smoothstep(width * 0.5, 0.0, x) * (1.0 - p.y);
            vec3 col = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.75, 0.3), core) * (body * 1.2 + core * 1.6);
            gl_FragColor = vec4(col * 0.55 * min(vAmt * 1.5, 1.0), 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      N,
    );
    this.flames.frustumCulled = false;
    this.scene.add(this.flames);

    // Vines and leaves winding between the pumpkins
    const vines: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 18; v++) {
      const pts: THREE.Vector3[] = [];
      let x = (rand() - 0.5) * 22;
      let z = 4 - rand() * 9;
      let a = rand() * Math.PI * 2;
      for (let k = 0; k < 9; k++) {
        pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.04, z));
        a += (rand() - 0.5) * 1.6;
        x += Math.cos(a) * 0.9;
        z += Math.sin(a) * 0.9;
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 5, false);
      g.deleteAttribute('uv');
      vines.push(g);
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1a3010, roughness: 0.85, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(mergeGeometries(vines)!, leafMat));
    const leafGeo = new THREE.CircleGeometry(0.32, 7);
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i);
      lp.setXYZ(i, x * (1 + 0.25 * Math.sin(Math.atan2(y, x) * 5)), y, (x * x + y * y) * 0.6);
    }
    leafGeo.rotateX(-Math.PI / 2 + 0.25);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 160);
    for (let i = 0; i < 160; i++) {
      const x = (rand() - 0.5) * 26;
      const z = 5 - rand() * 12;
      this.dummy.position.set(x, heightAt(x, z) + 0.08, z);
      this.dummy.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
      this.dummy.scale.setScalar(0.6 + rand() * 0.8);
      this.dummy.updateMatrix();
      leaves.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(leaves);

    // Straw bales
    const strawCanvas = document.createElement('canvas');
    strawCanvas.width = strawCanvas.height = 128;
    const sctx = strawCanvas.getContext('2d')!;
    sctx.fillStyle = '#8a6a2c';
    sctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      sctx.strokeStyle = `rgba(${rand() < 0.5 ? '40,25,5' : '200,170,90'},${0.3 + rand() * 0.4})`;
      sctx.lineWidth = 1 + rand();
      const x = rand() * 128, y = rand() * 128;
      sctx.beginPath();
      sctx.moveTo(x, y);
      sctx.lineTo(x + 10 + rand() * 20, y + (rand() - 0.5) * 6);
      sctx.stroke();
    }
    sctx.fillStyle = 'rgba(30,15,0,0.8)';
    sctx.fillRect(30, 0, 4, 128);
    sctx.fillRect(94, 0, 4, 128);
    const strawTex = new THREE.CanvasTexture(strawCanvas);
    strawTex.colorSpace = THREE.SRGBColorSpace;
    const strawMat = new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1 });
    const baleGeo = new THREE.BoxGeometry(1.5, 0.7, 0.8);
    for (const [x, z, ry, st] of [[-8.5, 5.5, 0.5, 2], [8.8, 5.2, -0.6, 2], [-11.5, 0.5, 1.2, 1], [11.8, 0.2, -1.1, 1], [-6.8, 7.5, 0.2, 1]]) {
      for (let k = 0; k < st; k++) {
        const b = new THREE.Mesh(baleGeo, strawMat);
        b.position.set(x + k * 0.3, heightAt(x, z) + 0.35 + k * 0.7, z);
        b.rotation.y = ry + k * 0.3;
        this.scene.add(b);
      }
    }

    // Scarecrow silhouette against the moon
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0607, roughness: 1 });
    const scare = new THREE.Group();
    scare.position.set(3, heightAt(3, -13) - 0.2, -13);
    scare.rotation.y = -0.2;
    const sc = (g: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
      const m = new THREE.Mesh(g, dark);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      scare.add(m);
    };
    sc(new THREE.CylinderGeometry(0.09, 0.11, 6, 6), 0, 3, 0);
    sc(new THREE.CylinderGeometry(0.07, 0.07, 3.8, 6), 0, 4.3, 0, Math.PI / 2 - 0.08);
    sc(new THREE.CylinderGeometry(0.42, 0.75, 1.9, 7), 0, 3.6, 0);
    for (const s of [-1, 1]) {
      sc(new THREE.CylinderGeometry(0.2, 0.32, 1.5, 6), s * 1.0, 4.28 - s * 0.04, 0, s * (Math.PI / 2));
      sc(new THREE.ConeGeometry(0.22, 0.5, 5), s * 1.95, 4.2, 0, s * (Math.PI / 2 + 0.6));
    }
    sc(new THREE.SphereGeometry(0.42, 12, 10), 0, 5.0, 0, 0.25);
    sc(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 14), 0.1, 5.35, 0, 0.18);
    sc(new THREE.ConeGeometry(0.42, 0.85, 10), 0.18, 5.75, 0, 0.35);
    this.scarecrowEyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.6, 0.1) });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.scarecrowEyes);
      e.position.set(s * 0.15 - 0.03, 5.05, 0.38);
      scare.add(e);
    }
    this.scene.add(scare);

    // Cornfield silhouette strip
    const corn = cornTexture();
    corn.repeat.set(4, 1);
    const cornMat = new THREE.MeshBasicMaterial({ map: corn, transparent: true, alphaTest: 0.4, color: 0x000000, fog: false, side: THREE.DoubleSide });
    for (const [z, x, w] of [[-24, 0, 90], [-19, -24, 30]]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 5.5), cornMat);
      strip.position.set(x, heightAt(x, z) + 2.4, z);
      this.scene.add(strip);
    }

    // Ground fog
    for (let i = 0; i < 3; i++) {
      const fmat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, density: { value: 0.4 }, seed: { value: i * 4.7 }, warm: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float time, density, seed, warm;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vec3(vWorld.xz * 0.12 + vec2(time * 0.05, time * 0.02), time * 0.04 + seed));
            float a = smoothstep(-0.2, 0.8, n) * density;
            float dist = length(vWorld.xz - cameraPosition.xz);
            a *= smoothstep(2.0, 7.0, dist) * (1.0 - smoothstep(35.0, 70.0, dist));
            vec3 col = mix(vec3(0.2, 0.13, 0.22), vec3(0.45, 0.2, 0.08), warm);
            gl_FragColor = vec4(col, a);
          }`,
      });
      const fog = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), fmat);
      fog.position.y = 0.35 + i * 0.55;
      this.fogLayers.push(fog);
      this.scene.add(fog);
    }

    // Ember particles
    for (let i = 0; i < EMBERS; i++) this.ePos[i * 3 + 1] = -100;
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3));
    eg.setAttribute('aLife', new THREE.BufferAttribute(this.eLife, 1));
    this.embers = new THREE.Points(
      eg,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: dotTexture() }, uScale: { value: 300 } },
        vertexShader: /* glsl */ `
          uniform float uScale;
          attribute float aLife;
          varying float vLife;
          void main() {
            vLife = aLife;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uScale * (0.04 + 0.05 * aLife) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          varying float vLife;
          void main() {
            if (vLife <= 0.0) discard;
            float a = texture2D(map, gl_PointCoord).a;
            vec3 col = mix(vec3(0.9, 0.12, 0.02), vec3(1.3, 0.7, 0.25), vLife);
            gl_FragColor = vec4(col * a * 0.45 * min(1.0, vLife * 2.0), 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.embers.frustumCulled = false;
    this.scene.add(this.embers);

    // Warm light pools from the patch (low / mid / high)
    for (const x of [-6, 0, 6]) {
      const l = new THREE.PointLight(0xff8a30, 8, 12, 1.6);
      l.position.set(x, 3.2, x === 0 ? 1.8 : 3.0);
      this.lights.push(l);
      this.scene.add(l);
    }

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 50;
    cam.far = 300;
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.sky) return;
    this.sky.material.uniforms.aspect.value = w / h;
    this.embers.material.uniforms.uScale.value = h * 0.9;
  }

  private emit(x: number, y: number, z: number, n: number, power: number) {
    for (let k = 0; k < n; k++) {
      const i = this.eCursor;
      this.eCursor = (this.eCursor + 1) % EMBERS;
      this.ePos[i * 3] = x + (Math.random() - 0.5) * 0.2;
      this.ePos[i * 3 + 1] = y;
      this.ePos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
      this.eVel[i * 3] = (Math.random() - 0.5) * 1.2;
      this.eVel[i * 3 + 1] = (1.5 + Math.random() * 2.5) * power;
      this.eVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      this.eLife[i] = 0.7 + Math.random() * 0.3;
    }
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (audio.drop) this.dropTime = time;
    const sinceDrop = time - this.dropTime;
    const dropEnv = sinceDrop < 6 ? Math.exp(-sinceDrop * 0.55) : 0;

    // Column levels (log bands grouped into 16 columns) and history for the back rows.
    for (let c = 0; c < COLS; c++) {
      const b0 = 1 + c * 3;
      const v = (audio.bands[b0] + audio.bands[b0 + 1] + audio.bands[b0 + 2]) / 3;
      this.colLevel[c] = Math.min(1, v * (1.5 + c * 0.06));
    }
    this.histTimer += dt;
    if (this.histTimer > 0.07) {
      this.histTimer = 0;
      this.histHead = (this.histHead + 1) % HISTORY;
      this.history.set(this.colLevel, this.histHead * COLS);
    }
    if (audio.beat) {
      this.waves[this.waveCursor] = time;
      this.waveAmp[this.waveCursor] = 0.6 + audio.bass * 1.2;
      this.waveCursor = (this.waveCursor + 1) % WAVES;
    }

    const JUMP_T = 0.9;
    const jump = sinceDrop < JUMP_T ? 4 * 1.6 * (sinceDrop / JUMP_T) * (1 - sinceDrop / JUMP_T) : 0;
    const flameDrop = sinceDrop < 3.5 ? Math.min(1, sinceDrop * 10) * Math.max(0, 1 - sinceDrop / 3.5) : 0;
    const candle = 0.85 + 0.15 * Math.sin(time * 15) * Math.sin(time * 6.3);
    const faces = this.faceAttr.array as Float32Array;
    const glows = this.glowAttr.array as Float32Array;
    const flames = this.flameAttr.array as Float32Array;
    const d = this.dummy;
    for (let r = 0; r < ROWS; r++) {
      const lag = r * 3;
      const hIdx = ((this.histHead - lag) % HISTORY + HISTORY) % HISTORY;
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const target = r === 0 ? this.colLevel[c] : this.history[hIdx * COLS + c];
        this.level[i] = damp(this.level[i], target, target > this.level[i] ? 18 : 5, dt);
        const v = this.level[i];
        let wave = 0;
        for (let w = 0; w < WAVES; w++) {
          const age = time - this.waves[w];
          if (age < 0 || age > 2) continue;
          const x = Math.abs(c - 7.5) + r * 0.8 - age * 22;
          wave += Math.exp(-x * x * 0.35) * this.waveAmp[w];
        }
        const hop = v * 0.8 + wave * 0.15 + jump * (0.85 + 0.3 * Math.sin(i * 1.7));
        const sq = 1 + v * 0.22 - wave * 0.05;
        const s = this.scaleBase[i];
        d.position.set(this.base[i * 4], this.base[i * 4 + 1] + hop, this.base[i * 4 + 2]);
        d.rotation.set(Math.sin(time * 1.3 + i) * 0.04 * v, this.base[i * 4 + 3] + (jump > 0 ? Math.sin(sinceDrop * 7 + i) * 0.4 : 0), Math.sin(time * 2.1 + i * 0.7) * 0.06 * v);
        d.scale.set(s / Math.sqrt(sq), s * sq, s / Math.sqrt(sq));
        d.updateMatrix();
        this.pumpkins.setMatrixAt(i, d.matrix);
        this.stems.setMatrixAt(i, d.matrix);
        this.flames.setMatrixAt(i, d.matrix);
        glows[i] = Math.min(1.25, 0.24 + v * 1.35 + wave * 0.55 + dropEnv * 0.2) * candle * (1 - r * 0.12);
        faces[i] = sinceDrop < 1.6 ? 3 : Math.min(3, Math.floor(v * 3.6 + this.bias[i]));
        const f = Math.max(flameDrop * (0.7 + 0.3 * Math.sin(i * 2.3)), v > 0.82 ? (v - 0.82) * 3 : 0);
        flames[i] = f;
        if (f > 0.15 && Math.random() < f * 0.18) this.emit(d.position.x, d.position.y + 0.6 * s, d.position.z, 1, 0.8 + f);
      }
    }
    if (audio.drop) {
      for (let i = 0; i < N; i++) this.emit(this.base[i * 4], this.base[i * 4 + 1] + 0.6, this.base[i * 4 + 2], 5, 1.6);
    }
    this.pumpkins.instanceMatrix.needsUpdate = true;
    this.stems.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.faceAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.flameAttr.needsUpdate = true;

    // Embers
    for (let i = 0; i < EMBERS; i++) {
      if (this.eLife[i] <= 0) continue;
      const i3 = i * 3;
      this.eLife[i] -= dt * 0.45;
      this.eVel[i3] += Math.sin(time * 2 + i) * dt * 0.8;
      this.eVel[i3 + 1] -= dt * 0.9;
      this.ePos[i3] += this.eVel[i3] * dt;
      this.ePos[i3 + 1] += this.eVel[i3 + 1] * dt;
      this.ePos[i3 + 2] += this.eVel[i3 + 2] * dt;
      if (this.eLife[i] <= 0) this.ePos[i3 + 1] = -100;
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    (this.embers.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;

    // Lights follow low / mid / high thirds of the patch
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let c = k * 5; c < k * 5 + 6; c++) s += this.level[c];
      this.lights[k].intensity = (4 + (s / 6) * 22 + audio.beatPulse * 4 + dropEnv * 5) * candle;
    }
    this.hemi.intensity = 0.4 + dropEnv * 0.15;
    this.scarecrowEyes.color.setRGB(1.2 + audio.mid * 2 + dropEnv * 3, 0.4 * (1 - dropEnv) + audio.mid * 0.4, 0.06);

    this.sky.material.uniforms.time.value = time;
    this.sky.material.uniforms.flash.value = dropEnv * 0.2;
    this.moon.material.uniforms.glow.value = audio.bass + audio.beatPulse * 0.4;
    for (const f of this.fogLayers) {
      f.material.uniforms.time.value = time;
      f.material.uniforms.density.value = 0.16 + audio.bass * 0.2;
      f.material.uniforms.warm.value = Math.min(1, audio.level * 0.8 + dropEnv * 0.5);
    }

    // Slow drifting camera
    this.drift += dt * (0.06 + audio.level * 0.05);
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.set(Math.sin(this.drift) * 3.2, 3.3 + Math.sin(this.drift * 1.3) * 0.4 + audio.bass * 0.05, 13 + Math.sin(this.drift * 0.7) * 1.2);
    cam.lookAt(Math.sin(this.drift) * 0.8, 1.6, -2);
    cam.updateMatrixWorld();
    this.camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    this.camUp.setFromMatrixColumn(cam.matrixWorld, 1);
    this.flames.material.uniforms.uTime.value = time;
    this.moon.position.set(cam.position.x * 0.9 + 14, 16, -95);
    this.moon.lookAt(cam.position);
    this.moon.scale.setScalar(48 * (1 + audio.bass * 0.03));
  }
}
