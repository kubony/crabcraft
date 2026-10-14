// Robot Mode's simulation core: MuJoCo (WASM) physics, the bundle's own controller (WASM) and the
// bundle's ONNX policies, stepped exactly the way the robot's board loop steps them.
//
// Environment agnostic on purpose: it runs in the browser's worker and under Node
// (tools/robot-sim-check.ts) from the same file, so everything it needs is handed in already
// loaded. Only `import type` here, which Node's type stripping erases.
//
// One control tick is 5 ms (the fastest mode, locomotion and jump, infers at 200 Hz; the dances,
// gestures and claws at 50 Hz). Per tick, as BUNDLE.md's "The step" prescribes:
//   set_state -> operator input -> tick -> (infer, resume) -> positions/kp/kd
// and then the physics advances 5 ms in substeps of the active mode's own training timestep
// (contract control.sim_dt: 0.001 s for locomotion, 0.0025 s for the jump, 0.005 s otherwise),
// each substep applying the robot's servo law: PD torque clipped to the measured torque-speed
// curve and the thermal peak budget (jumper tasks/jumper/common/actuator.py::ServoCurveActuator).

import type { WebFsmLike, BundleContract, RobotPackage } from './types';

/** Seconds of one controller tick: the fastest mode's period. */
export const TICK_S = 0.005;
const TICK_US = 5000;

export interface SimInit {
  /** The loaded @mujoco/mujoco module (MainModule). */
  mj: any;
  sceneXml: string;
  /** VFS path ('meshes/<file>') to bytes. */
  meshes: Record<string, Uint8Array>;
  pkg: RobotPackage;
  controllerToml: string;
  contracts: Record<string, BundleContract>;
  /** {mode: trajectory text}, for modes whose contract carries a `reference` block. */
  trajectories: Record<string, string>;
  /** wasm-bindgen class from the bundle's runtime/web/controller.js, already initialised. */
  WebFsm: new (config: string, contracts: string, robot: string, nowUs: number, trajectories?: string) => WebFsmLike;
  /** Runs `mode`'s policy (bundle.json modes.<mode>.models.onnx) on one observation. */
  infer: (mode: string, obs: Float32Array) => Promise<Float32Array>;
}

export interface BodyPose {
  name: string;
  id: number;
}

/** Rolling statistics the HUD shows. */
export interface SimStats {
  /** Inferences per simulated second of the active mode, measured over the last second. */
  inferHz: number;
  /** Mean wall-clock ms of one ONNX inference (EMA). */
  inferMs: number;
  /** Mean wall-clock ms of one mj_step including the servo law (EMA). */
  physicsStepMs: number;
  /** Mean wall-clock ms of one whole 5 ms control tick (EMA). */
  tickMs: number;
  /** Physics substeps per tick for the active mode. */
  substeps: number;
  timestep: number;
  ticks: number;
  inferences: number;
}

export class RobotSim {
  readonly mj: any;
  readonly model: any;
  readonly data: any;
  fsm: WebFsmLike;
  readonly wire: string[];
  readonly contracts: Record<string, BundleContract>;
  /** Wire index -> qpos / dof address. */
  private qadr: Int32Array;
  private dadr: Int32Array;
  private readonly nj: number;
  private readonly init: SimInit;
  private readonly robotJson: string;
  private readonly contractsJson: string;
  private readonly trajectoriesJson: string;
  private tickIndex = 0;
  private readonly t0Us = 1_000_000;
  // Per-tick command, wire order.
  private target: Float32Array;
  private kp: Float32Array;
  private kd: Float32Array;
  private tau: Float32Array;
  private thermal: Float64Array;
  private qBuf: Float32Array;
  private qdBuf: Float32Array;
  private quatBuf = new Float32Array(4);
  private gyroBuf = new Float32Array(3);
  private linVelBuf = new Float32Array(3);
  private readonly curve: RobotPackage['actuator']['torqueSpeedCurve'];
  private stepsPerTick = 1;
  private activeDt = 0.005;
  private pendingKeys: { code: string; down: boolean; repeat: boolean }[] = [];
  private pendingLetGo = false;
  private pad: { axes: Record<string, number>; buttons: Record<string, boolean> } | null = null;
  /** Mode name as of the last tick. */
  mode = '';
  runningPolicy = false;
  /** The mode whose inference ran last, and when (sim seconds). */
  lastInferMode = '';
  private inferTimes: number[] = [];
  readonly stats: SimStats = {
    inferHz: 0, inferMs: 0, physicsStepMs: 0, tickMs: 0, substeps: 1, timestep: 0.005, ticks: 0, inferences: 0,
  };
  /** Transitions reported by the controller since the last drain. */
  log: { at: number; from: string; to: string; rule: number; why: string }[] = [];
  readonly bodies: BodyPose[] = [];
  readonly toyBodies: BodyPose[] = [];
  readonly baseBody: number;
  private readonly now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  constructor(init: SimInit) {
    this.init = init;
    const mj = init.mj;
    this.mj = mj;
    const vfs = new mj.MjVFS();
    try {
      for (const [path, bytes] of Object.entries(init.meshes)) vfs.addBuffer(path, bytes);
      this.model = mj.MjModel.from_xml_string(init.sceneXml, vfs);
    } finally {
      vfs.delete();
    }
    this.data = new mj.MjData(this.model);
    this.contracts = init.contracts;
    this.curve = init.pkg.actuator.torqueSpeedCurve;

    const any = Object.values(init.contracts)[0];
    this.wire = [...any.wire_joint_order];
    this.nj = this.wire.length;
    this.qadr = new Int32Array(this.nj);
    this.dadr = new Int32Array(this.nj);
    const jntQ = this.model.jnt_qposadr as Int32Array;
    const jntD = this.model.jnt_dofadr as Int32Array;
    this.wire.forEach((name, i) => {
      const id = mj.mj_name2id(this.model, mj.mjtObj.mjOBJ_JOINT.value, name);
      if (id < 0) throw new Error(`joint ${name} is not in the model`);
      this.qadr[i] = jntQ[id];
      this.dadr[i] = jntD[id];
    });
    this.baseBody = mj.mj_name2id(this.model, mj.mjtObj.mjOBJ_BODY.value, 'base_link');
    for (let b = 1; b < this.model.nbody; b++) {
      const name = mj.mj_id2name(this.model, mj.mjtObj.mjOBJ_BODY.value, b) as string;
      (name.startsWith('toy_') ? this.toyBodies : this.bodies).push({ name, id: b });
    }

    this.target = new Float32Array(this.nj);
    this.kp = new Float32Array(this.nj);
    this.kd = new Float32Array(this.nj);
    this.tau = new Float32Array(this.nj);
    this.thermal = new Float64Array(this.nj);
    this.qBuf = new Float32Array(this.nj);
    this.qdBuf = new Float32Array(this.nj);

    // "What the host supplies" (BUNDLE.md): the stops from the contracts' joint_limits, and
    // the rate tick() is called at.
    const lim = any.joint_limits;
    if (!lim) throw new Error('contract has no joint_limits');
    const robot = {
      joint_names: this.wire,
      joint_pos_lo: this.wire.map((j) => lim[j][0]),
      joint_pos_hi: this.wire.map((j) => lim[j][1]),
      output_rate_hz: 1 / TICK_S,
    };
    this.robotJson = JSON.stringify(robot);
    this.contractsJson = JSON.stringify(init.contracts);
    this.trajectoriesJson = JSON.stringify(init.trajectories);
    this.fsm = this.buildFsm();
    this.reset();
  }

  /** A fresh controller, as the bundle's README builds one. */
  buildFsm(): WebFsmLike {
    return new this.init.WebFsm(
      this.init.controllerToml, this.contractsJson, this.robotJson, this.nowUs(), this.trajectoriesJson,
    );
  }

  nowUs(): number {
    return this.t0Us + this.tickIndex * TICK_US;
  }

  /** Simulated seconds since start. */
  get simTime(): number {
    return this.data.time as number;
  }

  /** Back to the standing keyframe with a fresh controller. */
  reset(): void {
    const mj = this.mj;
    mj.mj_resetDataKeyframe(this.model, this.data, 0);
    mj.mj_forward(this.model, this.data);
    const qpos = this.data.qpos as Float64Array;
    for (let i = 0; i < this.nj; i++) {
      this.target[i] = qpos[this.qadr[i]];
      this.kp[i] = 0;
      this.kd[i] = 0;
      this.tau[i] = 0;
      this.thermal[i] = 0;
    }
    this.fsm.free?.();
    this.fsm = this.buildFsm();
    this.pendingKeys = [];
    this.inferTimes = [];
    this.setTimestep(this.contracts[this.fsm.mode()]?.control.sim_dt ?? 0.005);
  }

  private setTimestep(dt: number): void {
    const n = Math.max(1, Math.round(TICK_S / dt));
    this.activeDt = TICK_S / n;
    this.stepsPerTick = n;
    this.model.opt.timestep = this.activeDt;
    this.stats.substeps = n;
    this.stats.timestep = this.activeDt;
  }

  /** A browser key, both edges, by KeyboardEvent.code. Applied on the next tick. */
  key(code: string, down: boolean, repeat = false): void {
    this.pendingKeys.push({ code, down, repeat });
  }

  /** The page's own Stop (Escape or the Stop button). */
  letGo(): void {
    this.pendingLetGo = true;
  }

  /** A gamepad (or on-screen stick) frame, already deadbanded and rescaled. */
  setPad(pad: { axes: Record<string, number>; buttons: Record<string, boolean> } | null): void {
    this.pad = pad;
  }

  private readState(): void {
    const qpos = this.data.qpos as Float64Array;
    const qvel = this.data.qvel as Float64Array;
    for (let i = 0; i < this.nj; i++) {
      this.qBuf[i] = qpos[this.qadr[i]];
      this.qdBuf[i] = qvel[this.dadr[i]];
    }
    // Free joint: qpos[3:7] is (w, x, y, z); qvel[0:3] world linear, qvel[3:6] body angular.
    const w = qpos[3], x = qpos[4], y = qpos[5], z = qpos[6];
    this.quatBuf[0] = w; this.quatBuf[1] = x; this.quatBuf[2] = y; this.quatBuf[3] = z;
    this.gyroBuf[0] = qvel[3]; this.gyroBuf[1] = qvel[4]; this.gyroBuf[2] = qvel[5];
    // base_lin_vel in the body frame: R^T v.
    const vx = qvel[0], vy = qvel[1], vz = qvel[2];
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    this.linVelBuf[0] = r00 * vx + r10 * vy + r20 * vz;
    this.linVelBuf[1] = r01 * vx + r11 * vy + r21 * vz;
    this.linVelBuf[2] = r02 * vx + r12 * vy + r22 * vz;
  }

  /** One 5 ms control tick: controller, maybe a policy inference, then the physics. */
  async tick(): Promise<void> {
    const t0 = this.now();
    const fsm = this.fsm;
    const now = this.nowUs();
    this.readState();
    fsm.set_state(this.qBuf, this.qdBuf, this.tau, this.quatBuf, this.gyroBuf, now);
    fsm.setSignal('base_lin_vel', this.linVelBuf);
    if (this.pendingLetGo) {
      fsm.letGo(now);
      this.pendingLetGo = false;
    }
    // A key that goes down and up between two ticks would never be seen down: the controller
    // reads key levels once per tick. Hold its release (and everything after it) for a tick.
    const downNow = new Set<string>();
    let n = 0;
    for (; n < this.pendingKeys.length; n++) {
      const k = this.pendingKeys[n];
      if (!k.down && downNow.has(k.code)) break;
      if (k.down) downNow.add(k.code);
      fsm.setKeyCode(k.code, k.down, k.repeat, now);
    }
    this.pendingKeys.splice(0, n);
    if (this.pad) {
      for (const [a, v] of Object.entries(this.pad.axes)) fsm.setAxis(a, v);
      for (const [b, d] of Object.entries(this.pad.buttons)) fsm.setPad(b, d);
      fsm.padFrame(now);
    }
    fsm.set_command(0, 0, 0, now);

    const mode = fsm.tick(now);
    if (mode !== undefined && mode !== null) {
      const obs = fsm.observation();
      const ti = this.now();
      const act = await this.init.infer(mode, obs);
      const ms = this.now() - ti;
      this.stats.inferMs = this.stats.inferences === 0 ? ms : this.stats.inferMs * 0.95 + ms * 0.05;
      this.stats.inferences++;
      fsm.resume(act);
      this.lastInferMode = mode;
      this.inferTimes.push(this.simTime);
    }
    this.target.set(fsm.positions());
    this.kp.set(fsm.kp());
    this.kd.set(fsm.kd());
    const prev = this.mode;
    this.mode = fsm.mode();
    this.runningPolicy = fsm.is_running_policy();
    if (this.mode !== prev) {
      this.setTimestep(this.contracts[this.mode]?.control.sim_dt ?? 0.005);
      this.inferTimes.length = 0;
    }
    const entries = fsm.take_log();
    if (entries.length > 2) this.log.push(...(JSON.parse(entries) as RobotSim['log']));

    const tp = this.now();
    for (let s = 0; s < this.stepsPerTick; s++) this.physicsStep();
    const physMs = (this.now() - tp) / this.stepsPerTick;
    this.stats.physicsStepMs = this.stats.ticks === 0 ? physMs : this.stats.physicsStepMs * 0.98 + physMs * 0.02;

    // Inference rate over the last simulated second.
    const t = this.simTime;
    while (this.inferTimes.length && this.inferTimes[0] < t - 1) this.inferTimes.shift();
    const span = Math.min(1, t - (this.inferTimes[0] ?? t));
    this.stats.inferHz = span > 0.2 ? (this.inferTimes.length - 1) / span : 0;
    this.tickIndex++;
    this.stats.ticks++;
    const tickMs = this.now() - t0;
    this.stats.tickMs = this.stats.ticks === 1 ? tickMs : this.stats.tickMs * 0.98 + tickMs * 0.02;
  }

  /** The servo law for every joint, then one mj_step. */
  private physicsStep(): void {
    const qpos = this.data.qpos as Float64Array;
    const qvel = this.data.qvel as Float64Array;
    const frc = this.data.qfrc_applied as Float64Array;
    const c = this.curve;
    const dt = this.activeDt;
    const heat = dt / c.thermalTimeConstant;
    for (let i = 0; i < this.nj; i++) {
      const q = qpos[this.qadr[i]];
      const qd = qvel[this.dadr[i]];
      let torque = this.kp[i] * (this.target[i] - q) - this.kd[i] * qd;
      const w = Math.abs(qd);
      let limit = w >= c.cutoffSpeed ? 0 : c.plateauTorque * Math.exp(-Math.max(0, w - c.cornerSpeed) / c.decaySpeed);
      // The plateau is a 300 ms peak rating: past the thermal trip point the ceiling is the
      // continuous rating (or the curve, whichever is smaller).
      if (this.thermal[i] >= 1) limit = Math.min(limit, c.continuousTorque);
      if (torque > limit) torque = limit;
      else if (torque < -limit) torque = -limit;
      frc[this.dadr[i]] = torque;
      this.tau[i] = torque;
      const steady = (torque / c.continuousTorque) ** 2;
      const th = this.thermal[i] + (steady - this.thermal[i]) * heat;
      this.thermal[i] = th < 0 ? 0 : th;
    }
    this.mj.mj_step(this.model, this.data);
  }

  /** Wire-order joint angles (radians, MuJoCo qpos convention). */
  jointPositions(out: Float32Array): Float32Array {
    const qpos = this.data.qpos as Float64Array;
    for (let i = 0; i < this.nj; i++) out[i] = qpos[this.qadr[i]];
    return out;
  }

  /** Torques applied in the last substep, wire order. */
  get torques(): Float32Array {
    return this.tau;
  }

  /** Joint targets the controller published, wire order. */
  get targets(): Float32Array {
    return this.target;
  }

  /** Body heights / tilt for a fall check: base z (m) and tilt from upright (rad). */
  baseUpright(): { z: number; tilt: number } {
    const qpos = this.data.qpos as Float64Array;
    const x = qpos[4], y = qpos[5];
    const zz = 1 - 2 * (x * x + y * y); // R[2][2], the body z axis' world z component
    return { z: qpos[2], tilt: Math.acos(Math.max(-1, Math.min(1, zz))) };
  }

  /**
   * Writes every body's world pose (MuJoCo frame) into `out` as [x, y, z, qw, qx, qy, qz] per
   * body, robot bodies first then toys, in the order of `bodies` then `toyBodies`.
   */
  bodyPoses(out: Float32Array): Float32Array {
    // mj_step leaves xpos/xquat at the start of the step and qpos at its end. Recompute the
    // kinematics so the poses are of the same instant as the joint angles sent beside them (a
    // layer posed from qpos and one posed from these poses then agree). The controller reads
    // only qpos/qvel and mj_step recomputes all of this, so the simulation is unchanged.
    this.mj.mj_kinematics(this.model, this.data);
    const xpos = this.data.xpos as Float64Array;
    const xquat = this.data.xquat as Float64Array;
    let o = 0;
    for (const list of [this.bodies, this.toyBodies]) {
      for (const b of list) {
        const p = b.id * 3, q = b.id * 4;
        out[o++] = xpos[p]; out[o++] = xpos[p + 1]; out[o++] = xpos[p + 2];
        out[o++] = xquat[q]; out[o++] = xquat[q + 1]; out[o++] = xquat[q + 2]; out[o++] = xquat[q + 3];
      }
    }
    return out;
  }

  /** Base pose (MuJoCo frame): x, y, z, qw, qx, qy, qz. */
  basePose(out: Float32Array): Float32Array {
    const qpos = this.data.qpos as Float64Array;
    for (let i = 0; i < 7; i++) out[i] = qpos[i];
    return out;
  }

  dispose(): void {
    this.fsm.free?.();
    this.data.delete();
    this.model.delete();
  }
}
