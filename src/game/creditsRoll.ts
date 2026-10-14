// Credits roll over the ending illustration. Third-party sources are read from NOTICE.md at build
// time so the credits stay accurate as other branches add rows.
import '../ui/hud/hud.css';
import * as THREE from 'three';
import notice from '../../NOTICE.md?raw';
import type { App } from '../app';
import { h, art } from '../ui/dom';
import { NPCS } from './quests';
import { RACES } from '../data/races';

export interface NoticeRow {
  material: string;
  source: string;
  license: string;
  usedFor: string;
}

/** Rows of the first markdown table under "Third-party material" (or the first table found). */
export function parseNotice(md: string): NoticeRow[] {
  const lines = md.split(/\r?\n/);
  let start = lines.findIndex((l) => /third-party/i.test(l) && l.trim().startsWith('#'));
  if (start < 0) start = 0;
  const rows: NoticeRow[] = [];
  let header: string[] | null = null;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) {
      if (header && rows.length) break;
      continue;
    }
    const cells = l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => clean(c));
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
    const col = (re: RegExp, dflt: number) => {
      const i = header!.findIndex((x) => re.test(x));
      return cells[i >= 0 ? i : dflt] ?? '';
    };
    rows.push({ material: col(/material|asset|name/, 0), source: col(/source|url|author/, 1), license: col(/licen/, 2), usedFor: col(/used|purpose/, 3) });
  }
  return rows;
}

function clean(s: string): string {
  return s
    .trim()
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<[^>]+>/g, '');
}

export interface RollOptions {
  mode: 'ending' | 'credits';
  playerName?: string;
}

export class CreditsRoll {
  private root: HTMLElement;
  private track: HTMLElement;
  private endEl: HTMLElement;
  private raf = 0;
  private y = 0;
  private last = 0;
  private done = false;
  private keyHandler: (e: KeyboardEvent) => void;
  private speed = 36;

  constructor(app: App, opts: RollOptions) {
    // Nothing to render behind the opaque roll.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    app.engine.setView(scene, new THREE.PerspectiveCamera(), { vignette: null });

    const bg = h('div', { class: 'credits-bg', style: `background-image:url("${art('art/ending.webp')}")` });
    const probe = new Image();
    probe.onerror = () => bg.classList.add('fallback');
    probe.src = art('art/ending.webp');

    const rows = parseNotice(notice);
    const sec = (...c: (Node | string | null)[]) => h('section', null, ...c);
    const p = (text: string, cls = '') => h('p', { class: cls }, text);
    const logo = h('img', { src: art('art/logo.webp'), alt: 'World of Crabcraft', style: 'width:100%;max-width:520px', onerror: (e: Event) => ((e.target as HTMLElement).replaceWith(h('h1', { class: 'cc-title' }, 'World of Crabcraft'))) });

    this.track = h(
      'div',
      { class: 'credits-track' },
      sec(logo, p('Six shells. One tide.', 'em')),
      sec(
        h('h2', { class: 'cc-title' }, 'Starring'),
        h('div', { class: 'who' }, 'Jumper'),
        h('div', { class: 'role' }, 'the open-source crab robot by KingKong Robotics'),
        p('Every crab in Clawhaven, from the Captain to the Tyrant, is the Jumper robot body: its shell, visor, claws and walking legs, released under the Apache License 2.0.'),
        h('span', { class: 'lic' }, 'Apache-2.0  |  Copyright 2026 KingKong Robotics'),
      ),
      sec(
        h('h2', { class: 'cc-title' }, 'Real Robot Motion'),
        p("Every walk, gesture and dance you saw is a recorded rollout of Jumper's trained policies, simulated in MuJoCo on the same model the physical robot learns on."),
        p('Robot Mode runs those policies live in your browser. Press R in town or pick Robot Mode below to drive the real controller.', 'em'),
      ),
      sec(
        h('h2', { class: 'cc-title' }, 'The Cast'),
        ...NPCS.flatMap((n) => [h('div', { class: 'who' }, n.name), h('div', { class: 'role' }, `${RACES[n.race].name}, ${n.title}`)]),
        h('div', { class: 'who' }, 'Corrodius, the Rust Tyrant'),
        h('div', { class: 'role' }, 'a small red crab in very large armour'),
        h('div', { class: 'who' }, 'Little Red'),
        h('div', { class: 'role' }, 'himself, finally'),
        h('div', { class: 'who' }, 'The townsfolk of Clawhaven'),
        h('div', { class: 'role' }, 'Humans, Orcs, Dwarves, Undead, Night Elves and Tauren, all of them crabs'),
        opts.playerName ? h('div', { class: 'who' }, opts.playerName) : null,
        opts.playerName ? h('div', { class: 'role' }, 'the hero of the Rust Tide') : null,
      ),
      sec(
        h('h2', { class: 'cc-title' }, 'Third-Party Sources'),
        ...(rows.length
          ? rows.flatMap((r) => [
              h('div', { class: 'who' }, r.material),
              r.usedFor ? h('div', { class: 'role' }, r.usedFor) : null,
              h('div', { class: 'src' }, r.source),
              h('div', { class: 'lic' }, r.license),
              h('div', { style: 'height:18px' }),
            ])
          : [p('See NOTICE.md')]),
      ),
      sec(
        h('h2', { class: 'cc-title' }, 'Made For'),
        p('The Crab Robot Open-source Challenge 2026'),
        p('World of Crabcraft is open source under the Apache License 2.0. Built in the browser with three.js.'),
      ),
      sec(h('h1', { class: 'cc-title', style: 'font-size:40px' }, 'Thank you for playing'), p('The tide is calm. The beacon burns. The crabs are still dancing.', 'em')),
    );

    const btn = (label: string, fn: () => void, ghost = false) => {
      const b = h('button', { class: `cc-btn${ghost ? ' ghost' : ''}` }, label);
      b.addEventListener('click', () => {
        app.audio.sfx('sfx-click');
        fn();
      });
      b.addEventListener('mouseenter', () => app.audio.sfx('sfx-hover', { volume: 0.4 }));
      return b;
    };
    this.endEl = h(
      'div',
      { class: 'credits-end' },
      opts.mode === 'ending' ? btn('Play Again', () => void app.go('game')) : null,
      btn('Robot Mode', () => void app.go('robot'), opts.mode === 'ending'),
      btn('Title', () => void app.go('title'), true),
    );
    const thanks =
      opts.mode === 'ending'
        ? h(
            'div',
            { class: 'credits-thanks' },
            h('div', { class: 'cc-title' }, 'The Rust Tide Has Ebbed'),
            h('p', null, `Clawhaven is safe, ${opts.playerName || 'hero'}. The beacon of Saltmere burns again, and somewhere out in the bay a small red crab is learning to swim.`),
          )
        : h('div', { class: 'credits-thanks' }, h('div', { class: 'cc-title' }, 'Credits'));
    this.root = h(
      'div',
      { class: 'credits cc-fade' },
      bg,
      h('div', { class: 'credits-shade' }),
      thanks,
      h('div', { class: 'credits-roll' }, this.track),
      this.endEl,
      h('div', { class: 'credits-skip' }, 'Space to skip'),
    );
    this.root.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) this.speed = this.speed === 36 ? 140 : 36;
    });
    this.keyHandler = (e) => {
      if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        this.finish();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    app.ui.append(this.root);
    setTimeout(() => this.endEl.classList.add('on'), opts.mode === 'credits' ? 1200 : 9000);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.done) {
      this.y += dt * this.speed;
      const max = this.endY();
      if (this.y >= max) this.finish();
      else this.track.style.transform = `translateY(${-this.y}px)`;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Scroll offset that centres the last card in the roll. */
  private endY(): number {
    const roll = this.track.parentElement!.clientHeight;
    const lastSec = this.track.lastElementChild as HTMLElement | null;
    return lastSec ? lastSec.offsetTop + lastSec.offsetHeight / 2 + roll * 0.5 : this.track.scrollHeight;
  }

  /** Jump to the end: last card visible, buttons up. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.track.style.transition = 'transform 1.2s ease';
    this.track.style.transform = `translateY(${-this.endY()}px)`;
    this.endEl.classList.add('on');
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }
}
