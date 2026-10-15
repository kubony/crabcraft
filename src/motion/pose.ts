// Pose sampling and blending without allocation: a Pose is 22 joint angles plus the body's
// offset (root-local, game axes, robot metres) and orientation relative to the root.
import { JOINT_NAMES } from '../crab/types';
import type { LoadedClip } from './library';

export const NJ = JOINT_NAMES.length;

/** Joints the upper-body layer owns: both claws (LF_*, RF_*). */
export const CLAW_JOINTS: number[] = JOINT_NAMES.flatMap((n, i) => (n.startsWith('LF_') || n.startsWith('RF_') ? [i] : []));

/** The calibrated standing pose (bundle contracts' default_joint_pos), MuJoCo qpos convention. */
export const HOME_Q: Float32Array = Float32Array.from([
  -0.5507, -1.0658, -0.4408, -1.374, 0.0,
  0.5524, -1.066, 0.4414, 1.4173, 0.0,
  0.0012, 0.5356, -1.8271,
  -0.0012, -0.5376, 1.8313,
  0.6313, 0.5534, -1.8648,
  -0.6326, -0.5548, 1.8678,
]);
/** Base height of the standing robot, metres (upstream STAND_Z). */
export const STAND_HEIGHT = 0.10647;

export class Pose {
  readonly q = new Float32Array(NJ);
  /** Body offset from the root, game axes, metres; y is the height above the ground. */
  readonly pos = new Float32Array(3);
  /** Body orientation relative to the root, (x, y, z, w). */
  readonly rot = new Float32Array(4);

  constructor() {
    this.setHome();
  }

  setHome(): this {
    this.q.set(HOME_Q);
    this.pos[0] = 0;
    this.pos[1] = STAND_HEIGHT;
    this.pos[2] = 0;
    this.rot[0] = this.rot[1] = this.rot[2] = 0;
    this.rot[3] = 1;
    return this;
  }

  copy(o: Pose): this {
    this.q.set(o.q);
    this.pos.set(o.pos);
    this.rot.set(o.rot);
    return this;
  }

  /** this = lerp(this, o, w); joints restricted to `joints` when given (body untouched then). */
  blend(o: Pose, w: number, joints?: number[]): this {
    if (w <= 0) return this;
    if (w >= 1 && !joints) return this.copy(o);
    const q = this.q;
    if (joints) {
      for (const i of joints) q[i] += (o.q[i] - q[i]) * w;
      return this;
    }
    for (let i = 0; i < NJ; i++) q[i] += (o.q[i] - q[i]) * w;
    for (let i = 0; i < 3; i++) this.pos[i] += (o.pos[i] - this.pos[i]) * w;
    nlerp(this.rot, o.rot, w);
    return this;
  }
}

/** a = normalize(lerp(a, b, w)) along the short arc. */
export function nlerp(a: Float32Array, b: Float32Array, w: number): void {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  let l = 0;
  for (let i = 0; i < 4; i++) {
    a[i] += (s * b[i] - a[i]) * w;
    l += a[i] * a[i];
  }
  l = 1 / Math.sqrt(l || 1);
  for (let i = 0; i < 4; i++) a[i] *= l;
}

/** Weighted sum accumulator: add poses with weights, then resolve() divides by the total. */
export class PoseSum {
  readonly q = new Float64Array(NJ);
  readonly pos = new Float64Array(3);
  readonly rot = new Float64Array(4);
  total = 0;
  private refSet = false;
  private ref = new Float64Array(4);

  reset(): void {
    this.q.fill(0);
    this.pos.fill(0);
    this.rot.fill(0);
    this.total = 0;
    this.refSet = false;
  }

  add(p: Pose, w: number): void {
    if (w <= 0) return;
    for (let i = 0; i < NJ; i++) this.q[i] += p.q[i] * w;
    for (let i = 0; i < 3; i++) this.pos[i] += p.pos[i] * w;
    if (!this.refSet) {
      for (let i = 0; i < 4; i++) this.ref[i] = p.rot[i];
      this.refSet = true;
    }
    const s = this.ref[0] * p.rot[0] + this.ref[1] * p.rot[1] + this.ref[2] * p.rot[2] + this.ref[3] * p.rot[3] < 0 ? -w : w;
    for (let i = 0; i < 4; i++) this.rot[i] += p.rot[i] * s;
    this.total += w;
  }

  resolve(out: Pose): boolean {
    if (this.total <= 1e-6) return false;
    const k = 1 / this.total;
    for (let i = 0; i < NJ; i++) out.q[i] = this.q[i] * k;
    for (let i = 0; i < 3; i++) out.pos[i] = this.pos[i] * k;
    const r = this.rot;
    const l = 1 / Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3] || 1);
    for (let i = 0; i < 4; i++) out.rot[i] = r[i] * l;
    return true;
  }
}

/** Frame pair and fraction for clip time t (seconds); loops wrap from the last frame to frame 0. */
function frameAt(c: LoadedClip, t: number, loop: boolean, out: { i0: number; i1: number; f: number }): void {
  const n = c.frameCount;
  if (n <= 1) {
    out.i0 = out.i1 = 0;
    out.f = 0;
    return;
  }
  let x = t * c.fps;
  if (loop) {
    const span = c.loop ? n : n - 1;
    x = ((x % span) + span) % span;
    const i0 = Math.floor(x);
    out.i0 = i0;
    out.i1 = i0 + 1 >= n ? 0 : i0 + 1;
    out.f = x - i0;
  } else {
    x = Math.min(Math.max(x, 0), n - 1);
    const i0 = Math.min(Math.floor(x), n - 2);
    out.i0 = i0;
    out.i1 = i0 + 1;
    out.f = x - i0;
  }
}

const fr = { i0: 0, i1: 0, f: 0 };
const qa = new Float32Array(4);
const qb = new Float32Array(4);

/**
 * Sample a clip into `out`. In-place clips give the body relative to the clip's ideal root path;
 * full-root clips give it relative to frame 0, with the clip's net drift and heading change
 * removed progressively so the crab ends where it started (gameplay owns the root), unless
 * `keepRoot` (MotionPlayOptions.carryRoot) leaves them in for the caller to carry over.
 */
export function sampleClip(c: LoadedClip, t: number, loop: boolean, out: Pose, keepRoot = false): void {
  frameAt(c, t, loop, fr);
  const { i0, i1, f } = fr;
  const q = c.q;
  const a = i0 * NJ;
  const b = i1 * NJ;
  for (let k = 0; k < NJ; k++) out.q[k] = q[a + k] + (q[b + k] - q[a + k]) * f;
  const src = c.local ?? c.base;
  const p0 = i0 * 7;
  const p1 = i1 * 7;
  for (let k = 0; k < 3; k++) out.pos[k] = src[p0 + k] + (src[p1 + k] - src[p0 + k]) * f;
  for (let k = 0; k < 4; k++) {
    qa[k] = src[p0 + 3 + k];
    qb[k] = src[p1 + 3 + k];
  }
  nlerp(qa, qb, f);
  out.rot.set(qa);
  if (!c.local && c.length > 0 && !keepRoot) {
    // full root: take out the drift linearly over the clip
    const u = Math.min(1, Math.max(0, (i0 + f) / Math.max(1, c.frameCount - 1)));
    out.pos[0] -= c.drift.x * u;
    out.pos[2] -= c.drift.z * u;
    const h = -c.drift.yaw * u * 0.5;
    // out.rot = yaw(h) * out.rot, yaw about +Y
    const s = Math.sin(h), w = Math.cos(h);
    const x = out.rot[0], y = out.rot[1], z = out.rot[2], r = out.rot[3];
    out.rot[0] = w * x + s * z;
    out.rot[1] = w * y + s * r;
    out.rot[2] = w * z - s * x;
    out.rot[3] = w * r - s * y;
    // and the offset rotates with the heading correction
    const cx = out.pos[0], cz = out.pos[2];
    const c2 = Math.cos(2 * h), s2 = Math.sin(2 * h);
    out.pos[0] = c2 * cx + s2 * cz;
    out.pos[2] = -s2 * cx + c2 * cz;
  }
}

/** Heading of a body rotation (x, y, z, w; game axes, Y up) about +Y, radians. */
export function headingOf(r: ArrayLike<number>): number {
  const x = r[0], y = r[1], z = r[2], w = r[3];
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}

/**
 * Re-express a root-relative pose against a root moved by (x, z) and turned by `yaw` about +Y:
 * pos = Ry(-yaw) (pos - (x, 0, z)), rot = yaw(-yaw) * rot.
 */
export function rebaseRoot(p: Pose, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = p.pos[0] - x, dz = p.pos[2] - z;
  p.pos[0] = c * dx - s * dz;
  p.pos[2] = s * dx + c * dz;
  const hs = Math.sin(-yaw / 2), hw = Math.cos(-yaw / 2);
  const qx = p.rot[0], qy = p.rot[1], qz = p.rot[2], qw = p.rot[3];
  p.rot[0] = hw * qx + hs * qz;
  p.rot[1] = hw * qy + hs * qw;
  p.rot[2] = hw * qz - hs * qx;
  p.rot[3] = hw * qw - hs * qy;
}

/** Events with times in (from, to], wrapping for loops. Calls fn(name) for each. */
export function crossedEvents(c: LoadedClip, from: number, to: number, loop: boolean, fn: (name: string) => void): void {
  if (to <= from) return;
  const len = c.length;
  for (const name in c.events) {
    const times = c.events[name];
    for (const t of times) {
      if (!loop) {
        if (t > from && t <= to) fn(name);
        continue;
      }
      if (len <= 0) continue;
      // count occurrences of t + k*len inside (from, to]
      const k0 = Math.ceil((from - t) / len + 1e-9);
      for (let k = k0; t + k * len <= to; k++) fn(name);
    }
  }
}
