#!/usr/bin/env node
// Headless check of the breakdance in installed Chrome (real GPU), with screenshots for review:
//   game   boots ?screen=game&debug=1 with a saved crab, presses B, follows the routine through
//          window.cc.state() and fails unless all six moves play in order and it ends completed;
//          then starts it again and walks (W) to check that moving ends it;
//   robot  opens Robot Mode (?screen=robot), switches into each of the seven live breaking modes on
//          Shift + its digit, and fails unless each one runs and hands back to walking: the spin is
//          let go with Shift + 5 again; the 720 and the back flip are pressed nothing more, and must
//          hand back by the page's own press (its log says "page pressed") without a Safe Hold.
//   routine opens Robot Mode again, presses P and follows the live routine (src/robot/sim/routine.ts)
//          on the HUD: it fails unless the six moves run live in order, each policy starts within
//          100 ms of its downbeat (the log's "live" lines), the page's presses are logged, the music
//          plays and stays within 60 ms of the simulation (dev server only: it reads
//          window.__robotMusic), and the routine ends complete with the robot walking and never in
//          the Safe Hold; then it starts it again and presses P during the six-step, which must stop
//          it and hand the robot back to walking.
// Any console error or uncaught exception fails the run.
//
//   node tools/breakdance-check.mjs [--url http://localhost:5206] [--out dir] [--only game|robot|routine]
// Needs a dev or preview server running (pnpm dev --port 5206 --strictPort).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5206');
const outDir = resolve(opt('--out', 'breakdance-out'));
const only = opt('--only', '');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEC = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' };
const ROUTINE = ['break_toprock', 'break_sixstep', 'break_spin', 'break_jumpspin', 'break_backflip', 'break_oneclaw'];
// Robot Mode's live breaking modes: [mode, HUD label, key, seconds held before letting go (0: ends by
// itself; -1: a jump, which the page ends by pressing its switch again after the landing)]
const LIVE = [
  ['break_toprock', 'Toprock', 'Digit1', 0],
  ['break_sixstep', 'Six-step', 'Digit2', 0],
  ['break_clawstand', 'Claw Stand', 'Digit3', 0],
  ['break_oneclaw', 'One Claw', 'Digit4', 0],
  ['power_spin', 'Spin', 'Digit5', 4],
  ['power_jumpspin', '720', 'Digit6', -1],
  ['power_backflip', 'Back Flip', 'Digit7', -1],
];
// Seconds after the policy shows live to take the jumps' screenshot: about the top of the jump.
const AIR_SHOT = { power_jumpspin: 0.35, power_backflip: 0.25 };

async function open(url, spec) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url2 = m.location()?.url ?? '';
    // Missing art/audio is counted by the playtest, not failed; the same here.
    if (/Failed to load resource/.test(m.text()) && /\/(art|audio|fonts)\//.test(url2)) return;
    errors.push(`${m.text()} ${url2 ? `(${url2})` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (spec) await page.addInitScript((s) => localStorage.setItem('cc.spec', JSON.stringify(s)), spec);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  return { browser, page, errors };
}

async function checkGame() {
  const { browser, page, errors } = await open(`${base}/?screen=game&debug=1`, SPEC);
  const shots = [];
  const shot = async (name) => {
    const file = resolve(outDir, `game-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const state = () => page.evaluate(() => window.cc.state());
  const fails = [];
  const seen = [];
  let yaw0 = 0;
  let yaw1 = 0;
  try {
    await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 90000 });
    await sleep(2500);
    await page.mouse.click(800, 450);
    // A camera in front of the crab, a little to its left, so the moves read.
    await page.evaluate(() => {
      const g = window.cc.game;
      g.follow.yaw = g.player.unit.yaw + 0.5;
      g.follow.pitch = 0.2;
      g.follow.distance = 9;
    });
    await sleep(800);
    yaw0 = await page.evaluate(() => window.cc.game.player.unit.yaw);
    await shot('00-idle');
    await page.keyboard.press('KeyB');
    const t0 = Date.now();
    let last = null;
    const midShots = { break_spin: 2.2, break_sixstep: 2.0, break_toprock: 2.5, break_oneclaw: 2.6, break_jumpspin: 0.42, break_backflip: 0.3 };
    let stepAt = 0;
    let shotDone = false;
    for (;;) {
      const s = (await state()).breakdance;
      if (s.step && s.step !== last) {
        last = s.step;
        seen.push(s.step);
        stepAt = Date.now();
        shotDone = false;
      }
      if (last && !shotDone && (Date.now() - stepAt) / 1000 >= midShots[last]) {
        shotDone = true;
        await shot(`${String(seen.length).padStart(2, '0')}-${last}`);
      }
      if (!s.active && seen.length) {
        if (s.lastCompleted !== true) fails.push(`the routine ended early (lastCompleted ${s.lastCompleted}) at ${last}`);
        break;
      }
      if (Date.now() - t0 > 60000) {
        fails.push('the routine did not end within 60 s');
        break;
      }
      await sleep(40);
    }
    const length = (Date.now() - t0) / 1000;
    yaw1 = await page.evaluate(() => window.cc.game.player.unit.yaw);
    await sleep(600);
    await shot('07-after');
    if (JSON.stringify(seen) !== JSON.stringify(ROUTINE)) fails.push(`moves seen ${seen.join(', ')}`);
    console.log(`  game: routine ${seen.join(' > ')} in ${length.toFixed(1)} s wall; crab heading ${(((yaw1 - yaw0) * 180) / Math.PI).toFixed(1)} deg from where it started`);

    // Moving ends it.
    await page.keyboard.press('KeyB');
    await sleep(2000);
    const during = (await state()).breakdance;
    await page.keyboard.down('KeyW');
    await sleep(400);
    await page.keyboard.up('KeyW');
    const after = (await state()).breakdance;
    if (!during.active) fails.push('B did not start the routine a second time');
    if (after.active || after.lastCompleted !== false) fails.push(`walking did not end it (active ${after.active}, lastCompleted ${after.lastCompleted})`);
    console.log(`  game: second run at ${during.step}, W pressed -> active ${after.active}, completed ${after.lastCompleted}`);
  } catch (e) {
    fails.push(`step failed: ${e.message}`);
  }
  await browser.close();
  return { fails, errors, shots };
}

async function checkRobot() {
  const { browser, page, errors } = await open(`${base}/?screen=robot`, SPEC);
  const shots = [];
  const fails = [];
  const shot = async (name) => {
    const file = resolve(outDir, `robot-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const modeName = () => page.evaluate(() => document.querySelector('.rm-mode .name')?.textContent ?? '');
  const live = () => page.evaluate(() => !!document.querySelector('.rm-badge.live'));
  const waitMode = async (label, running, timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if ((await modeName()) === label && (!running || (await live()))) return true;
      await sleep(50);
    }
    return false;
  };
  const chord = async (code) => {
    await page.keyboard.down('Shift');
    await page.keyboard.down(code);
    await sleep(120);
    await page.keyboard.up(code);
    await page.keyboard.up('Shift');
  };
  try {
    await page.waitForSelector('.rm-loading.done', { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('.rm-btn.loading'), null, { timeout: 120000 });
    await sleep(2500);
    await page.mouse.move(800, 450);
    await shot('00-dock');
    for (const [mode, label, code, hold] of LIVE) {
      await chord(code);
      if (!(await waitMode(label, true, 8000))) {
        fails.push(`${mode}: the policy never ran (HUD shows ${await modeName()})`);
        continue;
      }
      const t0 = Date.now();
      if (hold < 0) {
        // A jump: nothing more is pressed. It must come back to walking by the page's own press,
        // never through the Safe Hold.
        await sleep(AIR_SHOT[mode] * 1000);
        await shot(mode);
        let safe = false;
        let back = false;
        // The log keeps its last five lines, so the press is watched for while waiting: read only
        // at the end, a slow page could have scrolled it out under the transitions that follow it.
        const sawPress = () => page.evaluate(() => [...document.querySelectorAll('.rm-log div')].some((d) => /page pressed/.test(d.textContent ?? '')));
        let pressed = await sawPress();
        while (Date.now() - t0 < 15000) {
          const name = await modeName();
          if (name === 'Safe Hold') safe = true;
          pressed ||= await sawPress();
          if (name === 'Walk' && (await live())) {
            back = true;
            break;
          }
          await sleep(40);
        }
        pressed ||= await sawPress();
        if (safe) fails.push(`${mode}: went to the Safe Hold`);
        if (!back) fails.push(`${mode}: did not hand back to walking`);
        if (!pressed) fails.push(`${mode}: the log does not show the page's press`);
        if (back && !safe) console.log(`  robot: ${mode} ran live and was handed back to walking by the page after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        await shot(`${mode}-after`);
        await sleep(800);
        continue;
      }
      await sleep(hold > 0 ? hold * 1000 * 0.6 : mode === 'break_sixstep' ? 2200 : 3000);
      await shot(mode);
      if (hold > 0) {
        await sleep(Math.max(0, hold * 1000 - (Date.now() - t0)));
        await chord(code);
      }
      if (!(await waitMode('Walk', true, 15000))) fails.push(`${mode}: did not hand back to walking`);
      else console.log(`  robot: ${mode} ran live and handed back to walking after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await sleep(800);
    }
  } catch (e) {
    fails.push(`step failed: ${e.message}`);
  }
  await browser.close();
  return { fails, errors, shots };
}

// The live routine's moves in order, as the mode card names them (src/robot/hud.ts MODE_LABEL).
const ROUTINE_LABELS = ['Toprock', 'Six-step', 'Spin', '720', 'Back Flip', 'One Claw'];
// Seconds after each move's policy goes live to take its screenshot (the jumps near their apex).
const ROUTINE_SHOT = { Toprock: 2.5, 'Six-step': 2.0, Spin: 2.0, '720': 0.33, 'Back Flip': 0.22, 'One Claw': 2.6 };

async function checkRoutine() {
  const { browser, page, errors } = await open(`${base}/?screen=robot`, SPEC);
  const shots = [];
  const fails = [];
  const shot = async (name) => {
    const file = resolve(outDir, `routine-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const state = () =>
    page.evaluate(() => {
      const el = document.querySelector('.rm-routine');
      return {
        routine: el?.dataset.state ?? '',
        slips: Number(el?.dataset.slips ?? 0),
        why: el?.dataset.why ?? '',
        mode: document.querySelector('.rm-mode .name')?.textContent ?? '',
        live: !!document.querySelector('.rm-badge.live'),
        log: [...document.querySelectorAll('.rm-log div')].map((d) => d.textContent ?? ''),
        sync: window.__robotMusic?.sync() ?? null,
        on: !!document.querySelector('.rm-btn.routine.on'),
      };
    });
  try {
    await page.waitForSelector('.rm-loading.done', { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('.rm-btn.loading'), null, { timeout: 120000 });
    await sleep(2500);
    await page.mouse.move(800, 450);
    await page.keyboard.press('KeyP');
    const t0 = Date.now();
    const seen = [];
    const logged = new Set();
    const syncErr = [];
    let lastMode = '';
    let liveAt = 0;
    let shotDone = true;
    let safe = false;
    let s;
    for (;;) {
      s = await state();
      for (const l of s.log) logged.add(l);
      if (s.mode === 'Safe Hold') safe = true;
      if (s.live && s.mode !== lastMode && ROUTINE_LABELS.includes(s.mode)) {
        seen.push(s.mode);
        liveAt = Date.now();
        shotDone = false;
      }
      if (s.live) lastMode = s.mode;
      if (!shotDone && (Date.now() - liveAt) / 1000 >= ROUTINE_SHOT[lastMode]) {
        shotDone = true;
        await shot(`${String(seen.length).padStart(2, '0')}-${lastMode.toLowerCase().replace(/\W+/g, '')}`);
      }
      if (s.sync && s.sync.at !== null && s.routine === 'running') syncErr.push(Math.abs(s.sync.want - s.sync.at));
      if (s.routine && s.routine !== 'running' && Date.now() - t0 > 2000) break;
      if (Date.now() - t0 > 70000) {
        fails.push('the routine did not end within 70 s');
        break;
      }
      await sleep(40);
    }
    const length = (Date.now() - t0) / 1000;
    await sleep(1200);
    const end = await state();
    for (const l of end.log) logged.add(l);
    await shot('07-after');
    if (JSON.stringify(seen) !== JSON.stringify(ROUTINE_LABELS)) fails.push(`moves seen live ${seen.join(', ')}`);
    if (s.routine !== 'done') fails.push(`the routine ended ${s.routine}: ${s.why}`);
    if (s.slips) fails.push(`${s.slips} bar(s) slipped`);
    if (safe) fails.push('the robot went to the Safe Hold');
    if (!(end.mode === 'Walk' && end.live)) fails.push(`it ended in ${end.mode}, not walking`);
    const lines = [...logged];
    const presses = lines.filter((l) => /page pressed Shift\+\d/.test(l));
    // Six starts, the spin's end, and the two jumps' ends by the host.
    if (presses.length < ROUTINE_LABELS.length + 3) fails.push(`only ${presses.length} of the page's presses were in the log`);
    const offs = lines.map((l) => l.match(/ live .*downbeat ([+-]\d+) ms/)).filter(Boolean).map((m) => Number(m[1]));
    if (offs.length !== ROUTINE_LABELS.length) fails.push(`the log has ${offs.length} live lines, not ${ROUTINE_LABELS.length}`);
    if (offs.some((o) => Math.abs(o) > 100)) fails.push(`a move started more than 100 ms off its downbeat (${offs.join(', ')} ms)`);
    const sorted = [...syncErr].sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : null;
    // The music is read on the dev server only (window.__robotMusic is not in a build).
    const dev = await page.evaluate(() => !!window.__robotMusic);
    if (dev && (!sorted.length || p90 > 0.06)) fails.push(`the music did not play in step (${sorted.length} samples, p90 ${p90 === null ? '-' : (p90 * 1000).toFixed(0)} ms)`);
    console.log(`  routine: ${seen.join(' > ')} in ${length.toFixed(1)} s wall, ended ${s.routine}; policy starts ${offs.join(', ')} ms from their downbeats; ` +
      `${presses.length} presses logged; music against the simulation: ${sorted.length ? `median ${(sorted[sorted.length >> 1] * 1000).toFixed(0)} ms, p90 ${(p90 * 1000).toFixed(0)} ms, max ${(sorted.at(-1) * 1000).toFixed(0)} ms over ${sorted.length} samples` : 'not read (not a dev server)'}`);

    // P again stops it: started anew, stopped during the six-step, the robot walking again.
    await sleep(1000);
    await page.keyboard.press('KeyP');
    const t1 = Date.now();
    while (Date.now() - t1 < 20000 && !((s = await state()).mode === 'Six-step' && s.live)) await sleep(40);
    if (!(s.mode === 'Six-step' && s.live)) fails.push('the second run never reached the six-step');
    await sleep(1500);
    await shot('08-before-stop');
    await page.keyboard.press('KeyP');
    const t2 = Date.now();
    let stoppedSafe = false;
    while (Date.now() - t2 < 8000) {
      s = await state();
      if (s.mode === 'Safe Hold') stoppedSafe = true;
      if (s.routine === 'stopped' && s.mode === 'Walk' && s.live) break;
      await sleep(40);
    }
    if (s.routine !== 'stopped') fails.push(`P did not stop the routine (${s.routine})`);
    if (!(s.mode === 'Walk' && s.live)) fails.push(`after P the robot was in ${s.mode}, not walking`);
    if (stoppedSafe) fails.push('stopping went through the Safe Hold');
    if (s.on) fails.push('the Routine button still shows on');
    if (s.sync && s.sync.at !== null) fails.push('the music played on after the stop');
    console.log(`  routine: P during the six-step stopped it (${s.routine}); walking again ${((Date.now() - t2) / 1000).toFixed(1)} s later`);
    await shot('09-stopped');
  } catch (e) {
    fails.push(`step failed: ${e.message}`);
  }
  await browser.close();
  return { fails, errors, shots };
}

const results = {};
let pass = true;
for (const [name, fn] of [['game', checkGame], ['robot', checkRobot], ['routine', checkRoutine]]) {
  if (only && only !== name) continue;
  console.log(`breakdance ${name}`);
  const r = await fn();
  results[name] = r;
  const ok = r.fails.length === 0 && r.errors.length === 0;
  pass = pass && ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  for (const f of r.fails) console.log(`  fail: ${f}`);
  console.log(`  console errors: ${r.errors.length}`);
  for (const e of r.errors) console.log(`    ${e}`);
  console.log(`  screenshots:\n${r.shots.map((s) => `    ${s}`).join('\n')}`);
}
writeFileSync(resolve(outDir, 'breakdance-check.json'), JSON.stringify(results, null, 1));
console.log(pass ? 'ALL PASS' : 'SOME FAILED');
process.exit(pass ? 0 : 1);
