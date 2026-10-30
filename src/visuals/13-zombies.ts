import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const ZOMBIES = 150;
const HANDS = 14;
const DIRT = 700;
const NEAR_Z = 5;
const FAR_Z = -72;
const CAM_Z = 9;
const MOTES = 160;
const FOG_COLOR = new THREE.Color(0.035, 0.075, 0.042);
const EYE_BANDS = [3, 8, 14, 20, 28, 36, 44, 52];
/** [glow (eyes, toxic lights, sparks), fog, rim light] — cycles every 32 beats, snaps on drops. */
const MOODS: Array<[THREE.Color, THREE.Color, THREE.Color]> = [
  [PALETTE.toxic.clone(), FOG_COLOR.clone(), new THREE.Color(0.42, 0.75, 0.38)],
  [new THREE.Color(0xff1830), new THREE.Color(0.075, 0.022, 0.03), new THREE.Color(0.85, 0.42, 0.4)],
  [new THREE.Color(0xb44bff), new THREE.Color(0.048, 0.028, 0.08), new THREE.Color(0.6, 0.48, 0.9)],
  [new THREE.Color(0x22eaff), new THREE.Color(0.022, 0.058, 0.08), new THREE.Color(0.42, 0.72, 0.88)],
  [new THREE.Color(0xff7410), new THREE.Color(0.072, 0.045, 0.02), new THREE.Color(0.9, 0.6, 0.32)],
];

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Tags every vertex of `g` with a body part id and the joint it rotates around. */
function part(g: THREE.BufferGeometry, id: number, pivot: [number, number, number]) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  const pv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
  g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  return g;
}

const ni = (g: THREE.BufferGeometry) => {
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};

/** Low-poly humanoid; parts: 0 torso, 1 head, 2/3 arms, 4/5 legs, 6 eyes. */
function zombieGeometry() {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const torso = mergeGeometries([box(0.46, 0.38, 0.26, 0, 1.28, 0), box(0.38, 0.3, 0.22, 0, 0.98, 0.0)].map(ni))!;
  const head = new THREE.IcosahedronGeometry(0.15, 1).scale(0.95, 1.15, 1).translate(0, 1.66, 0.02);
  const neck = box(0.1, 0.14, 0.1, 0, 1.52, 0);
  const headAll = mergeGeometries([head, neck].map(ni))!;
  const arm = (side: number) =>
    mergeGeometries(
      [box(0.11, 0.36, 0.12, side * 0.3, 1.27, 0), box(0.095, 0.34, 0.1, side * 0.3, 0.92, 0), box(0.12, 0.16, 0.05, side * 0.3, 0.68, 0)].map(
        ni,
      ),
    )!;
  const leg = (side: number) =>
    mergeGeometries(
      [box(0.15, 0.46, 0.16, side * 0.11, 0.66, 0), box(0.12, 0.44, 0.13, side * 0.11, 0.23, 0), box(0.13, 0.07, 0.24, side * 0.11, 0.035, 0.05)].map(
        ni,
      ),
    )!;
  const eyes = mergeGeometries([box(0.05, 0.03, 0.02, -0.055, 1.69, 0.155), box(0.05, 0.03, 0.02, 0.055, 1.69, 0.155)].map(ni))!;
  return mergeGeometries([
    part(torso, 0, [0, 0.9, 0]),
    part(headAll, 1, [0, 1.48, 0]),
    part(arm(1), 2, [0.3, 1.42, 0]),
    part(arm(-1), 3, [-0.3, 1.42, 0]),
    part(leg(1), 4, [0.11, 0.88, 0]),
    part(leg(-1), 5, [-0.11, 0.88, 0]),
    part(eyes, 6, [0, 1.48, 0]),
  ])!;
}

/** A rotting forearm + clawing hand, wrist at y = 0, elbow at y = -0.75. */
function handGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(0.06, 0.075, 0.8, 6).translate(0, -0.38, 0));
  parts.push(new THREE.BoxGeometry(0.2, 0.22, 0.07).translate(0, 0.1, 0));
  const fingers = [-0.078, -0.026, 0.026, 0.078];
  fingers.forEach((x, i) => {
    // three bony segments curling forward like a claw
    let len = i === 0 || i === 3 ? 0.13 : 0.16;
    let y = 0.2, z = 0, ang = 0.25 + (i % 2) * 0.1;
    for (let k = 0; k < 3; k++) {
      const w = 0.032 - k * 0.006;
      parts.push(new THREE.BoxGeometry(w, len, w).translate(0, len / 2, 0).rotateX(ang).translate(x * (1 + k * 0.15), y, z));
      y += Math.cos(ang) * len;
      z += Math.sin(ang) * len;
      ang += 0.45;
      len *= 0.8;
    }
  });
  parts.push(new THREE.BoxGeometry(0.04, 0.14, 0.04).translate(0, 0.07, 0).rotateZ(0.9).rotateX(0.4).translate(-0.1, 0.06, 0.02));
  parts.forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries(parts)!;
}

function treeGeometry(rand: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = start.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(radius * 0.65, radius, len, 5, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(start.x, start.y, start.z);
    g.deleteAttribute('uv');
    parts.push(g);
    if (depth <= 0) return;
    const n = depth > 2 ? 2 + Math.floor(rand() * 2) : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      d.x += (rand() - 0.5) * 1.6;
      d.z += (rand() - 0.5) * 1.6;
      d.y += (rand() - 0.2) * 0.6;
      d.normalize();
      branch(end, d, len * (0.6 + rand() * 0.2), radius * 0.62, depth - 1);
    }
  };
  branch(new THREE.Vector3(), new THREE.Vector3((rand() - 0.5) * 0.3, 1, 0).normalize(), 2.4, 0.28, 5);
  return mergeGeometries(parts)!;
}

const easeOutBack = (t: number) => {
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** 13. A shambling zombie horde in toxic green fog; hands claw out of the ground on beats. */
export class ZombieHordeVisual extends Visual {
  readonly name = 'Zombie Horde';
  bloom = 0.9;
  private sky!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moon!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private horde!: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private zx = new Float32Array(ZOMBIES);
  private zz = new Float32Array(ZOMBIES);
  private zs = new Float32Array(ZOMBIES);
  private zspeed = new Float32Array(ZOMBIES);
  private zyaw = new Float32Array(ZOMBIES);
  private hands!: THREE.InstancedMesh;
  private handState: { x: number; z: number; yaw: number; t: number; life: number; s: number }[] = [];
  private dirt!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private dirtPos = new Float32Array(DIRT * 3);
  private dirtVel = new Float32Array(DIRT * 3);
  private dirtLife = new Float32Array(DIRT);
  private dirtCursor = 0;
  private fogLayers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private hemi!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;
  private toxicLights: THREE.PointLight[] = [];
  private travel = 0;
  private speed = 0.5;
  private surge = 0;
  private flare = 0;
  private eyes = 0;
  private shake = 0;
  private handCursor = 0;
  private dropTime = -100;
  private dummy = new THREE.Object3D();
  private twitch = new Float32Array(ZOMBIES);
  private twitchAttr!: THREE.InstancedBufferAttribute;
  private motes!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private glow = MOODS[0][0].clone();
  private fogBase = MOODS[0][1].clone();
  private rimC = MOODS[0][2].clone();
  private moonC = new THREE.Color();
  private eyeBands = new Array<number>(EYE_BANDS.length).fill(0);
  private mood = 0;
  private moodFrom = 0;
  private moodMix = 1;
  private moodSpeed = 0.4;
  private beatsInMood = 0;
  private snap = 0;

  protected setup() {
    const rand = rng(1313);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.035);

    this.sky = fullscreenQuad(
      /* glsl */ `
      uniform float time, aspect, flare;
      uniform vec3 fogc, moonc, glowc;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec3 col = mix(fogc, fogc * 0.15, smoothstep(-0.12, 0.45, p.y));
        float clouds = fbm(vec3(p * vec2(1.4, 3.2) + vec2(time * 0.015, 0.0), time * 0.025));
        vec2 mp = p - vec2(-0.22, 0.2);
        float glow = exp(-length(mp * vec2(0.8, 1.0)) * 3.0);
        col += moonc * glow * 0.12;
        col += fogc * 1.05 * smoothstep(0.0, 0.7, clouds) * smoothstep(-0.2, 0.3, p.y) * (0.6 + glow * 2.0);
        col += glowc * flare * 0.12 * (1.0 - smoothstep(-0.3, 0.4, p.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, aspect: { value: 1 }, flare: { value: 0 }, fogc: { value: this.fogBase }, moonc: { value: this.moonC }, glowc: { value: this.glow } },
    );
    this.scene.add(this.sky);

    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { glow: { value: 0 }, moonc: { value: this.moonC } },
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float glow;
          uniform vec3 moonc;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float disc = smoothstep(0.36, 0.35, r);
            float craters = fbm(vec3(p * 4.0, 2.0)) * 0.5 + 0.5;
            vec3 moon = moonc * (0.55 + 0.45 * craters) * 0.85;
            float halo = exp(-max(r - 0.35, 0.0) * 7.0) * (0.25 + glow * 0.3);
            vec3 col = moon * disc + moonc * halo * 0.6 * (1.0 - disc);
            gl_FragColor = vec4(col, max(disc, halo));
          }`,
      }),
    );
    this.moon.scale.setScalar(70);
    this.moon.renderOrder = -500;
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0x5a8a5a, 0x050a05, 0.5);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0xb8ffb0, 1.3);
    this.moonLight.position.set(-0.3, 0.5, -1).multiplyScalar(50);
    this.scene.add(this.moonLight);
    for (const x of [-2.5, 2.5]) {
      const l = new THREE.PointLight(0x58ff40, 2, 9, 1.5);
      l.position.set(x, 0.4, 5.5);
      this.toxicLights.push(l);
      this.scene.add(l);
    }

    // Uneven field
    const ground = new THREE.PlaneGeometry(260, 260, 100, 100).rotateX(-Math.PI / 2);
    const gp = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      gp.setY(i, Math.sin(x * 0.21 + z * 0.13) * 0.12 + Math.sin(x * 0.05) * Math.cos(z * 0.04) * 0.6 * Math.min(1, Math.abs(x) / 20));
    }
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: 0x141a10, roughness: 1 })));

    // Dead trees and leaning crosses along the edges
    const bark = new THREE.MeshStandardMaterial({ color: 0x050705, roughness: 1 });
    for (const [x, z, s] of [[-13, -8, 1.6], [15, -20, 2], [-19, -34, 2.2], [9, -46, 1.8], [-6, -58, 2.4], [22, -6, 1.4]]) {
      const t = new THREE.Mesh(treeGeometry(rand), bark);
      t.position.set(x, -0.2, z);
      t.rotation.y = rand() * 6.28;
      t.scale.setScalar(s);
      this.scene.add(t);
    }
    const crossGeo = mergeGeometries([new THREE.BoxGeometry(0.12, 1.4, 0.1).translate(0, 0.7, 0), new THREE.BoxGeometry(0.7, 0.12, 0.1).translate(0, 1.05, 0)])!;
    const crosses = new THREE.InstancedMesh(crossGeo, bark, 26);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      this.dummy.position.set(side * (7 + rand() * 9), -0.1, 4 - rand() * 60);
      this.dummy.rotation.set((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.5);
      this.dummy.scale.setScalar(0.8 + rand() * 0.5);
      this.dummy.updateMatrix();
      crosses.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(crosses);

    // The horde
    const geo = zombieGeometry();
    const rnd = new Float32Array(ZOMBIES * 4);
    for (let i = 0; i < ZOMBIES; i++) {
      rnd[i * 4] = rand();
      rnd[i * 4 + 1] = rand();
      rnd[i * 4 + 2] = (rand() - 0.5) * 2;
      rnd[i * 4 + 3] = 0.7 + rand() * 0.6;
      let x = (rand() - 0.5) * 30;
      if (Math.abs(x) < 1.1) x = Math.sign(x || 1) * (1.1 + rand());
      this.zx[i] = x;
      this.zz[i] = FAR_Z + rand() * (NEAR_Z - FAR_Z);
      this.zs[i] = 0.88 + rand() * 0.3;
      this.zspeed[i] = rnd[i * 4 + 3];
      this.zyaw[i] = (rand() - 0.5) * 1.3;
    }
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    this.twitchAttr = new THREE.InstancedBufferAttribute(this.twitch, 1);
    this.twitchAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTwitch', this.twitchAttr);
    this.horde = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTravel: { value: 0 },
          uLurch: { value: 0 },
          uSurge: { value: 0 },
          uFogDensity: { value: 0.035 },
          uFogColor: { value: FOG_COLOR.clone() },
          uEyes: { value: 0 },
          uFlare: { value: 0 },
          uRim: { value: 0.35 },
          uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, -1).normalize() },
          uGlow: { value: this.glow },
          uRimC: { value: this.rimC },
          uBand: { value: this.eyeBands },
          uSnap: { value: 0 },
        },
        vertexShader: /* glsl */ `
          uniform float uTravel, uLurch, uSurge, uSnap;
          uniform float uBand[${EYE_BANDS.length}];
          attribute float aPart;
          attribute vec3 aPivot;
          attribute vec4 aRand;
          attribute float aTwitch;
          varying vec3 vN;
          varying vec3 vW;
          varying float vPart;
          varying float vEye;
          mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          void main() {
            float g = uTravel * aRand.w * 2.4 + aRand.x * 6.2832;
            float sg = sin(g);
            int pt = int(aPart + 0.5);
            vec3 p = position;
            vec3 n = normal;
            float lurch = uLurch * (0.8 + 0.4 * aRand.y);
            if (pt == 4 || pt == 5) {
              float side = pt == 4 ? 1.0 : -1.0;
              // one dragging, stiff leg per zombie
              float amp = side > 0.0 ? 0.45 : 0.45 * (1.0 - aRand.y * 0.75);
              mat3 R = rotX(side * sg * amp - lurch * 0.15);
              p = R * (p - aPivot) + aPivot;
              n = R * n;
            } else {
              if (pt == 2 || pt == 3) {
                float side = pt == 2 ? 1.0 : -1.0;
                float droop = aRand.z * side > 0.5 ? 0.7 : 0.0;
                float a = -1.3 + droop + 0.14 * sin(g * 0.5 + side * 1.7 + aRand.x * 9.0) - lurch * 0.45 - uSurge * 0.2 - aTwitch * 0.85 - uSnap * 0.12;
                mat3 R = rotZ(side * (0.12 + 0.08 * sin(g + side))) * rotX(a);
                p = R * (p - aPivot) + aPivot;
                n = R * n;
              } else if (pt == 1 || pt == 6) {
                float jerk = aTwitch * (aRand.z > 0.0 ? 0.9 : -0.9) * (0.6 + 0.4 * sin(aTwitch * 30.0));
                mat3 R = rotZ(aRand.z * 0.55 + sin(g * 0.5) * 0.12 - lurch * aRand.z * 0.4 + jerk) * rotX(0.2 + lurch * 0.55 - aTwitch * 0.5);
                p = R * (p - aPivot) + aPivot;
                n = R * n;
              }
              vec3 waist = vec3(0.0, 0.9, 0.0);
              mat3 R = rotZ(sg * 0.09 + aRand.z * 0.12 * aRand.y) * rotX(0.2 + lurch * 0.4 + uSurge * 0.25);
              p = R * (p - waist) + waist;
              n = R * n;
            }
            p.y += abs(cos(g)) * 0.05 - 0.05 - (1.0 - abs(sg)) * aRand.y * 0.04;
            mat4 m = modelMatrix * instanceMatrix;
            vec4 w = m * vec4(p, 1.0);
            vW = w.xyz;
            vN = normalize(mat3(m) * n);
            vPart = aPart;
            // each zombie's eyes ride their own slice of the spectrum
            int bi = int(aRand.y * ${EYE_BANDS.length}.0);
            float band = 0.0;
            for (int k = 0; k < ${EYE_BANDS.length}; k++) if (k == bi) band = uBand[k];
            vEye = (0.35 + band * 1.3) * (1.0 + aTwitch * 3.0);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uFogColor, uMoonDir, uGlow, uRimC;
          uniform float uFogDensity, uEyes, uFlare, uRim, uSnap;
          varying vec3 vN;
          varying vec3 vW;
          varying float vPart;
          varying float vEye;
          void main() {
            float dist = length(cameraPosition - vW);
            if (vPart > 5.5) {
              vec3 e = uGlow * uEyes * vEye;
              float fe = 1.0 - exp(-pow(uFogDensity * dist * 0.55, 2.0)) * (1.0 - step(2.0, vEye) * 0.3);
              gl_FragColor = vec4(mix(e, uFogColor, fe), 1.0);
              return;
            }
            vec3 N = normalize(vN);
            vec3 V = normalize(cameraPosition - vW);
            float rim = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);
            float back = clamp(dot(N, uMoonDir) + 0.15, 0.0, 1.0);
            float top = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = vec3(0.014, 0.02, 0.012) * (0.4 + 0.8 * top);
            col += uRimC * rim * back * uRim;
            col += uGlow * (uFlare * 0.06 + uSnap * 0.025) * max(dot(N, normalize(vec3(0.0, 0.2, 1.0))), 0.0);
            float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
            gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
          }`,
      }),
      ZOMBIES,
    );
    this.horde.frustumCulled = false;
    this.scene.add(this.horde);

    // Hands bursting from the dirt
    this.hands = new THREE.InstancedMesh(
      handGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x3a4430, roughness: 0.9, emissive: 0x050a03 }),
      HANDS,
    );
    this.hands.frustumCulled = false;
    for (let i = 0; i < HANDS; i++) {
      const side = i % 2 ? 1 : -1;
      this.handState.push({
        x: side * (0.7 + rand() * 3.6),
        z: 2.5 + rand() * 3.8,
        yaw: (rand() - 0.5) * 1.2,
        t: -1,
        life: 3,
        s: 1.5 + rand() * 0.6,
      });
    }
    this.scene.add(this.hands);
    // Dirt mounds where hands emerge
    const mound = new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1);
    const mounds = new THREE.InstancedMesh(mound, new THREE.MeshStandardMaterial({ color: 0x1c160c, roughness: 1 }), HANDS);
    this.handState.forEach((h, i) => {
      this.dummy.position.set(h.x, -0.02, h.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1.1, 1, 1.1);
      this.dummy.updateMatrix();
      mounds.setMatrixAt(i, this.dummy.matrix);
    });
    this.scene.add(mounds);

    const dg = new THREE.BufferGeometry();
    for (let i = 0; i < DIRT; i++) this.dirtPos[i * 3 + 1] = -50;
    dg.setAttribute('position', new THREE.BufferAttribute(this.dirtPos, 3));
    dg.setAttribute('life', new THREE.BufferAttribute(this.dirtLife, 1));
    this.dirt = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        uniforms: { scale: { value: 400 }, glowc: { value: this.glow } },
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          uniform float scale;
          attribute float life;
          varying float vLife;
          varying float vSpark;
          void main() {
            vLife = life;
            vSpark = step(0.82, fract(float(gl_VertexID) * 0.6180339));
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = scale * (vSpark > 0.5 ? 0.03 : 0.055) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 glowc;
          varying float vLife;
          varying float vSpark;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5 || vLife <= 0.0) discard;
            vec3 col = vSpark > 0.5 ? glowc * 1.6 : vec3(0.09, 0.07, 0.04);
            float a = smoothstep(0.5, 0.25, d) * min(1.0, vLife * 2.0);
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    this.dirt.frustumCulled = false;
    this.scene.add(this.dirt);

    // Ground fog
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, density: { value: 0.3 }, flare: { value: 0 }, seed: { value: i * 5.1 }, fogc: { value: this.fogBase }, glowc: { value: this.glow } },
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
          uniform float time, density, flare, seed;
          uniform vec3 fogc, glowc;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vec3(vWorld.xz * 0.08 + vec2(time * 0.04, time * 0.06), time * 0.05 + seed));
            float a = smoothstep(-0.25, 0.8, n) * density;
            float dist = length(vWorld.xz - cameraPosition.xz);
            a *= smoothstep(1.5, 6.0, dist) * (1.0 - smoothstep(45.0, 90.0, dist));
            vec3 col = mix(fogc * 2.7, glowc * 0.5 + fogc, flare);
            gl_FragColor = vec4(col, a);
          }`,
      });
      const fog = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), mat);
      fog.position.set(0, 0.2 + i * 0.4, -30);
      this.fogLayers.push(fog);
      this.scene.add(fog);
    }

    // Grave motes drifting in the fog; hi-hats make a fresh random handful flash.
    const mp = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      mp[i * 3] = (rand() - 0.5) * 22;
      mp[i * 3 + 1] = 0.3 + rand() * 4.2;
      mp[i * 3 + 2] = 7 - rand() * 40;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(
      mg,
      new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, scale: { value: 400 }, treble: { value: 0 }, hat: { value: 0 }, seed: { value: 0 }, glowc: { value: this.glow } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float time, scale, treble, hat, seed;
          varying float vA;
          float h1(float n) { return fract(sin(n) * 43758.5453); }
          void main() {
            float id = float(gl_VertexID);
            vec3 p = position;
            p.x += sin(time * 0.3 + id * 1.7) * 0.6;
            p.y += sin(time * 0.45 + id * 2.3) * 0.35;
            p.z += cos(time * 0.25 + id) * 0.5;
            float lit = step(h1(id * 12.9898 + seed * 78.233), 0.3);
            vA = 0.08 + treble * 0.25 + lit * hat * 1.4;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = scale * (0.035 + lit * hat * 0.05) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 glowc;
          varying float vA;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float star = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2)
                       + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
            float a = (exp(-d * d * 60.0) + star * 0.5) * vA;
            gl_FragColor = vec4(mix(glowc, vec3(1.0), 0.45) * a, 1.0);
          }`,
      }),
    );
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
    this.applyMood(0);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 55;
    cam.far = 400;
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.sky) return;
    this.sky.material.uniforms.aspect.value = w / h;
    this.dirt.material.uniforms.scale.value = h * 0.9;
    this.motes.material.uniforms.scale.value = h * 0.9;
  }

  private applyMood(brightness: number) {
    const m = this.moodMix * this.moodMix * (3 - 2 * this.moodMix);
    const [fg, ff, fr] = MOODS[this.moodFrom];
    const [tg, tf, tr] = MOODS[this.mood];
    this.glow.copy(fg).lerp(tg, m);
    this.fogBase.copy(ff).lerp(tf, m);
    this.rimC.copy(fr).lerp(tr, m);
    // airy, bright music drifts the hue a little and warms the glow towards white
    this.glow.offsetHSL((brightness - 0.5) * 0.07, 0, 0).lerp(PALETTE.bone, brightness * 0.15);
    this.moonC.copy(PALETTE.moon).lerp(this.glow, 0.3);
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

  /** Snare/clap: a few zombies near the front jerk their heads and claw at the sky, eyes flaring. */
  private twitchSome() {
    let n = 3 + Math.floor(Math.random() * 3);
    for (let tries = 0; tries < 40 && n > 0; tries++) {
      const i = Math.floor(Math.random() * ZOMBIES);
      if (this.zz[i] < -28 || this.zz[i] > 3 || this.twitch[i] > 0.3) continue;
      this.twitch[i] = 1;
      n--;
    }
  }

  private triggerHand(force = false) {
    for (let k = 0; k < HANDS; k++) {
      const i = (this.handCursor + k) % HANDS;
      const h = this.handState[i];
      if (h.t < 0 || force) {
        h.t = 0;
        h.life = 2.2 + Math.random() * 2;
        this.handCursor = (i + 1 + Math.floor(Math.random() * 3)) % HANDS;
        for (let j = 0; j < 45; j++) {
          const d = this.dirtCursor;
          this.dirtCursor = (d + 1) % DIRT;
          const a = Math.random() * Math.PI * 2;
          const r = 0.5 + Math.random() * 2.2;
          this.dirtPos[d * 3] = h.x + Math.cos(a) * 0.15;
          this.dirtPos[d * 3 + 1] = 0.05;
          this.dirtPos[d * 3 + 2] = h.z + Math.sin(a) * 0.15;
          this.dirtVel[d * 3] = Math.cos(a) * r;
          this.dirtVel[d * 3 + 1] = 2 + Math.random() * 3.5;
          this.dirtVel[d * 3 + 2] = Math.sin(a) * r;
          this.dirtLife[d] = 0.7 + Math.random() * 0.8;
        }
        return;
      }
    }
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (audio.drop) {
      this.surge = 1;
      for (let i = 0; i < HANDS; i++) this.triggerHand(true);
    } else if (audio.beat) {
      this.triggerHand();
      if (audio.bass > 0.6) this.triggerHand();
    }
    if (audio.drop) this.dropTime = time;
    this.updateMood(dt, audio);
    if (audio.midHit) {
      this.twitchSome();
      this.snap = 1;
    }
    this.snap = Math.max(0, this.snap - dt * 4);
    for (let i = 0; i < ZOMBIES; i++) if (this.twitch[i] > 0) this.twitch[i] = Math.max(0, this.twitch[i] - dt * 1.6);
    this.twitchAttr.needsUpdate = true;
    for (let k = 0; k < EYE_BANDS.length; k++) {
      const b = audio.bands[EYE_BANDS[k]] ?? 0;
      this.eyeBands[k] = damp(this.eyeBands[k], b, b > this.eyeBands[k] ? 18 : 5, dt);
    }
    const sinceDrop = time - this.dropTime;
    this.surge = damp(this.surge, sinceDrop < 3.5 ? 1 : 0, sinceDrop < 3.5 ? 4 : 0.8, dt);
    this.flare = sinceDrop < 0.15 ? damp(this.flare, 1, 30, dt) : damp(this.flare, 0, 0.6, dt);
    this.speed = damp(this.speed, 0.35 + audio.level * 1.1 + this.surge * 2.4, 2, dt);
    this.travel += dt * this.speed;
    this.eyes = damp(this.eyes, 1.6 + audio.mid * 5 + audio.beatPulse * 2 + this.flare * 4, 6, dt);

    const u = this.horde.material.uniforms;
    const fogDensity = 0.022 + audio.bass * 0.01 - this.flare * 0.005;
    (this.scene.fog as THREE.FogExp2).density = fogDensity;
    const fogCol = u.uFogColor.value as THREE.Color;
    fogCol.copy(this.fogBase).lerp(this.glow, this.flare * 0.06 + audio.beatPulse * 0.01 + audio.midPulse * 0.008);
    (this.scene.fog as THREE.FogExp2).color.copy(fogCol);
    u.uTravel.value = this.travel;
    u.uLurch.value = audio.beatPulse * (0.6 + audio.bass * 0.6);
    u.uSurge.value = this.surge;
    u.uFogDensity.value = fogDensity;
    u.uEyes.value = this.eyes;
    u.uFlare.value = this.flare;
    u.uSnap.value = this.snap;
    u.uRim.value = 0.3 + audio.beatPulse * 0.15 + this.flare * 0.3;

    // Move the horde forward; recycle zombies that walk past the camera.
    const m = this.horde.instanceMatrix.array as Float32Array;
    const range = NEAR_Z - FAR_Z;
    for (let i = 0; i < ZOMBIES; i++) {
      let z = this.zz[i] + dt * this.speed * this.zspeed[i] * 0.55;
      if (z > NEAR_Z) z -= range;
      this.zz[i] = z;
      // avoid walking straight through the lens
      const x = this.zx[i] * (1 + Math.max(0, z + 6) * 0.09);
      const s = this.zs[i];
      const yaw = this.zyaw[i] + Math.sin(this.travel * 0.5 + i) * 0.15;
      const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
      const o = i * 16;
      m[o] = c; m[o + 1] = 0; m[o + 2] = -sn; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sn; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
      m[o + 12] = x; m[o + 13] = 0; m[o + 14] = z; m[o + 15] = 1;
    }
    this.horde.instanceMatrix.needsUpdate = true;

    // Hands
    const d = this.dummy;
    for (let i = 0; i < HANDS; i++) {
      const h = this.handState[i];
      let rise = 0;
      if (h.t >= 0) {
        h.t += dt;
        if (h.t < 0.35) rise = easeOutBack(h.t / 0.35);
        else if (h.t < h.life) rise = 1;
        else rise = Math.max(0, 1 - (h.t - h.life) / 1.2);
        if (h.t > h.life + 1.2) h.t = -1;
      }
      const grasp = h.t >= 0 ? Math.sin(h.t * 5 + i) * 0.15 + audio.beatPulse * 0.25 : 0;
      d.position.set(h.x, -0.95 + rise * 1.05, h.z);
      d.rotation.set(0.25 + grasp, h.yaw + Math.sin(time * 1.3 + i) * 0.2, (h.x > 0 ? -0.2 : 0.2) + Math.sin(h.t * 3 + i) * 0.1);
      d.scale.setScalar(h.s);
      d.updateMatrix();
      this.hands.setMatrixAt(i, d.matrix);
    }
    this.hands.instanceMatrix.needsUpdate = true;

    // Dirt particles
    for (let i = 0; i < DIRT; i++) {
      if (this.dirtLife[i] <= 0) continue;
      const i3 = i * 3;
      this.dirtLife[i] -= dt;
      this.dirtVel[i3 + 1] -= 9 * dt;
      this.dirtPos[i3] += this.dirtVel[i3] * dt;
      this.dirtPos[i3 + 1] += this.dirtVel[i3 + 1] * dt;
      this.dirtPos[i3 + 2] += this.dirtVel[i3 + 2] * dt;
      if (this.dirtPos[i3 + 1] < 0.02) {
        this.dirtPos[i3 + 1] = 0.02;
        this.dirtVel[i3] *= 0.5;
        this.dirtVel[i3 + 1] *= -0.25;
        this.dirtVel[i3 + 2] *= 0.5;
      }
    }
    this.dirt.geometry.attributes.position.needsUpdate = true;
    this.dirt.geometry.attributes.life.needsUpdate = true;

    for (const f of this.fogLayers) {
      f.material.uniforms.time.value = time;
      f.material.uniforms.density.value = 0.08 + audio.bass * 0.16 + this.flare * 0.1;
      f.material.uniforms.flare.value = this.flare;
    }
    const mu = this.motes.material.uniforms;
    mu.time.value = time;
    mu.treble.value = audio.treble;
    mu.hat.value = audio.treblePulse;
    if (audio.trebleHit) mu.seed.value = audio.trebleHitCount % 997;
    this.sky.material.uniforms.time.value = time;
    this.sky.material.uniforms.flare.value = this.flare;
    this.moon.material.uniforms.glow.value = audio.bass + this.flare;
    this.hemi.intensity = 0.45 + this.flare * 1.5;
    this.moonLight.intensity = 1.2 + audio.beatPulse * 0.4 + this.flare * 2;
    for (const l of this.toxicLights) {
      l.color.copy(this.glow);
      l.intensity = 0.6 + audio.mid * 1.2 + audio.midPulse * 2.5 + audio.beatPulse * 1.5 + this.flare * 10;
    }
    this.hemi.color.copy(this.rimC).multiplyScalar(0.33);
    this.moonLight.color.copy(this.moonC);

    // Camera: slow sway, bass shake
    this.shake = damp(this.shake, audio.bass * 0.06 + audio.beatPulse * 0.07 + this.flare * 0.08, 8, dt);
    const cam = this.camera as THREE.PerspectiveCamera;
    const sx = Math.sin(time * 37) * Math.sin(time * 23.1) * this.shake;
    const sy = Math.sin(time * 41.3) * Math.cos(time * 19.7) * this.shake;
    cam.position.set(Math.sin(time * 0.11) * 2.2 + sx, 1.1 + Math.sin(time * 0.17) * 0.12 + sy, CAM_Z - this.surge * 0.8);
    cam.lookAt(Math.sin(time * 0.08) * 2, 2.4 + sy * 0.5, -30);
    this.moon.position.set(cam.position.x - 40, 30, cam.position.z - 170);
    this.moon.lookAt(cam.position);
  }
}
