// WoW-style third-person camera. Left drag orbits, right drag orbits and turns the character,
// wheel zooms. The camera pulls in when level geometry blocks the view.
import * as THREE from 'three';
import type { Input } from './input';

/** Ray offsets at the camera end (sideways, up), world units. */
const PROBES: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
  [1.1, 0.1],
  [-1.1, 0.1],
  [0, 0.35],
];

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
  private readonly probe = new THREE.Vector3();
  /** Seconds the view has been clear of walls. */
  private blockedT = 1;
  /** Extra pitch while squeezed against a wall. */
  private lift = 0;
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
      // A small fan of rays (centre, left, right, above) instead of one: the camera starts to pull
      // in a little before its centre would touch a wall, and a post or a crate edge flickering in
      // and out of one ray no longer pumps it back and forth.
      const reach = this.distance + 0.5;
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let hit = Infinity;
      for (const [sx, sy] of PROBES) {
        this.probe.copy(dir).multiplyScalar(reach).add(this.lookAt);
        this.probe.x += rx * sx;
        this.probe.z += rz * sx;
        this.probe.y += sy;
        const h = this.raycast(this.lookAt, this.probe);
        if (h !== null) hit = Math.min(hit, h);
      }
      if (hit < Infinity) {
        want = Math.max(this.minDistance * 0.4, hit - 0.45);
        this.blockedT = 0;
      } else {
        this.blockedT += dt;
      }
    }
    // Pull in fast when a wall cuts in (never show its inside), ease back out gently and only after
    // the view has stayed clear for a moment, so walking along a wall does not pump the camera.
    let rate = 0;
    if (want < this.currentDistance) rate = this.currentDistance - want > 2.5 ? 22 : 12;
    else if (this.blockedT === 0) rate = 2; // a wall still in view, but receding
    else if (this.blockedT > 0.3) rate = this.blockedT > 1 ? 5 : 3;
    this.currentDistance += (want - this.currentDistance) * (1 - Math.exp(-dt * rate));
    // Squeezed in close: tilt up a little to look over the crab instead of into its back.
    const squeeze = THREE.MathUtils.clamp(1 - this.currentDistance / Math.max(this.distance, 0.01), 0, 1);
    this.lift += (squeeze * 0.28 - this.lift) * (1 - Math.exp(-dt * 6));
    const pitch = Math.min(1.25, this.pitch + this.lift);
    const lp = Math.cos(pitch);
    dir.set(Math.sin(this.yaw) * lp, Math.sin(pitch), Math.cos(this.yaw) * lp);

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
