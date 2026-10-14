#!/usr/bin/env node
// Evidence run for Robot Mode's appearance switch in real Chrome (GPU): the player's geared crab
// walking and dancing on the live policy, the x-ray overlay of the physics robot over it, the bare
// robot, the HUD card, the crab's link-by-link distance from the physics bodies, and fps of both.
//   node tools/robot-skin-shots.mjs <app url, e.g. http://localhost:5208/> <out dir> [--spec '{json}'] [--nospec]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const url = (args[0] ?? 'http://localhost:5208/').replace(/\/?$/, '/') + '?screen=robot';
const out = args[1] ?? '.';
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const noSpec = args.includes('--nospec');
const spec = JSON.parse(
  opt('--spec', JSON.stringify({ race: 'orc', sex: 'male', classId: 'warrior', shell: 0, crest: 1, led: 0, name: 'Grukclaw' })),
);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const log = { url, spec: noSpec ? null : spec, events: [], shots: [], alignment: {}, fps: {} };
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') log.events.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => log.events.push(`[pageerror] ${e.message}`));
await page.addInitScript(
  ([s, none]) => {
    try {
      if (none) localStorage.removeItem('cc.spec');
      else localStorage.setItem('cc.spec', s);
    } catch {
      /* ignore */
    }
  },
  [JSON.stringify(spec), noSpec],
);

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
// The screen keeps its handle private; the app's debug handle reaches it.
await page.waitForFunction(
  () => {
    const h = window.app?.current?.handle;
    const s = h?.getState();
    return !!s && s.runningPolicy && s.simTime > 1.5;
  },
  null,
  { timeout: 120000 },
);
await page.evaluate(() => (window.robot = window.app.current.handle));
log.readyAfterMs = Date.now() - t0;

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name, clip) => {
  const p = join(out, `${name}.png`);
  await page.screenshot({ path: p, clip });
  log.shots.push(p);
  console.log(`shot ${p}`);
};
const state = () => page.evaluate(() => {
  const s = window.robot.getState();
  return { t: s.simTime, mode: s.mode, running: s.runningPolicy, y: s.base.position.y, look: window.robot.appearance };
});
const untilMode = async (mode, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (s.mode === mode && s.running) return true;
    await wait(100);
  }
  return false;
};
const untilLook = async (look, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await page.evaluate((l) => {
      const card = document.querySelector('.rm-look');
      const loading = !!document.querySelector('.rm-seg-b.loading');
      return window.robot.appearance === l && !loading && (!card || card.classList.contains('crab') === (l === 'crab'));
    }, look);
    if (ok) return true;
    await wait(100);
  }
  return false;
};
/** Samples the crab-to-physics distance every ~50 ms for `ms`. */
const align = async (label, ms) => {
  const r = await page.evaluate(async (dur) => {
    const res = [];
    const end = performance.now() + dur;
    while (performance.now() < end) {
      const a = window.robot.measureAlignment();
      if (a) res.push(a);
      await new Promise((r) => setTimeout(r, 50));
    }
    return res;
  }, ms);
  const max = Math.max(...r.map((a) => a.max));
  const mean = r.reduce((s, a) => s + a.mean, 0) / Math.max(1, r.length);
  const worst = r.find((a) => a.max === max)?.worst;
  const weaponLowMm = Math.min(...r.map((a) => a.weaponLow)) * 1000;
  log.alignment[label] = { samples: r.length, bodies: r[0]?.bodies, meanMm: mean * 1000, maxMm: max * 1000, worst, weaponLowMm };
  console.log('alignment', label, log.alignment[label]);
};
const fps = async (label, ms = 8000) => {
  const r = await page.evaluate(async (dur) => {
    const e = window.app.engine;
    // CPU ms inside the composer per frame (scene traversal, skinning, draw submission).
    const comp = e.composer;
    if (!comp.__timed) {
      const render = comp.render.bind(comp);
      comp.__ms = [];
      comp.render = (dt) => {
        const t = performance.now();
        render(dt);
        comp.__ms.push(performance.now() - t);
      };
      comp.__timed = true;
    }
    comp.__ms.length = 0;
    const xs = [];
    let frames = 0;
    const t0 = performance.now();
    let last = t0;
    let worst = 0;
    await new Promise((resolve) => {
      const tick = (t) => {
        frames++;
        worst = Math.max(worst, t - last);
        last = t;
        if (t - t0 < dur) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    xs.push(e.fps);
    const ms = comp.__ms.slice().sort((a, b) => a - b);
    const info = e.renderer.info.render;
    return {
      fps: (frames * 1000) / (performance.now() - t0),
      worstFrameMs: worst,
      renderCpuMsMedian: ms[ms.length >> 1],
      renderCpuMsP95: ms[Math.floor(ms.length * 0.95)],
      drawCalls: info.calls,
      triangles: info.triangles,
    };
  }, ms);
  log.fps[label] = r;
  console.log('fps', label, r);
};

await wait(1500);
await shot('01-start-hud');

if (args.includes('--gear')) {
  // Every race, crest and class at the standing pose: lowest point of the gear and of the crab's
  // own shell parts, world metres (the desk top is y = 0).
  const combos = [];
  for (const race of ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'])
    for (let crest = 0; crest < 4; crest++)
      for (const classId of ['warrior', 'mage', 'priest']) combos.push({ race, crest, classId });
  log.gear = [];
  for (const c of combos) {
    const s = { race: c.race, sex: c.crest % 2 ? 'female' : 'male', classId: c.classId, shell: 0, crest: c.crest, led: 0, name: 'Probe' };
    const r = await page.evaluate(async (spec) => {
      await window.robot.wearCrab(spec);
      await new Promise((res) => setTimeout(res, 120));
      let crab = null;
      window.robot.scene.traverse((o) => {
        if (o.name.startsWith('robot-crab:') && o.visible) crab = o;
      });
      if (!crab) return null;
      crab.updateWorldMatrix(true, true);
      const gearMin = { y: Infinity, name: '' };
      const bodyMin = { y: Infinity };
      const v = new crab.position.constructor();
      crab.traverse((o) => {
        if (!o.isMesh || !o.visible || o.name === 'crab-face') return;
        // The crab's own parts are skinned; gear pieces are plain meshes riding on links.
        const inGear = !o.isSkinnedMesh;
        const pos = o.geometry.attributes.position;
        let m = Infinity;
        for (let i = 0; i < pos.count; i++) {
          o.getVertexPosition(i, v);
          v.applyMatrix4(o.matrixWorld);
          if (v.y < m) m = v.y;
        }
        if (inGear && m < gearMin.y) {
          gearMin.y = m;
          let n = o;
          while (n.parent && !n.parent.isBone && n.parent.name !== 'model') n = n.parent;
          gearMin.name = n.name || o.name;
        }
        if (!inGear && m < bodyMin.y) bodyMin.y = m;
      });
      // The bare robot in the same frame (x-ray makes it update), for the feet.
      window.robot.setXray(true);
      await new Promise((res) => setTimeout(res, 120));
      let bare = Infinity;
      window.robot.scene.traverse((o) => {
        if (o.name === 'jumper-robot') {
          o.updateWorldMatrix(true, true);
          o.traverse((m) => {
            if (!m.isMesh || m.name === 'xray' || m.name === 'led-face') return;
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
              if (v.y < bare) bare = v.y;
            }
          });
        }
      });
      window.robot.setXray(false);
      return { gearMinMm: gearMin.y * 1000, gearPiece: gearMin.name, bodyMinMm: bodyMin.y * 1000, bareMinMm: bare * 1000 };
    }, s);
    log.gear.push({ ...c, ...r });
    console.log(JSON.stringify({ ...c, ...r }));
  }
  writeFileSync(join(out, 'gear.json'), JSON.stringify(log.gear, null, 1));
  await browser.close();
  process.exit(0);
}

if (args.includes('--fps')) {
  // Interleaved A/B: 2 s windows alternating crab and bare, 10 of each, live simulation, then the
  // medians (a shared machine's background load drifts slower than one window pair).
  await untilLook('crab');
  await wait(1500);
  const runs = { crab: [], bare: [] };
  for (let i = 0; i < 20; i++) {
    const look = i % 2 ? 'bare' : 'crab';
    if ((await state()).look !== look) await page.keyboard.press('KeyT');
    await untilLook(look);
    await wait(900);
    await fps(`w${i}-${look}`, 2000);
    runs[look].push(log.fps[`w${i}-${look}`]);
  }
  const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  log.fpsSummary = Object.fromEntries(
    Object.entries(runs).map(([k, xs]) => [
      k,
      {
        windows: xs.length,
        fpsMedian: med(xs.map((x) => x.fps)),
        fpsMin: Math.min(...xs.map((x) => x.fps)),
        fpsMax: Math.max(...xs.map((x) => x.fps)),
        renderCpuMsMedian: med(xs.map((x) => x.renderCpuMsMedian)),
        drawCalls: xs[0].drawCalls,
        triangles: xs[0].triangles,
      },
    ]),
  );
  console.log(JSON.stringify(log.fpsSummary, null, 1));
  writeFileSync(join(out, 'fps.json'), JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(0);
}

if (noSpec) {
  // No saved crab: the bare robot starts and the card shows the picker.
  await shot('01b-card-nospec', { x: 0, y: 470, width: 380, height: 430 });
  await page.click('.rm-chip:text("Tauren")');
  await untilLook('crab');
  await wait(1200);
  await shot('02-picked-tauren');
  await shot('02b-card-picked', { x: 0, y: 470, width: 380, height: 430 });
  await page.click('.rm-chip:text("Mage")');
  await untilLook('crab');
  await wait(1200);
  await shot('03-picked-tauren-mage');
  await page.click('.rm-chip:text("Random crab")');
  await untilLook('crab');
  await wait(1200);
  await shot('04-random-crab');
  writeFileSync(join(out, 'run.json'), JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(0);
}

await untilLook('crab');
await wait(1500);
await shot('01-crab-home');
await shot('01b-card-crab', { x: 0, y: 470, width: 380, height: 430 });
// Closer, lower look at the feet and gear against the desk at HOME.
await page.mouse.move(800, 450);
for (let i = 0; i < 3; i++) {
  await page.mouse.wheel(0, -240);
  await wait(60);
}
// Drag up: the camera drops to desk level, to see the feet and weapons against the desk.
await page.mouse.down();
await page.mouse.move(800, 410, { steps: 8 });
await page.mouse.up();
await wait(1500);
await shot('02-crab-home-close');
await page.evaluate(() => window.robot.setXray(true));
await wait(400);
await shot('02b-crab-home-close-xray');
await align('home', 1500);
await page.evaluate(() => window.robot.setXray(false));
for (let i = 0; i < 3; i++) {
  await page.mouse.wheel(0, 240);
  await wait(60);
}
await page.mouse.move(800, 410);
await page.mouse.down();
await page.mouse.move(800, 450, { steps: 8 });
await page.mouse.up();
await wait(800);

await fps('crab-standing', 6000);

// Walk.
await page.keyboard.down('KeyW');
await wait(3500);
await shot('03-crab-walking');
const walkAlign = align('walk', 3000);
await page.evaluate(() => window.robot.setXray(true));
await wait(300);
await shot('03b-crab-walking-xray');
await walkAlign;
await page.evaluate(() => window.robot.setXray(false));
await fps('crab-walking', 6000);
await page.keyboard.up('KeyW');
await wait(2500);

// Crab dance (Ctrl+1, the bundle's own binding).
await page.keyboard.down('ControlLeft');
await page.keyboard.press('Digit1');
await page.keyboard.up('ControlLeft');
log.events.push(`dance_crab running: ${await untilMode('dance_crab')}`);
await wait(3000);
await shot('04-crab-dance');
const danceAlign = align('dance_crab', 4000);
await wait(1500);
await page.evaluate(() => window.robot.setXray(true));
await wait(300);
await shot('04b-crab-dance-xray');
await danceAlign;
await page.evaluate(() => window.robot.setXray(false));
await fps('crab-dancing', 5000);
await page.keyboard.press('ControlLeft');
await untilMode('locomotion', 15000);
await wait(1500);

// T: the bare robot, same simulation.
const before = await state();
await page.keyboard.press('KeyT');
await untilLook('bare');
await wait(150);
await shot('05-switch-flash');
await wait(1200);
const after = await state();
log.events.push(`switch kept the sim running: simTime ${before.t.toFixed(2)} -> ${after.t.toFixed(2)}, mode ${after.mode}`);
await shot('05-bare-robot');
await shot('05b-card-bare', { x: 0, y: 470, width: 380, height: 430 });
await fps('bare-standing', 6000);
await page.keyboard.down('KeyW');
await wait(3000);
await fps('bare-walking', 6000);
await page.keyboard.up('KeyW');
await wait(2000);
await page.keyboard.down('ControlLeft');
await page.keyboard.press('Digit1');
await page.keyboard.up('ControlLeft');
await untilMode('dance_crab');
await wait(1500);
await fps('bare-dancing', 5000);
await shot('06-bare-dance');
// Back to the crab mid dance.
await page.keyboard.press('KeyT');
await untilLook('crab');
await wait(800);
await shot('07-crab-again-mid-dance');

await page.keyboard.press('ControlLeft');
await untilMode('locomotion', 15000);
await wait(1500);

// A/B, standing in the same spot: crab, bare, crab, bare (8 s each), live and with the simulation
// paused (rendering only, no worker competing for the CPU).
for (const paused of [false, true]) {
  await page.evaluate((p) => window.robot.setPaused(p), paused);
  for (const [i, look] of ['crab', 'bare', 'crab', 'bare'].entries()) {
    if ((await state()).look !== look) await page.keyboard.press('KeyT');
    await untilLook(look);
    await wait(1000);
    await fps(`ab-${paused ? 'paused' : 'live'}-${i + 1}-${look}`, 8000);
  }
}
await page.evaluate(() => window.robot.setPaused(false));

log.totalMs = Date.now() - t0;
writeFileSync(join(out, 'run.json'), JSON.stringify(log, null, 1));
console.log(JSON.stringify({ alignment: log.alignment, fps: log.fps, events: log.events.slice(0, 30) }, null, 1));
await browser.close();
