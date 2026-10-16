#!/usr/bin/env node
// The making-of, end to end, in one command: capture the game's shots for the payoff (the live
// routine in Robot Mode and the ending, ../breakdance/capture.mjs) unless they are there, render
// the title cards, captions, chapter titles, panel labels and stamps (../cards.mjs with this
// folder's captions.json), render the plates from the Jumper review videos (plates.mjs), cut the
// landscape and the portrait video (edit.mjs), draw their contact sheets and check them: ffprobe
// specs, loudness, silence, black frames and the capture's blank-frame repairs.
//
//   node tools/trailer/making-of/make.mjs --jumper <dir> --work <scratch dir> --out-dir <dir>
//     --jumper <dir>                  the folder holding the Jumper worktrees the plan's sources
//                                     name (feat-crabcraft-dance, feat-crabcraft-calm, ...)
//     [--shots-from <dir>]            take live, ending and their -port takes from this folder (a
//                                     breakdance make's <work>/shots) instead of <work>/shots
//     [--recapture]                   capture live and ending again even if <work>/shots has them
//     [--url http://localhost:5243]   use a running dev server instead of starting one
//     [--port 5243]                   port for the dev server this script starts
//     [--cuts land,port] [--skip-cards] [--dsf 2]
//
// Writes <out-dir>/crabcraft-making-of-1920x1080.mp4 and crabcraft-making-of-1080x1920.mp4, their
// .en.srt and .zh.srt, a contact sheet of each, and <work>/report.json. Needs ffmpeg, uv and
// installed Chrome (Playwright's channel 'chrome').
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
if (!opt('--jumper')) throw new Error('--jumper <folder holding the Jumper worktrees> is required');
const jumper = resolve(opt('--jumper'));
const work = resolve(opt('--work', 'making-of-work'));
const outDir = resolve(opt('--out-dir', '.'));
const port = Number(opt('--port', '5243'));
let url = opt('--url', '');
const dsf = opt('--dsf', '2');
const cuts = opt('--cuts', 'land,port').split(',');
const dirs = {
  shots: resolve(opt('--shots-from', resolve(work, 'shots'))),
  cards: resolve(work, 'cards'),
  plates: resolve(work, 'plates'),
  edit: resolve(work, 'edit'),
};
for (const d of [work, outDir, ...Object.values(dirs)]) mkdirSync(d, { recursive: true });

const SIZE = { land: '1920x1080', port: '1080x1920' };
const OUT = Object.fromEntries(cuts.map((c) => [c, resolve(outDir, `crabcraft-making-of-${SIZE[c]}.mp4`)]));
const SHEET = Object.fromEntries(cuts.map((c) => [c, resolve(outDir, `crabcraft-making-of-${SIZE[c]}-contact-sheet.png`)]));
/** The game's shots the payoff cuts from, in both layouts. */
const GAME = ['live', 'ending'];
const GAME_FILES = GAME.flatMap((n) => [n, `${n}-port`]);
/** The video's length, seconds. */
const LENGTH = [60, 120];
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

const missing = opt('--shots-from') ? [] : GAME.filter((n) => flag('--recapture') || [n, `${n}-port`].some((f) => !existsSync(resolve(dirs.shots, `${f}.json`))));
for (const f of GAME_FILES) {
  if (!missing.includes(f.replace(/-port$/, '')) && !existsSync(resolve(dirs.shots, `${f}.mp4`))) throw new Error(`no ${f}.mp4 in ${dirs.shots}`);
}

// ---------------------------------------------------------------------------------- serve

let server = null;
const needServer = missing.length || !flag('--skip-cards');
if (needServer && !url) {
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

  if (missing.length) {
    run('node', [resolve(here, '..', 'breakdance', 'capture.mjs'), '--url', url, '--out', dirs.shots, '--layout', 'both', '--dsf', dsf, '--shots', missing.join(',')]);
  }
  if (!flag('--skip-cards')) {
    for (const layout of cuts) {
      run('node', [resolve(here, '..', 'cards.mjs'), '--url', url, '--out', dirs.cards, '--layout', layout,
        '--captions', resolve(here, 'captions.json'), '--what', 'logo,end,captions',
        '--logo-tag', 'The making of the breakdance', '--logo-tag-zh', '霹雳舞幕后', '--end-note', NOTE.en, '--end-note-zh', NOTE.zh]);
    }
  }
  stop();

  // -------------------------------------------------------------------------------- plates and cuts

  run('node', [resolve(here, 'plates.mjs'), '--jumper', jumper, '--cards', dirs.cards, '--out', dirs.plates, '--layout', cuts.join(',')]);
  // The edit reads the plates and the game's shots from one folder.
  for (const f of GAME_FILES) {
    for (const ext of ['mp4', 'json']) {
      const link = resolve(dirs.plates, `${f}.${ext}`);
      rmSync(link, { force: true });
      symlinkSync(resolve(dirs.shots, `${f}.${ext}`), link);
    }
  }
  for (const cut of cuts) {
    run('node', [resolve(here, 'edit.mjs'), '--shots', dirs.plates, '--cards', dirs.cards, '--work', dirs.edit, '--cut', cut, '--out', OUT[cut]]);
    run('uv', ['run', '-q', '--with', 'pillow', 'python', resolve(here, '..', 'contact_sheet.py'), OUT[cut], SHEET[cut],
      '--every', '2', '--cols', cut === 'port' ? '12' : '6', '--width', cut === 'port' ? '200' : '400']);
  }

  // -------------------------------------------------------------------------------- checks

  const report = {};
  for (const cut of cuts) {
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
  for (const f of GAME_FILES) {
    const m = JSON.parse(readFileSync(resolve(dirs.shots, `${f}.json`), 'utf8'));
    if (m.blanks?.length) report.captureBlanks[f] = m.blanks;
    if (m.errors?.length) (report.pageErrors ??= {})[f] = m.errors;
  }
  writeFileSync(resolve(work, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\n${JSON.stringify(report, null, 1)}`);
  const bad = cuts.flatMap((c) => {
    const r = report[c];
    const why = [];
    if (r.silences.length) why.push(`${c}: silence at ${r.silences.join(', ')}`);
    if (r.blackRuns.length || r.blackFrames.length) why.push(`${c}: black frames`);
    if (Math.abs(r.loudness.integratedLUFS + 14) > 0.6) why.push(`${c}: ${r.loudness.integratedLUFS} LUFS`);
    if (r.duration < LENGTH[0] || r.duration > LENGTH[1]) why.push(`${c}: ${r.duration} s`);
    if (r.video.codec !== 'h264' || r.video.fps !== '60/1' || r.audio.codec !== 'aac') why.push(`${c}: ${r.video.codec} ${r.video.fps}, ${r.audio.codec}`);
    return why;
  });
  console.log(bad.length ? `CHECKS FAILED\n  ${bad.join('\n  ')}` : 'CHECKS PASSED');
  process.exitCode = bad.length ? 1 : 0;
} finally {
  stop();
}
