// Centre-screen text (red errors, yellow quest progress, orange boss warnings, big banners) and the
// chat log in the bottom-left corner.
import { h } from '../dom';

export class Messages {
  readonly el: HTMLElement;
  private errors: HTMLElement;
  private warnEl: HTMLElement;
  private bannerEl: HTMLElement;
  private lastError = '';
  private lastErrorAt = 0;

  constructor() {
    this.errors = h('div', { class: 'msg-errors' });
    this.warnEl = h('div', { class: 'msg-warn' });
    this.bannerEl = h('div');
    this.el = h('div', { class: 'hud-keep', style: 'position:absolute;inset:0;pointer-events:none' }, this.bannerEl, this.errors, this.warnEl);
  }

  private push(el: HTMLElement, ms: number): void {
    this.errors.append(el);
    while (this.errors.children.length > 3) this.errors.firstElementChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  error(text: string): void {
    const now = performance.now();
    if (text === this.lastError && now - this.lastErrorAt < 600) return;
    this.lastError = text;
    this.lastErrorAt = now;
    this.push(h('div', { class: 'cc-error' }, text), 1700);
  }

  info(text: string): void {
    this.push(h('div', { class: 'info' }, text), 2500);
  }

  warn(text: string): void {
    this.warnEl.replaceChildren(h('div', null, text));
  }

  /** Big gold text mid-screen: zone names, quest accepted/completed, level up. */
  banner(big: string, sub: string, kind: 'zone' | 'quest' | 'level' | 'boss' = 'quest'): void {
    const el = h(
      'div',
      { class: `cc-banner ${kind}` },
      h('div', { class: 'big cc-title' }, big),
      kind === 'zone' ? h('div', { class: 'rule' }) : null,
      sub ? h('div', { class: 'sub' }, sub) : null,
    );
    this.bannerEl.replaceChildren(el);
    setTimeout(() => el.remove(), 4300);
  }
}

export class ChatLog {
  readonly el: HTMLElement;
  private idleTimer = 0;

  constructor() {
    this.el = h('div', { class: 'chat hud-i' });
  }

  private add(cls: string, ...parts: (string | Node)[]): void {
    this.el.append(h('div', { class: `line ${cls}` }, ...parts));
    while (this.el.children.length > 9) this.el.firstElementChild?.remove();
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.el.classList.add('idle'), 12000);
  }

  system(text: string): void {
    this.add('sys', text);
  }
  loot(text: string): void {
    this.add('loot', text);
  }
  quest(text: string): void {
    this.add('quest', text);
  }
  say(name: string, text: string): void {
    this.add('say', h('b', null, `${name} says: `), text);
  }
  yell(name: string, text: string): void {
    this.add('yell', h('b', null, `${name} yells: `), text);
  }
  whisper(name: string, text: string): void {
    this.add('whisper', `${name} whispers: ${text}`);
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
  }
}
