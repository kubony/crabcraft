// Race posture as body offsets plus a constant joint bias.
//
// The posture group under CrabRig.body is lowered/raised by (bodyHeight - 1) * STAND_Z and pitched
// nose-down by `hunch`; the legs then get a per-joint bias (added to every angle set through
// setJoint/setPose) that puts each foot back on its HOME footprint, widened by stanceWidth.
// Motion clips keep playing on top: they set raw angles, the rig adds the bias. The bias is solved
// once per posture with damped least squares on the rig's own forward kinematics.
import * as THREE from 'three';
import { HOME } from './pose';
import type { CrabTemplate } from './template';
import { JOINT_NAMES, type JointName } from './types';

export interface Posture {
  scale: number;
  bodyHeight: number;
  stanceWidth: number;
  hunch: number;
  /** Extra hand-set bias (radians) on top of the solved one, e.g. orc claws held low. */
  extra?: Partial<Record<JointName, number>>;
}

/** Nose-down pitch (radians) for hunch = 1. */
export const HUNCH_PITCH = 0.42;

const LEGS: { prefix: string; effector: string; joints: JointName[] }[] = [
  { prefix: 'LF', effector: 'LF_palm_pad_b_link', joints: ['LF_J0_joint', 'LF_J1_joint', 'LF_J2_joint', 'LF_J3_joint'] },
  { prefix: 'RF', effector: 'RF_palm_pad_b_link', joints: ['RF_J0_joint', 'RF_J1_joint', 'RF_J2_joint', 'RF_J3_joint'] },
  { prefix: 'LM', effector: 'LM_foot_tip_link', joints: ['LM_J0_joint', 'LM_J1_joint', 'LM_J2_joint'] },
  { prefix: 'RM', effector: 'RM_foot_tip_link', joints: ['RM_J0_joint', 'RM_J1_joint', 'RM_J2_joint'] },
  { prefix: 'LR', effector: 'LR_foot_tip_link', joints: ['LR_J0_joint', 'LR_J1_joint', 'LR_J2_joint'] },
  { prefix: 'RR', effector: 'RR_foot_tip_link', joints: ['RR_J0_joint', 'RR_J1_joint', 'RR_J2_joint'] },
];

/** Forward kinematics on the template: world position (robot metres) of one link. */
export function linkPosition(
  t: CrabTemplate,
  q: Record<string, number>,
  link: number,
  base: THREE.Matrix4,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.setFromMatrixPosition(linkMatrix(t, q, link, base, new THREE.Matrix4()));
}

/** Forward kinematics on the template: world frame of one link. */
export function linkMatrix(
  t: CrabTemplate,
  q: Record<string, number>,
  link: number,
  base: THREE.Matrix4,
  m: THREE.Matrix4,
): THREE.Matrix4 {
  const chain: number[] = [];
  for (let i = link; i >= 0; i = t.links[i].parent) chain.push(i);
  m.copy(base);
  const step = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  for (let k = chain.length - 1; k >= 0; k--) {
    const l = t.links[chain[k]];
    if (l.parent >= 0) {
      step.makeTranslation(l.offset.x, l.offset.y, l.offset.z);
      m.multiply(step);
    }
    if (l.axis && l.joint) {
      rot.makeRotationAxis(l.axis, q[l.joint] ?? 0);
      m.multiply(rot);
    }
  }
  return m;
}

const biasCache = new Map<string, Float32Array>();

/** Joint bias in JOINT_NAMES order for a posture (cached). */
export function solvePostureBias(t: CrabTemplate, p: Posture): Float32Array {
  const key = `${p.bodyHeight}:${p.stanceWidth}:${p.hunch}:${JSON.stringify(p.extra ?? {})}`;
  const hit = biasCache.get(key);
  if (hit) return hit;
  const bias = new Float32Array(JOINT_NAMES.length);
  const standZ = t.info.standZ;
  const homeBase = new THREE.Matrix4().makeTranslation(0, standZ, 0);
  const newBase = new THREE.Matrix4()
    .makeTranslation(0, standZ * p.bodyHeight, 0)
    .multiply(new THREE.Matrix4().makeRotationX(p.hunch * HUNCH_PITCH));
  const q: Record<string, number> = { ...HOME };
  for (const [j, v] of Object.entries(p.extra ?? {})) q[j] = (q[j] ?? 0) + (v ?? 0);
  const cur = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const neutral = p.bodyHeight === 1 && p.stanceWidth === 1 && p.hunch === 0;
  if (!neutral) {
    for (const leg of LEGS) {
      const eff = t.linkByName.get(leg.effector)!.index;
      const home = linkPosition(t, HOME, eff, homeBase, new THREE.Vector3());
      const target = new THREE.Vector3(home.x * p.stanceWidth, home.y, home.z * (1 + (p.stanceWidth - 1) * 0.35));
      for (let it = 0; it < 40; it++) {
        linkPosition(t, q, eff, newBase, cur);
        const err = tmp.subVectors(target, cur);
        if (err.length() < 2e-5) break;
        // numeric Jacobian, 3 x n
        const n = leg.joints.length;
        const J: number[][] = [[], [], []];
        for (let k = 0; k < n; k++) {
          const j = leg.joints[k];
          const save = q[j];
          q[j] = save + 1e-4;
          const d = linkPosition(t, q, eff, newBase, new THREE.Vector3()).sub(cur).multiplyScalar(1e4);
          q[j] = save;
          J[0][k] = d.x;
          J[1][k] = d.y;
          J[2][k] = d.z;
        }
        // dq = J^T (J J^T + l^2 I)^-1 e
        const lam = 0.02;
        const A = new THREE.Matrix3();
        const a: number[] = [];
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++) {
            let s = r === c ? lam * lam : 0;
            for (let k = 0; k < n; k++) s += J[r][k] * J[c][k];
            a.push(s);
          }
        A.set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
        A.invert();
        const y = err.clone().applyMatrix3(A);
        for (let k = 0; k < n; k++) {
          const j = leg.joints[k];
          const l = t.links[t.jointLinks[JOINT_NAMES.indexOf(j)]];
          const dq = J[0][k] * y.x + J[1][k] * y.y + J[2][k] * y.z;
          q[j] = THREE.MathUtils.clamp(q[j] + THREE.MathUtils.clamp(dq, -0.2, 0.2), l.lower, l.upper);
        }
      }
    }
  }
  JOINT_NAMES.forEach((j, i) => (bias[i] = q[j] - HOME[j]));
  biasCache.set(key, bias);
  return bias;
}
