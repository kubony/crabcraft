// Esc game menu: Resume, Settings (music and effects volume, graphics quality, chat bubbles),
// Controls, Robot Mode, Return to Title.
import { h } from '../dom';
import { localStorageSet } from '../../app';
import type { Game } from '../../game/game';
import type { QualitySetting } from '../../core/engine';

const CONTROLS: [string, string][] = [
  ['W / S', 'Walk forward / back'],
  ['A / D', 'Scuttle left / right (crabs walk sideways)'],
  ['Q / E', 'Turn'],
  ['Right mouse drag', 'Look and steer'],
  ['Left mouse drag', 'Look around'],
  ['Both mouse buttons', 'Walk forward'],
  ['Mouse wheel', 'Zoom'],
  ['Space', 'Jump'],
  ['Tab / Click', 'Target an enemy'],
  ['1 2 3 4', 'Abilities'],
  ['F', 'Talk, continue a conversation, hold at the beacon'],
  ['L', 'Quest log'],
  ['M', 'Music on / off'],
  ['Enter', 'Chat bubbles on / off'],
  ['R', 'Robot Mode'],
  ['Esc', 'Clear target, close windows, menu'],
];

export class GameMenu {
  readonly el: HTMLElement;
  private panel: HTMLElement;
  /** Under the quality buttons: what 'auto' is rendering at right now. */
  private resNote = h('div', { class: 'res-note' });
  open = false;

  constructor(private readonly game: Game) {
    this.panel = h('div', { class: 'menu cc-panel hud-i' });
    this.el = h('div', { class: 'hidden', style: 'position:absolute;inset:0;pointer-events:auto' }, h('div', { class: 'menu-back', onclick: () => this.close() }), this.panel);
  }

  private btn(label: string, fn: () => void, ghost = false): HTMLElement {
    const b = h('button', { class: `cc-btn${ghost ? ' ghost' : ''}` }, label);
    b.addEventListener('click', () => {
      this.game.audio.sfx('sfx-click', { volume: 0.6 });
      fn();
    });
    b.addEventListener('mouseenter', () => this.game.audio.sfx('sfx-hover', { volume: 0.3 }));
    return b;
  }

  show(): void {
    this.open = true;
    this.el.classList.remove('hidden');
    this.main();
  }

  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  main(): void {
    const g = this.game;
    this.panel.className = 'menu cc-panel hud-i';
    this.panel.replaceChildren(
      h('h2', { class: 'cc-title' }, 'Game Menu'),
      this.btn('Resume', () => this.close()),
      this.btn('Settings', () => this.settings(), true),
      this.btn('Controls', () => this.controls(), true),
      this.btn('Robot Mode', () => void g.app.go('robot'), true),
      this.btn('Return to Title', () => void g.app.go('title'), true),
    );
  }

  settings(): void {
    const g = this.game;
    const audio = g.audio;
    const slider = (value: number, onInput: (v: number) => void) => {
      const s = h('input', { type: 'range', min: 0, max: 100, value: Math.round(value * 100) }) as HTMLInputElement;
      s.addEventListener('input', () => onInput(Number(s.value) / 100));
      return s;
    };
    const seg = (options: [string, string][], current: string, onPick: (v: string) => void) => {
      const wrap = h('div', { class: 'seg' });
      for (const [v, label] of options) {
        const b = h('button', { class: `cc-btn small ghost${v === current ? ' on' : ''}` }, label);
        b.addEventListener('click', () => {
          onPick(v);
          wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        });
        wrap.append(b);
      }
      return wrap;
    };
    this.panel.className = 'menu wide cc-panel hud-i';
    this.panel.replaceChildren(
      h('h2', { class: 'cc-title' }, 'Settings'),
      h('div', { class: 'row' }, 'Music volume', slider(audio.musicVolume, (v) => {
        audio.setMusicVolume(v);
        g.musicOn = v > 0;
        localStorageSet('cc.musicVol', String(v));
      })),
      h('div', { class: 'row' }, 'Effects volume', slider(audio.sfxVolume, (v) => {
        audio.setSfxVolume(v);
        localStorageSet('cc.sfxVol', String(v));
        audio.sfx('sfx-click', { volume: 0.6 });
      })),
      h('div', { class: 'row' }, 'Graphics quality', seg([['auto', 'Auto'], ['high', 'High'], ['low', 'Low']], g.engine.setting, (q) => {
        g.setQuality(q as QualitySetting);
        this.updateResNote();
      })),
      this.resNote,
      h('div', { class: 'row' }, 'Chat bubbles', seg([['on', 'On'], ['off', 'Off']], g.hud.bubbles.enabled ? 'on' : 'off', (v) => {
        g.hud.bubbles.enabled = v === 'on';
      })),
      this.btn('Back', () => this.main()),
    );
    this.updateResNote();
  }

  /** Called by the game when dynamic resolution moves, and when the settings page opens. */
  updateResNote(): void {
    const e = this.game.engine;
    const pct = Math.round(e.resolutionFraction * 100);
    this.resNote.textContent =
      e.setting === 'auto'
        ? `Auto keeps the frame rate smooth by adjusting resolution. Rendering at ${pct}% now.`
        : e.setting === 'high'
          ? `Full resolution${pct < 100 ? ` (capped at ${pct}% of this screen)` : ''}, every effect on.`
          : 'Fewer plants and particles, standard resolution. For older laptops.';
  }

  controls(): void {
    const table = h('table');
    for (const [k, what] of CONTROLS) {
      const keys = h('td');
      for (const part of k.split(' / ')) keys.append(h('kbd', null, part));
      table.append(h('tr', null, keys, h('td', null, what)));
    }
    this.panel.className = 'menu wide cc-panel hud-i';
    this.panel.replaceChildren(h('h2', { class: 'cc-title' }, 'Controls'), table, this.btn('Back', () => this.main()));
  }
}
