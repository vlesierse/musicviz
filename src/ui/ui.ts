import type { AudioFeatures } from '../audio/features';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class StartScreen {
  private readonly root = $('start');
  private readonly button = $<HTMLButtonElement>('start-btn');
  private readonly error = $('start-error');

  onStart(handler: () => Promise<void>) {
    this.button.addEventListener('click', async () => {
      this.button.disabled = true;
      this.setError(null);
      try {
        await handler();
        this.hide();
      } catch (err) {
        this.setError(describeError(err));
      } finally {
        this.button.disabled = false;
      }
    });
  }

  show(message: string | null = null) {
    this.root.classList.remove('hidden');
    this.setError(message);
    this.button.focus();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  private setError(message: string | null) {
    this.error.hidden = !message;
    this.error.textContent = message ?? '';
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Sharing was cancelled. Click the button again and choose a screen with "Also share system audio" turned on.';
    if (err.name === 'NotSupportedError') return 'This browser cannot capture system audio. Use Google Chrome 141+ on macOS 14.2+.';
  }
  return err instanceof Error ? err.message : String(err);
}

export class Hud {
  private readonly root = $('hud');
  private readonly name = $('hud-name');
  private readonly auto = $('hud-auto');
  private readonly fps = $('hud-fps');
  private readonly bars = Array.from($('hud-meter').children) as HTMLElement[];
  private readonly toast = $('toast');
  private toastTimer = 0;
  private idleTimer = 0;
  /** User toggle via the H key. */
  enabled = true;

  constructor() {
    window.addEventListener('mousemove', () => this.wake());
  }

  show() {
    this.root.hidden = false;
    this.wake();
  }

  toggle() {
    this.enabled = !this.enabled;
    this.root.style.visibility = this.enabled ? '' : 'hidden';
    if (!this.enabled) this.toast.classList.remove('show');
  }

  wake() {
    this.root.classList.remove('idle');
    document.body.classList.remove('hide-cursor');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.root.classList.add('idle');
      document.body.classList.add('hide-cursor');
    }, 3000);
  }

  setVisual(index: number, total: number, name: string, announce = true) {
    this.name.textContent = `${index + 1} / ${total} · ${name}`;
    if (!announce || !this.enabled) return;
    this.toast.textContent = name;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 3000);
  }

  setAuto(auto: boolean) {
    this.auto.textContent = auto ? 'auto' : 'paused';
    this.auto.classList.toggle('paused', !auto);
  }

  update(audio: AudioFeatures, fps: number | null) {
    const vals = [audio.bass, audio.mid, audio.treble];
    this.bars.forEach((b, i) => (b.style.transform = `scaleY(${vals[i].toFixed(2)})`));
    this.fps.textContent = fps === null ? '' : `${fps.toFixed(0)} fps`;
  }
}
