// Credits from the title screen: the same roll as the ending.
import type { App, Screen } from '../app';
import { CreditsRoll } from '../game/creditsRoll';

export default class CreditsScreen implements Screen {
  private roll: CreditsRoll | null = null;

  enter(app: App): void {
    void app.audio.playMusic('music-ending', 2);
    this.roll = new CreditsRoll(app, { mode: 'credits' });
  }

  exit(): void {
    this.roll?.dispose();
    this.roll = null;
  }
}
