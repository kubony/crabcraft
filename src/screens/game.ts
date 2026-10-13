// The game screen: Clawhaven, the quest chain, the boss and the dance party (src/game).
import type { App, Screen } from '../app';
import { Game } from '../game/game';
import { h } from '../ui/dom';

export default class GameScreen implements Screen {
  private game: Game | null = null;

  enter(app: App): void {
    const game = new Game(app);
    this.game = game;
    // Load in the background so the loading screen fades in right away.
    game.load().catch((err: unknown) => {
      console.error(err);
      if (this.game !== game) return;
      app.ui.append(
        h(
          'div',
          { class: 'cc-panel', style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:520px;text-align:center;z-index:60' },
          h('h2', { class: 'cc-title' }, 'The tide went out'),
          h('p', null, 'Clawhaven failed to load. Please reload the page.'),
          h('button', { class: 'cc-btn', onclick: () => void app.go('title') }, 'Title'),
        ),
      );
    });
  }

  exit(): void {
    this.game?.dispose();
    this.game = null;
  }
}
