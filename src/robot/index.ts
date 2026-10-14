// Robot Mode: Jumper's real policies running live in the browser.
//
// A worker runs MuJoCo WASM, the bundle's own controller wasm and its ONNX policies at the
// robot's control rate (src/robot/sim/); this page renders the result on a sunny tabletop and
// hands the person's keys, buttons and gamepad to the controller, which decides what they mean.
import * as THREE from 'three';
import { ToneMappingMode } from 'postprocessing';
import { Engine, type ViewOptions } from '../core/engine';
import { capture } from '../capture/clock';
import { initAssets } from '../core/assets';
import { JOINT_NAMES, type ClassId, type CrabSpec, type RaceId, type Sex } from '../crab/types';
import { CLASS_ORDER } from '../data/classes';
import { RACES, RACE_ORDER } from '../data/races';
import { randomName } from '../screens/create/names';
import { SimClient } from './client';
import { Hud, type CrabPick } from './hud';
import type { FrameMsg, FrameStats, ReadyInfo } from './protocol';
import type { RobotPackage } from './sim/types';
import { AppearanceLayer, type Appearance } from './view/appearance';
import { Arena } from './view/arena';
import { CrabRigView, type AlignmentSample } from './view/crabRigView';
import { mjPosToGame, mjQuatToGame } from './view/frames';
import { OrbitFollow } from './view/orbit';
import { StlRobotView, type FaceExpr, type RobotViewLayer } from './view/robotView';

export type { RobotViewLayer, RobotRenderFrame } from './view/robotView';
export type { ReadyInfo, FrameStats } from './protocol';
export type { Appearance } from './view/appearance';
export type { AlignmentSample } from './view/crabRigView';

/** Modes of the Jumper bundle. Others a future bundle adds still work by name. */
export type RobotModeName =
  | 'locomotion' | 'jump'
  | 'dance_crab' | 'dance_brazilian' | 'dance_maze' | 'dance_dream_wings'
  | 'gesture_hello' | 'gesture_bow' | 'gesture_paw' | 'gesture_salute'
  | 'claw_left' | 'claw_right';

export interface RobotModeOptions {
  /** Share the app's renderer. Without one, Robot Mode makes its own in `container`. */
  engine?: Engine;
  /** URL of the folder holding bundle/ and jumper/ (default `<BASE_URL>robot/`). */
  baseUrl?: string;
  /** Show the HUD (default true). */
  hud?: boolean;
  /** Shows a Back to Title button that calls this. */
  onBack?: () => void;
  /** Listen to the keyboard on `window` (default true). */
  keyboard?: boolean;
  /** Read a connected gamepad (default true). */
  gamepad?: boolean;
  /** The player's crab (character creation). Robot Mode can wear it instead of the bare robot. */
  spec?: CrabSpec | null;
  /** First appearance (default: the player's crab when `spec` is set, else the bare robot). */
  appearance?: Appearance;
}

/** The robot's state for one frame, in game axes (Y-up, the crab faces +Z, left +X). */
export interface RobotState {
  simTime: number;
  mode: string;
  /** False while the controller ramps to a mode's home pose or holds in `safe`. */
  runningPolicy: boolean;
  /** Floating base: position in robot metres (y = height of the body origin), orientation. */
  base: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  /** 22 joint angles, radians, MuJoCo qpos convention, in JOINT_NAMES order. */
  q: Float32Array;
}

export interface RobotModeHandle {
  readonly info: ReadyInfo;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Ask for a mode the way a person does: through the bundle's own binding for it. */
  requestMode(mode: RobotModeName | string): boolean;
  /** Back to walking: ends a dance or gesture early, or toggles a claw off. */
  release(): void;
  /** The page's own Stop: the operator lets go of every held control. */
  letGo(): void;
  /** Stand the robot back up at the start, with a fresh controller. */
  reset(): void;
  setPaused(paused: boolean): void;
  /** Simulation speed, 0.05 to 2 (1 is real time). */
  setSpeed(speed: number): void;
  /** Hand a key to the controller as if typed (KeyboardEvent.code). */
  key(code: string, down: boolean): void;
  /** Latest state; null until the first frame. */
  getState(): RobotState | null;
  /** Latest loop measurements: control rate, inference and physics ms, sim/real ratio. */
  getStats(): FrameStats | null;
  /** Called on every rendered frame with the latest state. */
  onState(fn: (s: RobotState) => void): () => void;
  /** Swap how the robot is drawn for a custom layer (setAppearance brings the built-in one back). */
  setViewLayer(layer: RobotViewLayer): void;
  /** Bare robot or a geared crab, on the same live simulation (dresses the crab if needed). */
  setAppearance(kind: Appearance): Promise<void>;
  readonly appearance: Appearance;
  /** Dresses the crab layer as `spec` (and shows it). */
  wearCrab(spec: CrabSpec): Promise<void>;
  /** X-ray: the physics robot drawn as a hologram over the crab. */
  setXray(on: boolean): void;
  /** Debug: how far the crab's links are from the physics bodies this frame (null when bare). */
  measureAlignment(): AlignmentSample | null;
  stop(): void;
}

/** A variable, not a literal: Vite would otherwise treat `new URL('../robot/', ...)` as an import. */
const ROBOT_DIR_FROM_ASSETS = ['..', 'robot', ''].join('/');

/** Page-level aliases: Q and E turn, as in the game, on the bundle's own turn keys. */
const KEY_ALIAS: Record<string, string> = { KeyQ: 'KeyJ', KeyE: 'KeyL' };

const EXPRESSION: Record<string, FaceExpr> = {
  locomotion: 'neutral',
  jump: 'focused',
  dance_crab: 'happy',
  dance_brazilian: 'happy',
  dance_maze: 'happy',
  dance_dream_wings: 'love',
  gesture_hello: 'happy',
  gesture_bow: 'sleepy',
  gesture_paw: 'love',
  gesture_salute: 'focused',
  claw_left: 'focused',
  claw_right: 'focused',
  safe: 'dead',
};

export async function startRobotMode(container: HTMLElement, opts: RobotModeOptions = {}): Promise<RobotModeHandle> {
  // public/robot/ sits beside the app's assets/ folder in a build (base './' makes BASE_URL
  // relative, which would resolve against nested pages such as dev/robot.html).
  const base =
    opts.baseUrl ??
    (import.meta.env.DEV
      ? new URL(`${import.meta.env.BASE_URL}robot/`, location.href).href
      : new URL(ROBOT_DIR_FROM_ASSETS, import.meta.url).href);
  const ownEngine = !opts.engine;
  const engine = opts.engine ?? new Engine(container, 'high');
  // The crab layer loads its model and gear through the shared glTF loader.
  initAssets(engine.renderer);
  const disposers: (() => void)[] = [];
  let slow = false;
  const toggleFollow = (): boolean => {
    orbit.setFollow(!orbit.follow);
    return orbit.follow;
  };
  const hud = opts.hud === false ? null : new Hud(container, {
    request: (m) => handle.requestMode(m),
    release: () => handle.release(),
    reset: () => handle.reset(),
    toggleFollow,
    toggleSlow: () => {
      slow = !slow;
      client.send({ type: 'speed', value: slow ? 0.25 : 1 });
      return slow;
    },
    appearance: (kind) => void handle.setAppearance(kind),
    pickCrab: (p) => void handle.wearCrab(pickSpec(p)),
    toggleXray: () => {
      handle.setXray(!layer.xrayOn);
      return layer.xrayOn;
    },
    back: opts.onBack,
  });
  if (ownEngine) engine.start();
  if (import.meta.env.DEV) (window as unknown as { __robotEngine: Engine }).__robotEngine = engine;

  const client = new SimClient(base);
  client.onProgress = (p) => {
    // After the worker is up, the remaining policies stream in the background.
    if (!client.info) hud?.progress(p.loaded, p.total, p.label);
  };

  // Appearance: the player's crab when there is one. Without one the bare robot starts, and the
  // HUD offers a race and class picker (or a random crab) to dress it.
  const ownSpec = opts.spec ?? null;
  let crabSpec: CrabSpec | null = ownSpec;
  let wanted: Appearance = opts.appearance ?? (ownSpec ? 'crab' : 'bare');
  if (wanted === 'crab' && !crabSpec) crabSpec = randomSpec();
  let crabLoading = false;
  let crabTicket = 0;
  // Starts with the robot's own download; a failure only costs the crab, never Robot Mode.
  const firstCrab = wanted === 'crab' && crabSpec ? CrabRigView.create(crabSpec).catch((err: unknown) => err) : null;
  crabLoading = !!firstCrab;

  let info: ReadyInfo;
  let pkg: RobotPackage;
  let robot: RobotViewLayer;
  let layer: AppearanceLayer;
  let arena: Arena;
  try {
    pkg = (await (await fetch(new URL('jumper/robot-package.json', base))).json()) as RobotPackage;
    // The page's own assets load beside the worker's boot, not after it.
    arena = new Arena(engine.renderer, pkg);
    const [i, view] = await Promise.all([
      client.ready,
      StlRobotView.load(new URL('jumper/visual.glb', base).href, pkg.visualRgba),
      arena.upgrade(base),
    ]);
    info = i;
    layer = new AppearanceLayer(view);
    robot = layer;
  } catch (err) {
    hud?.error(err instanceof Error ? err.message : String(err));
    client.stop();
    throw err;
  }

  // Wire order is the bundle's; the contract's JOINT_NAMES is the game's. Pair them by name.
  const toContract = JOINT_NAMES.map((n) => info.joints.indexOf(n));
  if (toContract.some((i) => i < 0)) throw new Error('bundle wire order does not cover JOINT_NAMES');

  const scene = arena.scene;
  scene.add(robot.object);
  const orbit = new OrbitFollow(engine.canvas, window.innerWidth / window.innerHeight);
  const camera = orbit.camera;

  /** Shows a dressed crab once its shaders are built, so the switch never stalls a frame. */
  const installCrab = async (view: CrabRigView, ticket: number): Promise<boolean> => {
    try {
      await engine.renderer.compileAsync(view.object, camera, scene);
    } catch {
      /* compiles on first draw instead */
    }
    if (ticket !== crabTicket || stopped) {
      view.dispose();
      return false;
    }
    layer.setCrab(view);
    return true;
  };
  const appearanceState = () => ({
    kind: wanted,
    spec: crabSpec,
    own: !!ownSpec && crabSpec === ownSpec,
    loading: crabLoading,
    xray: layer.xrayOn,
  });
  const syncHud = () => hud?.setAppearance(appearanceState());
  /** The HUD picker (shown when there is no saved crab): a race, a class, or a random roll. */
  const pickSpec = (p: CrabPick): CrabSpec => {
    if (p.random) return randomSpec();
    const cur = crabSpec && crabSpec !== ownSpec ? crabSpec : randomSpec();
    if (p.race && p.race !== cur.race) {
      // A new race shows that race's defaults: first paint, crest and LED colour.
      return { ...cur, race: p.race, shell: 0, crest: 0, led: 0, name: randomName(p.race, cur.sex, cur.name), classId: p.classId ?? cur.classId };
    }
    return { ...cur, classId: p.classId ?? cur.classId };
  };
  let stopped = false;
  const view: ViewOptions = {
    bloom: { intensity: 0.85, threshold: 0.92, radius: 0.7 },
    dof: { focusDistance: 0.8, focusRange: 0.22, bokehScale: 5.5 },
    exposure: 1.3,
    toneMapping: ToneMappingMode.ACES_FILMIC,
    vignette: { offset: 0.28, darkness: 0.62 },
    // No saturation/contrast here: the engine applies them before AgX tone mapping, where they
    // push saturated reds below zero and AgX's log turns those pixels into NaN (black holes).
  };
  engine.setView(scene, camera, view);
  // The x-ray hologram's shader, built now so the first switch flash does not stall a frame.
  void engine.renderer.compileAsync(layer.object, camera, scene).catch(() => undefined);
  hud?.ready(info);
  syncHud();
  if (firstCrab) {
    const ticket = ++crabTicket;
    void firstCrab.then(async (v) => {
      if (v instanceof CrabRigView) {
        if (await installCrab(v, ticket)) layer.show(wanted);
      } else {
        console.warn('Robot Mode: the crab could not be dressed, showing the bare robot', v);
        if (ticket === crabTicket) wanted = 'bare';
      }
      if (ticket === crabTicket) crabLoading = false;
      syncHud();
    });
  }
  client.onPolicy = (mode, ok, checked, mismatched) => hud?.policyReady(mode, ok, checked, mismatched);
  for (const [mode, p] of client.policies) hud?.policyReady(mode, p.ok, p.checked, p.mismatched);
  client.onFault = (message) => hud?.fault(message);

  // ---------- Per-frame state ----------

  let state: RobotState | null = null;
  const stateListeners = new Set<(s: RobotState) => void>();
  const basePos = new THREE.Vector3();
  const baseQuat = new THREE.Quaternion();
  const prevPos = new THREE.Vector3();
  let speed = 0;
  let snapped = false;
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const focusAt = new THREE.Vector3();

  const toState = (f: FrameMsg): RobotState => {
    const q = new Float32Array(JOINT_NAMES.length);
    for (let i = 0; i < q.length; i++) q[i] = f.q[toContract[i]];
    const bi = info.bodies.indexOf('base_link') * 7;
    const p = f.poses;
    return {
      simTime: f.simTime,
      mode: f.mode,
      runningPolicy: f.running,
      base: {
        position: mjPosToGame(new THREE.Vector3(), p[bi], p[bi + 1], p[bi + 2]),
        quaternion: mjQuatToGame(new THREE.Quaternion(), p[bi + 3], p[bi + 4], p[bi + 5], p[bi + 6]),
      },
      q,
    };
  };

  const allBodies = [...info.bodies, ...info.toys];
  let lastFrame: FrameMsg | null = null;
  let lastExpr: FaceExpr | null = null;
  let safeSince: number | null = null;
  let lastSim = 0;
  const renderFrame = (f: FrameMsg) => ({
    bodies: info.bodies, poses: f.poses, q: f.q, joints: info.joints, mode: f.mode, running: f.running, simTime: f.simTime,
  });
  const offFrame = engine.onFrame(({ dt }) => {
    const f = client.frame;
    if (!f) return;
    if (opts.gamepad !== false) pollPad();
    // The bundle has no get-up policy: a robot that tipped past the tilt limit sits in `safe`,
    // damping only, for good. Stand it back up after a moment, as a person would.
    if (f.mode === 'safe') {
      safeSince ??= performance.now();
      if (performance.now() - safeSince > 3000) {
        safeSince = null;
        handle.reset();
      }
    } else safeSince = null;
    state = toState(f);
    basePos.copy(state.base.position);
    baseQuat.copy(state.base.quaternion);
    fwd.set(0, 0, 1).applyQuaternion(baseQuat);
    const yaw = Math.atan2(fwd.x, fwd.z);
    if (!snapped) {
      orbit.snap(basePos, yaw);
      prevPos.copy(basePos);
      snapped = true;
    }
    if (f !== lastFrame) {
      const dts = f.simTime - lastSim;
      if (dts > 0 && dts < 0.5) {
        const v = Math.hypot(basePos.x - prevPos.x, basePos.z - prevPos.z) / dts;
        speed += (v - speed) * Math.min(1, dts * 6);
      }
      prevPos.copy(basePos);
      lastSim = f.simTime;
      lastFrame = f;
    }
    const expr: FaceExpr = f.running ? (EXPRESSION[f.mode] ?? 'neutral') : f.mode === 'safe' ? 'dead' : 'neutral';
    if (expr !== lastExpr) {
      lastExpr = expr;
      robot.setExpression?.(expr);
    }
    robot.update(renderFrame(f), dt);
    arena.update(allBodies, f.poses.subarray(0), basePos, camera);
    // Toys follow the robot bodies in the pose array.
    orbit.update(dt, basePos, yaw, speed);
    // Focus on the robot itself, not on the camera's eased target: walking at 0.75 m/s that
    // target trails the body by about 15 cm, past the 22 cm focus range, and blurs the robot.
    focusAt.set(basePos.x, basePos.y * 0.6 + 0.02, basePos.z);
    engine.setFocus(camera.position.distanceTo(focusAt), 0.22);
    up.set(0, 1, 0).applyQuaternion(baseQuat);
    hud?.update(f, { speed, height: basePos.y, tilt: THREE.MathUtils.radToDeg(Math.acos(Math.min(1, up.y))) }, dt);
    for (const fn of stateListeners) fn(state);
  });
  disposers.push(offFrame);

  // ---------- Input ----------

  const held = new Set<string>();
  const bundleKeys = new Set<string>(Object.values(info.keyCodes));
  const bound = new Set<string>([...Object.values(info.keyCodes), 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...Object.keys(KEY_ALIAS)]);
  const typing = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (down && !e.repeat) {
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) return handle.reset();
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) return void hud?.setFollow(toggleFollow());
      // T: bare robot or your crab, unless a future bundle binds T itself.
      if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !bundleKeys.has('KeyT')) {
        return void handle.setAppearance(wanted === 'crab' ? 'bare' : 'crab');
      }
    }
    const code = KEY_ALIAS[e.code] ?? e.code;
    orbit.poke();
    if (bound.has(e.code) || (e.ctrlKey && /^(Digit|Numpad)\d$/.test(e.code))) e.preventDefault();
    if (down) held.add(code);
    else held.delete(code);
    if (code === 'Escape' && down) client.send({ type: 'letGo' });
    client.key(code, down, e.repeat);
  };
  const kd = onKey(true);
  const ku = onKey(false);
  const blur = () => {
    for (const c of held) client.key(c, false);
    held.clear();
    client.send({ type: 'letGo' });
  };
  if (opts.keyboard !== false) {
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    disposers.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }

  // Gamepad: the robot's pad service names, a 0.15 deadband applied and rescaled (BUNDLE.md).
  const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', null, null, null, 'menu', 'L3', 'R3', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'home'];
  let padWasConnected = false;
  const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : (Math.sign(v) * (Math.abs(v) - 0.15)) / 0.85);
  function pollPad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find((p) => p && p.connected && p.mapping === 'standard');
    if (!gp) {
      if (padWasConnected) client.pad(null);
      padWasConnected = false;
      return;
    }
    padWasConnected = true;
    const buttons: Record<string, boolean> = {};
    PAD_BUTTONS.forEach((n, i) => {
      if (n && gp.buttons[i]) buttons[n] = gp.buttons[i].pressed;
    });
    client.pad({
      axes: {
        Lx: dead(gp.axes[0] ?? 0), Ly: dead(gp.axes[1] ?? 0), Rx: dead(gp.axes[2] ?? 0), Ry: dead(gp.axes[3] ?? 0),
        LT: gp.buttons[6]?.value ?? 0, RT: gp.buttons[7]?.value ?? 0,
      },
      buttons,
    });
  }

  // A press of the bundle's binding for `mode`, as the keyboard would make it.
  const codeOf = (name: string): string | undefined =>
    info.keyCodes[name] ?? info.keyCodes[`key_left_${name}`] ?? undefined;
  const tapBinding = (key: string, modifier: string | null): boolean => {
    const code = codeOf(key);
    const mod = modifier ? codeOf(modifier) : undefined;
    if (!code || (modifier && !mod)) return false;
    if (mod) client.key(mod, true);
    client.key(code, true);
    setTimeout(() => {
      client.key(code, false);
      if (mod) client.key(mod, false);
    }, 120);
    return true;
  };

  const handle: RobotModeHandle = {
    info,
    scene,
    camera,
    requestMode(mode) {
      const current = client.frame?.mode ?? info.initialMode;
      if (mode === 'locomotion') {
        handle.release();
        return true;
      }
      const b = info.bindings.find((x) => x.name === mode && x.key && (!x.from || x.from.includes(current)));
      if (!b) return false;
      return tapBinding(b.key!, b.with);
    },
    release() {
      const current = client.frame?.mode ?? '';
      // A claw is a toggle: its own key switches it off. Recorded motions leave on leave_motion.
      const own = info.bindings.find((x) => x.name === current && x.key && x.on === 'toggle' && current.startsWith('claw'));
      if (own) {
        tapBinding(own.key!, own.with);
        return;
      }
      const leave = info.bindings.find((x) => x.leaves && x.key && (!x.from || x.from.includes(current)));
      if (leave) tapBinding(leave.key!, leave.with);
    },
    letGo() {
      client.send({ type: 'letGo' });
    },
    reset() {
      client.send({ type: 'reset' });
      snapped = false;
    },
    setPaused(p) {
      client.send({ type: 'pause', paused: p });
    },
    setSpeed(s) {
      client.send({ type: 'speed', value: s });
    },
    key(code, down) {
      client.key(code, down);
    },
    getState: () => state,
    getStats: () => client.frame?.stats ?? null,
    onState(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    setViewLayer(custom) {
      scene.remove(robot.object);
      if (robot !== layer) robot.dispose();
      robot = custom;
      lastExpr = null;
      scene.add(robot.object);
    },
    async setAppearance(kind) {
      if (robot !== layer) handle.setViewLayer(layer);
      wanted = kind;
      if (kind === 'bare') {
        layer.show('bare');
        syncHud();
        return;
      }
      if (!crabSpec) crabSpec = randomSpec();
      if (!layer.crab && !crabLoading) return handle.wearCrab(crabSpec);
      layer.show('crab');
      syncHud();
    },
    get appearance() {
      return wanted;
    },
    async wearCrab(spec) {
      if (robot !== layer) handle.setViewLayer(layer);
      const ticket = ++crabTicket;
      crabSpec = spec;
      wanted = 'crab';
      crabLoading = true;
      syncHud();
      try {
        const v = await CrabRigView.create(spec);
        if (await installCrab(v, ticket)) layer.show(wanted);
      } catch (err) {
        console.warn('Robot Mode: the crab could not be dressed', err);
        if (ticket === crabTicket && !layer.crab) wanted = 'bare';
      } finally {
        if (ticket === crabTicket) crabLoading = false;
        syncHud();
      }
    },
    setXray(on) {
      layer.setXray(on);
      syncHud();
    },
    measureAlignment() {
      const f = client.frame;
      const c = layer.crab;
      if (!f || !c || wanted !== 'crab') return null;
      return c.measure(renderFrame(f));
    },
    stop() {
      stopped = true;
      for (const d of disposers.splice(0)) d();
      client.stop();
      orbit.dispose();
      if (robot !== layer) robot.dispose();
      layer.dispose();
      arena.dispose();
      hud?.dispose();
      if (ownEngine) {
        engine.stop();
        engine.canvas.remove();
        engine.renderer.dispose();
      }
    },
  };
  // Capture mode (dev only): the trailer script frames its own shots and shows or hides the HUD.
  if (capture) (window as unknown as { __robotMode: unknown }).__robotMode = { handle, orbit, hud, layer, engine, client };
  return handle;
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

/** A crab from the races and classes of character creation, every option rolled. */
function randomSpec(race: RaceId = pick(RACE_ORDER), classId: ClassId = pick(CLASS_ORDER)): CrabSpec {
  const r = RACES[race];
  const sex: Sex = Math.random() < 0.5 ? 'male' : 'female';
  return {
    race,
    sex,
    classId,
    shell: Math.floor(Math.random() * r.shellColors.length),
    crest: Math.floor(Math.random() * r.crestStyles.length),
    led: Math.floor(Math.random() * r.ledColors.length),
    name: randomName(race, sex),
  };
}
