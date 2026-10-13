// Shapes of the Jumper bundle files and the controller's wasm-bindgen API, as Robot Mode reads
// them. The bundle is the authority (BUNDLE.md, fsm/BUNDLE_README.md); these types only cover the
// fields this host reads.

/** The `WebFsm` class exported by the bundle's runtime/web/controller.js (fsm/src/web.rs). */
export interface WebFsmLike {
  set_state(q: Float32Array, qd: Float32Array, tau: Float32Array, quat: Float32Array, gyro: Float32Array, nowUs: number): void;
  set_command(vx: number, vy: number, wz: number, nowUs: number): void;
  tick(nowUs: number): string | undefined;
  take_log(): string;
  observation(): Float32Array;
  resume(action: Float32Array): void;
  positions(): Float32Array;
  kp(): Float32Array;
  kd(): Float32Array;
  setKey(key: string, down: boolean): boolean;
  setKeyCode(code: string, down: boolean, repeat: boolean, nowUs: number): boolean;
  letGo(nowUs: number): boolean;
  takesRawInput(): boolean;
  setSignal(name: string, values: Float32Array): boolean;
  inputs(): string;
  padGuide(): string;
  setAxis(axis: string, value: number): boolean;
  padFrame(nowUs: number): void;
  setPad(button: string, down: boolean): boolean;
  bindings(): string;
  checkReference(text: string): string;
  modes(): string[];
  mode(): string;
  is_running_policy(): boolean;
  free?(): void;
}

export interface BundleContract {
  wire_joint_order: string[];
  obs_joint_order: string[];
  action_joint_order: string[];
  default_joint_pos: Record<string, number>;
  joint_limits?: Record<string, [number, number]>;
  control: { kp: number; kd: number; control_hz: number; sim_dt: number; decimation: number };
  observation: { dim: number; terms: { name: string; dim: number }[] };
  action: { dim: number };
  reference?: { file: string; duration: number; starts_on_entry?: boolean };
  controller?: unknown;
}

export interface BundleJson {
  schema: string;
  runtimes: {
    web: { model: string; glue: string; wasm: string; commit: string; wasmBindgen: string; unverifiedByTheConsumer: string };
    [host: string]: unknown;
  };
  modes: Record<
    string,
    { models: { onnx: string; [fmt: string]: string }; contract: string; observation: number; action: number; trajectory?: string }
  >;
  notes: string[];
  files: Record<string, { bytes: number; sha256: string }>;
  reference: string | null;
  manuals: Record<string, string>;
  built_from?: Record<string, { task: string }>;
}

export interface RobotPackage {
  schema: string;
  model: { file: string; option: Record<string, string> };
  scene: {
    file: string;
    toys: { body: string; kind: 'sphere' | 'box'; size: number[]; rgba: number[] }[];
    props: { name: string; kind: 'box' | 'cylinder'; size: number[]; pos: number[]; yawDeg: number; rgba: number[] }[];
  };
  joints: { name: string; range: [number, number]; home: number }[];
  visualRgba: Record<string, [number, number, number, number]>;
  actuator: {
    stiffness: number;
    damping: number;
    armature: number;
    torqueSpeedCurve: {
      plateauTorque: number;
      cornerSpeed: number;
      decaySpeed: number;
      cutoffSpeed: number;
      continuousTorque: number;
      thermalTimeConstant: number;
    };
  };
  files: Record<string, { bytes: number; sha256: string }>;
}
