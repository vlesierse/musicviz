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

/**
 * Colour schemes: [low lines, mid lines, peaks, accent (snare wave), horizon glow, moon low, moon high].
 * Cycled every 32 beats and on drops.
 */
const SCHEMES: THREE.Color[][] = [
  [PALETTE.purple, PALETTE.pumpkin, PALETTE.toxic, new THREE.Color(0xff2fb0), new THREE.Color(0.35, 0.03, 0.12), PALETTE.blood, PALETTE.ember],
  [new THREE.Color(0x00c0b0), PALETTE.toxic, new THREE.Color(0xffd040), new THREE.Color(0x9b30ff), new THREE.Color(0.03, 0.16, 0.08), new THREE.Color(0x0a8030), new THREE.Color(0x70d020)],
  [new THREE.Color(0x6a20ff), new THREE.Color(0xff2fb0), new THREE.Color(0x30d8ff), new THREE.Color(0xffd040), new THREE.Color(0.28, 0.03, 0.3), new THREE.Color(0x7010c0), new THREE.Color(0xff3090)],
  [new THREE.Color(0xd0001c), PALETTE.ember, PALETTE.candle, new THREE.Color(0x30d8ff), new THREE.Color(0.4, 0.07, 0.02), new THREE.Color(0xc02000), new THREE.Color(0xffa020)],
  [new THREE.Color(0x2040ff), new THREE.Color(0x30d0ff), new THREE.Color(0xc0fff0), new THREE.Color(0xff2fb0), new THREE.Color(0.03, 0.12, 0.3), new THREE.Color(0x2050d0), new THREE.Color(0x60d0ff)],
].map((c) => c.map((x) => x.clone()));

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
  private cols = Array.from({ length: 7 }, () => new THREE.Color());
  private scheme = 0;
  private schemeFrom = 0;
  private schemeMix = 1;
  private schemeSpeed = 0.4;
  private beatsInScheme = 0;
  private midAge = 10;
  private midAmp = 0;
  private sparkle = 0;
  private stripes = 0;
  private twinkle = 0;

  protected setup() {
    this.hist = new THREE.DataTexture(this.histData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.hist.wrapS = THREE.ClampToEdgeWrapping;
    this.hist.wrapT = THREE.RepeatWrapping;
    this.hist.magFilter = this.hist.minFilter = THREE.LinearFilter;
    this.hist.needsUpdate = true;

    this.applyScheme(1, 0);
    this.skyUniforms = {
      time: { value: 0 },
      aspect: { value: 1 },
      horizon: { value: 0.5 },
      flash: { value: 0 },
      twinkle: { value: 0 },
      glowCol: { value: this.cols[4] },
    };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect, horizon, flash, twinkle;
        uniform vec3 glowCol;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          float y = vUv.y - horizon;
          vec3 col = mix(${FOG}, ${glslColor(PALETTE.night)}, smoothstep(0.0, 0.45, y));
          col += glowCol * exp(-abs(y) * 14.0) * (0.35 + flash * 0.8);
          vec2 g = vec2(vUv.x * aspect, vUv.y) * 90.0;
          vec2 cell = floor(g);
          vec2 f = fract(g) - hash22(cell);
          float star = step(0.93, hash21(cell)) * smoothstep(0.12, 0.0, length(f));
          star *= 0.5 + 0.5 * sin(time * (1.0 + hash21(cell + 1.0) * 3.0) + hash21(cell) * 50.0);
          // hats make a random handful of stars flare
          star *= 1.0 + twinkle * 2.5 * step(0.6, hash21(cell + floor(time * 9.0)));
          col += ${glslColor(PALETTE.ghost)} * star * 0.7 * smoothstep(0.02, 0.2, y);
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.skyUniforms,
      ),
    );

    // Blood moon with synthwave stripe cut-outs.
    this.moonUniforms = {
      time: { value: 0 },
      pulse: { value: 0 },
      beat: { value: 0 },
      stripes: { value: 0 },
      moonA: { value: this.cols[5] },
      moonB: { value: this.cols[6] },
      glowCol: { value: this.cols[4] },
    };
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.ShaderMaterial({
        uniforms: this.moonUniforms,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float time, pulse, beat, stripes;
          uniform vec3 moonA, moonB, glowCol;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float d = length(p) / 0.62;
            float disc = smoothstep(1.0, 0.985, d);
            float yy = p.y / 0.62;
            float gap = smoothstep(0.35, -0.95, yy) * 0.8;
            float cut = step(gap, fract(yy * 7.0 + stripes));
            float n = fbm(vec3(p * 3.0, 1.0));
            vec3 moon = mix(moonA * 0.9, moonB * 1.1, smoothstep(-0.9, 1.0, yy));
            moon *= (0.75 + 0.35 * n) * (0.85 + pulse * 0.5 + beat * 0.25);
            vec3 col = moon * disc * cut;
            col += glowCol * 1.3 * exp(-max(d - 1.0, 0.0) * 5.0) * (1.0 - disc) * (0.3 + pulse * 0.4);
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
      midWave: { value: 10 },
      midAmp: { value: 0 },
      sparkle: { value: 0 },
      seed: { value: 0 },
      colA: { value: this.cols[0] },
      colB: { value: this.cols[1] },
      colC: { value: this.cols[2] },
      colD: { value: this.cols[3] },
    };
    const terrain = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.terrainUniforms,
        vertexShader: /* glsl */ `
          uniform sampler2D tHist;
          uniform float scroll, midWave, midAmp;
          varying float vH;
          varying float vG;
          varying float vBp;
          varying float vWave;
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
            // snare/clap: a ripple that rolls from the camera out to the horizon
            float wz = ${Z_NEAR.toFixed(1)} - 7.0 - midWave * 55.0;
            float wave = exp(-pow((pos.z - wz) / 3.5, 2.0)) * midAmp;
            h += wave * (0.6 + h * 0.25) * smoothstep(1.0, 5.0, ax);
            pos.y = h;
            vH = h;
            vG = G;
            vBp = bp;
            vWave = wave;
            vec4 wp = modelMatrix * vec4(pos, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float flash, bass, sparkle, seed;
          uniform vec3 camPos, colA, colB, colC, colD;
          varying float vH;
          varying float vG;
          varying float vBp;
          varying float vWave;
          varying vec3 vWorld;
          float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          void main() {
            vec2 gc = vec2(vWorld.x * 0.7, vG * 0.5);
            vec2 fw = max(fwidth(gc), vec2(1e-4));
            vec2 l = abs(fract(gc - 0.5) - 0.5) / (fw * 1.3);
            vec2 lineXY = 1.0 - min(l, 1.0);
            lineXY *= 1.0 - smoothstep(0.15, 0.5, fw);
            float line = max(lineXY.x, lineXY.y);
            float t = clamp(vH / 9.0, 0.0, 1.0);
            // low lines shift hue from the bass lanes (centre) to the treble lanes (outside)
            vec3 lowC = mix(colA, colB, smoothstep(0.35, 1.0, vBp) * 0.45) * 1.6;
            vec3 lc = mix(lowC, colB * 2.4, smoothstep(0.08, 0.5, t));
            lc = mix(lc, colC * 2.4, smoothstep(0.6, 0.95, t));
            float wv = clamp(vWave, 0.0, 1.0) * (1.0 - 0.7 * clamp(flash, 0.0, 1.0));
            lc = mix(lc, colD * 2.0, wv * 0.7);
            vec3 surf = ${glslColor(PALETTE.violet)} * 0.05 + lc * 0.07 * t + colD * wv * 0.05;
            vec3 col = surf + lc * line * (0.8 + flash * 1.4 + bass * 0.4 + wv * 0.45);
            // hats: grid crossings on the terrain glint
            vec2 cid = floor(gc + 0.5);
            vec2 nd = (fract(gc - 0.5) - 0.5) / fw;
            float star = exp(-dot(nd, nd) / 7.0) + 0.6 * (exp(-abs(nd.x) * 0.35 - nd.y * nd.y) + exp(-abs(nd.y) * 0.35 - nd.x * nd.x));
            float glint = step(0.82, hash12(cid + seed)) * min(star, 1.5) * sparkle * (1.0 - smoothstep(0.1, 0.4, max(fw.x, fw.y)));
            col += mix(colC, vec3(1.0), 0.35) * glint * (1.2 + t * 2.0);
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

  private applyScheme(dt: number, brightness: number) {
    this.schemeMix = Math.min(1, this.schemeMix + dt * this.schemeSpeed);
    const m = this.schemeMix * this.schemeMix * (3 - 2 * this.schemeMix);
    const from = SCHEMES[this.schemeFrom];
    const to = SCHEMES[this.scheme];
    for (let k = 0; k < this.cols.length; k++) this.cols[k].copy(from[k]).lerp(to[k], m);
    // brighter, airier music pulls the low lines and the horizon toward the mid colour
    this.cols[0].lerp(this.cols[1], brightness * 0.3);
    this.cols[4].lerp(this.cols[1], brightness * 0.15);
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (audio.beat) this.beatsInScheme++;
    if (audio.drop || this.beatsInScheme >= 32) {
      this.schemeFrom = this.scheme;
      this.scheme = (this.scheme + 1 + (audio.drop ? Math.floor(Math.random() * 2) : 0)) % SCHEMES.length;
      this.schemeMix = 0;
      this.schemeSpeed = audio.drop ? 2.5 : 0.35;
      this.beatsInScheme = 0;
    }
    this.applyScheme(dt, audio.brightness);
    if (audio.midHit) {
      this.midAge = 0;
      this.midAmp = 0.7 + audio.mid * 0.6;
    }
    this.midAge += dt;
    this.midAmp *= Math.exp(-1.6 * dt);
    if (audio.trebleHit) {
      this.sparkle = Math.min(1.3, this.sparkle + 0.6 + audio.treble * 0.5);
      this.terrainUniforms.seed.value = Math.random() * 100;
    }
    this.sparkle = damp(this.sparkle, audio.treble * 0.15, 4, dt);
    this.twinkle = damp(this.twinkle, audio.treblePulse * 0.7 + audio.treble * 0.3, 10, dt);
    this.stripes += dt * (0.2 + audio.mid * 0.7 + audio.dropPulse * 1.5);

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
    tu.midWave.value = this.midAge;
    tu.midAmp.value = this.midAmp;
    tu.sparkle.value = this.sparkle;
    (tu.camPos.value as THREE.Vector3).copy(cam.position);

    this.skyUniforms.time.value = time;
    this.skyUniforms.flash.value = this.flash;
    this.skyUniforms.twinkle.value = this.twinkle;
    this.skyUniforms.horizon.value = this.horizon.y * 0.5 + 0.5;

    this.moonUniforms.time.value = time;
    this.moonUniforms.stripes.value = this.stripes;
    this.moonUniforms.pulse.value = this.bob;
    this.moonUniforms.beat.value = audio.beatPulse;
    const s = 1 + this.bob * 0.06 + audio.dropPulse * 0.08;
    this.moon.scale.set(s, s, 1);
  }
}
