#!/usr/bin/env node
// End-to-end playtest of the whole quest chain in installed Chrome (real GPU).
// Boots ?screen=game&debug=1 with a saved crab for each class, plays through every quest with the
// debug hooks (F8 god mode, F9 complete objective, F10 teleport) plus real movement and ability
// key presses, screenshots each stage, and fails on any console error or uncaught exception.
//
// Usage: node tools/playtest.mjs [--url http://localhost:5206] [--out dir] [--class warrior,mage,priest] [--headed]
// Needs a dev or preview server running (pnpm dev --port 5206 --strictPort).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5206');
const outDir = resolve(opt('--out', 'playtest-out'));
const classes = opt('--class', 'warrior,mage,priest').split(',');
const headed = args.includes('--headed');
mkdirSync(outDir, { recursive: true });

const SPECS = {
  warrior: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' },
  mage: { race: 'nightelf', sex: 'female', classId: 'mage', shell: 1, crest: 1, led: 1, name: 'Tidewhisper' },
  priest: { race: 'tauren', sex: 'male', classId: 'priest', shell: 0, crest: 2, led: 0, name: 'Hoofshell' },
};

// Missing art/audio is expected until the art branch merges; those 404s are counted, not failed.
const ASSET_RE = /\/(art|audio|models|motions|robot|fonts)\/|\/favicon\.ico$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(cls) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  const warnings = [];
  const missing = new Set();
  page.on('console', (m) => {
    const t = m.type();
    const url = m.location()?.url ?? '';
    if (t === 'error') {
      if (/Failed to load resource/.test(m.text()) && ASSET_RE.test(url)) missing.add(url.replace(base, ''));
      else errors.push(`${m.text()} ${url ? `(${url})` : ''}`);
    } else if (t === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() === 404 && ASSET_RE.test(r.url())) missing.add(r.url().replace(base, ''));
  });
  await page.addInitScript((spec) => {
    localStorage.setItem('cc.spec', JSON.stringify(spec));
  }, SPECS[cls]);

  const shots = [];
  const fps = {};
  const shot = async (name) => {
    const file = resolve(outDir, `${cls}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    return file;
  };
  const state = () => page.evaluate(() => window.cc.state());
  const waitFor = async (pred, timeout = 20000, label = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (pred(s)) return s;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s.current)} boss=${JSON.stringify(s.boss)}`);
      await sleep(150);
    }
  };
  const key = (k) => page.keyboard.press(k);
  const hold = async (k, ms) => {
    await page.keyboard.down(k);
    await sleep(ms);
    await page.keyboard.up(k);
  };
  const click = async (label) => {
    await page.waitForSelector(`.dlg button[data-action="${label}"]`, { timeout: 8000 });
    await page.click(`.dlg button[data-action="${label}"]`);
  };
  const step = (msg) => console.log(`  [${cls}] ${msg}`);

  const fights = {
    warrior: async () => {
      await key('Digit3');
      await sleep(3300);
      await key('Digit4');
      await sleep(260);
      await shot('03-shore-combat');
      await sleep(900);
      await key('Digit1');
      await sleep(1100);
      await key('Digit2');
      await sleep(320);
      await shot('03b-shore-bash');
    },
    mage: async () => {
      await key('Digit1');
      await sleep(1700);
      await shot('03-shore-combat');
      await key('Digit2');
      await sleep(180);
      await shot('03b-shore-frost');
      await sleep(900);
      await key('Digit4');
      await sleep(220);
      await shot('03c-shore-nova');
      await sleep(900);
      await key('Digit3');
      await sleep(200);
    },
    priest: async () => {
      await key('Digit1');
      await sleep(1620);
      await shot('03-shore-combat');
      await sleep(400);
      await key('Digit3');
      await sleep(1100);
      await key('Digit4');
      await sleep(240);
      await shot('03b-shore-holytide');
      await sleep(900);
      await key('Digit2');
      await sleep(2200);
    },
  };

  let ok = true;
  try {
    step('boot');
    await page.goto(`${base}/?screen=game&debug=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 90000 });
    await sleep(1800);
    await shot('01-spawn');
    fps.town = (await state()).fps;

    step('walk around');
    await page.mouse.click(800, 450);
    await hold('KeyW', 900);
    await hold('KeyA', 600);
    await key('Space');
    await hold('KeyD', 600);
    await hold('KeyQ', 300);
    await key('F8');

    step('quest 1: talk to Brinebeard');
    await key('F10');
    await sleep(500);
    await key('KeyF');
    await waitFor((s) => s.dialogueOpen, 5000, 'dialogue');
    await sleep(1600);
    await shot('02-dialogue');
    await click('Accept');
    await waitFor((s) => s.quests.q1 === 'active', 5000, 'q1 active');

    step('quest 1: shore combat');
    await key('F10');
    await sleep(900);
    await key('Tab');
    await waitFor((s) => !!s.target, 5000, 'target');
    await fights[cls]();
    fps.combat = (await state()).fps;
    await key('F9');
    await sleep(300);
    await key('F9');
    await waitFor((s) => s.quests.q1 === 'ready', 8000, 'q1 ready');

    step('quest 1 turn-in, quest 2');
    await key('F10');
    await sleep(600);
    await key('KeyF');
    await click('Complete Quest');
    await sleep(900);
    await click('Accept');
    await waitFor((s) => s.quests.q2 === 'active', 5000, 'q2 active');

    step('quest 2: Moonpool Grove');
    await key('F10');
    await sleep(700);
    await key('KeyF');
    await click('Complete Quest');
    await sleep(900);
    await click('Accept');
    await waitFor((s) => s.quests.q3 === 'active', 5000, 'q3 active');

    step('quest 3: scavengers');
    await key('F10');
    await sleep(900);
    await key('Tab');
    await sleep(200);
    await key('Digit1');
    await sleep(1800);
    await key('F9');
    await sleep(400);

    step('quest 3: relight the beacon');
    await key('F10');
    await sleep(700);
    await page.keyboard.down('KeyF');
    await sleep(1500);
    await shot('04a-beacon-channel');
    await sleep(2000);
    await page.keyboard.up('KeyF');
    await waitFor((s) => s.quests.q3 === 'done', 5000, 'q3 done');
    await sleep(600);
    await shot('04-beacon-lit');
    await waitFor((s) => s.quests.q4 === 'active' && s.boss.state === 'idle', 15000, 'boss awake');

    step('quest 4: Corrodius');
    await key('F10');
    await waitFor((s) => s.boss.state === 'fight', 8000, 'boss engaged');
    await key('Tab');
    await sleep(300);
    await key('Digit1');
    await sleep(1800);
    fps.boss = (await state()).fps;
    await key('F9');
    await waitFor((s) => s.boss.phase === 2, 5000, 'phase 2');
    await waitFor((s) => s.boss.telegraph && s.boss.adds > 0, 20000, 'phase 2 telegraph');
    await sleep(500);
    await shot('05-boss-phase2');
    fps.bossPhase2 = (await state()).fps;
    await key('F9');
    await waitFor((s) => s.boss.phase === 3, 5000, 'phase 3');
    await sleep(2500);
    await shot('05b-boss-enraged');
    await key('F9');
    await waitFor((s) => s.boss.state === 'dying' || s.boss.state === 'dead', 5000, 'boss dying');
    await sleep(5200);
    await shot('06-boss-freed');
    await waitFor((s) => s.quests.q4 === 'ready', 10000, 'q4 ready');

    step('ending');
    await key('F10');
    await sleep(600);
    await key('KeyF');
    await click("Let's dance!");
    await waitFor((s) => s.ending, 5000, 'ending');
    await sleep(9000);
    await shot('07-ending-dance');
    fps.ending = (await state()).fps;
    await sleep(2000);
    await key('Space');
    await page.waitForSelector('.credits', { timeout: 15000 });
    await sleep(6000);
    await shot('08-credits');
    await key('Space');
    await sleep(2500);
    await page.waitForSelector('.credits-end.on', { timeout: 8000 });
    await shot('09-credits-end');
  } catch (e) {
    ok = false;
    errors.push(`step failed: ${e.message}`);
    try {
      await shot('zz-failure');
    } catch {
      /* page gone */
    }
  }
  await browser.close();
  const pass = ok && errors.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${cls}`);
  console.log(`  fps ${JSON.stringify(Object.fromEntries(Object.entries(fps).map(([k, v]) => [k, Math.round(v)])))}`);
  console.log(`  console errors: ${errors.length}`);
  for (const e of errors) console.log(`    ${e}`);
  console.log(`  warnings: ${warnings.length}${warnings.length ? ` (first: ${warnings[0]})` : ''}`);
  console.log(`  missing assets (expected until art lands): ${missing.size}${missing.size ? ` ${[...missing].slice(0, 6).join(', ')}` : ''}`);
  console.log(`  screenshots:\n${shots.map((s) => `    ${s}`).join('\n')}`);
  return pass;
}

let allPass = true;
for (const c of classes) {
  if (!SPECS[c]) {
    console.error(`unknown class ${c}`);
    process.exit(2);
  }
  console.log(`playtest ${c}`);
  allPass = (await run(c)) && allPass;
}
console.log(allPass ? 'ALL PASS' : 'SOME FAILED');
process.exit(allPass ? 0 : 1);
