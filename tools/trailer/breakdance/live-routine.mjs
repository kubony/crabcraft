#!/usr/bin/env node
// Records Robot Mode's live breakdance routine (src/robot/sim/routine.ts) frame by frame in capture
// mode (tools/trailer/lib.mjs, src/capture/clock.ts) and puts the routine's music
// (public/audio/music-breaking.ogg) under it from the routine's bar 0. The simulation steps in
// lockstep with the frames, so the video shows what a person sees in real time on any machine: the
// bare robot, Robot Mode's own camera, and the HUD's mode card, routine line, log (every press the
// page makes), telemetry and the dock's Breaking group. The page presses P's action and nothing else.
//
// Usage: node tools/trailer/breakdance/live-routine.mjs --url http://localhost:5241 --out <dir>
//          [--size 1920x1080] [--fps 30] [--dsf 1] [--hud min|full]
// Needs the dev server running (pnpm dev --port 5241 --strictPort) and ffmpeg. Writes
// <out>/live-routine.mp4 (with the music), live-routine-silent.mp4 and live-routine-silent.json (a
// probe per frame: simulated time, mode, the routine's state).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advance, css, FFMPEG, openApp, record } from '../lib.mjs';
import { ROUTINE } from '../../../src/robot/sim/routine.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5241');
const outDir = resolve(opt('--out', 'live-routine-out'));
const size = opt('--size', '1920x1080').split('x').map(Number);
const fps = Number(opt('--fps', '30'));
const dsf = Number(opt('--dsf', '1'));
const hud = opt('--hud', 'min');
mkdirSync(outDir, { recursive: true });
const music = resolve(here, '../../../public/audio/music-breaking.ogg');

const app = await openApp({ base, query: 'screen=robot', spec: null, size, dsf });
const { page } = app;
const file = resolve(outDir, 'live-routine-silent');
try {
  const modes = ROUTINE.map((m) => m.mode);
  await page.waitForFunction((m) => window.__robotMode && m.every((x) => window.__robotMode.client.policies.has(x)), modes, { timeout: 180000 });
  await page.evaluate(() => window.__robotMode.handle.setAppearance('bare'));
  if (hud === 'min') {
    await page.evaluate(() => {
      for (const g of document.querySelectorAll('.rm-dock .rm-group')) {
        if (g.querySelector('.gl')?.textContent?.trim().toLowerCase() === 'breaking') g.classList.add('cap-break');
      }
    });
    await css(page, `
      .rm-tools, .rm-help, .rm-notice, .rm-look { display: none !important; }
      .rm-dock > .rm-group:not(.cap-break) { display: none !important; }
      .rm-dock > .rm-group.cap-break { border-left: none !important; padding-left: 4px !important; }
    `);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__capture.begin());
  await advance(app, 1.5, fps);
  const meta = await record(app, file, {
    duration: 45,
    fps,
    events: [
      {
        t: 0.5,
        mark: 'start',
        fn: (p) =>
          p.evaluate(() => {
            if (!window.__robotMode.handle.startRoutine()) throw new Error('Robot Mode did not start the routine');
          }),
      },
    ],
    probe: () => {
      const h = window.__robotMode.handle;
      const s = h.getState();
      const r = h.routine;
      return { sim: s.simTime, mode: s.mode, run: s.runningPolicy, routine: r && { state: r.state, t0: r.t0, move: r.move, phase: r.phase, slips: r.slips } };
    },
  });
  // The music's zero is the routine's bar 0 (sim time t0); the simulation runs at one simulated
  // second per video second, so the music starts where the video's clock meets t0 (frame i of the
  // video is shown at i / fps).
  const i = meta.probe.findIndex((p) => p.routine && Number.isFinite(p.routine.t0));
  if (i < 0) throw new Error('the routine never started');
  const { t0 } = meta.probe[i].routine;
  const delay = i / fps - (meta.probe[i].sim - t0);
  const last = meta.probe.at(-1).routine;
  console.log(`routine bar 0 at ${delay.toFixed(3)} s of the video; it ended ${last?.state} (slips ${last?.slips})`);
  if (delay < 0) throw new Error('the routine started before the recording');
  const ms = Math.round(delay * 1000);
  const r = spawnSync(FFMPEG, [
    '-v', 'error', '-y', '-i', `${file}.mp4`, '-i', music,
    '-filter_complex', `[1:a]adelay=${ms}|${ms},apad[a]`, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', resolve(outDir, 'live-routine.mp4'),
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg could not add the music');
  console.log(`wrote ${resolve(outDir, 'live-routine.mp4')}`);
  if (app.errors.length) console.log(`page errors:\n${app.errors.join('\n')}`);
} finally {
  await app.browser.close();
}
