// The motion runtime gameplay drives (MotionController in ./types). Every pose it produces comes
// from recorded clips: a phase-synchronised locomotion blend underneath, actions layered on top
// (full body, or the claws only while the legs keep walking), with crossfades between all of them.
import type { CrabRig } from '../crab/types';
import { getMotionLibrary, type ClipId, type LoadedClip, type MotionLibrary } from './library';
import { CLAW_JOINTS, Pose, PoseSum, crossedEvents, sampleClip } from './pose';
import type { MotionController, MotionId, MotionPlayOptions } from './types';

// Directional gait sets, every 45 degrees counter-clockwise from forward (+Z) toward the crab's
// left (+X): a slow and an optional fast real rollout each. Forward also has arcs (walking while
// turning) for steering at speed.
interface Direction {
  slow: ClipId;
  fast?: ClipId;
  arcs?: { slow: [ClipId, ClipId]; fast: [ClipId, ClipId] };
}
const DIRECTIONS: Direction[] = [
  { slow: 'walk_fwd', fast: 'walk_fast',
    arcs: { slow: ['walk_arc_left', 'walk_arc_right'], fast: ['walk_fast_arc_left', 'walk_fast_arc_right'] } },
  { slow: 'walk_fl', fast: 'walk_fast_fl' },
  { slow: 'strafe_left', fast: 'strafe_left_fast' },
  { slow: 'walk_bl' },
  { slow: 'walk_back' },
  { slow: 'walk_br' },
  { slow: 'strafe_right', fast: 'strafe_right_fast' },
  { slow: 'walk_fr', fast: 'walk_fast_fr' },
];
const SECTOR = (Math.PI * 2) / DIRECTIONS.length;

const DEFAULT_FADE = 0.2;
const MIN_RATE = 0.55;
const MAX_RATE = 2.0;

interface Action {
  id: MotionId;
  clip: LoadedClip | null;
  t: number;
  /** Clip window in seconds (from/to options); end is clamped to the clip length when sampled. */
  start: number;
  end: number;
  /** Where a windowed loop (loop with a finite `to`) starts again. */
  loopFrom: number;
  speed: number;
  loop: boolean;
  upper: boolean;
  fadeIn: number;
  fadeOut: number;
  weight: number;
  target: number;
  ended: boolean;
  /** Stopped or replaced before its end: no more events. */
  interrupted: boolean;
  opts: MotionPlayOptions;
}

export interface MotionControllerImpl extends MotionController {
  /** Locomotion events (footstep, foot_LM, ...) from the dominant gait, for sounds and dust. */
  onLocomotionEvent: ((name: string) => void) | null;
  /** Desired planar velocity actually being played, after smoothing (world units/s). */
  readonly velocity: { x: number; z: number; yaw: number };
  /** Current blend weights by clip id, for debugging UIs. */
  readonly weights: ReadonlyMap<string, number>;
  /** Normalised time of the newest action (0..1), or -1. */
  readonly actionProgress: number;
  /** Shared gait phase, in cycles. */
  readonly gaitPhase: number;
  /** Freeze time (debug scrubbing): update(dt) poses the rig but advances nothing. */
  paused: boolean;
  /** Set the newest action's clip time directly (seconds), for scrubbing. */
  seek(t: number): void;
}

export function createMotionController(rig: CrabRig, library: MotionLibrary = getMotionLibrary()): MotionControllerImpl {
  return new Controller(rig, library);
}

class Controller implements MotionControllerImpl {
  onLocomotionEvent: ((name: string) => void) | null = null;
  paused = false;
  readonly weights = new Map<string, number>();

  private want = { x: 0, z: 0, yaw: 0 }; // m/s, rad/s
  private vel = { x: 0, z: 0, yaw: 0 }; // smoothed, m/s
  private phase = 0; // gait cycles
  private idleT = 0;
  private actions: Action[] = [];
  private loco = new Pose();
  private tmp = new Pose();
  private out = new Pose();
  private sum = new PoseSum();
  private gaitPrev = new Map<ClipId, number>();
  private disposed = false;

  constructor(private rig: CrabRig, private lib: MotionLibrary) {
    lib.preload().catch(() => undefined);
    this.out.setHome();
  }

  get velocity() {
    const m = this.rig.metersToUnits;
    return { x: this.vel.x * m, z: this.vel.z * m, yaw: this.vel.yaw };
  }

  get gaitPhase() {
    return this.phase;
  }

  get action(): MotionId | null {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const a = this.actions[i];
      if (a.target > 0 && (!a.ended || a.clip?.hold)) return a.id;
    }
    return null;
  }

  get actionProgress(): number {
    const a = this.actions[this.actions.length - 1];
    if (!a || !a.clip || a.clip.length <= 0) return -1;
    return a.loop ? (a.t % a.clip.length) / a.clip.length : Math.min(1, a.t / a.clip.length);
  }

  setLocomotion(vx: number, vz: number, yawRate: number): void {
    const k = 1 / Math.max(1e-6, this.rig.metersToUnits);
    this.want.x = vx * k;
    this.want.z = vz * k;
    this.want.yaw = yawRate;
  }

  play(id: MotionId, opts: MotionPlayOptions = {}): void {
    if (this.disposed) return;
    const fade = opts.fade ?? DEFAULT_FADE;
    for (const a of this.actions) {
      if (a.target > 0) this.interrupt(a, Math.max(0.05, fade));
    }
    const clip = this.lib.get(id);
    if (!clip && this.lib.isMissing(id)) {
      queueMicrotask(() => opts.onEnd?.());
      return;
    }
    const start = Math.max(0, opts.from ?? 0);
    this.actions.push({
      id,
      clip,
      t: start,
      start,
      end: opts.to ?? Infinity,
      loopFrom: Math.max(start, opts.loopFrom ?? start),
      speed: opts.speed ?? 1,
      loop: opts.loop ?? false,
      upper: !!opts.upperBodyOnly,
      fadeIn: Math.max(0.0001, fade),
      fadeOut: Math.max(0.05, fade),
      weight: 0,
      target: 1,
      ended: false,
      interrupted: false,
      opts,
    });
  }

  stop(id?: MotionId, fade?: number): void {
    for (const a of this.actions) {
      if (id && a.id !== id) continue;
      this.interrupt(a, fade !== undefined ? Math.max(0.0001, fade) : a.fadeOut);
    }
  }

  /** Fade an action out early. Its onEnd still fires, once, so callers are never left waiting. */
  private interrupt(a: Action, fadeOut: number): void {
    a.target = 0;
    a.fadeOut = fadeOut;
    if (a.ended) return;
    a.interrupted = true;
    a.ended = true;
    a.opts.onEnd?.();
  }

  seek(t: number): void {
    const a = this.actions[this.actions.length - 1];
    if (!a) return;
    a.t = Math.max(0, t);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = this.paused ? 0 : Math.min(dt, 0.1);
    this.updateActions(step);

    // Locomotion is skipped entirely while full-body actions cover it.
    let cover = 0;
    for (const a of this.actions) if (!a.upper && a.clip) cover = Math.min(1, cover + a.weight);
    this.locomotion(step, cover < 0.999);

    const out = this.out.copy(this.loco);
    for (const a of this.actions) {
      if (!a.clip || a.weight <= 0) continue;
      // a windowed loop wraps itself (updateActions); only a whole-clip loop wraps in sampleClip
      sampleClip(a.clip, a.t, a.loop && !Number.isFinite(a.end), this.tmp);
      out.blend(this.tmp, a.weight, a.upper ? CLAW_JOINTS : undefined);
    }
    this.apply(out);
  }

  dispose(): void {
    this.disposed = true;
    this.actions.length = 0;
    this.onLocomotionEvent = null;
  }

  // ------------------------------------------------------------------ actions
  private updateActions(dt: number): void {
    for (const a of this.actions) {
      if (!a.clip) {
        a.clip = this.lib.get(a.id);
        if (!a.clip) {
          if (this.lib.isMissing(a.id) && !a.ended) {
            a.ended = true;
            a.target = 0;
            a.opts.onEnd?.();
          }
          continue;
        }
      }
      const c = a.clip;
      // a held clip stops at its hold point: the skill clips stand up again after it
      const end = Math.min(c.length, a.end, c.hold && c.holdAt !== undefined ? c.holdAt : Infinity);
      const prev = a.t;
      if (a.target > a.weight) a.weight = Math.min(a.target, a.weight + dt / a.fadeIn);
      else if (a.target < a.weight) a.weight = Math.max(a.target, a.weight - dt / a.fadeOut);
      if (dt <= 0) continue;
      a.t += dt * a.speed;
      const loop = a.loop;
      if (loop && Number.isFinite(a.end)) {
        // windowed loop: once through [start, end), then [loopFrom, end) again and again
        const span = end - a.loopFrom;
        if (a.opts.onEvent && !a.interrupted) {
          crossedEvents(c, prev === a.start ? prev - 1e-6 : prev, Math.min(a.t, end), false, a.opts.onEvent);
        }
        if (span > 1e-3 && a.t >= end) {
          a.t = a.loopFrom + ((a.t - end) % span);
          if (a.opts.onEvent && !a.interrupted) crossedEvents(c, a.loopFrom - 1e-6, a.t, false, a.opts.onEvent);
        } else if (a.t > end) a.t = end;
        continue;
      }
      if (!loop && !c.hold) {
        // start fading back to locomotion so the blend completes as the clip does
        const fadeAt = end - a.fadeOut * a.speed;
        if (a.target > 0 && a.t >= fadeAt) a.target = 0;
      }
      // events from t = 0 inclusive (hit_react's "hit" is its first frame)
      if (a.opts.onEvent && !a.interrupted) {
        crossedEvents(c, prev === a.start ? prev - 1e-6 : prev, Math.min(a.t, end), loop, a.opts.onEvent);
      }
      if (!loop && !a.ended && a.t >= end) {
        a.ended = true;
        if (c.hold) a.t = end;
        a.opts.onEnd?.();
      }
      if (!loop && a.t > end) a.t = end;
    }
    // drop finished layers
    this.actions = this.actions.filter((a) => !(a.target === 0 && a.weight <= 0 && (a.clip || a.ended)));
  }

  // ------------------------------------------------------------------ locomotion
  private locomotion(dt: number, needed: boolean): void {
    const lib = this.lib;
    // smooth the request: gameplay's input is a step, a gait change is not
    const k = 1 - Math.exp(-dt / 0.12);
    this.vel.x += (this.want.x - this.vel.x) * k;
    this.vel.z += (this.want.z - this.vel.z) * k;
    this.vel.yaw += (this.want.yaw - this.vel.yaw) * k;
    this.weights.clear();
    this.idleT += dt;
    if (!needed) return;

    const sum = this.sum;
    sum.reset();
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const ang = Math.atan2(this.vel.x, this.vel.z); // 0 forward, +pi/2 left

    // 1. directional gaits, bilinear in angle, then slow/fast by speed
    const gaits: { clip: LoadedClip; w: number }[] = [];
    if (speed > 1e-3) {
      const sector = (ang + 2 * Math.PI) % (2 * Math.PI);
      const i0 = Math.floor(sector / SECTOR) % DIRECTIONS.length;
      const i1 = (i0 + 1) % DIRECTIONS.length;
      const u = (sector - i0 * SECTOR) / SECTOR;
      for (const [d, w] of [[DIRECTIONS[i0], 1 - u], [DIRECTIONS[i1], u]] as const) {
        if (w <= 1e-4) continue;
        const slow = lib.get(d.slow);
        const fast = d.fast ? lib.get(d.fast) : null;
        if (!slow) continue;
        let f = 0;
        if (fast) {
          const s0 = Math.hypot(slow.velocity[0], slow.velocity[1]);
          const s1 = Math.hypot(fast.velocity[0], fast.velocity[1]);
          f = Math.min(1, Math.max(0, (speed - s0) / Math.max(1e-3, s1 - s0)));
        }
        this.addGait(gaits, slow, w * (1 - f), d.arcs?.slow);
        if (fast) this.addGait(gaits, fast, w * f, d.arcs?.fast);
      }
    }
    let gw = 0;
    let natSpeed = 0;
    let natFreq = 0;
    for (const g of gaits) {
      gw += g.w;
      natSpeed += g.w * Math.hypot(g.clip.velocity[0], g.clip.velocity[1]);
      natFreq += g.w * (g.clip.cycles / g.clip.length);
    }
    if (gw > 0) {
      natSpeed /= gw;
      natFreq /= gw;
    }
    // below ~40% of the slowest gait, fade into idle rather than shuffle in slow motion
    const moving = gw > 0 ? Math.min(1, speed / (0.4 * Math.max(0.05, natSpeed))) : 0;
    const rate = gw > 0 ? Math.min(MAX_RATE, Math.max(MIN_RATE, speed / Math.max(1e-3, natSpeed))) : 1;

    // 2. turning in place
    const turnId: ClipId = this.vel.yaw >= 0 ? 'turn_left' : 'turn_right';
    const turn = Math.abs(this.vel.yaw) > 0.03 ? lib.get(turnId) : null;
    const turnAmount = turn ? Math.min(1, Math.abs(this.vel.yaw) / 0.6) * (1 - moving) : 0;
    const turnRate = turn ? Math.min(MAX_RATE, Math.max(MIN_RATE, Math.abs(this.vel.yaw) / Math.max(0.1, Math.abs(turn.yawRate)))) : 1;
    const turnFreq = turn ? turn.cycles / turn.length : 0;

    // 3. one shared gait phase for everything that steps
    const stepW = moving + turnAmount;
    if (stepW > 0) {
      const f = (moving * natFreq * rate + turnAmount * turnFreq * turnRate) / stepW;
      this.phase += f * dt;
    }
    const idle = lib.get('idle');
    const idleW = Math.max(0, 1 - moving - turnAmount);

    if (idle && idleW > 1e-4) {
      sampleClip(idle, this.idleT, true, this.tmp);
      sum.add(this.tmp, idleW);
      this.weights.set('idle', idleW);
    } else if (idleW > 1e-4) {
      sum.add(this.tmp.setHome(), idleW);
    }
    let lead: LoadedClip | null = null;
    let leadW = 0;
    for (const g of gaits) {
      const w = (g.w / gw) * moving;
      if (w <= 1e-4) continue;
      const t = this.gaitTime(g.clip);
      sampleClip(g.clip, t, true, this.tmp);
      sum.add(this.tmp, w);
      this.weights.set(g.clip.id, w);
      if (w > leadW) {
        leadW = w;
        lead = g.clip;
      }
    }
    if (turn && turnAmount > 1e-4) {
      sampleClip(turn, this.gaitTime(turn), true, this.tmp);
      sum.add(this.tmp, turnAmount);
      this.weights.set(turn.id, turnAmount);
      if (turnAmount > leadW) {
        leadW = turnAmount;
        lead = turn;
      }
    }
    if (!sum.resolve(this.loco)) this.loco.setHome();

    // footsteps from the dominant gait
    if (lead && leadW > 0.3 && this.onLocomotionEvent && dt > 0) {
      const t = this.gaitTime(lead);
      const prev = this.gaitPrev.get(lead.id);
      if (prev !== undefined) {
        const to = t < prev ? t + lead.length : t;
        crossedEvents(lead, prev, to, true, this.onLocomotionEvent);
      }
    }
    this.gaitPrev.clear();
    if (lead) this.gaitPrev.set(lead.id, this.gaitTime(lead));
  }

  /** Add a straight gait, or a share of its arc (walking while turning) when steering. */
  private addGait(gaits: { clip: LoadedClip; w: number }[], clip: LoadedClip, w: number, arcs?: [ClipId, ClipId]) {
    if (w <= 1e-4) return;
    const yaw = this.vel.yaw;
    const arc = arcs && Math.abs(yaw) > 0.03 ? this.lib.get(arcs[yaw > 0 ? 0 : 1]) : null;
    if (!arc) {
      gaits.push({ clip, w });
      return;
    }
    const a = Math.min(1, Math.abs(yaw) / Math.max(0.1, Math.abs(arc.yawRate)));
    if (1 - a > 1e-4) gaits.push({ clip, w: w * (1 - a) });
    gaits.push({ clip: arc, w: w * a });
  }

  /** A gait clip's time for the shared phase: whole cycles map onto the clip's own cycles. */
  private gaitTime(c: LoadedClip): number {
    const cycles = Math.max(1, c.cycles);
    const p = ((this.phase % cycles) + cycles) % cycles;
    return (p / cycles) * c.length;
  }

  // ------------------------------------------------------------------ output
  private apply(p: Pose): void {
    const rig = this.rig;
    rig.setPose(p.q);
    const m = rig.metersToUnits;
    rig.body.position.set(p.pos[0] * m, p.pos[1] * m, p.pos[2] * m);
    rig.body.quaternion.set(p.rot[0], p.rot[1], p.rot[2], p.rot[3]);
  }
}
