#!/usr/bin/env node
// LED face readability check: lines up six crabs of different races (so six LED colours) in
// Clawhaven Square facing the camera at game distance, sets an expression on each, and
// screenshots the row plus a 3x crop of the faces. Also shoots the player crab up close in the
// dusk light for paint checks.
//
// Usage: node tools/faces.mjs [--url http://localhost:5209] [--out dir] [--dist 8] [--dpr 1]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5209');
const outDir = resolve(opt('--out', 'faces-out'));
const dist = Number(opt('--dist', '8'));
const dpr = Number(opt('--dpr', '1'));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error', m.text()));
await page.addInitScript(() => {
  localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' }));
  localStorage.setItem('cc.quality', 'high');
  localStorage.setItem('cc.hintsSeen', '1');
});
await page.goto(`${base}/?screen=game&debug=1`);
await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 120000 });
await sleep(1200);

// Freeze the crowd and park the camera.
await page.evaluate((dist) => {
  const g = window.cc.game;
  const THREE = window.cc.THREE;
  g.hud.root.style.visibility = 'hidden';
  g.follow.update = () => {};
  const folk = g.townsfolk.slice(0, 6);
  // One crab per race, in RACE_ORDER: the town spawns one of each first.
  for (const t of g.townsfolk) t.update = () => {};
  for (const n of g.npcs) n.update = () => {};
  g.player.unit.hidden = true;
  g.player.unit.rig.root.visible = false;
  const sp = g.world.pois.spawn.position;
  const c = new THREE.Vector3(sp.x + 2, sp.y, sp.z + 4);
  // Camera looks along -Z at the row, a little from above like the follow camera.
  const pitch = 0.3;
  const look = new THREE.Vector3(c.x, c.y + 0.75, c.z);
  g.camera.position.set(c.x, look.y + Math.sin(pitch) * dist, c.z + Math.cos(pitch) * dist);
  g.camera.lookAt(look);
  folk.forEach((t, i) => {
    const u = t.unit;
    const x = c.x + (i - 2.5) * 1.75;
    u.teleport(g.world, x, c.z, 0);
    u.motion.stop(undefined, 0);
  });
  window.__folk = folk.map((t) => t.unit);
  // The real follow camera never comes this close to other crabs, but keep LOD honest.
  for (const u of g.units) if (!folk.some((t) => t.unit === u) && u.kind !== 'player') u.hidden = true, (u.rig.root.visible = false);
}, dist);

const sets = [
  ['neutral', 'happy', 'angry', 'focused', 'love', 'dead'],
  ['love', 'dead', 'neutral', 'happy', 'angry', 'focused'],
  ['surprised', 'sleepy', 'hurt', 'talk', 'neutral', 'happy'],
];
const shots = [];
for (const [k, set] of sets.entries()) {
  await page.evaluate((set) => {
    window.__folk.forEach((u, i) => {
      u.rig.face.setExpression(set[i], 999);
      u.hidden = false;
      u.rig.root.visible = true;
    });
  }, set);
  await sleep(900);
  const file = resolve(outDir, `faces-${k + 1}-d${dist}.png`);
  await page.screenshot({ path: file });
  // Crop around the visors: they sit in the middle band of the frame.
  const crop = resolve(outDir, `faces-${k + 1}-d${dist}-crop.png`);
  await page.screenshot({ path: crop, clip: { x: 160, y: 330, width: 1280, height: 240 } });
  shots.push(file, crop);
  console.log(`set ${k + 1}: ${set.join(' ')}`);
}

// Close-up of a Jumper-red crab in the dusk light, three-quarter view (paint check).
await page.evaluate(() => {
  const g = window.cc.game;
  const THREE = window.cc.THREE;
  const u = g.player.unit;
  u.hidden = false;
  u.rig.root.visible = true;
  for (const f of window.__folk) f.rig.root.visible = false;
  const sp = g.world.pois.spawn.position;
  u.teleport(g.world, sp.x + 2, sp.z + 4, 0.6);
  u.rig.face.setExpression('happy', 999);
  const p = u.pos;
  g.camera.position.set(p.x + 1.6, p.y + 1.25, p.z + 2.4);
  g.camera.lookAt(new THREE.Vector3(p.x, p.y + 0.5, p.z));
});
await sleep(900);
const close = resolve(outDir, 'paint-closeup.png');
await page.screenshot({ path: close });
shots.push(close);
console.log(shots.join('\n'));
await browser.close();
