// Messages between Robot Mode's page and its simulation worker.

export interface PadFrame {
  axes: Record<string, number>;
  buttons: Record<string, boolean>;
}

export type ToWorker =
  | { type: 'init'; baseUrl: string; mujocoWasmUrl: string; ortWasmUrl: string }
  | { type: 'key'; code: string; down: boolean; repeat: boolean }
  | { type: 'letGo' }
  | { type: 'pad'; pad: PadFrame | null }
  | { type: 'reset' }
  | { type: 'speed'; value: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'stop' }
  /** Capture mode (dev only): stop the real-time loop; the page then steps the sim with `advance`. */
  | { type: 'capture'; on: boolean }
  /** Capture mode: tick until sim time reaches `to`, post a frame, then `advanced`. `now` is the page's clock, ms. */
  | { type: 'advance'; to: number; now: number; id: number };

export interface Binding {
  name: string;
  pad: string | null;
  key: string | null;
  on: string;
  with: string | null;
  from: string[] | null;
  leaves: string[] | null;
}

export interface ReadyInfo {
  modes: string[];
  initialMode: string;
  /** Robot body names in the order of the frames' pose blocks, then the toys. */
  bodies: string[];
  toys: string[];
  /** JOINT_NAMES order as the bundle's wire_joint_order gives it. */
  joints: string[];
  jointRanges: [number, number][];
  bindings: Binding[];
  /** Dictionary key name -> KeyboardEvent.code, for every key the controller reads. */
  keyCodes: Record<string, string>;
  /** Each mode's control_hz from its contract. */
  controlHz: Record<string, number>;
  /** Duration of each recorded motion, s. */
  motionDuration: Record<string, number>;
  web: { commit: string; wasmBindgen: string; unverifiedByTheConsumer: string };
  notes: string[];
  reference: { frames: number; inferences: number; observation: number; target: number; modeMismatches: number } | null;
  /** Worst |act - onnxruntime-web(obs)| over reference.json's inferences. */
  actDiff: number | null;
  digests: { checked: number; mismatched: string[] } | null;
  downloadBytes: number;
  /** Modes whose policy is loaded at ready; the rest arrive as `policy` messages. */
  policiesReady: string[];
  /** Bytes of the policies still streaming in after ready. */
  policyBytes: number;
  loadMs: number;
  mujocoVersion: string;
  ortVersion: string;
}

export interface FrameStats {
  inferHz: number;
  inferMs: number;
  physicsStepMs: number;
  tickMs: number;
  substeps: number;
  timestep: number;
  /** Simulated seconds per real second over the last second. */
  ratio: number;
  /** Ticks per real second over the last second. */
  ticksPerSec: number;
}

export interface FrameMsg {
  type: 'frame';
  simTime: number;
  mode: string;
  running: boolean;
  /** 7 floats per body (MuJoCo frame): x y z qw qx qy qz, robot bodies then toys. */
  poses: Float32Array;
  /** Wire-order joint angles, targets and applied torques. */
  q: Float32Array;
  target: Float32Array;
  tau: Float32Array;
  stats: FrameStats;
  transitions: { from: string; to: string; why: string }[];
  /** The host pressed a mode's own switch for the person (core.ts AUTO_LEAVE_S): which mode, how long
   * after its handover, and the key codes it pressed. */
  autoLeft: { mode: string; after: number; keys: string[] }[];
  /** Remaining seconds of a recorded motion, if one is playing. */
  motionLeft: number | null;
}

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number; label: string }
  | { type: 'ready'; info: ReadyInfo }
  | FrameMsg
  | { type: 'error'; message: string }
  | { type: 'advanced'; id: number; simTime: number }
  | { type: 'policy'; mode: string; ok: boolean; error?: string; digests: { checked: number; mismatched: string[] } };
