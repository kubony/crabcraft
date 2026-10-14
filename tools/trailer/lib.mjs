// Shared plumbing for the trailer capture scripts: a Chrome page in capture mode (?capture=1, see
// src/capture/clock.ts), a frame-exact recorder that steps the page by a fixed dt, screenshots
// the whole page (canvas and HTML HUD) through CDP and pipes the frames into ffmpeg.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PAGE_HELPERS = readFileSync(resolve(here, 'page.js'), 'utf8');
export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

export const SPECS = {
  warrior: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' },
  orcWarrior: { race: 'orc', sex: 'male', classId: 'warrior', shell: 0, crest: 1, led: 0, name: 'Grukclaw' },
  mage: { race: 'nightelf', sex: 'female', classId: 'mage', shell: 0, crest: 1, led: 1, name: 'Tidewhisper' },
  priest: { race: 'tauren', sex: 'male', classId: 'priest', shell: 1, crest: 2, led: 0, name: 'Hoofshell' },
};

/** Hidden in every shot: debug readout, skip hint, control hints. */
const BASE_CSS = `
  .debug-readout, .skip-hint, .hints { display: none !important; }
  * { cursor: none !important; caret-color: transparent !important; }
`;

/**
 * Open the app in capture mode. `query` is the rest of the URL query (screen=...), `spec` the saved
 * crab, `size` the CSS viewport, `dsf` the device scale (2 renders and captures at twice the size).
 */
export async function openApp({ base, query, spec = null, size = [1920, 1080], dsf = 2, storage = {}, seed = 7 }) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dsf });
  // Swallow the dev server's HMR socket: an edit in the worktree must not reload a page mid-shot.
  await ctx.routeWebSocket(/./, () => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(
    ([s, extra]) => {
      if (s) localStorage.setItem('cc.spec', JSON.stringify(s));
      else localStorage.removeItem('cc.spec');
      localStorage.setItem('cc.quality', 'high');
      localStorage.setItem('cc.hintsSeen', '1');
      localStorage.removeItem('cc.resScale');
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    [spec, storage],
  );
  await page.addInitScript(PAGE_HELPERS);
  await page.goto(`${base}/?${query}&capture=1&seed=${seed}`, { waitUntil: 'load', timeout: 90000 });
  await page.addStyleTag({ content: BASE_CSS });
  const cdp = await ctx.newCDPSession(page);
  return { browser, ctx, page, cdp, errors, size, dsf };
}

/** Add CSS to the page (hide HUD parts for a shot). Returns the style element handle. */
export const css = (page, content) => page.addStyleTag({ content });

/** Pipe JPEG frames into ffmpeg and write an H.264 intermediate. */
export class Recorder {
  constructor(file, { fps = 60, crf = 14 } = {}) {
    mkdirSync(dirname(file), { recursive: true });
    this.file = file;
    this.frames = 0;
    this.proc = spawn(
      FFMPEG,
      ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    this.done = new Promise((res, rej) => this.proc.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c} for ${file}`)))));
  }

  async write(buf) {
    this.frames++;
    if (!this.proc.stdin.write(buf)) await new Promise((r) => this.proc.stdin.once('drain', r));
  }

  async close() {
    this.proc.stdin.end();
    await this.done;
  }
}

/** Screenshot the full page at device resolution. */
export async function grab(app, quality = 95) {
  const [w, h] = app.size;
  const r = await app.cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality,
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: w, height: h, scale: app.dsf },
  });
  return Buffer.from(r.data, 'base64');
}

/** Step the page clock without recording (settle, pre-roll). */
export async function advance(app, seconds, fps = 60) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i += 30) {
    const k = Math.min(30, n - i);
    await app.page.evaluate(([k, dt]) => window.__capture.step(k, dt), [k, 1000 / fps]);
  }
}

/**
 * Record a shot. `duration` is in shot time (seconds of game time); `speed(t)` slows time down
 * (0.5 = half speed) for ramps, so the output can run longer than `duration`. `events` run at
 * their shot time before the frame is stepped; an event with a `mark` records the output frame
 * it landed on, for the edit. Writes <file>.mp4 and <file>.json.
 */
export async function record(app, file, { duration, fps = 60, speed = null, events = [], stills = [], log = true }) {
  const rec = new Recorder(`${file}.mp4`, { fps });
  const ev = [...events].sort((a, b) => a.t - b.t);
  const marks = {};
  const times = [];
  let t = 0;
  let ei = 0;
  const t0 = Date.now();
  const stillSet = new Set(stills);
  // Two frames before the first recorded one: the game culls crabs and places nameplates with the
  // camera of the previous frame, which after a cut is somewhere else entirely.
  await app.page.evaluate((dt) => window.__capture.step(2, dt), 1000 / fps);
  await app.page.evaluate(() => window.__T?.rebase());
  while (t < duration - 1e-6) {
    while (ei < ev.length && ev[ei].t <= t + 1e-6) {
      const e = ev[ei++];
      if (e.mark) marks[e.mark] = rec.frames;
      if (e.fn) await e.fn(app.page);
    }
    const s = speed ? speed(t) : 1;
    const dt = (1000 / fps) * s;
    await app.page.evaluate((dt) => window.__capture.step(1, dt), dt);
    t += dt / 1000;
    times.push(Number(t.toFixed(4)));
    const buf = await grab(app);
    if (stillSet.has(rec.frames)) writeFileSync(`${file}-${String(rec.frames).padStart(4, '0')}.jpg`, buf);
    await rec.write(buf);
    if (log && rec.frames % 120 === 0) process.stdout.write(`  ${file.split('/').pop()} ${rec.frames} frames, t=${t.toFixed(2)}s\n`);
  }
  await rec.close();
  const meta = { frames: rec.frames, fps, duration, marks, times, wallSeconds: (Date.now() - t0) / 1000, errors: app.errors.slice() };
  writeFileSync(`${file}.json`, JSON.stringify(meta));
  if (log) console.log(`  wrote ${file}.mp4: ${rec.frames} frames in ${meta.wallSeconds.toFixed(0)} s${app.errors.length ? `, ${app.errors.length} page errors` : ''}`);
  return meta;
}
