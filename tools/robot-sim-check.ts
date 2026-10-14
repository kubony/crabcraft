// Headless check of Robot Mode's simulation core under Node: the same src/robot/sim/core.ts the
// browser worker runs, the bundle's controller wasm, onnxruntime-web (wasm backend) and MuJoCo
// WASM, loaded from public/. Drives the robot through standing, 30 s of walking, dances, a gesture,
// the jump and each of the six skills, and prints what happened (exit 1 when a skill fails to
// enter, finish or hand back).
//
//   node tools/robot-sim-check.ts [--quick]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotSim } from '../src/robot/sim/core.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => join(root, 'public', p);
const quick = process.argv.includes('--quick');

const loadMujoco = (await import(join(root, 'node_modules/@mujoco/mujoco/mujoco.js'))).default;
const mj = await loadMujoco();
const ort = await import(join(root, 'node_modules/onnxruntime-web/dist/ort.node.min.mjs'));
ort.env.wasm.numThreads = 1;

const bundleDir = pub('robot/bundle');
const bundle = JSON.parse(readFileSync(join(bundleDir, 'bundle.json'), 'utf8'));
if (bundle.schema !== 'kk-policy-bundle/1') throw new Error(`unknown bundle schema ${bundle.schema}`);
const web = bundle.runtimes.web;
const glue = await import(join(bundleDir, web.glue));
glue.initSync({ module: readFileSync(join(bundleDir, web.wasm)) });

const contracts: Record<string, any> = {};
const trajectories: Record<string, string> = {};
const sessions: Record<string, any> = {};
const byFile: Record<string, any> = {};
for (const [mode, entry] of Object.entries<any>(bundle.modes)) {
  const c = JSON.parse(readFileSync(join(bundleDir, entry.contract), 'utf8'));
  contracts[mode] = c;
  if (c.reference) trajectories[mode] = readFileSync(join(bundleDir, c.reference.file), 'utf8');
  const file = entry.models.onnx;
  byFile[file] ??= await ort.InferenceSession.create(new Uint8Array(readFileSync(join(bundleDir, file))), {
    executionProviders: ['wasm'],
  });
  sessions[mode] = byFile[file];
}

const meshes: Record<string, Uint8Array> = {};
for (const f of readdirSync(pub('robot/jumper/meshes'))) meshes[`meshes/${f}`] = new Uint8Array(readFileSync(pub(`robot/jumper/meshes/${f}`)));

const sim = new RobotSim({
  mj,
  sceneXml: readFileSync(pub('robot/jumper/scene.xml'), 'utf8'),
  meshes,
  pkg: JSON.parse(readFileSync(pub('robot/jumper/robot-package.json'), 'utf8')),
  controllerToml: readFileSync(join(bundleDir, 'controller.toml'), 'utf8'),
  contracts,
  trajectories,
  WebFsm: glue.WebFsm,
  infer: async (mode, obs) => {
    const s = sessions[mode];
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', obs, [1, obs.length]) });
    return out[s.outputNames[0]].data as Float32Array;
  },
});

// Reference replay on a fresh controller (BUNDLE.md "Replaying it").
const refText = readFileSync(join(bundleDir, 'reference.json'), 'utf8');
console.log('reference replay:', sim.buildFsm().checkReference(refText));

let minZ = Infinity;
let maxTilt = 0;
let maxZ = 0;
const run = async (seconds: number, label: string, every?: () => void) => {
  const t0 = performance.now();
  const sim0 = sim.simTime;
  minZ = Infinity; maxTilt = 0; maxZ = 0;
  const modes = new Set<string>();
  const p0 = [sim.data.qpos[0], sim.data.qpos[1]];
  const ticks = Math.round(seconds / 0.005);
  for (let i = 0; i < ticks; i++) {
    every?.();
    await sim.tick();
    const u = sim.baseUpright();
    minZ = Math.min(minZ, u.z); maxZ = Math.max(maxZ, u.z); maxTilt = Math.max(maxTilt, u.tilt);
    modes.add(`${sim.mode}${sim.runningPolicy ? '' : '(ramp)'}`);
  }
  const wall = (performance.now() - t0) / 1000;
  const d = Math.hypot(sim.data.qpos[0] - p0[0], sim.data.qpos[1] - p0[1]);
  console.log(
    `${label.padEnd(26)} sim ${(sim.simTime - sim0).toFixed(1)}s wall ${wall.toFixed(1)}s | modes ${[...modes].join(',')} | ` +
      `z ${minZ.toFixed(3)}..${maxZ.toFixed(3)} tilt ${(maxTilt * 57.3).toFixed(1)}deg moved ${d.toFixed(2)}m | ` +
      `infer ${sim.stats.inferHz.toFixed(0)}Hz ${sim.stats.inferMs.toFixed(3)}ms step ${sim.stats.physicsStepMs.toFixed(3)}ms tick ${sim.stats.tickMs.toFixed(3)}ms`,
  );
  return { minZ, maxTilt, maxZ, d };
};
const press = (code: string, down: boolean) => sim.key(code, down, false);
const chord = async (mod: string, code: string) => {
  press(mod, true); press(code, true);
  await run(0.1, `  ${mod}+${code} down`);
  press(code, false); press(mod, false);
};
const tap = async (code: string) => {
  press(code, true);
  await run(0.1, `  ${code} down`);
  press(code, false);
};

await run(3, 'stand');
press('KeyW', true);
const walk = await run(quick ? 8 : 30, 'walk W');
press('KeyW', false);
press('KeyA', true);
await run(quick ? 3 : 6, 'strafe A');
press('KeyA', false);
press('KeyJ', true);
await run(3, 'turn J');
press('KeyJ', false);
await run(2, 'settle');
await chord('ControlLeft', 'Digit1');
await run(quick ? 6 : 12, 'dance_crab');
await tap('Escape');
press('ControlLeft', true); await run(0.05, '  ctrl'); press('ControlLeft', false);
await run(3, 'after leave');
await chord('ControlLeft', 'Digit2');
await run(quick ? 6 : 12, 'dance_brazilian');
press('ControlLeft', true); await run(0.05, '  ctrl'); press('ControlLeft', false);
await run(3, 'after leave');
await tap('Digit1');
await run(9, 'gesture_hello');
await tap('Space');
const jump = await run(4, 'jump');
await run(2, 'settle');

// The six skills (jumper.skill_*), when the bundle carries them: each switched into live on its
// key from walking, played to its end, and handed back to the walking policy.
const SKILLS: [string, string, number][] = [
  ['skill_swipe', 'Digit5', 2.12], ['skill_slam', 'Digit6', 3.38], ['skill_cast', 'Digit7', 4.86],
  ['skill_flinch', 'Digit8', 1.38], ['skill_powerdown', 'Digit9', 5.68], ['skill_sit', 'Digit0', 5.32],
];
const skills: Record<string, { entered: boolean; back: boolean; minZ: number; maxTiltDeg: number }> = {};
let skillsFailed = 0;
for (const [mode, code, clip] of SKILLS) {
  if (!bundle.modes[mode]) continue;
  const before = sim.log.length;
  await tap(code);
  const r = await run(clip + 3.2, mode);
  const moves = sim.log.slice(before).map((l) => `${l.from}->${l.to}`);
  const entered = moves.includes(`locomotion->${mode}`);
  const back = moves.includes(`${mode}->locomotion`) && sim.mode === 'locomotion' && sim.runningPolicy;
  skills[mode] = { entered, back, minZ: +r.minZ.toFixed(3), maxTiltDeg: +(r.maxTilt * 57.3).toFixed(1) };
  if (!entered || !back || r.maxTilt * 57.3 > 45) skillsFailed++;
  await run(1, 'settle');
}
console.log(JSON.stringify({ walkMinZ: walk.minZ, walkMaxTiltDeg: walk.maxTilt * 57.3, walkDist: walk.d, jumpApex: jump.maxZ }));
if (Object.keys(skills).length) console.log('skills', JSON.stringify(skills));
console.log('log', sim.log.map((l) => `${l.from}->${l.to}`).join(' '));
sim.dispose();
if (skillsFailed) {
  console.error(`${skillsFailed} skill(s) did not enter, finish and hand back to locomotion`);
  process.exit(1);
}
