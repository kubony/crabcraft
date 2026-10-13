// WoW-style third-person camera. Left drag orbits, right drag orbits and turns the character,
// wheel zooms. The camera pulls in when level geometry blocks the view.
import * as THREE from 'three';
import type { Input } from './input';

export interface FollowCameraOptions {
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  /** Height of the look-at point above the target's origin. */
  lookHeight?: number;
  /** Returns the distance to the first solid hit along the ray, or null. */
  raycast?: (from: THREE.Vector3, to: THREE.Vector3) => number | null;
}

export class FollowCamera {
  yaw = Math.PI; // behind a crab that faces +Z
  pitch = 0.32;
  distance: number;
  minDistance: number;
  maxDistance: number;
  lookHeight: number;
  /** True while the right button steers the character this frame. */
  steering = false;
  private currentDistance: number;
  private readonly lookAt = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private shakeTime = 0;
  private shakeAmp = 0;
  raycast?: (from: THREE.Vector3, to: THREE.Vector3) => number | null;

  constructor(readonly camera: THREE.PerspectiveCamera, opts: FollowCameraOptions = {}) {
    this.distance = opts.distance ?? 7;
    this.minDistance = opts.minDistance ?? 2.5;
    this.maxDistance = opts.maxDistance ?? 18;
    this.lookHeight = opts.lookHeight ?? 1.1;
    this.currentDistance = this.distance;
    this.raycast = opts.raycast;
  }

  /** Small screen shake for hits and boss slams. */
  shake(amplitude: number, seconds = 0.35): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  update(dt: number, input: Input, target: THREE.Vector3): void {
    const dragging = input.isButtonDown(0) || input.isButtonDown(2);
    this.steering = input.isButtonDown(2);
    if (dragging) {
      this.yaw -= input.dx * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.dy * 0.005, -0.35, 1.25);
    }
    if (input.wheel) {
      this.distance = THREE.MathUtils.clamp(this.distance * (1 + input.wheel * 0.12), this.minDistance, this.maxDistance);
    }

    this.lookAt.set(target.x, target.y + this.lookHeight, target.z);
    const cp = Math.cos(this.pitch);
    const dir = this.desired.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    let want = this.distance;
    if (this.raycast) {
      const far = dir.clone().multiplyScalar(this.distance + 0.4).add(this.lookAt);
      const hit = this.raycast(this.lookAt, far);
      if (hit !== null) want = Math.max(this.minDistance * 0.4, hit - 0.4);
    }
    // Pull in fast, ease back out slowly.
    const k = want < this.currentDistance ? 1 - Math.exp(-dt * 25) : 1 - Math.exp(-dt * 4);
    this.currentDistance += (want - this.currentDistance) * k;

    this.camera.position.copy(dir.multiplyScalar(this.currentDistance).add(this.lookAt));
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeTime) * 3;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (this.shakeTime <= 0) this.shakeAmp = 0;
    }
    this.camera.lookAt(this.lookAt);
  }

  /** Yaw of the camera's forward direction on the ground plane (0 = looking toward +Z). */
  get forwardYaw(): number {
    return this.yaw + Math.PI;
  }
}
