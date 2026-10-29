import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { FULLSCREEN_VERT, GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { ghostTexture } from '../core/shapes';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const COUNT = 170;
const HALF = 12;
const Z_MIN = -16;
const Z_MAX = 9;
const COLORS = [PALETTE.ghost, PALETTE.ghost, PALETTE.bone, new THREE.Color(0xc9a0ff), PALETTE.slime];

/** 4. Ghosts drifting through a divergence-free (ABC) flow field, leaving afterimage trails. */
export class GhostFlowVisual extends Visual {
  readonly name = 'Ghost Flow Field';
  private ghostScene = new THREE.Scene();
  private fbScene = new THREE.Scene();
  private mesh!: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private bg!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private comp!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private fbMat!: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget[] = [];
  private ping = 0;
  private needsClear = true;

  private pos = new Float32Array(COUNT * 3);
  private vel = new Float32Array(COUNT * 3);
  private phase = new Float32Array(COUNT);
  private size = new Float32Array(COUNT);
  private colorIdx = new Uint8Array(COUNT);
  private swirl = 0;
  private flowTime = 0;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private roll = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);

  protected setup() {
    this.bloom = 0.9;
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.set(0, 0, 14);
    cam.lookAt(0, 0, 0);

    this.bg = fullscreenQuad(
      /* glsl */ `
      uniform float time, bass, drop, aspect;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        float n = fbm(vec3(p * 1.6 + vec2(0.0, time * 0.03), time * 0.05));
        float n2 = fbm(vec3(p * 3.5 - vec2(time * 0.02, 0.0), time * 0.07 + 5.0));
        vec3 col = vec3(0.008, 0.012, 0.03);
        col += vec3(0.05, 0.07, 0.13) * smoothstep(-0.3, 0.8, n) * (0.7 + bass * 0.6);
        col += vec3(0.06, 0.03, 0.1) * smoothstep(0.0, 0.9, n2);
        col += vec3(0.2, 0.25, 0.3) * exp(-length(p - vec2(0.0, 0.55)) * 3.0) * 0.4;
        col = mix(col, col * vec3(0.6, 1.6, 0.7), drop);
        col *= 1.0 - 0.6 * dot(p, p);
        gl_FragColor = vec4(col, 1.0);
      }`,
      { time: { value: 0 }, bass: { value: 0 }, drop: { value: 0 }, aspect: { value: 1 } },
    );
    this.scene.add(this.bg);

    this.comp = fullscreenQuad(
      /* glsl */ `
      uniform sampler2D trail;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(trail, vUv).rgb, 1.0); }`,
      { trail: { value: null } },
    );
    this.comp.material.transparent = true;
    this.comp.material.blending = THREE.AdditiveBlending;
    this.comp.renderOrder = -999;
    this.scene.add(this.comp);

    this.fbMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D prev;
        uniform float decay, zoom, time;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          vec2 uv = 0.5 + (vUv - 0.5) * zoom;
          uv.y -= 0.0012;
          uv += 0.0015 * vec2(snoise(vec3(vUv * 3.0, time * 0.2)), snoise(vec3(vUv * 3.0 + 7.0, time * 0.2)));
          vec3 c = texture2D(prev, uv).rgb * decay;
          gl_FragColor = vec4(max(c - 0.002, 0.0), 1.0);
        }`,
      uniforms: { prev: { value: null }, decay: { value: 0.9 }, zoom: { value: 0.996 }, time: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    const fbQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fbMat);
    fbQuad.frustumCulled = false;
    this.fbScene.add(fbQuad);

    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ghostTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      COUNT,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < COUNT; i++) {
      this.spawn(i, Z_MIN + Math.random() * (Z_MAX - Z_MIN));
      this.phase[i] = Math.random() * 100;
      this.size[i] = 0.6 + Math.random() * 0.9;
      this.colorIdx[i] = Math.random() < 0.08 ? 4 : Math.floor(Math.random() * 4);
      this.mesh.setColorAt(i, COLORS[this.colorIdx[i]]);
    }
    this.ghostScene.add(this.mesh);
    this.renderer.compile(this.ghostScene, this.camera);
    this.renderer.compile(this.fbScene, this.camera);
  }

  private spawn(i: number, z: number) {
    this.pos[i * 3] = (Math.random() - 0.5) * HALF * 2;
    this.pos[i * 3 + 1] = (Math.random() - 0.5) * HALF * 1.4;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.bg) return;
    this.bg.material.uniforms.aspect.value = w / h;
    if (!this.rt.length) {
      for (let i = 0; i < 2; i++) {
        this.rt.push(new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }));
      }
    } else {
      this.rt.forEach((r) => r.setSize(w, h));
    }
    this.needsClear = true;
  }

  onEnter() {
    this.needsClear = true;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    if (audio.beat) this.swirl = Math.min(1.5, this.swirl + 0.8);
    this.swirl = damp(this.swirl, 0, 2.5, dt);
    const speed = 0.4 + audio.level * 1.6 + audio.bass * 0.8;
    this.flowTime += dt * (0.1 + audio.level * 0.2);

    const k = 0.32;
    const ft = this.flowTime;
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.x = Math.sin(time * 0.1) * 2;
    cam.position.y = Math.cos(time * 0.13) * 1.2;
    cam.lookAt(0, 0, -2);

    for (let i = 0; i < COUNT; i++) {
      const b = i * 3;
      let x = this.pos[b], y = this.pos[b + 1], z = this.pos[b + 2];
      // ABC flow
      let fx = Math.sin(k * z + ft) + Math.cos(k * y);
      let fy = 0.8 * Math.sin(k * x) + Math.cos(k * z + ft * 1.3);
      let fz = 0.6 * (Math.sin(k * y) + Math.cos(k * x));
      fx *= speed;
      fy *= speed;
      fz = fz * speed + 0.4;
      // Beat swirl: spin around the view axis and rush toward the camera.
      const s = this.swirl;
      fx += -y * s * 0.5;
      fy += x * s * 0.5;
      fz += s * 6;
      if (audio.drop) {
        const len = Math.hypot(x, y) + 0.5;
        this.vel[b] += (x / len) * 10;
        this.vel[b + 1] += (y / len) * 10;
      }
      this.vel[b] = damp(this.vel[b], fx, 2.5, dt);
      this.vel[b + 1] = damp(this.vel[b + 1], fy, 2.5, dt);
      this.vel[b + 2] = damp(this.vel[b + 2], fz, 2.5, dt);
      x += this.vel[b] * dt;
      y += this.vel[b + 1] * dt;
      z += this.vel[b + 2] * dt;
      if (x > HALF) x -= HALF * 2;
      else if (x < -HALF) x += HALF * 2;
      if (y > HALF * 0.75) y -= HALF * 1.5;
      else if (y < -HALF * 0.75) y += HALF * 1.5;
      this.pos[b] = x;
      this.pos[b + 1] = y;
      this.pos[b + 2] = z;
      if (z > Z_MAX || z < Z_MIN - 2) {
        this.spawn(i, Z_MIN);
      }

      const ph = this.phase[i] + time;
      const sz = this.size[i] * (1 + audio.bass * 0.25 + Math.sin(ph * 2.0) * 0.06);
      this.roll.setFromAxisAngle(this.zAxis, -this.vel[b] * 0.06 + Math.sin(ph * 1.3) * 0.15);
      this.dummy.position.set(this.pos[b], this.pos[b + 1] + Math.sin(ph * 1.7) * 0.15, this.pos[b + 2]);
      this.dummy.quaternion.copy(cam.quaternion).multiply(this.roll);
      this.dummy.scale.set(sz, sz * 1.15, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Fade in at the far end, fade out right before reaching the camera.
      const fade = Math.min(1, (this.pos[b + 2] - Z_MIN) / 4) * Math.min(1, (Z_MAX - this.pos[b + 2]) / 3);
      const shimmer = 0.75 + 0.25 * Math.sin(time * 24 + this.phase[i] * 13) * audio.treble;
      const bright = (0.09 + audio.mid * 0.04 + audio.beatPulse * 0.05) * shimmer * Math.max(0, fade);
      this.tmpColor.copy(COLORS[this.colorIdx[i]]).lerp(PALETTE.slime, audio.dropPulse * 0.7).multiplyScalar(bright);
      this.mesh.setColorAt(i, this.tmpColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;

    this.fbMat.uniforms.decay.value = Math.min(0.9, 0.78 + audio.level * 0.1);
    this.fbMat.uniforms.zoom.value = 0.999 - audio.beatPulse * 0.006;
    this.fbMat.uniforms.time.value = time;
    const u = this.bg.material.uniforms;
    u.time.value = time;
    u.bass.value = audio.bass;
    u.drop.value = audio.dropPulse;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const prev = this.rt[this.ping];
    const curr = this.rt[1 - this.ping];
    if (this.needsClear) {
      for (const r of this.rt) {
        renderer.setRenderTarget(r);
        renderer.clear();
      }
      this.needsClear = false;
    }
    this.fbMat.uniforms.prev.value = prev.texture;
    renderer.setRenderTarget(curr);
    renderer.render(this.fbScene, this.camera);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.ghostScene, this.camera);
    renderer.autoClear = autoClear;

    this.comp.material.uniforms.trail.value = curr.texture;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    this.ping = 1 - this.ping;
  }

  dispose() {
    super.dispose();
    this.rt.forEach((r) => r.dispose());
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.fbMat.dispose();
  }
}
