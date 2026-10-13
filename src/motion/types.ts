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
  // Keyframed game-only clips (not from a policy):
  | 'attack_swipe' | 'attack_slam' | 'cast' | 'hit_react' | 'death' | 'sit';
