#!/usr/bin/env node
// Shots for the breakdance videos, captured frame by frame in capture mode like the trailer's
// (tools/trailer/lib.mjs, src/capture/clock.ts). In Robot Mode, the bare robot live: the whole
// routine as P plays it (`live`), the seven breaking moves one after the other (`moves`), the 720
// and the back flip in slow motion (`jump-live-slow`, `flip-live-slow`: the simulation stepped at
// a fraction of real time in lockstep with the frames) and Jumper's four dances (`dance-*`). In
// the game, the hero's routine in Clawhaven framed close (`routine-a`, `routine-b`), slow-motion
// takes of the 720 and the back flip, and the ending's finale with the town around the hero. Every
// shot exists for a landscape page (1920x1080) and a portrait one (1080x1920, name suffix -port),
// so the vertical cut is framed for its own screen instead of cropped out of the landscape one.
// Each sidecar JSON carries a `probe` per output frame (the game routine's clock; in Robot Mode the
// simulated time, the mode, the body's height, the live routine's state) for the edits to cut on
// the moves.
//
// Usage: node tools/trailer/breakdance/capture.mjs --url http://localhost:5241 --out <dir>
//          [--shots live,routine-a] [--layout land|port|both] [--dsf 2] [--stills 0,120]
// Needs the dev server running (pnpm dev --port 5241 --strictPort). The whole video, from serving
// the app to the checked mp4s, is one command: node tools/trailer/breakdance/make.mjs (see there).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, css, openApp, record } from '../lib.mjs';
import { LENGTH, MOVE } from './routine.mjs';
import { BAR_S, ROUTINE } from '../../../src/robot/sim/routine.ts';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5241');
const outDir = resolve(opt('--out', 'breakdance-out'));
const dsf = Number(opt('--dsf', '2'));
const stills = (opt('--stills', '') || '').split(',').filter(Boolean).map(Number);
const only = opt('--shots', '').split(',').filter(Boolean);
const layouts = { land: ['land'], port: ['port'], both: ['land', 'port'] }[opt('--layout', 'both')];
mkdirSync(outDir, { recursive: true });

const SIZE = { land: [1920, 1080], port: [1080, 1920] };
/**
 * The hero: a human priest in Jumper Red with the circlet, so the moves read (the warrior's shield
 * and plumed helm hide the body in the jumps); the lantern traces the spin.
 */
const HERO = { race: 'human', sex: 'male', classId: 'priest', shell: 0, crest: 2, led: 0, name: 'Pinchwick' };
const shotFile = (name, layout) => resolve(outDir, layout === 'port' ? `${name}-port` : name);

/** Routine clock (seconds since B) of each move's start, from the game's clip windows (routine.mjs). */
const RT = {
  toprock: 0,
  sixstep: MOVE.sixstep.start,
  spin: MOVE.spin.start,
  jumpspin: MOVE.jumpspin.start,
  backflip: MOVE.backflip.start,
  oneclaw: MOVE.oneclaw.start,
  end: LENGTH,
};
const JUMP = { takeoff: MOVE.jumpspin.at('takeoff'), land: MOVE.jumpspin.at('land') };
/**
 * The camera set-up for the 720 and the back flip runs a little either side of them, so the cut
 * that shows both (it starts before the 720 and runs past the back flip's landing) has one camera.
 */
const JUMPS = { from: RT.jumpspin - 0.3, to: RT.oneclaw + 0.5 };
const FLIP = { takeoff: MOVE.backflip.at('takeoff'), land: MOVE.backflip.at('land') };

// ------------------------------------------------------------------------------------ Robot Mode

/**
 * What of Robot Mode's HUD each robot shot keeps. The page's headline is hidden in all of them:
 * the video's own captions say what this is. `card`: the mode card (what runs, the policy's name
 * and rate), the badges (MuJoCo WASM, ONNX Runtime Web), the telemetry and the dock's Breaking
 * group under the card. `routine`: the mode card with the routine's line (bar, beat, next move)
 * and the log of every press the page makes; no telemetry, no dock. `dance`: the mode card and the
 * badges only.
 */
const DOCK_UNDER_CARD = (port) => `
  .rm-dock { left: 28px !important; right: auto !important; top: ${port ? 470 : 448}px !important; bottom: auto !important;
    transform: none !important; max-width: none !important; justify-content: flex-start !important; }
  .rm-dock > .rm-group:not(.cap-break) { display: none !important; }
  .rm-dock > .rm-group.cap-break { border-left: none !important; padding-left: 4px !important; }`;
const ROBOT_HUD = {
  card: (port) => `.rm-tools, .rm-help, .rm-notice, .rm-log, .rm-look, .rm-title, .rm-sub { display: none !important; } ${DOCK_UNDER_CARD(port)}`,
  routine: () => `.rm-tools, .rm-help, .rm-notice, .rm-look, .rm-title, .rm-sub, .rm-tele, .rm-dock { display: none !important; }`,
  dance: () => `.rm-tools, .rm-help, .rm-notice, .rm-log, .rm-look, .rm-title, .rm-sub, .rm-tele, .rm-dock { display: none !important; }`,
};

/** Robot Mode with the bare robot, the HUD cut down to `hud` (ROBOT_HUD), every mode in `modes` streamed in. */
async function openRobot(layout, hud, modes) {
  const port = layout === 'port';
  const app = await openApp({ base, query: 'screen=robot', spec: HERO, dsf, size: SIZE[layout] });
  const { page } = app;
  await page.waitForFunction((m) => window.__robotMode && m.every((x) => window.__robotMode.client.policies.has(x)), modes, { timeout: 180000 });
  await page.evaluate(() => window.__robotMode.handle.setAppearance('bare'));
  await page.evaluate(() => {
    for (const g of document.querySelectorAll('.rm-dock .rm-group')) {
      if (g.querySelector('.gl')?.textContent?.trim().toLowerCase() === 'breaking') g.classList.add('cap-break');
    }
  });
  await css(page, `.rm { transition: none !important; } ${ROBOT_HUD[hud](port)}`);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__capture.begin());
  await advance(app, 1.5);
  return app;
}

/**
 * Robot Mode's camera, one set-up per move, each framing the robot from where it faces when the
 * set-up starts. With `key: 'mode'`, `setups` maps a mode to its set-up ('default' before the
 * first); walking between moves keeps the last move's, and the set-up eases over `dur` seconds of
 * simulated time from the moment its mode is entered. With `key: 'routine'`, `setups` is a list of
 * {from, to} in seconds of the live routine's clock (simulated time since its bar 0), so the
 * camera changes on the routine's downbeats. A set-up: `az` from the robot's front, `el`, `dist`
 * (m), `lookY` (m), `fov`, `rise` (how much of the body's rise above standing the look point
 * follows, for the jumps), `follow` (how far the camera follows the robot's travel), each a number
 * or [from, to] eased in and out. The portrait page widens the lens and steps back (`portScale`
 * times the distance, 1.35 by default; less for the jumps, which have the page's height to rise in).
 */
async function robotCam(page, setups, { port, key = 'mode' }) {
  await page.evaluate(
    ([setups, port, key]) => {
      const R = window.__robotMode;
      R.orbit.update = () => {};
      const T = window.__T;
      const cam = R.orbit.camera;
      const fovScale = port ? 1.6 : 1;
      const L = (v, k) => (Array.isArray(v) ? T.lerp(v[0], v[1], k) : v);
      let seg = null;
      let ref = null;
      let stand = null;
      let last = 'default';
      let since = 0;
      T.onFrame(() => {
        const s = R.handle.getState();
        if (!s) return;
        const b = s.base.position;
        if (stand === null) stand = b.y;
        let S;
        let id;
        let k;
        if (key === 'routine') {
          const r = R.handle.routine;
          const c = r && Number.isFinite(r.t0) ? s.simTime - r.t0 : -99;
          const i = Math.max(0, setups.findIndex((x) => c >= x.from && c < x.to));
          S = setups[i];
          id = i;
          k = (c - S.from) / (S.dur ?? S.to - S.from);
        } else {
          if (s.mode !== 'locomotion' && s.mode !== last && setups[s.mode]) {
            last = s.mode;
            since = s.simTime;
          }
          S = setups[last] ?? setups.default;
          id = last;
          k = (s.simTime - since) / (S.dur ?? 6);
        }
        if (id !== seg) {
          seg = id;
          const fwd = b.clone().set(0, 0, 1).applyQuaternion(s.base.quaternion);
          ref = { x: b.x, z: b.z, yaw: Math.atan2(fwd.x, fwd.z) };
        }
        k = T.ease('inout', k);
        const cx = T.lerp(ref.x, b.x, S.follow ?? 0.7);
        const cz = T.lerp(ref.z, b.z, S.follow ?? 0.7);
        const a = ref.yaw + L(S.az, k);
        const el = L(S.el, k);
        const dist = L(S.dist, k) * (port ? (S.portScale ?? 1.35) : 1);
        const lookY = L(S.lookY, k) + Math.max(0, b.y - stand) * (S.rise ?? 0);
        const p = [cx + Math.sin(a) * Math.cos(el) * dist, lookY + Math.sin(el) * dist, cz + Math.cos(a) * Math.cos(el) * dist];
        T.place(cam, p, [cx, lookY, cz], L(S.fov ?? 30, k) * fovScale);
        R.engine.setFocus(Math.hypot(p[0] - b.x, p[1] - b.y * 0.6, p[2] - b.z), 0.2);
      });
    },
    [setups, port, key],
  );
}

/** Ask Robot Mode for a mode as its key does (the bundle's own binding), from walking. */
const press = (mode) => (p) =>
  p.evaluate((mode) => {
    if (!window.__robotMode.handle.requestMode(mode)) throw new Error(`Robot Mode refused ${mode} in ${window.__robotMode.handle.getState().mode}`);
  }, mode);

/** The probe every robot shot records: simulated time, the mode, whether its policy runs, the body. */
const robotProbe = () => {
  const h = window.__robotMode.handle;
  const s = h.getState();
  const q = s.base.quaternion;
  const r = h.routine;
  return {
    sim: +s.simTime.toFixed(5),
    mode: s.mode,
    run: s.runningPolicy,
    y: +s.base.position.y.toFixed(5),
    yaw: +Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)).toFixed(4),
    ...(r ? { routine: { state: r.state, t0: r.t0, move: r.move, phase: r.phase } } : {}),
  };
};

/** The set-ups per move, close: the robot is about 0.35 m across and the jumps go 0.4 m up. */
const MOVE_CAM = {
  default: { az: [0.6, 0.5], el: [0.16, 0.14], dist: [0.76, 0.72], lookY: 0.075, dur: 2 },
  break_toprock: { az: [0.55, 0.2], el: [0.16, 0.1], dist: [0.72, 0.62], lookY: [0.075, 0.08], dur: 7 },
  // The six-step from above, where the legs' circle is.
  break_sixstep: { az: [-0.5, -0.85], el: [0.5, 0.42], dist: [0.76, 0.68], lookY: 0.05, dur: 6 },
  break_clawstand: { az: [-0.95, -0.6], el: [0.1, 0.07], dist: [0.74, 0.64], lookY: [0.09, 0.1], dur: 7 },
  break_oneclaw: { az: [0.9, 0.55], el: [0.12, 0.08], dist: [0.74, 0.64], lookY: [0.085, 0.09], dur: 7 },
  power_spin: { az: [-0.25, 0.15], el: [0.22, 0.16], dist: [0.68, 0.62], lookY: [0.07, 0.075], dur: 5 },
  // The jumps: further back, the look point rising with the body; the flip from its side.
  power_jumpspin: { az: [0.45, 0.6], el: [0.1, 0.1], dist: [0.95, 0.9], lookY: 0.1, rise: 0.8, portScale: 1.05, dur: 3 },
  power_backflip: { az: [1.5, 1.6], el: [0.07, 0.07], dist: [0.95, 0.9], lookY: 0.1, rise: 0.6, portScale: 1.1, dur: 3 },
};

/**
 * The seven breaking moves, live, one after the other: toprock, six-step, claw stand, one-claw,
 * the spin (held, then let go), the 720 and the back flip, each asked for from walking as Shift + 1
 * to 7 do and handed back to walking before the next (the two jumps by the page's own press of
 * their switch after the landing, src/robot/sim/core.ts AUTO_LEAVE_S). Press times (shot seconds),
 * measured in Robot Mode: a tracked move is walking again about 7.2 s after its press (its 0.8 s
 * ramp, the recording, the hand-back), the spin 1.1 s after it is let go, a jump about 2.8 s after
 * its press.
 */
const MOVES_AT = { toprock: 0.3, sixstep: 7.9, clawstand: 14.6, oneclaw: 22.5, spin: 30.4, release: 34.6, jumpspin: 36.5, backflip: 39.9, end: 43.1 };
const movesShot = (layout) => async () => {
  const port = layout === 'port';
  const modes = ['break_toprock', 'break_sixstep', 'break_clawstand', 'break_oneclaw', 'power_spin', 'power_jumpspin', 'power_backflip'];
  const app = await openRobot(layout, 'card', modes);
  try {
    await robotCam(app.page, MOVE_CAM, { port });
    const A = MOVES_AT;
    await record(app, shotFile('moves', layout), {
      duration: A.end,
      stills,
      events: [
        { t: A.toprock, mark: 'toprock', fn: press('break_toprock') },
        { t: A.sixstep, mark: 'sixstep', fn: press('break_sixstep') },
        { t: A.clawstand, mark: 'clawstand', fn: press('break_clawstand') },
        { t: A.oneclaw, mark: 'oneclaw', fn: press('break_oneclaw') },
        { t: A.spin, mark: 'spin', fn: press('power_spin') },
        { t: A.release, mark: 'release', fn: (p) => p.evaluate(() => window.__robotMode.handle.release()) },
        { t: A.jumpspin, mark: 'jumpspin', fn: press('power_jumpspin') },
        { t: A.backflip, mark: 'backflip', fn: press('power_backflip') },
      ],
      probe: robotProbe,
    });
  } finally {
    await app.browser.close();
  }
};

/**
 * One jump, live, in slow motion: pressed from walking 0.3 s in, the simulation stepped at `slow`
 * of real time (capture mode steps it in lockstep with the frames, so these are the simulation's
 * own intermediate states, not interpolated frames) from 0.6 s after the press (the earliest
 * hand-over is 0.54 s, the take-off 0.16 to 0.22 s later) to 1.45 s after it (the latest landing,
 * 0.63 s + 0.73 s), easing in and out of it over 0.1 s.
 */
const slowJumpShot = (name, mode, setup, slow) => (layout) => async () => {
  const port = layout === 'port';
  const app = await openRobot(layout, 'card', [mode]);
  try {
    await robotCam(app.page, { default: MOVE_CAM.default, [mode]: setup }, { port });
    const P = 0.3;
    const s0 = P + 0.6;
    const s1 = P + 1.45;
    const ramp = 0.1;
    const speed = (t) => {
      if (t < s0 - ramp || t > s1 + ramp) return 1;
      if (t < s0) return 1 + (slow - 1) * ((t - (s0 - ramp)) / ramp);
      if (t > s1) return slow + (1 - slow) * ((t - s1) / ramp);
      return slow;
    };
    await record(app, shotFile(name, layout), { duration: P + 2.3, speed, stills, events: [{ t: P, mark: 'press', fn: press(mode) }], probe: robotProbe });
  } finally {
    await app.browser.close();
  }
};

/**
 * The live routine (src/robot/sim/routine.ts), as P plays it: the page presses each move's switch
 * on the beat and nothing else. A set-up per move, changing on the downbeat each move starts on
 * (routine seconds, bar n at n x BAR_S); the HUD keeps the routine's line and the log of the
 * page's presses. The routine's music is laid under it by the edit, from the probe's bar 0.
 */
const LIVE_CAM = (() => {
  const bar = (n) => n * BAR_S;
  const at = Object.fromEntries(ROUTINE.map((m) => [m.mode, bar(m.bar)]));
  return [
    { from: -99, to: at.break_toprock, ...MOVE_CAM.default, dur: bar(1) },
    { from: at.break_toprock, to: at.break_sixstep, ...MOVE_CAM.break_toprock },
    { from: at.break_sixstep, to: at.power_spin, ...MOVE_CAM.break_sixstep },
    { from: at.power_spin, to: at.power_jumpspin, ...MOVE_CAM.power_spin },
    { from: at.power_jumpspin, to: at.power_backflip, ...MOVE_CAM.power_jumpspin },
    { from: at.power_backflip, to: at.break_oneclaw, ...MOVE_CAM.power_backflip },
    { from: at.break_oneclaw, to: 999, ...MOVE_CAM.break_oneclaw, dur: 7 },
  ];
})();
const liveShot = (layout) => async () => {
  const port = layout === 'port';
  const app = await openRobot(layout, 'routine', ROUTINE.map((m) => m.mode));
  try {
    await robotCam(app.page, LIVE_CAM, { port, key: 'routine' });
    await record(app, shotFile('live', layout), {
      duration: 44,
      stills,
      events: [{ t: 0.5, mark: 'start', fn: (p) => p.evaluate(() => {
        if (!window.__robotMode.handle.startRoutine()) throw new Error('Robot Mode did not start the routine');
      }) }],
      probe: robotProbe,
    });
  } finally {
    await app.browser.close();
  }
};

/**
 * One of Jumper's four dances, live: asked for from walking, run on unrecorded until `from` seconds
 * after its policy starts (the liveliest stretch of its clip: the largest mean joint speed over 6 s,
 * public/motions/<id>), then recorded for `len` seconds. The robot is framed whole from the front,
 * the camera drifting round it.
 */
const DANCES = {
  dance_crab: { from: 14.5, len: 6.5, az: [0.55, -0.15] },
  dance_brazilian: { from: 5.6, len: 6.5, az: [-0.5, 0.15] },
  dance_maze: { from: 1.3, len: 6.5, az: [0.4, -0.25] },
  dance_dream_wings: { from: 15.7, len: 6.5, az: [-0.45, 0.2] },
};
const danceShot = (id) => (layout) => async () => {
  const port = layout === 'port';
  const d = DANCES[id];
  const app = await openRobot(layout, 'dance', [id]);
  const { page } = app;
  try {
    await robotCam(page, { default: MOVE_CAM.default, [id]: { az: d.az, el: [0.2, 0.14], dist: [0.86, 0.76], lookY: 0.08, follow: 0.85, dur: d.from + d.len } }, { port });
    await press(id)(page);
    // Wait for its policy to start, then run on to the stretch unrecorded (30 frames a second: the
    // simulation keeps its own step whatever the frame rate).
    for (let i = 0; i < 200; i++) {
      const on = await page.evaluate((id) => {
        const s = window.__robotMode.handle.getState();
        return s.mode === id && s.runningPolicy;
      }, id);
      if (on) break;
      await advance(app, 0.05);
    }
    await advance(app, d.from, 30);
    await record(app, shotFile(id.replaceAll('_', '-'), layout), { duration: d.len, stills, probe: robotProbe });
  } finally {
    await app.browser.close();
  }
};

// ------------------------------------------------------------------------------------ the game

const HUD = {
  none: `.hud > * { display: none !important; }`,
  // Speech bubbles (and nameplates, quest marks, combat text) only.
  plates: `.hud > *:not(.plates) { display: none !important; }`,
};

/**
 * Clawhaven with the hero, the clock frozen, the game's follow camera off. `stage` puts the hero
 * where the ending holds its party (open, level ground near the spawn, room for a ring of 6.4
 * units: the game's own search, EndingSequence.openSquare), stops the townsfolk where they are and
 * sends the ones within 9 units home, so nobody walks through a close-up.
 */
async function openGame(layout, hud = 'none', stage = false) {
  const app = await openApp({ base, query: 'screen=game&debug=1', spec: HERO, dsf, size: SIZE[layout] });
  const { page } = app;
  await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 120000 });
  // The loading painting fades for a second; the intro greeting comes 4.6 s in.
  await page.waitForTimeout(5200);
  await css(page, HUD[hud]);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.follow.update = () => {};
    g.god = true;
    g.hud.debugEl.classList.add('hidden');
    g.hud.chat.el.style.display = 'none';
    g.objectivePos = () => null;
  });
  if (stage) {
    await page.evaluate(() => {
      const g = window.cc.game;
      const spawn = g.world.pois.spawn;
      const slots = Array.from({ length: 28 }, (_, i) => ({ a: ((i % 14) / 14) * Math.PI * 2, r: i < 14 ? 4.2 : 6.4 }));
      const c = g.ending.openSquare(spawn.position, spawn.yaw, slots);
      const p = g.player.unit;
      p.teleport(g.world, c.x, c.z, spawn.yaw);
      for (const t of g.townsfolk) t.frozen = true;
      for (const u of [...g.townsfolk.map((t) => t.unit), ...g.npcs.map((n) => n.unit)]) {
        if (Math.hypot(u.pos.x - c.x, u.pos.z - c.z) < 9) u.hidden = true;
      }
    });
  }
  await page.evaluate(() => window.__capture.begin());
  return app;
}

/**
 * Install a camera that follows a breaking crab: set-ups keyed on the routine's clock (`clock`
 * returns it), each framing the crab from where its body faces when the set-up starts. `az` is
 * from the crab's front, `el` the elevation, `dist` the distance, `look` the look height over the
 * ground, `rise` how much of the body's height above standing the look point follows (the jumps
 * go 1.6 units up), all eased from the first value to the second. On the portrait page the lens
 * widens (`fov` times 1.6) and the camera pulls back a little (`distScale`), so the crab keeps its
 * width in frame without the camera backing into the scenery. Crabs other than the hero that come
 * within `hideNear` units of the camera are not drawn that frame (a crowd crab right at the lens).
 */
async function breakCam(page, setups, { port, who = 'player', distScale = 1.15, hideNear = 0 }) {
  await page.evaluate(
    ([setups, port, who, distScale, hideNear]) => {
      const T = window.__T;
      const g = window.cc.game;
      // The ending's routine plays on the hero too.
      const unit = g.player.unit;
      const routine = who === 'ending' ? () => g.ending.routine : () => g.player.breakdance;
      const V = unit.pos.constructor;
      const Q = g.camera.quaternion.constructor;
      const bodyPos = () => unit.rig.body.getWorldPosition(new V());
      const bodyYaw = () => {
        const q = unit.rig.body.getWorldQuaternion(new Q());
        const f = new V(0, 0, 1).applyQuaternion(q);
        return Math.atan2(f.x, f.z);
      };
      const stand = bodyPos().y - unit.pos.y;
      let seg = -1;
      let ref = null;
      const fol = { x: 0, z: 0, y: 0, init: false };
      window.__breakClock = () => routine()?.progress.t ?? 0;
      T.onFrame((t, dt) => {
        const rt = routine()?.active ? routine().progress.t : routine()?.lastCompleted ? 99 : -1;
        const b = bodyPos();
        const i = Math.max(0, setups.findIndex((x) => rt >= x.from && rt < x.to));
        const S = setups[i];
        if (i !== seg) {
          seg = i;
          ref = { yaw: S.yaw === 'sea' ? Math.atan2(-g.seaDirection().x, -g.seaDirection().z) : bodyYaw() };
          if (!fol.init) Object.assign(fol, { x: b.x, z: b.z, y: unit.pos.y, init: true });
        }
        const k1 = 1 - Math.exp(-(S.rate ?? 3) * Math.max(dt, 0));
        fol.x += (b.x - fol.x) * k1;
        fol.z += (b.z - fol.z) * k1;
        fol.y += (unit.pos.y - fol.y) * k1;
        const span = Math.max(1e-3, S.to - S.from);
        const k = T.ease(S.ease ?? 'inout', ((S.clock === 'shot' ? t : rt) - (S.clock === 'shot' ? 0 : S.from)) / (S.clock === 'shot' ? S.dur : span));
        const L = (v) => (Array.isArray(v) ? T.lerp(v[0], v[1], k) : v);
        const a = ref.yaw + L(S.az);
        const el = L(S.el);
        const dist = L(S.dist) * (port ? (S.portScale ?? distScale) : 1);
        const up = Math.max(0, b.y - unit.pos.y - stand) * (S.rise ?? 0.6);
        const lookY = fol.y + L(S.look) + up;
        const p = [fol.x + Math.sin(a) * Math.cos(el) * dist, lookY + Math.sin(el) * dist, fol.z + Math.cos(a) * Math.cos(el) * dist];
        T.place(g.camera, p, [fol.x, lookY, fol.z], L(S.fov ?? 36) * (port ? 1.6 : 1));
        g.engine.setFocus(Math.hypot(p[0] - b.x, p[1] - b.y, p[2] - b.z), S.focusRange ?? 4);
        if (hideNear > 0) {
          for (const u of g.units) {
            if (u !== unit && Math.hypot(u.pos.x - p[0], u.pos.z - p[2]) < hideNear) u.rig.root.visible = false;
          }
        }
      });
    },
    [setups, port, who, distScale, hideNear],
  );
}

/**
 * The probe every game shot records: the routine's clock, the move playing and how far into it
 * (BreakRoutine's own step clock, `t`, private in TypeScript).
 */
const playerProbe = () => {
  const r = window.cc.game.player.breakdance;
  return { rt: +r.progress.t.toFixed(4), step: r.stepIndex, st: +r.t.toFixed(4) };
};

/** Start the B routine (from standing, as the key does) and step to routine time `rt0`. */
async function breakTo(app, rt0) {
  await app.page.evaluate(() => window.cc.game.player.toggleBreakdance());
  if (rt0 > 0) await advance(app, rt0);
}

/** Take A: the whole routine at its own pace, a set-up per move. */
const routineA = [
  { from: -9, to: RT.sixstep, az: [0.6, 0.3], el: [0.12, 0.16], dist: [4.6, 3.8], look: 0.55, fov: 36 },
  { from: RT.sixstep, to: RT.spin, az: [-0.6, -0.95], el: [0.5, 0.42], dist: [4.8, 4.3], look: 0.3, fov: 36 },
  { from: RT.spin, to: JUMPS.from, az: [0.25, 0.65], el: [0.12, 0.16], dist: [3.9, 3.5], look: 0.5, fov: 36 },
  { from: JUMPS.from, to: JUMPS.to, az: [1.35, 1.5], el: [0.06, 0.06], dist: [5.6, 5.3], look: 1.0, rise: 0.45, fov: 36, portScale: 0.9 },
  { from: JUMPS.to, to: 999, az: [-0.75, -0.5], el: [0.1, 0.14], dist: [4.0, 3.4], look: 0.5, fov: 36 },
];
/** Take B: the other angles (the six-step from overhead, the jumps from below). */
const routineB = [
  { from: -9, to: RT.sixstep, az: [2.5, 2.1], el: [0.06, 0.09], dist: [4.0, 3.6], look: 0.5, fov: 40 },
  { from: RT.sixstep, to: RT.spin, az: [0.3, 0.6], el: [1.0, 0.9], dist: [5.0, 4.6], look: 0.15, fov: 38 },
  { from: RT.spin, to: JUMPS.from, az: [0.0, -0.3], el: [0.04, 0.2], dist: [3.4, 3.0], look: 0.5, fov: 42 },
  { from: JUMPS.from, to: JUMPS.to, az: [-1.1, -1.25], el: [-0.03, -0.03], dist: [4.8, 4.5], look: 1.1, rise: 0.5, fov: 40 },
  { from: JUMPS.to, to: 999, az: [-0.35, -0.05], el: [0.06, 0.06], dist: [3.5, 3.1], look: 0.45, fov: 38 },
];

const routineShot = (name, setups) => (layout) => async () => {
  const port = layout === 'port';
  const app = await openGame(layout, 'none', true);
  try {
    await breakCam(app.page, setups, { port });
    await advance(app, 0.2);
    await breakTo(app, 0);
    await record(app, shotFile(name, layout), { duration: RT.end + 0.9, stills, probe: playerProbe });
  } finally {
    await app.browser.close();
  }
};

/**
 * Slow motion around one jump: start the routine, step to `rt0`, record to `rt1` with time slowed
 * to `slow` between `s0` and `s1` (routine seconds), easing in and out of it over `ramp` seconds.
 */
const slowShot = (name, setup, { rt0, rt1, s0, s1, slow, ramp = 0.12 }) => (layout) => async () => {
  const port = layout === 'port';
  const app = await openGame(layout, 'none', true);
  try {
    // Step most of the way at full speed, then frame the crab where its body faces now.
    await breakTo(app, rt0);
    await breakCam(app.page, [{ from: -9, to: 999, ...setup }], { port });
    const speed = (t) => {
      const rt = rt0 + t;
      // `t` is shot seconds of game time, so the routine clock is rt0 + t.
      if (rt < s0 - ramp || rt > s1 + ramp) return 1;
      if (rt < s0) return 1 + (slow - 1) * ((rt - (s0 - ramp)) / ramp);
      if (rt > s1) return slow + (1 - slow) * ((rt - s1) / ramp);
      return slow;
    };
    await record(app, shotFile(name, layout), { duration: rt1 - rt0, speed, stills, probe: playerProbe });
  } finally {
    await app.browser.close();
  }
};

const SHOTS = {};
for (const layout of ['land', 'port']) {
  const sfx = layout === 'port' ? '-port' : '';
  SHOTS[`live${sfx}`] = liveShot(layout);
  SHOTS[`moves${sfx}`] = movesShot(layout);
  // The 720 at a quarter of real speed, from its front-left a little further back (the hook), and
  // the back flip at a fifth, from its side.
  SHOTS[`jump-live-slow${sfx}`] = slowJumpShot('jump-live-slow', 'power_jumpspin', { ...MOVE_CAM.power_jumpspin, az: [0.5, 0.75], dist: [1.1, 1.04], rise: 0.75, portScale: 0.95, dur: 2.5 }, 0.25)(layout);
  SHOTS[`flip-live-slow${sfx}`] = slowJumpShot('flip-live-slow', 'power_backflip', { ...MOVE_CAM.power_backflip, dur: 2.5 }, 0.2)(layout);
  for (const id of Object.keys(DANCES)) SHOTS[`${id.replaceAll('_', '-')}${sfx}`] = danceShot(id)(layout);
  SHOTS[`routine-a${sfx}`] = routineShot('routine-a', routineA)(layout);
  SHOTS[`routine-b${sfx}`] = routineShot('routine-b', routineB)(layout);
  // The hook: the back flip from its side at ground level, a seventh of real speed through the air.
  SHOTS[`flip-slow${sfx}`] = slowShot('flip-slow', { az: [1.57, 1.5], el: [0.03, 0.04], dist: [4.8, 4.5], look: 0.9, rise: 0.4, fov: 34, rate: 8, portScale: 0.95, clock: 'shot', dur: 1.2 },
    { rt0: FLIP.takeoff - 0.32, rt1: FLIP.land + 0.5, s0: FLIP.takeoff - 0.1, s1: FLIP.land + 0.065, slow: 0.15 })(layout);
  // The replays: the 720 from below, then the back flip again from its other side, above.
  SHOTS[`jump-slow${sfx}`] = slowShot('jump-slow', { az: [-0.45, -0.3], el: [-0.05, -0.03], dist: [4.8, 4.5], look: 1.1, rise: 0.6, fov: 38, rate: 8, portScale: 0.95, clock: 'shot', dur: 1.5 },
    { rt0: JUMP.takeoff - 0.6, rt1: JUMP.land + 0.575, s0: JUMP.takeoff - 0.035, s1: JUMP.land + 0.025, slow: 0.28 })(layout);
  SHOTS[`flip-slow2${sfx}`] = slowShot('flip-slow2', { az: [-1.9, -1.75], el: [0.3, 0.26], dist: [5.0, 4.7], look: 0.85, rise: 0.4, fov: 36, rate: 8, portScale: 0.95, clock: 'shot', dur: 1.2 },
    { rt0: FLIP.takeoff - 0.6, rt1: FLIP.land + 0.5, s0: FLIP.takeoff - 0.06, s1: FLIP.land + 0.065, slow: 0.2 })(layout);
}

// ------------------------------------------------------------------------------------ the ending

/**
 * The finale: the town in a ring around the hero, the routine at the ending, the ring cheering
 * the landings and the freeze, fireworks over the bay. Speech bubbles stay (the ring shouts at
 * the moves). Set-ups keyed on the ending routine's clock; the last ones look out to sea, where
 * the fireworks burst.
 */
const endingSetups = [
  // Inside the ring (it stands 4.2 units out): the hero's face before the break and at the
  // toprock, the footwork and the spin from overhead with the ring around, then from the land
  // side looking out to sea, where the fireworks burst: the jumps against the sky, the freeze
  // close, a crane up and away.
  { from: -99, to: 0.05, az: [0.6, 0.35], el: [0.12, 0.1], dist: [3.4, 3.1], look: 0.75, fov: 44, focusRange: 8 },
  { from: 0.05, to: RT.sixstep, az: [0.4, 0.15], el: [0.1, 0.1], dist: [3.3, 2.9], look: 0.7, fov: 40, focusRange: 7 },
  { from: RT.sixstep, to: JUMPS.from, az: [-0.4, -0.8], el: [0.95, 0.85], dist: [4.6, 4.2], look: 0.3, fov: 46, focusRange: 8 },
  { from: JUMPS.from, to: JUMPS.to, yaw: 'sea', az: [-0.35, -0.25], el: [0.02, 0.02], dist: [4.2, 4.0], look: 1.2, rise: 0.5, fov: 42, focusRange: 8 },
  { from: JUMPS.to, to: 98, yaw: 'sea', az: [0.2, 0.05], el: [0.06, 0.08], dist: [3.6, 3.2], look: 0.85, rise: 0, fov: 40, focusRange: 6 },
  { from: 98, to: 999, yaw: 'sea', az: [0.05, -0.2], el: [0.15, 0.7], dist: [3.2, 9.0], look: 1.0, rise: 0, fov: 46, focusRange: 10 },
];

const endingShot = (layout) => async () => {
  const port = layout === 'port';
  const app = await openGame(layout, 'plates');
  const { page } = app;
  try {
    await page.evaluate(() => void window.cc.game.ending.start());
    // Fade to black, gather the town, fade back in; the hero breaks 3.2 s after the ring forms.
    await advance(app, 3.3);
    await breakCam(page, endingSetups, { port, who: 'ending', distScale: 1.2, hideNear: 1.9 });
    await record(app, shotFile('ending', layout), {
      duration: 1.5 + RT.end + 3.5,
      stills,
      probe: () => {
        const r = window.cc.game.ending.routine;
        return { rt: r ? +r.progress.t.toFixed(4) : -1, step: r ? r.stepIndex : -1, st: r ? +r.t.toFixed(4) : -1, active: !!r?.active };
      },
    });
  } finally {
    await app.browser.close();
  }
};
SHOTS.ending = endingShot('land');
SHOTS['ending-port'] = endingShot('port');

// ------------------------------------------------------------------------------------ main

const all = Object.keys(SHOTS).filter((n) => layouts.includes(n.endsWith('-port') ? 'port' : 'land'));
const names = only.length ? all.filter((n) => only.includes(n.replace(/-port$/, ''))) : all;
if (only.length && !names.length) {
  console.error(`no shot matches ${only.join(', ')}; known: ${Object.keys(SHOTS).filter((n) => !n.endsWith('-port')).join(', ')}`);
  process.exit(2);
}
for (const n of names) {
  console.log(`shot ${n}`);
  await SHOTS[n]();
}
