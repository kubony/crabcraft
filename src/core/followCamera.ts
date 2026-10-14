// WoW-style third-person camera. Left drag orbits, right drag orbits and turns the character,
// wheel zooms. The camera pulls in when level geometry blocks the view.
//
// On top of the player's own orbit the game can direct it, always as a blend the player's input
// keeps working under:
// - a fight framing: the orbit rises, and the aim leans toward a second subject (the boss) while
//   it is ahead of the camera, so the player's crab sits low in frame with the boss above it;
// - a body to keep out of (the boss): the camera climbs over it instead of ending up inside it;
// - a scripted shot (dialogue) that the camera eases into and back out of.
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

const MAX_PITCH = 1.3;
/** Seconds to ease into and out of a scripted shot. */
const SHOT_IN = 0.85;
const SHOT_OUT = 0.7;

export interface FollowCameraOptions {
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  /** Height of the look-at point above the target's origin. */
  lookHeight?: number;
  /** Returns the distance to the first solid hit along the ray, or null. */
  raycast?: (from: THREE.Vector3, to: THREE.Vector3) => number | null;
}

/** A camera pose to ease into (and back out of when it is cleared). */
export interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Vertical field of view in degrees. */
  fov: number;
}

/** An upright ellipsoid the camera stays out of, e.g. a giant crab. */
export interface CameraAvoid {
  center: THREE.Vector3;
  /** Horizontal radius. */
  rx: number;
  /** Vertical radius. */
  ry: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class FollowCamera {
  yaw = Math.PI; // behind a crab that faces +Z
  pitch = 0.32;
  distance: number;
  minDistance: number;
  maxDistance: number;
  lookHeight: number;
  /** True while the right button steers the character this frame. */
  steering = false;
  /** Fight framing the camera eases toward: 0 off, 1 full. */
  assist = 0;
  /** At full assist: pitch added to the player's own. */
  assistPitch = 0.24;
  /** At full assist: how far (radians) the aim rises above the player, putting the crab low in frame. */
  assistTilt = 0.075;
  /** Second subject for the fight framing (hasFocus says whether it is set). */
  readonly focus = new THREE.Vector3();
  hasFocus = false;
  /** How far the aim leans from the player toward the focus while it is ahead of the camera. */
  focusShare = 0.4;
  /** Body to keep the camera out of. */
  avoid: CameraAvoid | null = null;
  /** Scripted shot to ease into; null eases back to the follow camera. */
  shot: CameraShot | null = null;
  /** Vertical field of view of the follow camera, degrees. */
  baseFov: number;
  raycast?: (from: THREE.Vector3, to: THREE.Vector3) => number | null;

  private currentDistance: number;
  private readonly lookAt = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private shakeTime = 0;
  private shakeAmp = 0;
  private readonly probe = new THREE.Vector3();
  /** Seconds the view has been clear of walls. */
  private blockedT = 1;
  /** Extra pitch while squeezed against a wall. */
  private lift = 0;
  /** Extra pitch that keeps the camera out of the avoid body. */
  private avoidLift = 0;
  private assistW = 0;
  /** 0..1 progress into the scripted shot (eased with smoothstep when blended). */
  private shotT = 0;
  private readonly shotPos = new THREE.Vector3();
  private readonly shotAim = new THREE.Vector3();
  private shotFov = 55;

  constructor(readonly camera: THREE.PerspectiveCamera, opts: FollowCameraOptions = {}) {
    this.distance = opts.distance ?? 7;
    this.minDistance = opts.minDistance ?? 2.5;
    this.maxDistance = opts.maxDistance ?? 18;
    this.lookHeight = opts.lookHeight ?? 1.1;
    this.currentDistance = this.distance;
    this.raycast = opts.raycast;
    this.baseFov = camera.fov;
  }

  /** Small screen shake for hits and boss slams. */
  shake(amplitude: number, seconds = 0.35): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  /** How far the view has eased into the scripted shot, 0..1. */
  get shotBlend(): number {
    return smooth(this.shotT);
  }

  /** Drop any scripted shot at once and restore the lens (a cutscene takes the camera over). */
  cut(): void {
    this.shot = null;
    this.shotT = 0;
    this.setFov(this.baseFov);
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
    this.assistW += (THREE.MathUtils.clamp(this.assist, 0, 1) - this.assistW) * (1 - Math.exp(-dt * 2.5));
    if (this.assistW < 1e-3 && this.assist <= 0) this.assistW = 0;

    this.lookAt.set(target.x, target.y + this.lookHeight, target.z);
    const basePitch = Math.min(MAX_PITCH, this.pitch + this.assistPitch * this.assistW + this.avoidLift);
    const cp = Math.cos(basePitch);
    const dir = this.desired.set(Math.sin(this.yaw) * cp, Math.sin(basePitch), Math.cos(this.yaw) * cp);

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
    const pitch = Math.min(MAX_PITCH, basePitch + this.lift);
    this.orbit(pitch, this.currentDistance, this.pos);
    this.updateAvoid(dt, pitch - this.avoidLift);

    // Aim: the player, leaning toward the focus while it is ahead, raised so the crab sits low.
    const aim = this.aim.copy(this.lookAt);
    if (this.assistW > 0) {
      if (this.hasFocus) {
        let fx = this.lookAt.x - this.pos.x;
        let fz = this.lookAt.z - this.pos.z;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
        const bx = this.focus.x - this.lookAt.x;
        const bz = this.focus.z - this.lookAt.z;
        const bl = Math.hypot(bx, bz);
        if (bl > 0.01) {
          const ahead = THREE.MathUtils.smoothstep((bx * fx + bz * fz) / bl, 0.1, 0.75);
          const k = Math.min(this.focusShare * ahead * this.assistW, 3 / bl);
          aim.lerp(this.focus, k);
        }
      }
      aim.y += Math.tan(this.assistTilt * this.assistW) * this.pos.distanceTo(aim);
    }

    // Scripted shot: ease in while one is set, back out to the follow pose once it is cleared.
    if (this.shot) {
      this.shotPos.copy(this.shot.position);
      this.shotAim.copy(this.shot.target);
      this.shotFov = this.shot.fov;
      this.shotT = Math.min(1, this.shotT + dt / SHOT_IN);
    } else if (this.shotT > 0) {
      this.shotT = Math.max(0, this.shotT - dt / SHOT_OUT);
    }
    let fov = this.baseFov;
    if (this.shotT > 0) {
      const e = smooth(this.shotT);
      this.pos.lerp(this.shotPos, e);
      aim.lerp(this.shotAim, e);
      fov = THREE.MathUtils.lerp(this.baseFov, this.shotFov, e);
    }
    this.setFov(fov);

    this.camera.position.copy(this.pos);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeTime) * 3;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (this.shakeTime <= 0) this.shakeAmp = 0;
    }
    this.camera.lookAt(aim);
  }

  /** Yaw of the camera's forward direction on the ground plane (0 = looking toward +Z). */
  get forwardYaw(): number {
    return this.yaw + Math.PI;
  }

  private orbit(pitch: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(pitch);
    return out.set(Math.sin(this.yaw) * c, Math.sin(pitch), Math.cos(this.yaw) * c).multiplyScalar(dist).add(this.lookAt);
  }

  private inside(p: THREE.Vector3, a: CameraAvoid, margin = 0): boolean {
    const dx = p.x - a.center.x;
    const dz = p.z - a.center.z;
    const dy = p.y - a.center.y;
    const rx = a.rx + margin;
    const ry = a.ry + margin;
    return (dx * dx + dz * dz) / (rx * rx) + (dy * dy) / (ry * ry) < 1;
  }

  /**
   * Keep out of the avoid body: climb over it (the view down onto the player stays readable) and,
   * if even a steep angle does not clear it, pull in in front of it.
   */
  private updateAvoid(dt: number, pitchWithout: number): void {
    const a = this.avoid;
    let need = 0;
    if (a && this.inside(this.orbit(pitchWithout, this.currentDistance, this.probe), a, 0.6)) {
      need = MAX_PITCH - pitchWithout;
      for (let p = pitchWithout + 0.05; p < MAX_PITCH; p += 0.05) {
        if (!this.inside(this.orbit(p, this.currentDistance, this.probe), a, 0.6)) {
          need = p - pitchWithout;
          break;
        }
      }
    }
    // Rise quickly (the camera must not linger inside), settle back slowly.
    this.avoidLift += (need - this.avoidLift) * (1 - Math.exp(-dt * (need > this.avoidLift ? 10 : 1.5)));
    if (a && this.inside(this.pos, a) && !this.inside(this.lookAt, a)) {
      // Still inside this frame: slide in along the boom until clear.
      const full = this.pos.distanceTo(this.lookAt);
      this.probe.copy(this.pos).sub(this.lookAt).divideScalar(full || 1);
      for (let d = full; d > 0.6; d -= 0.25) {
        this.pos.copy(this.probe).multiplyScalar(d).add(this.lookAt);
        if (!this.inside(this.pos, a)) break;
      }
    }
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
