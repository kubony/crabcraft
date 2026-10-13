// Product-shot camera: orbits the robot, follows it across the desk, and by default keeps the
// same angle on its face as it turns (a tracking shot). Drag to orbit, wheel to zoom.
import * as THREE from 'three';

export class OrbitFollow {
  readonly camera: THREE.PerspectiveCamera;
  /** Yaw of the camera around the robot, relative to the robot's heading when following. */
  azimuth = 0.62;
  elevation = 0.24;
  distance = 0.9;
  follow = true;
  private target = new THREE.Vector3(0, 0.07, 0);
  private heading = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private idle = 0;
  private az = this.azimuth;
  private speedZoom = 0;
  private swayT = 0;
  /** The azimuth the idle sway centres on: the last one a person chose. */
  private home = this.azimuth;
  private el = this.elevation;
  private dist = this.distance;
  private readonly el0: HTMLElement;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.01, 60);
    this.el0 = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Snap without easing (first frame, reset). */
  snap(base: THREE.Vector3, yaw: number): void {
    this.target.copy(base).setY(base.y * 0.6 + 0.02);
    this.heading = yaw;
    this.az = this.azimuth;
    this.el = this.elevation;
    this.dist = this.distance;
    this.apply();
  }

  update(dt: number, base: THREE.Vector3, yaw: number, speed = 0): void {
    this.idle += dt;
    const k = 1 - Math.exp(-dt * 5);
    this.target.lerp(new THREE.Vector3(base.x, base.y * 0.6 + 0.02, base.z), k);
    // Pull back while walking so the whole robot and where it is going stay in frame.
    this.speedZoom += (Math.min(1, speed / 0.6) - this.speedZoom) * (1 - Math.exp(-dt * 1.5));
    if (this.follow) {
      let d = yaw - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-dt * 1.6));
    }
    // Nobody touching anything: a slow sway across the robot's face, so a parked robot still
    // reads as a live shot, without ever drifting round to its back.
    if (this.idle > 8 && !this.dragging) {
      this.swayT += dt;
      const want = this.home + Math.sin(this.swayT * 0.16) * 0.55;
      this.azimuth += (want - this.azimuth) * (1 - Math.exp(-dt * 0.5));
    } else {
      this.swayT = 0;
    }
    const kz = 1 - Math.exp(-dt * 8);
    this.az += (this.azimuth - this.az) * kz;
    this.el += (this.elevation - this.el) * kz;
    this.dist += (this.distance - this.dist) * kz;
    this.apply();
  }

  private apply(): void {
    const yaw = (this.follow ? this.heading : 0) + this.az;
    const c = Math.cos(this.el);
    const dist = this.dist * (1 + this.speedZoom * 0.45);
    this.camera.position.set(
      this.target.x + dist * c * Math.sin(yaw),
      this.target.y + dist * Math.sin(this.el),
      this.target.z + dist * c * Math.cos(yaw),
    );
    this.camera.lookAt(this.target);
  }

  /** Input elsewhere (keys, buttons) counts as attention too. */
  poke(): void {
    this.idle = 0;
  }

  /** Distance from the camera to what it looks at, for the depth of field. */
  get focus(): number {
    return this.camera.position.distanceTo(this.target);
  }

  setFollow(on: boolean): void {
    if (on === this.follow) return;
    // Keep the camera where it is on screen: fold the heading into the azimuth.
    if (on) this.azimuth -= this.heading;
    else this.azimuth += this.heading;
    this.home = this.azimuth;
    this.az = this.azimuth;
    this.follow = on;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.idle = 0;
  };
  private onUp = (): void => {
    this.dragging = false;
  };
  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.azimuth -= dx * 0.006;
    this.home = this.azimuth;
    this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.004, 0.04, 1.35);
    this.idle = 0;
  };
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * Math.pow(1.12, Math.sign(e.deltaY)), 0.32, 3.2);
    this.idle = 0;
  };

  dispose(): void {
    this.el0.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
    this.el0.removeEventListener('wheel', this.onWheel);
  }
}
