// Placeholder until the credits screen lands.
import type { App, Screen } from '../app';
import { h } from '../ui/dom';

export default class Placeholder implements Screen {
  enter(app: App): void {
    app.ui.append(
      h('div', { class: 'cc-panel', style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)' },
        h('h2', { class: 'cc-title' }, 'credits'),
        h('button', { class: 'cc-btn', onclick: () => void app.go('title') }, 'Back'),
      ),
    );
  }
  exit(): void {}
}
