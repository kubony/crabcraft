#!/usr/bin/env node
// Evidence run for Robot Mode in real Chrome (GPU): drives the robot with the keyboard the way a
// person would and saves timed screenshots plus a JSON log of what the live sim reported.
//   node tools/robot-shots.mjs <url of dev/robot.html> <out dir> [--walk 30]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5203/dev/robot.html';
const out = process.argv[3] ?? '.';
const walkS = Number(process.argv.includes('--walk') ? process.argv[process.argv.indexOf('--walk') + 1] : 30);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const log = { url, samples: [], events: [], shots: [] };
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') log.events.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => log.events.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
log.readyAfterMs = Date.now() - t0;
log.info = await page.evaluate(() => {
  const i = window.robot.info;
  return { downloadBytes: i.downloadBytes, loadMs: i.loadMs, reference: i.reference, actDiff: i.actDiff, digests: i.digests };
});

const sample = async (label) => {
  const s = await page.evaluate(() => {
    const st = window.robot.getState();
    const f = window.__robotEngine;
    const up = { x: 0, y: 1, z: 0 };
    const q = st.base.quaternion;
    // body up axis' world y component -> tilt
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    void up;
    return {
      t: st.simTime, mode: st.mode, running: st.runningPolicy,
      x: st.base.position.x, y: st.base.position.y, z: st.base.position.z,
      tiltDeg: (Math.acos(Math.max(-1, Math.min(1, uy))) * 180) / Math.PI,
      fps: f ? f.fps : null,
      stats: window.robot.getStats(),
    };
  });
  log.samples.push({ label, ...s });
  return s;
};
const shot = async (name) => {
  const p = join(out, `${name}.png`);
  await page.screenshot({ path: p });
  log.shots.push(p);
  console.log(`shot ${p}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const untilMode = async (mode, timeoutMs = 8000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await sample(`wait ${mode}`);
    if (s.mode === mode && s.running) return true;
    await wait(100);
  }
  return false;
};

await wait(800);
await sample('stand');
await shot('01-standing');

// Walk forward for walkS seconds, sampling once a second.
await page.keyboard.down('KeyW');
let minY = Infinity, maxTilt = 0;
const start = await sample('walk start');
for (let i = 0; i < walkS; i++) {
  await wait(1000);
  const s = await sample(`walk ${i + 1}s`);
  minY = Math.min(minY, s.y);
  maxTilt = Math.max(maxTilt, s.tiltDeg);
  if (i === 5) await shot('02-walking');
  // Steer a little so the walk stays near the props: turn for 2 s every 10 s.
  if (i % 10 === 7) await page.keyboard.down('KeyQ');
  if (i % 10 === 9) await page.keyboard.up('KeyQ');
}
const end = await sample('walk end');
await page.keyboard.up('KeyW');
log.walk = {
  seconds: walkS, simSeconds: end.t - start.t, distance: Math.hypot(end.x - start.x, end.z - start.z), minHeight: minY, maxTiltDeg: maxTilt,
  fellOver: minY < 0.05 || maxTilt > 45,
};
console.log('walk', log.walk);
await wait(2500);

// Crab dance: Ctrl+1, the bundle's own binding.
await page.keyboard.down('ControlLeft');
await page.keyboard.press('Digit1');
await page.keyboard.up('ControlLeft');
log.events.push(`dance_crab running: ${await untilMode('dance_crab')}`);
await wait(4000);
await shot('03-dance-crab');
await wait(3000);
await shot('04-dance-crab-2');
await page.keyboard.press('ControlLeft'); // leave_motion
await untilMode('locomotion');
await wait(1500);

// Brazilian: Ctrl+2.
await page.keyboard.down('ControlLeft');
await page.keyboard.press('Digit2');
await page.keyboard.up('ControlLeft');
log.events.push(`dance_brazilian running: ${await untilMode('dance_brazilian')}`);
await wait(5000);
await shot('05-dance-brazilian');
await page.keyboard.press('ControlLeft');
await untilMode('locomotion');
await wait(1500);

// Gesture hello: 1.
await page.keyboard.press('Digit1');
log.events.push(`gesture_hello running: ${await untilMode('gesture_hello')}`);
await wait(2200);
await shot('06-gesture-hello');
await untilMode('locomotion', 12000);
await wait(1000);

// Jump: Space. Slow motion so the apex can be caught on camera; the physics is the same.
await page.evaluate(() => window.robot.setSpeed(0.05));
await page.keyboard.press('Space');
log.events.push(`jump running: ${await untilMode('jump', 20000)}`);
let apex = { y: 0 };
let shotApex = false;
const jEnd = Date.now() + 25000;
while (Date.now() < jEnd) {
  const s = await sample('jump');
  if (s.y > apex.y) apex = s;
  if (s.y > 0.2 && !shotApex) {
    await shot('07-jump-apex');
    shotApex = true;
  }
  if (apex.y > 0.15 && s.y < apex.y - 0.004) break;
  await wait(25);
}
if (!shotApex) await shot('07-jump-apex');
log.jump = { apexHeight: apex.y, at: apex.t };
await page.evaluate(() => window.robot.setSpeed(1));
await untilMode('locomotion', 10000);
await wait(1500);
await sample('end');
await shot('08-after');
log.totalMs = Date.now() - t0;
writeFileSync(join(out, 'robot-run.json'), JSON.stringify(log, null, 1));
console.log(JSON.stringify({ walk: log.walk, jump: log.jump, events: log.events.slice(0, 20) }, null, 1));
await browser.close();
