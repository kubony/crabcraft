// Character creation: race portraits and class emblems on the left, the crab on a carved stone
// dais in the centre, lore parchment on the right, option arrows, name and Randomize at the
// bottom, Accept and Back bottom right. Layout follows the genre's classic creation screen; the
// art, text and 3D are ours.
import * as THREE from 'three';
import type { App, Screen } from '../app';
import type { ClassId, CrabSpec, RaceId, Sex } from '../crab/types';
import { CLASSES, CLASS_ORDER } from '../data/classes';
import { RACES, RACE_ORDER } from '../data/races';
import { art, h } from '../ui/dom';
import { classEmblemSvg, cornerSvg, dividerSvg, fibreUri, grainUri, portraitSvg, sexGlyphSvg, svgUri, tornEdge, waxSealSvg } from './create/art';
import { capitaliseName, isLetters, isValidName, NAME_MAX, NAME_MIN, randomName } from './create/names';
import { CreateStage, VIEW, type Reaction } from './create/stage';
import './create.css';

type OptKind = 'shell' | 'crest' | 'led';

const DESIGN_W = 1600;
const DESIGN_H = 900;
/** Design-pixel extents of the side panels and the option bar (see create.css). */
const LEFT_W = 22 + 300 + 26;
const RIGHT_W = 22 + 392 + 26;
const BAR_H = 22 + 160;

const DEFAULT_SPEC: CrabSpec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: '' };

function sanitize(s: CrabSpec | null): CrabSpec {
  if (!s || !RACES[s.race] || !CLASSES[s.classId]) return { ...DEFAULT_SPEC };
  const r = RACES[s.race];
  const idx = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);
  return {
    race: s.race,
    sex: s.sex === 'female' ? 'female' : 'male',
    classId: s.classId,
    shell: idx(s.shell, r.shellColors.length),
    crest: idx(s.crest, r.crestStyles.length),
    led: idx(s.led, r.ledColors.length),
    name: typeof s.name === 'string' && isValidName(s.name) ? s.name : '',
  };
}

const ready = (v: boolean) => ((window as unknown as { __ready?: boolean }).__ready = v);

export default class CreateScreen implements Screen {
  private app!: App;
  private stage!: CreateStage;
  private spec: CrabSpec = { ...DEFAULT_SPEC };
  private root!: HTMLElement;
  private tip!: HTMLElement;
  private cleanups: (() => void)[] = [];
  private timers = new Set<number>();
  private holdSpin = 0;
  private leaving = false;

  // DOM references updated on every change.
  private portraits = new Map<RaceId, HTMLButtonElement>();
  private classBtns = new Map<ClassId, HTMLButtonElement>();
  private sexBtns = new Map<Sex, HTMLButtonElement>();
  private optValues = new Map<OptKind | 'rotate', HTMLElement>();
  private className!: HTMLElement;
  private classRes!: HTMLElement;
  private parchClass!: HTMLElement;
  private parchRace!: HTMLElement;
  private seal!: HTMLImageElement;
  private nameInput!: HTMLInputElement;
  private nameWrap!: HTMLElement;
  private nameMsg!: HTMLElement;

  async enter(app: App): Promise<void> {
    this.app = app;
    ready(false);
    this.spec = sanitize(app.spec);
    void app.audio.playMusic('music-title');
    app.audio.preload(['sfx-click', 'sfx-hover', 'sfx-servo-whir', 'sfx-cast']);

    this.stage = new CreateStage(app.engine);
    const fonts = Promise.race([
      Promise.all([
        document.fonts.load('700 20px Cinzel'),
        document.fonts.load('400 16px Alegreya'),
        document.fonts.load('italic 400 16px Alegreya'),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => undefined);
    await Promise.all([this.stage.init(this.spec), fonts]);
    app.engine.setView(this.stage.scene, this.stage.camera, VIEW);

    this.build();
    this.refreshAll(false);
    this.layout();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stage.onLanded = () => {
      app.audio.sfx('sfx-servo-whir', { volume: 0.8 });
      this.later(320, () => {
        this.stage.react('race', this.spec);
        ready(true);
      });
    };
    if (reduced) {
      this.stage.placeNow();
      this.later(400, () => ready(true));
    } else {
      // The app fades in from black over 600 ms; the crab drops as the fade finishes.
      this.stage.startEntrance(0.75);
    }

    const canvas = app.engine.canvas;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', this.onCanvasDown);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointermove', this.onPointerMove);
    this.cleanups.push(
      () => window.removeEventListener('pointermove', this.onPointerMove),
      app.engine.onFrame(({ dt, elapsed }) => this.frame(dt, elapsed)),
      () => canvas.removeEventListener('pointerdown', this.onCanvasDown),
      () => window.removeEventListener('resize', this.onResize),
      () => window.removeEventListener('keydown', this.onKey),
      () => (canvas.style.cursor = ''),
    );
  }

  exit(): void {
    ready(false);
    for (const c of this.cleanups) c();
    this.cleanups = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.endDrag();
    this.tip?.remove();
    this.root?.remove();
    this.stage?.dispose();
    // Leave the engine on an empty view so the next screen starts clean.
    const engine = this.app.engine;
    engine.setView(new THREE.Scene(), new THREE.PerspectiveCamera(45, 1, 0.1, 100));
  }

  // -------------------------------------------------------------------------------------------
  // Frame and layout
  // -------------------------------------------------------------------------------------------

  private frame(dt: number, elapsed: number): void {
    const input = this.app.input;
    const keys = (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0);
    this.stage.spinInput = Math.max(-1, Math.min(1, keys + this.holdSpin));
    this.stage.update(dt, elapsed);
  }

  private readonly onResize = (): void => this.layout();

  private layout(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const s = Math.max(0.55, Math.min(w / DESIGN_W, hgt / DESIGN_H));
    const left = LEFT_W * s;
    const right = w - RIGHT_W * s;
    const cx = (left + right) / 2;
    const free = hgt - BAR_H * s;
    const cy = free * 0.52;
    this.root.style.setProperty('--s', s.toFixed(4));
    this.root.style.setProperty('--cx', `${cx.toFixed(1)}px`);
    this.stage.frame(w, hgt, cx, cy);
  }

  // -------------------------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------------------------

  private build(): void {
    const corner = svgUri(cornerSvg());
    const corners = () =>
      ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `cr-corner ${c}`, style: `background-image:url("${corner}")` }));

    // ---- Left: races, classes, sex ----
    const races = h('div', { class: 'cr-races' });
    for (const id of RACE_ORDER) {
      const r = RACES[id];
      const fallback = h('img', { class: 'cr-fallback', alt: '', draggable: 'false' });
      const img = h('img', { class: 'cr-art', alt: '', draggable: 'false' });
      img.addEventListener('error', () => img.classList.add('missing'));
      img.addEventListener('load', () => img.classList.remove('missing'));
      const btn = h(
        'button',
        { class: 'cr-portrait', 'data-race': id, 'aria-label': r.name, type: 'button' },
        h('span', { class: 'cr-portrait-face' }, fallback, img),
        h('span', { class: 'cr-portrait-ring' }),
      );
      btn.addEventListener('click', () => this.pickRace(id));
      this.tooltip(btn, () => this.raceTip(id));
      this.sfx(btn);
      this.portraits.set(id, btn);
      races.append(btn);
    }

    const classes = h('div', { class: 'cr-classes' });
    for (const id of CLASS_ORDER) {
      const c = CLASSES[id];
      const img = h('img', { class: 'cr-art', alt: '', draggable: 'false', src: art(`art/icons/class-${id}.webp`) });
      img.addEventListener('error', () => img.classList.add('missing'));
      const btn = h(
        'button',
        { class: 'cr-class', 'data-class': id, 'aria-label': c.name, type: 'button' },
        h('img', { class: 'cr-fallback', alt: '', draggable: 'false', src: svgUri(classEmblemSvg(id)) }),
        img,
      );
      btn.addEventListener('click', () => this.pickClass(id));
      this.tooltip(btn, () => this.classTip(id));
      this.sfx(btn);
      this.classBtns.set(id, btn);
      classes.append(btn);
    }
    this.className = h('div', { class: 'cr-classname' });
    this.classRes = h('div', { class: 'cr-classres' });

    const sexes = h('div', { class: 'cr-sexes' });
    for (const sx of ['male', 'female'] as Sex[]) {
      const label = sx === 'male' ? 'Male' : 'Female';
      const btn = h(
        'button',
        { class: 'cr-sex', 'data-sex': sx, 'aria-label': label, type: 'button' },
        h('span', { class: 'cr-medal' }, h('img', { alt: '', draggable: 'false', src: svgUri(sexGlyphSvg(sx)) })),
        h('span', { class: 'cr-sexlabel' }, label),
      );
      btn.addEventListener('click', () => this.pickSex(sx));
      this.sfx(btn);
      this.sexBtns.set(sx, btn);
      sexes.append(btn);
    }

    const left = h(
      'aside',
      { class: 'cr-left cr-frame cr-in-left' },
      ...corners(),
      h('div', { class: 'cr-group' }, h('div', { class: 'cr-caption' }, 'Race'), races),
      h('div', { class: 'cr-group' }, h('div', { class: 'cr-caption' }, 'Class'), classes, this.className, this.classRes),
      h('div', { class: 'cr-group' }, h('div', { class: 'cr-caption' }, 'Sex'), sexes),
    );

    // ---- Right: parchment and actions ----
    this.parchClass = h('div', { class: 'cr-parch-sec' });
    this.parchRace = h('div', { class: 'cr-parch-sec' });
    this.seal = h('img', { class: 'cr-seal', alt: '', draggable: 'false' });
    const parch = h(
      'div',
      { class: 'cr-parch', style: `clip-path:${tornEdge(7)}` },
      this.parchClass,
      h('div', { class: 'cr-divider', style: `background-image:url("${svgUri(dividerSvg())}")` }),
      this.parchRace,
    );
    const accept = h('button', { class: 'cr-btn cr-accept', type: 'button' }, 'Accept');
    accept.addEventListener('click', () => this.accept());
    const back = h('button', { class: 'cr-btn cr-back', type: 'button' }, 'Back');
    back.addEventListener('click', () => this.back());
    this.sfx(accept);
    this.sfx(back);
    const rightCol = h(
      'div',
      { class: 'cr-anchor cr-anchor-right' },
      h('section', { class: 'cr-parch-wrap cr-in-right' }, parch, this.seal),
      h('div', { class: 'cr-actions cr-in-actions' }, accept, back),
    );

    // ---- Bottom: options, name, randomize ----
    const opts = h('div', { class: 'cr-opts' }, this.option('shell', 'Shell Color'), this.option('rotate', 'Rotate'), this.option('crest', 'Crest Style'), this.option('led', 'LED Color'));
    this.nameInput = h('input', {
      class: 'cr-input',
      type: 'text',
      maxlength: NAME_MAX,
      placeholder: 'Enter a name',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': 'Name',
    });
    this.bindName(this.nameInput);
    this.nameMsg = h('div', { class: 'cr-name-msg', role: 'status' });
    this.nameWrap = h('div', { class: 'cr-input-wrap' }, this.nameInput);
    const rnd = h('button', { class: 'cr-btn cr-random', type: 'button' }, 'Randomize');
    rnd.addEventListener('click', () => this.randomize());
    this.sfx(rnd);
    const bar = h(
      'div',
      { class: 'cr-bar cr-frame cr-in-bottom' },
      ...corners(),
      opts,
      h('div', { class: 'cr-name' }, h('label', { class: 'cr-name-label' }, 'Name'), this.nameWrap, this.nameMsg, rnd),
    );

    this.root = h(
      'div',
      { class: 'cr-root' },
      h('div', { class: 'cr-anchor cr-anchor-left' }, left),
      rightCol,
      h('div', { class: 'cr-anchor cr-anchor-bottom' }, bar),
    );
    this.root.style.setProperty('--cr-grain', `url("${grainUri()}")`);
    this.root.style.setProperty('--cr-fibre', `url("${fibreUri()}")`);
    this.app.ui.append(this.root);

    this.tip = h('div', { class: 'cc-tooltip cr-tip' });
    this.app.overlay.append(this.tip);
  }

  private option(kind: OptKind | 'rotate', label: string): HTMLElement {
    const value = h('div', { class: 'cr-opt-value' });
    this.optValues.set(kind, value);
    const arrow = (dir: -1 | 1) => {
      const b = h('button', {
        class: `cr-arrow ${dir < 0 ? 'left' : 'right'}`,
        type: 'button',
        'aria-label': `${label} ${dir < 0 ? 'previous' : 'next'}`,
      });
      this.sfx(b, kind !== 'rotate');
      if (kind === 'rotate') {
        b.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          b.setPointerCapture(e.pointerId);
          this.holdSpin = dir;
          this.app.audio.sfx('sfx-click', { volume: 0.6 });
          b.classList.add('held');
        });
        const stop = () => {
          if (this.holdSpin === dir) this.holdSpin = 0;
          b.classList.remove('held');
        };
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointercancel', stop);
        b.addEventListener('lostpointercapture', stop);
        // Keyboard activation: a quarter-ish turn per press.
        b.addEventListener('click', (e) => {
          if ((e as MouseEvent).detail === 0) this.stage.yaw += dir * 0.5;
        });
      } else {
        b.addEventListener('click', () => this.cycle(kind, dir));
      }
      return b;
    };
    return h(
      'div',
      { class: `cr-opt cr-opt-${kind}`, 'data-opt': kind },
      arrow(-1),
      h('div', { class: 'cr-plate' }, h('div', { class: 'cr-opt-label' }, label), value),
      arrow(1),
    );
  }

  // -------------------------------------------------------------------------------------------
  // State changes
  // -------------------------------------------------------------------------------------------

  private change(reaction: Reaction | null): void {
    this.stage.apply(this.spec, reaction);
  }

  private pickRace(id: RaceId): void {
    if (this.leaving) return;
    if (id === this.spec.race) {
      this.stage.react('sex', this.spec);
      return;
    }
    this.spec.race = id;
    this.spec.shell = 0;
    this.spec.crest = 0;
    this.spec.led = 0;
    this.change('race');
    this.refreshSelection();
    this.refreshOptions(true);
    this.crossfade(this.parchRace, () => this.fillRace());
  }

  private pickClass(id: ClassId): void {
    if (this.leaving || id === this.spec.classId) return;
    this.spec.classId = id;
    this.change('class');
    this.refreshSelection();
    this.crossfade(this.parchClass, () => this.fillClass());
  }

  private pickSex(sx: Sex): void {
    if (this.leaving || sx === this.spec.sex) return;
    this.spec.sex = sx;
    this.change('sex');
    this.refreshSelection();
    this.refreshPortraits();
  }

  private cycle(kind: OptKind, dir: number): void {
    if (this.leaving) return;
    const r = RACES[this.spec.race];
    const n = kind === 'shell' ? r.shellColors.length : kind === 'crest' ? r.crestStyles.length : r.ledColors.length;
    this.spec[kind] = (this.spec[kind] + dir + n) % n;
    this.change(kind);
    this.refreshOption(kind, dir);
  }

  private randomize(): void {
    if (this.leaving) return;
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
    const race = pick(RACE_ORDER);
    const r = RACES[race];
    const prevRace = this.spec.race;
    const prevClass = this.spec.classId;
    const sex: Sex = Math.random() < 0.5 ? 'male' : 'female';
    this.spec = {
      race,
      sex,
      classId: pick(CLASS_ORDER),
      shell: Math.floor(Math.random() * r.shellColors.length),
      crest: Math.floor(Math.random() * r.crestStyles.length),
      led: Math.floor(Math.random() * r.ledColors.length),
      name: randomName(race, sex, this.spec.name),
    };
    this.change('random');
    this.refreshSelection();
    this.refreshPortraits();
    this.refreshOptions(true);
    if (prevRace !== race) this.crossfade(this.parchRace, () => this.fillRace());
    if (prevClass !== this.spec.classId) this.crossfade(this.parchClass, () => this.fillClass());
    this.nameInput.value = this.spec.name;
    this.setNameMsg('');
    this.nameWrap.classList.remove('cr-glint');
    void this.nameWrap.offsetWidth;
    this.nameWrap.classList.add('cr-glint');
  }

  private accept(): void {
    if (this.leaving) return;
    const name = capitaliseName(this.nameInput.value.trim());
    if (!isValidName(name)) {
      this.rejectName(name.length === 0 ? 'Every crab needs a name.' : `Names are ${NAME_MIN} to ${NAME_MAX} letters.`);
      this.nameInput.focus();
      return;
    }
    this.leaving = true;
    this.spec.name = name;
    this.app.saveSpec({ ...this.spec });
    this.stage.react('accept', this.spec);
    this.root.classList.add('cr-leaving');
    this.later(550, () => void this.app.go('game'));
  }

  private back(): void {
    if (this.leaving) return;
    this.leaving = true;
    void this.app.go('title');
  }

  // -------------------------------------------------------------------------------------------
  // Name field
  // -------------------------------------------------------------------------------------------

  private bindName(input: HTMLInputElement): void {
    input.addEventListener('beforeinput', (e) => {
      const ie = e as InputEvent;
      if (!ie.inputType.startsWith('insert') || ie.isComposing) return;
      const data = ie.data ?? ie.dataTransfer?.getData('text/plain') ?? '';
      if (!data) return;
      const selLen = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);
      const nextLen = input.value.length - selLen + data.length;
      if (!isLetters(data)) {
        e.preventDefault();
        this.rejectName('Letters only, please.');
      } else if (nextLen > NAME_MAX) {
        e.preventDefault();
        this.rejectName(`Names are ${NAME_MIN} to ${NAME_MAX} letters.`);
      }
    });
    input.addEventListener('input', (e) => {
      if ((e as InputEvent).isComposing) return;
      const raw = input.value;
      const clean = capitaliseName(raw.replace(/[^A-Za-z]/g, '').slice(0, NAME_MAX));
      if (clean !== raw) {
        const caret = Math.min(input.selectionStart ?? clean.length, clean.length);
        input.value = clean;
        input.setSelectionRange(caret, caret);
        if (clean.toLowerCase() !== raw.toLowerCase()) this.rejectName('Letters only, please.');
      }
      this.spec.name = input.value;
      if (isValidName(input.value)) this.setNameMsg('');
    });
    input.addEventListener('compositionend', () => input.dispatchEvent(new Event('input')));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.accept();
      } else if (e.key === 'Escape') {
        input.blur();
      }
      e.stopPropagation();
    });
  }

  private rejectName(msg: string): void {
    this.setNameMsg(msg);
    this.nameWrap.classList.remove('cr-shake');
    void this.nameWrap.offsetWidth;
    this.nameWrap.classList.add('cr-shake');
    this.app.audio.sfx('sfx-click', { volume: 0.5, pitch: 0.02 });
  }

  private setNameMsg(msg: string): void {
    this.nameMsg.textContent = msg;
    this.nameMsg.classList.toggle('on', !!msg);
  }

  // -------------------------------------------------------------------------------------------
  // Rendering state into the DOM
  // -------------------------------------------------------------------------------------------

  private refreshAll(animate: boolean): void {
    this.refreshSelection();
    this.refreshPortraits();
    this.refreshOptions(animate);
    this.fillClass();
    this.fillRace();
    this.nameInput.value = this.spec.name;
    this.optValues.get('rotate')!.replaceChildren(h('span', { class: 'cr-opt-hint' }, 'Hold, or drag the crab'));
  }

  private refreshSelection(): void {
    for (const [id, b] of this.portraits) b.classList.toggle('selected', id === this.spec.race);
    for (const [id, b] of this.classBtns) b.classList.toggle('selected', id === this.spec.classId);
    for (const [id, b] of this.sexBtns) b.classList.toggle('selected', id === this.spec.sex);
    const c = CLASSES[this.spec.classId];
    this.className.textContent = c.name;
    this.classRes.textContent = c.resource === 'rage' ? 'Rage' : 'Mana';
    this.classRes.dataset.res = c.resource;
  }

  private refreshPortraits(): void {
    for (const [id, b] of this.portraits) {
      const fallback = b.querySelector<HTMLImageElement>('.cr-fallback')!;
      const img = b.querySelector<HTMLImageElement>('.cr-art')!;
      fallback.src = svgUri(portraitSvg(id, this.spec.sex));
      const src = art(`art/portraits/${id}-${this.spec.sex}.webp`);
      if (img.getAttribute('src') !== src) {
        img.classList.add('missing');
        img.src = src;
      }
    }
  }

  private refreshOptions(animate: boolean): void {
    for (const k of ['shell', 'crest', 'led'] as OptKind[]) this.refreshOption(k, animate ? 1 : 0);
  }

  private refreshOption(kind: OptKind, dir: number): void {
    const r = RACES[this.spec.race];
    const el = this.optValues.get(kind)!;
    const i = this.spec[kind];
    let content: HTMLElement[];
    if (kind === 'shell') {
      const c = r.shellColors[i];
      content = [h('i', { class: 'cr-swatch', style: `--c:${c.hex}` }), h('span', null, c.name)];
    } else if (kind === 'led') {
      const c = r.ledColors[i];
      content = [h('i', { class: 'cr-swatch led', style: `--c:${c.hex}` }), h('span', null, c.name)];
    } else {
      content = [h('span', null, r.crestStyles[i].name)];
    }
    const n = kind === 'shell' ? r.shellColors.length : kind === 'crest' ? r.crestStyles.length : r.ledColors.length;
    content.push(h('em', { class: 'cr-count' }, `${i + 1}/${n}`));
    el.replaceChildren(...content);
    if (dir !== 0) {
      el.classList.remove('slide-l', 'slide-r');
      void el.offsetWidth;
      el.classList.add(dir < 0 ? 'slide-l' : 'slide-r');
    }
  }

  private fillClass(): void {
    const c = CLASSES[this.spec.classId];
    this.seal.src = svgUri(waxSealSvg(c.id));
    const emblem = h('img', { class: 'cr-art', alt: '', src: art(`art/icons/class-${c.id}.webp`) });
    emblem.addEventListener('error', () => emblem.classList.add('missing'));
    this.parchClass.replaceChildren(
      h('div', { class: 'cr-parch-emblem' }, h('img', { class: 'cr-fallback', alt: '', src: svgUri(classEmblemSvg(c.id)) }), emblem),
      h('h2', { class: 'cr-parch-title' }, c.name),
      h('p', { class: 'cr-parch-lore' }, c.lore),
    );
  }

  private fillRace(): void {
    const r = RACES[this.spec.race];
    this.parchRace.replaceChildren(
      h('h3', { class: 'cr-parch-race' }, r.name),
      h('div', { class: 'cr-parch-tagline' }, r.tagline),
      h('p', { class: 'cr-parch-lore small' }, r.lore),
    );
  }

  private crossfade(el: HTMLElement, fill: () => void): void {
    if (el.dataset.swapping) return;
    el.dataset.swapping = '1';
    el.classList.add('cr-out');
    this.later(170, () => {
      fill();
      el.classList.remove('cr-out');
      delete el.dataset.swapping;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Tooltips and sounds
  // -------------------------------------------------------------------------------------------

  private raceTip(id: RaceId): HTMLElement[] {
    const r = RACES[id];
    return [
      h('div', { class: 't-title' }, r.name),
      h('div', { class: 't-meta' }, r.tagline),
      h('div', { class: 't-desc' }, `Crests: ${r.crestStyles.map((c) => c.name).join(', ')}`),
    ];
  }

  private classTip(id: ClassId): HTMLElement[] {
    const c = CLASSES[id];
    return [
      h('div', { class: 't-title' }, c.name),
      h('div', { class: 't-meta' }, `${c.weapon}. Uses ${c.resource === 'rage' ? 'Rage' : 'Mana'}.`),
      h('div', { class: 't-desc' }, c.abilities.map((a) => a.name).join(', ')),
    ];
  }

  private tooltip(el: HTMLElement, content: () => HTMLElement[]): void {
    el.addEventListener('mouseenter', () => {
      this.tip.replaceChildren(...content());
      const r = el.getBoundingClientRect();
      this.tip.classList.add('on');
      const tw = this.tip.offsetWidth;
      const th = this.tip.offsetHeight;
      const x = Math.min(window.innerWidth - tw - 8, r.right + 14);
      const y = Math.max(8, Math.min(window.innerHeight - th - 8, r.top + r.height / 2 - th / 2));
      this.tip.style.left = `${x}px`;
      this.tip.style.top = `${y}px`;
    });
    el.addEventListener('mouseleave', () => this.tip.classList.remove('on'));
  }

  private sfx(el: HTMLElement, clickSound = true): void {
    el.addEventListener('mouseenter', () => this.app.audio.sfx('sfx-hover', { volume: 0.4 }));
    if (clickSound) el.addEventListener('click', () => this.app.audio.sfx('sfx-click'));
  }

  // -------------------------------------------------------------------------------------------
  // Dragging the crab and keyboard
  // -------------------------------------------------------------------------------------------

  private dragLast = { x: 0, t: 0 };
  private dragId = -1;

  private readonly onCanvasDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.leaving) return;
    this.dragId = e.pointerId;
    this.dragLast = { x: e.clientX, t: performance.now() };
    this.stage.beginDrag();
    this.app.engine.canvas.style.cursor = 'grabbing';
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  };

  private readonly onDragMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    const now = performance.now();
    this.stage.drag(e.clientX - this.dragLast.x, (now - this.dragLast.t) / 1000);
    this.dragLast = { x: e.clientX, t: now };
  };

  private readonly onDragEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.endDrag();
  };

  private endDrag(): void {
    if (this.dragId < 0) return;
    this.dragId = -1;
    this.stage.endDrag();
    this.app.engine.canvas.style.cursor = 'grab';
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.stage.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
    else if (e.key === 'Escape' && !e.repeat) this.back();
  };

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }
}
