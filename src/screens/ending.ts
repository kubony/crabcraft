// Ending: the credits roll over the celebration painting, then Play Again / Robot Mode / Title.
import type { App, Screen } from '../app';
import { CreditsRoll } from '../game/creditsRoll';

export default class EndingScreen implements Screen {
  private roll: CreditsRoll | null = null;

  enter(app: App, params?: unknown): void {
    const name = (params as { name?: string } | undefined)?.name ?? app.spec?.name ?? '';
    void app.audio.playMusic('music-ending', 2);
    this.roll = new CreditsRoll(app, { mode: 'ending', playerName: name });
  }

  exit(): void {
    this.roll?.dispose();
    this.roll = null;
  }
}
