#!/usr/bin/env node
// Frame-time benchmark of the integrated game in installed Chrome (real GPU).
// Boots ?screen=game&debug=1, then measures four scenes: the town square (camera orbiting),
// shore combat, the boss fight and the ending dance. For each scene it records, per 1 s window,
// the frame rate, the CPU time of a frame (update + render submission) and the GPU time of the
// frame from EXT_disjoint_timer_query_webgl2, plus triangles and draw calls.
// The GPU is shared with other work on dev machines, so fps alone is noisy: GPU ms (median and
// the best window) is the number to compare.
//
// Usage: node tools/perf.mjs [--url http://localhost:5209] [--dpr 1] [--size 1600x900]
//          [--class mage] [--scenes town,combat,boss,ending] [--quality high] [--json out.json]
// --quality sets cc.quality before boot (high | low | auto). Measurements default to 'high' so a
// fixed pixel ratio is compared; 'auto' lets dynamic resolution react.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5209');
const dpr = Number(opt('--dpr', '1'));
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const cls = opt('--class', 'mage');
const scenes = opt('--scenes', 'town,combat,boss,ending').split(',');
const quality = opt('--quality', 'high');
const jsonOut = opt('--json', null);

const SPECS = {
  warrior: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Pinchwick' },
  mage: { race: 'nightelf', sex: 'female', classId: 'mage', shell: 1, crest: 1, led: 1, name: 'Tidewhisper' },
  priest: { race: 'tauren', sex: 'male', classId: 'priest', shell: 0, crest: 2, led: 0, name: 'Hoofshell' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
await page.addInitScript(
  ([spec, q]) => {
    localStorage.setItem('cc.spec', JSON.stringify(spec));
    localStorage.setItem('cc.quality', q);
    localStorage.removeItem('cc.resScale');
    localStorage.setItem('cc.hintsSeen', '1');
  },
  [SPECS[cls], quality],
);
await page.goto(`${base}/?screen=game&debug=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true && window.cc, null, { timeout: 120000 });
await sleep(1500);

// Instrument the frame loop: CPU time per frame, GPU time per frame, rAF intervals.
const timerOk = await page.evaluate(() => {
  const eng = window.cc.game.engine;
  const gl = eng.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const P = (window.__perf = { cpu: [], gpu: [], ts: [], tris: 0, calls: 0, pr: 0, w: 0, h: 0, pending: [] });
  const poll = () => {
    while (P.pending.length) {
      const q = P.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      P.pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q);
      if (!disjoint) P.gpu.push(ns / 1e6);
    }
  };
  const frame = eng.frame;
  // Serialized frame cost: run frames back to back and wait for the GPU after each one (a 1 px
  // readback), so the number is CPU + GPU time per frame without vsync.
  const px = new Uint8Array(4);
  P.sync = (n) => {
    P.paused = true;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      frame(t0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(performance.now() - t0);
    }
    P.paused = false;
    return out;
  };
  eng.renderer.setAnimationLoop((t) => {
    if (P.paused) return;
    let q = null;
    if (ext && P.pending.length < 8) {
      q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    }
    const t0 = performance.now();
    frame(t);
    P.cpu.push(performance.now() - t0);
    if (q) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      P.pending.push(q);
    }
    poll();
    P.ts.push(performance.now());
    P.tris = eng.renderer.info.render.triangles;
    P.calls = eng.renderer.info.render.calls;
    P.pr = eng.renderer.getPixelRatio();
    const c = eng.renderer.domElement;
    P.w = c.width;
    P.h = c.height;
  });
  return !!ext;
});

const reset = () => page.evaluate(() => {
  const P = window.__perf;
  P.cpu.length = 0;
  P.gpu.length = 0;
  P.ts.length = 0;
});
const collect = () => page.evaluate(() => {
  const P = window.__perf;
  return { cpu: [...P.cpu], gpu: [...P.gpu], ts: [...P.ts], tris: P.tris, calls: P.calls, pr: P.pr, w: P.w, h: P.h };
});
const med = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Measure `windows` windows of 1 s; `during(i)` runs at the start of each window. */
async function measure(name, windows, during) {
  const rows = [];
  for (let i = 0; i < windows; i++) {
    await reset();
    if (during) await during(i);
    await sleep(1000);
    const d = await collect();
    const span = d.ts.length > 1 ? (d.ts[d.ts.length - 1] - d.ts[0]) / 1000 : 1;
    rows.push({ fps: (d.ts.length - 1) / span, cpu: mean(d.cpu), gpu: med(d.gpu), gpu90: pct(d.gpu, 0.9), tris: d.tris, calls: d.calls, pr: d.pr, w: d.w, h: d.h });
  }
  // Serialized frame cost, three bursts of 30 frames; the best burst median.
  const bursts = [];
  for (let k = 0; k < 3; k++) {
    bursts.push(med(await page.evaluate((n) => window.__perf.sync(n), 30)));
    await sleep(150);
  }
  const fpsAll = rows.map((r) => r.fps);
  const gpuAll = rows.map((r) => r.gpu).filter(Number.isFinite);
  const res = {
    scene: name,
    fpsBest: Math.max(...fpsAll),
    fpsMean: mean(fpsAll),
    fpsWorst: Math.min(...fpsAll),
    gpuMedian: med(gpuAll),
    gpuBest: Math.min(...gpuAll),
    gpuP90: med(rows.map((r) => r.gpu90).filter(Number.isFinite)),
    cpuMean: mean(rows.map((r) => r.cpu)),
    syncBest: Math.min(...bursts),
    syncMedian: med(bursts),
    tris: Math.round(mean(rows.map((r) => r.tris))),
    calls: Math.round(mean(rows.map((r) => r.calls))),
    pixelRatio: rows[rows.length - 1].pr,
    buffer: `${rows[rows.length - 1].w}x${rows[rows.length - 1].h}`,
  };
  const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  console.log(
    `${name.padEnd(8)} fps best ${f(res.fpsBest)} mean ${f(res.fpsMean)} worst ${f(res.fpsWorst)} | gpu ms median ${f(res.gpuMedian, 2)} best ${f(res.gpuBest, 2)} p90 ${f(res.gpuP90, 2)} | cpu ms ${f(res.cpuMean, 2)} | sync frame ms ${f(res.syncBest, 2)} (${f(1000 / res.syncBest, 0)} fps cap) | tris ${(res.tris / 1e6).toFixed(2)}M calls ${res.calls} | pr ${res.pixelRatio} ${res.buffer}`,
  );
  return res;
}

const results = [];
const g = (fn, arg) => page.evaluate(fn, arg);

for (const s of scenes) {
  if (s === 'town') {
    await g(() => {
      const game = window.cc.game;
      const sp = game.world.pois.spawn;
      game.player.unit.teleport(game.world, sp.position.x, sp.position.z, sp.yaw);
      game.follow.yaw = game.player.unit.yaw + Math.PI;
      game.follow.pitch = 0.3;
    });
    await sleep(1200);
    // Orbit the camera a quarter turn per window: town views in every direction.
    results.push(await measure('town', 8, (i) => g((k) => (window.cc.game.follow.yaw += k ? Math.PI / 4 : 0), i)));
  } else if (s === 'combat') {
    await g(() => {
      const game = window.cc.game;
      game.god = true;
      if (game.quests.status.q1 !== 'active') game.quests.accept('q1');
      game.debug.teleport();
      const p = game.player.unit;
      for (const e of game.enemies) if (!e.isAdd && e.unit.alive && Math.hypot(e.unit.pos.x - p.pos.x, e.unit.pos.z - p.pos.z) < 22) e.aggro(false);
    });
    await sleep(1500);
    results.push(
      await measure('combat', 6, async (i) => {
        await page.keyboard.press('Tab');
        await page.keyboard.press(`Digit${1 + (i % 4)}`);
      }),
    );
  } else if (s === 'boss') {
    await g(() => {
      const game = window.cc.game;
      game.god = true;
      game.world.setBeaconLit(true);
      game.world.setMood(1);
      game.boss.wake();
    });
    await sleep(3200);
    await g(() => {
      const game = window.cc.game;
      const a = game.world.pois.bossArena;
      const p = game.player.unit;
      p.teleport(game.world, a.position.x + Math.sin(a.yaw) * 6, a.position.z + Math.cos(a.yaw) * 6, a.yaw + Math.PI);
      game.follow.yaw = p.yaw + Math.PI;
    });
    await sleep(2500);
    results.push(
      await measure('boss', 6, async (i) => {
        await page.keyboard.press('Tab');
        await page.keyboard.press(`Digit${1 + (i % 4)}`);
      }),
    );
  } else if (s === 'ending') {
    await g(() => {
      const game = window.cc.game;
      game.boss.reset();
      void game.ending.start();
    });
    await sleep(4500);
    results.push(await measure('ending', 18));
  }
}

const meta = await page.evaluate(() => ({ renderer: (() => {
  const gl = window.cc.game.engine.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?';
})() }));
console.log(`gpu timer ${timerOk ? 'on' : 'unavailable'}; ${meta.renderer}; ${W}x${H} @ dpr ${dpr}; class ${cls}; quality ${quality}`);
if (errors.length) console.log(`page errors: ${errors.length}\n  ${errors.slice(0, 5).join('\n  ')}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ dpr, size: [W, H], cls, quality, timer: timerOk, results, errors }, null, 2));
await browser.close();
