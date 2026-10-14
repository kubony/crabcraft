// App shell: owns the engine, input, audio and UI root, and switches between screens.
import { Engine, type QualitySetting } from './core/engine';
import { Input } from './core/input';
import { AudioManager } from './core/audio';
import { initAssets } from './core/assets';
import type { CrabSpec } from './crab/types';
import { h, sleep } from './ui/dom';

export type ScreenId = 'title' | 'create' | 'game' | 'ending' | 'robot' | 'credits';

export interface Screen {
  enter(app: App, params?: unknown): Promise<void> | void;
  exit(): void;
}

const loaders: Record<ScreenId, () => Promise<{ default: new () => Screen }>> = {
  title: () => import('./screens/title'),
  create: () => import('./screens/create'),
  game: () => import('./screens/game'),
  ending: () => import('./screens/ending'),
  robot: () => import('./screens/robot'),
  credits: () => import('./screens/credits'),
};

export class App {
  readonly engine: Engine;
  readonly input: Input;
  readonly audio: AudioManager;
  /** Screen-owned DOM goes here; cleared on every screen change. */
  readonly ui: HTMLElement;
  /** Persistent overlays (blackout, tooltips) live here. */
  readonly overlay: HTMLElement;
  private blackoutEl: HTMLElement;
  private current: Screen | null = null;
  currentId: ScreenId | null = null;
  /** The player's crab, set by character creation. */
  spec: CrabSpec | null = null;

  constructor(root: HTMLElement) {
    // 'auto' (the default) is the high tier with dynamic resolution; the player can pin a tier.
    const q = localStorageGet('cc.quality');
    const quality: QualitySetting = q === 'low' || q === 'high' || q === 'auto' ? q : 'auto';
    this.engine = new Engine(root, quality);
    initAssets(this.engine.renderer);
    this.ui = h('div', { class: 'cc-layer', id: 'cc-ui' });
    this.overlay = h('div', { class: 'cc-layer cc-passive', id: 'cc-overlay' });
    this.blackoutEl = h('div', { class: 'cc-blackout on' });
    this.overlay.append(this.blackoutEl);
    root.append(this.ui, this.overlay);
    this.input = new Input(this.engine.canvas);
    this.audio = new AudioManager();
    this.engine.onAfterFrame(() => this.input.endFrame());
    this.engine.start();
    const saved = localStorageGet('cc.spec');
    if (saved) {
      try {
        this.spec = JSON.parse(saved) as CrabSpec;
      } catch {
        /* ignore */
      }
    }
  }

  /** Fade to black, swap screens, fade back in. */
  async go(id: ScreenId, params?: unknown): Promise<void> {
    await this.blackout(true);
    this.current?.exit();
    this.current = null;
    this.ui.replaceChildren();
    const mod = await loaders[id]();
    const screen = new mod.default();
    this.current = screen;
    this.currentId = id;
    await screen.enter(this, params);
    await this.blackout(false);
  }

  async blackout(on: boolean, ms = 600): Promise<void> {
    this.blackoutEl.style.transitionDuration = `${ms}ms`;
    this.blackoutEl.classList.toggle('on', on);
    await sleep(ms);
  }

  saveSpec(spec: CrabSpec): void {
    this.spec = spec;
    localStorageSet('cc.spec', JSON.stringify(spec));
  }
}

export function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function localStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
