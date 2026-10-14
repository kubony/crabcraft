#!/usr/bin/env node
// Trailer shots, captured frame by frame in capture mode (src/capture/clock.ts, tools/trailer/lib.mjs).
// Every shot opens its own page, sets the scene up through the game's debug handles, scripts the
// camera and records a 4K intermediate (2x device scale) plus a JSON sidecar with the output frame
// of every marked event.
//
// Usage: node tools/trailer/capture.mjs --url http://localhost:5213 --out <dir> [--shots robot,create]
//          [--dsf 2] [--stills 0,120,240]
// Needs the dev server running (pnpm dev --port 5213 --strictPort). The whole trailer:
//   node tools/trailer/capture.mjs --out $W/shots
//   node tools/trailer/cards.mjs --out $W/cards --layout land; node tools/trailer/cards.mjs --out $W/cards --layout port
//   node tools/trailer/edit.mjs --shots $W/shots --cards $W/cards --work $W/work --cut land --out crabcraft-trailer-1080p.mp4
//   node tools/trailer/edit.mjs --shots $W/shots --cards $W/cards --work $W/work --cut port --out crabcraft-trailer-vertical-1080x1920.mp4
//   python3 tools/trailer/contact_sheet.py crabcraft-trailer-1080p.mp4 crabcraft-trailer-contact-sheet.png
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, css, openApp, record, SPECS } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5213');
const outDir = resolve(opt('--out', 'trailer-out'));
const dsf = Number(opt('--dsf', '2'));
const stills = (opt('--stills', '') || '').split(',').filter(Boolean).map(Number);
const only = opt('--shots', '').split(',').filter(Boolean);
mkdirSync(outDir, { recursive: true });

const SHOTS = {};

// ------------------------------------------------------------------------------------ Robot Mode

/** Beats 1 to 3: the bare robot wakes, dances dance_crab live with the HUD, then T turns it into an Orc warrior. */
SHOTS.robot = async () => {
  const app = await openApp({ base, query: 'screen=robot', spec: SPECS.orcWarrior, dsf });
  const { page } = app;
  await page.waitForFunction(
    () => window.__robotMode && window.__robotMode.client.policies.has('dance_crab') && window.__robotMode.layer.crab,
    null,
    { timeout: 120000 },
  );
  // Start bare; the Orc is already dressed (hidden) so the switch never waits on a download.
  await page.evaluate(() => window.__robotMode.handle.setAppearance('bare'));
  await css(page, `
    .rm-tools, .rm-dock, .rm-help, .rm-notice, .rm-log { display: none !important; }
    .rm { transition: none !important; }
    body.cap-hud-off .rm > *:not(.rm-loading) { opacity: 0 !important; }
    body.cap-look-off .rm-look { opacity: 0 !important; }
  `);
  await page.evaluate(() => document.body.classList.add('cap-hud-off'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__capture.begin());
  await advance(app, 1.5);
  await page.evaluate(() => {
    const R = window.__robotMode;
    R.orbit.update = () => {};
    const T = window.__T;
    const s0 = R.handle.getState();
    const b0 = s0.base.position.clone();
    const fwd = s0.base.position.clone().set(0, 0, 1).applyQuaternion(s0.base.quaternion);
    const yaw0 = Math.atan2(fwd.x, fwd.z);
    // Camera around the robot: azimuth from its front, elevation, distance, look height.
    const orbitAt = (az, el, dist, lookY, centre) => {
      const a = yaw0 + az;
      const c = centre ?? b0;
      const p = [c.x + Math.sin(a) * Math.cos(el) * dist, lookY + Math.sin(el) * dist, c.z + Math.cos(a) * Math.cos(el) * dist];
      return { p, l: [c.x, lookY, c.z] };
    };
    const cam = R.orbit.camera;
    window.__robotShot = { b0, yaw0 };
    T.onFrame((t) => {
      const s = R.handle.getState();
      const b = s.base.position;
      // Follow the body softly (the dance sways it a few centimetres).
      const centre = { x: T.lerp(b0.x, b.x, 0.7), z: T.lerp(b0.z, b.z, 0.7) };
      let az;
      let el;
      let dist;
      let lookY;
      let fov;
      if (t < 6.2) {
        // A: slow push-in on the face at eye level.
        const k = T.ease('out', t / 6.2);
        az = T.lerp(0.5, 0.18, k);
        el = T.lerp(0.06, 0.13, k);
        dist = T.lerp(0.8, 0.48, k);
        lookY = T.lerp(0.07, 0.085, k);
        fov = 30;
      } else if (t < 14.3) {
        // B: the dance, wide enough for the HUD around it, drifting across its front.
        const k = T.ease('inout', (t - 6.2) / 8.1);
        az = T.lerp(-0.1, 0.35, k);
        el = T.lerp(0.3, 0.22, k);
        dist = T.lerp(1.05, 0.95, k);
        lookY = 0.075;
        fov = 32;
      } else {
        // C: closer for the switch, easing round to the other side.
        const k = T.ease('out', (t - 14.3) / 5);
        az = T.lerp(-0.2, 0.15, k);
        el = T.lerp(0.24, 0.3, k);
        dist = T.lerp(1.08, 0.94, k);
        lookY = 0.09;
        fov = 30;
      }
      const { p, l } = orbitAt(az, el, dist, lookY, centre);
      T.place(cam, p, l, fov);
      const fd = Math.hypot(p[0] - b.x, p[1] - b.y * 0.6, p[2] - b.z);
      R.engine.setFocus(fd, 0.22);
    });
  });
  return record(app, resolve(outDir, 'robot'), {
    duration: 19.5,
    stills,
    speed: (t) => (t > 14.25 && t < 15.9 ? 0.45 : 1),
    events: [
      { t: 0, mark: 'A' },
      { t: 4.7, mark: 'dance', fn: (p) => p.evaluate(() => window.__robotMode.handle.requestMode('dance_crab')) },
      // The appearance panel waits for the switch, so the long caption has the bottom to itself.
      { t: 6.2, mark: 'B', fn: (p) => p.evaluate(() => document.body.classList.remove('cap-hud-off') || document.body.classList.add('cap-look-off')) },
      { t: 14.3, mark: 'C', fn: (p) => p.evaluate(() => document.body.classList.remove('cap-look-off')) },
      { t: 14.6, mark: 'switch', fn: (p) => p.evaluate(() => window.__robotMode.handle.setAppearance('crab')) },
    ],
  }).finally(() => app.browser.close());
};

/**
 * Beat 3b: three of the six skills trained for this game (jumper.skill_*), played live in Robot
 * Mode on their own keys: the slam, the cast and the power-down, each from standing and each handed
 * back to the walking policy before the next one. The HUD's mode card names the running policy and
 * the dock's Skills group (all six, the active one lit) sits under it. `layout` 'port' renders the
 * same take on a 1080x1920 page for the vertical cut, where the HUD lays itself out for the narrow
 * screen instead of being cropped away.
 */
const skillsShot = (layout) => async () => {
  const port = layout === 'port';
  const size = port ? [1080, 1920] : [1920, 1080];
  const app = await openApp({ base, query: 'screen=robot', spec: SPECS.orcWarrior, dsf, size });
  const { page } = app;
  const SKILLS = ['skill_slam', 'skill_cast', 'skill_powerdown'];
  await page.waitForFunction(
    (skills) => window.__robotMode && skills.every((m) => window.__robotMode.client.policies.has(m)),
    SKILLS,
    { timeout: 180000 },
  );
  await page.evaluate(() => window.__robotMode.handle.setAppearance('bare'));
  // Only the Skills group of the dock, moved under the mode card, clear of the captions.
  await page.evaluate(() => {
    for (const g of document.querySelectorAll('.rm-dock .rm-group')) {
      if (g.querySelector('.gl')?.textContent?.trim().toLowerCase() === 'skills') g.classList.add('cap-skills');
    }
  });
  await css(page, `
    .rm-tools, .rm-help, .rm-notice, .rm-log, .rm-look { display: none !important; }
    .rm { transition: none !important; }
    .rm-dock { left: 28px !important; right: auto !important; top: ${port ? 452 : 430}px !important; bottom: auto !important;
      transform: none !important; max-width: none !important; justify-content: flex-start !important; }
    .rm-dock > .rm-group:not(.cap-skills) { display: none !important; }
    .rm-dock > .rm-group.cap-skills { border-left: none !important; padding-left: 4px !important; }
  `);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__capture.begin());
  await advance(app, 1.5);
  // Press times (shot seconds): each skill hands back to locomotion before the next one is asked
  // for (they are bound from locomotion only). Measured in Robot Mode: the slam takes 4.1 s from the
  // press to the hand-back, the cast 5.7 s, the power-down 5.7 s.
  const AT = { slam: 0.3, cast: 5.0, powerdown: 11.2 };
  await page.evaluate(([AT, port]) => {
    const R = window.__robotMode;
    R.orbit.update = () => {};
    const T = window.__T;
    const cam = R.orbit.camera;
    // One set-up per skill: azimuth from the robot's front, elevation, distance and look height,
    // each eased from the first value to the second over the skill's window.
    const SETUPS = [
      { from: 0, to: AT.cast - 0.1, az: [0.62, 0.4], el: [0.12, 0.09], dist: [0.92, 0.8], lookY: [0.09, 0.09], fov: 30 },
      { from: AT.cast - 0.1, to: AT.powerdown - 0.1, az: [-0.5, -0.3], el: [0.2, 0.16], dist: [0.9, 0.78], lookY: [0.09, 0.09], fov: 30 },
      { from: AT.powerdown - 0.1, to: AT.powerdown + 4.4, az: [1.0, 0.72], el: [0.3, 0.22], dist: [0.92, 0.76], lookY: [0.065, 0.05], fov: 30 },
    ];
    // The portrait page is narrower: pull back so the robot keeps its size against the width.
    const distScale = port ? 2.0 : 1;
    let seg = -1;
    let ref = null;
    T.onFrame((t) => {
      const s = R.handle.getState();
      const b = s.base.position;
      const i = Math.max(0, SETUPS.findIndex((x) => t >= x.from && t < x.to));
      const S = SETUPS[i];
      if (i !== seg) {
        // A new set-up frames the robot where it stands now, facing the way it faces now.
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
      T.place(cam, p, [cx, lookY, cz], S.fov);
      R.engine.setFocus(Math.hypot(p[0] - b.x, p[1] - b.y * 0.6, p[2] - b.z), 0.22);
    });
  }, [AT, port]);
  const press = (mode) => (p) =>
    p.evaluate((mode) => {
      if (!window.__robotMode.handle.requestMode(mode)) throw new Error(`Robot Mode refused ${mode} in ${window.__robotMode.handle.getState().mode}`);
    }, mode);
  return record(app, resolve(outDir, port ? 'skills-port' : 'skills'), {
    duration: AT.powerdown + 4.4,
    stills,
    events: [
      { t: AT.slam, mark: 'slam', fn: press('skill_slam') },
      { t: AT.cast, mark: 'cast', fn: press('skill_cast') },
      { t: AT.powerdown, mark: 'powerdown', fn: press('skill_powerdown') },
    ],
  }).finally(() => app.browser.close());
};
SHOTS.skills = skillsShot('land');
SHOTS['skills-port'] = skillsShot('port');

// ------------------------------------------------------------------------------------ Creation

/** Beat 5: all six races on the dais, a class change, then Randomize. */
SHOTS.create = async () => {
  const app = await openApp({ base, query: 'screen=create', spec: null, dsf });
  const { page } = app;
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    // Load every race's gear and every class weapon once, in real time, so no swap waits on a download.
    for (const r of ['orc', 'dwarf', 'undead', 'nightelf', 'tauren', 'human']) {
      await page.evaluate((r) => window.app.current.pickRace(r), r);
      await page.waitForTimeout(700);
    }
    for (const c of ['mage', 'priest', 'warrior']) {
      await page.evaluate((c) => window.app.current.pickClass(c), c);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__capture.begin());
    await advance(app, 0.5);
    const pick = (r) => (p) => p.evaluate((r) => window.app.current.pickRace(r), r);
    const cls = (c) => (p) => p.evaluate((c) => window.app.current.pickClass(c), c);
    const rnd = (p) => p.evaluate(() => window.app.current.randomize());
    await record(app, resolve(outDir, 'create'), {
      duration: 11.2,
      stills,
      events: [
        { t: 0.0, mark: 'human' },
        { t: 0.9, mark: 'orc', fn: pick('orc') },
        { t: 2.0, mark: 'dwarf', fn: pick('dwarf') },
        { t: 3.1, mark: 'undead', fn: pick('undead') },
        { t: 4.2, mark: 'nightelf', fn: pick('nightelf') },
        { t: 5.3, mark: 'tauren', fn: pick('tauren') },
        { t: 6.4, mark: 'mage', fn: cls('mage') },
        { t: 7.5, mark: 'rnd1', fn: rnd },
        { t: 8.7, mark: 'rnd2', fn: rnd },
        { t: 9.9, mark: 'rnd3', fn: rnd },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

// ------------------------------------------------------------------------------------ Clawhaven

/** What of the game HUD a shot shows. */
const HUD = {
  none: `.hud > * { display: none !important; }`,
  // Nameplates, quest marks, speech bubbles and floating combat text only.
  plates: `.hud > *:not(.plates) { display: none !important; }`,
  // Plus the boss frame, the cast bar and the big banners.
  combat: `.hud > *:not(.plates):not(.bf):not(.castbar):not(.hud-keep) { display: none !important; }
    .hud > .caption, .hud > .letterbox, .msg-errors { display: none !important; }`,
};

/** Open Clawhaven with a saved crab, wait for the loading painting to go, freeze the clock. */
async function openGame(spec, hud = 'none') {
  const app = await openApp({ base, query: 'screen=game&debug=1', spec, dsf });
  const { page } = app;
  await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 120000 });
  // The loading painting fades for a second; the intro greeting comes 4.6 s in.
  await page.waitForTimeout(5200);
  const style = await css(page, HUD[hud]);
  app.setHud = async (name) => {
    await page.evaluate(([el, c]) => (el.textContent = c), [style, HUD[name]]);
  };
  await page.evaluate(() => {
    const g = window.cc.game;
    g.follow.update = () => {};
    g.god = true;
    g.hud.debugEl.classList.add('hidden');
    g.hud.chat.el.style.display = 'none';
    g.player.unit.blessingUntil = 0;
    // No golden quest beam or breadcrumbs in the shots.
    g.objectivePos = () => null;
    // Shot helpers.
    const T = window.__T;
    const C = {};
    C.g = g;
    C.v3 = (v) => [v.x, v.y, v.z];
    /** Orbit a moving subject: yaw (world), elevation (rad), distance, look height, all lerped by k. */
    C.orbit = (centre, yaw, el, dist, lookY) => {
      const p = [centre.x + Math.sin(yaw) * Math.cos(el) * dist, centre.y + lookY + Math.sin(el) * dist, centre.z + Math.cos(yaw) * Math.cos(el) * dist];
      return { p, l: [centre.x, centre.y + lookY, centre.z] };
    };
    /** A smoothed copy of a moving point (camera follow without jitter). */
    C.follower = (get, rate = 4) => {
      const s = { x: 0, y: 0, z: 0, init: false };
      return (dt) => {
        const v = get();
        if (!s.init) Object.assign(s, { x: v.x, y: v.y, z: v.z, init: true });
        const k = 1 - Math.exp(-rate * Math.max(dt, 0));
        s.x += (v.x - s.x) * k;
        s.y += (v.y - s.y) * k;
        s.z += (v.z - s.z) * k;
        return s;
      };
    };
    /** Full rage or mana, no cooldowns, no global cooldown. */
    C.ready = () => {
      const pl = g.player;
      pl.resource = pl.maxResource;
      pl.cooldowns.clear();
      pl.gcdEnd = 0;
      pl.queued = null;
    };
    C.ground = (x, z) => g.world.heightAt(x, z);
    window.__C = C;
  });
  await page.evaluate(() => window.__capture.begin());
  return app;
}

/** Beat 6: a crane over Clawhaven toward the lighthouse, then Captain Brinebeard waving. */
SHOTS.town = async () => {
  const app = await openGame(SPECS.warrior, 'none');
  const { page } = app;
  try {
    // The hero walks toward the fountain while the camera rises over the roofs.
    await page.evaluate(() => {
      const { g } = window.__C;
      const p = g.player.unit;
      p.teleport(g.world, -5.5, 17.5, Math.atan2(4.5, -7.5));
      g.follow.yaw = p.yaw + Math.PI;
    });
    await advance(app, 0.3);
    await page.evaluate(() => {
      const T = window.__T;
      const { g } = window.__C;
      const keys = [
        { t: 0, p: [-8.5, 5.3, 21], l: [4, 5.4, 6], fov: 50 },
        { t: 2.4, p: [-10, 12, 23], l: [30, 10, -10], fov: 50 },
        { t: 4.6, p: [-15, 21, 31], l: [80, 14, -60], fov: 48 },
        { t: 7, p: [-27, 33, 46], l: [150, 21, -110], fov: 46 },
      ];
      T.onFrame((t) => {
        const c = T.path(keys, t, { ease: 'inout' });
        T.place(g.camera, c.p, c.l, c.fov);
      });
    });
    await page.keyboard.down('KeyW');
    await record(app, resolve(outDir, 'town-crane'), {
      duration: 7,
      stills,
      events: [{ t: 3.2, fn: (p) => p.keyboard.up('KeyW') }],
    });
    // Brinebeard at the fountain: wave, quest mark, speech bubble.
    await app.setHud('plates');
    await page.evaluate(() => {
      const { g } = window.__C;
      const p = g.player.unit;
      const n = g.npcById('brinebeard');
      const b = n.unit;
      // The hero waits across the square, out of frame; Brinebeard faces the square and the viewer.
      p.teleport(g.world, -14, 2, 0);
      b.setYaw(n.poi.yaw);
    });
    await advance(app, 0.4);
    await page.evaluate(() => {
      const T = window.__T;
      const { g } = window.__C;
      const n = g.npcById('brinebeard');
      const b = n.unit;
      const head = [b.pos.x, b.pos.y + 0.85, b.pos.z];
      const f = n.poi.yaw;
      T.onFrame((t) => {
        const k = T.ease('out', t / 4);
        const yaw = f + T.lerp(0.45, 0.2, k);
        const dist = T.lerp(4.2, 3.3, k);
        const p = [b.pos.x + Math.sin(yaw) * dist, b.pos.y + T.lerp(1.5, 1.25, k), b.pos.z + Math.cos(yaw) * dist];
        T.place(g.camera, p, head, 38);
      });
    });
    await record(app, resolve(outDir, 'town-brine'), {
      duration: 4.2,
      stills,
      events: [
        {
          t: 0.25,
          mark: 'wave',
          fn: (p) =>
            p.evaluate(() => {
              const { g } = window.__C;
              const b = g.npcById('brinebeard').unit;
              b.act('gesture_hello');
              g.say(b, 'Ahoy! Over here, fresh shell!');
            }),
        },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

// ------------------------------------------------------------------------------------ Combat

/** Put the hero next to a Scrapling pack on the Brine Shore and set the pack on them. */
async function meetPack(page, near, standOff, extra = {}) {
  await page.evaluate(
    ([near, standOff, extra]) => {
      const { g } = window.__C;
      const p = g.player.unit;
      const pack = g.enemies.filter((e) => !e.isAdd && e.kind === (extra.kind ?? 'scrapling') && e.unit.alive && Math.hypot(e.unit.pos.x - near[0], e.unit.pos.z - near[1]) < 9);
      const cx = pack.reduce((a, e) => a + e.unit.pos.x, 0) / pack.length;
      const cz = pack.reduce((a, e) => a + e.unit.pos.z, 0) / pack.length;
      const px = cx + standOff[0];
      const pz = cz + standOff[1];
      p.teleport(g.world, px, pz, Math.atan2(cx - px, cz - pz));
      g.player.setTarget(pack[0].unit);
      if (extra.aggro !== false) for (const e of pack) e.aggro(false);
      window.__pack = { cx, cz, n: pack.length };
    },
    [near, standOff, extra],
  );
}

/** Orbit the hero during a fight: yaw relative to the hero-to-pack line. */
async function fightCam(page, o) {
  await page.evaluate((o) => {
    const T = window.__T;
    const C = window.__C;
    const { g } = C;
    const p = g.player.unit;
    const pk = window.__pack;
    const base = Math.atan2(p.pos.x - pk.cx, p.pos.z - pk.cz);
    const fol = C.follower(() => ({ x: T.lerp(p.pos.x, pk.cx, o.mix ?? 0.3), y: p.pos.y, z: T.lerp(p.pos.z, pk.cz, o.mix ?? 0.3) }), o.rate ?? 3);
    T.onFrame((t, dt) => {
      const c = fol(dt);
      const k = T.ease(o.ease ?? 'inout', t / o.dur);
      const cam = C.orbit(c, base + T.lerp(o.az[0], o.az[1], k), T.lerp(o.el[0], o.el[1], k), T.lerp(o.dist[0], o.dist[1], k), o.lookY ?? 0.8);
      T.place(g.camera, cam.p, cam.l, o.fov ?? 50);
    });
  }, o);
}

const use = (slot) => (p) => p.evaluate((s) => {
  window.__C.ready();
  window.__C.g.player.useAbility(s);
}, slot);

/** Beat 7a: the warrior charges a pack and spins a Whirlpool. */
SHOTS.warrior = async () => {
  const app = await openGame(SPECS.warrior, 'plates');
  const { page } = app;
  try {
    await meetPack(page, [113, -7.5], [-7.5, 3]);
    await fightCam(page, { dur: 4.5, az: [0.95, 1.45], el: [0.2, 0.3], dist: [7, 6], mix: 0.35 });
    await record(app, resolve(outDir, 'warrior'), {
      duration: 4.6,
      stills,
      speed: (t) => (t > 2.05 && t < 2.95 ? 0.4 : 1),
      events: [
        { t: 0.25, mark: 'charge', fn: use(3) },
        { t: 1.3, mark: 'strike', fn: use(1) },
        { t: 2.1, mark: 'whirlpool', fn: use(4) },
        { t: 3.3, fn: use(2) },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

/** Beat 7b: the Night Elf mage freezes a pack, then Tidal Nova throws it back. */
SHOTS.mage = async () => {
  const app = await openGame(SPECS.mage, 'plates');
  const { page } = app;
  try {
    await meetPack(page, [113.7, 9.5], [-6.5, -3]);
    await fightCam(page, { dur: 4, az: [-2.05, -1.65], el: [0.16, 0.24], dist: [6.4, 5.6], mix: 0.4 });
    await record(app, resolve(outDir, 'mage'), {
      duration: 4.2,
      stills,
      speed: (t) => (t > 2.2 && t < 3.0 ? 0.4 : 1),
      events: [
        { t: 1.0, mark: 'frost', fn: use(2) },
        { t: 2.25, mark: 'nova', fn: use(4) },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

/** Beat 7c: the Tauren priest smites, then Holy Tide. */
SHOTS.priest = async () => {
  const app = await openGame(SPECS.priest, 'plates');
  const { page } = app;
  try {
    await meetPack(page, [116, 62], [-5.5, -4.5]);
    await fightCam(page, { dur: 4, az: [-1.95, -1.55], el: [0.18, 0.26], dist: [6.8, 6], mix: 0.3 });
    await record(app, resolve(outDir, 'priest'), {
      duration: 4.2,
      stills,
      speed: (t) => (t > 2.3 && t < 3.1 ? 0.4 : 1),
      events: [
        { t: 0.1, mark: 'smite', fn: use(1) },
        { t: 2.35, mark: 'tide', fn: use(4) },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

/** Beat 7d: a Rustclaw Scavenger leaps at the hero across the open sand. */
SHOTS.leap = async () => {
  const app = await openGame(SPECS.warrior, 'plates');
  const { page } = app;
  try {
    await page.evaluate(() => {
      const { g } = window.__C;
      const p = g.player.unit;
      const e = g.enemies.find((e) => e.kind === 'scavenger' && !e.isAdd);
      // Hero on the flat beach facing inland, the scavenger 7.5 m up the beach.
      p.teleport(g.world, 111, 26, Math.atan2(0, 1));
      e.unit.teleport(g.world, 111, 33.5, Math.PI);
      e.home.set(111, e.unit.pos.y, 33.5);
      g.player.setTarget(e.unit);
      window.__leaper = e;
      window.__pack = { cx: 111, cz: 33.5, n: 1 };
    });
    await fightCam(page, { dur: 3.5, az: [-1.85, -1.6], el: [0.12, 0.16], dist: [6.6, 6.1], mix: 0.5, lookY: 1.0 });
    await record(app, resolve(outDir, 'leap'), {
      duration: 3.6,
      stills,
      speed: (t) => (t > 0.45 && t < 1.35 ? 0.45 : 1),
      events: [
        {
          t: 0.05,
          mark: 'aggro',
          fn: (p) =>
            p.evaluate(() => {
              const e = window.__leaper;
              e.aggro(false);
              e.leapCd = 0;
            }),
        },
        { t: 1.9, fn: use(1) },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

// ------------------------------------------------------------------------------------ The wreck

/** Beat 8: the beacon blazes, night falls, Corrodius rises, Anchor Slam, phase 2. Beat 9a: he falls. */
SHOTS.boss = async () => {
  const app = await openGame(SPECS.warrior, 'combat');
  const { page } = app;
  try {
    // --- The beacon, seen from the headland as it blazes.
    await page.evaluate(() => {
      const { g } = window.__C;
      const b = g.world.pois.beacon.position;
      const p = g.player.unit;
      p.teleport(g.world, b.x, b.z, 1.94 + Math.PI);
      g.player.setTarget(null);
      g.world.setMood(1);
    });
    // Night falls and the zone banner passes before the shot.
    await advance(app, 5);
    await page.evaluate(() => {
      const T = window.__T;
      const { g } = window.__C;
      const b = g.world.pois.beacon.position;
      const keys = [
        { t: 0, p: [b.x + 46, b.y - 10, b.z - 21], l: [b.x, b.y + 0.5, b.z], fov: 38 },
        { t: 3.6, p: [b.x + 38, b.y - 7, b.z - 17], l: [b.x, b.y + 1, b.z], fov: 38 },
      ];
      T.onFrame((t) => {
        const c = T.path(keys, t, { ease: 'out' });
        T.place(g.camera, c.p, c.l, c.fov);
      });
    });
    await record(app, resolve(outDir, 'beacon'), {
      duration: 3.6,
      stills,
      events: [
        { t: 0.7, mark: 'blaze', fn: (p) => p.evaluate(() => window.__C.g.lightBeacon()) },
      ],
    });

    // --- Night falls over the wreck and Corrodius heaves himself up.
    await app.setHud('none');
    await page.evaluate(() => {
      const { g } = window.__C;
      const a = g.world.pois.bossArena;
      const p = g.player.unit;
      // The hero waits at the foot of the deck, behind the camera.
      p.teleport(g.world, a.position.x + Math.sin(a.yaw) * 16, a.position.z + Math.cos(a.yaw) * 16, a.yaw + Math.PI);
    });
    await page.evaluate(() => {
      const T = window.__T;
      const { g } = window.__C;
      const a = g.world.pois.bossArena;
      const c = a.position;
      const f = a.yaw;
      const at = (yaw, d, h) => [c.x + Math.sin(f + yaw) * d, c.y + h, c.z + Math.cos(f + yaw) * d];
      const keys = [
        { t: 0, p: at(0.4, 11, 0.9), l: [c.x, c.y + 1.8, c.z], fov: 46 },
        { t: 4.8, p: at(0.2, 8.6, 0.7), l: [c.x, c.y + 3.4, c.z], fov: 46 },
      ];
      T.onFrame((t) => {
        const k = T.path(keys, t, { ease: 'inout' });
        T.place(g.camera, k.p, k.l, k.fov);
      });
    });
    await record(app, resolve(outDir, 'rise'), {
      duration: 4.8,
      stills,
      events: [
        {
          t: 0.8,
          mark: 'wake',
          fn: (p) =>
            p.evaluate(() => {
              const { g } = window.__C;
              g.boss.wake();
              g.audio.sfx('sfx-boss-roar');
            }),
        },
      ],
    });

    // --- The fight: Anchor Slam on the hero, then phase 2 and the Scraplings.
    await app.setHud('combat');
    await page.evaluate(() => {
      const { g } = window.__C;
      const a = g.world.pois.bossArena;
      const p = g.player.unit;
      const bu = g.boss.unit;
      // Finish the rise if it is still going.
      for (let i = 0; i < 400 && g.boss.state === 'waking'; i++) g.boss.update(0.02);
      const px = bu.pos.x + Math.sin(a.yaw) * 6.5;
      const pz = bu.pos.z + Math.cos(a.yaw) * 6.5;
      p.teleport(g.world, px, pz, a.yaw + Math.PI);
      g.player.setTarget(bu);
      g.boss.engage();
      // First mechanic soon: the slam.
      g.boss.mechIndex = 0;
      g.boss.nextMech = g.time + 0.5;
      g.boss.nextSwing = g.time + 30;
    });
    await page.evaluate(() => {
      const T = window.__T;
      const C = window.__C;
      const { g } = C;
      const a = g.world.pois.bossArena;
      const p = g.player.unit;
      const bu = g.boss.unit;
      const fol = C.follower(() => ({ x: T.lerp(p.pos.x, bu.pos.x, 0.45), y: p.pos.y, z: T.lerp(p.pos.z, bu.pos.z, 0.45) }), 2.5);
      T.onFrame((t, dt) => {
        const c = fol(dt);
        const k = T.ease('inout', t / 6);
        const cam = C.orbit(c, a.yaw + T.lerp(0.9, 0.6, k), T.lerp(0.52, 0.42, k), T.lerp(12.5, 11, k), 1.5);
        T.place(g.camera, cam.p, cam.l, 50);
      });
    });
    await record(app, resolve(outDir, 'fight'), {
      duration: 6.2,
      stills,
      speed: (t) => (t > 1.85 && t < 2.45 ? 0.45 : 1),
      events: [
        { t: 0.4, mark: 'telegraph' },
        { t: 1.2, fn: use(1) },
        { t: 3.1, mark: 'phase2', fn: (p) => p.evaluate(() => window.__C.g.boss.debugAdvance()) },
        { t: 4.4, fn: use(4) },
      ],
    });

    // --- He falls; the little crab inside steps out toward the camera and bows.
    await app.setHud('plates');
    await page.evaluate(() => {
      const { g } = window.__C;
      for (const a of g.boss.adds) if (a.unit.alive) g.combat.kill(a.unit, null);
      const a = g.world.pois.bossArena;
      const p = g.player.unit;
      const bu = g.boss.unit;
      // Little Red walks toward the hero; the hero stands just behind the camera.
      const dir = a.yaw + 0.25;
      p.teleport(g.world, bu.pos.x + Math.sin(dir) * 11, bu.pos.z + Math.cos(dir) * 11, dir + Math.PI);
      g.player.setTarget(null);
      g.boss.clearMech();
      g.boss.nextMech = g.time + 99;
      window.__deathDir = dir;
    });
    await page.evaluate(() => {
      const T = window.__T;
      const C = window.__C;
      const { g } = C;
      const bu = g.boss.unit;
      const dir = window.__deathDir;
      const c = { x: bu.pos.x, y: bu.pos.y, z: bu.pos.z };
      T.onFrame((t) => {
        const k = T.ease('inout', t / 7.5);
        // From a wide low view of the hull to a crab-height close-up of where Little Red stops.
        const yaw = dir + T.lerp(0.42, 0.32, k);
        const d = T.lerp(11, 9.4, k);
        const p = [c.x + Math.sin(yaw) * d, c.y + T.lerp(2.6, 1.25, k), c.z + Math.cos(yaw) * d];
        const stop = 4.3;
        const look = [c.x + Math.sin(dir) * stop * k * 0.85, c.y + T.lerp(2.2, 0.75, k), c.z + Math.cos(dir) * stop * k * 0.85];
        T.place(g.camera, p, look, 44);
      });
    });
    await record(app, resolve(outDir, 'death'), {
      duration: 7.5,
      stills,
      events: [
        {
          t: 0.1,
          mark: 'fall',
          fn: (p) =>
            p.evaluate(() => {
              const { g } = window.__C;
              const bu = g.boss.unit;
              if (bu.alive) g.combat.damage(g.player.unit, bu, bu.hp + 10, { crit: true });
            }),
        },
      ],
    });
  } finally {
    await app.browser.close();
  }
};

/** Beat 9b: the whole town dances the recorded dance policies under fireworks. */
SHOTS.dance = async () => {
  const app = await openGame(SPECS.warrior, 'none');
  const { page } = app;
  try {
    await page.evaluate(() => {
      const { g } = window.__C;
      void g.ending.start();
    });
    // Fade to black, gather the town, fade back in.
    await advance(app, 3.4);
    await page.evaluate(() => {
      const T = window.__T;
      const { g } = window.__C;
      const e = g.ending;
      const c = e.centre;
      const sea = g.seaDirection();
      const aSea = Math.atan2(sea.x, sea.z);
      T.onFrame((t) => {
        const k = T.ease('inout', t / 7);
        // From the middle of the ring, low, looking out across the dancers to the fireworks over the bay.
        const a = aSea + T.lerp(-0.55, 0.15, k);
        const back = T.lerp(3.0, 3.7, k);
        const p = [c.x - Math.sin(a) * back, c.y + T.lerp(1.0, 2.5, k), c.z - Math.cos(a) * back];
        const l = [c.x + Math.sin(a) * 6, c.y + T.lerp(1.7, 1.2, k), c.z + Math.cos(a) * 6];
        T.place(g.camera, p, l, 50);
        g.engine.setFocus(back + 3, 10);
      });
    });
    await record(app, resolve(outDir, 'dance'), { duration: 7, stills });
  } finally {
    await app.browser.close();
  }
};

// ------------------------------------------------------------------------------------ main

const names = only.length ? only : Object.keys(SHOTS);
for (const n of names) {
  if (!SHOTS[n]) {
    console.error(`unknown shot ${n}; known: ${Object.keys(SHOTS).join(', ')}`);
    process.exit(2);
  }
  console.log(`shot ${n}`);
  await SHOTS[n]();
}
