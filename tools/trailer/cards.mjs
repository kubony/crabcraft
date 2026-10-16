#!/usr/bin/env node
// Renders the trailer's title cards (logo reveal, end card) frame by frame from cards.html, and
// the burned-in captions as transparent PNGs, for a landscape (1920x1080) or portrait (1080x1920)
// layout.
//
// Usage: node tools/trailer/cards.mjs --url http://localhost:5213 --out <dir> [--layout land|port]
//          [--what logo,end,captions] [--captions <file.json>] [--logo-tag <text> --logo-tag-zh <text>]
//          [--end-note <text> --end-note-zh <text>]
// --captions defaults to tools/trailer/captions.json; the logo's tagline defaults to the trailer's;
// --end-note adds a line (and its Chinese) under the end card's handles.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5213');
const outDir = resolve(opt('--out', 'trailer-out'));
const layout = opt('--layout', 'land');
const what = opt('--what', 'logo,end,captions').split(',');
const size = layout === 'port' ? [1080, 1920] : [1920, 1080];
const captionsFile = resolve(opt('--captions', resolve(here, 'captions.json')));
const extra = {
  logo: { tag: opt('--logo-tag'), tagZh: opt('--logo-tag-zh') },
  end: { note: opt('--end-note'), noteZh: opt('--end-note-zh') },
};
const query = (mode) => {
  const q = new URLSearchParams({ mode, layout });
  for (const [k, v] of Object.entries(extra[mode] ?? {})) if (v) q.set(k, v);
  return q;
};
const fps = 60;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--hide-scrollbars'] });

async function card(mode, seconds) {
  const dsf = 2;
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dsf });
  await ctx.routeWebSocket(/./, () => {});
  const page = await ctx.newPage();
  await page.goto(`${base}/tools/trailer/cards.html?${query(mode)}`);
  await page.waitForFunction(() => window.__cardsReady === true, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const file = resolve(outDir, `card-${mode}-${layout}.mp4`);
  const rec = new Recorder(file, { fps });
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), i / fps);
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 95,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: size[0], height: size[1], scale: dsf },
    });
    await rec.write(Buffer.from(r.data, 'base64'));
  }
  await rec.close();
  await ctx.close();
  console.log(`  wrote ${file} (${n} frames)`);
}

async function captions() {
  const list = JSON.parse(readFileSync(captionsFile, 'utf8'));
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const c of list) {
    const pos = (layout === 'port' ? c.portPos : c.landPos) ?? 'bottom';
    const q = new URLSearchParams({ mode: 'caption', layout, en: c.en, zh: c.zh, pos });
    await page.goto(`${base}/tools/trailer/cards.html?${q}`);
    await page.waitForFunction(() => window.__cardsReady === true && document.body.dataset.ready === '1', null, { timeout: 30000 });
    const file = resolve(outDir, `cap-${c.id}-${layout}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    console.log(`  wrote ${file}`);
  }
  await ctx.close();
}

if (what.includes('logo')) await card('logo', 4.8);
if (what.includes('end')) await card('end', 7);
if (what.includes('captions')) await captions();
await browser.close();
