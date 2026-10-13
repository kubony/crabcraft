// Action bar (4 ability slots with cooldown sweeps, resource and range tints, tooltips), the XP
// bar, micro menu, cast bar and the contextual interaction prompt.
import { h } from '../dom';
import type { Game } from '../../game/game';
import type { AbilityDef } from '../../data/classes';
import { GCD, LEVEL_XP, MAX_LEVEL } from '../../game/player';
import { abilityNeedsTarget, isMeleeAbility } from '../../game/abilities';
import { iconEl, iconSvg } from './icons';

interface Slot {
  ab: AbilityDef;
  el: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  state: string;
  wasCooling: boolean;
}

export class ActionBar {
  readonly el: HTMLElement;
  private slots: Slot[] = [];
  private xpFill: HTMLElement;
  private xpLabel: HTMLElement;
  private tooltip: HTMLElement | null = null;
  private musicBtn: HTMLButtonElement;
  private lastXp = '';

  constructor(private readonly game: Game, onLog: () => void, onMenu: () => void, onMusic: () => void) {
    const cls = game.player.cls;
    const slotsEl = h('div', { class: 'ab-slots hud-plate' });
    for (const ab of cls.abilities) {
      const cd = h('div', { class: 'ab-cd' });
      const cdText = h('div', { class: 'ab-cdtext' });
      const el = h(
        'div',
        { class: `ab-slot hud-i ${cls.resource}` },
        iconEl(ab.id, ab.icon),
        cd,
        cdText,
        h('div', { class: 'ab-key' }, String(ab.slot)),
        ab.cost ? h('div', { class: 'ab-cost' }, String(ab.cost)) : null,
      );
      el.addEventListener('click', () => game.player.useAbility(ab.slot));
      el.addEventListener('mouseenter', () => this.showTip(ab, el));
      el.addEventListener('mouseleave', () => this.hideTip());
      slotsEl.append(el);
      this.slots.push({ ab, el, cd, cdText, state: '', wasCooling: false });
    }
    const micro = (icon: string, title: string, fn: () => void) => {
      const b = h('button', { class: 'hud-i', title }) as HTMLButtonElement;
      b.innerHTML = iconSvg(icon);
      b.addEventListener('click', () => {
        game.audio.sfx('sfx-click', { volume: 0.5 });
        fn();
      });
      return b;
    };
    this.musicBtn = micro('music', 'Music (M)', onMusic);
    const microEl = h('div', { class: 'ab-micro hud-plate' }, micro('log', 'Quest Log (L)', onLog), this.musicBtn, micro('menu', 'Game Menu (Esc)', onMenu));
    this.xpFill = h('div', { class: 'fill' });
    this.xpLabel = h('div', { class: 'ab-xp-label' });
    this.el = h(
      'div',
      { class: 'ab' },
      h('div', { class: 'ab-row' }, slotsEl, microEl),
      h('div', { class: 'ab-xp hud-i', title: 'Experience' }, this.xpFill, h('div', { class: 'ticks' })),
      this.xpLabel,
    );
  }

  setMusicIcon(on: boolean): void {
    this.musicBtn.innerHTML = iconSvg(on ? 'music' : 'music-off');
  }

  press(slot: number): void {
    const s = this.slots[slot - 1];
    if (!s) return;
    s.el.classList.add('pressed');
    setTimeout(() => s.el.classList.remove('pressed'), 110);
  }

  private showTip(ab: AbilityDef, anchor: HTMLElement): void {
    this.hideTip();
    const cls = this.game.player.cls;
    const meta: string[] = [];
    if (ab.cost) meta.push(`${ab.cost} ${cls.resource === 'rage' ? 'Rage' : 'Mana'}`);
    meta.push(ab.castTime > 0 ? `${ab.castTime} sec cast` : 'Instant');
    if (ab.cooldown > 0) meta.push(`${ab.cooldown} sec cooldown`);
    const range = isMeleeAbility(ab) ? 'Melee range' : abilityNeedsTarget(ab) ? `${ab.range} m range` : ab.range > 0 ? `${ab.range} m radius` : 'Self';
    const tip = h(
      'div',
      { class: 'cc-tooltip' },
      h('div', { class: 't-title' }, ab.name),
      h('div', { class: 't-meta' }, meta.join('  |  ')),
      h('div', { class: 't-meta' }, range),
      h('div', { class: 't-desc' }, ab.description),
    );
    document.body.append(tip);
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tr.width - 8, Math.max(8, r.left + r.width / 2 - tr.width / 2))}px`;
    tip.style.top = `${r.top - tr.height - 14}px`;
    this.tooltip = tip;
  }

  hideTip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
  }

  update(): void {
    const g = this.game;
    const p = g.player;
    const now = g.time;
    const gcdLeft = Math.max(0, p.gcdEnd - now);
    for (const s of this.slots) {
      const cdLeft = p.cooldownLeft(s.ab);
      let frac = 0;
      let text = '';
      let gcd = false;
      if (cdLeft > gcdLeft && cdLeft > 0) {
        frac = cdLeft / s.ab.cooldown;
        text = cdLeft > 1 ? String(Math.ceil(cdLeft)) : cdLeft.toFixed(1);
      } else if (gcdLeft > 0) {
        frac = gcdLeft / GCD;
        gcd = true;
      }
      const cooling = frac > 0;
      if (s.wasCooling && !cooling && s.ab.cooldown > 0 && !gcd) {
        s.el.classList.remove('ready-flash');
        void s.el.offsetWidth;
        s.el.classList.add('ready-flash');
      }
      s.wasCooling = cooling && !gcd;
      s.cd.style.setProperty('--cd', frac.toFixed(3));
      s.cd.classList.toggle('gcd', gcd);
      if (s.cdText.textContent !== text) s.cdText.textContent = text;
      const nores = p.resource < s.ab.cost;
      let oor = false;
      const t = p.target;
      if (abilityNeedsTarget(s.ab) && t && t.alive && t.hostile) {
        oor = isMeleeAbility(s.ab) ? p.unit.gapTo(t) > 1.8 : p.unit.distTo(t) - t.radius > s.ab.range;
      }
      const state = `${nores ? 'n' : ''}${oor ? 'o' : ''}`;
      if (state !== s.state) {
        s.state = state;
        s.el.classList.toggle('nores', nores);
        s.el.classList.toggle('oor', oor);
      }
    }
    const lvl = p.unit.level;
    let xpText: string;
    let frac: number;
    if (lvl >= MAX_LEVEL) {
      xpText = `Level ${lvl}  |  Max level`;
      frac = 1;
    } else {
      const lo = LEVEL_XP[lvl - 1];
      const hi = LEVEL_XP[lvl];
      frac = (p.xp - lo) / (hi - lo);
      xpText = `Level ${lvl}  |  ${p.xp - lo} / ${hi - lo} XP`;
    }
    if (xpText !== this.lastXp) {
      this.lastXp = xpText;
      this.xpLabel.textContent = xpText;
      this.xpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    }
  }
}

export class CastBar {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;
  private time: HTMLElement;
  private spark: HTMLElement;
  private t0 = 0;
  private dur = 0;
  private channel = false;
  private active = false;
  private hideAt = 0;

  constructor(private readonly game: Game) {
    this.fill = h('div', { class: 'fill' });
    this.label = h('div', { class: 'label' });
    this.time = h('div', { class: 'time' });
    this.spark = h('div', { class: 'spark' });
    this.el = h('div', { class: 'castbar' }, h('div', { class: 'cc-bar cast' }, this.fill, this.label, this.time, this.spark));
  }

  start(name: string, seconds: number, channel = false): void {
    this.t0 = this.game.time;
    this.dur = seconds;
    this.channel = channel;
    this.active = true;
    this.label.textContent = name;
    this.el.className = `castbar on${channel ? ' channel' : ''}`;
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.fill.style.transform = 'scaleX(1)';
    this.el.className = `castbar on done${this.channel ? ' channel' : ''}`;
    this.hideAt = this.game.time + 0.35;
  }

  fail(reason: string): void {
    this.active = false;
    this.label.textContent = reason;
    this.el.className = 'castbar on fail';
    this.hideAt = this.game.time + 0.8;
  }

  update(): void {
    const now = this.game.time;
    if (this.active) {
      const k = Math.min(1, (now - this.t0) / this.dur);
      this.fill.style.transform = `scaleX(${k})`;
      this.spark.style.left = `${k * 100}%`;
      const left = Math.max(0, this.dur - (now - this.t0));
      this.time.textContent = left.toFixed(1);
    } else if (this.hideAt && now > this.hideAt) {
      this.hideAt = 0;
      this.el.classList.remove('on');
      this.time.textContent = '';
    }
  }
}

export class Prompt {
  readonly el: HTMLElement;
  private text = '';

  constructor() {
    this.el = h('div', { class: 'prompt' });
  }

  show(key: string, text: string): void {
    const t = `${key}|${text}`;
    if (t === this.text) return;
    this.text = t;
    this.el.replaceChildren(h('kbd', null, key), text);
    this.el.classList.add('on');
  }

  hide(): void {
    if (!this.text) return;
    this.text = '';
    this.el.classList.remove('on');
  }
}
