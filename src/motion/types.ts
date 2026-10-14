// Contract for motion clips recorded from the real Jumper policies (public/motions/*).
import type { JointName } from '../crab/types';

/**
 * One recorded rollout of a Jumper policy in MuJoCo, resampled to `fps`.
 * Stored as public/motions/<id>.json (header) + optional <id>.bin (Float32 little-endian frames)
 * as the motion worker decides; MotionLibrary hides the storage format.
 */
export interface MotionClip {
  id: MotionId;
  /** Which bundle mode / policy produced it, e.g. "locomotion", "dance_crab". */
  source: string;
  fps: number;
  frameCount: number;
  loop: boolean;
  /** Joint order of each frame's q block. Normally JOINT_NAMES. */
  joints: readonly JointName[];
  /** frameCount * joints.length joint angles, radians, MuJoCo qpos convention. */
  q: Float32Array;
  /**
   * frameCount * 7 floating-base poses in game axes (see MJ_TO_GAME_AXES; Y-up, crab faces +Z
   * at frame 0): x, y, z in robot metres (the player multiplies by CrabRig.metersToUnits),
   * then qx, qy, qz, qw. y is the base height above the ground.
   */
  base: Float32Array;
  /** Mean planar speed over the clip, robot metres per second, for locomotion blending. */
  speed?: number;
  /** Optional named moments, seconds: footfalls, "hit" frame of a claw strike, dance beats. */
  events?: Record<string, number[]>;
}

/** Clip ids the game asks for. The motion worker records at least these. */
export type MotionId =
  | 'idle'
  | 'walk_fwd' | 'walk_fast' | 'walk_back' | 'strafe_left' | 'strafe_right'
  | 'turn_left' | 'turn_right'
  | 'jump'
  | 'claw_left' | 'claw_right'
  | 'gesture_hello' | 'gesture_bow' | 'gesture_salute' | 'gesture_paw'
  | 'dance_crab' | 'dance_brazilian' | 'dance_dream_wings' | 'dance_maze'
  // The six skills, jumper.skill_* (swipe, slam, cast, flinch, power-down, sit): trained for this
  // game and recorded through the crabcraft bundle. Play them through src/motion/skills.ts, which
  // cuts each to its move (from/to) at its pace.
  | 'attack_swipe' | 'attack_slam' | 'cast' | 'hit_react' | 'death' | 'sit';

/**
 * What gameplay drives. The integration branch adapts the motion runtime to this interface
 * (src/motion/provider.ts), so gameplay never depends on the runtime's internals.
 */
export interface MotionPlayOptions {
  loop?: boolean;
  /** Crossfade seconds. */
  fade?: number;
  /** Playback rate. */
  speed?: number;
  /** Only the claws (LF/RF joints) play the clip; the legs keep walking. */
  upperBodyOnly?: boolean;
  /**
   * Play only part of the clip, in clip seconds. Recorded policy rollouts carry lead-in and
   * recovery around the move itself (the jump takes off 1.08 s into its clip).
   */
  from?: number;
  to?: number;
  /**
   * With `loop` and `to`: play from `from` once, then repeat [loopFrom, to) (the cast's channel,
   * whose two ends are one pose). Defaults to `from`.
   */
  loopFrom?: number;
  /** Named clip events ("hit", "grab", "footstep") as they pass. */
  onEvent?: (name: string) => void;
  onEnd?: () => void;
}

export interface MotionController {
  /**
   * Desired locomotion in the crab's local frame, world units per second:
   * vx = toward the crab's left (+X), vz = forward (+Z); yawRate in rad/s (positive = turn left).
   * Zero velocity settles into idle.
   */
  setLocomotion(vx: number, vz: number, yawRate: number): void;
  play(id: MotionId, opts?: MotionPlayOptions): void;
  /** Stop a playing action (or all actions) and return to locomotion/idle. */
  stop(id?: MotionId, fade?: number): void;
  /** The full-body or upper-body action currently playing, if any. */
  readonly action: MotionId | null;
  /** Poses the rig for this frame. Does not call rig.update (gameplay does). */
  update(dt: number): void;
  dispose(): void;
}

export type CreateMotionController = (rig: import('../crab/types').CrabRig) => MotionController;
