#!/usr/bin/env node
// Headless screenshot of a page served by `pnpm dev` / `pnpm preview`, with real GPU WebGL.
// Usage: node tools/shot.mjs <url> <out.png> [--wait-ready] [--size 1600x900] [--timeout 60000] [--eval "js"]
// --wait-ready waits until the page sets `window.__ready = true` (set it after the first good frame).
// Console errors and warnings are printed so a broken page is visible in the log.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [--wait-ready] [--size WxH] [--timeout ms] [--eval js]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const [w, h] = opt('--size', '1600x900').split('x').map(Number);
const timeout = Number(opt('--timeout', '60000'));
const evalJs = opt('--eval', null);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout });
if (args.includes('--wait-ready')) {
  await page.waitForFunction(() => window.__ready === true, null, { timeout });
} else {
  await page.waitForTimeout(3000);
}
if (evalJs) {
  await page.evaluate(evalJs);
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2');
  const d = g && g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no webgl2';
});
console.log(`saved ${out} (${w}x${h}) renderer=${gl}`);
await browser.close();
