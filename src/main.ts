import './style.css';
import * as THREE from 'three';
import { SystemAudioSource, type AudioSource } from './audio/AudioEngine';
import { createEmptyFeatures } from './audio/features';
import { VisualManager } from './core/VisualManager';
import { PostFX } from './core/post';
import { Hud, StartScreen } from './ui/ui';
import { createVisuals } from './visuals';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const maxPixelRatio = Math.min(window.devicePixelRatio, 2);
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);

const manager = new VisualManager(createVisuals());
const post = new PostFX(renderer, manager);
const hud = new Hud();
const startScreen = new StartScreen();

const startVisual = Number(params.get('visual'));
if (startVisual >= 1 && startVisual <= manager.visuals.length) manager.current = startVisual - 1;
let autoCycle = params.get('auto') !== '0';
manager.auto = false; // stays off until audio is running

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(w, h, pixelRatio);
  manager.resize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
}

resize();
manager.init(renderer, Math.floor(window.innerWidth * pixelRatio), Math.floor(window.innerHeight * pixelRatio));
window.addEventListener('resize', resize);

manager.onChange = (i, v) => hud.setVisual(i, manager.visuals.length, v.name);
hud.setVisual(manager.current, manager.visuals.length, manager.visuals[manager.current].name, false);
hud.setAuto(autoCycle);

// ---- audio ----
let source: AudioSource | null = null;
const idleFeatures = createEmptyFeatures();

async function begin(src: AudioSource) {
  source = src;
  manager.auto = autoCycle;
  hud.show();
  hud.setVisual(manager.current, manager.visuals.length, manager.visuals[manager.current].name);
  void requestWakeLock();
}

startScreen.onStart(async () => {
  const src = new SystemAudioSource();
  await src.start();
  src.onEnded = () => {
    source = null;
    manager.auto = false;
    startScreen.show('Screen sharing stopped. Click the button to start again.');
  };
  await begin(src);
});

if (import.meta.env.DEV && params.has('debug')) {
  const { SyntheticSource } = await import('./audio/AudioEngine');
  startScreen.hide();
  await begin(new SyntheticSource());
}

// Keep the laptop screen awake during the party.
let wakeLock: WakeLockSentinel | null = null;
async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && source && !wakeLock) void requestWakeLock();
});

// ---- keyboard ----
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) {
    // 1–9, 0 → visuals 1–10; with Shift → 11–20. Uses e.code so Shift+digit isn't a symbol.
    const n = digit[1] === '0' ? 9 : Number(digit[1]) - 1;
    manager.goTo(n + (e.shiftKey ? 10 : 0));
  } else if (k === 'arrowright') {
    manager.step(1);
  } else if (k === 'arrowleft') {
    manager.step(-1);
  } else if (k === ' ') {
    if (startScreen.visible) return;
    e.preventDefault();
    autoCycle = !autoCycle;
    manager.auto = autoCycle && !!source;
    manager.elapsed = 0;
    hud.setAuto(autoCycle);
  } else if (k === 'f') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } else if (k === 'h') {
    hud.toggle();
  } else {
    return;
  }
  hud.wake();
});

// ---- render loop with adaptive resolution ----
const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
let fpsFrames = 0;
let fpsTime = 0;
let fps: number | null = null;

function adaptResolution(currentFps: number) {
  if (currentFps < 45 && pixelRatio > 0.6) {
    pixelRatio = Math.max(0.6, pixelRatio - 0.15);
    resize();
  } else if (currentFps > 58 && pixelRatio < Math.min(maxPixelRatio, 1.5)) {
    pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.1);
    resize();
  }
}

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  time += dt;
  const audio = source ? source.update(dt) : idleFeatures;
  manager.update(dt, time, audio);
  post.render(dt, time, audio, manager.bloom);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 2) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
    if (source) adaptResolution(fps);
  }
  hud.update(audio, params.has('debug') ? fps : null);
});

if (import.meta.env.DEV) {
  Object.assign(window, { __viz: { manager, get fps() { return fps; }, get pixelRatio() { return pixelRatio; } } });
}
