// Contract between the crab model (src/crab), motion (src/motion), robot mode (src/robot)
// and every screen that shows a crab. Change it only on the integration branch.
import type * as THREE from 'three';

export type RaceId = 'human' | 'orc' | 'dwarf' | 'undead' | 'nightelf' | 'tauren';
export type Sex = 'male' | 'female';
export type ClassId = 'warrior' | 'mage' | 'priest';

/** Everything the character creation screen can change. Indices pick from the race's option lists. */
export interface CrabSpec {
  race: RaceId;
  sex: Sex;
  classId: ClassId;
  /** Shell paint, index into RaceDef.shellColors (oldcraft "Skin Color"). */
  shell: number;
  /** Head piece / crest variant, index into RaceDef.crestStyles (oldcraft "Hair Style"). */
  crest: number;
  /** LED eye colour, index into RaceDef.ledColors (oldcraft "Hair Color"). */
  led: number;
  name: string;
}

/**
 * The 22 actuated joints in the robot's wire order (deploy contracts' wire_joint_order).
 * Front legs are the claws (5 DoF each), the four walking legs have 3 DoF each.
 * Angles are radians, measured exactly as MuJoCo qpos for the MJCF in the Jumper bundle.
 */
export const JOINT_NAMES = [
  'LF_J0_joint', 'LF_J1_joint', 'LF_J2_joint', 'LF_J3_joint', 'LF_J4_joint',
  'RF_J0_joint', 'RF_J1_joint', 'RF_J2_joint', 'RF_J3_joint', 'RF_J4_joint',
  'LM_J0_joint', 'LM_J1_joint', 'LM_J2_joint',
  'RM_J0_joint', 'RM_J1_joint', 'RM_J2_joint',
  'LR_J0_joint', 'LR_J1_joint', 'LR_J2_joint',
  'RR_J0_joint', 'RR_J1_joint', 'RR_J2_joint',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];
// NOTE: if the bundle's wire_joint_order differs from this list, the motion worker fixes this
// constant (single source of truth) and everything else indexes through it.

export type Expression =
  | 'neutral' | 'blink' | 'happy' | 'angry' | 'hurt' | 'dead'
  | 'love' | 'sleepy' | 'surprised' | 'focused' | 'talk';

/** The crab's LED face (the display module behind the black visor). */
export interface CrabFace {
  setExpression(e: Expression, holdSeconds?: number): void;
  /** Overrides the race/spec LED colour, e.g. flashing red on damage. null restores. */
  setTint(color: THREE.ColorRepresentation | null): void;
}

/** Named attachment points in model space, for weapons, spell effects, nameplates, camera. */
export type SocketName =
  | 'head'        // top of upper shell, centred
  | 'face'        // centre of the visor, facing forward
  | 'back'        // rear of upper shell
  | 'clawL' | 'clawR' // inside the left/right pincer, where a held item sits
  | 'nameplate'   // above the head, for UI
  | 'chest';      // front of the body below the visor, for hit effects

/**
 * Frames. MuJoCo (jumper.xml): Z-up, robot forward = +X (display module side), robot left = +Y.
 * Game (three.js): Y-up, crab faces +Z, crab's left = +X. The mapping is a proper rotation:
 *   game.x = mj.y, game.y = mj.z, game.z = mj.x
 * Quaternions map the same way (q_game = R q_mj R^-1). Every converter (GLB build, motion
 * recording, robot mode) must use exactly this mapping.
 */
export const MJ_TO_GAME_AXES = { x: 'y', y: 'z', z: 'x' } as const;

export interface CrabRig {
  /**
   * Add this to the scene. Y-up, the crab faces +Z, units are world units where the standing
   * crab's shell top is at CRAB_HEIGHT (times the race posture scale). Origin is on the ground
   * under the body centre.
   */
  readonly root: THREE.Group;
  /** World units per robot metre for this rig (includes race scale). Motion base offsets use it. */
  readonly metersToUnits: number;
  /** The floating-base body; motion moves this for bob/tilt, gameplay moves root. */
  readonly body: THREE.Object3D;
  readonly spec: Readonly<CrabSpec>;
  readonly face: CrabFace;
  /** Rotate one joint to an absolute angle (radians, MuJoCo qpos convention). */
  setJoint(name: JointName, angle: number): void;
  /** All 22 joints at once, in JOINT_NAMES order. */
  setPose(q: ArrayLike<number>): void;
  getSocket(name: SocketName): THREE.Object3D;
  /** Swap race/sex/class/options in place (character creation). Keeps the current pose. */
  applySpec(spec: CrabSpec): Promise<void>;
  /** Per-frame update for face animation, idle shimmer, undead flicker etc. */
  update(dt: number): void;
  /**
   * Optional level of detail: 0 full, 1 far (a simplified body, small gear hidden). Callers
   * pick the level from the crab's size on screen; rigs without LOD ignore it.
   */
  setLod?(level: number): void;
  dispose(): void;
}

/** Shell-top height of a standing crab in world units. Buildings and doors are sized from it. */
export const CRAB_HEIGHT = 1.0;
