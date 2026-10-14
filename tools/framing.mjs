#!/usr/bin/env node
// Camera framing shots for before/after comparisons: the Corrodius fight (phase 1 from behind,
// from the flank and with the boss between camera and crab, the phase 2 Anchor Slam and Rust Spray
// telegraphs, the Undertow, enraged) and NPC dialogues. Every scenario places the crabs and the
// camera yaw the same way, then lets the game's own camera run, so two builds frame the same moment.
//
// Usage: node tools/framing.mjs [--url http://localhost:5212] [--out dir] [--prefix name]
//          [--size 1600x900] [--shots boss,dialogue] [--npcs brinebeard,grukk,silvermoon]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5212');
const outDir = resolve(opt('--out', 'framing-out'));
const prefix = opt('--prefix', 'shot');
const [w, h] = opt('--size', '1600x900').split('x').map(Number);
const groups = opt('--shots', 'boss,dialogue').split(',');
const npcs = opt('--npcs', 'brinebeard,grukk,silvermoon').split(',');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function boot() {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console ${m.text()}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' }));
    localStorage.setItem('cc.quality', 'high');
    localStorage.setItem('cc.hintsSeen', '1');
  });
  await page.goto(`${base}/?screen=game&debug=1`);
  await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 120000 });
  await sleep(1500);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.hud.debugEl.classList.add('hidden');
    g.god = true;
    g.hud.hints?.el?.classList.add('hidden');
  });
  return page;
}

const shots = [];
const shoot = async (page, name) => {
  const file = resolve(outDir, `${prefix}-${name}-${w}x${h}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
};

/** Wait in game time (the game can run slower than real time in headless Chrome). */
const waitGame = async (page, seconds) => {
  const t0 = await page.evaluate(() => window.cc.game.time);
  for (let i = 0; i < 400; i++) {
    await sleep(50);
    if ((await page.evaluate(() => window.cc.game.time)) - t0 >= seconds) return;
  }
};

if (groups.includes('boss')) {
  const page = await boot();
  // Wake Corrodius and walk up to him from the arena's front, camera behind the crab.
  await page.evaluate(() => {
    const g = window.cc.game;
    g.world.setBeaconLit(true);
    g.world.setMood(1);
    g.boss.wake();
  });
  await page.waitForFunction(() => window.cc.game.boss.state === 'idle', null, { timeout: 20000 });
  const place = (yawOffset) =>
    page.evaluate((yawOffset) => {
      const g = window.cc.game;
      const b = g.boss.unit;
      const p = g.player.unit;
      const a = g.world.pois.bossArena;
      const d = b.radius + p.radius + 1.0;
      const x = b.pos.x + Math.sin(a.yaw) * d;
      const z = b.pos.z + Math.cos(a.yaw) * d;
      p.teleport(g.world, x, z, Math.atan2(b.pos.x - x, b.pos.z - z));
      g.follow.yaw = p.yaw + Math.PI + yawOffset;
      g.follow.pitch = 0.3;
    }, yawOffset);
  await place(0);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.boss.engage();
    g.player.setTarget(g.boss.unit);
    // No mechanic for the first shots: just the chase and the claws.
    g.boss.nextMech = g.time + 999;
  });
  await waitGame(page, 2.5);
  await shoot(page, 'boss-p1');

  // The crab has scuttled round to his flank; the camera is still where the player left it.
  await place(Math.PI / 2);
  await waitGame(page, 1.5);
  await shoot(page, 'boss-p1-flank');

  // The worst case: Corrodius stands between the camera and the crab.
  await place(Math.PI);
  await waitGame(page, 1.5);
  await shoot(page, 'boss-p1-behind');

  // Zoomed in with Corrodius between camera and crab: the camera must climb over him, never sit
  // inside his shell. Logs how deep into his body the camera is (negative = outside).
  await page.evaluate(() => (window.cc.game.follow.distance = 4));
  await place(Math.PI);
  await waitGame(page, 1.5);
  await shoot(page, 'boss-p1-behind-close');
  const inside = await page.evaluate(() => {
    const g = window.cc.game;
    const b = g.boss.unit;
    const c = g.camera.position;
    const cy = b.pos.y + b.height * 0.5;
    const q = Math.hypot(c.x - b.pos.x, c.z - b.pos.z) ** 2 / (b.radius * 1.35) ** 2 + (c.y - cy) ** 2 / (b.height * 0.62) ** 2;
    return Math.sqrt(q);
  });
  console.log(`behind-close: camera at ${inside.toFixed(2)} of the boss body radius (< 1 is inside)`);
  await page.evaluate(() => (window.cc.game.follow.distance = 14.5));

  // Phase 1 Rust Spray cone.
  await place(0);
  await waitGame(page, 0.8);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.boss.mechIndex = 1;
    g.boss.nextMech = g.time;
  });
  await page.waitForFunction(() => window.cc.game.boss.mechName === 'spray', null, { timeout: 8000 });
  await waitGame(page, 0.55);
  await shoot(page, 'boss-p1-spray');
  await page.waitForFunction(() => !window.cc.game.boss.mechName, null, { timeout: 8000 });

  // Phase 2: adds, then the Anchor Slam circle under the crab.
  await page.evaluate(() => window.cc.game.boss.debugAdvance());
  await page.waitForFunction(() => window.cc.game.boss.phase === 2, null, { timeout: 8000 });
  await waitGame(page, 1.5);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.boss.mechIndex = 1;
    g.boss.nextMech = g.time;
  });
  await page.waitForFunction(() => window.cc.game.boss.mechName === 'slam', null, { timeout: 8000 });
  await waitGame(page, 0.7);
  await shoot(page, 'boss-p2-slam');
  await page.waitForFunction(() => !window.cc.game.boss.mechName, null, { timeout: 8000 });

  // Phase 2 Undertow: the crab is dragged in under the claws.
  await page.evaluate(() => {
    const g = window.cc.game;
    const b = g.boss.unit;
    const p = g.player.unit;
    const a = g.world.pois.bossArena;
    const d = b.radius + p.radius + 4;
    const x = b.pos.x + Math.sin(a.yaw + 0.4) * d;
    const z = b.pos.z + Math.cos(a.yaw + 0.4) * d;
    p.teleport(g.world, x, z, Math.atan2(b.pos.x - x, b.pos.z - z));
    g.follow.yaw = p.yaw + Math.PI;
    g.boss.mechIndex = 0;
    g.boss.nextMech = g.time;
  });
  await page.waitForFunction(() => window.cc.game.boss.mechName === 'undertow', null, { timeout: 8000 });
  await waitGame(page, 1.9);
  await shoot(page, 'boss-p2-undertow');
  await page.waitForFunction(() => !window.cc.game.boss.mechName, null, { timeout: 8000 });

  // Phase 2 Rust Spray, seen from the flank.
  await place(Math.PI * 0.6);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.boss.mechIndex = 2;
    g.boss.nextMech = g.time;
  });
  await page.waitForFunction(() => window.cc.game.boss.mechName === 'spray', null, { timeout: 8000 });
  await waitGame(page, 0.55);
  await shoot(page, 'boss-p2-spray-flank');
  await page.waitForFunction(() => !window.cc.game.boss.mechName, null, { timeout: 8000 });

  // Enraged.
  await page.evaluate(() => window.cc.game.boss.debugAdvance());
  await page.waitForFunction(() => window.cc.game.boss.phase === 3, null, { timeout: 8000 });
  await place(0.35);
  await page.evaluate(() => {
    const g = window.cc.game;
    g.boss.nextMech = g.time + 999;
  });
  await waitGame(page, 2.5);
  await shoot(page, 'boss-enraged');
  await page.close();
}

if (groups.includes('dialogue')) {
  for (const id of npcs) {
    const page = await boot();
    // Walk up to the NPC from the front, camera behind the crab, then press F.
    await page.evaluate((id) => {
      const g = window.cc.game;
      const n = g.npcById(id);
      const p = g.player.unit;
      const u = n.unit;
      const d = u.radius + p.radius + 1.6;
      const a = n.poi.yaw + 0.25;
      const x = u.pos.x + Math.sin(a) * d;
      const z = u.pos.z + Math.cos(a) * d;
      p.teleport(g.world, x, z, Math.atan2(u.pos.x - x, u.pos.z - z));
      g.follow.yaw = p.yaw + Math.PI;
      g.follow.pitch = 0.3;
    }, id);
    // Let the zone banner of the teleport fade first, so it does not sit on the NPC's head.
    await waitGame(page, 4.8);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.cc.game.hud.dialogue.isOpen, null, { timeout: 8000 });
    await waitGame(page, 2.0);
    await shoot(page, `dlg-${id}`);
    // Close it and check the camera comes back.
    await page.keyboard.press('Escape');
    await waitGame(page, 1.6);
    await shoot(page, `dlg-${id}-closed`);
    await page.close();
  }
}

if (groups.includes('beacon')) {
  const page = await boot();
  // Quest 3 with the scavengers done: climb to the gallery and hold F at the flame.
  await page.evaluate(() => {
    const g = window.cc.game;
    g.quests.status.q1 = 'done';
    g.quests.status.q2 = 'done';
    g.quests.status.q3 = 'active';
    g.quests.progress.set('q3-kill', 3);
    g.debug.teleport();
  });
  await waitGame(page, 5);
  await page.keyboard.down('KeyF');
  await waitGame(page, 1.5);
  await shoot(page, 'beacon-channel');
  await page.keyboard.up('KeyF');
  await page.close();
}

if (groups.includes('ending')) {
  const page = await boot();
  await page.evaluate(() => void window.cc.game.ending.start());
  await page.waitForFunction(() => window.cc.game.ending.started, null, { timeout: 15000 });
  for (const t of [3, 6, 9, 12, 16, 20, 26]) {
    await page.waitForFunction((t) => window.cc.game.ending.t >= t, t, { timeout: 60000, polling: 50 });
    await shoot(page, `ending-${String(t).padStart(2, '0')}s`);
  }
  await page.close();
}

await browser.close();
console.log(shots.join('\n'));
console.log(`errors: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
process.exit(errors.length ? 1 : 0);
