// Headless check of Robot Mode's simulation core under Node: the same src/robot/sim/core.ts the
// browser worker runs, the bundle's controller wasm, onnxruntime-web (wasm backend) and MuJoCo
// WASM, loaded from public/. Drives the robot through standing, 30 s of walking, dances, a gesture,
// the jump, each of the six skills and the seven breakdance moves (the four jumper.break_*
// recordings, the spin, the 720 jump spin and the back flip), then the live breakdance routine
// (src/robot/sim/routine.ts) several times from different starts, and prints what happened (exit 1
// when a move fails to enter, finish or hand back, a jump does not take off and land upright, or a
// routine run does not play every move on its downbeat and end walking upright without a Safe Hold).
//
//   node tools/robot-sim-check.ts [--quick] [--routine N] [--routine-only]
// --routine N: routine runs (default 5); --routine-only: skip everything before the routine.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotSim } from '../src/robot/sim/core.ts';
import { BEAT_S, LiveRoutine, ROUTINE } from '../src/robot/sim/routine.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => join(root, 'public', p);
const quick = process.argv.includes('--quick');
const routineOnly = process.argv.includes('--routine-only');
const routineArg = process.argv.indexOf('--routine');
const routineRuns = routineArg >= 0 ? Number(process.argv[routineArg + 1]) : 5;

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
/** Heading of the base, rad (MuJoCo frame), and the turn accumulated over the last run. */
const heading = () => {
  const q = sim.data.qpos as Float64Array;
  const w = q[3], x = q[4], y = q[5], z = q[6];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
};
let turned = 0;
const run = async (seconds: number, label: string, every?: () => void) => {
  const t0 = performance.now();
  const sim0 = sim.simTime;
  minZ = Infinity; maxTilt = 0; maxZ = 0; turned = 0;
  let prevYaw = heading();
  const modes = new Set<string>();
  const p0 = [sim.data.qpos[0], sim.data.qpos[1]];
  const ticks = Math.round(seconds / 0.005);
  for (let i = 0; i < ticks; i++) {
    every?.();
    await sim.tick();
    const u = sim.baseUpright();
    minZ = Math.min(minZ, u.z); maxZ = Math.max(maxZ, u.z); maxTilt = Math.max(maxTilt, u.tilt);
    const yaw = heading();
    turned += ((yaw - prevYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    prevYaw = yaw;
    modes.add(`${sim.mode}${sim.runningPolicy ? '' : '(ramp)'}`);
  }
  const wall = (performance.now() - t0) / 1000;
  const d = Math.hypot(sim.data.qpos[0] - p0[0], sim.data.qpos[1] - p0[1]);
  console.log(
    `${label.padEnd(26)} sim ${(sim.simTime - sim0).toFixed(1)}s wall ${wall.toFixed(1)}s | modes ${[...modes].join(',')} | ` +
      `z ${minZ.toFixed(3)}..${maxZ.toFixed(3)} tilt ${(maxTilt * 57.3).toFixed(1)}deg moved ${d.toFixed(2)}m turned ${(turned * 57.3).toFixed(0)}deg | ` +
      `infer ${sim.stats.inferHz.toFixed(0)}Hz ${sim.stats.inferMs.toFixed(3)}ms step ${sim.stats.physicsStepMs.toFixed(3)}ms tick ${sim.stats.tickMs.toFixed(3)}ms`,
  );
  return { minZ, maxTilt, maxZ, d, turned };
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

// Foot contacts with the floor, for the jumps' take-off and touchdown.
const geomId = (name: string) => mj.mj_name2id(sim.model, mj.mjtObj.mjOBJ_GEOM.value, name) as number;
const floorGeom = geomId('terrain');
const footGeoms = ['LF_palm_pad_b_link', 'RF_palm_pad_b_link', 'LM_foot_tip_link', 'RM_foot_tip_link', 'LR_foot_tip_link', 'RR_foot_tip_link']
  .map((f) => geomId(`${f}_meshcol`));
if (floorGeom < 0 || footGeoms.some((g) => g < 0)) throw new Error('the scene has no terrain or foot geoms by those names');
const feetDown = (): number => {
  const on = new Set<number>();
  // `data.contact` copies the contacts into a new vector on every read: read it once, free it.
  const contacts = sim.data.contact;
  for (let i = 0; i < sim.data.ncon; i++) {
    const c = contacts.get(i);
    if (!c) continue;
    const other = c.geom1 === floorGeom ? c.geom2 : c.geom2 === floorGeom ? c.geom1 : -1;
    if (footGeoms.includes(other) && c.dist < 1e-3) on.add(other);
    c.delete?.();
  }
  contacts.delete?.();
  return on.size;
};

/**
 * The live breakdance routine (src/robot/sim/routine.ts), run `runs` times, each from the start
 * keyframe (the routine travels up to about half a metre, and the desk has toys and a stack of books
 * on it) and then from a different start: standing, still holding the walk-back key after 1.2 s of
 * walking, holding J after turning, holding D after strafing, and just handed back from the
 * six-step. Nothing is pressed after the start but what the routine presses (the held key is let
 * go a second in). A run is clean when every move is entered on its press and handed back to
 * walking, each policy starts within 100 ms of its downbeat, the spin is ended on a beat, no bar
 * slips, the robot never goes to the Safe Hold and it ends walking upright.
 */
async function checkRoutine(runs: number): Promise<number> {
  const starts = ['standing', 'walking', 'turning', 'strafing', 'after a move'];
  let clean = 0;
  const offs: Record<string, number[]> = {};
  const leads: Record<string, number[]> = {};
  const touch: Record<string, number[]> = {};
  for (let r = 0; r < runs; r++) {
    const start = starts[r % starts.length];
    const held = { walking: 'ArrowDown', turning: 'KeyJ', strafing: 'KeyD' }[start as 'walking'] as string | undefined;
    // A different stand and a different push each time round the starts, so no two runs repeat.
    const lap = Math.floor(r / starts.length);
    sim.reset();
    await run(1.0 + 0.37 * lap, '  settle');
    if (held) {
      press(held, true);
      await run((start === 'turning' ? 1.5 : 1.2) - 0.15 * lap, `  ${start} before the routine`);
    }
    if (start === 'after a move') {
      press('ShiftLeft', true); press('Digit2', true);
      await run(0.1, '  Shift+Digit2 down');
      press('Digit2', false); press('ShiftLeft', false);
      for (let i = 0; i < 2000 && !(sim.mode === 'locomotion' && sim.runningPolicy && sim.log.at(-1)?.from === 'break_sixstep'); i++) await sim.tick();
    }
    const logFrom = sim.log.length;
    const p0 = [sim.data.qpos[0], sim.data.qpos[1]];
    let far = 0;
    const rt = new LiveRoutine();
    sim.startRoutine(rt);
    let safe = false;
    let maxTilt = 0;
    let minZ = Infinity;
    // Per jump: its flights (all six feet off the floor), the highest one is the jump.
    const air: Record<string, { liveAt: number; z0: number; cur: { up: number; zMax: number } | null; best: { up: number; down: number; rise: number } | null }> = {};
    for (let i = 0; i < 70 / 0.005 && rt.state === 'running'; i++) {
      await sim.tick();
      if (held && i === 200) press(held, false); // let go a second in, as a person would
      if (sim.mode === 'safe') safe = true;
      const u = sim.baseUpright();
      minZ = Math.min(minZ, u.z);
      far = Math.max(far, Math.hypot(sim.data.qpos[0] - p0[0], sim.data.qpos[1] - p0[1]));
      if (sim.mode !== 'power_backflip') maxTilt = Math.max(maxTilt, u.tilt);
      // The jumps: when all six feet leave the floor and come back (contacts read first: reading
      // them can grow the WASM heap, which detaches any qpos view taken before).
      if ((sim.mode === 'power_jumpspin' || sim.mode === 'power_backflip') && sim.runningPolicy) {
        const rec = rt.moves.find((m) => m.mode === sim.mode);
        const a = (air[sim.mode] ??= { liveAt: rec?.liveAt ?? sim.simTime, z0: sim.data.qpos[2], cur: null, best: null });
        const feet = feetDown();
        const z = sim.data.qpos[2];
        if (!a.cur && feet === 0) a.cur = { up: sim.simTime - a.liveAt, zMax: z };
        if (a.cur) {
          a.cur.zMax = Math.max(a.cur.zMax, z);
          if (feet > 0) {
            const rise = a.cur.zMax - a.z0;
            if (!a.best || rise > a.best.rise) a.best = { up: a.cur.up, down: sim.simTime - a.liveAt, rise };
            a.cur = null;
          }
        }
      }
    }
    if (held) press(held, false);
    await run(1, '  after the routine');
    const end = sim.baseUpright();
    const moves = sim.log.slice(logFrom).map((l) => `${l.from}->${l.to}`);
    const fails: string[] = [];
    if (rt.state !== 'done') fails.push(`ended ${rt.state}: ${rt.why}`);
    if (rt.slips) fails.push(`${rt.slips} bar(s) slipped`);
    if (safe) fails.push('went to the Safe Hold');
    if (!(sim.mode === 'locomotion' && sim.runningPolicy) || end.tilt * 57.3 > 10 || end.z < 0.08) {
      fails.push(`ended in ${sim.mode} at tilt ${(end.tilt * 57.3).toFixed(1)} deg, z ${end.z.toFixed(3)}`);
    }
    const rows: string[] = [];
    rt.moves.forEach((m, i) => {
      const plan = ROUTINE[i];
      if (!moves.includes(`locomotion->${m.mode}`) || !moves.includes(`${m.mode}->locomotion`)) fails.push(`${m.mode} was not entered and handed back`);
      if (m.pressAt === null || m.liveAt === null || m.backAt === null) {
        fails.push(`${m.mode} did not run (${JSON.stringify(m)})`);
        return;
      }
      const off = m.liveAt - m.downbeat;
      (offs[m.mode] ??= []).push(off);
      (leads[m.mode] ??= []).push(m.liveAt - m.pressAt);
      if (Math.abs(off) > 0.1) fails.push(`${m.mode} started ${(off * 1000).toFixed(0)} ms off its downbeat`);
      const beat = (t: number) => (t - rt.t0) / BEAT_S;
      let extra = '';
      if (plan.holdBeats !== undefined) {
        const b = m.endPressAt === null ? NaN : beat(m.endPressAt);
        if (!(Math.abs(b - Math.round(b)) < 0.01)) fails.push(`${m.mode} was not ended on a beat (beat ${b.toFixed(3)})`);
        extra = ` ended by its switch on beat ${b.toFixed(2)}`;
      }
      const a = air[m.mode];
      if (a) {
        const b = a.best;
        if (!b || b.rise < 0.05) fails.push(`${m.mode} did not take off and land`);
        else (touch[m.mode] ??= []).push(b.down);
        extra = b ? ` take-off ${b.up.toFixed(3)} s, touchdown ${b.down.toFixed(3)} s after the policy start, ${b.rise.toFixed(3)} m up` : '';
      }
      rows.push(`    ${m.mode.padEnd(15)} press beat ${beat(m.pressAt).toFixed(2)} lead ${(m.liveAt - m.pressAt).toFixed(3)} s (planned ${m.leadPlanned?.toFixed(3)}), live on bar ${plan.bar + rt.slips} ` +
        `${off >= 0 ? '+' : ''}${(off * 1000).toFixed(0)} ms, walking again ${(m.backAt - m.liveAt).toFixed(3)} s later (beat ${beat(m.backAt).toFixed(2)})${extra}`);
    });
    const ok = fails.length === 0;
    if (ok) clean++;
    console.log(`routine run ${r + 1} from ${start}: ${ok ? 'clean' : 'FAILED'} | ${rt.state}, ${(sim.simTime - rt.t0).toFixed(2)} s, slips ${rt.slips}, ` +
      `safe ${safe}, max tilt ${(maxTilt * 57.3).toFixed(1)} deg (the flip aside), min z ${minZ.toFixed(3)}, end ${sim.mode} tilt ${(end.tilt * 57.3).toFixed(1)} deg z ${end.z.toFixed(3)}, ` +
      `from (${p0[0].toFixed(2)}, ${p0[1].toFixed(2)}) m, at most ${far.toFixed(2)} m away`);
    console.log(rows.join('\n'));
    for (const f of fails) console.log(`    fail: ${f}`);
  }
  const range = (a: number[]) => `${Math.min(...a).toFixed(3)} to ${Math.max(...a).toFixed(3)}`;
  const ms = (a: number[]) => `${Math.round(Math.min(...a) * 1000)} to ${Math.round(Math.max(...a) * 1000)} ms`;
  console.log(`routine: ${clean} of ${runs} runs clean; policy start against its downbeat: ${Object.entries(offs).map(([m, a]) => `${m} ${ms(a)}`).join(', ')}; ` +
    `leads (s): ${Object.entries(leads).map(([m, a]) => `${m} ${range(a)}`).join(', ')}; touchdown after the policy start (s): ${Object.entries(touch).map(([m, a]) => `${m} ${range(a)}`).join(', ')}`);
  return runs - clean;
}

if (routineOnly) {
  const failed = await checkRoutine(routineRuns);
  sim.dispose();
  if (failed) {
    console.error(`${failed} routine run(s) were not clean`);
    process.exit(1);
  }
  process.exit(0);
}

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
// The breakdance moves (jumper.break_* and jumper.power_spin_feet), on Shift + 1 to 5. The four
// recordings end by themselves and hand back; the spin has no recording, so it is held for 6 s
// and let go with its own switch, as a person would.
const shiftTap = async (code: string) => {
  press('ShiftLeft', true); press(code, true);
  await run(0.1, `  Shift+${code} down`);
  press(code, false); press('ShiftLeft', false);
};
const BREAKS: [string, string, number][] = [
  ['break_toprock', 'Digit1', 6.24], ['break_sixstep', 'Digit2', 5.32],
  ['break_clawstand', 'Digit3', 6.52], ['break_oneclaw', 'Digit4', 6.52], ['power_spin', 'Digit5', 0],
];
const breaks: Record<string, { entered: boolean; back: boolean; minZ: number; maxTiltDeg: number; turnedDeg: number; revPerS?: number }> = {};
for (const [mode, code, clip] of BREAKS) {
  if (!bundle.modes[mode]) continue;
  const before = sim.log.length;
  await shiftTap(code);
  let r;
  let revPerS: number | undefined;
  if (clip > 0) r = await run(clip + 3.2, mode);
  else {
    // the switch-in ramp, then the spin; the rate is read over the last 4 s of the 6
    const ramp = await run(1.0, `${mode} ramp+spin-up`);
    const spin = await run(1.0, `${mode} spin-up`);
    const held = await run(4.0, `${mode} held`);
    revPerS = held.turned / (2 * Math.PI) / 4.0;
    await shiftTap(code);
    const out = await run(3.0, `${mode} let go`);
    r = {
      minZ: Math.min(ramp.minZ, spin.minZ, held.minZ, out.minZ),
      maxTilt: Math.max(ramp.maxTilt, spin.maxTilt, held.maxTilt, out.maxTilt),
      turned: ramp.turned + spin.turned + held.turned + out.turned,
    };
  }
  const moves = sim.log.slice(before).map((l) => `${l.from}->${l.to}`);
  const entered = moves.includes(`locomotion->${mode}`);
  const back = moves.includes(`${mode}->locomotion`) && sim.mode === 'locomotion' && sim.runningPolicy;
  breaks[mode] = {
    entered, back, minZ: +r.minZ.toFixed(3), maxTiltDeg: +(r.maxTilt * 57.3).toFixed(1),
    turnedDeg: +(r.turned * 57.3).toFixed(1), ...(revPerS !== undefined ? { revPerS: +revPerS.toFixed(2) } : {}),
  };
  if (!entered || !back || r.maxTilt * 57.3 > 45) skillsFailed++;
  await run(1, 'settle');
}

// The two jumps (jumper.power_jumpspin720 on Shift + 6, jumper.power_backflip on Shift + 7), each
// switched into from standing and again from walking forward (W held for 2 s and let go with the
// press); the check presses nothing after that. Each must take off (all
// six feet off the floor with the base over 1 cm above its height at the handover), land upright
// (on its feet again, under 30 degrees of tilt 0.3 s after the touchdown, never in `safe`) and be
// handed back to the walking policy by the host's own press of its switch (core.ts AUTO_LEAVE_S).
// The turn in the air is the body rate integrated over that flight: about the vertical for the
// 720, nose-up about the body's pitch axis for the flip.
const JUMPS: [string, string, 'yaw' | 'pitch', number][] = [
  ['power_jumpspin', 'Digit6', 'yaw', 450], ['power_backflip', 'Digit7', 'pitch', 330],
];
const jumps: Record<string, Record<string, unknown>> = {};
for (const [mode, code, axis, minTurn] of JUMPS) for (const start of ['standing', 'walking']) {
  if (!bundle.modes[mode]) continue;
  if (start === 'walking') {
    press('KeyW', true);
    await run(2, `  walk before ${mode}`);
  }
  const before = sim.log.length;
  const autoBefore = sim.autoLeft.length;
  press('ShiftLeft', true); press(code, true);
  if (start === 'walking') press('KeyW', false);
  for (let i = 0; i < 20; i++) await sim.tick();
  press(code, false); press('ShiftLeft', false);
  let tHand: number | null = null;
  let z0 = 0;
  let flying = false;
  let flight: { t0: number; t1: number | null; turn: number; zMax: number } | null = null;
  let tTouch: number | null = null;
  let tiltAfter: number | null = null;
  let tiltMax = 0;
  let safe = false;
  let tBack: number | null = null;
  const t0 = sim.simTime;
  while (sim.simTime < t0 + 8) {
    await sim.tick();
    if (sim.mode === 'safe') safe = true;
    if (tHand === null && sim.mode === mode && sim.runningPolicy) {
      tHand = sim.simTime;
      z0 = sim.data.qpos[2];
    }
    if (tHand !== null && tBack === null) {
      // Contacts first: reading them can grow the WASM heap, which detaches any qpos view taken before.
      const air = feetDown() === 0;
      const q = sim.data.qpos as Float64Array;
      const v = sim.data.qvel as Float64Array;
      const tilt = sim.baseUpright().tilt * 57.2958;
      tiltMax = Math.max(tiltMax, tilt);
      const w = q[3], x = q[4], y = q[5], zq = q[6];
      // body rate about the world vertical: the third row of R times the body-frame rate
      const yawRate = 2 * (x * zq - w * y) * v[3] + 2 * (y * zq + w * x) * v[4] + (1 - 2 * (x * x + y * y)) * v[5];
      const rate = axis === 'yaw' ? yawRate : -v[4];
      if (!flight && air && !flying) {
        flying = true;
        flight = { t0: sim.simTime - tHand, t1: null, turn: 0, zMax: q[2] };
      }
      if (flying && flight) {
        flight.turn += rate * 0.005 * 57.2958;
        flight.zMax = Math.max(flight.zMax, q[2]);
        if (!air) {
          flying = false;
          flight.t1 = sim.simTime - tHand;
          if (flight.zMax - z0 > 0.01) tTouch = sim.simTime;
          else flight = null; // a shuffle, not the jump
        }
      }
      if (tTouch !== null && tiltAfter === null && sim.simTime >= tTouch + 0.3) tiltAfter = tilt;
    }
    if (tHand !== null && tBack === null && sim.mode === 'locomotion' && sim.runningPolicy) tBack = sim.simTime;
    if (tBack !== null && sim.simTime > tBack + 0.5) break;
  }
  const moves = sim.log.slice(before).map((l) => `${l.from}->${l.to}`);
  const auto = sim.autoLeft.slice(autoBefore).filter((a) => a.mode === mode);
  const entered = moves.includes(`locomotion->${mode}`);
  const tookOff = !!flight && flight.zMax - z0 > 0.01;
  const turn = flight ? flight.turn : 0;
  const landed = tookOff && tiltAfter !== null && tiltAfter < 30 && !safe;
  const back = moves.includes(`${mode}->locomotion`) && auto.length === 1 && sim.mode === 'locomotion' && sim.runningPolicy;
  const key = `${mode} from ${start}`;
  jumps[key] = {
    entered, tookOff, landedUpright: landed, back, safe,
    handoverAfterPressS: tHand === null ? null : +(tHand - t0).toFixed(3),
    takeoffS: flight ? +flight.t0.toFixed(3) : null, touchdownS: flight?.t1 != null ? +flight.t1.toFixed(3) : null,
    riseM: flight ? +(flight.zMax - z0).toFixed(3) : 0, airTurnDeg: +turn.toFixed(1),
    tiltMaxDeg: +tiltMax.toFixed(1), tilt0p3sAfterTouchdownDeg: tiltAfter === null ? null : +tiltAfter.toFixed(1),
    hostPressedAfterS: auto[0] ? +(auto[0].at - (tHand ?? 0)).toFixed(3) : null,
    walkingAgainAfterHandoverS: tBack === null || tHand === null ? null : +(tBack - tHand).toFixed(3),
  };
  console.log(`${key.padEnd(26)} ${JSON.stringify(jumps[key])}`);
  if (!entered || !tookOff || !landed || !back || turn < minTurn) skillsFailed++;
  await run(1, 'settle');
}

console.log(JSON.stringify({ walkMinZ: walk.minZ, walkMaxTiltDeg: walk.maxTilt * 57.3, walkDist: walk.d, jumpApex: jump.maxZ }));
if (Object.keys(skills).length) console.log('skills', JSON.stringify(skills));
if (Object.keys(breaks).length) console.log('breaks', JSON.stringify(breaks));
if (Object.keys(jumps).length) console.log('jumps', JSON.stringify(jumps));
console.log('log', sim.log.map((l) => `${l.from}->${l.to}`).join(' '));
const routineFailed = routineRuns > 0 ? await checkRoutine(routineRuns) : 0;
sim.dispose();
if (skillsFailed) {
  console.error(`${skillsFailed} skill(s) or breakdance move(s) did not enter, finish and hand back to locomotion (or a jump did not take off, turn and land upright)`);
}
if (routineFailed) console.error(`${routineFailed} routine run(s) were not clean`);
if (skillsFailed || routineFailed) process.exit(1);
