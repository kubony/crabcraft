// Procedural stand-in for the motion runtime: sine gait plus simple claw actions.
// Used only until the recorded-policy runtime is wired in through src/motion/provider.ts.
import type { CrabRig } from '../crab/types';
import { JOINT_NAMES } from '../crab/types';
import type { MotionController, MotionId, MotionPlayOptions } from './types';

const ACTION_LEN: Partial<Record<MotionId, number>> = {
  attack_swipe: 0.55, attack_slam: 0.8, cast: 1.0, hit_react: 0.35, death: 1.2, jump: 0.9,
  gesture_hello: 2.2, gesture_bow: 2.4, gesture_salute: 2.0, gesture_paw: 2.0, claw_left: 1.5, claw_right: 1.5,
};

export function createMotionController(rig: CrabRig): MotionController {
  const q = new Float32Array(JOINT_NAMES.length);
  let vx = 0;
  let vz = 0;
  let yawRate = 0;
  let phase = 0;
  let t = 0;
  let action: { id: MotionId; t: number; opts: MotionPlayOptions; firedHit: boolean } | null = null;
  const idx = (n: string) => JOINT_NAMES.indexOf(n as (typeof JOINT_NAMES)[number]);

  return {
    setLocomotion(x, z, w) {
      vx = x;
      vz = z;
      yawRate = w;
    },
    play(id, opts = {}) {
      action = { id, t: 0, opts, firedHit: false };
    },
    stop(id) {
      if (!id || action?.id === id) action = null;
    },
    get action() {
      return action?.id ?? null;
    },
    update(dt) {
      t += dt;
      const speed = Math.hypot(vx, vz) + Math.abs(yawRate) * 0.6;
      phase += dt * (2 + speed * 2.2);
      const amp = Math.min(1, speed / 3);
      q.fill(0);
      // Tripod-ish gait on the four walkers.
      const legs = ['LM', 'RR', 'RM', 'LR'];
      legs.forEach((p, i) => {
        const ph = phase + (i % 2) * Math.PI;
        q[idx(`${p}_J0_joint`)] = Math.sin(ph) * 0.35 * amp;
        q[idx(`${p}_J1_joint`)] = Math.max(0, Math.cos(ph)) * 0.45 * amp;
      });
      // Idle claw breathing.
      for (const s of ['LF', 'RF']) {
        q[idx(`${s}_J1_joint`)] = Math.sin(t * 1.6) * 0.05;
        q[idx(`${s}_J4_joint`)] = (Math.sin(t * 2.3) * 0.5 + 0.5) * 0.15;
      }
      let bodyY = Math.sin(phase * 2) * 0.02 * amp;
      let bodyRoll = 0;
      if (action) {
        action.t += dt * (action.opts.speed ?? 1);
        const len = ACTION_LEN[action.id] ?? 1.2;
        const u = Math.min(1, action.t / len);
        const pulse = Math.sin(u * Math.PI);
        switch (action.id) {
          case 'attack_swipe':
          case 'claw_right':
            q[idx('RF_J0_joint')] = -pulse * 0.9;
            q[idx('RF_J1_joint')] = -pulse * 0.6;
            q[idx('RF_J4_joint')] = pulse;
            break;
          case 'attack_slam':
            q[idx('LF_J1_joint')] = q[idx('RF_J1_joint')] = -pulse * 1.2;
            bodyY -= pulse * 0.08;
            break;
          case 'cast':
            q[idx('LF_J1_joint')] = q[idx('RF_J1_joint')] = -pulse * 0.9;
            q[idx('LF_J4_joint')] = q[idx('RF_J4_joint')] = pulse * 0.6;
            break;
          case 'hit_react':
            bodyY -= pulse * 0.05;
            bodyRoll = pulse * 0.15;
            break;
          case 'death':
            bodyY -= u * 0.35;
            bodyRoll = u * 0.5;
            break;
          case 'jump':
            bodyY += pulse * 0.6;
            break;
          default:
            if (action.id.startsWith('gesture') || action.id.startsWith('dance') || action.id === 'claw_left') {
              q[idx('LF_J1_joint')] = -Math.abs(Math.sin(action.t * 6)) * 0.8;
              q[idx('RF_J1_joint')] = -Math.abs(Math.cos(action.t * 6)) * 0.8;
              bodyY += Math.abs(Math.sin(action.t * 6)) * 0.05;
            }
        }
        if (!action.firedHit && u >= 0.5) {
          action.firedHit = true;
          action.opts.onEvent?.('hit');
        }
        const looping = action.opts.loop || action.id.startsWith('dance');
        if (u >= 1) {
          if (looping) action.t = 0;
          else if (action.id !== 'death') {
            const done = action;
            action = null;
            done.opts.onEnd?.();
          }
        }
      }
      rig.setPose(q);
      rig.body.position.y = 0.55 + bodyY;
      rig.body.rotation.z = bodyRoll;
    },
    dispose() {
      action = null;
    },
  };
}
