#!/usr/bin/env node
// The breakdance videos, end to end, in one command: serve the app, capture every shot, render the
// title cards and captions, cut, draw the contact sheets and check the results (ffprobe specs,
// loudness, silence, black frames, the capture's blank-frame repairs). Re-run it after any clip is
// re-recorded or the bundle changes: every cut follows the probes the shots record (the game's
// clip windows, routine.mjs; the live routine's bars; each jump's landing).
//
//   node tools/trailer/breakdance/make.mjs --work <scratch dir> --out-dir <dir>
//     [--reel]                        the showcase reel of every dance and move (reel.mjs) instead
//                                     of the contest cut (edit.mjs, landscape and vertical)
//     [--url http://localhost:5241]   use a running dev server instead of starting one
//     [--port 5241]                   port for the dev server this script starts
//     [--shots live,ending]           capture only these shots (the rest are reused from --work)
//     [--reuse]                       capture only the shots --work does not have yet
//     [--skip-capture] [--skip-cards] [--dsf 2]
//
// The contest cut writes <out-dir>/crabcraft-breakdance-1080p.mp4,
// crabcraft-breakdance-vertical-1080x1920.mp4, their .en.srt and .zh.srt and contact sheets; the
// reel crabcraft-moves-showcase-1080p.mp4, its .srt files and contact sheet; both a report in
// <work> (report.json, reel-report.json). Run the cut first and the reel with --reuse in the same
// --work: the reel takes the live routine, the slow 720 and the game's shots from it. Needs ffmpeg,
// uv and installed Chrome (Playwright's channel 'chrome').
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);
const work = resolve(opt('--work', 'breakdance-work'));
const outDir = resolve(opt('--out-dir', '.'));
const port = Number(opt('--port', '5241'));
let url = opt('--url', '');
const dsf = opt('--dsf', '2');
const reel = flag('--reel');
const dirs = { shots: resolve(work, 'shots'), cards: resolve(work, reel ? 'reel-cards' : 'cards'), edit: resolve(work, reel ? 'reel-edit' : 'edit') };
for (const d of [work, outDir, ...Object.values(dirs)]) mkdirSync(d, { recursive: true });

const OUT = reel
  ? { reel: resolve(outDir, 'crabcraft-moves-showcase-1080p.mp4') }
  : { land: resolve(outDir, 'crabcraft-breakdance-1080p.mp4'), port: resolve(outDir, 'crabcraft-breakdance-vertical-1080x1920.mp4') };
const SHEET = reel
  ? { reel: resolve(outDir, 'crabcraft-moves-showcase-contact-sheet.png') }
  : { land: resolve(outDir, 'crabcraft-breakdance-contact-sheet.png'), port: resolve(outDir, 'crabcraft-breakdance-vertical-contact-sheet.png') };
const CUTS = Object.keys(OUT);
/** The shots each video cuts from (capture.mjs), and in which layouts. */
const SHOTS = reel
  ? { layout: 'land', names: ['dance-crab', 'dance-brazilian', 'dance-maze', 'dance-dream-wings', 'moves', 'jump-live-slow', 'flip-live-slow', 'live', 'routine-a', 'ending'] }
  : { layout: 'both', names: ['jump-live-slow', 'live', 'routine-a', 'routine-b', 'jump-slow', 'flip-slow2', 'ending'] };
/** Each video's length, seconds. */
const LENGTH = reel ? [60, 120] : [30, 45];
const shotsWanted = (() => {
  const asked = opt('--shots', '');
  if (asked) return asked.split(',');
  if (!flag('--reuse')) return SHOTS.names;
  const layouts = SHOTS.layout === 'both' ? ['', '-port'] : [''];
  return SHOTS.names.filter((n) => layouts.some((sfx) => !existsSync(resolve(dirs.shots, `${n}${sfx}.json`))));
})();
/** The end card's note: the moves are simulation results. */
const NOTE = {
  en: 'Trained in simulation. Not yet run on a physical Jumper.',
  zh: '仿真训练结果，尚未在实体 Jumper 上运行。',
};

function run(cmd, argv, opts = {}) {
  console.log(`\n$ ${cmd} ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: repo, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

function capture(cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

async function up(u) {
  try {
    return (await fetch(u)).ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------- serve

let server = null;
if (!url) {
  url = `http://localhost:${port}`;
  if (await up(url)) throw new Error(`port ${port} is taken; pass --url to use that server or --port for another`);
  server = spawn('pnpm', ['dev', '--port', String(port), '--strictPort'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  for (let i = 0; i < 60 && !(await up(url)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(url))) throw new Error(`the dev server did not come up on ${url}`);
  console.log(`dev server on ${url}`);
}
const stop = () => {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
    server = null;
  }
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

try {
  // -------------------------------------------------------------------------------- shots and cards

  if (!flag('--skip-capture') && shotsWanted.length) {
    run('node', [resolve(here, 'capture.mjs'), '--url', url, '--out', dirs.shots, '--layout', SHOTS.layout, '--dsf', dsf, '--shots', shotsWanted.join(',')]);
  }
  if (!flag('--skip-cards')) {
    for (const layout of reel ? ['land'] : ['land', 'port']) {
      run('node', [resolve(here, '..', 'cards.mjs'), '--url', url, '--out', dirs.cards, '--layout', layout,
        '--captions', resolve(here, reel ? 'reel-captions.json' : 'captions.json'), '--what', 'logo,end,captions',
        '--logo-tag', reel ? 'Every dance, every move' : 'The breakdance', '--logo-tag-zh', reel ? '每一支舞，每一个动作' : '霹雳舞',
        '--end-note', NOTE.en, '--end-note-zh', NOTE.zh]);
    }
  }
  stop();

  // -------------------------------------------------------------------------------- the cuts

  for (const cut of CUTS) {
    if (reel) run('node', [resolve(here, 'reel.mjs'), '--shots', dirs.shots, '--cards', dirs.cards, '--work', dirs.edit, '--out', OUT[cut]]);
    else run('node', [resolve(here, 'edit.mjs'), '--shots', dirs.shots, '--cards', dirs.cards, '--work', dirs.edit, '--cut', cut, '--out', OUT[cut]]);
    // The reel is long: a frame every 4 s keeps its sheet readable.
    run('uv', ['run', '-q', '--with', 'pillow', 'python', resolve(here, '..', 'contact_sheet.py'), OUT[cut], SHEET[cut],
      '--every', reel ? '4' : '2', '--cols', cut === 'port' ? '11' : '6', '--width', cut === 'port' ? '220' : '400']);
  }

  // -------------------------------------------------------------------------------- checks

  const report = {};
  for (const cut of CUTS) {
    const f = OUT[cut];
    const probe = JSON.parse(capture('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels', '-of', 'json', f]));
    const v = probe.streams.find((s) => s.codec_type === 'video');
    const a = probe.streams.find((s) => s.codec_type === 'audio');
    const loud = capture('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const I = Number(loud.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
    const TP = Number(loud.match(/Peak:\s+(-?[\d.]+) dBFS/g).pop().match(/-?[\d.]+/)[0]);
    const sil = capture('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=n=-40dB:d=0.3', '-f', 'null', '-']);
    const silences = [...sil.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
    const blk = capture('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-vf', 'blackdetect=d=0.05:pix_th=0.10:pic_th=0.98,blackframe=amount=98:threshold=32', '-an', '-f', 'null', '-']);
    const blackRuns = [...blk.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const blackFrames = [...blk.matchAll(/frame:(\d+) pblack:(\d+)/g)].map((m) => Number(m[1]));
    report[cut] = {
      file: f,
      duration: Number(probe.format.duration),
      sizeBytes: Number(probe.format.size),
      video: { codec: v.codec_name, profile: v.profile, width: v.width, height: v.height, fps: v.r_frame_rate, pix_fmt: v.pix_fmt },
      audio: { codec: a.codec_name, sample_rate: a.sample_rate, channels: a.channels },
      loudness: { integratedLUFS: I, truePeakDBFS: TP },
      silences,
      blackRuns,
      blackFrames,
    };
  }
  // Frames the capture found blank (the 3D canvas dropping a frame) and how each was repaired.
  report.captureBlanks = {};
  for (const f of readdirSync(dirs.shots).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(resolve(dirs.shots, f), 'utf8'));
    if (m.blanks?.length) report.captureBlanks[f.replace(/\.json$/, '')] = m.blanks;
    if (m.errors?.length) (report.pageErrors ??= {})[f.replace(/\.json$/, '')] = m.errors;
  }
  writeFileSync(resolve(work, reel ? 'reel-report.json' : 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\n${JSON.stringify(report, null, 1)}`);
  const bad = CUTS.flatMap((c) => {
    const r = report[c];
    const why = [];
    if (r.silences.length) why.push(`${c}: silence at ${r.silences.join(', ')}`);
    if (r.blackRuns.length || r.blackFrames.length) why.push(`${c}: black frames`);
    if (Math.abs(r.loudness.integratedLUFS + 14) > 0.6) why.push(`${c}: ${r.loudness.integratedLUFS} LUFS`);
    if (r.duration < LENGTH[0] || r.duration > LENGTH[1]) why.push(`${c}: ${r.duration} s`);
    return why;
  });
  console.log(bad.length ? `CHECKS FAILED\n  ${bad.join('\n  ')}` : 'CHECKS PASSED');
  process.exitCode = bad.length ? 1 : 0;
} finally {
  stop();
}
