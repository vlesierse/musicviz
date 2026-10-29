import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE, glslColor } from '../core/palette';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const ROWS = 128;
const COLS = 64;
const Z_NEAR = 10;
const Z_FAR = -95;
const WIDTH = 140;
const FOG = 'vec3(0.075, 0.012, 0.055)';

/** Dead trees, crosses and tombstones on a strip, drawn once with Canvas2D. */
function horizonTexture() {
  const w = 2048;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // rolling hill line
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h - 26 - Math.sin(x * 0.004) * 12 - Math.sin(x * 0.013 + 1) * 6);
  ctx.lineTo(w, h);
  ctx.fill();
  const branch = (x: number, y: number, len: number, ang: number, width: number, depth: number) => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y - Math.sin(ang) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (depth <= 0) return;
    const n = 2 + (rnd() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = ang + (rnd() - 0.5) * 1.6;
      branch(x2, y2, len * (0.55 + rnd() * 0.25), a, width * 0.65, depth - 1);
    }
  };
  const ground = (x: number) => h - 26 - Math.sin(x * 0.004) * 12 - Math.sin(x * 0.013 + 1) * 6;
  for (let i = 0; i < 9; i++) {
    const x = 60 + rnd() * (w - 120);
    // keep the middle clear so the moon reads
    if (Math.abs(x - w / 2) < 260) continue;
    branch(x, ground(x) + 4, 40 + rnd() * 40, Math.PI / 2 + (rnd() - 0.5) * 0.3, 9 + rnd() * 5, 5);
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = ground(x) + 3;
    const s = 10 + rnd() * 10;
    if (rnd() < 0.4) {
      ctx.fillRect(x - s * 0.12, y - s * 2.2, s * 0.24, s * 2.2);
      ctx.fillRect(x - s * 0.7, y - s * 1.65, s * 1.4, s * 0.24);
    } else {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y);
      ctx.lineTo(x - s * 0.6, y - s);
      ctx.arc(x, y - s, s * 0.6, Math.PI, 0);
      ctx.lineTo(x + s * 0.6, y);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** 8. Synthwave spectrum terrain flying towards a striped blood moon. */
export class SpectralTerrainVisual extends Visual {
  readonly name = 'Spectral Terrain';
  private histData = new Uint8Array(COLS * ROWS * 4);
  private hist!: THREE.DataTexture;
  private rowsPushed = 0;
  private rowFrac = 0;
  private skyUniforms!: Record<string, THREE.IUniform>;
  private terrainUniforms!: Record<string, THREE.IUniform>;
  private moonUniforms!: Record<string, THREE.IUniform>;
  private moon!: THREE.Mesh;
  private bob = 0;
  private flash = 0;
  private speed = 24;
  private horizon = new THREE.Vector3();

  protected setup() {
    this.hist = new THREE.DataTexture(this.histData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.hist.wrapS = THREE.ClampToEdgeWrapping;
    this.hist.wrapT = THREE.RepeatWrapping;
    this.hist.magFilter = this.hist.minFilter = THREE.LinearFilter;
    this.hist.needsUpdate = true;

    this.skyUniforms = { time: { value: 0 }, aspect: { value: 1 }, horizon: { value: 0.5 }, flash: { value: 0 } };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect, horizon, flash;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          float y = vUv.y - horizon;
          vec3 col = mix(${FOG}, ${glslColor(PALETTE.night)}, smoothstep(0.0, 0.45, y));
          col += vec3(0.35, 0.03, 0.12) * exp(-abs(y) * 14.0) * (0.35 + flash * 0.8);
          vec2 g = vec2(vUv.x * aspect, vUv.y) * 90.0;
          vec2 cell = floor(g);
          vec2 f = fract(g) - hash22(cell);
          float star = step(0.93, hash21(cell)) * smoothstep(0.12, 0.0, length(f));
          star *= 0.5 + 0.5 * sin(time * (1.0 + hash21(cell + 1.0) * 3.0) + hash21(cell) * 50.0);
          col += ${glslColor(PALETTE.ghost)} * star * 0.7 * smoothstep(0.02, 0.2, y);
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.skyUniforms,
      ),
    );

    // Blood moon with synthwave stripe cut-outs.
    this.moonUniforms = { time: { value: 0 }, pulse: { value: 0 }, beat: { value: 0 } };
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.ShaderMaterial({
        uniforms: this.moonUniforms,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float time, pulse, beat;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float d = length(p) / 0.62;
            float disc = smoothstep(1.0, 0.985, d);
            float yy = p.y / 0.62;
            float gap = smoothstep(0.35, -0.95, yy) * 0.8;
            float cut = step(gap, fract(yy * 7.0 + time * 0.35));
            float n = fbm(vec3(p * 3.0, 1.0));
            vec3 moon = mix(${glslColor(PALETTE.blood)} * 0.9, ${glslColor(PALETTE.ember)} * 1.1, smoothstep(-0.9, 1.0, yy));
            moon *= (0.75 + 0.35 * n) * (0.85 + pulse * 0.5 + beat * 0.25);
            vec3 col = moon * disc * cut;
            col += vec3(0.45, 0.01, 0.04) * exp(-max(d - 1.0, 0.0) * 5.0) * (1.0 - disc) * (0.3 + pulse * 0.4);
            gl_FragColor = vec4(col, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.moon.position.set(0, 14, -170);
    this.moon.renderOrder = -10;
    this.scene.add(this.moon);

    const sil = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 50),
      new THREE.MeshBasicMaterial({ color: 0x030005, alphaMap: horizonTexture(), transparent: true, depthWrite: false }),
    );
    sil.position.set(0, 21, -150);
    sil.renderOrder = -5;
    this.scene.add(sil);

    // Terrain: vertex shader reads the spectrum history ring buffer.
    const geo = new THREE.PlaneGeometry(WIDTH, Z_NEAR - Z_FAR, 220, ROWS - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, (Z_NEAR + Z_FAR) / 2);
    this.terrainUniforms = {
      tHist: { value: this.hist },
      scroll: { value: 0 },
      flash: { value: 0 },
      bass: { value: 0 },
      camPos: { value: new THREE.Vector3() },
    };
    const terrain = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.terrainUniforms,
        vertexShader: /* glsl */ `
          uniform sampler2D tHist;
          uniform float scroll;
          varying float vH;
          varying float vG;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            vec3 pos = position;
            float aBase = (pos.z - ${Z_FAR.toFixed(1)}) / ${(Z_NEAR - Z_FAR).toFixed(1)} * ${(ROWS - 1).toFixed(1)};
            float G = scroll - aBase;
            float ax = abs(pos.x);
            float bp = clamp((ax - 3.5) / 26.0, 0.0, 1.0);
            float s = texture2D(tHist, vec2(pow(bp, 1.5) * 0.85 + 0.02, (G + 0.5) / ${ROWS.toFixed(1)})).r;
            float env = smoothstep(3.0, 7.0, ax);
            float hills = (snoise(vec3(pos.x * 0.07, G * 0.05, 0.0)) * 0.5 + 0.5) * smoothstep(6.0, 40.0, ax) * 9.0;
            float rough = snoise(vec3(pos.x * 0.3, G * 0.2, 4.0)) * 0.35 * env;
            float crag = 0.6 + 0.4 * snoise(vec3(pos.x * 0.18, G * 0.12, 9.0));
            float h = s * s * 9.0 * env * (0.55 + 0.45 * smoothstep(0.0, 0.35, bp)) * (1.0 - bp * 0.4) * crag + hills + rough;
            pos.y = h;
            vH = h;
            vG = G;
            vec4 wp = modelMatrix * vec4(pos, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float flash, bass;
          uniform vec3 camPos;
          varying float vH;
          varying float vG;
          varying vec3 vWorld;
          void main() {
            vec2 gc = vec2(vWorld.x * 0.7, vG * 0.5);
            vec2 fw = max(fwidth(gc), vec2(1e-4));
            vec2 l = abs(fract(gc - 0.5) - 0.5) / (fw * 1.3);
            vec2 lineXY = 1.0 - min(l, 1.0);
            lineXY *= 1.0 - smoothstep(0.15, 0.5, fw);
            float line = max(lineXY.x, lineXY.y);
            float t = clamp(vH / 9.0, 0.0, 1.0);
            vec3 lc = mix(${glslColor(PALETTE.purple)} * 1.6, ${glslColor(PALETTE.pumpkin)} * 2.4, smoothstep(0.08, 0.5, t));
            lc = mix(lc, ${glslColor(PALETTE.toxic)} * 2.4, smoothstep(0.6, 0.95, t));
            vec3 surf = ${glslColor(PALETTE.violet)} * 0.05 + lc * 0.07 * t;
            vec3 col = surf + lc * line * (0.8 + flash * 1.4 + bass * 0.4);
            float dist = length(vWorld - camPos);
            float fog = smoothstep(25.0, 98.0, dist);
            col = mix(col, ${FOG}, fog);
            gl_FragColor = vec4(col, 1.0);
          }`,
        side: THREE.DoubleSide,
      }),
    );
    terrain.frustumCulled = false;
    this.scene.add(terrain);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 62;
    cam.far = 500;
    cam.position.set(0, 2.6, 6);
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (this.skyUniforms) this.skyUniforms.aspect.value = w / h;
  }

  private pushRow(bands: Float32Array) {
    const row = this.rowsPushed % ROWS;
    const d = this.histData;
    for (let i = 0; i < COLS; i++) {
      const k = (row * COLS + i) * 4;
      const prev = d[(((row + ROWS - 1) % ROWS) * COLS + i) * 4];
      const v = Math.max(Math.round(Math.min(1, bands[i]) * 255), Math.round(prev * 0.86));
      d[k] = d[k + 1] = d[k + 2] = v;
      d[k + 3] = 255;
    }
    this.rowsPushed++;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    this.speed = damp(this.speed, 22 + audio.level * 18 + audio.dropPulse * 25, 2, dt);
    this.rowFrac += this.speed * dt;
    let pushes = 0;
    while (this.rowFrac >= 1) {
      this.rowFrac -= 1;
      if (pushes++ < 8) this.pushRow(audio.bands);
    }
    if (pushes > 0) this.hist.needsUpdate = true;
    const scroll = this.rowsPushed - 2 + this.rowFrac;

    this.flash = Math.max(audio.beatPulse, audio.dropPulse);
    this.bob = damp(this.bob, audio.bass, 6, dt);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.set(Math.sin(time * 0.23) * 0.9, 2.4 + this.bob * 0.9 + Math.sin(time * 0.7) * 0.15, 6);
    cam.lookAt(cam.position.x * 0.4, 3.2, -60);
    cam.rotateZ(Math.sin(time * 0.31) * 0.04);
    cam.updateMatrixWorld();

    this.horizon.set(cam.position.x, cam.position.y, -3000).project(cam);

    const tu = this.terrainUniforms;
    tu.scroll.value = scroll;
    tu.flash.value = this.flash;
    tu.bass.value = audio.bass;
    (tu.camPos.value as THREE.Vector3).copy(cam.position);

    this.skyUniforms.time.value = time;
    this.skyUniforms.flash.value = this.flash;
    this.skyUniforms.horizon.value = this.horizon.y * 0.5 + 0.5;

    this.moonUniforms.time.value = time;
    this.moonUniforms.pulse.value = this.bob;
    this.moonUniforms.beat.value = audio.beatPulse;
    const s = 1 + this.bob * 0.06 + audio.dropPulse * 0.08;
    this.moon.scale.set(s, s, 1);
  }
}
