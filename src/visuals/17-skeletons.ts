import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { dotTexture } from '../core/shapes';
import { Visual, damp } from '../core/Visual';

const COUNT = 7;
const STAGE_Y = 0.45;
const MOVES = 6;
const SPOT_COLORS = [PALETTE.toxic, PALETTE.purple, PALETTE.pumpkin, PALETTE.blood, PALETTE.violet, PALETTE.ghost, PALETTE.slime];

// Pose channel indices
const P = {
  y: 0, rotY: 1, x: 2, spineX: 3, spineZ: 4, spineY: 5, neckX: 6, neckZ: 7,
  lFwd: 8, lOut: 9, lEl: 10, rFwd: 11, rOut: 12, rEl: 13,
  lHip: 14, lKnee: 15, rHip: 16, rKnee: 17, pelvisZ: 18,
} as const;
const CH = 19;
const DOWN = new THREE.Vector3(0, -1, 0);

function capsule(r: number, len: number) {
  return new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, -len / 2, 0);
}

function stoneTexture(rows: number, cols: number, base: [number, number, number], seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#050407';
  ctx.fillRect(0, 0, size, size);
  const bh = size / rows;
  for (let r = 0; r < rows; r++) {
    const bw = size / cols;
    const off = r % 2 ? bw / 2 : 0;
    for (let k = -1; k < cols + 1; k++) {
      const v = 0.6 + rand() * 0.5;
      ctx.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
      ctx.fillRect(k * bw + off + 3, r * bh + 3, bw - 6, bh - 6);
      // grime speckles
      for (let n = 0; n < 30; n++) {
        ctx.fillStyle = `rgba(0,0,0,${rand() * 0.25})`;
        ctx.fillRect(k * bw + off + rand() * bw, r * bh + rand() * bh, 2 + rand() * 6, 2 + rand() * 6);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  jaw: THREE.Group;
  lSh: THREE.Group;
  rSh: THREE.Group;
  lEl: THREE.Group;
  rEl: THREE.Group;
  lHip: THREE.Group;
  rHip: THREE.Group;
  lKnee: THREE.Group;
  rKnee: THREE.Group;
  baseX: number;
  baseZ: number;
  pose: Float32Array;
  target: Float32Array;
  seed: number;
}

/** 17. A row of skeletons dancing in sync on a crypt stage. */
export class SkeletonDanceVisual extends Visual {
  readonly name = 'Skeleton Dance';
  private rigs: Rig[] = [];
  private boneMat!: THREE.MeshStandardMaterial;
  private rimUniform = { value: new THREE.Color() };
  private eyeMat!: THREE.MeshBasicMaterial;
  private spots: THREE.SpotLight[] = [];
  private spotTargets: THREE.Color[] = [];
  private cones: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>[] = [];
  private smoke: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private candles!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private backLight!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private colorIdx = 0;
  // tempo tracking
  private intervals: number[] = [];
  private sorted: number[] = [];
  private period = 0.5;
  private beatPos = 0;
  private lastBeat = -10;
  private amp = 0.4;
  private moveShift = 0;
  private dropTime = -100;
  private tmpColor = new THREE.Color();

  protected setup() {
    this.scene.fog = new THREE.FogExp2(0x060409, 0.035);
    this.scene.background = new THREE.Color(0x020103);

    this.boneMat = new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.55, metalness: 0.0 });
    const rim = this.rimUniform;
    this.boneMat.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = rim;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float rimF = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRim * pow(rimF, 2.5);`,
        );
    };
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 0.8) });
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Shared bone geometries
    const torsoParts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) torsoParts.push(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 6).translate(0, 0.03 + k * 0.068, -0.02));
    const ribR = [0.1, 0.13, 0.148, 0.155, 0.15, 0.135];
    const gap = 0.7;
    ribR.forEach((R, r) => {
      const g = new THREE.TorusGeometry(R, 0.013, 5, 22, Math.PI * 2 - gap);
      g.rotateX(Math.PI / 2);
      g.rotateY(-Math.PI / 2 - gap / 2);
      g.scale(1, 1, 0.78);
      g.rotateX(0.18);
      g.translate(0, 0.5 - r * 0.055, R * 0.78 - 0.04);
      torsoParts.push(g);
    });
    torsoParts.push(new THREE.BoxGeometry(0.035, 0.22, 0.02).translate(0, 0.38, 0.21));
    for (const side of [-1, 1]) {
      torsoParts.push(new THREE.CapsuleGeometry(0.014, 0.16, 2, 6).rotateZ(Math.PI / 2 + side * 0.15).translate(side * 0.1, 0.56, 0.06));
    }
    const torsoGeo = mergeGeometries(torsoParts)!;
    const pelvisGeo = mergeGeometries([
      new THREE.TorusGeometry(0.1, 0.035, 6, 14).rotateX(Math.PI / 2 - 0.4).scale(1.25, 1, 0.8).translate(0, 0.02, 0),
      new THREE.SphereGeometry(0.045, 8, 6).translate(-0.11, -0.04, 0),
      new THREE.SphereGeometry(0.045, 8, 6).translate(0.11, -0.04, 0),
    ])!;
    const skullGeo = mergeGeometries([
      new THREE.SphereGeometry(0.125, 18, 14).scale(1, 1.08, 1.12).translate(0, 0.15, 0),
      new THREE.BoxGeometry(0.13, 0.07, 0.09).translate(0, 0.06, 0.07),
      new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6).translate(0, 0.0, 0),
    ])!;
    const jawGeo = mergeGeometries([
      new THREE.BoxGeometry(0.12, 0.03, 0.05).translate(0, -0.02, 0.1),
      new THREE.BoxGeometry(0.02, 0.06, 0.09).translate(-0.055, 0.0, 0.05),
      new THREE.BoxGeometry(0.02, 0.06, 0.09).translate(0.055, 0.0, 0.05),
    ])!;
    const socketGeo = new THREE.SphereGeometry(0.034, 10, 8);
    const eyeGeo = new THREE.SphereGeometry(0.019, 8, 6);
    const upperArm = capsule(0.025, 0.27);
    const foreArm = mergeGeometries([capsule(0.018, 0.25), capsule(0.012, 0.25).translate(0.025, 0, 0)])!;
    const handParts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.06, 0.07, 0.02).translate(0, -0.05, 0)];
    for (let f = 0; f < 4; f++) handParts.push(capsule(0.008, 0.07).rotateZ((f - 1.5) * 0.12).translate((f - 1.5) * 0.017, -0.09, 0));
    handParts.push(capsule(0.009, 0.05).rotateZ(0.7).translate(0.035, -0.04, 0.01));
    const handGeo = mergeGeometries(handParts)!;
    const thighGeo = capsule(0.032, 0.38);
    const shinGeo = mergeGeometries([capsule(0.026, 0.38), capsule(0.014, 0.36).translate(0.035, -0.01, 0)])!;
    const footGeo = new THREE.BoxGeometry(0.08, 0.04, 0.2).translate(0, -0.02, 0.06);

    const mk = (g: THREE.BufferGeometry, parent: THREE.Object3D, m: THREE.Material = this.boneMat) => {
      const mesh = new THREE.Mesh(g, m);
      parent.add(mesh);
      return mesh;
    };
    const grp = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    for (let i = 0; i < COUNT; i++) {
      const o = i - (COUNT - 1) / 2;
      const root = new THREE.Group();
      const baseX = o * 1.5;
      const baseZ = -Math.abs(o) * 0.35 + (o === 0 ? 0.5 : 0);
      root.position.set(baseX, STAGE_Y, baseZ);
      root.scale.setScalar(o === 0 ? 1.12 : 1);
      this.scene.add(root);
      const hips = grp(root, 0, 0.88, 0);
      mk(pelvisGeo, hips);
      const spine = grp(hips, 0, 0.04, 0);
      mk(torsoGeo, spine);
      const neck = grp(spine, 0, 0.64, 0);
      mk(skullGeo, neck);
      for (const side of [-1, 1]) {
        const so = mk(socketGeo, neck, socketMat);
        so.position.set(side * 0.045, 0.15, 0.105);
        so.scale.set(1, 0.9, 0.5);
        const e = mk(eyeGeo, neck, this.eyeMat);
        e.position.set(side * 0.045, 0.15, 0.115);
      }
      const jaw = grp(neck, 0, 0.04, 0.0);
      mk(jawGeo, jaw);
      const arm = (side: number) => {
        const sh = grp(spine, side * 0.19, 0.55, 0.0);
        mk(upperArm, sh);
        const el = grp(sh, 0, -0.29, 0);
        mk(foreArm, el).scale.x = side;
        const hand = grp(el, 0, -0.27, 0);
        mk(handGeo, hand).scale.x = side;
        return { sh, el };
      };
      const L = arm(1);
      const R = arm(-1);
      const leg = (side: number) => {
        const hip = grp(hips, side * 0.11, -0.05, 0);
        mk(thighGeo, hip);
        const knee = grp(hip, 0, -0.4, 0);
        mk(shinGeo, knee).scale.x = side;
        const foot = grp(knee, 0, -0.4, 0);
        mk(footGeo, foot);
        return { hip, knee };
      };
      const LL = leg(1);
      const RL = leg(-1);
      this.rigs.push({
        root, hips, spine, neck, jaw,
        lSh: L.sh, rSh: R.sh, lEl: L.el, rEl: R.el,
        lHip: LL.hip, rHip: RL.hip, lKnee: LL.knee, rKnee: RL.knee,
        baseX, baseZ,
        pose: new Float32Array(CH),
        target: new Float32Array(CH),
        seed: i * 1.37,
      });

      // blob shadow
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: dotTexture(), color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      shadow.position.set(baseX, STAGE_Y + 0.005, baseZ);
      this.scene.add(shadow);
    }

    // Crypt: stone wall, pillars, floor, stage
    const wallTex = stoneTexture(10, 5, [70, 62, 78], 77);
    wallTex.repeat.set(5, 2);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
    wall.position.set(0, 7, -3.4);
    this.scene.add(wall);
    const floorTex = stoneTexture(6, 6, [55, 50, 62], 91);
    floorTex.repeat.set(8, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75 }));
    floor.position.set(0, 0, 8);
    this.scene.add(floor);
    const stageTex = stoneTexture(4, 8, [60, 54, 66], 33);
    stageTex.repeat.set(4, 1);
    const stage = new THREE.Mesh(new THREE.BoxGeometry(15, STAGE_Y, 5.5), new THREE.MeshStandardMaterial({ map: stageTex, roughness: 0.6 }));
    stage.position.set(0, STAGE_Y / 2, -0.6);
    this.scene.add(stage);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a3442, roughness: 0.9 });
    const pillarGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.42, 0.48, 9, 12).translate(0, 4.5, 0),
      new THREE.BoxGeometry(1.2, 0.4, 1.2).translate(0, 0.2, 0),
      new THREE.BoxGeometry(1.2, 0.4, 1.2).translate(0, 9.1, 0),
      new THREE.CylinderGeometry(0.6, 0.42, 0.4, 12).translate(0, 8.7, 0),
    ])!;
    for (const x of [-11, -7.8, 7.8, 11]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, 0, -2.6);
      this.scene.add(p);
    }
    // Gothic arch above the stage
    const arch = new THREE.Mesh(new THREE.TorusGeometry(7.8, 0.35, 8, 40, Math.PI), pillarMat);
    arch.position.set(0, 9.1, -2.9);
    arch.scale.set(1, 0.55, 1);
    this.scene.add(arch);
    // Skull niches: rows of tiny skulls stacked along the wall (ossuary)
    const ossGeo = new THREE.SphereGeometry(0.16, 8, 6).scale(1, 1.05, 0.9);
    const ossSpots: number[][] = [];
    for (const side of [-1, 1]) for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) ossSpots.push([side * (13.2 + c * 0.38 + (r % 2) * 0.19), 0.9 + r * 0.33, -3.2]);
    const oss = new THREE.InstancedMesh(ossGeo, this.boneMat, ossSpots.length);
    const d = new THREE.Object3D();
    ossSpots.forEach(([x, y, z], i) => {
      d.position.set(x, y, z);
      d.rotation.set(0, (Math.random() - 0.5) * 0.5, 0);
      d.updateMatrix();
      oss.setMatrixAt(i, d.matrix);
    });
    this.scene.add(oss);

    // Candles on wall sconces
    const candlePos: number[] = [];
    for (const x of [-12.6, -9.4, -5.5, 5.5, 9.4, 12.6]) {
      candlePos.push(x, 4.2, -3.2);
      const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 0.25), pillarMat);
      sconce.position.set(x, 3.9, -3.25);
      this.scene.add(sconce);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(candlePos, 3));
    this.candles = new THREE.Points(
      cg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        size: 0.6,
        color: new THREE.Color(1.6, 0.7, 0.25),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.candles);

    // Lights
    this.hemi = new THREE.HemisphereLight(0x3a2f5a, 0x050307, 0.35);
    this.scene.add(this.hemi);
    for (const [x, col] of [[-4, 0x7a3cff], [4, 0x2cff8a]] as const) {
      const up = new THREE.PointLight(col, 10, 10, 1.4);
      up.position.set(x, 0.3, -3.25);
      this.uplights.push(up);
      this.scene.add(up);
    }
    this.backLight = new THREE.DirectionalLight(0x5cff9a, 1.2);
    this.backLight.position.set(0, 6, -10);
    this.scene.add(this.backLight);
    const spotDefs = [
      [-4.5, 6.2, 2.6, -3, -0.3],
      [0, 6.6, 2.9, 0, -0.3],
      [4.5, 6.2, 2.6, 3, -0.3],
    ];
    spotDefs.forEach(([x, y, z, tx, tz], k) => {
      const s = new THREE.SpotLight(0xffffff, 60, 30, 0.42, 0.55, 1.6);
      s.position.set(x, y, z);
      s.target.position.set(tx, STAGE_Y, tz);
      this.scene.add(s, s.target);
      s.color.copy(SPOT_COLORS[k * 2]);
      this.spots.push(s);
      this.spotTargets.push(SPOT_COLORS[k * 2].clone());
      // volumetric cone
      const from = new THREE.Vector3(x, y, z);
      const to = new THREE.Vector3(tx, STAGE_Y, tz);
      const len = from.distanceTo(to);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1, 1, 32, 1, true).translate(0, -0.5, 0),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color() }, uInt: { value: 0.06 } },
          vertexShader: /* glsl */ `
            varying float vT;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
              vT = -position.y;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vN = normalize(normalMatrix * normal);
              vV = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uInt;
            varying float vT;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
              float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
              float a = uInt * f * (1.0 - vT * 0.55) * smoothstep(0.0, 0.05, vT);
              gl_FragColor = vec4(uColor * a, 1.0);
            }`,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      cone.position.copy(from);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      const rad = Math.tan(0.42) * len * 0.85;
      cone.scale.set(rad, len, rad);
      this.cones.push(cone);
      this.scene.add(cone);
    });

    // Low smoke rolling across the stage
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, density: { value: 0.4 }, color: { value: new THREE.Color() }, seed: { value: i * 5.1 } },
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
          uniform float time, density, seed;
          uniform vec3 color;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vec3(vWorld.xz * vec2(0.25, 0.4) + vec2(time * 0.12, 0.0), time * 0.08 + seed));
            float a = smoothstep(-0.25, 0.7, n) * density;
            a *= smoothstep(9.0, 4.0, abs(vWorld.x)) * smoothstep(5.0, 1.0, abs(vWorld.z - 0.2));
            gl_FragColor = vec4(color, a);
          }`,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 10).rotateX(-Math.PI / 2), mat);
      plane.position.set(0, STAGE_Y + 0.12 + i * 0.22, 0);
      this.smoke.push(plane);
      this.scene.add(plane);
    }

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 45;
    cam.far = 200;
    cam.updateProjectionMatrix();
  }

  /** Beat-phase tracker: median beat interval + phase-locked accumulator that free-runs when beats stop. */
  private trackTempo(dt: number, time: number, audio: AudioFeatures) {
    this.beatPos += dt / this.period;
    if (!audio.beat) return;
    const iv = time - this.lastBeat;
    this.lastBeat = time;
    if (iv > 0.27 && iv < 1.3) {
      // fold onto the current period to tolerate missed/extra beats
      let v = iv;
      if (v > this.period * 1.6) v /= Math.round(v / this.period);
      else if (v < this.period * 0.65) v *= Math.round(this.period / v);
      this.intervals.push(v);
      if (this.intervals.length > 9) this.intervals.shift();
      this.sorted.length = 0;
      for (const x of this.intervals) this.sorted.push(x);
      this.sorted.sort((a, b) => a - b);
      const med = this.sorted[this.sorted.length >> 1];
      this.period = THREE.MathUtils.clamp(this.period * 0.6 + med * 0.4, 0.3, 1.0);
    }
    const err = Math.round(this.beatPos) - this.beatPos;
    this.beatPos += err * 0.6;
  }

  private computePose(t: Float32Array, b: number, move: number, A: number, i: number, sinceDrop: number) {
    t.fill(0);
    const c = Math.cos(Math.PI * b); // ±1 on alternate beats
    const dip = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * b), 2); // 1 on every beat
    const half = Math.sin((Math.PI * b) / 2);
    t[P.y] = -0.07 * dip * A;
    t[P.lKnee] = t[P.rKnee] = 0.35 * dip * A;
    t[P.lHip] = t[P.rHip] = 0.18 * dip * A;
    t[P.spineX] = 0.06 * dip * A;
    t[P.neckX] = 0.22 * dip * A;
    t[P.lOut] = t[P.rOut] = 0.15;
    t[P.lEl] = t[P.rEl] = 0.2;
    switch (move) {
      case 0: // swing bounce
        t[P.lFwd] = 0.7 * c * A;
        t[P.rFwd] = -0.7 * c * A;
        t[P.lEl] = t[P.rEl] = 0.5 + 0.4 * dip * A;
        t[P.spineY] = 0.15 * c * A;
        t[P.neckZ] = 0.15 * c * A;
        break;
      case 1: { // kick line
        const lk = Math.pow(Math.max(0, c), 2) * A;
        const rk = Math.pow(Math.max(0, -c), 2) * A;
        t[P.lHip] = 1.25 * lk;
        t[P.rHip] = 1.25 * rk;
        t[P.lKnee] = 0.15 + 0.5 * (1 - lk) * dip;
        t[P.rKnee] = 0.15 + 0.5 * (1 - rk) * dip;
        t[P.lOut] = t[P.rOut] = 1.35;
        t[P.lEl] = t[P.rEl] = 0.15;
        t[P.spineX] = -0.12 * A;
        t[P.neckZ] = 0.25 * c * A;
        t[P.y] = 0.04 * (1 - dip) * A;
        break;
      }
      case 2: // raise the roof
        t[P.lOut] = t[P.rOut] = 2.6;
        t[P.lFwd] = t[P.rFwd] = 0.25;
        t[P.lEl] = t[P.rEl] = 0.4 + 0.9 * dip * A;
        t[P.x] = 0.14 * c * A;
        t[P.spineZ] = 0.14 * c * A;
        t[P.pelvisZ] = -0.12 * c * A;
        break;
      case 3: { // zombie claw shuffle
        const st = Math.max(0, c) * A;
        const st2 = Math.max(0, -c) * A;
        t[P.lFwd] = t[P.rFwd] = 1.45;
        t[P.lOut] = t[P.rOut] = 0.12;
        t[P.lEl] = 0.25 + 0.3 * st;
        t[P.rEl] = 0.25 + 0.3 * st2;
        t[P.x] = 0.35 * half * A;
        t[P.rotY] = 0.35 * half * A;
        t[P.lHip] = 0.6 * st;
        t[P.lKnee] = 1.0 * st;
        t[P.rHip] = 0.6 * st2;
        t[P.rKnee] = 1.0 * st2;
        t[P.neckZ] = 0.35;
        t[P.spineX] = 0.18;
        break;
      }
      case 4: { // twist wave (canon across the line)
        const cb = Math.cos(Math.PI * (b - i * 0.25));
        t[P.spineY] = 0.7 * cb * A;
        t[P.rotY] = -0.35 * cb * A;
        t[P.lOut] = t[P.rOut] = 0.7;
        t[P.lFwd] = t[P.rFwd] = 0.4;
        t[P.lEl] = t[P.rEl] = 1.6;
        t[P.lKnee] = t[P.rKnee] = 0.45 + 0.3 * dip * A;
        t[P.lHip] = t[P.rHip] = 0.25 + 0.15 * dip * A;
        t[P.y] = -0.1 - 0.06 * dip * A;
        break;
      }
      default: // headbang with air guitar
        t[P.neckX] = 0.65 * dip * A - 0.15;
        t[P.spineX] = 0.3 * dip * A;
        t[P.lOut] = 2.7;
        t[P.lFwd] = 0.35;
        t[P.lEl] = 0.25 + 0.35 * dip * A;
        t[P.rFwd] = 0.9;
        t[P.rOut] = 0.35;
        t[P.rEl] = 1.3 + 0.4 * Math.sin(Math.PI * 4 * b) * A;
        t[P.lKnee] = t[P.rKnee] = 0.45 * dip * A + 0.1;
        break;
    }
    // drop: big synchronized jump with arms up and tucked legs
    if (sinceDrop < 1.6) {
      const k = sinceDrop < 0.15 ? sinceDrop / 0.15 : sinceDrop > 1.2 ? (1.6 - sinceDrop) / 0.4 : 1;
      const tuck = sinceDrop > 0.2 && sinceDrop < 1.05 ? Math.sin(((sinceDrop - 0.2) / 0.85) * Math.PI) : 0;
      t[P.lOut] = THREE.MathUtils.lerp(t[P.lOut], 2.85, k);
      t[P.rOut] = THREE.MathUtils.lerp(t[P.rOut], 2.85, k);
      t[P.lFwd] = THREE.MathUtils.lerp(t[P.lFwd], 0.1, k);
      t[P.rFwd] = THREE.MathUtils.lerp(t[P.rFwd], 0.1, k);
      t[P.lEl] = t[P.rEl] = THREE.MathUtils.lerp(t[P.lEl], 0.1, k);
      t[P.lHip] = t[P.rHip] = 1.2 * tuck;
      t[P.lKnee] = t[P.rKnee] = 2.0 * tuck;
      t[P.neckX] = -0.4 * tuck;
      t[P.spineX] = 0.1 * tuck;
    }
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    this.trackTempo(dt, time, audio);
    const b = this.beatPos;
    const beatsActive = time - this.lastBeat < 1.8;
    this.amp = damp(this.amp, beatsActive ? 0.7 + 0.3 * Math.min(1, audio.level * 3) : 0.35, 2.5, dt);

    if (audio.drop) {
      this.dropTime = time;
      const cur = Math.floor(b / 8);
      this.moveShift = (((1 - cur) % MOVES) + MOVES) % MOVES;
    }
    const sinceDrop = time - this.dropTime;
    const move = (Math.floor(b / 8) + this.moveShift) % MOVES;
    const dropEnv = sinceDrop < 5 ? Math.exp(-sinceDrop * 0.7) : 0;

    // drop jump trajectory and spin (not smoothed)
    const JUMP = 1.0;
    let jumpY = 0;
    let spin = 0;
    if (sinceDrop > 0.12 && sinceDrop < 0.12 + JUMP) {
      const s = (sinceDrop - 0.12) / JUMP;
      jumpY = 4 * 1.05 * s * (1 - s);
      spin = (s * s * (3 - 2 * s)) * Math.PI * 2;
    } else if (sinceDrop <= 0.12) {
      jumpY = -0.12 * (sinceDrop / 0.12);
    }

    const jawOpen = 0.06 + audio.mid * 0.5;
    for (let i = 0; i < this.rigs.length; i++) {
      const r = this.rigs[i];
      this.computePose(r.target, b - i * 0.01, move, this.amp, i, sinceDrop);
      const lambda = 22;
      for (let k = 0; k < CH; k++) r.pose[k] = damp(r.pose[k], r.target[k], lambda, dt);
      const p = r.pose;
      r.root.position.set(r.baseX + p[P.x], STAGE_Y + p[P.y] + jumpY, r.baseZ);
      r.root.rotation.y = p[P.rotY] + spin * (i % 2 ? -1 : 1);
      r.hips.rotation.set(0, 0, p[P.pelvisZ]);
      r.spine.rotation.set(p[P.spineX], p[P.spineY], p[P.spineZ] - p[P.pelvisZ]);
      r.neck.rotation.set(p[P.neckX], 0, p[P.neckZ]);
      r.jaw.rotation.x = jawOpen * (0.5 + 0.5 * Math.sin(time * 26 + r.seed * 3)) + audio.beatPulse * 0.18;
      r.lSh.rotation.set(-p[P.lFwd], 0, p[P.lOut]);
      r.rSh.rotation.set(-p[P.rFwd], 0, -p[P.rOut]);
      r.lEl.rotation.set(-p[P.lEl], 0, 0);
      r.rEl.rotation.set(-p[P.rEl], 0, 0);
      r.lHip.rotation.set(-p[P.lHip], 0, -p[P.pelvisZ]);
      r.rHip.rotation.set(-p[P.rHip], 0, -p[P.pelvisZ]);
      r.lKnee.rotation.x = p[P.lKnee];
      r.rKnee.rotation.x = p[P.rKnee];
    }

    // Glows
    const red = Math.min(1, dropEnv * 1.3);
    this.rimUniform.value.copy(PALETTE.toxic).multiplyScalar(0.08 + audio.beatPulse * 0.25 + audio.mid * 0.15);
    this.rimUniform.value.lerp(this.tmpColor.setRGB(0.9, 0.05, 0.05), red * 0.8);
    const eye = 1.6 + audio.mid * 4 + audio.beatPulse * 2 + dropEnv * 3;
    this.eyeMat.color.setRGB(0.25 * eye, eye, 0.5 * eye).lerp(this.tmpColor.setRGB(eye * 1.2, 0.1, 0.05), red);
    this.backLight.intensity = 1.0 + audio.bass * 1.2 + dropEnv * 2;
    this.backLight.color.setRGB(0.36 + red * 0.6, 1 - red * 0.8, 0.6 - red * 0.5);

    // Spotlights change colour on beats
    if (audio.beat) {
      this.colorIdx++;
      for (let k = 0; k < this.spotTargets.length; k++) this.spotTargets[k].copy(SPOT_COLORS[(this.colorIdx + k * 2) % SPOT_COLORS.length]);
    }
    if (audio.drop) for (const t of this.spotTargets) t.copy(PALETTE.blood);
    for (let k = 0; k < this.spots.length; k++) {
      const s = this.spots[k];
      s.color.lerp(this.spotTargets[k], 1 - Math.exp(-12 * dt));
      const sweep = Math.sin(time * (0.5 + k * 0.13) + k * 2) * (1.6 + dropEnv * 1.5);
      s.target.position.x = (k - 1) * 3 + sweep;
      s.intensity = 60 + audio.bass * 70 + audio.beatPulse * 50 + dropEnv * 60;
      const cone = this.cones[k];
      cone.material.uniforms.uColor.value.copy(s.color);
      cone.material.uniforms.uInt.value = 0.1 + audio.beatPulse * 0.08 + audio.bass * 0.06;
      const dx = s.target.position.x - s.position.x;
      const dy = STAGE_Y - s.position.y;
      const dz = s.target.position.z - s.position.z;
      const len = Math.hypot(dx, dy, dz);
      cone.quaternion.setFromUnitVectors(DOWN, this.tmpVec.set(dx / len, dy / len, dz / len));
    }

    const smokeCol = this.tmpColor.copy(this.spots[0].color).add(this.spots[1].color).add(this.spots[2].color).multiplyScalar(0.12).addScalar(0.05);
    for (const s of this.smoke) {
      s.material.uniforms.time.value = time;
      s.material.uniforms.density.value = 0.22 + audio.bass * 0.25 + dropEnv * 0.25;
      s.material.uniforms.color.value.copy(smokeCol);
    }
    this.candles.material.size = 0.5 + 0.12 * Math.sin(time * 13) * Math.sin(time * 5.7) + audio.treble * 0.3;
    this.hemi.intensity = 0.3 + dropEnv * 0.3;
    for (let k = 0; k < this.uplights.length; k++) this.uplights[k].intensity = 8 + (k ? audio.treble : audio.bass) * 14 + audio.beatPulse * 6;

    // Camera drift
    const cam = this.camera as THREE.PerspectiveCamera;
    const shake = audio.bass * 0.02 + (sinceDrop > 1.1 && sinceDrop < 1.6 ? 0.12 * (1.6 - sinceDrop) : 0);
    cam.position.set(
      Math.sin(time * 0.09) * 2.2 + (Math.random() - 0.5) * shake,
      2.1 + Math.sin(time * 0.13) * 0.3 + (Math.random() - 0.5) * shake,
      7.4 + Math.sin(time * 0.07) * 0.8 - dropEnv * 0.8,
    );
    cam.lookAt(Math.sin(time * 0.09) * 0.6, 1.5, 0);
  }

  private tmpVec = new THREE.Vector3();
  private uplights: THREE.PointLight[] = [];
}
