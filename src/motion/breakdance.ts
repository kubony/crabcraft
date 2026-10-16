// The breakdance routine: toprock, six-step, spin, 720 jump spin, back flip, one-claw freeze. Every
// move is a trained Jumper policy recorded in MuJoCo (src/motion/breakClips.ts says which and how):
// the routine plays each clip's window in turn at the policy's own pace, crossfading from the
// robot standing at the end of one move to the robot standing at the start of the next, and
// carries each move's travel and turn over to the crab (MotionPlayOptions.carryRoot), so the
// six-step that ends 14 degrees short of a full turn and the 720, which has turned 763 degrees by
// its landing, leave the crab facing where the policy left the robot, and the next move starts there.
import { BREAK_CLIPS } from './breakClips';
import type { MotionId } from './types';

export type BreakId = keyof typeof BREAK_CLIPS;

export interface RoutineStep {
  id: BreakId & MotionId;
  /** What the crowd and the captions call it. */
  label: string;
  /** Clip seconds: the window BREAK_CLIPS gives it. */
  from: number;
  to: number;
  /**
   * Seconds the crossfade into this move takes; the previous move is cut that much early. The
   * same for every move: a move fades out over its own `fade` when its window runs out, so a
   * shorter one after it would leave a moment of fading toward standing in between.
   */
  fade: number;
}

const step = (id: BreakId & MotionId, label: string, fade = 0.25): RoutineStep => ({
  id,
  label,
  from: BREAK_CLIPS[id].from,
  to: BREAK_CLIPS[id].to,
  fade,
});

/** The routine, in order. The claw stand (break_clawstand) is recorded but not in it. */
export const ROUTINE: readonly RoutineStep[] = [
  step('break_toprock', 'Toprock'),
  step('break_sixstep', 'Six-step'),
  step('break_spin', 'Spin'),
  step('break_jumpspin', '720'),
  step('break_backflip', 'Back flip'),
  step('break_oneclaw', 'One-claw freeze'),
];

/** Seconds a step plays for, crossfade included. */
export function stepLength(s: RoutineStep): number {
  return Math.max(0, s.to - s.from);
}

/** The routine's length in seconds, each crossfade counted once. */
export function routineLength(steps: readonly RoutineStep[] = ROUTINE): number {
  return steps.reduce((sum, s, i) => sum + stepLength(s) - (i > 0 ? s.fade : 0), 0);
}

/** A clip moment of a step, in seconds from the step's own start (null when it has none). */
export function stepMoment(s: RoutineStep, event: string): number | null {
  const t = (BREAK_CLIPS[s.id].events as Record<string, number>)[event];
  return t === undefined ? null : t - s.from;
}
