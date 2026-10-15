// Loads public/motions/: index.json up front, each clip lazily on first use. Clips are shared by
// every crab, so 25 crabs walking cost one copy of each clip.
import { JOINT_NAMES, type JointName } from '../crab/types';
import type { MotionClip, MotionId } from './types';

/** Clips the runtime blends in beyond the MotionIds gameplay asks for. */
export type ExtraClipId =
  | 'strafe_left_fast' | 'strafe_right_fast'
  | 'walk_fl' | 'walk_fr' | 'walk_bl' | 'walk_br' | 'walk_fast_fl' | 'walk_fast_fr'
  | 'walk_arc_left' | 'walk_arc_right' | 'walk_fast_arc_left' | 'walk_fast_arc_right';
export type ClipId = MotionId | ExtraClipId;

export interface ClipIndexEntry {
  id: ClipId;
  source: string;
  kind: 'locomotion' | 'jump' | 'claw' | 'gesture' | 'dance' | 'skill' | 'break';
  fps: number;
  frameCount: number;
  duration: number;
  loop: boolean;
  speed: number;
  bytes: number;
  velocity?: [number, number];
  yawRate?: number;
}

/**
 * A decoded clip: the MotionClip contract plus what the runtime needs to play it.
 * `q` is always in JOINT_NAMES order, whatever the file stored.
 */
export interface LoadedClip extends Omit<MotionClip, 'id'> {
  id: ClipId;
  kind: ClipIndexEntry['kind'];
  /** Seconds covered: frameCount / fps for loops, (frameCount - 1) / fps otherwise. */
  length: number;
  /**
   * 'inplace': gameplay moves the root at the clip's mean velocity; `local` holds the body
   * relative to that ideal root path (height, sway, tilt, yaw wobble).
   * 'full': the body follows `base` relative to frame 0 (jumps, claws, gestures, dances, skills).
   */
  root: 'inplace' | 'full';
  local: Float32Array | null;
  /** Mean velocity in the crab's local frame, game axes (x = left, z = forward), m/s. */
  velocity: [number, number];
  yawRate: number;
  /** Gait cycles in one loop (locomotion), used to keep blended gaits in phase. */
  cycles: number;
  /**
   * Clips that hold a pose until stopped (death, sit): a one-shot that reaches its end (or
   * `holdAt`, whichever is first) stays there instead of fading back to locomotion.
   */
  hold: boolean;
  /** Clip seconds to hold at: the skill clips go on to stand up again after the pose held. */
  holdAt?: number;
  events: Record<string, number[]>;
  /** Net planar drift and heading change over a 'full' clip, removed progressively on playback. */
  drift: { x: number; z: number; yaw: number };
}

interface ClipHeader {
  id: ClipId;
  source: string;
  kind: ClipIndexEntry['kind'];
  fps: number;
  frameCount: number;
  loop: boolean;
  joints: string[];
  speed?: number;
  events?: Record<string, number[]>;
  encoding: 'int16';
  bin: string;
  local: boolean;
  qOffset: number[];
  qScale: number[];
  baseOffset: number[];
  baseScale: number[];
  localOffset?: number[];
  localScale?: number[];
  velocity?: [number, number];
  yawRate?: number;
  cycles?: number;
  root?: 'inplace' | 'full';
  hold?: boolean;
  holdAt?: number;
}

const NJ = JOINT_NAMES.length;

function dequant(src: Int16Array, start: number, frames: number, width: number, off: number[], scale: number[]): Float32Array {
  const out = new Float32Array(frames * width);
  for (let f = 0; f < frames; f++) {
    const s = start + f * width;
    const d = f * width;
    for (let k = 0; k < width; k++) out[d + k] = off[k] + scale[k] * src[s + k];
  }
  return out;
}

function decode(h: ClipHeader, buf: ArrayBuffer): LoadedClip {
  const n = h.frameCount;
  const nj = h.joints.length;
  const raw = new Int16Array(buf);
  const expect = n * (nj + 7 + (h.local ? 7 : 0));
  if (raw.length < expect) throw new Error(`motion ${h.id}: ${raw.length} values, expected ${expect}`);
  const stored = dequant(raw, 0, n, nj, h.qOffset, h.qScale);
  // Index through JOINT_NAMES: the file says which joint each column is.
  let q = stored;
  const same = nj === NJ && h.joints.every((j, i) => j === JOINT_NAMES[i]);
  if (!same) {
    q = new Float32Array(n * NJ);
    const col = JOINT_NAMES.map((j) => h.joints.indexOf(j as string));
    for (let f = 0; f < n; f++) {
      for (let k = 0; k < NJ; k++) q[f * NJ + k] = col[k] >= 0 ? stored[f * nj + col[k]] : 0;
    }
  }
  const base = dequant(raw, n * nj, n, 7, h.baseOffset, h.baseScale);
  const local = h.local && h.localOffset && h.localScale
    ? dequant(raw, n * (nj + 7), n, 7, h.localOffset, h.localScale)
    : null;
  const length = h.loop ? n / h.fps : Math.max(0, n - 1) / h.fps;
  // Net drift of a 'full' clip: last base frame against the first (frame 0 is the origin).
  const last = (n - 1) * 7;
  const qx = base[last + 3], qy = base[last + 4], qz = base[last + 5], qw = base[last + 6];
  const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
  return {
    id: h.id,
    source: h.source,
    kind: h.kind,
    fps: h.fps,
    frameCount: n,
    loop: h.loop,
    joints: JOINT_NAMES as readonly JointName[],
    q,
    base,
    speed: h.speed,
    events: h.events ?? {},
    length,
    root: h.root ?? (h.local ? 'inplace' : 'full'),
    local,
    velocity: h.velocity ?? [0, 0],
    yawRate: h.yawRate ?? 0,
    cycles: h.cycles ?? 0,
    hold: !!h.hold,
    holdAt: h.holdAt,
    drift: { x: base[last] - base[0], z: base[last + 2] - base[2], yaw },
  };
}

export class MotionLibrary {
  readonly baseUrl: string;
  readonly ready: Promise<void>;
  private entries = new Map<ClipId, ClipIndexEntry>();
  private clips = new Map<ClipId, LoadedClip>();
  private pending = new Map<ClipId, Promise<LoadedClip>>();
  private failed = new Set<ClipId>();
  private indexLoaded = false;

  constructor(baseUrl = `${import.meta.env.BASE_URL}motions/`) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.ready = fetch(`${this.baseUrl}index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`motions index: HTTP ${r.status}`);
        return r.json() as Promise<{ clips: ClipIndexEntry[] }>;
      })
      .then((idx) => {
        for (const e of idx.clips) this.entries.set(e.id, e);
        this.indexLoaded = true;
      });
    this.ready.catch((e) => console.warn('[motion]', e));
  }

  /** Index entries, once `ready` has resolved. */
  list(): ClipIndexEntry[] {
    return [...this.entries.values()];
  }

  /** Whether the index lists this clip (false until `ready`). */
  has(id: ClipId): boolean {
    return this.entries.has(id);
  }

  /** True when the clip can never load (missing from the index, or its files failed). */
  isMissing(id: ClipId): boolean {
    return this.failed.has(id) || (this.indexLoaded && !this.entries.has(id));
  }

  /** The decoded clip if it is loaded; otherwise starts loading it and returns null. */
  get(id: ClipId): LoadedClip | null {
    const c = this.clips.get(id);
    if (c) return c;
    if (this.indexLoaded && !this.entries.has(id)) return null;
    if (!this.pending.has(id) && !this.failed.has(id)) this.load(id).catch(() => undefined);
    return null;
  }

  /** The clip as the MotionClip contract describes it (null until loaded). */
  clip(id: MotionId): MotionClip | null {
    return (this.get(id) as MotionClip | null) ?? null;
  }

  load(id: ClipId): Promise<LoadedClip> {
    const done = this.clips.get(id);
    if (done) return Promise.resolve(done);
    const busy = this.pending.get(id);
    if (busy) return busy;
    const p = (async () => {
      const hr = await fetch(`${this.baseUrl}${id}.json`);
      if (!hr.ok) throw new Error(`motion ${id}: HTTP ${hr.status}`);
      const header = (await hr.json()) as ClipHeader;
      const br = await fetch(`${this.baseUrl}${header.bin}`);
      if (!br.ok) throw new Error(`motion ${id}: HTTP ${br.status}`);
      const clip = decode(header, await br.arrayBuffer());
      this.clips.set(id, clip);
      return clip;
    })();
    this.pending.set(id, p);
    p.catch((e) => {
      this.failed.add(id);
      console.warn('[motion]', e);
    }).finally(() => this.pending.delete(id));
    return p;
  }

  /** Load several clips (all locomotion by default) and wait for them. */
  async preload(ids?: ClipId[]): Promise<void> {
    await this.ready.catch(() => undefined);
    const want = ids ?? LOCOMOTION_CLIPS.filter((id) => this.entries.has(id));
    await Promise.all(want.map((id) => this.load(id).catch(() => undefined)));
  }
}

export const LOCOMOTION_CLIPS: ClipId[] = [
  'idle', 'walk_fwd', 'walk_fast', 'walk_back', 'strafe_left', 'strafe_right',
  'strafe_left_fast', 'strafe_right_fast', 'turn_left', 'turn_right',
  'walk_fl', 'walk_fr', 'walk_bl', 'walk_br', 'walk_fast_fl', 'walk_fast_fr',
  'walk_arc_left', 'walk_arc_right', 'walk_fast_arc_left', 'walk_fast_arc_right',
];

let shared: MotionLibrary | null = null;

/** The one library every crab shares. */
export function getMotionLibrary(): MotionLibrary {
  shared ??= new MotionLibrary();
  return shared;
}
