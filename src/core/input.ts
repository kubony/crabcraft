// Keyboard and mouse state, polled once per frame by gameplay and the camera.
// Typing into an <input> or <textarea> never reaches the game.

export type MouseButton = 0 | 1 | 2;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private buttons = new Set<number>();
  private buttonsPressed = new Set<number>();
  private buttonsReleased = new Set<number>();
  /** Mouse movement since the last endFrame(), in CSS pixels. */
  dx = 0;
  dy = 0;
  /** Wheel delta since the last endFrame() (positive = zoom out). */
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  /** Distance the mouse travelled while a button was held, to tell clicks from drags. */
  dragDistance = 0;
  enabled = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** `code` is a KeyboardEvent.code, e.g. 'KeyW', 'Space', 'Digit1', 'Tab', 'Escape'. */
  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }
  wasReleased(code: string): boolean {
    return this.released.has(code);
  }
  isButtonDown(b: MouseButton): boolean {
    return this.enabled && this.buttons.has(b);
  }
  wasButtonPressed(b: MouseButton): boolean {
    return this.enabled && this.buttonsPressed.has(b);
  }
  wasButtonReleased(b: MouseButton): boolean {
    return this.buttonsReleased.has(b);
  }
  /** A press and release without much movement in between. */
  wasClicked(b: MouseButton): boolean {
    return this.buttonsReleased.has(b) && this.dragDistance < 6;
  }

  /** Call at the end of every frame after everything has read the input. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.buttonsPressed.clear();
    if (this.buttonsReleased.size) this.dragDistance = 0;
    this.buttonsReleased.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('wheel', this.onWheel);
  }

  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e)) return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    this.released.add(e.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear();
    this.buttons.clear();
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.buttons.add(e.button);
    this.buttonsPressed.add(e.button);
    this.dragDistance = 0;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.buttons.delete(e.button)) this.buttonsReleased.add(e.button);
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    const dx = e.clientX - this.mouseX;
    const dy = e.clientY - this.mouseY;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.buttons.size) {
      this.dx += dx;
      this.dy += dy;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
    }
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120;
  };
}
