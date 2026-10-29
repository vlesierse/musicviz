import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { dotTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const WISPS = 260;
const FOG_COLOR = new THREE.Color(0x140a22);

/** Seeded random so the graveyard layout is the same every time. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const heightAt = (x: number, z: number) => Math.sin(x * 0.08) * Math.cos(z * 0.06) * 0.8 + Math.sin(x * 0.3 + z * 0.2) * 0.15;

function tombstoneGeometry(kind: number, rand: () => number) {
  if (kind === 2) {
    const v = new THREE.BoxGeometry(0.22, 1.6, 0.2).translate(0, 0.8, 0);
    const h = new THREE.BoxGeometry(0.9, 0.22, 0.2).translate(0, 1.15, 0);
    return mergeGeometries([v, h])!;
  }
  const w = 0.8 + rand() * 0.5;
  const hgt = 1.0 + rand() * 0.8;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  if (kind === 0) {
    s.lineTo(-w / 2, hgt - w / 2);
    s.absarc(0, hgt - w / 2, w / 2, Math.PI, 0, true);
  } else {
    s.lineTo(-w / 2, hgt);
    s.lineTo(-w * 0.2, hgt + 0.15);
    s.lineTo(w * 0.2, hgt + 0.15);
    s.lineTo(w / 2, hgt);
  }
  s.lineTo(w / 2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 12 });
  g.deleteAttribute('uv');
  return g.translate(0, 0, -0.09);
}

function treeGeometry(rand: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const end = start.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(radius * 0.65, radius, len, 6, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(start.x, start.y, start.z);
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
  branch(new THREE.Vector3(), new THREE.Vector3((rand() - 0.5) * 0.2, 1, 0).normalize(), 2.6, 0.3, 5);
  return mergeGeometries(parts)!;
}

function pumpkinTextures() {
  const w = 256, h = 128;
  const make = (emissive: boolean) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = emissive ? '#000' : '#f08a1c';
    ctx.fillRect(0, 0, w, h);
    if (!emissive) {
      ctx.strokeStyle = 'rgba(80,25,0,0.6)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo((i / 12) * w, 0);
        ctx.lineTo((i / 12) * w, h);
        ctx.stroke();
      }
    }
    // Face centred at u = 0.25, which faces +z on a SphereGeometry.
    const cx = w * 0.25, cy = h * 0.5;
    ctx.fillStyle = emissive ? '#ffd27a' : '#2a0b00';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 8, cy - 4);
      ctx.lineTo(cx + side * 26, cy - 4);
      ctx.lineTo(cx + side * 17, cy - 20);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy + 8);
    ctx.quadraticCurveTo(cx, cy + 16, cx + 28, cy + 8);
    ctx.quadraticCurveTo(cx, cy + 34, cx - 28, cy + 8);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: make(false), emissiveMap: make(true) };
}

/** 3. A moonlit graveyard with drifting fog, jack-o'-lanterns, wisps and lightning. */
export class GraveyardVisual extends Visual {
  readonly name = 'Haunted Graveyard';
  private sky!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moon!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private moonLight!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private fogLayers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private pumpkinMat!: THREE.MeshStandardMaterial;
  private pumpkinLights: THREE.PointLight[] = [];
  private wisps!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private wispBase = new Float32Array(WISPS * 4);
  private lightning = 0;
  private lastStrike = -10;
  private sway = 0;

  protected setup() {
    const rand = rng(1031);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.03);

    this.sky = fullscreenQuad(
      /* glsl */ `
      uniform float time, flash, aspect;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        vec3 col = mix(${glslColor(FOG_COLOR)}, vec3(0.012, 0.004, 0.025), smoothstep(-0.15, 0.5, p.y));
        float clouds = fbm(vec3(p * vec2(1.5, 3.0) + vec2(time * 0.02, 0.0), time * 0.03));
        col += vec3(0.09, 0.05, 0.16) * smoothstep(0.0, 0.7, clouds) * smoothstep(-0.2, 0.3, p.y);
        vec2 sp = floor(vUv * vec2(aspect, 1.0) * 220.0);
        float h = hash21(sp);
        float star = step(0.997, h) * smoothstep(0.0, 0.4, p.y) * (0.6 + 0.4 * sin(time * 3.0 + h * 40.0));
        col += star * 0.9 * (1.0 - smoothstep(0.0, 0.5, clouds));
        col += flash * vec3(0.5, 0.45, 0.9) * (0.6 + clouds);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, flash: { value: 0 }, aspect: { value: 1 } },
    );
    this.scene.add(this.sky);

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
            float disc = smoothstep(0.36, 0.35, r);
            float craters = fbm(vec3(p * 4.0, 1.0)) * 0.5 + 0.5;
            vec3 moon = ${glslColor(PALETTE.moon)} * (0.75 + 0.5 * craters) * 1.5;
            float halo = exp(-max(r - 0.35, 0.0) * 7.0) * (0.3 + glow * 0.5);
            vec3 col = moon * disc + ${glslColor(PALETTE.moon)} * halo * (1.0 - disc);
            gl_FragColor = vec4(col, max(disc, halo));
          }`,
      }),
    );
    this.moon.scale.setScalar(60);
    this.moon.renderOrder = -500;
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0x4a3a8a, 0x080310, 0.7);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0x9fb0ff, 1.6);
    this.moonLight.position.set(-0.4, 0.6, -1).multiplyScalar(50);
    this.scene.add(this.moonLight);

    // Ground with gentle hills
    const ground = new THREE.PlaneGeometry(260, 260, 120, 120);
    ground.rotateX(-Math.PI / 2);
    const gp = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)));
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: 0x1a1324, roughness: 1 })));

    // Tombstones, one InstancedMesh per shape kind; the layout repeats along z so the camera can loop.
    const stone = new THREE.MeshStandardMaterial({ color: 0x77708a, roughness: 0.92 });
    const placements: { x: number; z: number; k: number }[] = [];
    for (let row = 0; row < 16; row++) {
      for (let col = -6; col <= 6; col++) {
        if (col === 0 || rand() < 0.3) continue;
        const k = rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2;
        placements.push({ x: col * 2.6 + (rand() - 0.5) * 0.8, z: 14 - row * 4.2 + (rand() - 0.5) * 1.2, k });
      }
    }
    const kinds = [0, 1, 2].map((k) => tombstoneGeometry(k, rand));
    const meshes = kinds.map((g, k) => new THREE.InstancedMesh(g, stone, Math.max(1, placements.filter((p) => p.k === k).length)));
    const used = [0, 0, 0];
    const dummy = new THREE.Object3D();
    for (const p of placements) {
      dummy.position.set(p.x, heightAt(p.x, p.z) - 0.1, p.z);
      dummy.rotation.set((rand() - 0.5) * 0.25, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.25);
      dummy.scale.setScalar(0.9 + rand() * 0.4);
      dummy.updateMatrix();
      meshes[p.k].setMatrixAt(used[p.k]++, dummy.matrix);
    }
    meshes.forEach((m) => this.scene.add(m));

    // Dead trees
    const bark = new THREE.MeshStandardMaterial({ color: 0x0c0810, roughness: 1 });
    const treeSpots = [[-14, -2], [12, -12], [-9, -24], [16, -30], [-18, -38], [6, -46], [-12, -54]];
    for (const [x, z] of treeSpots) {
      const t = new THREE.Mesh(treeGeometry(rand), bark);
      t.position.set(x, heightAt(x, z) - 0.2, z);
      t.rotation.y = rand() * Math.PI * 2;
      t.scale.setScalar(1.3 + rand() * 0.8);
      this.scene.add(t);
    }

    // Jack-o'-lanterns lining the path
    const { map, emissiveMap } = pumpkinTextures();
    this.pumpkinMat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 2, roughness: 0.7 });
    const pg = new THREE.SphereGeometry(0.42, 32, 16);
    const pp = pg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const k = 1 - 0.07 * Math.abs(Math.sin(Math.atan2(z, x) * 6));
      pp.setXYZ(i, x * k, y * 0.78, z * k);
    }
    pg.computeVertexNormals();
    for (let i = 0; i < 12; i++) {
      const x = (i % 2 ? 1.8 : -1.8) + (rand() - 0.5) * 0.6;
      const z = 6 - i * 5.5;
      const p = new THREE.Mesh(pg, this.pumpkinMat);
      p.position.set(x, heightAt(x, z) + 0.25, z);
      p.rotation.y = (x < 0 ? 0.7 : -0.7) + (rand() - 0.5) * 0.3;
      this.scene.add(p);
      if (i % 2 === 0) {
        const l = new THREE.PointLight(0xff9a40, 6, 9, 1.6);
        l.position.set(x * 0.6, p.position.y + 0.6, z + 0.5);
        this.pumpkinLights.push(l);
        this.scene.add(l);
      }
    }

    // Ground fog layers
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
            float n = fbm(vec3(vWorld.xz * 0.07 + vec2(time * 0.05, time * 0.02), time * 0.04 + seed));
            float a = smoothstep(-0.2, 0.8, n) * density;
            float dist = length(vWorld.xz - cameraPosition.xz);
            a *= smoothstep(1.0, 6.0, dist) * (1.0 - smoothstep(40.0, 90.0, dist));
            vec3 col = mix(vec3(0.3, 0.24, 0.48), vec3(0.85, 0.82, 1.0), flash);
            gl_FragColor = vec4(col, a);
          }`,
      });
      const fog = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), mat);
      fog.position.y = 0.25 + i * 0.45;
      this.fogLayers.push(fog);
      this.scene.add(fog);
    }

    // Will-o'-wisps
    for (let i = 0; i < WISPS; i++) {
      this.wispBase[i * 4] = (rand() - 0.5) * 40;
      this.wispBase[i * 4 + 1] = 0.4 + rand() * 3;
      this.wispBase[i * 4 + 2] = 14 - rand() * 70;
      this.wispBase[i * 4 + 3] = rand() * 100;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WISPS * 3), 3));
    this.wisps = new THREE.Points(
      wg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        size: 0.35,
        color: PALETTE.toxic.clone().multiplyScalar(1.6),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.wisps.frustumCulled = false;
    this.scene.add(this.wisps);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 55;
    cam.far = 400;
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.sky) this.sky.material.uniforms.aspect.value = w / h;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    // Lightning on drops and occasionally on heavy beats.
    if (audio.drop || (audio.beat && audio.bass > 0.65 && time - this.lastStrike > 4 && Math.random() < 0.25)) {
      this.lightning = 1;
      this.lastStrike = time;
    }
    const strobe = this.lightning > 0.05 ? (Math.sin(time * 60) > 0 ? 1 : 0.35) : 1;
    const flash = this.lightning * strobe;
    this.lightning = damp(this.lightning, 0, 5, dt);

    this.sky.material.uniforms.time.value = time;
    this.sky.material.uniforms.flash.value = flash;
    this.moon.material.uniforms.glow.value = audio.bass + audio.beatPulse * 0.5;
    this.moonLight.intensity = 1.4 + flash * 8;
    this.hemi.intensity = 0.6 + flash * 3;
    (this.scene.fog as THREE.FogExp2).density = 0.03 - audio.level * 0.008;

    const candle = 0.75 + 0.25 * Math.sin(time * 17) * Math.sin(time * 5.1);
    this.pumpkinMat.emissiveIntensity = (1.4 + audio.mid * 2.5 + audio.beatPulse * 1.5) * candle;
    for (const l of this.pumpkinLights) l.intensity = (4 + audio.mid * 8) * candle;

    for (const f of this.fogLayers) {
      f.material.uniforms.time.value = time;
      f.material.uniforms.flash.value = flash;
      f.material.uniforms.density.value = 0.2 + audio.bass * 0.25;
    }

    const arr = this.wisps.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < WISPS; i++) {
      const b = i * 4;
      const ph = this.wispBase[b + 3] + time * 0.4;
      arr[i * 3] = this.wispBase[b] + Math.sin(ph) * 1.5;
      arr[i * 3 + 1] = this.wispBase[b + 1] + Math.sin(ph * 1.7) * 0.4;
      arr[i * 3 + 2] = this.wispBase[b + 2] + Math.cos(ph * 0.8) * 1.5;
    }
    this.wisps.geometry.attributes.position.needsUpdate = true;
    this.wisps.material.size = 0.2 + audio.treble * 0.5 + audio.beatPulse * 0.15;

    // Slow walk down the path, looping, swaying side to side.
    this.sway += dt * (0.08 + audio.level * 0.1);
    const z = 12 - ((time * 0.6) % 30);
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.set(Math.sin(this.sway) * 2.5, 2.2 + audio.bass * 0.15, z);
    cam.lookAt(Math.sin(this.sway * 0.7) * 3, 2.6, z - 20);
    this.moon.position.set(cam.position.x - 25, 38, z - 150);
    this.moon.lookAt(cam.position);
    this.moon.scale.setScalar(60 * (1 + audio.bass * 0.05));
  }
}
