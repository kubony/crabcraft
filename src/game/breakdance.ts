// Plays the breakdance routine (src/motion/breakdance.ts) on one crab: the player's emote, and the
// hero's finale at the ending. Each move is a recorded rollout of a trained Jumper policy; this
// only sequences them, carries each move's travel and turn over to the crab, and says when
// something else has taken the body.
import { getMotionLibrary } from '../motion/library';
import { ROUTINE, routineLength, stepLength, type RoutineStep } from '../motion/breakdance';
import type { Unit } from './unit';

export interface RoutineHooks {
  /** A move starts. */
  onStep?(step: RoutineStep, index: number): void;
  /** A named moment of the playing move's clip passes ('takeoff', 'land', 'hit', 'beat3', ...). */
  onEvent?(name: string, step: RoutineStep): void;
  /** The routine is over: `completed` is false when it was cut short. */
  onEnd?(completed: boolean): void;
}

/** Let the clips stream in before anyone dances (they are 10 to 27 kB each). */
export function preloadRoutine(): Promise<void> {
  return getMotionLibrary().preload(ROUTINE.map((s) => s.id));
}

export class BreakRoutine {
  private index = -1;
  private t = 0;
  private elapsed = 0;
  private running = false;
  /** How the last run ended: null before any, else whether it played to the end. */
  lastCompleted: boolean | null = null;

  constructor(
    readonly unit: Unit,
    private readonly hooks: RoutineHooks = {},
    readonly steps: readonly RoutineStep[] = ROUTINE,
  ) {}

  get active(): boolean {
    return this.running;
  }

  /** The move playing now, or null. */
  get step(): RoutineStep | null {
    return this.running ? this.steps[this.index] ?? null : null;
  }

  get stepIndex(): number {
    return this.running ? this.index : -1;
  }

  /** Seconds since the routine started, and its whole length. */
  get progress(): { t: number; length: number } {
    return { t: this.elapsed, length: routineLength(this.steps) };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.index = -1;
    this.elapsed = 0;
    this.next();
  }

  /** Cut it short: the move playing fades back to standing, its travel carried over. */
  cancel(fade = 0.25): void {
    if (!this.running) return;
    const s = this.steps[this.index];
    if (s) this.unit.motion.stop(s.id, fade);
    this.finish(false);
  }

  update(dt: number): void {
    if (!this.running) return;
    const s = this.steps[this.index];
    const nextStep = this.steps[this.index + 1];
    const len = stepLength(s);
    // Another action on the body (a swing, a jump, a flinch, a death) ends the routine: it has
    // already taken over. So does none at all before the move's own fade-out, which is the move
    // stopped or its clip missing. `t` can trail the motion controller by the frame the routine
    // started in (at most 0.1 s, its longest step), hence the margin.
    const a = this.unit.motion.action;
    if ((a !== null && a !== s.id) || (a === null && this.t < len - s.fade - 0.15)) {
      this.finish(false);
      return;
    }
    this.t += dt;
    this.elapsed += dt;
    if (nextStep) {
      if (this.t >= len - nextStep.fade) this.next(dt);
    } else if (this.t >= len) {
      this.finish(true);
    }
  }

  /**
   * Start the next move. Called from `update` before the motion controller's own update in the
   * same frame, which advances the new action by that frame's `dt`: `t` starts there too.
   */
  private next(dt = 0): void {
    this.index++;
    this.t = dt;
    const s = this.steps[this.index];
    this.unit.act(s.id, {
      from: s.from,
      to: s.to,
      speed: 1,
      fade: s.fade,
      carryRoot: true,
      onEvent: (name) => this.hooks.onEvent?.(name, s),
    });
    this.hooks.onStep?.(s, this.index);
  }

  private finish(completed: boolean): void {
    if (!this.running) return;
    this.running = false;
    this.lastCompleted = completed;
    this.hooks.onEnd?.(completed);
  }
}
