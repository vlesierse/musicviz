import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { batTexture, dotTexture } from '../core/shapes';
import { SpectrumTexture, Visual, damp, fullscreenQuad } from '../core/Visual';

const FOG_COLOR = new THREE.Color(0x0d0a1a);
const BATS = 46;
const DUST = 700;
const MANSION_Z = -34;
const MANSION_SCALE = 1.15;
const WAVES = 4;

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Rolling ground with a hill that the mansion sits on. */
const heightAt = (x: number, z: number) => {
  const dz = z - MANSION_Z;
  const hill = 5.2 * Math.exp(-(x * x * 0.5 + dz * dz) / (2 * 15 * 15));
  return hill + Math.sin(x * 0.21 + z * 0.13) * 0.18 + Math.sin(x * 0.07 - z * 0.05) * 0.35;
};

/** Strip uvs and indices so every part can be merged together. */
const ni = (g: THREE.BufferGeometry) => {
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};

/** Triangular prism (gabled roof) spanning `w` along x, `d` along z, peak height `h`. */
function gable(w: number, d: number, h: number, over = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2 - over, 0);
  s.lineTo(d / 2 + over, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w + over * 2, bevelEnabled: false });
  g.translate(0, 0, -(w + over * 2) / 2);
  g.rotateY(Math.PI / 2);
  return ni(g);
}

function tombstoneGeometry(kind: number, rand: () => number) {
  if (kind === 2) {
    const v = new THREE.BoxGeometry(0.22, 1.7, 0.2).translate(0, 0.85, 0);
    const h = new THREE.BoxGeometry(0.9, 0.22, 0.2).translate(0, 1.2, 0);
    return mergeGeometries([v, h])!;
  }
  const w = 0.85 + rand() * 0.4;
  const hgt = 1.2 + rand() * 0.6;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  if (kind === 0) {
    s.lineTo(-w / 2, hgt - w / 2);
    s.absarc(0, hgt - w / 2, w / 2, Math.PI, 0, true);
  } else {
    s.lineTo(-w / 2, hgt);
    s.lineTo(-w * 0.2, hgt + 0.18);
    s.lineTo(w * 0.2, hgt + 0.18);
    s.lineTo(w / 2, hgt);
  }
  s.lineTo(w / 2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 12 });
  g.deleteAttribute('uv');
  return g.translate(0, 0, -0.1);
}

function treeGeometry(rand: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = start.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(radius * 0.62, radius, len, 6, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(start.x, start.y, start.z);
    parts.push(g);
    if (depth <= 0) return;
    const n = depth > 2 ? 2 + Math.floor(rand() * 2) : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      d.x += (rand() - 0.5) * 1.8;
      d.z += (rand() - 0.5) * 1.2;
      d.y += (rand() - 0.3) * 0.6;
      d.normalize();
      branch(end, d, len * (0.6 + rand() * 0.2), radius * 0.6, depth - 1);
    }
  };
  branch(new THREE.Vector3(), new THREE.Vector3((rand() - 0.5) * 0.3, 1, 0).normalize(), 2.8, 0.32, 5);
  return mergeGeometries(parts)!;
}

interface WindowSpot {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  col: number;
  row: number;
  rows: number;
  round?: boolean;
}

interface Stone {
  mesh: number;
  index: number;
  x: number;
  z: number;
  y: number;
  ry: number;
  scale: number;
  band: number;
  level: number;
  seed: number;
  rowDist: number;
}

/** 15. A haunted Victorian mansion whose windows are an equalizer, above a graveyard of dancing gravestones. */
export class HauntedMansionVisual extends Visual {
  readonly name = 'Haunted Mansion';
  bloom = 0.9;
  private sky!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moon!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private hemi!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;
  private fill!: THREE.DirectionalLight;
  private doorLight!: THREE.PointLight;
  private graveLights: THREE.PointLight[] = [];
  private spectrum = new SpectrumTexture(64);
  private winUniforms!: Record<string, THREE.IUniform>;
  private windowCount = 0;
  private stones: Stone[] = [];
  private stoneMeshes: THREE.InstancedMesh[] = [];
  private fogLayers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private bats!: THREE.InstancedMesh;
  private batUniforms!: Record<string, THREE.IUniform>;
  private batParams = new Float32Array(BATS * 5);
  private dust!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private dustPos = new Float32Array(DUST * 3);
  private dustVel = new Float32Array(DUST * 3);
  private dustLife = new Float32Array(DUST);
  private dustCursor = 0;
  private tower = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private waves = new Float32Array(WAVES).fill(-100);
  private waveAmp = new Float32Array(WAVES);
  private waveCursor = 0;
  private dropTime = -100;
  private slammed = true;
  private shake = 0;
  private lightning = 0;
  private lastStrike = -10;
  private boltX = 0;
  private ghostStart = -100;
  private nextGhost = 3;
  private flapTime = 0;
  private orbit = 0;
  private boost = 0;

  protected setup() {
    const rand = rng(4242);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.016);

    // Stormy sky with lightning bolts.
    this.sky = fullscreenQuad(
      /* glsl */ `
      uniform float time, flash, aspect, boltX, bolt, red;
      varying vec2 vUv;
      ${GLSL_NOISE}
      float fbm4(vec3 p) {
        float f = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; }
        return f;
      }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec3 col = mix(vec3(0.05, 0.035, 0.09), vec3(0.008, 0.004, 0.02), smoothstep(-0.2, 0.5, p.y));
        float n = fbm4(vec3(p * vec2(1.4, 3.2) + vec2(time * 0.05, 0.0), time * 0.04));
        float n2 = fbm4(vec3(p * vec2(2.5, 5.0) - vec2(time * 0.09, 0.0), time * 0.06 + 4.0));
        float dens = smoothstep(-0.1, 0.6, n * 0.7 + n2 * 0.4);
        col = mix(col, vec3(0.07, 0.05, 0.12) * (0.6 + n2 * 0.6), dens * smoothstep(-0.3, 0.2, p.y));
        vec2 sp = floor(vUv * vec2(aspect, 1.0) * 240.0);
        float h = hash21(sp);
        col += step(0.9975, h) * smoothstep(0.05, 0.4, p.y) * (1.0 - dens) * (0.5 + 0.4 * sin(time * 3.0 + h * 50.0));
        // forked lightning bolt
        float by = p.y;
        float off = boltX + 0.06 * snoise(vec3(by * 6.0, boltX * 10.0, floor(time * 12.0) * 0.0 + boltX))
          + 0.025 * snoise(vec3(by * 22.0, boltX * 3.0, 1.0));
        float dB = abs(p.x - off);
        float fork = abs(p.x - (off + (0.35 - by) * 0.35 + 0.02 * snoise(vec3(by * 18.0, 2.0, boltX))));
        float core = exp(-dB * 260.0) + 0.6 * exp(-fork * 300.0) * step(by, 0.3) * step(-0.1, by);
        float glow = exp(-dB * 18.0) * 0.25;
        float vis = smoothstep(-0.12, 0.0, by);
        col += bolt * vis * (core * vec3(2.6, 2.4, 3.2) + glow * vec3(0.5, 0.45, 0.9));
        col += flash * vec3(0.32, 0.28, 0.55) * (0.4 + dens);
        col = mix(col, col * vec3(1.6, 0.4, 0.45) + vec3(0.03, 0.0, 0.0), red * 0.7);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, flash: { value: 0 }, aspect: { value: 1 }, boltX: { value: 0 }, bolt: { value: 0 }, red: { value: 0 } },
    );
    this.scene.add(this.sky);

    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { glow: { value: 0 }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float glow, time;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float disc = smoothstep(0.36, 0.355, r);
            float craters = fbm(vec3(p * 4.0, 1.0)) * 0.5 + 0.5;
            vec3 moon = ${glslColor(PALETTE.moon)} * (0.6 + 0.5 * craters) * 0.8;
            // clouds drifting across the face
            float c = smoothstep(0.1, 0.6, fbm(vec3(p * vec2(1.5, 4.0) + vec2(time * 0.06, 0.0), time * 0.05)));
            moon *= 1.0 - c * 0.6;
            float halo = exp(-max(r - 0.35, 0.0) * 6.0) * (0.25 + glow * 0.35);
            vec3 col = moon * disc + ${glslColor(PALETTE.moon)} * halo * (1.0 - disc) * 0.6;
            gl_FragColor = vec4(col, max(disc, halo));
          }`,
        fog: false,
      }),
    );
    this.moon.renderOrder = -500;
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0x3a3170, 0x07040c, 0.55);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0xa8b4ff, 1.5);
    this.moonLight.position.set(-0.35, 0.55, -1).multiplyScalar(60);
    this.scene.add(this.moonLight);
    this.fill = new THREE.DirectionalLight(0x6d5fb0, 0.45);
    this.fill.position.set(0.3, 0.5, 1).multiplyScalar(60);
    this.scene.add(this.fill);

    // Ground
    const ground = new THREE.PlaneGeometry(240, 240, 140, 140);
    ground.rotateX(-Math.PI / 2);
    const gp = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)));
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: 0x16111f, roughness: 1 })));

    this.buildMansion(rand);
    this.buildGraveyard(rand);

    // Iron fence across the foreground and down the sides.
    const bar = mergeGeometries([
      ni(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 5).translate(0, 0.85, 0)),
      ni(new THREE.ConeGeometry(0.08, 0.28, 4).translate(0, 1.82, 0)),
    ])!;
    const fenceSpots: number[][] = [];
    for (let x = -18; x <= 18; x += 0.32) if (Math.abs(x) > 1.5) fenceSpots.push([x, 10.5]);
    for (const sx of [-18, 18]) for (let z = 10.5; z > -14; z -= 0.32) fenceSpots.push([sx, z]);
    const iron = new THREE.MeshStandardMaterial({ color: 0x0a080d, roughness: 0.5, metalness: 0.6 });
    const fence = new THREE.InstancedMesh(bar, iron, fenceSpots.length);
    fenceSpots.forEach(([x, z], i) => {
      this.dummy.position.set(x, heightAt(x, z) - 0.05, z);
      this.dummy.rotation.set((rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.06);
      this.dummy.scale.set(1, 0.9 + rand() * 0.2, 1);
      this.dummy.updateMatrix();
      fence.setMatrixAt(i, this.dummy.matrix);
    });
    this.scene.add(fence);
    for (const y of [0.35, 1.45]) {
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(16.5, 0.06, 0.05), iron);
        rail.position.set(side * 9.75, heightAt(side * 9.75, 10.5) + y, 10.5);
        this.scene.add(rail);
        const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 24.5), iron);
        sideRail.position.set(side * 18, heightAt(side * 18, -1.75) + y, -1.75);
        this.scene.add(sideRail);
      }
    }
    // Gate posts
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.95 }));
      post.position.set(side * 1.75, heightAt(side * 1.75, 10.5) + 1.3, 10.5);
      this.scene.add(post);
    }

    // Dead trees
    const bark = new THREE.MeshStandardMaterial({ color: 0x09060c, roughness: 1 });
    for (const [x, z, s] of [[-14, 2, 1.7], [15, -4, 1.9], [-22, -16, 2.3], [24, -22, 2.1], [-9, -22, 1.4]]) {
      const t = new THREE.Mesh(treeGeometry(rand), bark);
      t.position.set(x, heightAt(x, z) - 0.2, z);
      t.rotation.y = rand() * Math.PI * 2;
      t.scale.setScalar(s);
      this.scene.add(t);
    }

    // Ground fog
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, flash: { value: 0 }, density: { value: 0.5 }, seed: { value: i * 7.3 } },
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
          uniform float time, flash, density, seed;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vec3(vWorld.xz * 0.07 + vec2(time * 0.06, time * 0.02), time * 0.04 + seed));
            float a = smoothstep(-0.2, 0.8, n) * density;
            float dist = length(vWorld.xz - cameraPosition.xz);
            a *= smoothstep(2.0, 8.0, dist) * (1.0 - smoothstep(40.0, 80.0, dist));
            vec3 col = mix(vec3(0.2, 0.17, 0.34), vec3(0.8, 0.78, 1.0), flash);
            gl_FragColor = vec4(col, a);
          }`,
      });
      const fog = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), mat);
      fog.position.y = 0.3 + i * 0.5;
      this.fogLayers.push(fog);
      this.scene.add(fog);
    }

    // Bats circling the tower
    const bgeo = new THREE.PlaneGeometry(1, 1, 10, 1);
    const phase = new Float32Array(BATS * 2);
    for (let i = 0; i < BATS; i++) {
      phase[i * 2] = rand() * Math.PI * 2;
      phase[i * 2 + 1] = 0.8 + rand() * 0.4;
      this.batParams[i * 5] = 2.5 + rand() * 9; // radius
      this.batParams[i * 5 + 1] = -3 + rand() * 9; // height offset
      this.batParams[i * 5 + 2] = (0.35 + rand() * 0.5) * (rand() < 0.8 ? 1 : -1); // angular speed
      this.batParams[i * 5 + 3] = rand() * Math.PI * 2; // phase
      this.batParams[i * 5 + 4] = 0.6 + rand() * 0.7; // size
    }
    bgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 2));
    this.batUniforms = { map: { value: batTexture() }, flapTime: { value: 0 }, eyes: { value: 0 } };
    this.bats = new THREE.InstancedMesh(
      bgeo,
      new THREE.ShaderMaterial({
        uniforms: this.batUniforms,
        vertexShader: /* glsl */ `
          uniform float flapTime;
          attribute vec2 aPhase;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            float flap = sin(flapTime * aPhase.y + aPhase.x);
            float ax = abs(p.x);
            p.z += ax * flap * 0.7;
            p.y += ax * ax * flap * 0.6;
            p.x *= 1.0 - 0.25 * max(flap, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform float eyes;
          varying vec2 vUv;
          void main() {
            float a = texture2D(map, vUv).a;
            if (a < 0.3) discard;
            vec3 col = vec3(0.008, 0.004, 0.012);
            vec2 e = vec2(abs(vUv.x - 0.5) - 0.022, vUv.y - 0.565);
            col += vec3(2.5, 0.3, 0.06) * smoothstep(0.022, 0.0, length(e)) * eyes;
            gl_FragColor = vec4(col, 1.0);
          }`,
        side: THREE.DoubleSide,
      }),
      BATS,
    );
    this.bats.frustumCulled = false;
    this.scene.add(this.bats);

    // Dust kicked up by the stones
    const dg = new THREE.BufferGeometry();
    for (let i = 0; i < DUST; i++) this.dustPos[i * 3 + 1] = -100;
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        size: 0.55,
        color: new THREE.Color(0.16, 0.14, 0.22),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    // Lights: warm door glow and two wandering spectral lights in the graveyard.
    this.doorLight = new THREE.PointLight(0xff8a3a, 20, 18, 1.5);
    this.doorLight.position.set(0, heightAt(0, MANSION_Z + 7) + 2, MANSION_Z + 8);
    this.scene.add(this.doorLight);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(i ? 0x6cffb0 : 0x8fa0ff, 4, 12, 1.6);
      this.graveLights.push(l);
      this.scene.add(l);
    }

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 55;
    cam.far = 500;
    cam.updateProjectionMatrix();
  }

  private buildMansion(rand: () => number) {
    const group = new THREE.Group();
    const baseY = heightAt(0, MANSION_Z) - 1.2;
    group.position.set(0, baseY, MANSION_Z);
    group.scale.setScalar(MANSION_SCALE);
    this.scene.add(group);

    const walls: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, list = walls) =>
      list.push(ni(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z)));

    // Main block, 3 floors
    box(14, 10, 8, 0, 0, 0);
    roofs.push(gable(14, 8, 4.2).translate(0, 10, 0));
    // Front cross-gable over the entrance
    box(5, 10, 1.2, 0, 0, 4.4);
    roofs.push(gable(2.2, 5.2, 3.6).rotateY(Math.PI / 2).translate(0, 10, 3.9));
    // Left wing, 2 floors
    box(7, 7, 7, -10.5, 0, 0.5);
    roofs.push(gable(7, 7, 3.4).rotateY(Math.PI / 2).translate(-10.5, 7, 0.5));
    // Octagonal tower on the right
    const towerR = 2.6;
    walls.push(ni(new THREE.CylinderGeometry(towerR, towerR, 15.5, 8).rotateY(Math.PI / 8).translate(9.5, 7.75, 2.2)));
    walls.push(ni(new THREE.CylinderGeometry(towerR + 0.35, towerR + 0.35, 0.4, 8).rotateY(Math.PI / 8).translate(9.5, 15.7, 2.2)));
    roofs.push(ni(new THREE.ConeGeometry(towerR + 0.5, 8, 8).rotateY(Math.PI / 8).translate(9.5, 15.9 + 4, 2.2)));
    roofs.push(ni(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4).translate(9.5, 24.8, 2.2)));
    roofs.push(ni(new THREE.OctahedronGeometry(0.25).translate(9.5, 24.5, 2.2)));
    // Small turret on the wing corner
    walls.push(ni(new THREE.CylinderGeometry(1.1, 1.1, 3, 8).translate(-13.5, 7, 3.6)));
    roofs.push(ni(new THREE.ConeGeometry(1.4, 4, 8).translate(-13.5, 10.5 + 2, 3.6)));
    // Chimneys
    box(1, 5, 1, -4.5, 11, -1.5, roofs);
    box(1, 4.5, 1, 4.2, 11, 1.2, roofs);
    box(0.9, 4, 0.9, -11.5, 8, -1.5, roofs);
    // Porch: slab roof + columns + steps
    box(6.5, 0.35, 2.6, 0, 3.6, 6.2, roofs);
    for (const x of [-2.9, -1.0, 1.0, 2.9]) walls.push(ni(new THREE.CylinderGeometry(0.15, 0.18, 3.6, 6).translate(x, 1.8, 7.2)));
    box(4, 0.3, 1.6, 0, 0, 7.4);
    box(3.4, 0.3, 1.2, 0, 0.3, 7.2);
    // Roof-ridge cresting spikes
    for (let x = -6.5; x <= 6.5; x += 0.7) roofs.push(ni(new THREE.ConeGeometry(0.06, 0.6, 4).translate(x, 14.4, 0)));

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1522, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.8, metalness: 0.2 });
    group.add(new THREE.Mesh(mergeGeometries(walls)!, wallMat));
    group.add(new THREE.Mesh(mergeGeometries(roofs)!, roofMat));

    // Windows: grouped into columns so each column maps to a spectrum band (left = bass, right = treble).
    const spots: WindowSpot[] = [];
    const fz = 4.01;
    for (const [c, x] of [-11.9, -9.1].entries()) for (let r = 0; r < 2; r++) spots.push({ x, y: 1.4 + r * 3.2, z: 4.01, w: 1.2, h: 2.0, col: c, row: r, rows: 2 });
    for (const [c, x] of [-5.6, -3.6, 3.6, 5.6].entries()) {
      for (let r = 0; r < 3; r++) spots.push({ x, y: 1.0 + r * 3.2, z: fz, w: 1.15, h: 2.1, col: c < 2 ? 2 + c : 4 + c, row: r, rows: 3 });
    }
    // Centre column on the cross-gable: door below, two windows and a round attic window.
    spots.push({ x: -1.0, y: 4.4, z: 5.01, w: 0.9, h: 2.1, col: 4, row: 0, rows: 3 });
    spots.push({ x: 1.0, y: 4.4, z: 5.01, w: 0.9, h: 2.1, col: 4, row: 0, rows: 3 });
    spots.push({ x: 0, y: 7.4, z: 5.01, w: 1.5, h: 2.0, col: 4, row: 1, rows: 3 });
    spots.push({ x: 0, y: 10.5, z: 5.37, w: 1.3, h: 1.3, col: 4, row: 2, rows: 3, round: true });
    // Tower: tall column of five windows
    const tf = towerR * Math.cos(Math.PI / 8) + 0.01;
    for (let r = 0; r < 5; r++) spots.push({ x: 9.5, y: 1.0 + r * 2.8, z: 2.2 + tf, w: 1.1, h: 2.0, col: 8, row: r, rows: 5 });
    const cols = 9;
    this.windowCount = spots.length;

    const wgeo = new THREE.PlaneGeometry(1, 1);
    const winData = new Float32Array(spots.length * 4);
    const winExtra = new Float32Array(spots.length * 2);
    const wmesh = new THREE.InstancedMesh(wgeo, new THREE.ShaderMaterial(), spots.length);
    spots.forEach((s, i) => {
      winData[i * 4] = 0.04 + (s.col / (cols - 1)) * 0.62; // band (texture u)
      winData[i * 4 + 1] = s.row / s.rows;
      winData[i * 4 + 2] = 1 / s.rows;
      winData[i * 4 + 3] = rand();
      winExtra[i * 2] = i;
      winExtra[i * 2 + 1] = s.round ? 1 : 0;
      this.dummy.position.set(s.x, s.y + s.h / 2, s.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s.w, s.h, 1);
      this.dummy.updateMatrix();
      wmesh.setMatrixAt(i, this.dummy.matrix);
    });
    wgeo.setAttribute('aWin', new THREE.InstancedBufferAttribute(winData, 4));
    wgeo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(winExtra, 2));
    this.winUniforms = {
      uSpec: { value: this.spectrum.texture },
      uTime: { value: 0 },
      uGhostId: { value: -1 },
      uGhostT: { value: 0 },
      uBoost: { value: 0 },
      uRed: { value: 0 },
      uFlash: { value: 0 },
    };
    wmesh.material = new THREE.ShaderMaterial({
      uniforms: this.winUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aWin;
        attribute vec2 aExtra;
        varying vec2 vUv;
        varying vec4 vWin;
        varying vec2 vExtra;
        varying float vDist;
        void main() {
          vUv = uv;
          vWin = aWin;
          vExtra = aExtra;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSpec;
        uniform float uTime, uGhostId, uGhostT, uBoost, uRed, uFlash;
        varying vec2 vUv;
        varying vec4 vWin;
        varying vec2 vExtra;
        varying float vDist;
        void main() {
          vec2 p = vUv - vec2(0.5, 0.0);
          float shape, mull;
          if (vExtra.y > 0.5) {
            float r = length(vUv - 0.5);
            shape = step(r, 0.46);
            mull = step(abs(p.x), 0.035) + step(abs(vUv.y - 0.5), 0.035) + step(abs(r - 0.25), 0.03);
          } else {
            float inRect = step(abs(p.x), 0.42) * step(0.04, vUv.y) * step(vUv.y, 0.74);
            float inArch = step(length((vUv - vec2(0.5, 0.74)) * vec2(1.0, 1.25)), 0.42) * step(0.74, vUv.y);
            shape = max(inRect, inArch);
            mull = step(abs(p.x), 0.03) + step(abs(vUv.y - 0.47), 0.022);
          }
          float frame = 1.0 - shape;
          if (frame > 0.5 && (abs(p.x) > 0.5 || vUv.y < 0.0)) discard;
          float level = texture2D(uSpec, vec2(vWin.x, 0.5)).r * 1.35 + uBoost;
          float lit = smoothstep(vWin.y, vWin.y + vWin.z * 0.7, level);
          float seed = vWin.w;
          float flick = 0.82 + 0.18 * sin(uTime * 13.0 + seed * 40.0) * sin(uTime * 7.3 + seed * 11.0);
          float idle = 0.05 + 0.1 * step(0.55, fract(seed * 13.7)) * (0.6 + 0.4 * sin(uTime * 0.7 + seed * 9.0));
          float ghost = step(abs(vExtra.x - uGhostId), 0.5);
          lit = max(lit, ghost * 0.85);
          float amt = max(lit, idle) * flick;
          // candle light pools at the bottom centre of the room
          float pool = 0.6 + 0.6 * exp(-dot(p - vec2(0.0, 0.25), p - vec2(0.0, 0.25)) * 6.0);
          vec3 warm = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.6, 0.26), lit);
          warm = mix(warm, vec3(1.0, 0.1, 0.12), uRed);
          vec3 col = warm * amt * pool * (0.9 + 0.7 * lit);
          // a dark figure drifting past the glass
          if (ghost > 0.5) {
            float gx = mix(-0.55, 0.55, uGhostT);
            vec2 g = vec2(p.x - gx, vUv.y);
            float head = step(length(g - vec2(0.0, 0.62)), 0.11);
            float body = step(abs(g.x), 0.17 - (g.y - 0.1) * 0.12) * step(g.y, 0.56) * step(0.0, g.y);
            float hand = step(length((g - vec2(0.2, 0.45)) * vec2(1.0, 2.5)), 0.07);
            float sil = max(max(head, body), hand);
            col *= 1.0 - sil * 0.93;
          }
          col *= 1.0 - clamp(mull, 0.0, 1.0) * 0.92;
          col = mix(vec3(0.012, 0.009, 0.016) + uFlash * 0.05, col, shape);
          gl_FragColor = vec4(col, 1.0);
        }`,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    group.add(wmesh);

    // Glowing doorway
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 0.18) }),
    );
    door.position.set(0, 1.3, 5.02);
    group.add(door);

    group.updateMatrixWorld(true);
    this.tower.set(9.5, 17, 2.2).applyMatrix4(group.matrixWorld);
  }

  private buildGraveyard(rand: () => number) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a84a0, roughness: 0.92 });
    const kinds = [0, 1, 2].map((k) => tombstoneGeometry(k, rand));
    const placements: { x: number; z: number; k: number; col: number; row: number }[] = [];
    const COLS = 12;
    for (let row = 0; row < 6; row++) {
      for (let c = 0; c < COLS; c++) {
        const x = -15.4 + c * 2.8 + (rand() - 0.5) * 0.6;
        if (Math.abs(x) < 1.6) continue;
        const z = 4 - row * 3.2 + (rand() - 0.5) * 0.8;
        const k = rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2;
        placements.push({ x, z, k, col: c, row });
      }
    }
    const counts = [0, 0, 0];
    for (const p of placements) counts[p.k]++;
    this.stoneMeshes = kinds.map((g, k) => {
      const m = new THREE.InstancedMesh(g, stoneMat, Math.max(1, counts[k]));
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    const used = [0, 0, 0];
    for (const p of placements) {
      this.stones.push({
        mesh: p.k,
        index: used[p.k]++,
        x: p.x,
        z: p.z,
        y: heightAt(p.x, p.z),
        ry: (rand() - 0.5) * 0.4,
        scale: 1.25 + rand() * 0.4,
        band: Math.min(63, Math.round(2 + (p.col / (COLS - 1)) * 40 + (rand() - 0.5) * 2)),
        level: 0,
        seed: rand() * 100,
        rowDist: (4 - p.z) + Math.abs(p.x) * 0.25,
      });
    }
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.sky) return;
    this.sky.material.uniforms.aspect.value = w / h;
  }

  private emitDust(x: number, y: number, z: number, n: number, power: number) {
    for (let k = 0; k < n; k++) {
      const i = this.dustCursor;
      this.dustCursor = (this.dustCursor + 1) % DUST;
      const a = Math.random() * Math.PI * 2;
      const s = (0.5 + Math.random()) * power;
      this.dustPos[i * 3] = x + Math.cos(a) * 0.4;
      this.dustPos[i * 3 + 1] = y + 0.1;
      this.dustPos[i * 3 + 2] = z + Math.sin(a) * 0.3;
      this.dustVel[i * 3] = Math.cos(a) * s;
      this.dustVel[i * 3 + 1] = (0.4 + Math.random()) * power * 0.8;
      this.dustVel[i * 3 + 2] = Math.sin(a) * s;
      this.dustLife[i] = 1;
    }
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    this.spectrum.update(audio.bands);

    if (audio.drop) {
      this.dropTime = time;
      this.slammed = false;
    }
    const sinceDrop = time - this.dropTime;
    const dropEnv = sinceDrop < 6 ? Math.exp(-sinceDrop * 0.6) : 0;

    // Lightning on drops and some heavy beats.
    if (audio.drop || (audio.beat && audio.bass > 0.6 && time - this.lastStrike > 5 && Math.random() < 0.3)) {
      this.lightning = 1;
      this.lastStrike = time;
      this.boltX = (Math.random() - 0.5) * 1.2;
    }
    const strobe = this.lightning > 0.05 ? (Math.sin(time * 55) > 0 ? 1 : 0.3) : 1;
    const flash = this.lightning * strobe;
    this.lightning = damp(this.lightning, 0, 3.5, dt);

    const su = this.sky.material.uniforms;
    su.time.value = time;
    su.flash.value = flash;
    su.bolt.value = flash;
    su.boltX.value = this.boltX;
    su.red.value = dropEnv * 0.6;
    this.moon.material.uniforms.glow.value = audio.bass + audio.beatPulse * 0.4;
    this.moon.material.uniforms.time.value = time;
    this.moonLight.intensity = 1.3 + flash * 4;
    this.hemi.intensity = 0.5 + flash * 1.6;
    (this.scene.fog as THREE.FogExp2).density = 0.016 + audio.bass * 0.004;

    // Windows
    this.boost = damp(this.boost, dropEnv > 0.3 ? 0.6 : 0, 4, dt);
    const wu = this.winUniforms;
    wu.uTime.value = time;
    wu.uBoost.value = this.boost + audio.beatPulse * 0.08;
    wu.uRed.value = sinceDrop < 5 ? Math.min(1, 1.6 - sinceDrop * 0.32) * Math.min(1, sinceDrop * 8) : 0;
    wu.uFlash.value = flash;
    if (time > this.nextGhost) {
      this.ghostStart = time;
      wu.uGhostId.value = Math.floor(Math.random() * this.windowCount);
      this.nextGhost = time + 5 + Math.random() * 5;
    }
    const gt = (time - this.ghostStart) / 3.2;
    if (gt > 1) wu.uGhostId.value = -1;
    wu.uGhostT.value = Math.min(gt, 1);
    const candle = 0.85 + 0.15 * Math.sin(time * 11) * Math.sin(time * 4.3);
    this.doorLight.intensity = (14 + audio.mid * 20 + dropEnv * 20) * candle;
    this.doorLight.color.setRGB(1, 0.54 - dropEnv * 0.4, 0.23 - dropEnv * 0.12);

    // Gravestones: bands lift them, beat waves roll through the rows, drop makes them leap and slam.
    if (audio.beat) {
      this.waves[this.waveCursor] = time;
      this.waveAmp[this.waveCursor] = 0.35 + audio.bass * 0.6;
      this.waveCursor = (this.waveCursor + 1) % WAVES;
    }
    const JUMP_T = 1.1;
    let jumpH = 0;
    if (sinceDrop < JUMP_T) {
      const s = sinceDrop / JUMP_T;
      jumpH = 4 * 3.2 * s * (1 - s);
    } else if (!this.slammed) {
      this.slammed = true;
      this.shake = 1;
      for (const st of this.stones) this.emitDust(st.x, st.y, st.z, 9, 2.2);
    }
    const spin = sinceDrop < JUMP_T ? Math.sin((sinceDrop / JUMP_T) * Math.PI) : 0;
    const d = this.dummy;
    for (const st of this.stones) {
      const target = Math.min(1, audio.bands[st.band] * 1.5);
      st.level = damp(st.level, target, target > st.level ? 14 : 4, dt);
      let hop = 0;
      for (let w = 0; w < WAVES; w++) {
        const age = time - this.waves[w];
        if (age < 0 || age > 2) continue;
        const front = age * 16;
        const x = st.rowDist - front;
        hop += Math.exp(-x * x * 0.5) * this.waveAmp[w];
      }
      const sink = -0.75 + st.level * 0.95;
      const y = st.y + sink * st.scale + hop * 0.9 + jumpH * (0.8 + 0.4 * Math.sin(st.seed));
      if (hop > 0.5 && Math.random() < 0.08) this.emitDust(st.x, st.y, st.z, 2, 0.8);
      d.position.set(st.x, y, st.z);
      const wob = Math.sin(time * 2.1 + st.seed) * 0.05 * (0.4 + st.level);
      d.rotation.set(
        -0.12 * hop + wob + Math.sin(st.seed * 3) * 0.06 + spin * 0.3 * Math.sin(st.seed * 5),
        st.ry + spin * Math.sin(st.seed * 7) * 2.5,
        Math.sin(time * 1.3 + st.seed * 2) * 0.07 * st.level + hop * 0.18 * Math.sin(st.seed * 11),
      );
      d.scale.setScalar(st.scale);
      d.updateMatrix();
      this.stoneMeshes[st.mesh].setMatrixAt(st.index, d.matrix);
    }
    for (const m of this.stoneMeshes) m.instanceMatrix.needsUpdate = true;

    // Dust
    for (let i = 0; i < DUST; i++) {
      if (this.dustLife[i] <= 0) continue;
      const i3 = i * 3;
      this.dustLife[i] -= dt * 0.55;
      this.dustVel[i3] *= 1 - dt * 1.5;
      this.dustVel[i3 + 1] = this.dustVel[i3 + 1] * (1 - dt * 1.5) - dt * 0.6;
      this.dustVel[i3 + 2] *= 1 - dt * 1.5;
      this.dustPos[i3] += this.dustVel[i3] * dt;
      this.dustPos[i3 + 1] += this.dustVel[i3 + 1] * dt;
      this.dustPos[i3 + 2] += this.dustVel[i3 + 2] * dt;
      if (this.dustLife[i] <= 0) this.dustPos[i3 + 1] = -100;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;

    for (const f of this.fogLayers) {
      f.material.uniforms.time.value = time;
      f.material.uniforms.flash.value = flash;
      f.material.uniforms.density.value = 0.18 + audio.bass * 0.3 + dropEnv * 0.15;
    }

    // Spectral lights drifting between the graves
    for (let i = 0; i < this.graveLights.length; i++) {
      const l = this.graveLights[i];
      const t = time * (0.21 + i * 0.07) + i * 3;
      l.position.set(Math.sin(t) * 10, heightAt(0, 0) + 1.2 + Math.sin(t * 2.3) * 0.4, -2 + Math.cos(t * 0.8) * 7);
      l.intensity = 3 + audio.treble * 10 + audio.beatPulse * 3;
    }

    // Bats
    this.flapTime += dt * (16 + audio.level * 14);
    this.batUniforms.flapTime.value = this.flapTime;
    this.batUniforms.eyes.value = 0.3 + audio.mid * 1.5 + dropEnv;
    const cam = this.camera as THREE.PerspectiveCamera;
    const bm = this.bats.instanceMatrix.array as Float32Array;
    const speedK = 1 + audio.level * 1.2 + dropEnv * 1.5;
    for (let i = 0; i < BATS; i++) {
      const b = i * 5;
      const ang = this.batParams[b + 3] + time * this.batParams[b + 2] * speedK;
      const r = this.batParams[b] * (1 + dropEnv * 0.6);
      d.position.set(
        this.tower.x + Math.cos(ang) * r,
        this.tower.y + this.batParams[b + 1] + Math.sin(ang * 2 + i) * 1.2,
        this.tower.z + Math.sin(ang) * r * 0.7,
      );
      d.quaternion.copy(cam.quaternion);
      d.rotateZ(Math.sin(ang) * 0.4);
      d.scale.setScalar(this.batParams[b + 4] * 2.2);
      d.updateMatrix();
      d.matrix.toArray(bm, i * 16);
    }
    this.bats.instanceMatrix.needsUpdate = true;

    // Slow orbit/dolly around the graveyard towards the mansion.
    this.orbit += dt * (0.04 + audio.level * 0.04);
    this.shake = damp(this.shake, 0, 4, dt);
    const ang = Math.sin(this.orbit) * 0.32;
    const R = 51 - Math.sin(this.orbit * 0.7) * 3;
    const sh = this.shake * 0.35 + audio.bass * 0.03;
    cam.position.set(
      Math.sin(ang) * R + (Math.random() - 0.5) * sh,
      3.2 + Math.sin(this.orbit * 1.3) * 0.6 + (Math.random() - 0.5) * sh,
      MANSION_Z + Math.cos(ang) * R,
    );
    cam.lookAt(Math.sin(ang) * 6, 9.5, MANSION_Z + Math.cos(ang) * 6 + 8);
    this.moon.position.set(cam.position.x * 0.8 - 62, 76, MANSION_Z - 110);
    this.moon.lookAt(cam.position);
    this.moon.scale.setScalar(72 * (1 + audio.bass * 0.03));
  }
}
