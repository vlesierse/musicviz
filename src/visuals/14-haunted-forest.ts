import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { dotTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const PERIOD = 64;
const LEAVES = 700;
const WISPS = 7;
const FOG_COLOR = new THREE.Color(0.022, 0.024, 0.045);
const FACE_HEIGHT = 2.1;
const FACE_TRUNK_R = 0.5;
const FACE_BANDS = [4, 10, 16, 22, 30, 38, 46, 54];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
type Mood = { faceA: THREE.Color; faceB: THREE.Color; wisp: THREE.Color; mist: THREE.Color; leafA: THREE.Color; leafB: THREE.Color; fog: THREE.Color; moon: THREE.Color };
/** Cycles every 32 beats, snaps on drops (the blood-red drop mode still overrides for a few seconds). */
const MOODS: Mood[] = [
  { faceA: PALETTE.candle.clone(), faceB: PALETTE.ember.clone(), wisp: C(0.28, 0.78, 1), mist: C(0.16, 0.17, 0.3), leafA: PALETTE.pumpkin.clone(), leafB: PALETTE.candle.clone(), fog: FOG_COLOR.clone(), moon: C(0.75, 0.8, 1) },
  { faceA: C(0.55, 1, 0.2), faceB: C(0.1, 0.8, 0.05), wisp: C(0.75, 0.3, 1), mist: C(0.1, 0.2, 0.13), leafA: PALETTE.slime.clone(), leafB: C(0.9, 1, 0.2), fog: C(0.014, 0.034, 0.024), moon: C(0.8, 1, 0.75) },
  { faceA: C(1, 0.35, 0.95), faceB: C(0.5, 0.08, 0.95), wisp: C(1, 0.7, 0.25), mist: C(0.2, 0.11, 0.3), leafA: C(0.75, 0.2, 1), leafB: C(1, 0.35, 0.6), fog: C(0.034, 0.016, 0.05), moon: C(0.9, 0.75, 1) },
  { faceA: C(0.65, 0.95, 1), faceB: C(0.1, 0.4, 1), wisp: C(0.45, 1, 0.55), mist: C(0.11, 0.19, 0.28), leafA: C(0.3, 0.8, 1), leafB: C(0.85, 0.95, 1), fog: C(0.01, 0.028, 0.05), moon: C(0.7, 0.9, 1) },
  { faceA: C(1, 0.8, 0.2), faceB: C(1, 0.3, 0), wisp: C(1, 0.25, 0.75), mist: C(0.08, 0.2, 0.2), leafA: C(1, 0.55, 0.05), leafB: C(1, 0.15, 0.05), fog: C(0.01, 0.034, 0.034), moon: C(1, 0.9, 0.7) },
];

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const pathX = (z: number) => Math.sin((z / PERIOD) * Math.PI * 2) * 2.2 + Math.sin((z / PERIOD) * Math.PI * 6) * 0.6;

/**
 * A gnarled leafless tree built from tapered tubes along random-walk curves. Every vertex gets an
 * `aFlex` value (0 at the root → 1 at the furthest claw tip) used to bend the branches in the shader.
 */
function gnarledTree(rand: () => number, face: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const flexes: Float32Array[] = [];
  let maxDist = 0;
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, depth: number, dist0: number, straight = false) => {
    const segs = straight ? 2 : 4;
    const pts = [start.clone()];
    const d = dir.clone();
    const p = start.clone();
    for (let s = 0; s < segs; s++) {
      if (!straight) {
        d.x += (rand() - 0.5) * 0.7;
        d.z += (rand() - 0.5) * 0.7;
        d.y += (rand() - 0.5) * 0.35;
        if (depth === 0) d.y -= 0.35 + s * 0.1; // claw tips hook downwards
      }
      d.normalize();
      p.addScaledVector(d, len / segs);
      pts.push(p.clone());
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r1 = depth === 0 ? 0.006 : r0 * 0.6;
    const tub = depth >= 3 ? 8 : 5;
    const rad = depth >= 3 ? 7 : depth >= 1 ? 5 : 3;
    const g = new THREE.TubeGeometry(curve, tub, 1, rad, false);
    g.deleteAttribute('uv');
    const pos = g.attributes.position as THREE.BufferAttribute;
    const flex = new Float32Array(pos.count);
    const centers = curve.getSpacedPoints(tub);
    for (let v = 0; v < pos.count; v++) {
      const i = Math.floor(v / (rad + 1));
      const t = i / tub;
      const c = centers[i];
      // knobbly bark: radius wobbles along the branch
      const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8)) * (1 + 0.12 * Math.sin(t * 17 + depth * 3));
      pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * r, c.y + (pos.getY(v) - c.y) * r, c.z + (pos.getZ(v) - c.z) * r);
      flex[v] = dist0 + t * len;
    }
    g.computeVertexNormals();
    maxDist = Math.max(maxDist, dist0 + len);
    parts.push(g);
    flexes.push(flex);
    if (depth <= 0) return;
    const n = depth >= 3 ? 2 + Math.floor(rand() * 2) : 2;
    for (let k = 0; k < n; k++) {
      const c = d.clone();
      const a = rand() * Math.PI * 2;
      c.x += Math.cos(a) * (0.7 + rand() * 0.6);
      c.z += Math.sin(a) * (0.7 + rand() * 0.6);
      c.y += 0.15 + (rand() - 0.5) * 0.4;
      c.normalize();
      // most children sprout from the tip, some part-way along the branch
      const t = k === 0 ? 1 : 0.55 + rand() * 0.45;
      const from = curve.getPointAt(t);
      grow(from, c, len * (0.62 + rand() * 0.18), THREE.MathUtils.lerp(r0, r1, t) * 0.8, depth - 1, dist0 + t * len);
    }
  };
  const trunkLen = face ? 4.4 : 3.2 + rand() * 1.5;
  const trunkR = face ? FACE_TRUNK_R / 0.86 : 0.35 + rand() * 0.15;
  grow(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(face ? 0 : (rand() - 0.5) * 0.3, 1, face ? 0 : (rand() - 0.5) * 0.3), trunkLen, trunkR, 5, 0, face);
  // roots clawing into the ground
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand();
    const start = new THREE.Vector3(Math.cos(a) * trunkR * 0.5, 0.5, Math.sin(a) * trunkR * 0.5);
    const pts = [start, start.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, -0.35, Math.sin(a) * 0.6)), start.clone().add(new THREE.Vector3(Math.cos(a) * 1.4, -0.75, Math.sin(a) * 1.4))];
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 4, 1, 4, false);
    g.deleteAttribute('uv');
    const pos = g.attributes.position as THREE.BufferAttribute;
    const centers = new THREE.CatmullRomCurve3(pts).getSpacedPoints(4);
    for (let v = 0; v < pos.count; v++) {
      const i = Math.floor(v / 5);
      const c = centers[i];
      const r = THREE.MathUtils.lerp(trunkR * 0.55, 0.03, i / 4);
      pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * r, c.y + (pos.getY(v) - c.y) * r, c.z + (pos.getZ(v) - c.z) * r);
    }
    g.computeVertexNormals();
    parts.push(g);
    flexes.push(new Float32Array(pos.count));
  }
  parts.forEach((g, i) => {
    const f = flexes[i];
    for (let k = 0; k < f.length; k++) f[k] /= maxDist;
    g.setAttribute('aFlex', new THREE.BufferAttribute(f, 1));
  });
  return mergeGeometries(parts)!;
}

/** 14. A walk down a path through a haunted forest of clawing trees with carved, glowing faces. */
export class HauntedForestVisual extends Visual {
  readonly name = 'Haunted Forest';
  bloom = 1;
  private sky!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moon!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private treeUniforms = { uTime: { value: 0 }, uReach: { value: 0 }, uSway: { value: 0.2 }, uTwitch: { value: 0 } };
  private faces!: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private leaves!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private leafBase = new Float32Array(LEAVES * 4);
  private wisps!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private wispLights: THREE.PointLight[] = [];
  private redLight!: THREE.PointLight;
  private hemi!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;
  private mist: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private travel = 0;
  private glow = 0;
  private open = 0.3;
  private red = 0;
  private reach = 0;
  private dropTime = -100;
  private lookTarget = new THREE.Vector3();
  private redFog = new THREE.Color(0.06, 0.004, 0.006);
  private col: Mood = {
    faceA: new THREE.Color(), faceB: new THREE.Color(), wisp: new THREE.Color(), mist: new THREE.Color(),
    leafA: new THREE.Color(), leafB: new THREE.Color(), fog: new THREE.Color(), moon: new THREE.Color(),
  };
  private faceBands = new Array<number>(FACE_BANDS.length).fill(0);
  private mood = 0;
  private moodFrom = 0;
  private moodMix = 1;
  private moodSpeed = 0.4;
  private beatsInMood = 0;
  private shriek = 0;

  protected setup() {
    const rand = rng(1414);
    this.applyMood(0.5);
    const col = this.col;
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.045);

    this.sky = fullscreenQuad(
      /* glsl */ `
      uniform float time, aspect, red;
      uniform vec3 fogb, mistc;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec3 fogc = mix(fogb, vec3(0.05, 0.004, 0.006), red * 0.6);
        vec3 col = mix(fogc, fogb * 0.15, smoothstep(-0.05, 0.5, p.y));
        float clouds = fbm(vec3(p * vec2(1.6, 3.0) + vec2(time * 0.01, 0.0), time * 0.02));
        col += mix(mistc * 0.22, vec3(0.08, 0.0, 0.01), red) * smoothstep(0.0, 0.8, clouds) * smoothstep(0.0, 0.4, p.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, aspect: { value: 1 }, red: { value: 0 }, fogb: { value: col.fog }, mistc: { value: col.mist } },
    );
    this.scene.add(this.sky);

    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { red: { value: 0 }, moonc: { value: col.moon } },
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float red;
          uniform vec3 moonc;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float disc = smoothstep(0.36, 0.35, r);
            float craters = fbm(vec3(p * 4.0, 5.0)) * 0.5 + 0.5;
            vec3 mc = mix(moonc, vec3(1.0, 0.12, 0.06), red);
            vec3 col = mc * (0.5 + 0.5 * craters) * disc * 0.9;
            float halo = exp(-max(r - 0.35, 0.0) * 6.0) * 0.35;
            col += mc * halo * 0.5 * (1.0 - disc);
            gl_FragColor = vec4(col, max(disc, halo));
          }`,
      }),
    );
    this.moon.scale.setScalar(55);
    this.moon.renderOrder = -500;
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0x2c3060, 0x06040a, 0.5);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0x9fb0ff, 1.1);
    this.moonLight.position.set(0.2, 0.7, -1).multiplyScalar(50);
    this.scene.add(this.moonLight);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0x7fe0ff, 3, 10, 1.6);
      this.wispLights.push(l);
      this.scene.add(l);
    }
    this.redLight = new THREE.PointLight(0xff1a08, 0, 30, 1.2);
    this.scene.add(this.redLight);

    // Ground: a dirt path winding through dark leaf litter.
    const ground = new THREE.PlaneGeometry(80, PERIOD * 3, 80, 240).rotateX(-Math.PI / 2);
    ground.translate(0, 0, -PERIOD);
    const gp = ground.attributes.position as THREE.BufferAttribute;
    const gcol = new Float32Array(gp.count * 3);
    const dirt = new THREE.Color(0x2a2016), litter = new THREE.Color(0x0c0907), tmp = new THREE.Color();
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      const dx = Math.abs(x - pathX(z));
      const path = 1 - THREE.MathUtils.smoothstep(dx, 0.9, 2.2);
      gp.setY(i, (1 - path) * (Math.sin(x * 0.7 + z * 0.3) * 0.12 + Math.sin(x * 0.2) * 0.2) + Math.min(dx, 20) * 0.04);
      tmp.copy(litter).lerp(dirt, path * (0.75 + 0.25 * Math.sin(z * 3.1 + x * 2.3)));
      gcol.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    ground.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));

    // Trees: a handful of variants, instanced along the path (layout repeats every PERIOD).
    const bark = new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: 1 });
    bark.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.treeUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uReach, uSway, uTwitch;\nattribute float aFlex;')
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          vec4 ip = vec4(transformed, 1.0);
          vec3 root = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix * ip;
            root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          vec4 wp = modelMatrix * ip;
          float k = aFlex * aFlex;
          vec3 toCam = cameraPosition - root;
          toCam.y = 0.0;
          float dc = length(toCam);
          toCam /= max(dc, 0.001);
          float near = 1.0 - smoothstep(6.0, 34.0, dc);
          wp.xyz += toCam * k * uReach * near * 2.6;
          wp.y -= k * k * uReach * near * 1.2;
          float ph = root.x * 0.37 + root.z * 0.21;
          wp.x += sin(uTime * 0.7 + ph) * k * uSway;
          wp.z += cos(uTime * 0.53 + ph * 1.3) * k * uSway * 0.6;
          wp.xyz += sin(wp.yzx * 5.0 + uTime * 37.0) * k * uTwitch;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    const variants = [gnarledTree(rand, true), gnarledTree(rand, true), gnarledTree(rand, false), gnarledTree(rand, false), gnarledTree(rand, false)];
    type Placement = { x: number; z: number; yaw: number; s: number; v: number };
    const base: Placement[] = [];
    // face trees hug the path, facing it
    for (let i = 0; i < 8; i++) {
      const z = -((i + 0.5) / 8) * PERIOD + (rand() - 0.5) * 3;
      const side = i % 2 ? 1 : -1;
      const x = pathX(z) + side * (2.8 + rand() * 1.2);
      base.push({ x, z, yaw: Math.atan2(pathX(z) - x, 3 + rand() * 2), s: 0.95 + rand() * 0.25, v: i % 2 });
    }
    for (let i = 0; i < 44; i++) {
      const z = -rand() * PERIOD;
      const side = rand() < 0.5 ? -1 : 1;
      const x = pathX(z) + side * (3.2 + Math.pow(rand(), 1.4) * 18);
      base.push({ x, z, yaw: rand() * Math.PI * 2, s: 0.9 + rand() * 0.7, v: 2 + Math.floor(rand() * 3) });
    }
    const all: Placement[] = [];
    for (const off of [0, -PERIOD, PERIOD]) for (const p of base) if (off !== PERIOD || p.z + off < 12) all.push({ ...p, z: p.z + off });
    const dummy = new THREE.Object3D();
    variants.forEach((g, v) => {
      const list = all.filter((p) => p.v === v);
      const mesh = new THREE.InstancedMesh(g, bark, list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.setScalar(p.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    });

    // Carved faces on the face trees
    const faceList = all.filter((p) => p.v < 2);
    const seeds = new Float32Array(faceList.length);
    for (let i = 0; i < faceList.length; i++) seeds[i] = (i % 8) / 8 + rand() * 0.05;
    const fg = new THREE.PlaneGeometry(1.0, 1.15);
    fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.faces = new THREE.InstancedMesh(
      fg,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uGlow: { value: 1 }, uOpen: { value: 0.3 }, uRed: { value: 0 }, uFog: { value: 0.045 },
          uHotA: { value: col.faceA }, uHotB: { value: col.faceB }, uBand: { value: this.faceBands }, uShriek: { value: 0 }, uShriekSeed: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          attribute float aSeed;
          varying vec2 vUv;
          varying float vSeed;
          varying float vDist;
          void main() {
            vUv = uv;
            vSeed = aSeed;
            vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vDist = length(w.xyz - cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uGlow, uOpen, uRed, uFog, uShriek, uShriekSeed;
          uniform float uBand[${FACE_BANDS.length}];
          uniform vec3 uHotA, uHotB;
          varying vec2 vUv;
          varying float vSeed;
          varying float vDist;
          void main() {
            vec2 p = vUv - 0.5;
            // each face sings along to its own slice of the spectrum
            int bi = int(clamp(vSeed, 0.0, 0.999) * ${FACE_BANDS.length}.0);
            float band = 0.0;
            for (int k = 0; k < ${FACE_BANDS.length}; k++) if (k == bi) band = uBand[k];
            // snares/claps: a random few faces shriek, mouths snapping wide, eyes flaring white-hot
            float sh = uShriek * step(fract(vSeed * 13.7 + uShriekSeed * 0.618), 0.4);
            float blink = max(step(0.05, fract(uTime * 0.11 + vSeed * 7.3)), sh);
            float open = clamp(uOpen * (0.7 + 0.3 * sin(uTime * 0.9 + vSeed * 20.0)) * blink + sh * 0.8, 0.0, 1.0);
            open = max(open, uRed);
            // hollow, drooping eye sockets
            vec2 qL = p - vec2(-0.2, 0.18);
            qL.y -= qL.x * 0.5;
            vec2 qR = p - vec2(0.2, 0.18);
            qR.y += qR.x * 0.5;
            vec2 er = vec2(0.115, mix(0.025, 0.12, open));
            float dE = min(length(qL / er), length(qR / er));
            // gaping, jagged screaming mouth
            vec2 qm = p - vec2(0.0, -0.2);
            float jag = 1.0 + 0.14 * sin(atan(qm.y, qm.x) * 11.0 + vSeed * 30.0);
            float dM = length(qm / vec2(0.1 + open * 0.07, 0.035 + open * 0.17)) / jag;
            float d = min(dE, dM);
            float hole = smoothstep(1.0, 0.82, d);
            float rim = smoothstep(1.8, 1.0, d);
            float eyes = smoothstep(1.0, 0.3, dE);
            float flick = 0.75 + 0.25 * sin(uTime * 13.0 + vSeed * 40.0) * sin(uTime * 7.3 + vSeed * 9.0);
            vec3 hot = mix(uHotA, uHotB, 0.35 + 0.4 * length(p));
            hot = mix(hot, vec3(1.0, 0.05, 0.02), uRed);
            hot = mix(hot, vec3(1.0, 0.95, 0.85), sh * eyes * 0.55);
            vec3 col = hot * uGlow * flick * (0.55 + band * 0.9 + sh * 1.5) * (0.8 + 0.8 * eyes + 0.5 * smoothstep(1.0, 0.0, d));
            float fogF = exp(-pow(uFog * vDist * 0.75, 2.0));
            float a = max(hole, rim * 0.85) * fogF;
            gl_FragColor = vec4(col * hole, a);
          }`,
      }),
      faceList.length,
    );
    faceList.forEach((p, i) => {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      dummy.position.set(p.x + fx * (FACE_TRUNK_R + 0.04) * p.s, FACE_HEIGHT * p.s, p.z + fz * (FACE_TRUNK_R + 0.04) * p.s);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      this.faces.setMatrixAt(i, dummy.matrix);
    });
    this.faces.frustumCulled = false;
    this.scene.add(this.faces);

    // Ground mist
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, density: { value: 0.3 }, red: { value: 0 }, seed: { value: i * 3.7 }, mistc: { value: col.mist } },
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
          uniform float time, density, red, seed;
          uniform vec3 mistc;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vec3(vWorld.xz * 0.09 + vec2(time * 0.05, -time * 0.03), time * 0.04 + seed));
            float a = smoothstep(-0.25, 0.8, n) * density;
            float dist = length(vWorld.xz - cameraPosition.xz);
            a *= smoothstep(1.0, 5.0, dist) * (1.0 - smoothstep(30.0, 60.0, dist));
            vec3 col = mix(mistc, vec3(0.22, 0.03, 0.04), red);
            gl_FragColor = vec4(col, a);
          }`,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), mat);
      m.position.y = 0.3 + i * 0.5;
      this.mist.push(m);
      this.scene.add(m);
    }

    // Falling leaves / embers around the camera
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEAVES * 3), 3));
    const lph = new Float32Array(LEAVES);
    for (let i = 0; i < LEAVES; i++) {
      this.leafBase[i * 4] = (rand() - 0.5) * 30;
      this.leafBase[i * 4 + 1] = rand() * 12;
      this.leafBase[i * 4 + 2] = -rand() * 40;
      this.leafBase[i * 4 + 3] = rand() * 100;
      lph[i] = rand();
    }
    lg.setAttribute('aPh', new THREE.BufferAttribute(lph, 1));
    this.leaves = new THREE.Points(
      lg,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uSparkle: { value: 0 }, uRed: { value: 0 }, uScale: { value: 400 },
          uLeafA: { value: col.leafA }, uLeafB: { value: col.leafB }, uHat: { value: 0 }, uHatSeed: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime, uSparkle, uScale, uHat, uHatSeed;
          attribute float aPh;
          varying float vB;
          varying float vPh;
          varying float vGlint;
          void main() {
            vPh = aPh;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float tw = pow(0.5 + 0.5 * sin(uTime * (6.0 + aPh * 10.0) + aPh * 60.0), 6.0);
            // hi-hats: a fresh random 15% of the leaves catch the light as white glints
            vGlint = uHat * step(fract(sin(aPh * 917.3 + uHatSeed * 12.9898) * 43758.5453), 0.15) * smoothstep(2.0, 5.0, -mv.z);
            vB = (0.18 + uSparkle * tw * 2.5 + vGlint * 3.0) * (1.0 - smoothstep(18.0, 38.0, -mv.z));
            gl_PointSize = uScale * (0.05 + 0.04 * aPh) * (1.0 + uSparkle * tw + vGlint * 0.8) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uRed;
          uniform vec3 uLeafA, uLeafB;
          varying float vB;
          varying float vPh;
          varying float vGlint;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            vec3 c = mix(uLeafA, uLeafB, vPh);
            c = mix(c, vec3(1.0, 0.08, 0.03), uRed * 0.6);
            c = mix(c, vec3(1.0), min(vGlint, 1.0) * 0.6);
            gl_FragColor = vec4(c * vB * a, 1.0);
          }`,
      }),
    );
    this.leaves.frustumCulled = false;
    this.scene.add(this.leaves);

    // Will-o'-wisps drifting between the trees
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WISPS * 3), 3));
    this.wisps = new THREE.Points(
      wg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        size: 1.1,
        color: new THREE.Color(0.5, 1.4, 1.8),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.wisps.frustumCulled = false;
    this.scene.add(this.wisps);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 62;
    cam.far = 300;
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.sky) return;
    this.sky.material.uniforms.aspect.value = w / h;
    this.leaves.material.uniforms.uScale.value = h;
  }

  private applyMood(brightness: number) {
    const m = this.moodMix * this.moodMix * (3 - 2 * this.moodMix);
    const a = MOODS[this.moodFrom], b = MOODS[this.mood], c = this.col;
    for (const k of ['faceA', 'faceB', 'wisp', 'mist', 'leafA', 'leafB', 'fog', 'moon'] as const) c[k].copy(a[k]).lerp(b[k], m);
    // brighter, airier music nudges the carved faces' hue and cools the moon
    const h = (brightness - 0.5) * 0.05;
    c.faceA.offsetHSL(h, 0, 0);
    c.faceB.offsetHSL(h, 0, 0);
    c.moon.lerp(PALETTE.ghost, brightness * 0.3);
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

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (audio.drop) this.dropTime = time;
    const sinceDrop = time - this.dropTime;
    this.updateMood(dt, audio);
    const fu = this.faces.material.uniforms;
    if (audio.midHit) {
      this.shriek = 1;
      fu.uShriekSeed.value = audio.midHitCount % 97;
    }
    this.shriek = Math.max(0, this.shriek - dt * 3);
    for (let k = 0; k < FACE_BANDS.length; k++) {
      const v = audio.bands[FACE_BANDS[k]] ?? 0;
      this.faceBands[k] = damp(this.faceBands[k], v, v > this.faceBands[k] ? 18 : 5, dt);
    }
    this.red = damp(this.red, sinceDrop < 3 ? 1 : 0, sinceDrop < 3 ? 12 : 0.7, dt);
    this.glow = damp(this.glow, 1.2 + audio.mid * 5 + audio.beatPulse * 3 + this.red * 4, 8, dt);
    this.open = damp(this.open, 0.25 + audio.mid * 0.7 + audio.beatPulse * 0.25, 6, dt);
    this.reach = damp(this.reach, audio.bass * 0.9 + this.red * 0.6, 3, dt);

    const tu = this.treeUniforms;
    tu.uTime.value = time;
    tu.uReach.value = this.reach;
    tu.uSway.value = 0.15 + audio.bass * 0.5;
    tu.uTwitch.value = audio.beatPulse * 0.06 + audio.midPulse * 0.035 + this.red * 0.02;

    fu.uTime.value = time;
    fu.uShriek.value = this.shriek;
    fu.uGlow.value = this.glow;
    fu.uOpen.value = this.open;
    fu.uRed.value = this.red;

    this.travel += dt * (0.9 + audio.level * 1.2);
    const camZ = -(this.travel % PERIOD);
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.set(pathX(camZ) + Math.sin(time * 0.3) * 0.2, 1.7 + Math.sin(this.travel * 2.2) * 0.05, camZ);
    const ahead = camZ - 9;
    this.lookTarget.set(pathX(ahead) * 0.8, 2.6 + Math.sin(time * 0.21) * 0.4, ahead);
    cam.lookAt(this.lookTarget);
    cam.rotateZ(Math.sin(time * 0.17) * 0.03);

    const fogD = 0.045 - audio.level * 0.008;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = fogD;
    fog.color.copy(this.col.fog).lerp(this.redFog, this.red * 0.6);
    fu.uFog.value = fogD;

    this.sky.material.uniforms.time.value = time;
    this.sky.material.uniforms.red.value = this.red;
    this.moon.material.uniforms.red.value = this.red;
    this.moon.position.set(cam.position.x + 10, 34, camZ - 160);
    this.moon.lookAt(cam.position);
    this.hemi.intensity = 0.45 + audio.beatPulse * 0.15;
    this.hemi.color.copy(this.col.mist).multiplyScalar(0.25);
    this.moonLight.intensity = 1 + this.red * 0.5;
    this.moonLight.color.copy(this.col.moon);
    this.redLight.intensity = this.red * 16;
    this.redLight.position.set(pathX(camZ - 10), 4, camZ - 10);

    for (const m of this.mist) {
      m.position.x = cam.position.x;
      m.position.z = camZ;
      m.material.uniforms.time.value = time;
      m.material.uniforms.density.value = 0.25 + audio.bass * 0.2;
      m.material.uniforms.red.value = this.red;
    }

    // Leaves fall in a box that follows the camera.
    const lp = this.leaves.geometry.attributes.position.array as Float32Array;
    const lb = this.leafBase;
    for (let i = 0; i < LEAVES; i++) {
      const b = i * 4;
      const ph = lb[b + 3];
      const y = (((lb[b + 1] - time * (0.5 + (ph % 1) * 0.6)) % 12) + 12) % 12;
      let z = lb[b + 2] + this.travel;
      z = ((z % 40) + 40) % 40;
      lp[i * 3] = cam.position.x + lb[b] + Math.sin(time * 1.3 + ph) * 0.8;
      lp[i * 3 + 1] = y;
      lp[i * 3 + 2] = camZ + 2 - z;
    }
    this.leaves.geometry.attributes.position.needsUpdate = true;
    const lu = this.leaves.material.uniforms;
    lu.uTime.value = time;
    lu.uSparkle.value = audio.treble * 1.5 + audio.beatPulse * 0.3;
    lu.uRed.value = this.red;
    lu.uHat.value = audio.treblePulse;
    if (audio.trebleHit) lu.uHatSeed.value = audio.trebleHitCount % 113;

    const wp = this.wisps.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < WISPS; i++) {
      const z = camZ - 6 - ((i * 7 + time * 0.8) % 40);
      const side = i % 2 ? 1 : -1;
      const x = pathX(z) + side * (2.5 + Math.sin(time * 0.5 + i * 2) * 2);
      const y = 1.2 + Math.sin(time * 0.9 + i) * 0.6;
      wp[i * 3] = x;
      wp[i * 3 + 1] = y;
      wp[i * 3 + 2] = z;
      if (i < this.wispLights.length) {
        this.wispLights[i].position.set(x, y, z);
        this.wispLights[i].intensity = 2 + audio.treble * 3 + audio.treblePulse * 2;
        this.wispLights[i].color.copy(this.col.wisp);
      }
    }
    this.wisps.geometry.attributes.position.needsUpdate = true;
    this.wisps.material.size = 0.7 + audio.treble * 0.6 + audio.treblePulse * 0.25 + audio.beatPulse * 0.2;
    this.wisps.material.color.copy(this.col.wisp).multiplyScalar(1.8);
  }
}
