// Jumper's calibrated standing pose, from the Jumper repo (tasks/jumper/common/constants.py HOME,
// identical to the bundle contracts' default_joint_pos). JOINT_NAMES order, radians, MuJoCo qpos.
// With the base at STAND_Z every foot pad rests on the ground.
import { JOINT_NAMES, type JointName } from './types';

export const HOME: Record<JointName, number> = {
  LF_J0_joint: -0.5507, LF_J1_joint: -1.0658, LF_J2_joint: -0.4408, LF_J3_joint: -1.374, LF_J4_joint: 0.0,
  RF_J0_joint: 0.5524, RF_J1_joint: -1.066, RF_J2_joint: 0.4414, RF_J3_joint: 1.4173, RF_J4_joint: 0.0,
  LM_J0_joint: 0.0012, LM_J1_joint: 0.5356, LM_J2_joint: -1.8271,
  RM_J0_joint: -0.0012, RM_J1_joint: -0.5376, RM_J2_joint: 1.8313,
  LR_J0_joint: 0.6313, LR_J1_joint: 0.5534, LR_J2_joint: -1.8648,
  RR_J0_joint: -0.6326, RR_J1_joint: -0.5548, RR_J2_joint: 1.8678,
};

/** HOME in JOINT_NAMES order. */
export const HOME_POSE: Float32Array = Float32Array.from(JOINT_NAMES.map((n) => HOME[n]));

/** Base (floating body) height above the ground at HOME, robot metres (bundle base_height). */
export const STAND_Z = 0.10647;
