#!/usr/bin/env node
// Fixed camera views of Clawhaven for look development and before/after comparisons: the square,
// the Brine Shore, the lighthouse headland, the wreck at night with Corrodius awake, and the
// ending dance. The follow camera is parked, so every run frames the same shot.
//
// Usage: node tools/views.mjs [--url http://localhost:5209] [--out dir] [--prefix name]
//          [--views square,shore,lighthouse,wreck,ending] [--hud] [--eval "js run after boot"]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5209');
const outDir = resolve(opt('--out', 'views-out'));
const prefix = opt('--prefix', 'view');
const views = opt('--views', 'square,shore,lighthouse,wreck,ending').split(',');
const evalJs = opt('--eval', null);
const showHud = args.includes('--hud');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
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
await page.evaluate((showHud) => {
  const g = window.cc.game;
  if (!showHud) g.hud.root.style.visibility = 'hidden';
  g.hud.debugEl.classList.add('hidden');
  g.follow.update = () => {};
  window.__cam = (px, py, pz, tx, ty, tz) => {
    g.camera.position.set(px, py, pz);
    g.camera.lookAt(tx, ty, tz);
  };
}, showHud);
if (evalJs) await page.evaluate(evalJs);

const shots = [];
const shoot = async (name) => {
  const file = resolve(outDir, `${prefix}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
};
for (const v of views) {
  if (v === 'square') {
    await page.evaluate(() => {
      const sp = window.cc.game.world.pois.spawn.position;
      window.__cam(sp.x + 6, sp.y + 3.2, sp.z + 14, sp.x - 2, sp.y + 1.5, sp.z - 10);
    });
    await sleep(800);
    await shoot('square');
  } else if (v === 'shore') {
    await page.evaluate(() => {
      const g = window.cc.game;
      const p = g.player.unit;
      p.teleport(g.world, 112, 36, Math.PI * 0.75);
      const y = g.world.heightAt(112, 36);
      window.__cam(104, y + 4.5, 44, 122, y, 22);
    });
    await sleep(1200);
    await shoot('shore');
  } else if (v === 'lighthouse') {
    await page.evaluate(() => {
      const g = window.cc.game;
      const p = g.player.unit;
      p.teleport(g.world, 150, -114, Math.PI * 0.6);
      const y = g.world.heightAt(150, -114);
      window.__cam(140, y + 5, -104, 190, y + 8, -132);
    });
    await sleep(1200);
    await shoot('lighthouse');
  } else if (v === 'wreck') {
    await page.evaluate(() => {
      const g = window.cc.game;
      g.god = true;
      g.world.setBeaconLit(true);
      g.world.setMood(1);
      g.boss.wake();
    });
    await sleep(4500);
    await page.evaluate(() => {
      const g = window.cc.game;
      const a = g.world.pois.bossArena;
      const p = g.player.unit;
      const x = a.position.x + Math.sin(a.yaw) * 7;
      const z = a.position.z + Math.cos(a.yaw) * 7;
      p.teleport(g.world, x, z, a.yaw + Math.PI);
      const dx = Math.sin(a.yaw);
      const dz = Math.cos(a.yaw);
      window.__cam(x + dx * 7, a.position.y + 4, z + dz * 7, a.position.x, a.position.y + 2.5, a.position.z);
    });
    await sleep(1500);
    await shoot('wreck');
  } else if (v === 'ending') {
    await page.evaluate(() => {
      const g = window.cc.game;
      g.boss.reset();
      void g.ending.start();
    });
    await sleep(10500);
    await shoot('ending');
  }
}
console.log(shots.join('\n'));
await browser.close();
