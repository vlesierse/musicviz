import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { FULLSCREEN_VERT, GLSL_NOISE } from '../core/glsl';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const RAIN = 3000;
const SPLASH = 2400;
const RIPPLES = 12;
const DRIPS = 24;
const RAIN_TOP = 11;
const X_HALF = 13;
const Z_NEAR = 6.5;
const Z_FAR = -26;
const GRAVITY = 9.8;

/** Shared sky function (also used for pool reflections). */
const SKY_GLSL = /* glsl */ `
uniform float time, moonRed, level, treble;
const vec3 MOON_DIR = normalize(vec3(0.42, 0.3, -1.0));
float fbm3(vec3 p) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { f += a * snoise(p); p *= 2.07; a *= 0.5; }
  return f;
}
float skyline(float az) {
  float h = 0.035 + 0.025 * snoise(vec3(az * 3.0, 1.3, 0.0)) + 0.01 * snoise(vec3(az * 11.0, 4.0, 0.0));
  // a crooked gothic manor with spires on the left
  float m = az + 0.42;
  h = max(h, step(abs(m), 0.07) * 0.085);
  h = max(h, step(abs(m + 0.045), 0.012) * (0.15 - abs(m + 0.045) * 4.0));
  h = max(h, step(abs(m - 0.05), 0.014) * (0.13 - abs(m - 0.05) * 3.5));
  h = max(h, step(abs(m - 0.005), 0.01) * (0.12 - abs(m - 0.005) * 5.0));
  // dead trees on the right: thin trunks with jagged, leafless crowns
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float tx = az - 0.28 - fi * 0.19;
    float top = 0.1 + 0.025 * fi;
    h = max(h, step(abs(tx), 0.003 + 0.0015 * fi) * top);
    float crown = top - 0.012 - abs(tx) * 0.9 + 0.022 * abs(sin(tx * 260.0 + fi)) * smoothstep(0.0, 0.01, abs(tx));
    h = max(h, step(abs(tx), 0.06) * crown * step(0.06, crown));
  }
  return h;
}
vec3 sky(vec3 d) {
  float y = d.y;
  vec3 col = mix(vec3(0.03, 0.004, 0.012), vec3(0.004, 0.001, 0.008), smoothstep(0.0, 0.6, y));
  // moon
  float md = acos(clamp(dot(d, MOON_DIR), -1.0, 1.0));
  vec3 moonCol = mix(vec3(1.0, 0.86, 0.8), vec3(1.0, 0.08, 0.04), moonRed);
  float disc = smoothstep(0.072, 0.068, md);
  vec2 mp = vec2(d.x - MOON_DIR.x, d.y - MOON_DIR.y) * 14.0;
  float cr = fbm3(vec3(mp * 1.5, 2.0));
  col += moonCol * exp(-md * 7.0) * 0.12 + moonCol * exp(-md * 25.0) * 0.12;
  col = mix(col, moonCol * (0.62 + 0.18 * cr), disc);
  // clouds
  vec2 cp = d.xz / max(y + 0.08, 0.02) * 0.6 + vec2(time * 0.02, 0.0);
  float n = fbm3(vec3(cp, time * 0.02));
  float dens = smoothstep(-0.05, 0.6, n) * smoothstep(0.02, 0.15, y);
  vec3 cloud = mix(vec3(0.03, 0.006, 0.01), moonCol * 0.32, exp(-md * 4.0));
  col = mix(col, cloud * (0.55 + 0.45 * n), dens * 0.8);
  // red fog at the horizon
  float fogN = 0.6 + 0.4 * snoise(vec3(d.x * 4.0 + time * 0.05, y * 6.0, time * 0.04));
  col += vec3(0.1, 0.004, 0.01) * exp(-abs(y) * 10.0) * fogN * (0.7 + level * 0.6);
  // silhouettes
  float az = atan(d.x, -d.z);
  float sil = smoothstep(0.002, -0.002, y - skyline(az)) * step(-0.01, y);
  col = mix(col, vec3(0.012, 0.0, 0.004) + vec3(0.05, 0.0, 0.006) * exp(-y * 30.0), sil);
  return col;
}
`;

const DROP_VERT = /* glsl */ `
attribute vec4 aPos;
attribute vec4 aVel;
uniform float stretch;
varying vec2 vQ;
varying float vLen, vAlpha, vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  vec3 vv = (modelViewMatrix * vec4(aVel.xyz, 0.0)).xyz;
  vec2 d = vv.xy;
  float sp = length(d);
  vec2 dir = sp > 1e-4 ? -d / sp : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  float w = aPos.w;
  float len = w + sp * stretch;
  mv.xy += side * position.x * w + dir * position.y * len;
  vQ = position.xy * 2.0;
  vLen = len / w;
  vAlpha = aVel.w;
  vFog = smoothstep(9.0, 34.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const DROP_FRAG = /* glsl */ `
uniform float glint;
varying vec2 vQ;
varying float vLen, vAlpha, vFog;
void main() {
  if (vAlpha <= 0.0) discard;
  // y = -vLen at the leading (falling) end, +vLen at the tail
  float py = vQ.y * vLen;
  float c = -vLen + 1.0;
  vec3 n;
  float cover;
  if (py < c) {
    vec2 q = vec2(vQ.x, py - c);
    float r = length(q);
    cover = 1.0 - smoothstep(0.85, 1.0, r);
    n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
  } else {
    float t = clamp((py - c) / max(2.0 * vLen - 1.0, 0.001), 0.0, 1.0);
    float rad = max(1.0 - t, 0.0);
    rad = sqrt(rad) * 0.95;
    float xr = vQ.x / max(rad, 0.01);
    cover = (1.0 - smoothstep(0.75, 1.0, abs(xr))) * (1.0 - t * 0.6);
    n = vec3(xr, 0.15, sqrt(max(1.0 - xr * xr, 0.0)));
  }
  if (cover <= 0.01) discard;
  n = normalize(n);
  vec3 L = normalize(vec3(-0.5, 0.55, 0.75));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  float rim = pow(1.0 - n.z, 2.0);
  vec3 col = vec3(0.13, 0.0, 0.006) + vec3(0.55, 0.01, 0.03) * rim + vec3(0.2, 0.0, 0.01) * max(dot(n, vec3(0.4, 0.3, -0.2)), 0.0);
  col += vec3(1.0, 0.8, 0.8) * spec * (0.9 + glint);
  col = mix(col, vec3(0.08, 0.004, 0.01), vFog * 0.8);
  gl_FragColor = vec4(col, cover * vAlpha * (1.0 - vFog * 0.7));
}`;

function dropMesh(count: number, material: THREE.ShaderMaterial) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const aVel = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  aPos.setUsage(THREE.DynamicDrawUsage);
  aVel.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aVel', aVel);
  geo.instanceCount = count;
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, pos: aPos.array as Float32Array, vel: aVel.array as Float32Array, aPos, aVel };
}

/** 11. Blood rain over a glossy pool of blood, with blood dripping down the lens. */
export class BloodRainVisual extends Visual {
  readonly name = 'Blood Rain';
  bloom = 0.7;
  private quad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private lens!: THREE.ShaderMaterial;
  private lensScene = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt!: THREE.WebGLRenderTarget;
  private dropMat!: THREE.ShaderMaterial;
  private rain!: ReturnType<typeof dropMesh>;
  private splash!: ReturnType<typeof dropMesh>;
  private rainSpeed = new Float32Array(RAIN);
  private splashLife = new Float32Array(SPLASH);
  private splashIdx = 0;
  private ripples: THREE.Vector4[] = [];
  private rippleIdx = 0;
  private drips: THREE.Vector4[] = [];
  private dripV = new Float32Array(DRIPS);
  private dripTarget = new Float32Array(DRIPS);
  private dripNext = new Float32Array(DRIPS);
  private poolY = -0.6;
  private sweepY = 2;
  private sweepA = 0;
  private topBand = 0.01;
  private density = 0.3;
  private speed = 1;
  private enterTime = -1;
  private nextDrip = 0;
  private bigQueue = 0;

  protected setup() {
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = 55;
    cam.position.set(0, 1.5, 9);
    cam.lookAt(0, 1.0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    for (let i = 0; i < RIPPLES; i++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));
    for (let i = 0; i < DRIPS; i++) this.drips.push(new THREE.Vector4(0, 2, 0.01, 0));

    this.quad = fullscreenQuad(
      /* glsl */ `
      uniform mat4 camWorld, projInv;
      uniform vec3 camPos;
      uniform float poolY, swell, rainDens;
      uniform vec4 ripples[${RIPPLES}];
      varying vec2 vUv;
      ${GLSL_NOISE}
      ${SKY_GLSL}

      // Accumulates the slope of expanding rings from many tiny rain impacts.
      vec2 rainRipples(vec2 p, float cell, float seed) {
        vec2 g = p / cell;
        vec2 id = floor(g);
        vec2 f = fract(g);
        vec2 slope = vec2(0.0);
        for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j));
          vec2 cid = id + o;
          float h = hash21(cid + seed);
          if (h > rainDens) continue;
          vec2 c = o + 0.2 + 0.6 * hash22(cid + seed * 3.1);
          float ph = fract(time * (0.9 + h) + hash21(cid * 1.7 + seed));
          vec2 dv = f - c;
          float d = length(dv);
          float r = ph * 0.9;
          float x = (d - r) * 22.0;
          float env = exp(-x * x * 0.08) * (1.0 - ph) * (1.0 - ph) * step(d, 0.95);
          slope += (dv / max(d, 1e-3)) * cos(x) * env;
        }
        return slope;
      }

      void main() {
        vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec4 vp = projInv * ndc;
        vec3 dir = normalize((camWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
        vec3 col;
        if (dir.y < -0.0005) {
          float t = (poolY - camPos.y) / dir.y;
          vec3 P = camPos + dir * t;
          vec2 s = vec2(0.0);
          // bass swell
          s += vec2(0.6, 0.3) * cos(dot(P.xz, vec2(0.6, 0.3)) - time * 1.6) * swell;
          s += vec2(-0.25, 0.5) * cos(dot(P.xz, vec2(-0.25, 0.5)) * 1.7 - time * 2.1) * swell * 0.7;
          s += vec2(0.1, 0.9) * cos(dot(P.xz, vec2(0.1, 0.9)) * 0.6 + time * 1.2) * swell;
          float fade = exp(-t * 0.06);
          s += rainRipples(P.xz, 0.55, 0.0) * 0.16 * fade;
          s += rainRipples(P.xz * mat2(0.8, -0.6, 0.6, 0.8), 0.8, 7.0) * 0.12 * fade;
          for (int k = 0; k < ${RIPPLES}; k++) {
            vec4 rp = ripples[k];
            float age = time - rp.z;
            if (age < 0.0 || age > 3.0) continue;
            vec2 dv = P.xz - rp.xy;
            float d = length(dv);
            float x = (d - age * 1.6) * 9.0;
            float env = exp(-x * x * 0.03) * exp(-age * 1.4) * rp.w;
            s += (dv / max(d, 1e-3)) * cos(x) * env * 0.5;
          }
          vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
          vec3 R = reflect(dir, N);
          R.y = abs(R.y);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-dir, N), 0.0), 5.0);
          vec3 refl = sky(R);
          refl = refl / (1.0 + refl * 2.5);
          col = vec3(0.016, 0.0, 0.001) + vec3(0.05, 0.0, 0.003) * max(dot(N, normalize(vec3(-0.3, 0.6, 0.5))), 0.0);
          col += refl * (0.1 + 0.9 * fres) * vec3(1.0, 0.55, 0.55);
          float glints = step(0.996 - treble * 0.008, hash21(floor(P.xz * 30.0) + floor(time * 8.0))) * fade;
          float spec = pow(max(dot(R, MOON_DIR), 0.0), 900.0);
          col += vec3(1.0, 0.7, 0.7) * (spec * 1.2 + glints * 0.25 * (0.5 + treble));
          // horizon fog
          col = mix(col, vec3(0.06, 0.003, 0.008) * (0.8 + level * 0.5), smoothstep(14.0, 70.0, t) * 0.8);
        } else {
          col = sky(dir);
          // fine drifting mist that sparkles with the treble
          float mist = fbm3(vec3(vUv * vec2(6.0, 3.0) + vec2(time * 0.05, -time * 0.4), time * 0.1));
          col += vec3(0.05, 0.004, 0.008) * smoothstep(0.1, 0.8, mist) * (0.3 + treble);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
      {
        time: { value: 0 },
        moonRed: { value: 0 },
        level: { value: 0 },
        treble: { value: 0 },
        camWorld: { value: cam.matrixWorld },
        projInv: { value: cam.projectionMatrixInverse },
        camPos: { value: cam.position },
        poolY: { value: this.poolY },
        swell: { value: 0.05 },
        rainDens: { value: 0.3 },
        ripples: { value: this.ripples },
      },
    );
    this.scene.add(this.quad);

    this.dropMat = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: DROP_FRAG,
      uniforms: { stretch: { value: 0.03 }, glint: { value: 0 } },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.rain = dropMesh(RAIN, this.dropMat);
    this.splash = dropMesh(SPLASH, this.dropMat);
    this.scene.add(this.rain.mesh, this.splash.mesh);
    for (let i = 0; i < RAIN; i++) this.spawnRain(i, Math.random());

    this.lens = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec4 drips[${DRIPS}];
        uniform float aspect, time, sweepY, sweepA, topBand, px;
        varying vec2 vUv;
        ${GLSL_NOISE}

        // returns (height, dh/dx, dh/dy)
        vec3 dripField(vec2 p) {
          vec3 best = vec3(0.0);
          for (int i = 0; i < ${DRIPS}; i++) {
            vec4 d = drips[i];
            if (d.w <= 0.0) continue;
            float w = d.z;
            float dx = p.x - d.x;
            if (abs(dx) > w * 2.5) continue;
            // trail from the top edge to the head, wobbling width
            float wob = 0.65 + 0.2 * sin(p.y * 37.0 + d.x * 50.0) + 0.12 * sin(p.y * 91.0 + d.x * 13.0);
            float wt = w * wob * mix(0.55, 1.0, d.w);
            float inTrail = step(d.y, p.y);
            float q = dx / wt;
            float ht = sqrt(max(1.0 - q * q, 0.0)) * wt * inTrail * d.w;
            vec3 r = vec3(ht, -q / max(sqrt(max(1.0 - q * q, 0.0)), 0.15) * inTrail * d.w, 0.0);
            // bulbous head
            vec2 hc = vec2(d.x, d.y + w * 0.6);
            vec2 e = (p - hc) / vec2(w * 1.35, w * 1.8);
            float e2 = dot(e, e);
            float hh = sqrt(max(1.0 - e2, 0.0)) * w * 1.5 * d.w;
            if (hh > r.x) {
              float z = max(sqrt(max(1.0 - e2, 0.0)), 0.15);
              r = vec3(hh, -e.x / z * 1.1 * d.w, -e.y / z * 0.85 * d.w);
            }
            if (r.x > best.x) best = r;
          }
          return best;
        }

        void main() {
          vec2 p = vec2(vUv.x * aspect, vUv.y);
          vec3 f = dripField(p);
          // meniscus along the top edge
          float band = topBand * (0.7 + 0.5 * snoise(vec3(p.x * 6.0, 0.0, time * 0.05)) + 0.3 * sin(p.x * 31.0));
          float sTop = (p.y - (1.0 - band)) / max(band, 1e-4);
          if (sTop > 0.0) {
            float h = sqrt(clamp(sTop, 0.0, 1.0)) * band * 0.7;
            if (h > f.x) f = vec3(h, 0.0, 0.5 / sqrt(max(sTop, 0.05)));
          }
          // the sweeping sheet of blood on drops, with long fingers hanging below its edge
          if (sweepA > 0.0) {
            float fing = pow(max(snoise(vec3(p.x * 9.0, 3.0, 0.0)), 0.0), 2.0) * 0.18 + pow(max(snoise(vec3(p.x * 23.0, 9.0, 0.0)), 0.0), 3.0) * 0.12;
            float edge = sweepY - fing + 0.02 * sin(p.x * 17.0);
            float sd = p.y - edge;
            if (sd > 0.0) {
              float th = mix(0.004, 0.02, smoothstep(0.0, 0.05, sd)) * sweepA;
              th *= 0.8 + 0.25 * snoise(vec3(p * 5.0, time * 0.3));
              if (th > f.x) f = vec3(th, 0.6 * sin(p.x * 40.0) * 0.2, (1.0 - smoothstep(0.0, 0.05, sd)) * 1.5);
            }
          }
          float h = f.x;
          vec2 slope = f.yz;
          float cover = smoothstep(0.0, px * 1.2, h);
          vec2 ruv = vUv - slope * 0.035 * cover;
          vec3 scene = texture2D(tScene, vUv).rgb;
          vec3 behind = texture2D(tScene, ruv).rgb;
          float thick = h * 70.0;
          vec3 absorb = exp(-vec3(0.35, 5.0, 4.5) * (0.35 + thick * 1.4));
          vec3 blood = behind * absorb * 1.6 + vec3(0.11, 0.0, 0.006) * (0.35 + 0.65 * exp(-thick * 1.2));
          vec3 N = normalize(vec3(-slope, 1.0));
          float spec = pow(max(dot(N, normalize(vec3(-0.35, 0.45, 1.0))), 0.0), 120.0);
          float spec2 = pow(max(dot(N, normalize(vec3(0.5, -0.2, 1.0))), 0.0), 30.0);
          blood += vec3(1.0, 0.82, 0.82) * spec * 1.4 + vec3(0.25, 0.02, 0.03) * spec2;
          blood *= 1.0 - 0.35 * pow(1.0 - N.z, 1.5);
          gl_FragColor = vec4(mix(scene, blood, cover), 1.0);
        }`,
      uniforms: {
        tScene: { value: null },
        drips: { value: this.drips },
        aspect: { value: 1 },
        time: { value: 0 },
        sweepY: { value: 2 },
        sweepA: { value: 0 },
        topBand: { value: 0.01 },
        px: { value: 0.001 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const lq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lens);
    lq.frustumCulled = false;
    this.lensScene.add(lq);
  }

  private spawnRain(i: number, heightFrac: number) {
    const p = this.rain.pos;
    const v = this.rain.vel;
    const b = i * 4;
    const z = Z_FAR + Math.pow(Math.random(), 0.7) * (Z_NEAR - Z_FAR);
    p[b] = (Math.random() * 2 - 1) * X_HALF * (0.4 + (Z_NEAR - z) / (Z_NEAR - Z_FAR));
    p[b + 1] = this.poolY + heightFrac * (RAIN_TOP - this.poolY);
    p[b + 2] = z;
    p[b + 3] = 0.02 + Math.random() * 0.025;
    this.rainSpeed[i] = 9 + Math.random() * 5;
    v[b] = 0.25;
    v[b + 1] = -this.rainSpeed[i];
    v[b + 2] = 0;
    v[b + 3] = i / RAIN < this.density ? 0.55 + Math.random() * 0.4 : 0;
  }

  private emitSplash(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
    const i = this.splashIdx;
    this.splashIdx = (i + 1) % SPLASH;
    const b = i * 4;
    const p = this.splash.pos;
    const v = this.splash.vel;
    p[b] = x;
    p[b + 1] = y;
    p[b + 2] = z;
    p[b + 3] = size;
    v[b] = vx;
    v[b + 1] = vy;
    v[b + 2] = vz;
    v[b + 3] = 0.95;
    this.splashLife[i] = life;
  }

  private crown(x: number, z: number, strength: number) {
    const n = 14 + Math.floor(strength * 10);
    const y = this.poolY + 0.01;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const out = (0.9 + Math.random() * 0.8) * strength;
      const up = (2.2 + Math.random() * 1.6) * strength;
      this.emitSplash(x + Math.cos(a) * 0.08, y, z + Math.sin(a) * 0.08, Math.cos(a) * out, up, Math.sin(a) * out, 0.02 + Math.random() * 0.02 * strength, 2);
    }
    // Worthington jet
    this.emitSplash(x, y, z, 0, 3.6 * strength, 0, 0.045 * strength, 2);
    this.emitSplash(x, y, z, 0, 2.6 * strength, 0, 0.035 * strength, 2);
    const r = this.ripples[this.rippleIdx];
    this.rippleIdx = (this.rippleIdx + 1) % RIPPLES;
    r.set(x, z, this.quad.material.uniforms.time.value, strength);
  }

  private spawnBigDrop() {
    // Re-uses a rain slot as a fat, fast drop.
    const i = Math.floor(Math.random() * RAIN);
    const b = i * 4;
    const p = this.rain.pos;
    const v = this.rain.vel;
    p[b] = (Math.random() * 2 - 1) * 5;
    p[b + 1] = 5 + Math.random() * 4;
    p[b + 2] = -6 + Math.random() * 10;
    p[b + 3] = 0.045 + Math.random() * 0.03;
    this.rainSpeed[i] = 16;
    v[b] = 0;
    v[b + 1] = -16;
    v[b + 2] = 0;
    v[b + 3] = 1;
  }

  private spawnDrip(time: number, wide = false) {
    let slot = -1;
    let minA = 2;
    for (let i = 0; i < DRIPS; i++) {
      if (this.drips[i].w < minA) {
        minA = this.drips[i].w;
        slot = i;
      }
    }
    if (slot < 0 || minA > 0.25) return;
    const aspect = this.width / this.height;
    const w = wide ? 0.012 + Math.random() * 0.012 : 0.006 + Math.random() * 0.01;
    this.drips[slot].set(0.03 + Math.random() * (aspect - 0.06), 1.0 + w, w, 1);
    this.dripV[slot] = 0;
    this.dripTarget[slot] = 0.05;
    this.dripNext[slot] = time;
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.quad) return;
    this.lens.uniforms.aspect.value = w / h;
    this.lens.uniforms.px.value = 1 / h;
    if (!this.rt) this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    else this.rt.setSize(w, h);
  }

  onEnter() {
    this.enterTime = -1;
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    if (this.enterTime < 0) {
      this.enterTime = time;
      this.topBand = 0.008;
      for (const d of this.drips) d.w = 0;
      this.sweepA = 0;
      for (let i = 0; i < 5; i++) this.spawnDrip(time);
    }
    const since = time - this.enterTime;
    // The pool slowly rises while the visual is shown.
    this.poolY = -0.6 + Math.min(1, since / 90) * 0.7 + Math.sin(time * 0.7) * audio.bass * 0.03;

    this.density = damp(this.density, 0.25 + audio.level * 0.75, 2, dt);
    this.speed = damp(this.speed, 0.8 + audio.level * 0.6 + audio.dropPulse * 0.4, 2, dt);
    if (audio.beat) this.bigQueue += 6 + Math.floor(audio.bass * 14);
    if (audio.drop) {
      this.bigQueue += 40;
      this.sweepY = 1.25;
      this.sweepA = 1;
    }
    const spawnN = Math.min(this.bigQueue, Math.ceil(dt * 400));
    for (let k = 0; k < spawnN; k++) this.spawnBigDrop();
    this.bigQueue -= spawnN;
    if (audio.beat) {
      for (let k = 0; k < 2 + Math.floor(audio.bass * 3); k++) {
        this.crown((Math.random() * 2 - 1) * 4, -4 + Math.random() * 8, 0.8 + audio.bass * 0.5);
      }
    }

    // rain
    const p = this.rain.pos;
    const v = this.rain.vel;
    const wind = Math.sin(time * 0.3) * 0.6 + 0.3;
    for (let i = 0; i < RAIN; i++) {
      const b = i * 4;
      const big = p[b + 3] > 0.04;
      const vy = -this.rainSpeed[i] * (big ? 1 : this.speed);
      v[b] = wind;
      v[b + 1] = vy;
      p[b] += wind * dt;
      p[b + 1] += vy * dt;
      if (p[b + 1] < this.poolY) {
        const x = p[b];
        const z = p[b + 2];
        if (v[b + 3] > 0) {
          if (big) this.crown(x, z, 0.9 + Math.random() * 0.4);
          else if (z > -12 && Math.random() < 0.5) {
            const n = 1 + Math.floor(Math.random() * 3);
            for (let k = 0; k < n; k++) {
              const a = Math.random() * Math.PI * 2;
              this.emitSplash(x, this.poolY, z, Math.cos(a) * 0.6, 1 + Math.random() * 1.4, Math.sin(a) * 0.6, 0.008 + Math.random() * 0.008, 1);
            }
          }
        }
        this.spawnRain(i, 1);
      }
    }
    this.rain.aPos.needsUpdate = true;
    this.rain.aVel.needsUpdate = true;

    // splashes
    const sp = this.splash.pos;
    const sv = this.splash.vel;
    for (let i = 0; i < SPLASH; i++) {
      const b = i * 4;
      if (sv[b + 3] <= 0) continue;
      sv[b + 1] -= GRAVITY * dt;
      sp[b] += sv[b] * dt;
      sp[b + 1] += sv[b + 1] * dt;
      sp[b + 2] += sv[b + 2] * dt;
      this.splashLife[i] -= dt;
      if (sp[b + 1] < this.poolY - 0.02 || this.splashLife[i] <= 0) sv[b + 3] = 0;
    }
    this.splash.aPos.needsUpdate = true;
    this.splash.aVel.needsUpdate = true;

    // lens drips: stick-slip motion
    const rate = 0.15 + audio.level * 0.8;
    if (time > this.nextDrip) {
      this.spawnDrip(time);
      this.nextDrip = time + (0.5 + Math.random()) / rate;
    }
    if (audio.beat && Math.random() < 0.3 + audio.bass * 0.4) this.spawnDrip(time, true);
    if (audio.drop) for (let i = 0; i < 10; i++) this.spawnDrip(time, true);
    for (let i = 0; i < DRIPS; i++) {
      const d = this.drips[i];
      if (d.w <= 0) continue;
      if (time > this.dripNext[i]) {
        const slip = Math.random() < 0.55;
        this.dripTarget[i] = slip ? 0.08 + Math.random() * 0.25 * (d.z / 0.012) : 0.004;
        this.dripNext[i] = time + (slip ? 0.15 + Math.random() * 0.5 : 0.2 + Math.random() * 1.2);
      }
      this.dripV[i] = damp(this.dripV[i], this.dripTarget[i], 6, dt);
      d.y -= this.dripV[i] * dt;
      d.w -= dt * (d.y < -0.05 ? 0.6 : 0.075);
      if (d.w < 0) d.w = 0;
    }
    this.topBand = damp(this.topBand, 0.008 + audio.level * 0.012 + audio.dropPulse * 0.02, 0.5, dt);
    if (this.sweepA > 0) {
      this.sweepY -= dt * (0.5 + Math.max(0, this.sweepY) * 0.9);
      if (this.sweepY < 0.5) this.sweepA = Math.max(0, this.sweepA - dt * 0.35);
    }

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.position.x = Math.sin(time * 0.07) * 0.8;
    cam.position.y = 1.5 + Math.sin(time * 0.11) * 0.15 + audio.beatPulse * 0.03;
    cam.lookAt(0, 1.0, 0);
    cam.updateMatrixWorld();

    const u = this.quad.material.uniforms;
    u.time.value = time;
    u.moonRed.value = damp(u.moonRed.value, Math.min(1, 0.25 + audio.dropPulse * 1.2), 3, dt);
    u.level.value = audio.level;
    u.treble.value = audio.treble;
    u.poolY.value = this.poolY;
    u.swell.value = damp(u.swell.value, 0.03 + audio.bass * 0.12 + audio.beatPulse * 0.04, 6, dt);
    u.rainDens.value = 0.1 + this.density * 0.6;
    this.dropMat.uniforms.glint.value = audio.treble * 1.5;

    const l = this.lens.uniforms;
    l.time.value = time;
    l.sweepY.value = this.sweepY;
    l.sweepA.value = this.sweepA;
    l.topBand.value = this.topBand;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    this.lens.uniforms.tScene.value = this.rt.texture;
    renderer.setRenderTarget(target);
    renderer.render(this.lensScene, this.ortho);
  }

  dispose() {
    super.dispose();
    this.rt?.dispose();
    this.lens.dispose();
  }
}
