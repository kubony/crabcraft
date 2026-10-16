#!/usr/bin/env node
// Renders the making-of's plates (plan.mjs PLATES) from the Jumper review videos, for a landscape
// (1920x1080) or portrait (1080x1920) cut: on a dark ground, one panel (a single take, full frame)
// or two (BEFORE and AFTER: side by side in landscape, one over the other in portrait), each a
// window of its source at its speed, fitted to its slot, with its label (cards.mjs, `label`) at
// its top left and a stamp (`stamp`) over the take it rejects. Each plate is <id>-<layout>.mp4
// with <id>-<layout>.json ({ frames }), at 60 fps in the captures' convention (full-range BT.601,
// as Chrome's JPEG screenshots are), so ../breakdance/cut.mjs render() cuts them like any shot.
// A plate is rendered again only when its sources, labels or settings changed.
//
// Usage: node tools/trailer/making-of/plates.mjs --jumper <dir> --cards <dir> --out <dir>
//          [--layout land,port] [--only bug1-720,bug2]
// --jumper is the folder holding the Jumper worktrees the plan's sources name
// (feat-crabcraft-dance, ...), --cards the cards.mjs output with the making-of's captions.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BAR, FPS, ff } from '../breakdance/cut.mjs';
import { PLATES, SOURCES } from './plan.mjs';

/** Where the panels go: two slots side by side (landscape) or stacked (portrait), or one. */
export const LAYOUT = {
  land: {
    W: 1920, H: 1080,
    pair: [{ x: 24, y: 166, w: 924, h: 656 }, { x: 972, y: 166, w: 924, h: 656 }],
    single: { x: 0, y: 0, w: 1920, h: 1080 },
  },
  port: {
    W: 1080, H: 1920,
    pair: [{ x: 24, y: 334, w: 1032, h: 536 }, { x: 24, y: 890, w: 1032, h: 536 }],
    single: { x: 0, y: 330, w: 1080, h: 1100 },
  },
};
/** Seconds into its plate a stamp lands. */
export const STAMP_AT = 0.35;
const GROUND = '0x10131a';

const even = (x) => 2 * Math.round(x / 2);

/** The largest rectangle of aspect `a` inside `slot`, centred. */
function fit(a, slot) {
  const w = even(Math.min(slot.w, slot.h * a));
  const h = even(w / a);
  return { x: slot.x + even((slot.w - w) / 2), y: slot.y + even((slot.h - h) / 2), w, h };
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, duration: Number(j.format.duration) };
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file) {
  const b = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  readSync(fd, b, 0, 24, 0);
  closeSync(fd);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Render plate `p` for `layout` into `out`. Returns the file written (or kept). */
export function renderPlate(p, layout, { jumper, cards, out }) {
  const L = LAYOUT[layout];
  const port = layout === 'port';
  // Two frames over the plate's length: the edit rounds its cuts to the frame.
  const n = Math.ceil(p.bars * BAR * FPS) + 2;
  const secs = n / FPS;
  const slots = p.panels.length === 2 ? L.pair : [L.single];
  const inputs = [];
  const chains = [`color=c=${GROUND}:s=${L.W}x${L.H}:r=${FPS}:d=${(secs + 0.5).toFixed(3)},format=rgb24[bg]`];
  const deps = [];
  let base = '[bg]';
  let k = 0;
  const rects = p.panels.map((pan, i) => {
    const file = resolve(jumper, SOURCES[pan.src]);
    if (!existsSync(file)) throw new Error(`${p.id}: no source ${file}`);
    deps.push(file, statSync(file).mtimeMs);
    const info = probe(file);
    const crop = (port && pan.portCrop) || pan.crop || [0, 0, info.w, info.h];
    const speed = pan.speed ?? 1;
    const hold = pan.hold ?? 0;
    const image = /\.(png|jpe?g)$/i.test(file);
    const need = pan.freeze ? pan.from : pan.from + (secs - hold) * speed;
    if (!image && need > info.duration + 1e-3) throw new Error(`${p.id}: ${pan.src} runs out at ${info.duration.toFixed(3)} s, the plate needs it to ${need.toFixed(3)} s`);
    const r = fit(crop[2] / crop[3], slots[i]);
    let c = `[${k++}:v]crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`;
    if (image) {
      // A still image, shown for the whole plate.
      inputs.push('-loop', '1', '-framerate', String(FPS), '-i', file);
    } else if (pan.freeze) {
      // One frame of a video, held for the whole plate.
      inputs.push('-ss', pan.from.toFixed(4), '-i', file);
      c += `,trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${(secs + 1).toFixed(3)},fps=${FPS}`;
    } else {
      inputs.push('-ss', pan.from.toFixed(4), '-i', file);
      c += `,setpts=(PTS-STARTPTS)/${speed},fps=${FPS}`;
      if (hold) c += `,tpad=start_duration=${hold}:start_mode=clone`;
    }
    if (pan.zoom) {
      // A push in: zoompan over a 3x copy, so its whole-pixel crop moves in thirds of a pixel.
      const { z: [z0, z1], at: [a0, a1], focus: [fx, fy] } = pan.zoom;
      const z = `st(0,clip((on/${FPS}-${a0})/${a1 - a0},0,1));${z0}+${z1 - z0}*ld(0)*ld(0)*(3-2*ld(0))`;
      c += `,scale=${3 * r.w}:${3 * r.h}:flags=bicubic,zoompan=z='${z}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':d=1:s=${r.w}x${r.h}:fps=${FPS}`;
    } else {
      c += `,scale=${r.w}:${r.h}:flags=lanczos`;
    }
    chains.push(`${c},format=rgb24[p${i}]`);
    chains.push(`${base}[p${i}]overlay=x=${r.x}:y=${r.y}[o${i}]`);
    base = `[o${i}]`;
    return r;
  });
  const still = (id, x, y, st, d, tag) => {
    const file = resolve(cards, `cap-${id}-${layout}.png`);
    if (!existsSync(file)) throw new Error(`${p.id}: no ${file} (cards.mjs with the making-of's captions)`);
    deps.push(file, statSync(file).mtimeMs);
    inputs.push('-loop', '1', '-framerate', String(FPS), '-i', file);
    chains.push(`[${k++}:v]format=rgba,fade=t=in:st=${st}:d=${d}:alpha=1[${tag}]`);
    chains.push(`${base}[${tag}]overlay=x=${Math.round(x)}:y=${Math.round(y)}[${tag}o]`);
    base = `[${tag}o]`;
    return file;
  };
  (p.labels ?? []).forEach((id, i) => {
    const r = rects[i];
    // On a full-frame take the label keeps clear of the top edge's title band.
    const m = port ? 12 : 14;
    still(id, r.x + m, r.y + m + (r.y === 0 ? 150 : 0), 0.1, 0.25, `l${i}`);
  });
  if (p.stamp) {
    const r = rects[rects.length - 1];
    const s = pngSize(resolve(cards, `cap-${p.stamp}-${layout}.png`));
    still(p.stamp, r.x + (r.w - s.w) / 2, r.y + r.h * (rects.length === 2 ? 0.16 : 0.2), STAMP_AT, 0.06, 'st');
  }
  chains.push(`${base}scale=out_range=pc:out_color_matrix=bt601,format=yuv420p[v]`);
  mkdirSync(out, { recursive: true });
  const file = resolve(out, `${p.id}-${layout}.mp4`);
  const argv = [...inputs, '-filter_complex', chains.join(';'), '-map', '[v]', '-frames:v', String(n),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '10', '-g', '60', '-pix_fmt', 'yuv420p', '-color_range', 'pc', '-colorspace', 'bt470bg', '-an', file];
  const key = JSON.stringify([argv, deps]);
  const keyFile = `${file}.key`;
  if (existsSync(file) && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key) {
    console.log(`  kept ${p.id}-${layout}`);
    return file;
  }
  ff(argv, `plate ${p.id} (${layout})`);
  writeFileSync(resolve(out, `${p.id}-${layout}.json`), JSON.stringify({ frames: n, fps: FPS, plate: p.id, layout, rects }));
  writeFileSync(keyFile, key);
  console.log(`  wrote ${file} (${n} frames)`);
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const jumper = opt('--jumper');
  if (!jumper) throw new Error('--jumper <folder holding the Jumper worktrees> is required');
  const only = (opt('--only', '') || '').split(',').filter(Boolean);
  for (const layout of opt('--layout', 'land,port').split(',')) {
    for (const p of PLATES.filter((x) => !only.length || only.includes(x.id))) {
      renderPlate(p, layout, { jumper: resolve(jumper), cards: resolve(opt('--cards', 'cards')), out: resolve(opt('--out', 'plates')) });
    }
  }
}
