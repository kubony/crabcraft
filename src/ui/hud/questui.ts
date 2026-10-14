// Quest tracker (right side), quest log (L) and the NPC dialogue window with typewriter text.
import { h } from '../dom';
import type { Game } from '../../game/game';
import type { Unit } from '../../game/unit';
import { QUESTS, QUEST_ORDER, type QuestId, type QuestLog } from '../../game/quests';
import { portraitStyle } from './frames';

export class QuestTracker {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private key = '#';
  private seen = new Set<QuestId>();

  constructor(onClick: (q: QuestId) => void) {
    this.list = h('div', { class: 'qt-list' });
    this.el = h('div', { class: 'qt' }, h('div', { class: 'qt-head' }, 'Quests'), this.list);
    this.list.addEventListener('click', (e) => {
      const q = (e.target as HTMLElement).closest('[data-q]')?.getAttribute('data-q') as QuestId | null;
      if (q) onClick(q);
    });
  }

  update(log: QuestLog, flashId?: string): void {
    const active = log.active();
    const key = active.map((id) => `${id}:${log.status[id]}:${QUESTS[id].objectives.map((o) => log.value(o)).join('.')}`).join('|');
    if (key === this.key && !flashId) return;
    this.key = key;
    this.list.replaceChildren();
    this.el.style.display = active.length ? '' : 'none';
    for (const id of active) {
      const def = QUESTS[id];
      const isNew = !this.seen.has(id);
      this.seen.add(id);
      const q = h('div', { class: `qt-q hud-i${isNew ? ' new' : ''}`, 'data-q': id }, h('div', { class: 'qt-title' }, def.title));
      if (log.status[id] === 'ready') {
        q.append(h('div', { class: 'qt-ready' }, def.readyHint));
      } else {
        for (const o of def.objectives) {
          const v = log.value(o);
          const done = v >= o.count;
          const line = o.count > 1 ? `${o.label}: ${v}/${o.count}` : o.label;
          q.append(h('div', { class: `qt-obj${done ? ' done' : ''}${flashId === o.id ? ' flash' : ''}` }, done ? line : `- ${line}`));
        }
      }
      this.list.append(q);
    }
  }
}

export class QuestLogPanel {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private selected: QuestId | null = null;
  open = false;

  constructor(private readonly game: Game) {
    this.listEl = h('div', { class: 'qlog-list' });
    this.detailEl = h('div', { class: 'qlog-detail cc-scroll' });
    this.el = h(
      'div',
      { class: 'qlog cc-parchment hud-i hidden' },
      this.listEl,
      this.detailEl,
      h('button', { class: 'dlg-x', onclick: () => this.toggle(false) }, 'X'),
    );
  }

  toggle(force?: boolean, select?: QuestId): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (select) this.selected = select;
    if (this.open) this.render();
    this.game.audio.sfx('sfx-click', { volume: 0.5 });
  }

  render(): void {
    const log = this.game.quests;
    const known = QUEST_ORDER.filter((id) => log.status[id] !== 'locked' && log.status[id] !== 'available');
    if (!this.selected || !known.includes(this.selected)) this.selected = known.find((id) => log.status[id] !== 'done') ?? known[0] ?? null;
    this.listEl.replaceChildren(h('h3', null, 'Quest Log'));
    if (!known.length) this.listEl.append(h('div', { class: 'qlog-empty' }, 'No quests yet. Captain Brinebeard in the square looks like he needs help.'));
    for (const id of known) {
      const st = log.status[id];
      const label = st === 'done' ? 'Completed' : st === 'ready' ? 'Ready to turn in' : 'In progress';
      const item = h('div', { class: `qlog-item${id === this.selected ? ' sel' : ''}${st === 'done' ? ' done' : ''}` }, QUESTS[id].title, h('span', { class: 'st' }, label));
      item.addEventListener('click', () => {
        this.selected = id;
        this.render();
      });
      this.listEl.append(item);
    }
    this.detailEl.replaceChildren();
    if (!this.selected) return;
    const def = QUESTS[this.selected];
    this.detailEl.append(h('h2', null, def.title), h('p', null, def.summary), h('div', { class: 'cc-divider' }), h('div', { class: 'dlg-sec' }, 'Objectives'));
    const ul = h('ul', { class: 'dlg-obj' });
    for (const o of def.objectives) {
      const v = log.value(o);
      ul.append(h('li', null, o.count > 1 ? `${o.label}: ${v}/${o.count}` : `${o.label}${v >= o.count ? ' (done)' : ''}`));
    }
    this.detailEl.append(ul);
    if (log.status[this.selected] === 'ready') this.detailEl.append(h('p', { style: 'margin-top:10px;font-style:italic' }, def.readyHint));
    this.detailEl.append(h('div', { class: 'dlg-sec' }, 'Story'));
    for (const para of def.offer) this.detailEl.append(h('p', null, para));
    this.detailEl.append(h('div', { class: 'dlg-sec' }, 'Reward'), h('div', { class: 'dlg-reward' }, h('span', { class: 'xp' }, `${def.xp} XP`)));
  }
}

export interface DialogueButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface DialoguePage {
  unit: Unit;
  portraitArt: string | null;
  questTitle?: string;
  paragraphs: string[];
  objectives?: string[];
  rewardXp?: number;
  rewardItem?: string;
  buttons: DialogueButton[];
}

export class DialogueWindow {
  readonly el: HTMLElement;
  private pic: HTMLElement;
  private initial: HTMLElement;
  private nameEl: HTMLElement;
  private titleEl: HTMLElement;
  private body: HTMLElement;
  private textEl: HTMLElement;
  private buttonsEl: HTMLElement;
  private paras: { el: HTMLElement; text: string }[] = [];
  private shown = 0;
  private total = 0;
  private talkT = 0;
  unit: Unit | null = null;
  onClose: (() => void) | null = null;

  constructor(private readonly game: Game) {
    this.pic = h('div', { class: 'pic' });
    this.initial = h('div', { class: 'initial' });
    this.nameEl = h('div', { class: 'dlg-name' });
    this.titleEl = h('div', { class: 'dlg-title' });
    this.textEl = h('div', { class: 'dlg-text' });
    this.textEl.addEventListener('click', () => (this.shown = this.total));
    this.body = h('div', { class: 'dlg-body' });
    this.buttonsEl = h('div', { class: 'dlg-buttons' });
    this.el = h(
      'div',
      { class: 'dlg cc-parchment hud-i hidden' },
      h('div', { class: 'dlg-head' }, h('div', { class: 'dlg-portrait' }, this.initial, this.pic), h('div', null, this.nameEl, this.titleEl)),
      this.body,
      this.buttonsEl,
      h('button', { class: 'dlg-x', title: 'Close (Esc)', onclick: () => this.close() }, 'X'),
    );
  }

  get isOpen(): boolean {
    return !!this.unit;
  }

  get typing(): boolean {
    return this.shown < this.total;
  }

  /** The highlighted button (Accept, Complete Quest), or the only one (Goodbye). */
  choosePrimary(): void {
    const b = (this.buttonsEl.querySelector('.cc-btn:not(.ghost)') ?? this.buttonsEl.querySelector('.cc-btn')) as HTMLButtonElement | null;
    b?.click();
  }

  skipTyping(): void {
    this.shown = this.total;
    this.render();
  }

  open(p: DialoguePage): void {
    const u = p.unit;
    this.unit = u;
    this.el.classList.remove('hidden');
    // restart the slide-in
    this.el.style.animation = 'none';
    void this.el.offsetWidth;
    this.el.style.animation = '';
    this.initial.textContent = u.name.replace(/^(Captain|Lady|Sister|Mama|Old)\s+/, '').charAt(0);
    this.pic.className = 'pic';
    this.pic.setAttribute('style', portraitStyle(p.portraitArt, u.portrait));
    this.nameEl.textContent = u.name;
    this.titleEl.textContent = u.title ? `<${u.title}>` : '';
    this.body.replaceChildren();
    if (p.questTitle) this.body.append(h('div', { class: 'dlg-qtitle' }, p.questTitle));
    this.textEl.replaceChildren();
    this.paras = [];
    for (const t of p.paragraphs) {
      const el = h('p', { class: t.startsWith('(') ? 'em' : '' });
      this.textEl.append(el);
      this.paras.push({ el, text: t });
    }
    this.body.append(this.textEl);
    if (p.objectives?.length) {
      this.body.append(h('div', { class: 'dlg-sec' }, 'Objectives'));
      const ul = h('ul', { class: 'dlg-obj' });
      for (const o of p.objectives) ul.append(h('li', null, o));
      this.body.append(ul);
    }
    if (p.rewardXp || p.rewardItem) {
      this.body.append(h('div', { class: 'dlg-sec' }, 'Rewards'));
      const r = h('div', { class: 'dlg-reward' });
      if (p.rewardXp) r.append(h('span', { class: 'xp' }, `${p.rewardXp} XP`));
      if (p.rewardItem) r.append(h('span', { class: 'item' }, h('i'), p.rewardItem));
      this.body.append(r);
    }
    this.buttonsEl.replaceChildren();
    for (const b of p.buttons) {
      const btn = h('button', { class: `cc-btn small${b.primary ? '' : ' ghost'}`, 'data-action': b.label }, b.label);
      btn.addEventListener('click', () => {
        this.game.audio.sfx('sfx-click', { volume: 0.6 });
        b.onClick();
      });
      btn.addEventListener('mouseenter', () => this.game.audio.sfx('sfx-hover', { volume: 0.3 }));
      this.buttonsEl.append(btn);
    }
    this.total = this.paras.reduce((n, x) => n + x.text.length, 0);
    this.shown = 0;
    this.talkT = 0;
    this.render();
  }

  close(): void {
    if (!this.unit) return;
    const u = this.unit;
    this.unit = null;
    this.el.classList.add('hidden');
    u.express('happy', 1);
    this.onClose?.();
  }

  update(dt: number): void {
    if (!this.unit) return;
    if (this.shown < this.total) {
      this.shown = Math.min(this.total, this.shown + dt * 62);
      this.render();
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.talkT = 0.3;
        this.unit.express('talk', 0.4);
      }
    }
  }

  private render(): void {
    let left = Math.floor(this.shown);
    for (const p of this.paras) {
      const n = Math.max(0, Math.min(p.text.length, left));
      left -= p.text.length;
      const txt = p.text.slice(0, n);
      if (p.el.textContent !== txt) {
        p.el.textContent = txt;
        if (n > 0 && n < p.text.length) p.el.append(h('span', { class: 'caret' }));
      }
    }
  }
}
