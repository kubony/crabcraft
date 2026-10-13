// Forward kinematics of recorded clips on the harness rig, against MuJoCo's own FK of the
// rollout state at the same instants (tools/motion/fk_check.py writes scratch/fk_expected.json).
import * as THREE from 'three';
import type { MotionLibrary } from '../../src/motion';
import type { ClipId } from '../../src/motion/library';
import type { ViewerRig } from './viewerRig';

interface Expected {
  clips: { id: ClipId; frames: { k: number; bodies: Record<string, [number, number, number]> }[] }[];
}

export async function runFkCheck(rig: ViewerRig, lib: MotionLibrary) {
  const exp = (await (await fetch('/scratch/fk_expected.json')).json()) as Expected;
  const m = rig.metersToUnits;
  const saved = { pos: rig.root.position.clone(), rot: rig.root.quaternion.clone() };
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  const v = new THREE.Vector3();
  const report: Record<string, { frames: number; maxMm: number; meanMm: number }> = {};
  let worst = 0;
  for (const c of exp.clips) {
    const clip = await lib.load(c.id);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (const f of c.frames) {
      rig.setPose(clip.q.subarray(f.k * 22, f.k * 22 + 22));
      const b = clip.base.subarray(f.k * 7, f.k * 7 + 7);
      rig.body.position.set(b[0] * m, b[1] * m, b[2] * m);
      rig.body.quaternion.set(b[3], b[4], b[5], b[6]);
      for (const [name, p] of Object.entries(f.bodies)) {
        rig.bodyWorld(name, v).multiplyScalar(1 / m);
        const e = Math.hypot(v.x - p[0], v.y - p[1], v.z - p[2]) * 1000;
        max = Math.max(max, e);
        sum += e;
        n++;
      }
    }
    report[c.id] = { frames: c.frames.length, maxMm: +max.toFixed(3), meanMm: +(sum / n).toFixed(3) };
    worst = Math.max(worst, max);
  }
  rig.root.position.copy(saved.pos);
  rig.root.quaternion.copy(saved.rot);
  const out = { worstMm: +worst.toFixed(3), clips: report };
  console.warn(`[fk] ${JSON.stringify(out)}`);
  return out;
}
