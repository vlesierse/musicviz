import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { batTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const BATS = 800;
const ATTRACTORS = 6;
const CAM_Z = 12;
const FOV = 55;
const MOON = { x: 0, y: 0.1, r: 0.4 };

/** 9. A swirling storm of bats around a huge full moon. */
export class BatStormVisual extends Visual {
  readonly name = 'Bat Storm';
  bloom = 0.8;
  private uniforms!: Record<string, THREE.IUniform>;
  private bats!: THREE.InstancedMesh;
  private batUniforms!: Record<string, THREE.IUniform>;
  private pos = new Float32Array(BATS * 3);
  private vel = new Float32Array(BATS * 3);
  private size = new Float32Array(BATS);
  private attr = new Float32Array(ATTRACTORS * 3);
  private attrAxes: { u: THREE.Vector3; v: THREE.Vector3; r: number; w: number; o: number }[] = [];
  private center = new THREE.Vector3();
  private flapTime = 0;
  private flapRate = 18;
  private speed = 3;
  private red = 0;
  private lastBeat = -1;
  private beatInterval = 0.5;

  protected setup() {
    this.uniforms = {
      time: { value: 0 },
      aspect: { value: 1 },
      red: { value: 0 },
      bass: { value: 0 },
      beat: { value: 0 },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect, red, bass, beat;
        varying vec2 vUv;
        ${GLSL_NOISE}
        float fbm4(vec3 p) {
          float f = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { f += a * snoise(p); p *= 2.05; a *= 0.5; }
          return f;
        }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
          vec2 mc = vec2(${MOON.x.toFixed(2)}, ${MOON.y.toFixed(2)});
          float R = ${MOON.r.toFixed(2)} * (1.0 + bass * 0.025);
          float d = length(p - mc);
          vec3 moonCol = mix(${glslColor(PALETTE.moon)} * 0.62, vec3(0.95, 0.04, 0.03), red);
          vec3 sky = mix(vec3(0.05, 0.012, 0.09), vec3(0.008, 0.002, 0.02), smoothstep(-1.0, 1.0, p.y));
          sky = mix(sky, vec3(0.1, 0.0, 0.02), red * 0.6);
          vec3 col = sky;
          col += moonCol * exp(-max(d - R, 0.0) * 4.0) * 0.12;
          col += moonCol * exp(-max(d - R, 0.0) * 16.0) * 0.12;
          if (d < R + 0.01) {
            vec2 m = (p - mc) / R;
            float z = sqrt(max(1.0 - dot(m, m), 0.0));
            float maria = fbm4(vec3(m * 1.6, 3.0));
            float crater = fbm4(vec3(m * 6.0 + 7.0, 1.0));
            float shade = 0.72 + 0.18 * smoothstep(0.1, -0.3, maria) - 0.12 * smoothstep(0.0, 0.5, crater) + 0.06 * smoothstep(-0.2, -0.5, crater);
            vec3 surf = moonCol * shade * (0.5 + 0.5 * pow(z, 0.5)) * (1.0 + beat * 0.15);
            surf += moonCol * pow(1.0 - z, 3.0) * 0.4;
            col = mix(col, surf, smoothstep(R, R - 0.006, d));
          }
          // drifting clouds lit by the moon
          vec2 cp = p * vec2(0.9, 2.2) + vec2(time * 0.035, 0.0);
          float n = fbm4(vec3(cp, time * 0.03));
          float dens = smoothstep(0.05, 0.55, n) * smoothstep(0.75, -0.2, p.y);
          float lit = exp(-max(d - R, 0.0) * 2.0);
          vec3 cloud = mix(vec3(0.025, 0.008, 0.05), moonCol * 0.4, lit);
          col = mix(col, cloud * (0.6 + 0.4 * n), dens * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.uniforms,
      ),
    );

    const geo = new THREE.PlaneGeometry(1, 1, 10, 1);
    const phase = new Float32Array(BATS * 2);
    for (let i = 0; i < BATS; i++) {
      phase[i * 2] = Math.random() * Math.PI * 2;
      phase[i * 2 + 1] = 0.8 + Math.random() * 0.4;
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 2));
    this.batUniforms = { map: { value: batTexture() }, flapTime: { value: 0 }, eyes: { value: 0 }, red: { value: 0 } };
    this.bats = new THREE.InstancedMesh(
      geo,
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
          uniform float eyes, red;
          varying vec2 vUv;
          void main() {
            float a = texture2D(map, vUv).a;
            if (a < 0.02) discard;
            vec3 col = vec3(0.012, 0.004, 0.02);
            vec2 e = vec2(abs(vUv.x - 0.5) - 0.022, vUv.y - 0.565);
            float eye = smoothstep(0.02, 0.0, length(e));
            col += mix(vec3(2.5, 0.25, 0.05), vec3(3.0, 0.05, 0.05), red) * eye * eyes;
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      BATS,
    );
    this.bats.frustumCulled = false;
    this.scene.add(this.bats);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = FOV;
    cam.position.set(0, 0, CAM_Z);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    // World-space point behind which the moon sits (on the z=0 plane).
    this.center.set(0, MOON.y * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z, 0);

    for (let k = 0; k < ATTRACTORS; k++) {
      const tilt = (Math.random() - 0.5) * 1.2;
      const u = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.8);
      const v = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)).normalize();
      this.attrAxes.push({ u, v, r: 3 + Math.random() * 4, w: (0.25 + Math.random() * 0.35) * (k % 2 ? 1 : -1), o: Math.random() * 6.28 });
    }
    for (let i = 0; i < BATS; i++) {
      const i3 = i * 3;
      this.pos[i3] = (Math.random() - 0.5) * 16;
      this.pos[i3 + 1] = (Math.random() - 0.5) * 9;
      this.pos[i3 + 2] = (Math.random() - 0.5) * 10;
      this.size[i] = 0.55 + Math.random() * Math.random() * 0.8;
    }
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.uniforms) this.uniforms.aspect.value = w / h;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (audio.beat) {
      if (this.lastBeat >= 0) {
        const iv = time - this.lastBeat;
        if (iv > 0.25 && iv < 1.5) this.beatInterval = this.beatInterval * 0.8 + iv * 0.2;
      }
      this.lastBeat = time;
    }
    const tempoActive = time - this.lastBeat < 2;
    // two wing beats per musical beat, idle ~3 Hz
    const targetRate = tempoActive ? (Math.PI * 4) / this.beatInterval : 18;
    this.flapRate = damp(this.flapRate, Math.min(40, Math.max(12, targetRate)), 2, dt);
    this.flapTime += this.flapRate * dt;
    this.speed = damp(this.speed, 2.5 + audio.level * 6 + audio.dropPulse * 4, 3, dt);
    this.red = damp(this.red, audio.dropPulse > 0.15 ? 1 : 0, audio.dropPulse > 0.15 ? 6 : 0.6, dt);

    const c = this.center;
    for (let k = 0; k < ATTRACTORS; k++) {
      const a = this.attrAxes[k];
      const th = time * a.w * (1 + audio.level) + a.o;
      const r = a.r * (1 + 0.15 * Math.sin(time * 0.3 + k));
      const cs = Math.cos(th) * r;
      const sn = Math.sin(th) * r;
      this.attr[k * 3] = c.x + a.u.x * cs + a.v.x * sn;
      this.attr[k * 3 + 1] = c.y + a.u.y * cs + a.v.y * sn;
      this.attr[k * 3 + 2] = c.z + a.u.z * cs + a.v.z * sn;
    }

    const vortex = Math.min(1, audio.dropPulse * 1.4);
    const burst = audio.beat ? 3 + audio.bass * 7 : 0;
    const maxV = this.speed;
    const pos = this.pos;
    const vel = this.vel;
    const m = this.bats.instanceMatrix.array as Float32Array;
    for (let i = 0; i < BATS; i++) {
      const i3 = i * 3;
      let x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      const k = (i % ATTRACTORS) * 3;
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      // attraction to this bat's orbiting attractor
      let ax = (this.attr[k] - x) * 0.9;
      let ay = (this.attr[k + 1] - y) * 0.9;
      let az = (this.attr[k + 2] - z) * 0.9;
      // cheap smooth noise field for flock-like wandering
      const ph = i * 0.37;
      ax += Math.sin(y * 0.8 + time * 1.1 + ph) * 2.2;
      ay += Math.sin(z * 0.7 - time * 0.9 + ph * 1.3) * 2.2;
      az += Math.sin(x * 0.6 + time * 0.8 - ph) * 2.2;
      // vortex: ring around the moon in the screen plane
      if (vortex > 0.01) {
        const rxy = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        const ring = 3.5 + (i % 7) * 0.45;
        const pull = (ring - rxy) * 3;
        ax = ax * (1 - vortex) + vortex * ((dx / rxy) * pull - (dy / rxy) * 14);
        ay = ay * (1 - vortex) + vortex * ((dy / rxy) * pull + (dx / rxy) * 14);
        az = az * (1 - vortex) + vortex * (-dz * 2);
      }
      vx += ax * dt;
      vy += ay * dt;
      vz += az * dt;
      if (burst > 0) {
        const b = burst * (0.6 + 0.8 * ((i * 0.618) % 1));
        vx += (dx / dist) * b;
        vy += (dy / dist) * b;
        vz += (dz / dist) * b * 0.5;
      }
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-4;
      const lim = maxV * (1 + vortex * 1.5);
      if (sp > lim) {
        const f = 1 - Math.min(1, 3 * dt) * (1 - lim / sp);
        vx *= f;
        vy *= f;
        vz *= f;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (z > CAM_Z - 3) {
        z = CAM_Z - 3;
        vz = -Math.abs(vz);
      }
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;

      const roll = Math.max(-0.7, Math.min(0.7, -vx * 0.09 + Math.sin(time * 2 + ph) * 0.1));
      const s = this.size[i];
      const co = Math.cos(roll) * s;
      const si = Math.sin(roll) * s;
      const o = i * 16;
      m[o] = co;
      m[o + 1] = si;
      m[o + 2] = 0;
      m[o + 3] = 0;
      m[o + 4] = -si;
      m[o + 5] = co;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = 0;
      m[o + 9] = 0;
      m[o + 10] = s;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
    }
    this.bats.instanceMatrix.needsUpdate = true;

    const u = this.uniforms;
    u.time.value = time;
    u.red.value = this.red;
    u.bass.value = audio.bass;
    u.beat.value = audio.beatPulse;
    this.batUniforms.flapTime.value = this.flapTime;
    this.batUniforms.eyes.value = 0.35 + audio.beatPulse * 0.8 + this.red * 0.6;
    this.batUniforms.red.value = this.red;
  }
}
