// The in-game HUD: composes every widget and updates them once per frame.
import './hud.css';
import { h } from '../dom';
import type { Game } from '../../game/game';
import { ActionBar, CastBar, Prompt } from './actionbar';
import { BossFrame, UnitFrame } from './frames';
import { Minimap } from './minimap';
import { ChatLog, Messages } from './messages';
import { GameMenu } from './menu';
import { Bubbles, FloatingText, Nameplates } from './plates';
import { DialogueWindow, QuestLogPanel, QuestTracker } from './questui';
import { ControlHints } from './hints';

export class Hud {
  readonly root: HTMLElement;
  readonly playerFrame: UnitFrame;
  readonly targetFrame: UnitFrame;
  readonly bossFrame: BossFrame;
  readonly actionBar: ActionBar;
  readonly castBar: CastBar;
  readonly prompt: Prompt;
  readonly tracker: QuestTracker;
  readonly questLog: QuestLogPanel;
  readonly dialogue: DialogueWindow;
  readonly plates: Nameplates;
  readonly floats: FloatingText;
  readonly bubbles: Bubbles;
  readonly minimap: Minimap;
  readonly messages: Messages;
  readonly chat: ChatLog;
  readonly menu: GameMenu;
  readonly hints: ControlHints;
  private dmgFlash: HTMLElement;
  private lowHp: HTMLElement;
  private letterTop: HTMLElement;
  private letterBottom: HTMLElement;
  private caption: HTMLElement;
  private skipHint: HTMLElement;
  private deathEl: HTMLElement | null = null;
  readonly debugEl: HTMLElement;

  constructor(private readonly game: Game) {
    this.playerFrame = new UnitFrame('player');
    this.targetFrame = new UnitFrame('target');
    this.bossFrame = new BossFrame();
    this.actionBar = new ActionBar(game, () => this.questLog.toggle(), () => game.toggleMenu(), () => game.toggleMusic());
    this.castBar = new CastBar(game);
    this.prompt = new Prompt();
    this.tracker = new QuestTracker((q) => this.questLog.toggle(true, q));
    this.questLog = new QuestLogPanel(game);
    this.dialogue = new DialogueWindow(game);
    this.plates = new Nameplates();
    this.floats = new FloatingText();
    this.bubbles = new Bubbles();
    this.minimap = new Minimap(game);
    this.messages = new Messages();
    this.chat = new ChatLog();
    this.menu = new GameMenu(game);
    this.hints = new ControlHints();
    this.dmgFlash = h('div', { class: 'dmg-flash hud-keep' });
    this.lowHp = h('div', { class: 'low-hp' });
    this.letterTop = h('div', { class: 'letterbox top hud-keep' });
    this.letterBottom = h('div', { class: 'letterbox bottom hud-keep' });
    this.caption = h('div', { class: 'caption hud-keep' });
    this.skipHint = h('div', { class: 'skip-hint hud-keep' }, 'Press Space to continue');
    this.debugEl = h('div', { class: 'debug-readout hidden' });
    this.root = h(
      'div',
      { class: 'hud cc-passive' },
      this.lowHp,
      this.dmgFlash,
      this.plates.el,
      this.bubbles.el,
      this.floats.el,
      this.playerFrame.el,
      this.targetFrame.el,
      this.bossFrame.el,
      this.minimap.el,
      this.tracker.el,
      this.chat.el,
      this.castBar.el,
      this.prompt.el,
      this.actionBar.el,
      this.messages.el,
      this.hints.el,
      this.debugEl,
      this.dialogue.el,
      this.questLog.el,
      this.letterTop,
      this.letterBottom,
      this.caption,
      this.skipHint,
      this.menu.el,
    );
  }

  update(dt: number): void {
    const g = this.game;
    // Layout reads before this frame's writes: where the boss frame ends, for the speech bubbles.
    const bossOn = this.bossFrame.el.classList.contains('on');
    const topLimit = bossOn ? this.bossFrame.el.getBoundingClientRect().bottom + 6 : 96;
    this.root.classList.toggle('boss-on', bossOn);
    this.hints.el.classList.toggle('muted', this.dialogue.isOpen || this.questLog.open || this.menu.open);
    this.playerFrame.update(g);
    this.targetFrame.update(g);
    this.bossFrame.update(g);
    this.actionBar.update();
    this.castBar.update();
    this.plates.update(g);
    this.floats.update(g, dt);
    this.bubbles.update(g, topLimit);
    this.minimap.update(dt);
    this.dialogue.update(dt);
    this.hints.update(dt);
    const p = g.player.unit;
    const low = p.alive && p.hp / p.maxHp < 0.3 && !g.cinematic;
    this.lowHp.style.opacity = low ? '1' : '0';
  }

  damageFlash(fraction: number): void {
    if (fraction < 0.08) return;
    this.dmgFlash.classList.remove('on');
    void this.dmgFlash.offsetWidth;
    this.dmgFlash.style.filter = `brightness(${0.6 + Math.min(1, fraction * 3)})`;
    this.dmgFlash.classList.add('on');
  }

  /** Hide gameplay widgets for cutscenes; letterbox bars slide in. */
  setCinematic(on: boolean): void {
    this.root.classList.toggle('cinematic', on);
    this.letterTop.classList.toggle('on', on);
    this.letterBottom.classList.toggle('on', on);
    if (!on) this.setCaption('');
    this.skipHint.classList.toggle('on', false);
  }

  setCaption(text: string): void {
    if (text) this.caption.textContent = text;
    this.caption.classList.toggle('on', !!text);
  }

  showSkip(on: boolean): void {
    this.skipHint.classList.toggle('on', on);
  }

  showDeath(on: boolean): void {
    if (on && !this.deathEl) {
      this.deathEl = h('div', { class: 'death hud-keep' }, h('div', { class: 'big' }, 'You have died'), h('div', { class: 'sub' }, 'Your shell will be carried back to Clawhaven Square...'));
      this.root.append(this.deathEl);
    } else if (!on && this.deathEl) {
      this.deathEl.remove();
      this.deathEl = null;
    }
  }

  dispose(): void {
    this.actionBar.hideTip();
    this.chat.dispose();
    this.root.remove();
  }
}
