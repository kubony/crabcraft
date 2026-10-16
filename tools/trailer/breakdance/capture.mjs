#!/usr/bin/env node
// Shots for the breakdance video, captured frame by frame in capture mode like the trailer's
// (tools/trailer/lib.mjs, src/capture/clock.ts): the bare robot breaking live in Robot Mode (the
// jumps included), the
// hero's routine in Clawhaven framed close, slow-motion takes of the 720 and the back flip, and the
// ending's finale with the town around the hero. Every shot exists for a landscape page
// (1920x1080) and a portrait one (1080x1920, name suffix -port), so the vertical cut is framed for
// its own screen instead of cropped out of the landscape one. Each sidecar JSON carries a `probe`
// per output frame (the routine's clock, or the robot's mode) for the edit to cut on the moves.
//
// Usage: node tools/trailer/breakdance/capture.mjs --url http://localhost:5241 --out <dir>
//          [--shots robot,routine-a] [--layout land|port|both] [--dsf 2] [--stills 0,120]
// Needs the dev server running (pnpm dev --port 5241 --strictPort). The whole video, from serving
// the app to the checked mp4s, is one command: node tools/trailer/breakdance/make.mjs (see there).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, css, openApp, record } from '../lib.mjs';
import { LENGTH, MOVE } from './routine.mjs';

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
 * The bare robot breaks live: toprock, six-step, the one-claw freeze, the spin (held, then let
 * go), the 720 and the back flip, each asked for from walking, as Shift + 1, 2, 4, 5, 6 and 7 do,
 * and handed back to walking before the next (the two jumps by the page's own press of their
 * switch after the landing, src/robot/sim/core.ts AUTO_LEAVE_S). The HUD keeps what says what is running (the mode card, the policy's name, the badges
 * that it is MuJoCo WASM and ONNX Runtime Web) and the dock's Breaking group, moved under the card.
 * The page's headline is hidden: the video's own captions say what this is.
 */
const robotShot = (layout) => async () => {
  const port = layout === 'port';
  const app = await openApp({ base, query: 'screen=robot', spec: HERO, dsf, size: SIZE[layout] });
  const { page } = app;
  const MODES = ['break_toprock', 'break_sixstep', 'break_oneclaw', 'power_spin', 'power_jumpspin', 'power_backflip'];
  try {
    await page.waitForFunction((m) => window.__robotMode && m.every((x) => window.__robotMode.client.policies.has(x)), MODES, { timeout: 180000 });
    await page.evaluate(() => window.__robotMode.handle.setAppearance('bare'));
    await page.evaluate(() => {
      for (const g of document.querySelectorAll('.rm-dock .rm-group')) {
        if (g.querySelector('.gl')?.textContent?.trim().toLowerCase() === 'breaking') g.classList.add('cap-break');
      }
    });
    await css(page, `
      .rm-tools, .rm-help, .rm-notice, .rm-log, .rm-look, .rm-title, .rm-sub { display: none !important; }
      .rm { transition: none !important; }
      .rm-dock { left: 28px !important; right: auto !important; top: ${port ? 470 : 448}px !important; bottom: auto !important;
        transform: none !important; max-width: none !important; justify-content: flex-start !important; }
      .rm-dock > .rm-group:not(.cap-break) { display: none !important; }
      .rm-dock > .rm-group.cap-break { border-left: none !important; padding-left: 4px !important; }
    `);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__capture.begin());
    await advance(app, 1.5);
    // Press times (shot seconds), from walking each time; measured in Robot Mode: the toprock runs
    // 6.2 s after its 0.8 s ramp, the six-step 5.3 s, the one-claw 6.5 s; the spin runs until let go
    // and is walking again 1.1 s later; each jump is walking again about 2.8 s after its press (the
    // ramp, the jump, the page's press 1.4 s or 1.2 s after the handover, the ramp back).
    const AT = { toprock: 0.3, sixstep: 7.9, oneclaw: 14.6, spin: 22.5, release: 26.7, jumpspin: 28.6, backflip: 32.0, end: 35.2 };
    await page.evaluate(([AT, port]) => {
      const R = window.__robotMode;
      R.orbit.update = () => {};
      const T = window.__T;
      const cam = R.orbit.camera;
      // One set-up per move: azimuth from the robot's front, elevation, distance, look height,
      // each eased from the first value to the second over the window.
      const SETUPS = [
        { from: 0, to: AT.sixstep - 0.2, az: [0.55, 0.2], el: [0.16, 0.1], dist: [0.72, 0.62], lookY: [0.075, 0.08], fov: 30 },
        { from: AT.sixstep - 0.2, to: AT.oneclaw - 0.2, az: [-0.5, -0.85], el: [0.5, 0.42], dist: [0.76, 0.68], lookY: [0.05, 0.05], fov: 30 },
        { from: AT.oneclaw - 0.2, to: AT.spin - 0.2, az: [0.9, 0.55], el: [0.12, 0.08], dist: [0.74, 0.64], lookY: [0.085, 0.09], fov: 30 },
        { from: AT.spin - 0.2, to: AT.jumpspin - 0.2, az: [-0.25, 0.15], el: [0.22, 0.16], dist: [0.68, 0.62], lookY: [0.07, 0.075], fov: 30 },
        // The jumps go 0.25 m up: further back and a higher look point keep the apex in frame; the
        // flip from its side, where the turn is.
        { from: AT.jumpspin - 0.2, to: AT.backflip - 0.2, az: [0.45, 0.6], el: [0.12, 0.12], dist: [1.3, 1.25], lookY: [0.2, 0.2], fov: 30 },
        { from: AT.backflip - 0.2, to: AT.end + 1, az: [1.5, 1.6], el: [0.07, 0.07], dist: [1.02, 0.98], lookY: [0.17, 0.17], fov: 30 },
      ];
      // The portrait page is narrower: a wider lens and a little more distance keep the robot's
      // width in frame without leaving the desk.
      const distScale = port ? 1.35 : 1;
      const fovScale = port ? 1.6 : 1;
      let seg = -1;
      let ref = null;
      T.onFrame((t) => {
        const s = R.handle.getState();
        const b = s.base.position;
        const i = Math.max(0, SETUPS.findIndex((x) => t >= x.from && t < x.to));
        const S = SETUPS[i];
        if (i !== seg) {
          seg = i;
          const fwd = b.clone().set(0, 0, 1).applyQuaternion(s.base.quaternion);
          ref = { x: b.x, z: b.z, yaw: Math.atan2(fwd.x, fwd.z) };
        }
        const k = T.ease('inout', (t - S.from) / (S.to - S.from));
        const cx = T.lerp(ref.x, b.x, 0.7);
        const cz = T.lerp(ref.z, b.z, 0.7);
        const a = ref.yaw + T.lerp(S.az[0], S.az[1], k);
        const el = T.lerp(S.el[0], S.el[1], k);
        const dist = T.lerp(S.dist[0], S.dist[1], k) * distScale;
        const lookY = T.lerp(S.lookY[0], S.lookY[1], k);
        const p = [cx + Math.sin(a) * Math.cos(el) * dist, lookY + Math.sin(el) * dist, cz + Math.cos(a) * Math.cos(el) * dist];
        T.place(cam, p, [cx, lookY, cz], S.fov * fovScale);
        R.engine.setFocus(Math.hypot(p[0] - b.x, p[1] - b.y * 0.6, p[2] - b.z), 0.2);
      });
    }, [AT, port]);
    const press = (mode) => (p) =>
      p.evaluate((mode) => {
        if (!window.__robotMode.handle.requestMode(mode)) throw new Error(`Robot Mode refused ${mode} in ${window.__robotMode.handle.getState().mode}`);
      }, mode);
    await record(app, shotFile('robot', layout), {
      duration: AT.end,
      stills,
      events: [
        { t: AT.toprock, mark: 'toprock', fn: press('break_toprock') },
        { t: AT.sixstep, mark: 'sixstep', fn: press('break_sixstep') },
        { t: AT.oneclaw, mark: 'oneclaw', fn: press('break_oneclaw') },
        { t: AT.spin, mark: 'spin', fn: press('power_spin') },
        { t: AT.release, mark: 'release', fn: (p) => p.evaluate(() => window.__robotMode.handle.release()) },
        { t: AT.jumpspin, mark: 'jumpspin', fn: press('power_jumpspin') },
        { t: AT.backflip, mark: 'backflip', fn: press('power_backflip') },
      ],
      probe: () => {
        const s = window.__robotMode.handle.getState();
        return { mode: s.mode, run: s.runningPolicy };
      },
    });
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
  SHOTS[`robot${sfx}`] = robotShot(layout);
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
