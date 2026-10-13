// Title screen: painted key art, logo, main menu.
import type { App, Screen } from '../app';
import { h, art } from '../ui/dom';
import './title.css';

export default class TitleScreen implements Screen {
  private root: HTMLElement | null = null;

  enter(app: App): void {
    const play = () => void app.audio.playMusic('music-title');
    const btn = (label: string, onClick: () => void, cls = 'cc-btn') =>
      h('button', { class: cls, onclick: () => { app.audio.sfx('sfx-click'); onClick(); }, onmouseenter: () => app.audio.sfx('sfx-hover', { volume: 0.4 }) }, label);

    this.root = h(
      'div',
      { class: 'title-screen cc-fade', onpointerdown: play },
      h('div', { class: 'title-bg', style: `background-image: url("${art('art/title-bg.webp')}")` }),
      h('div', { class: 'title-rays cc-passive' }),
      h('div', { class: 'title-shade cc-passive' }),
      h('div', { class: 'title-logo-wrap' },
        h('img', { class: 'title-logo', src: art('art/logo.webp'), alt: 'World of Crabcraft', onerror: (e: Event) => ((e.target as HTMLElement).style.display = 'none') }),
        h('h1', { class: 'cc-title title-fallback' }, 'World of Crabcraft'),
      ),
      h('nav', { class: 'title-menu' },
        btn('Enter World', () => void app.go('create')),
        app.spec ? btn(`Continue as ${app.spec.name || 'your crab'}`, () => void app.go('game'), 'cc-btn ghost') : null,
        btn('Robot Mode', () => void app.go('robot'), 'cc-btn ghost'),
        btn('Credits', () => void app.go('credits'), 'cc-btn ghost'),
      ),
      h('footer', { class: 'title-footer cc-passive' },
        h('div', null, 'Every crab in this world is a Jumper robot. Every walk, wave and dance is a real policy rollout.'),
        h('div', { class: 'cc-small' }, 'Crab Robot Open-source Challenge 2026 | Apache-2.0'),
      ),
    );
    app.ui.append(this.root);
    // If the browser already allows audio (returning visitor), start the music right away.
    if (app.audio.ctx.state === 'running') play();
  }

  exit(): void {
    this.root?.remove();
  }
}
