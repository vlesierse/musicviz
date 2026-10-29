import * as THREE from 'three';
import type { AudioFeatures } from '../audio/features';
import { GLSL_NOISE } from '../core/glsl';
import { PALETTE } from '../core/palette';
import { Visual, damp, fullscreenQuad } from '../core/Visual';

const BUBBLES = 900;
const SMOKE = 180;
const LIQUID_Y = 2.22;
const LIQUID_R = 0.92;
const FOV = 45;

/** Potion colour pairs [main, accent]; the brew cycles through them every 32 beats and on drops. */
const POTIONS: Array<[THREE.Color, THREE.Color]> = [
  [PALETTE.toxic.clone(), PALETTE.purple.clone()],
  [new THREE.Color(0x9b30ff), new THREE.Color(0xff2f9a)],
  [new THREE.Color(0xd0001c), new THREE.Color(0xff7a10)],
  [new THREE.Color(0x00e0c0), new THREE.Color(0x3a5cff)],
  [new THREE.Color(0xff7a00), new THREE.Color(0xffd040)],
  [new THREE.Color(0xff2fb0), new THREE.Color(0x30d8ff)],
];

const FIRE_RAMP = /* glsl */ `
vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.0), vec3(0.5, 0.03, 0.0), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(1.6, 0.35, 0.02), smoothstep(0.3, 0.6, t));
  c = mix(c, vec3(2.4, 1.2, 0.2), smoothstep(0.6, 0.9, t));
  return c;
}`;

/** Cauldron silhouette: outer belly, rolled lip, then the inner wall back down. */
function cauldronProfile() {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0.2)];
  for (let i = 0; i <= 24; i++) {
    const th = 0.12 + (i / 24) * 2.2;
    pts.push(new THREE.Vector2(1.32 * Math.sin(th), 1.1 - 0.92 * Math.cos(th)));
  }
  const top = pts[pts.length - 1];
  pts.push(
    new THREE.Vector2(top.x - 0.02, 1.86),
    new THREE.Vector2(top.x + 0.1, 1.93),
    new THREE.Vector2(top.x + 0.16, 2.0),
    new THREE.Vector2(top.x + 0.1, 2.07),
    new THREE.Vector2(top.x - 0.02, 2.05),
    new THREE.Vector2(top.x - 0.07, 1.95),
    new THREE.Vector2(top.x - 0.07, 1.75),
    new THREE.Vector2(1.05, 1.5),
    new THREE.Vector2(0.9, 1.2),
  );
  return pts;
}

/** 6. A bubbling witch's cauldron over a fire, belching green and purple smoke. */
export class CauldronVisual extends Visual {
  readonly name = "Witch's Cauldron";
  bloom = 0.75;
  private bgUniforms!: Record<string, THREE.IUniform>;
  private liquidUniforms!: Record<string, THREE.IUniform>;
  private fireUniforms!: Record<string, THREE.IUniform>;
  private smokeUniforms!: Record<string, THREE.IUniform>;
  private bubbleUniforms!: Record<string, THREE.IUniform>;
  private greenLight!: THREE.PointLight;
  private fireLight!: THREE.PointLight;
  private rimLight!: THREE.DirectionalLight;
  private flames: THREE.Mesh[] = [];
  private bubbles!: THREE.Points;
  // bubble state
  private bPos = new Float32Array(BUBBLES * 3);
  private bVel = new Float32Array(BUBBLES * 3);
  private bLife = new Float32Array(BUBBLES); // remaining life (s); <= 0 means dead
  private bPop = new Float32Array(BUBBLES); // > 0 while popping
  private bBase = new Float32Array(BUBBLES); // base size
  private bSize = new Float32Array(BUBBLES);
  private bAlpha = new Float32Array(BUBBLES);
  private bFly = new Uint8Array(BUBBLES); // 1 = erupted (ballistic)
  private bTint = new Float32Array(BUBBLES); // 0 = main potion colour, 1 = accent
  private bGrow = new Float32Array(BUBBLES); // total life, for the swell curve
  private colA = { value: new THREE.Color() };
  private colB = { value: new THREE.Color() };
  private potion = 0;
  private potionFrom = 0;
  private potionMix = 1;
  private potionSpeed = 0.4;
  private beatsInPotion = 0;
  private rippleT = 10;
  private rippleX = 0;
  private rippleZ = 0;
  private spawnAcc = 0;
  private flare = 0;
  private smokeTime = 0;
  private surge = 0;
  private orbit = 0;

  protected setup() {
    this.scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.014, 0.004, 0.026), 0.07);

    this.bgUniforms = { time: { value: 0 }, aspect: { value: 1 } };
    this.scene.add(
      fullscreenQuad(
        /* glsl */ `
        uniform float time, aspect;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          vec3 col = mix(vec3(0.014, 0.004, 0.026), vec3(0.003, 0.001, 0.008), smoothstep(0.45, 1.0, vUv.y));
          float mist = snoise(vec3(vUv * vec2(aspect * 2.0, 3.0) + vec2(time * 0.02, 0.0), time * 0.03)) * 0.5 + 0.5;
          col += vec3(0.04, 0.01, 0.06) * mist * smoothstep(0.9, 0.3, vUv.y);
          vec2 g = vec2(vUv.x * aspect, vUv.y) * 80.0;
          vec2 cell = floor(g);
          float star = step(0.95, hash21(cell)) * smoothstep(0.12, 0.0, length(fract(g) - hash22(cell)));
          col += vec3(0.6, 0.6, 0.8) * star * smoothstep(0.55, 0.9, vUv.y) * (0.5 + 0.5 * sin(time * 2.0 + hash21(cell) * 40.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
        this.bgUniforms,
      ),
    );

    // ground and logs
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1218, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const logMat = new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.0, 8), logMat);
      const a = (i / 5) * Math.PI * 2 + 0.3;
      log.position.set(Math.cos(a) * 0.55, 0.14, Math.sin(a) * 0.55);
      log.rotation.set(Math.PI / 2 - 0.15, 0, a + Math.PI / 2);
      log.rotation.order = 'YXZ';
      log.rotation.y = -a;
      log.rotation.x = Math.PI / 2 - 0.2;
      this.scene.add(log);
    }

    // cauldron
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
    const pot = new THREE.Mesh(new THREE.LatheGeometry(cauldronProfile(), 72), iron);
    pot.position.y = 0.45;
    this.scene.add(pot);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.06, 0.75, 8), iron);
      leg.position.set(Math.cos(a) * 0.85, 0.37, Math.sin(a) * 0.85);
      leg.rotation.z = Math.cos(a) * 0.25;
      leg.rotation.x = -Math.sin(a) * 0.25;
      this.scene.add(leg);
    }
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 20), iron);
      ring.position.set(side * 1.18, 2.0, 0);
      ring.rotation.y = Math.PI / 2;
      this.scene.add(ring);
    }

    // bubbling liquid
    this.liquidUniforms = {
      time: { value: 0 },
      bass: { value: 0 },
      flare: { value: 0 },
      swirl: { value: 0 },
      ripple: { value: 10 },
      rippleAt: { value: new THREE.Vector2() },
      colA: this.colA,
      colB: this.colB,
    };
    const liquid = new THREE.Mesh(
      new THREE.CircleGeometry(LIQUID_R, 96, 0, Math.PI * 2),
      new THREE.ShaderMaterial({
        uniforms: this.liquidUniforms,
        vertexShader: /* glsl */ `
          uniform float time, bass, ripple;
          uniform vec2 rippleAt;
          varying vec2 vP;
          varying float vH;
          varying float vRing;
          ${GLSL_NOISE}
          void main() {
            vec3 p = position;
            vP = p.xy;
            float r = length(p.xy);
            float h = snoise(vec3(p.xy * 2.4, time * 0.7)) * 0.05 + snoise(vec3(p.xy * 6.0, time * 1.6)) * 0.015;
            h *= 1.0 + bass * 3.0;
            h += bass * 0.06 * (1.0 - r);
            // expanding ripple ring from the last snare/mid hit
            float rr = length(p.xy - rippleAt);
            float ring = exp(-pow((rr - ripple * 0.55) * 10.0, 2.0)) * exp(-ripple * 1.6);
            h += ring * 0.05;
            vRing = ring;
            h *= 1.0 - smoothstep(0.75, 1.0, r);
            vH = h;
            p.z += h;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float time, flare, swirl;
          uniform vec3 colA, colB;
          varying vec2 vP;
          varying float vH;
          varying float vRing;
          ${GLSL_NOISE}
          void main() {
            float r = length(vP);
            float a = atan(vP.y, vP.x) + swirl + (1.0 - r) * 2.2;
            vec2 q = vec2(cos(a), sin(a)) * r;
            float n = fbm(vec3(q * 2.6, time * 0.15));
            float n2 = snoise(vec3(q * 5.0 + 3.0, time * 0.3));
            vec3 col = mix(colA * 0.03, colA * 0.42, smoothstep(-0.25, 0.7, n));
            col += colB * pow(max(n2, 0.0), 2.0) * 0.45;
            col += mix(colA, vec3(1.0), 0.25) * smoothstep(0.035, 0.1, vH) * 0.8;
            col += mix(colB, vec3(1.0), 0.3) * vRing * 1.4;
            col *= 0.7 + flare * 0.9;
            col *= mix(0.25, 1.0, smoothstep(1.0, 0.8, r));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    liquid.rotation.x = -Math.PI / 2;
    liquid.position.y = LIQUID_Y;
    this.scene.add(liquid);

    // lights
    this.scene.add(new THREE.HemisphereLight(0x2a1640, 0x000000, 0.5));
    this.greenLight = new THREE.PointLight(PALETTE.toxic, 6, 0, 2);
    this.greenLight.color = this.colA.value;
    this.greenLight.position.set(0, LIQUID_Y + 0.45, 0);
    this.scene.add(this.greenLight);
    this.fireLight = new THREE.PointLight(PALETTE.pumpkin, 6, 0, 2);
    this.fireLight.position.set(0, 0.3, 0);
    this.scene.add(this.fireLight);
    this.rimLight = new THREE.DirectionalLight(PALETTE.purple, 2.5);
    this.scene.add(this.rimLight);

    // fire under the cauldron: camera-facing flame cards
    this.fireUniforms = { time: { value: 0 }, heat: { value: 0.5 } };
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.fireUniforms, seed: { value: i * 13.7 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float time, heat, seed;
          varying vec2 vUv;
          ${GLSL_NOISE}
          ${FIRE_RAMP}
          void main() {
            vec2 q = vec2(vUv.x - 0.5, vUv.y);
            float n = fbm(vec3(q.x * 3.5, q.y * 2.5 - time * 2.6, seed));
            float w = 0.42 * (1.0 - q.y * 0.8);
            float body = smoothstep(w, w * 0.15, abs(q.x + n * 0.12 * q.y));
            float t = body * smoothstep(0.75 + heat * 0.2, 0.05, q.y + n * 0.35) * (0.75 + heat * 0.35);
            t *= smoothstep(0.0, 0.12, q.y) * smoothstep(0.5, 0.35, abs(q.x));
            gl_FragColor = vec4(fireRamp(t) * 0.8, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const flame = new THREE.Mesh(new THREE.PlaneGeometry(2.6 - i * 0.4, 1.6 - i * 0.2), mat);
      flame.position.set((i - 1) * 0.35, 0.82 - i * 0.05, (i - 1) * 0.2);
      this.flames.push(flame);
      this.scene.add(flame);
    }

    // smoke: fully GPU-animated soft sprites
    const sSeed = new Float32Array(SMOKE * 4);
    for (let i = 0; i < SMOKE * 4; i++) sSeed[i] = Math.random();
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3));
    sGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 4));
    this.smokeUniforms = { time: { value: 0 }, volume: { value: 0.5 }, pxScale: { value: 500 }, colA: this.colA, colB: this.colB };
    const smoke = new THREE.Points(
      sGeo,
      new THREE.ShaderMaterial({
        uniforms: this.smokeUniforms,
        vertexShader: /* glsl */ `
          uniform float time, volume, pxScale;
          uniform vec3 colA, colB;
          attribute vec4 aSeed;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float life = fract(time * (0.07 + aSeed.x * 0.05) + aSeed.y);
            float a = aSeed.z * 6.2831853;
            float r0 = sqrt(aSeed.w) * 0.8;
            vec3 p = vec3(cos(a) * r0, ${(LIQUID_Y + 0.25).toFixed(2)}, sin(a) * r0);
            p.y += life * (3.8 + aSeed.x * 1.5);
            p.x += sin(time * 0.4 + aSeed.y * 9.0 + life * 3.0) * life * 1.1 + life * life * 0.8;
            p.z += cos(time * 0.35 + aSeed.z * 7.0 + life * 2.5) * life * 1.1;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float size = (0.6 + life * 2.4) * (0.8 + volume * 0.4);
            gl_PointSize = size * pxScale / -mv.z;
            vAlpha = sin(3.14159 * life) * smoothstep(0.0, 0.1, life) * (0.02 + volume * 0.045);
            vColor = mix(colA * 0.6, colB * 0.9, smoothstep(0.2, 0.8, aSeed.w * 0.6 + life * 0.6));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float g = smoothstep(1.0, 0.0, d);
            gl_FragColor = vec4(vColor * g * g * vAlpha, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    smoke.frustumCulled = false;
    this.scene.add(smoke);

    // bubbles: CPU simulated so they can pop on beats and erupt on drops
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    bGeo.setAttribute('aSize', new THREE.BufferAttribute(this.bSize, 1));
    bGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.bAlpha, 1));
    bGeo.setAttribute('aTint', new THREE.BufferAttribute(this.bTint, 1));
    this.bubbleUniforms = { pxScale: { value: 500 }, flare: { value: 0 }, colA: this.colA, colB: this.colB };
    this.bubbles = new THREE.Points(
      bGeo,
      new THREE.ShaderMaterial({
        uniforms: this.bubbleUniforms,
        vertexShader: /* glsl */ `
          uniform float pxScale;
          uniform vec3 colA, colB;
          attribute float aSize;
          attribute float aAlpha;
          attribute float aTint;
          varying float vAlpha;
          varying vec3 vTint;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * pxScale / -mv.z;
            vAlpha = aAlpha;
            vTint = mix(colA, colB, aTint);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float flare;
          varying float vAlpha;
          varying vec3 vTint;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c) * 2.0;
            if (d > 1.0) discard;
            float rim = smoothstep(0.55, 0.9, d) * smoothstep(1.0, 0.9, d);
            float body = (1.0 - d * d) * 0.1;
            float glow = smoothstep(0.8, 0.0, length(c - vec2(0.0, 0.2))) * 0.18; // lit from the brew below
            float spec = smoothstep(0.2, 0.0, length(c - vec2(-0.18, -0.2)));
            vec3 col = mix(vTint * 0.35, vTint * (1.15 + flare * 0.5), rim) + vTint * glow * 1.1 + vec3(1.0) * spec;
            float alpha = clamp(rim * 0.95 + body * 2.0 + glow + spec * 0.9, 0.0, 1.0) * min(vAlpha, 1.0);
            gl_FragColor = vec4(col, alpha);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);

    const cam = this.camera as THREE.PerspectiveCamera;
    cam.fov = FOV;
    cam.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    super.resize(w, h);
    if (!this.bgUniforms) return;
    this.bgUniforms.aspect.value = w / h;
    const px = h / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    this.smokeUniforms.pxScale.value = px;
    this.bubbleUniforms.pxScale.value = px;
  }

  /**
   * kind: 'simmer' (background), 'big' (kick), 'fizz' (hi-hat), 'erupt' (drop),
   * 'droplet' (splash from a popping bubble at x/z).
   */
  private spawnBubble(kind: 'simmer' | 'big' | 'fizz' | 'erupt' | 'droplet', x = 0, z = 0, tint = 0) {
    for (let i = 0; i < BUBBLES; i++) {
      if (this.bLife[i] > 0 || this.bPop[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const maxR = kind === 'big' ? 0.6 : kind === 'erupt' ? 0.55 : 0.78;
      const r = Math.sqrt(Math.random()) * maxR;
      const i3 = i * 3;
      const fly = kind === 'erupt' || kind === 'droplet';
      this.bPos[i3] = kind === 'droplet' ? x : Math.cos(a) * r;
      this.bPos[i3 + 1] = LIQUID_Y + 0.02;
      this.bPos[i3 + 2] = kind === 'droplet' ? z : Math.sin(a) * r;
      if (fly) {
        const out = kind === 'erupt' ? 0.6 + Math.random() * 1.6 : 0.2 + Math.random() * 0.7;
        this.bVel[i3] = Math.cos(a) * out;
        this.bVel[i3 + 1] = kind === 'erupt' ? 3 + Math.random() * 4 : 1.2 + Math.random() * 1.8;
        this.bVel[i3 + 2] = Math.sin(a) * out;
        this.bLife[i] = kind === 'erupt' ? 3 : 1.2;
        this.bBase[i] = kind === 'erupt' ? 0.04 + Math.random() * 0.09 : 0.025 + Math.random() * 0.03;
        this.bTint[i] = kind === 'erupt' ? Math.random() : tint;
      } else if (kind === 'fizz') {
        this.bVel[i3] = (Math.random() - 0.5) * 0.15;
        this.bVel[i3 + 1] = 0.3 + Math.random() * 0.6;
        this.bVel[i3 + 2] = (Math.random() - 0.5) * 0.15;
        this.bLife[i] = 0.4 + Math.random() * 0.6;
        this.bBase[i] = 0.025 + Math.random() * 0.03;
        this.bTint[i] = 0.7 + Math.random() * 0.3;
      } else {
        const big = kind === 'big';
        this.bVel[i3] = (Math.random() - 0.5) * 0.04;
        this.bVel[i3 + 1] = 0.01 + Math.random() * (big ? 0.05 : 0.09);
        this.bVel[i3 + 2] = (Math.random() - 0.5) * 0.04;
        this.bLife[i] = big ? 1.2 + Math.random() * 1.4 : 1.4 + Math.random() * 2.6;
        this.bBase[i] = big ? 0.2 + Math.random() * 0.2 : 0.05 + Math.random() * Math.random() * 0.22;
        this.bTint[i] = big ? Math.random() * 0.35 : Math.random() * 0.6;
      }
      this.bGrow[i] = this.bLife[i];
      this.bFly[i] = fly ? 1 : 0;
      return;
    }
  }

  private updatePotion(dt: number, audio: AudioFeatures) {
    if (audio.beat) this.beatsInPotion++;
    const change = audio.drop || this.beatsInPotion >= 32;
    if (change) {
      this.potionFrom = this.potion;
      this.potion = (this.potion + 1 + (audio.drop ? Math.floor(Math.random() * 2) : 0)) % POTIONS.length;
      this.potionMix = 0;
      this.potionSpeed = audio.drop ? 2.5 : 0.35;
      this.beatsInPotion = 0;
    }
    this.potionMix = Math.min(1, this.potionMix + dt * this.potionSpeed);
    const m = this.potionMix * this.potionMix * (3 - 2 * this.potionMix);
    const [fa, fb] = POTIONS[this.potionFrom];
    const [ta, tb] = POTIONS[this.potion];
    this.colA.value.copy(fa).lerp(ta, m);
    this.colB.value.copy(fb).lerp(tb, m);
    // brighter/airier music pulls the brew toward its accent colour
    this.colA.value.lerp(this.colB.value, audio.brightness * 0.3);
  }

  update(dt: number, time: number, audio: AudioFeatures) {
    dt = Math.min(dt, 0.05);
    this.flare = damp(this.flare, audio.beatPulse * 0.6 + audio.midPulse * 0.25 + audio.dropPulse * 0.5, 12, dt);
    this.surge = damp(this.surge, audio.bass, 8, dt);
    this.updatePotion(dt, audio);

    // bubbles: a constant simmer driven by the whole spectrum, plus hits per range
    this.spawnAcc += dt * (6 + audio.level * 25 + audio.mid * 15);
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnBubble('simmer');
    }
    if (audio.beat) {
      const n = 3 + Math.floor(audio.bass * 9);
      for (let k = 0; k < n; k++) this.spawnBubble('big');
    }
    if (audio.midHit) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.45;
      this.rippleX = Math.cos(a) * r;
      this.rippleZ = Math.sin(a) * r;
      this.rippleT = 0;
    }
    if (audio.trebleHit) {
      const n = 6 + Math.floor(audio.treble * 16);
      for (let k = 0; k < n; k++) this.spawnBubble('fizz');
    }
    if (audio.drop) for (let k = 0; k < 200; k++) this.spawnBubble('erupt');
    this.rippleT += dt;

    for (let i = 0; i < BUBBLES; i++) {
      const i3 = i * 3;
      if (this.bPop[i] > 0) {
        this.bPop[i] -= dt;
        const t = 1 - Math.max(0, this.bPop[i]) / 0.18;
        this.bSize[i] = this.bBase[i] * (1 + t * 1.1);
        this.bAlpha[i] = (1 - t) * 1.8;
        if (this.bPop[i] <= 0) this.bSize[i] = this.bAlpha[i] = 0;
        continue;
      }
      if (this.bLife[i] <= 0) {
        this.bSize[i] = this.bAlpha[i] = 0;
        continue;
      }
      this.bLife[i] -= dt;
      if (this.bFly[i]) {
        this.bVel[i3 + 1] -= 7 * dt;
        this.bPos[i3] += this.bVel[i3] * dt;
        this.bPos[i3 + 1] += this.bVel[i3 + 1] * dt;
        this.bPos[i3 + 2] += this.bVel[i3 + 2] * dt;
        if (this.bPos[i3 + 1] < (this.bVel[i3 + 1] < 0 && Math.hypot(this.bPos[i3], this.bPos[i3 + 2]) < LIQUID_R ? LIQUID_Y : 0.05)) {
          this.bLife[i] = 0;
          this.bPop[i] = 0;
          this.bSize[i] = this.bAlpha[i] = 0;
          continue;
        }
        this.bSize[i] = this.bBase[i];
        this.bAlpha[i] = Math.min(1, this.bLife[i] * 2);
      } else {
        const wob = Math.sin(time * 6 + i) * 0.03;
        this.bPos[i3] += (this.bVel[i3] + wob) * dt;
        this.bPos[i3 + 1] += this.bVel[i3 + 1] * dt * (1 + this.surge);
        this.bPos[i3 + 2] += this.bVel[i3 + 2] * dt;
        // swell up over the first 60% of life, wobble a little on the kick
        const age = 1 - this.bLife[i] / this.bGrow[i];
        const swell = Math.min(1, 0.25 + age * 1.25);
        this.bSize[i] = this.bBase[i] * swell * (1 + audio.beatPulse * 0.12);
        this.bAlpha[i] = Math.min(1, age * 6) * 0.95;
      }
      if (this.bLife[i] <= 0) {
        this.bLife[i] = 0;
        this.bPop[i] = 0.18;
        // big bubbles splash droplets when they burst
        if (!this.bFly[i] && this.bBase[i] > 0.14) {
          const n = 2 + Math.floor(Math.random() * 3);
          for (let k = 0; k < n; k++) this.spawnBubble('droplet', this.bPos[i3], this.bPos[i3 + 2], this.bTint[i]);
        }
      }
    }
    const g = this.bubbles.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aTint.needsUpdate = true;
    this.bubbleUniforms.flare.value = this.flare;

    // liquid, smoke, fire
    const lu = this.liquidUniforms;
    lu.time.value = time;
    lu.bass.value = this.surge;
    lu.flare.value = this.flare;
    lu.swirl.value = time * 0.25 + this.smokeTime * 0.1;
    lu.ripple.value = this.rippleT;
    (lu.rippleAt.value as THREE.Vector2).set(this.rippleX, -this.rippleZ);
    this.smokeTime += dt * (0.8 + audio.mid * 1.2 + audio.treble * 0.8 + audio.dropPulse * 2);
    this.smokeUniforms.time.value = this.smokeTime;
    this.smokeUniforms.volume.value = damp(this.smokeUniforms.volume.value, 0.3 + audio.mid * 1.2 + audio.treble * 0.6 + audio.dropPulse * 0.4, 3, dt);
    this.fireUniforms.time.value = time;
    this.fireUniforms.heat.value = 0.35 + audio.bass * 0.35 + audio.level * 0.3 + audio.beatPulse * 0.15 + audio.dropPulse * 0.5;
    for (const f of this.flames) {
      (f.material as THREE.ShaderMaterial).uniforms.time.value = time;
      (f.material as THREE.ShaderMaterial).uniforms.heat.value = this.fireUniforms.heat.value;
    }

    // lights
    const flicker = 0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 7.3);
    this.fireLight.intensity = (4 + audio.level * 4) * flicker;
    this.greenLight.intensity = 4 + this.surge * 5 + this.flare * 12;
    this.rimLight.color.copy(this.colB.value).multiplyScalar(0.7);

    // slow orbit
    this.orbit += dt * (0.1 + audio.level * 0.08 + audio.treble * 0.06);
    const cam = this.camera as THREE.PerspectiveCamera;
    const R = 4.4;
    cam.position.set(Math.sin(this.orbit) * R, 4.5 + Math.sin(time * 0.3) * 0.25, Math.cos(this.orbit) * R);
    cam.lookAt(0, 1.85, 0);
    this.rimLight.position.set(-cam.position.x, 3, -cam.position.z);
    for (const f of this.flames) f.quaternion.copy(cam.quaternion);
    this.bgUniforms.time.value = time;
  }
}
