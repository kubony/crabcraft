/// <reference lib="webworker" />
// Robot Mode's simulation worker: loads the Jumper bundle the way a browser host must
// (fsm/BUNDLE_README.md), builds MuJoCo, the controller and one onnxruntime-web session per
// policy, then runs the control loop against a sim-time vs real-time governor, decoupled from
// rendering. The page gets ~120 pose frames a second.
import loadMujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { RobotSim, TICK_S } from './core';
import { LiveRoutine } from './routine';
import type { BundleContract, BundleJson, RobotPackage, WebFsmLike } from './types';
import type { FromWorker, ReadyInfo, ToWorker, FrameMsg } from '../protocol';

declare const self: DedicatedWorkerGlobalScope;

const post = (m: FromWorker, transfer: Transferable[] = []): void => self.postMessage(m, transfer);

let sim: RobotSim | null = null;
let speed = 1;
let paused = false;
let stopped = false;
/** Capture mode (dev only): the page steps the sim in lockstep with its frames. */
let capture = false;
/** The loop iteration in flight, so an `advance` never ticks the sim at the same time. */
let inFlight: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      boot(m.baseUrl, m.mujocoWasmUrl, m.ortWasmUrl).catch((err: unknown) => {
        post({ type: 'error', message: err instanceof Error ? `${err.message}` : String(err) });
      });
      break;
    case 'key':
      sim?.key(m.code, m.down, m.repeat);
      break;
    case 'letGo':
      sim?.letGo();
      break;
    case 'routine':
      if (!sim) break;
      if (m.on) {
        if (sim.routine?.state !== 'running') sim.startRoutine(new LiveRoutine());
      } else sim.stopRoutine(m.why ?? 'stopped');
      break;
    case 'pad':
      sim?.setPad(m.pad);
      break;
    case 'reset':
      sim?.reset();
      rebase();
      break;
    case 'speed':
      speed = Math.max(0.05, Math.min(2, m.value));
      rebase();
      break;
    case 'pause':
      paused = m.paused;
      rebase();
      break;
    case 'capture':
      capture = m.on;
      if (!capture) {
        rebase();
        void loop();
      }
      break;
    case 'advance':
      void advanceTo(m.to, m.now, m.id);
      break;
    case 'stop':
      stopped = true;
      sim?.dispose();
      sim = null;
      self.close();
      break;
  }
};

// ---------- Loading ----------

interface Loader {
  total: number;
  loaded: number;
}

async function fetchBytes(url: string, label: string, l: Loader): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    l.loaded += value.byteLength;
    const t = performance.now();
    if (t - lastPost > 50) {
      lastPost = t;
      post({ type: 'progress', loaded: l.loaded, total: Math.max(l.total, l.loaded), label });
    }
  }
  if (len && got !== len && !res.headers.get('content-encoding')) {
    // A short read is a broken download, not a smaller file.
    throw new Error(`${label}: got ${got} of ${len} bytes`);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);

async function sha256(bytes: Uint8Array): Promise<string | null> {
  if (!self.crypto?.subtle) return null;
  const d = await self.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function boot(baseUrl: string, mujocoWasmUrl: string, ortWasmUrl: string): Promise<void> {
  const t0 = performance.now();
  const bundleBase = new URL('bundle/', baseUrl);
  const robotBase = new URL('jumper/', baseUrl);
  const l: Loader = { total: 0, loaded: 0 };

  // 1. The manifest. Refuse a schema we do not know (BUNDLE.md, "What every consumer has to do").
  const bundleJson = JSON.parse(text(await fetchBytes(new URL('bundle.json', bundleBase).href, 'bundle.json', l))) as BundleJson;
  if (bundleJson.schema !== 'kk-policy-bundle/1') throw new Error(`unknown bundle schema "${bundleJson.schema}"`);
  const web = bundleJson.runtimes.web;
  if (!web || web.model !== 'onnx') throw new Error('this bundle carries no web runtime');
  const pkg = JSON.parse(text(await fetchBytes(new URL('robot-package.json', robotBase).href, 'robot package', l))) as RobotPackage;

  // Everything the page is about to download, for the progress bar.
  const wanted = new Set<string>(['controller.toml', 'reference.json', web.glue, web.wasm]);
  for (const m of Object.values(bundleJson.modes)) {
    wanted.add(m.contract);
    wanted.add(m.models.onnx);
    if (m.trajectory) wanted.add(m.trajectory);
  }
  // The policies stream in after the robot is up, except the one it starts in.
  const startModel = (m: string | undefined) => (m && bundleJson.modes[m] ? bundleJson.modes[m].models.onnx : null);
  const later = new Set([...wanted].filter((f) => f.startsWith('models/')));
  const bundleBytes = [...wanted].filter((f) => !later.has(f)).reduce((s, f) => s + (bundleJson.files[f]?.bytes ?? 0), 0);
  const robotBytes = Object.entries(pkg.files).reduce((s, [f, v]) => (f === 'model.xml' || f === 'visual.glb' ? s : s + v.bytes), 0);
  l.total = bundleBytes + robotBytes + 10_117_577 + 14_239_897; // + MuJoCo and ORT wasm
  post({ type: 'progress', loaded: l.loaded, total: l.total, label: 'bundle.json' });

  const files: Record<string, Uint8Array> = {};
  const get = async (f: string, label = f) => {
    files[f] = await fetchBytes(new URL(f, bundleBase).href, label, l);
    return files[f];
  };

  // 2. Engines: MuJoCo WASM and onnxruntime-web, in parallel with the bundle.
  const mujocoP = fetchBytes(mujocoWasmUrl, 'MuJoCo 3.11 WASM', l).then((wasmBinary) =>
    loadMujoco({ wasmBinary: wasmBinary.buffer, locateFile: (p: string) => (p.endsWith('.wasm') ? mujocoWasmUrl : p) } as never),
  );
  const ortP = fetchBytes(ortWasmUrl, 'onnxruntime-web WASM', l).then((bin) => {
    ort.env.wasm.wasmBinary = bin;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
  });

  // 3. The bundle: FSM, contracts, recordings, controller, models.
  const contracts: Record<string, BundleContract> = {};
  const trajectories: Record<string, string> = {};
  const [tomlBytes] = await Promise.all([
    get('controller.toml'),
    ...Object.entries(bundleJson.modes).map(async ([mode, entry]) => {
      const c = JSON.parse(text(await get(entry.contract))) as BundleContract;
      contracts[mode] = c;
      // A reference-guided mode is not runnable without its recording.
      if (c.reference) trajectories[mode] = text(await get(c.reference.file));
    }),
  ]);
  const referenceText = text(await get('reference.json'));
  const glueUrl = new URL(web.glue, bundleBase).href;
  const wasmBytes = await get(web.wasm, 'controller.wasm');
  const glue = (await import(/* @vite-ignore */ glueUrl)) as {
    default: (o: { module_or_path: BufferSource }) => Promise<unknown>;
    WebFsm: new (...a: never[]) => WebFsmLike;
  };
  await glue.default({ module_or_path: wasmBytes as BufferSource });

  // Meshes for the physics (collision geometry only).
  const meshes: Record<string, Uint8Array> = {};
  const sceneXml = text(await fetchBytes(new URL(pkg.scene.file, robotBase).href, 'scene.xml', l));
  await Promise.all(
    Object.keys(pkg.files)
      .filter((f) => f.startsWith('meshes/'))
      .map(async (f) => {
        meshes[f] = await fetchBytes(new URL(f, robotBase).href, 'collision meshes', l);
      }),
  );

  await ortP;
  // Policies. The mode the cascade starts in (warm_start_ref, else initial_state) is loaded before
  // the robot wakes; the others stream in behind it. Each is held to bundle.json's SHA-256 before
  // its session is built.
  const toml = text(tomlBytes);
  const field = (k: string) => toml.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
  const startMode = [field('warm_start_ref'), field('initial_state')].find((m) => m && bundleJson.modes[m]) ?? Object.keys(bundleJson.modes)[0];
  const firstFile = startModel(startMode)!;
  let policyBytes = 0;
  for (const f of later) if (f !== firstFile) policyBytes += bundleJson.files[f]?.bytes ?? 0;
  l.total += bundleJson.files[firstFile]?.bytes ?? 0;
  const digestState = { checked: 0, mismatched: [] as string[] };
  const verify = async (f: string, bytes: Uint8Array) => {
    const want = bundleJson.files[f]?.sha256;
    const got = want ? await sha256(bytes) : null;
    if (want && got !== null) {
      digestState.checked++;
      if (got !== want) {
        digestState.mismatched.push(f);
        throw new Error(`${f} does not match its SHA-256 in bundle.json`);
      }
    }
    return bytes;
  };
  const byFile = new Map<string, Promise<ort.InferenceSession>>();
  const sessionFor = (f: string) => {
    if (!byFile.has(f)) {
      byFile.set(
        f,
        get(f, `policy ${f.replace('models/', '')}`)
          .then((b) => verify(f, b))
          .then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })),
      );
    }
    return byFile.get(f)!;
  };
  const sessionP: Record<string, Promise<ort.InferenceSession>> = {};
  await sessionFor(firstFile);
  let restStarted = false;
  const startRest = () => {
    if (restStarted) return;
    restStarted = true;
    for (const [mode, entry] of Object.entries(bundleJson.modes)) {
      sessionP[mode] = sessionFor(entry.models.onnx);
      sessionP[mode].then(
        () => post({ type: 'policy', mode, ok: true, digests: { ...digestState, mismatched: [...digestState.mismatched] } }),
        (err: unknown) => post({ type: 'policy', mode, ok: false, error: String(err), digests: { ...digestState, mismatched: [...digestState.mismatched] } }),
      );
    }
  };
  for (const [mode, entry] of Object.entries(bundleJson.modes)) if (entry.models.onnx === firstFile) sessionP[mode] = sessionFor(firstFile);
  const mj = await mujocoP;

  // 4. Digests: bundle.json lists every file's SHA-256 and no host checks them; this one does.
  let digests: ReadyInfo['digests'] = null;
  if (self.crypto?.subtle) {
    for (const [f, bytes] of Object.entries(files)) {
      if (f.startsWith('models/')) continue; // checked as each arrives
      const want = bundleJson.files[f]?.sha256;
      if (!want) continue;
      const got = await sha256(bytes);
      digestState.checked++;
      if (got !== want) digestState.mismatched.push(f);
    }
    digests = { ...digestState, mismatched: [...digestState.mismatched] };
    if (digestState.mismatched.length) {
      throw new Error(`bundle files do not match bundle.json digests: ${digestState.mismatched.join(', ')}`);
    }
  }

  const run = async (mode: string, obs: Float32Array): Promise<Float32Array> => {
    // A mode asked for before its policy has arrived waits for it (the switch-in ramp usually
    // covers the download); the governor turns the wait into a pause, not a time jump.
    const p = sessionP[mode] ?? (startRest(), sessionP[mode]);
    if (!p) throw new Error(`no policy for mode ${mode}`);
    const s = await p;
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', obs, [1, obs.length]) });
    return out[s.outputNames[0]].data as Float32Array;
  };

  const s = new RobotSim({
    mj,
    sceneXml,
    meshes,
    pkg,
    controllerToml: toml,
    contracts,
    trajectories,
    WebFsm: glue.WebFsm as never,
    infer: run,
  });

  // 5. Replay reference.json on a fresh controller, then hold the inference backend against the
  // recorded actions separately (BUNDLE.md "Replaying it").
  let reference: ReadyInfo['reference'] = null;
  let actDiff: number | null = null;
  try {
    const checker = s.buildFsm();
    const r = JSON.parse(checker.checkReference(referenceText)) as {
      frames: number; inferences: number; observation: number; target: number; modeMismatches: unknown[];
    };
    checker.free?.();
    reference = { frames: r.frames, inferences: r.inferences, observation: r.observation, target: r.target, modeMismatches: r.modeMismatches.length };
    const ref = JSON.parse(referenceText) as { frames: { infer?: string; obs?: number[]; act?: number[] }[] };
    actDiff = 0;
    for (const f of ref.frames) {
      if (!f.infer || !f.obs || !f.act) continue;
      const a = await run(f.infer, Float32Array.from(f.obs));
      for (let i = 0; i < a.length; i++) actDiff = Math.max(actDiff, Math.abs(a[i] - f.act[i]));
    }
  } catch (err) {
    console.warn('reference replay failed', err);
  }

  const inputs = JSON.parse(s.fsm.inputs()) as { keys: { name: string; code: [string, string] | string | null }[] };
  const keyCodes: Record<string, string> = {};
  for (const k of inputs.keys) {
    const code = Array.isArray(k.code) ? k.code[0] : k.code;
    if (code) keyCodes[k.name] = code;
  }
  const wire = s.wire;
  const lim = Object.values(contracts)[0].joint_limits!;
  const info: ReadyInfo = {
    modes: s.fsm.modes(),
    initialMode: s.fsm.mode(),
    bodies: s.bodies.map((b) => b.name),
    toys: s.toyBodies.map((b) => b.name),
    joints: wire,
    jointRanges: wire.map((j) => lim[j]),
    bindings: JSON.parse(s.fsm.bindings()),
    keyCodes,
    controlHz: Object.fromEntries(Object.entries(contracts).map(([m, c]) => [m, c.control.control_hz])),
    motionDuration: Object.fromEntries(
      Object.entries(contracts).filter(([, c]) => c.reference).map(([m, c]) => [m, c.reference!.duration]),
    ),
    web: { commit: web.commit, wasmBindgen: web.wasmBindgen, unverifiedByTheConsumer: web.unverifiedByTheConsumer },
    notes: bundleJson.notes,
    reference,
    actDiff,
    digests,
    downloadBytes: l.loaded,
    policiesReady: [],
    policyBytes: 0,
    loadMs: performance.now() - t0,
    mujocoVersion: '3.11.0',
    ortVersion: ort.env.versions.web ?? '1.30.0',
  };
  info.policiesReady = Object.keys(sessionP);
  info.policyBytes = policyBytes;
  sim = s;
  post({ type: 'ready', info });
  startRest();
  rebase();
  loop();
}

// ---------- The loop ----------

let realAnchor = 0;
let simAnchor = 0;
let lastPost = 0;
const ratioWindow: { real: number; sim: number; ticks: number }[] = [];
let ticksTotal = 0;
let motionStart: { mode: string; at: number } | null = null;
let lastMode = '';

function rebase(): void {
  realAnchor = performance.now();
  simAnchor = sim ? sim.simTime : 0;
}

function loop(): Promise<void> {
  if (stopped || !sim || capture) return Promise.resolve();
  inFlight = runLoop(sim);
  return inFlight;
}

async function runLoop(s: RobotSim): Promise<void> {
  const budgetEnd = performance.now() + 10;
  if (!paused) {
    const targetSim = simAnchor + ((performance.now() - realAnchor) / 1000) * speed;
    while (s.simTime + TICK_S * 0.5 < targetSim && performance.now() < budgetEnd) {
      try {
        await s.tick();
      } catch (err) {
        // A policy that failed to load or run: say so and stand the robot back up rather than
        // leave the loop dead.
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        s.reset();
        rebase();
        break;
      }
      noteTick(s);
    }
    // More than 100 ms behind: the machine cannot keep up at this speed. Drop the debt rather
    // than spiral; the ratio below shows it as slow motion.
    if (targetSim - s.simTime > 0.1) rebase();
  } else {
    rebase();
  }
  const now = performance.now();
  ratioWindow.push({ real: now, sim: s.simTime, ticks: ticksTotal });
  while (ratioWindow.length > 2 && ratioWindow[0].real < now - 1000) ratioWindow.shift();
  if (now - lastPost >= 7) {
    lastPost = now;
    postFrame(s);
  }
  const ahead = (s.simTime - (simAnchor + ((performance.now() - realAnchor) / 1000) * speed)) * 1000 / speed;
  setTimeout(loop, paused ? 30 : Math.max(0, Math.min(8, ahead)));
}

function noteTick(s: RobotSim): void {
  ticksTotal++;
  if (s.mode !== lastMode) {
    lastMode = s.mode;
    motionStart = null;
  }
  if (s.runningPolicy && !motionStart && s.contracts[s.mode]?.reference) motionStart = { mode: s.mode, at: s.simTime };
}

/** Capture mode: tick to `to` sim seconds, then post the frame. `now` (the page's clock) keeps
 * the sim/real ratio honest while frames take longer than real time to make. */
async function advanceTo(to: number, now: number, id: number): Promise<void> {
  await inFlight;
  const s = sim;
  if (s && !stopped) {
    while (s.simTime + TICK_S * 0.5 < to) {
      try {
        await s.tick();
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        s.reset();
        break;
      }
      noteTick(s);
    }
    ratioWindow.push({ real: now, sim: s.simTime, ticks: ticksTotal });
    while (ratioWindow.length > 2 && ratioWindow[0].real < now - 1000) ratioWindow.shift();
    postFrame(s);
  }
  post({ type: 'advanced', id, simTime: s?.simTime ?? 0 });
}

function postFrame(s: RobotSim): void {
  const first = ratioWindow[0];
  const last = ratioWindow[ratioWindow.length - 1];
  const dReal = (last.real - first.real) / 1000;
  const n = s.bodies.length + s.toyBodies.length;
  const poses = s.bodyPoses(new Float32Array(n * 7));
  const q = s.jointPositions(new Float32Array(s.wire.length));
  const target = Float32Array.from(s.targets);
  const tau = Float32Array.from(s.torques);
  const dur = s.contracts[s.mode]?.reference?.duration;
  const msg: FrameMsg = {
    type: 'frame',
    simTime: s.simTime,
    mode: s.mode,
    running: s.runningPolicy,
    poses,
    q,
    target,
    tau,
    stats: {
      inferHz: s.stats.inferHz,
      inferMs: s.stats.inferMs,
      physicsStepMs: s.stats.physicsStepMs,
      tickMs: s.stats.tickMs,
      substeps: s.stats.substeps,
      timestep: s.stats.timestep,
      ratio: dReal > 0.25 ? (last.sim - first.sim) / dReal : speed,
      ticksPerSec: dReal > 0.25 ? (last.ticks - first.ticks) / dReal : 0,
    },
    transitions: s.log.splice(0).map((t) => ({ from: t.from, to: t.to, why: t.why })),
    autoLeft: s.autoLeft.splice(0).map((a) => ({ mode: a.mode, after: a.after, keys: a.keys })),
    routine: s.routine ? s.routine.status() : null,
    routineEvents: s.routine ? s.routine.events.splice(0) : [],
    motionLeft: dur && motionStart && motionStart.mode === s.mode ? Math.max(0, dur - (s.simTime - motionStart.at)) : null,
  };
  post(msg, [poses.buffer, q.buffer, target.buffer, tau.buffer]);
}
