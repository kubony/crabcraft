#!/usr/bin/env node
// The breakdance video, end to end, in one command: serve the app, capture every shot in both
// layouts, render the title cards and captions, cut the landscape and the vertical video, draw
// their contact sheets and check the results (ffprobe specs, loudness, silence, black frames, the
// capture's blank-frame repairs). Re-run it after any clip is re-recorded: every cut follows the
// game's clip windows (routine.mjs).
//
//   node tools/trailer/breakdance/make.mjs --work <scratch dir> --out-dir <dir>
//     [--url http://localhost:5241]   use a running dev server instead of starting one
//     [--port 5241]                   port for the dev server this script starts
//     [--shots routine-a,ending]      capture only these shots (the rest are reused from --work)
//     [--skip-capture] [--skip-cards] [--dsf 2]
//
// Writes <out-dir>/crabcraft-breakdance-1080p.mp4, crabcraft-breakdance-vertical-1080x1920.mp4,
// their .en.srt and .zh.srt, crabcraft-breakdance-contact-sheet.png and
// crabcraft-breakdance-vertical-contact-sheet.png, and <work>/report.json. Needs ffmpeg, uv and
// installed Chrome (Playwright's channel 'chrome').
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const shots = opt('--shots', '');
const dirs = { shots: resolve(work, 'shots'), cards: resolve(work, 'cards'), edit: resolve(work, 'edit') };
for (const d of [work, outDir, ...Object.values(dirs)]) mkdirSync(d, { recursive: true });

const OUT = {
  land: resolve(outDir, 'crabcraft-breakdance-1080p.mp4'),
  port: resolve(outDir, 'crabcraft-breakdance-vertical-1080x1920.mp4'),
};
const SHEET = {
  land: resolve(outDir, 'crabcraft-breakdance-contact-sheet.png'),
  port: resolve(outDir, 'crabcraft-breakdance-vertical-contact-sheet.png'),
};
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

  if (!flag('--skip-capture')) {
    run('node', [resolve(here, 'capture.mjs'), '--url', url, '--out', dirs.shots, '--layout', 'both', '--dsf', dsf, ...(shots ? ['--shots', shots] : [])]);
  }
  if (!flag('--skip-cards')) {
    for (const layout of ['land', 'port']) {
      run('node', [resolve(here, '..', 'cards.mjs'), '--url', url, '--out', dirs.cards, '--layout', layout,
        '--captions', resolve(here, 'captions.json'), '--what', 'logo,end,captions',
        '--logo-tag', 'The breakdance', '--logo-tag-zh', '霹雳舞', '--end-note', NOTE.en, '--end-note-zh', NOTE.zh]);
    }
  }
  stop();

  // -------------------------------------------------------------------------------- the cuts

  for (const cut of ['land', 'port']) {
    run('node', [resolve(here, 'edit.mjs'), '--shots', dirs.shots, '--cards', dirs.cards, '--work', dirs.edit, '--cut', cut, '--out', OUT[cut]]);
    run('uv', ['run', '-q', '--with', 'pillow', 'python', resolve(here, '..', 'contact_sheet.py'), OUT[cut], SHEET[cut],
      '--every', '2', '--cols', cut === 'port' ? '11' : '6', '--width', cut === 'port' ? '220' : '400']);
  }

  // -------------------------------------------------------------------------------- checks

  const report = {};
  for (const cut of ['land', 'port']) {
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
  writeFileSync(resolve(work, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\n${JSON.stringify(report, null, 1)}`);
  const bad = ['land', 'port'].flatMap((c) => {
    const r = report[c];
    const why = [];
    if (r.silences.length) why.push(`${c}: silence at ${r.silences.join(', ')}`);
    if (r.blackRuns.length || r.blackFrames.length) why.push(`${c}: black frames`);
    if (Math.abs(r.loudness.integratedLUFS + 14) > 0.6) why.push(`${c}: ${r.loudness.integratedLUFS} LUFS`);
    if (r.duration < 30 || r.duration > 45) why.push(`${c}: ${r.duration} s`);
    return why;
  });
  console.log(bad.length ? `CHECKS FAILED\n  ${bad.join('\n  ')}` : 'CHECKS PASSED');
  process.exitCode = bad.length ? 1 : 0;
} finally {
  stop();
}
