// Player and target unit frames (portrait ring, level badge, health and resource bars, auras)
// and the boss frame at the top of the screen.
import { h, art } from '../dom';
import type { Game } from '../../game/game';
import type { Unit } from '../../game/unit';
import { iconSvg } from './icons';

export interface Bar {
  el: HTMLElement;
  fill: HTMLElement;
  lag?: HTMLElement;
  absorb?: HTMLElement;
  label: HTMLElement;
  last: number;
  lastLabel: string;
}

export function makeBar(cls: string, withLag = true): Bar {
  const fill = h('div', { class: 'fill' });
  const lag = withLag ? h('div', { class: 'lag' }) : undefined;
  const label = h('div', { class: 'label' });
  const el = h('div', { class: `cc-bar ${cls}` }, lag ?? null, fill, label);
  return { el, fill, lag, label, last: -1, lastLabel: '' };
}

export function setBar(b: Bar, frac: number, label: string): void {
  const f = Math.max(0, Math.min(1, frac));
  if (Math.abs(f - b.last) > 0.001) {
    b.fill.style.transform = `scaleX(${f})`;
    if (b.lag) b.lag.style.transform = `scaleX(${f})`;
    b.last = f;
  }
  if (label !== b.lastLabel) {
    b.label.textContent = label;
    b.lastLabel = label;
  }
}

/** Painted portrait over the 3D snapshot fallback. */
export function portraitStyle(artPath: string | null, snapshot: string): string {
  const layers: string[] = [];
  const sizes: string[] = [];
  if (artPath) {
    layers.push(`url("${art(artPath)}")`);
    sizes.push('cover');
  }
  if (snapshot) {
    layers.push(`url("${snapshot}")`);
    sizes.push('112%');
  }
  return layers.length ? `background-image:${layers.join(',')};background-size:${sizes.join(',')}` : '';
}

interface AuraInfo {
  id: string;
  name: string;
  debuff: boolean;
  left: number;
  stacks?: number;
}

function auras(g: Game, u: Unit): AuraInfo[] {
  const now = g.time;
  const out: AuraInfo[] = [];
  if (u.absorb > 0 && now < u.absorbUntil) out.push({ id: 'ward', name: 'Barnacle Ward', debuff: false, left: u.absorbUntil - now });
  if (now < u.blessingUntil) out.push({ id: 'blessing', name: 'Moonwater Blessing', debuff: false, left: Infinity });
  if (now < u.stunUntil) out.push({ id: 'stun', name: 'Stunned', debuff: true, left: u.stunUntil - now });
  if (now < u.slowUntil) out.push({ id: 'slow', name: 'Frost Spray', debuff: true, left: u.slowUntil - now });
  if (now < u.rustUntil && u.rust > 0) out.push({ id: 'rust', name: 'Rust', debuff: true, left: u.rustUntil - now, stacks: u.rust });
  return out;
}

export class UnitFrame {
  readonly el: HTMLElement;
  private pic: HTMLElement;
  private levelEl: HTMLElement;
  private nameEl: HTMLElement;
  private tagEl: HTMLElement;
  private hp: Bar;
  private res: Bar;
  private aurasEl: HTMLElement;
  private auraKey = '';
  private auraTimes: HTMLElement[] = [];
  unit: Unit | null = null;
  private lowHp = false;

  constructor(private readonly kind: 'player' | 'target') {
    this.pic = h('div', { class: 'uf-pic' });
    this.levelEl = h('div', { class: 'uf-level' }, '1');
    this.nameEl = h('span', null, '');
    this.tagEl = h('span', { class: 'tag' }, '');
    this.hp = makeBar('hp');
    this.hp.absorb = h('div', { class: 'absorb' });
    this.hp.absorb.style.transform = 'scaleX(0)';
    this.hp.el.insertBefore(this.hp.absorb, this.hp.label);
    this.res = makeBar('res', false);
    this.aurasEl = h('div', { class: 'uf-auras' });
    this.el = h(
      'div',
      { class: `uf uf-${kind}${kind === 'target' ? ' empty' : ''}` },
      h('div', { class: 'uf-portrait' }, this.pic, h('div', { class: 'uf-combat' }), this.levelEl),
      h('div', { class: 'uf-body hud-plate' }, h('div', { class: 'uf-name' }, this.nameEl, this.tagEl), this.hp.el, this.res.el),
      this.aurasEl,
    );
  }

  setUnit(u: Unit | null, portraitArt: string | null = null): void {
    this.unit = u;
    this.el.classList.toggle('empty', !u);
    if (!u) return;
    this.pic.setAttribute('style', portraitStyle(portraitArt, u.portrait));
    this.nameEl.textContent = u.name;
    const nameRow = this.nameEl.parentElement!;
    nameRow.classList.toggle('hostile', u.hostile);
    nameRow.classList.toggle('friendly', u.reaction === 'friendly');
    nameRow.classList.toggle('long', u.name.length > 20);
    this.tagEl.textContent = u.kind === 'boss' ? 'Boss' : '';
    this.levelEl.classList.toggle('skull', u.kind === 'boss');
    this.levelEl.textContent = u.kind === 'boss' ? '??' : String(u.level);
    this.res.el.style.display = this.kind === 'player' ? '' : 'none';
    this.hp.last = -1;
    this.auraKey = '';
  }

  update(g: Game): void {
    const u = this.unit;
    if (!u) return;
    if (this.kind === 'target' && u.kind !== 'boss') this.levelEl.textContent = String(u.level);
    if (this.kind === 'player') this.levelEl.textContent = String(u.level);
    const frac = u.hp / u.maxHp;
    const pct = Math.round(frac * 100);
    setBar(this.hp, frac, this.kind === 'player' ? `${Math.ceil(u.hp)} / ${u.maxHp}` : u.alive ? `${Math.ceil(u.hp)} / ${u.maxHp}  (${pct}%)` : 'Dead');
    if (this.hp.absorb) {
      const a = u.absorb > 0 && g.time < u.absorbUntil ? Math.min(1, u.absorb / u.maxHp) : 0;
      this.hp.absorb.style.transform = `translateX(${Math.min(1, frac) * 100}%) scaleX(${a})`;
    }
    const low = u.alive && frac < 0.3;
    if (low !== this.lowHp) {
      this.lowHp = low;
      this.hp.el.classList.toggle('low', low);
    }
    if (this.kind === 'player') {
      const p = g.player;
      this.res.el.className = `cc-bar res ${p.isRage ? 'rage' : 'mana'}`;
      setBar(this.res, p.resource / p.maxResource, `${Math.floor(p.resource)} / ${p.maxResource}`);
      this.el.classList.toggle('in-combat', p.inCombat && u.alive);
    } else {
      this.el.classList.toggle('in-combat', u.alive && u.hostile && g.time - u.lastCombat < 4);
    }
    this.updateAuras(g, u);
  }

  private updateAuras(g: Game, u: Unit): void {
    const list = auras(g, u);
    const key = list.map((a) => `${a.id}${a.stacks ?? ''}`).join(',');
    if (key !== this.auraKey) {
      this.auraKey = key;
      this.aurasEl.replaceChildren();
      this.auraTimes = [];
      for (const a of list) {
        const t = h('div', { class: 'time' });
        const el = h('div', { class: `aura${a.debuff ? ' debuff' : ''}`, title: a.name });
        el.innerHTML = iconSvg(a.id);
        if (a.stacks && a.stacks > 1) el.append(h('div', { class: 'stack' }, String(a.stacks)));
        el.append(t);
        this.aurasEl.append(el);
        this.auraTimes.push(t);
      }
    }
    list.forEach((a, i) => {
      const t = this.auraTimes[i];
      const s = Number.isFinite(a.left) ? `${Math.ceil(a.left)}s` : '';
      if (t && t.textContent !== s) t.textContent = s;
    });
  }
}

export class BossFrame {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private lag: HTMLElement;
  private label: HTMLElement;
  private phase: HTMLElement;
  private unit: Unit | null = null;
  private last = -1;

  constructor() {
    this.fill = h('div', { class: 'fill' });
    this.lag = h('div', { class: 'lag' });
    this.label = h('div', { class: 'label' }, '100%');
    this.phase = h('div', { class: 'bf-phase' }, 'Phase 1');
    this.el = h(
      'div',
      { class: 'bf' },
      h('div', { class: 'bf-name cc-title' }, 'Corrodius, the Rust Tyrant'),
      h('div', { class: 'bf-sub' }, 'Lord of the Iron Wreck'),
      h('div', { class: 'bf-bar' }, this.lag, this.fill, h('div', { class: 'mark', style: 'left:60%' }), h('div', { class: 'mark', style: 'left:25%' }), this.label),
      this.phase,
    );
  }

  show(u: Unit): void {
    this.unit = u;
    this.last = -1;
    this.el.classList.add('on');
  }

  hide(): void {
    this.unit = null;
    this.el.classList.remove('on', 'enraged');
  }

  get visible(): boolean {
    return !!this.unit;
  }

  update(g: Game): void {
    const u = this.unit;
    if (!u) return;
    const f = Math.max(0, u.hp / u.maxHp);
    if (Math.abs(f - this.last) > 0.0005) {
      this.last = f;
      this.fill.style.transform = `scaleX(${f})`;
      this.lag.style.transform = `scaleX(${f})`;
      this.label.textContent = u.alive ? `${Math.ceil(f * 100)}%` : 'Defeated';
    }
    const phase = g.boss.phase;
    const txt = !u.alive ? 'The Rust Tide ebbs' : phase === 3 ? 'Phase 3: Enraged' : `Phase ${phase}`;
    if (this.phase.textContent !== txt) this.phase.textContent = txt;
    this.el.classList.toggle('enraged', g.boss.enraged && u.alive);
  }
}
