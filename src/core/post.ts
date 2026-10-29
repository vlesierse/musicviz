import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { AudioFeatures } from '../audio/features';
import type { VisualManager } from './VisualManager';
import { FULLSCREEN_VERT, GLSL_NOISE } from './glsl';

function makeTarget() {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
}

/** Renders the active visual(s) and blends them with a spooky noise dissolve. */
class CrossfadePass extends Pass {
  private readonly rtA = makeTarget();
  private readonly rtB = makeTarget();
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly manager: VisualManager) {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        progress: { value: 0 },
        aspect: { value: 1 },
      },
      fragmentShader: /* glsl */ `
        uniform sampler2D tA; uniform sampler2D tB; uniform float progress; uniform float aspect;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          vec4 a = texture2D(tA, vUv);
          if (progress <= 0.0) { gl_FragColor = a; return; }
          vec4 b = texture2D(tB, vUv);
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          float n = clamp(fbm(vec3(p * 2.5, 1.7)) + 0.5, 0.0, 1.0);
          n = mix(n, length(p) * 0.9, 0.35);
          float edge = progress * 1.2 - 0.1;
          float m = smoothstep(edge + 0.02, edge - 0.02, n);
          float fadeRim = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.85, 1.0, progress));
          float rim = smoothstep(0.03, 0.0, abs(n - edge - 0.02)) * fadeRim;
          vec3 col = mix(a.rgb, b.rgb, m) + rim * vec3(1.0, 0.35, 0.03);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number) {
    this.rtA.setSize(width, height);
    this.rtB.setSize(width, height);
    this.material.uniforms.aspect.value = width / height;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    const m = this.manager;
    m.visuals[m.current].render(renderer, this.rtA);
    let progress = 0;
    if (m.isFading) {
      m.visuals[m.next].render(renderer, this.rtB);
      progress = m.fade;
    }
    this.material.uniforms.tA.value = this.rtA.texture;
    this.material.uniforms.tB.value = this.rtB.texture;
    this.material.uniforms.progress.value = progress;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const FxShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aberration: { value: 0 },
    grain: { value: 0.035 },
    vignette: { value: 1.1 },
    flash: { value: 0 },
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float aberration; uniform float grain;
    uniform float vignette; uniform float flash;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * aberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col += flash * vec3(0.55, 0.25, 0.9);
      float v = smoothstep(0.85, 0.2, length(d) * vignette);
      col *= mix(0.25, 1.0, v);
      col += (rand(vUv * 913.0 + fract(time) * 37.0) - 0.5) * grain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/** Post-processing chain: crossfade → bloom → aberration/grain/vignette → tone map + sRGB. */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly fx: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, manager: VisualManager) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new CrossfadePass(manager));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.5, 0.5);
    this.composer.addPass(this.bloom);
    this.fx = new ShaderPass(FxShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(dt: number, time: number, audio: AudioFeatures, bloomScale: number) {
    this.bloom.strength = (0.55 + audio.bass * 0.35 + audio.beatPulse * 0.3) * bloomScale;
    const u = this.fx.uniforms;
    u.time.value = time;
    u.aberration.value = 0.0015 + audio.beatPulse * 0.01 + audio.dropPulse * 0.02;
    u.flash.value = audio.dropPulse * audio.dropPulse * 0.25;
    this.composer.render(dt);
  }
}
