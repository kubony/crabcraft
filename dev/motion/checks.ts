// Numbers for the motion harness: runtime cost for a crowd, and foot slip while walking.
import * as THREE from 'three';
import { JOINT_NAMES, type CrabRig, type JointName, type SocketName } from '../../src/crab/types';
import { createMotionController, type MotionLibrary } from '../../src/motion';
import type { MotionId } from '../../src/motion/types';
import type { ViewerRig } from './viewerRig';

/** A rig with the real joint count and transforms but no meshes: isolates the motion cost. */
function bareRig(): CrabRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const joints = JOINT_NAMES.map(() => {
    const o = new THREE.Object3D();
    body.add(o);
    return o;
  });
  const axis = new THREE.Vector3(0, 0, 1);
  return {
    root,
    body,
    metersToUnits: 6.4,
    spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'bench' },
    face: { setExpression: () => undefined, setTint: () => undefined },
    setJoint: (n: JointName, a: number) => joints[JOINT_NAMES.indexOf(n)].quaternion.setFromAxisAngle(axis, a),
    setPose: (q: ArrayLike<number>) => {
      for (let i = 0; i < joints.length; i++) joints[i].quaternion.setFromAxisAngle(axis, q[i]);
    },
    getSocket: (_n: SocketName) => body,
    applySpec: async () => undefined,
    update: () => undefined,
    dispose: () => undefined,
  };
}

export async function runBench(lib: MotionLibrary, crabs = 25, frames = 600) {
  await lib.preload();
  const extra: MotionId[] = ['cast', 'attack_swipe', 'dance_crab', 'gesture_hello', 'jump', 'hit_react'];
  await lib.preload(extra);
  const ctrls = Array.from({ length: crabs }, (_, i) => {
    const c = createMotionController(bareRig(), lib);
    const a = (i / crabs) * Math.PI * 2;
    c.setLocomotion(Math.sin(a) * 2.5, Math.cos(a) * 2.5, i % 3 === 0 ? 0.6 : 0);
    if (i % 4 === 0) c.play(extra[i % extra.length], { loop: true, upperBodyOnly: i % 8 === 0 });
    return c;
  });
  const dt = 1 / 60;
  for (let f = 0; f < 30; f++) for (const c of ctrls) c.update(dt); // warm up the JIT
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < ctrls.length; i++) {
      if (f % 90 === i % 90 && i % 4 === 1) ctrls[i].play('hit_react', { fade: 0.08 });
      ctrls[i].update(dt);
    }
  }
  const ms = performance.now() - t0;
  const out = { crabs, frames, msPerFrameAllCrabs: +(ms / frames).toFixed(4), usPerCrabUpdate: +((ms / frames / crabs) * 1000).toFixed(2) };
  console.warn(`[bench] ${JSON.stringify(out)}`);
  return out;
}

const FEET = ['LF_palm_pad_b_link', 'RF_palm_pad_b_link', 'LM_foot_tip_link', 'RM_foot_tip_link', 'LR_foot_tip_link', 'RR_foot_tip_link'];

/**
 * Drive the harness rig like gameplay (root moved at the playing velocity) and measure how far
 * feet travel horizontally while they are down. Robot millimetres per second of stance.
 */
export function runSlide(rig: ViewerRig, motion: ReturnType<typeof createMotionController>, cmd: [number, number, number], seconds = 3) {
  const m = rig.metersToUnits;
  const dt = 1 / 60;
  motion.setLocomotion(cmd[0] * m, cmd[1] * m, cmd[2]);
  let yaw = 0;
  const step = () => {
    motion.update(dt);
    const v = motion.velocity;
    yaw += v.yaw * dt;
    rig.root.rotation.y = yaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    rig.root.position.x += (c * v.x + s * v.z) * dt;
    rig.root.position.z += (-s * v.x + c * v.z) * dt;
    rig.root.updateWorldMatrix(true, true);
  };
  for (let t = 0; t < 1.5; t += dt) step(); // reach the gait
  const prev = FEET.map((f) => rig.bodyWorld(f).clone());
  const low = Math.min(...prev.map((p) => p.y)) / m;
  let slip = 0;
  let stance = 0;
  let bodyPath = 0;
  const bodyPrev = rig.root.position.clone();
  for (let t = 0; t < seconds; t += dt) {
    step();
    FEET.forEach((f, i) => {
      const p = rig.bodyWorld(f);
      const down = p.y / m < low + 0.004 && prev[i].y / m < low + 0.004;
      if (down) {
        slip += Math.hypot(p.x - prev[i].x, p.z - prev[i].z) / m;
        stance += dt;
      }
      prev[i].copy(p);
    });
    bodyPath += rig.root.position.distanceTo(bodyPrev) / m;
    bodyPrev.copy(rig.root.position);
  }
  const out = {
    cmd,
    bodySpeedMps: +(bodyPath / seconds).toFixed(3),
    stanceSlipMmPerS: +((slip / Math.max(1e-6, stance)) * 1000).toFixed(1),
    weights: Object.fromEntries([...motion.weights].map(([k, w]) => [k, +w.toFixed(2)])),
  };
  console.warn(`[slide] ${JSON.stringify(out)}`);
  return out;
}
