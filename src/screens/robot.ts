// Robot Mode screen: Jumper's real policies running live, full screen, with a way back to the title.
import type { App, Screen } from '../app';
import type { RobotModeHandle } from '../robot';
import { h } from '../ui/dom';

export default class RobotScreen implements Screen {
  private handle: RobotModeHandle | null = null;
  private host: HTMLElement | null = null;
  private left = false;

  async enter(app: App): Promise<void> {
    // pointer-events stay off on the host so the canvas underneath gets the orbit drags.
    this.host = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    app.ui.append(this.host);
    const { startRobotMode } = await import('../robot');
    // Not awaited: the screen fades in on the loading overlay while the bundle downloads.
    // The player's crab from character creation wears the live policy; without one the bare robot
    // starts and the HUD offers a race and class picker.
    startRobotMode(this.host, { engine: app.engine, spec: app.spec, onBack: () => void app.go('title') })
      .then((handle) => {
        if (this.left) handle.stop();
        else this.handle = handle;
      })
      .catch((err: unknown) => console.error('Robot Mode failed to start', err));
  }

  exit(): void {
    this.left = true;
    this.handle?.stop();
    this.handle = null;
    this.host?.remove();
  }
}
