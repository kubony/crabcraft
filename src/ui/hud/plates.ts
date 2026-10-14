// World-anchored DOM: nameplates (names, titles, quest markers, health), floating combat text and
// chat bubbles. Elements are pooled and moved with transforms only.
import * as THREE from 'three';
import { h } from '../dom';
import type { Game } from '../../game/game';
import type { Unit } from '../../game/unit';

const v = new THREE.Vector3();

interface Plate {
  el: HTMLElement;
  name: HTMLElement;
  title: HTMLElement;
  qm: HTMLElement;
  hp: HTMLElement;
  hpFill: HTMLElement;
  key: string;
  hpLast: number;
  visible: boolean;
}

export type QuestMark = '!' | '?' | '?ready' | null;

function project(cam: THREE.Camera, p: THREE.Vector3): { x: number; y: number } | null {
  v.copy(p).project(cam);
  if (v.z > 1 || v.z < -1) return null;
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}

export class Nameplates {
  readonly el: HTMLElement;
  private plates = new Map<number, Plate>();

  constructor() {
    this.el = h('div', { class: 'plates' });
  }

  private make(): Plate {
    const name = h('div', { class: 'name' });
    const title = h('div', { class: 'title' });
    const qm = h('div', { class: 'qm' });
    const hpFill = h('i');
    const hp = h('div', { class: 'hpbar' }, hpFill);
    const el = h('div', { class: 'plate' }, h('div', { class: 'inner' }, qm, name, title, hp));
    this.el.append(el);
    return { el, name, title, qm, hp, hpFill, key: '', hpLast: -1, visible: true };
  }

  update(g: Game): void {
    const cam = g.camera;
    const target = g.player.target;
    const seen = new Set<number>();
    for (const u of g.units) {
      if (u.kind === 'player' || u.hidden || u.culled) continue;
      if (!u.alive && u !== target) continue;
      if (u.kind === 'boss' && g.hud.bossFrame.visible) continue;
      const d = cam.position.distanceTo(u.pos);
      const mark = g.questMark(u);
      const range = u.hostile ? 40 : u.kind === 'npc' ? (mark ? 90 : 45) : u.kind === 'townsfolk' ? 18 : 30;
      if (d > range && u !== target) continue;
      if (g.cinematic) continue;
      const scr = project(cam, u.nameplatePos(v));
      if (!scr) continue;
      seen.add(u.id);
      let p = this.plates.get(u.id);
      if (!p) {
        p = this.make();
        this.plates.set(u.id, p);
      }
      const showHp = u.hostile && u.alive && (u === target || u.hp < u.maxHp || g.time - u.lastCombat < 6);
      const key = `${u.name}|${u.title}|${mark}|${u.reaction}|${u.alive}|${u === target}|${showHp}|${u.level}`;
      if (key !== p.key) {
        p.key = key;
        p.name.className = `name ${u.reaction}`;
        p.name.replaceChildren();
        if (u.hostile) p.name.append(h('span', { class: 'lvl' }, u.kind === 'boss' ? '??' : String(u.level)));
        p.name.append(u.name);
        p.title.textContent = u.title && !u.hostile ? `<${u.title}>` : '';
        p.title.style.display = p.title.textContent ? '' : 'none';
        p.qm.style.display = mark ? '' : 'none';
        p.qm.textContent = mark === '!' ? '!' : '?';
        p.qm.className = `qm${mark === '?' ? ' grey' : mark === '?ready' ? ' ready' : ''}`;
        p.hp.style.display = showHp ? '' : 'none';
        p.el.classList.toggle('targeted', u === target);
        p.el.classList.toggle('dead', !u.alive);
      }
      if (showHp) {
        const f = Math.max(0, u.hp / u.maxHp);
        if (Math.abs(f - p.hpLast) > 0.002) {
          p.hpLast = f;
          p.hpFill.style.transform = `scaleX(${f})`;
        }
      }
      const s = u === target ? 1 : Math.max(0.68, Math.min(1, 1.12 - d / 55));
      const fade = u === target ? 1 : Math.min(1, (range - d) / 6);
      p.el.style.transform = `translate3d(${scr.x.toFixed(1)}px, ${scr.y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
      p.el.style.opacity = fade.toFixed(2);
      p.el.style.zIndex = String(1000 - Math.round(d));
      if (!p.visible) {
        p.visible = true;
        p.el.style.display = '';
      }
    }
    for (const [id, p] of this.plates) {
      if (!seen.has(id) && p.visible) {
        p.visible = false;
        p.el.style.display = 'none';
      }
    }
  }

  clear(): void {
    this.plates.clear();
    this.el.replaceChildren();
  }
}

export type FloatKind = 'dmg' | 'crit' | 'heal' | 'taken' | 'xp' | 'info';

interface Float {
  el: HTMLElement;
  span: HTMLElement;
  unit: Unit | null;
  anchor: THREE.Vector3;
  t: number;
  dur: number;
  kind: FloatKind;
  jitter: number;
  active: boolean;
  lane: number;
}

export class FloatingText {
  readonly el: HTMLElement;
  private pool: Float[] = [];
  private lane = 0;

  constructor() {
    this.el = h('div', { class: 'plates' });
  }

  spawn(unit: Unit, text: string, kind: FloatKind): void {
    let f = this.pool.find((x) => !x.active);
    if (!f) {
      if (this.pool.length >= 48) {
        f = this.pool.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
      } else {
        const span = h('span');
        const el = h('div', { class: 'float' }, span);
        this.el.append(el);
        f = { el, span, unit: null, anchor: new THREE.Vector3(), t: 0, dur: 1, kind, jitter: 0, active: false, lane: 0 };
        this.pool.push(f);
      }
    }
    f.unit = unit;
    unit.nameplatePos(f.anchor);
    f.t = 0;
    f.kind = kind;
    f.dur = kind === 'crit' ? 1.5 : kind === 'info' || kind === 'xp' ? 1.8 : 1.15;
    this.lane = (this.lane + 1) % 5;
    f.lane = this.lane;
    f.jitter = (this.lane - 2) * 22 + (Math.random() - 0.5) * 14;
    f.active = true;
    f.el.className = `float ${kind}`;
    f.span.textContent = text;
    f.el.style.display = '';
  }

  update(g: Game, dt: number): void {
    const cam = g.camera;
    for (const f of this.pool) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      if (f.unit && !f.unit.hidden) f.unit.nameplatePos(f.anchor);
      const scr = project(cam, f.anchor);
      if (!scr) {
        f.el.style.opacity = '0';
        continue;
      }
      const k = f.t / f.dur;
      const isPlayer = f.unit?.kind === 'player';
      const rise = (f.kind === 'info' || f.kind === 'xp' ? 50 : 70) * k + (isPlayer ? -10 : 0);
      let scale = 1;
      if (f.kind === 'crit') scale = f.t < 0.12 ? 1 + (1 - f.t / 0.12) * 1.1 : 1;
      else if (f.t < 0.08) scale = 1 + (1 - f.t / 0.08) * 0.5;
      const x = scr.x + f.jitter * (f.kind === 'info' ? 0.3 : 1) + (isPlayer ? 60 : 0);
      const y = scr.y - 18 - rise;
      f.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      f.el.style.opacity = (k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35).toFixed(2);
    }
  }
}

interface Bubble {
  el: HTMLElement;
  inner: HTMLElement;
  unit: Unit;
  until: number;
  /** Measured height in px (0 = measure on the next update). */
  h: number;
}

export class Bubbles {
  readonly el: HTMLElement;
  private list: Bubble[] = [];
  enabled = true;

  constructor() {
    this.el = h('div', { class: 'plates' });
  }

  say(g: Game, unit: Unit, text: string, yell = false): void {
    if (!this.enabled) return;
    let b = this.list.find((x) => x.unit === unit);
    if (!b) {
      const inner = h('div');
      const el = h('div', { class: 'bubble' }, inner);
      this.el.append(el);
      b = { el, inner, unit, until: 0, h: 0 };
      this.list.push(b);
    }
    b.inner.textContent = text;
    b.h = 0;
    b.inner.style.animation = 'none';
    void b.inner.offsetWidth;
    b.inner.style.animation = '';
    b.el.className = `bubble${yell ? ' yell' : ''}`;
    b.until = g.time + Math.min(7, 2.5 + text.length * 0.055);
    b.el.style.display = '';
  }

  clear(): void {
    for (const b of this.list) b.el.remove();
    this.list = [];
  }

  /** `topLimit`: no bubble rises above this screen y (the boss frame, the top of the screen). */
  update(g: Game, topLimit = 96): void {
    const cam = g.camera;
    // Measure new bubbles first (reads), then place every bubble (writes).
    for (const b of this.list) if (!b.h && b.el.style.display !== 'none') b.h = b.inner.offsetHeight;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (g.time > b.until || b.unit.hidden || !this.enabled) {
        b.el.remove();
        this.list.splice(i, 1);
        continue;
      }
      const scr = project(cam, b.unit.nameplatePos(v));
      const far = cam.position.distanceTo(b.unit.pos) > 60;
      if (!scr || far) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      const lift = b.unit.kind === 'npc' ? 58 : 34;
      // A giant (Corrodius) has his head above the frame: keep his yells on screen, under the HUD.
      const y = Math.max(scr.y - lift, topLimit + (b.h || 48) + 10);
      b.el.style.transform = `translate3d(${scr.x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
