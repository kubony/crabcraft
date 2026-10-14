#!/usr/bin/env node
// Cuts the trailer from the captured shots (tools/trailer/capture.mjs), the title cards and the
// captions (tools/trailer/cards.mjs): picture edit, burned-in captions, flashes, music and sound
// effects from public/audio, two-pass loudness normalisation to -14 LUFS, H.264 high + AAC.
// Also writes English and Chinese SRT files.
//
// Usage: node tools/trailer/edit.mjs --shots <dir> --cards <dir> --work <dir> --out <file.mp4> [--cut land|port]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const AUDIO = resolve(repo, 'public', 'audio');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const shotsDir = resolve(opt('--shots', 'trailer-out'));
const cardsDir = resolve(opt('--cards', 'trailer-out'));
const cut = opt('--cut', 'land');
const work = resolve(opt('--work', 'trailer-work'), cut);
const outFile = resolve(opt('--out', `crabcraft-trailer-${cut}.mp4`));
mkdirSync(work, { recursive: true });
mkdirSync(dirname(outFile), { recursive: true });

const FPS = 60;
const [W, H] = cut === 'port' ? [1080, 1920] : [1920, 1080];
const CAPTIONS = Object.fromEntries(JSON.parse(readFileSync(resolve(here, 'captions.json'), 'utf8')).map((c) => [c.id, c]));

function ff(argv, label, level = 'error') {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', level, '-y', ...argv], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(r.stderr.toString());
    throw new Error(`ffmpeg failed: ${label}`);
  }
  return r.stderr.toString();
}

const meta = {};
const shot = (name) => (meta[name] ??= JSON.parse(readFileSync(resolve(shotsDir, `${name}.json`), 'utf8')));
/** Output time (s) of a marked event in a shot. */
const mark = (name, m) => shot(name).marks[m] / FPS;

/**
 * The skills beat: the slam, the cast and the power-down from the skills shot (marks are the key
 * presses), one cut each, filling timeline [t0, t1). Each window starts so the move's moment lands
 * a fixed time into its cut: the slam's claws meet the floor, the cast's claws fling wide, the
 * shell settles. Moments are seconds after the press, read off the capture frame by frame.
 * Returns the segments (with `extra` merged in, e.g. portrait framing) and the moments' timeline
 * times for the sound effects.
 */
const SKILL_MOMENTS = { slamHit: 1.85, castRelease: 3.17, pdDown: 2.53 };
function skillBeat(src, t0, t1, extra = {}) {
  const press = (m) => mark(src, m);
  const d = t1 - t0;
  const c1 = t0 + d * 0.32;
  const c2 = t0 + d * 0.66;
  // Lead-ins before each moment: the claws' wind-up, the channel before the fling, the legs giving way.
  const slamIn = press('slam') + SKILL_MOMENTS.slamHit - 0.92;
  const castIn = press('cast') + SKILL_MOMENTS.castRelease - 1.05;
  const pdIn = press('powerdown') + SKILL_MOMENTS.pdDown - 0.95;
  return {
    segs: [
      { src, in: slamIn, end: c1, ...extra },
      { src, in: castIn, end: c2, ...extra },
      { src, in: pdIn, end: t1, ...extra },
    ],
    slamHit: t0 + 0.92,
    castRelease: c1 + 1.05,
    pdStart: c2,
    pdDown: c2 + 0.95,
  };
}

/** Sound for the skills beat: servos on each cut, the slam's impact, the cast's sweep, the power-down. */
const skillSfx = (sk) => [
  ['sfx-servo-whir', sk.slamHit - 0.85, 0.4],
  ['sfx-crit', sk.slamHit, 0.6],
  ['sfx-hit', sk.slamHit + 0.01, 0.5],
  ['sfx-cast', sk.castRelease - 0.4, 0.55],
  ['sfx-servo-whir', sk.castRelease + 0.02, 0.3],
  // Its whine runs 1.65 s before the clunk: started just before the cut, the clunk lands as the
  // shell settles (0.43 s after it touches down).
  ['sfx-death', sk.pdDown + 0.43 - 1.65, 0.45],
];

// ---------------------------------------------------------------------------------- beat grids

/** Title theme: 121.75 bpm, first beat 0.389 s into the file; the swell at 14.68 s lands on the logo,
 * and the theme starts with the first frame (its quiet opening carries the cold open). */
const TITLE_BEAT = 60 / 121.75;
const LOGO_AT = 14.681;
const TITLE_START = LOGO_AT - 14.681; // timeline time of the title file's 0
const tb = (n) => LOGO_AT + n * TITLE_BEAT;
const COMBAT_BEAT = 60 / 145.75;
const BOSS_BEAT = 60 / 169.5;
const END_BEAT = 60 / 69;

// ---------------------------------------------------------------------------------- the cut

/**
 * Edit decision list: each entry plays `src` from `in` (seconds of that clip) until timeline `end`.
 * `zoom` punches in (crop of the 4K source), `cx`/`cy` place the crop centre (fractions); for the
 * portrait cut, `px` (and optional `px2` at the segment end) is the horizontal centre of the 9:16 crop,
 * and `native` marks a take captured on a portrait page, used whole.
 */
function landCut() {
  const c0 = tb(49); // combat starts after the town section
  const C = (n) => c0 + n * COMBAT_BEAT;
  const b0 = C(29);
  const D = (n) => b0 + n * BOSS_BEAT;
  const e0 = D(28);
  const E = (n) => e0 + n * END_BEAT;
  const crab = { cx: 0.4713, cy: 0.415 };
  // Cold open, cut on the title theme's beats up to the logo: the face (A), the dance with the HUD
  // (B), three of the six new skills (S), the switch to a crab (C).
  const aEnd = tb(-22);
  const bEnd = tb(-15);
  const sEnd = tb(-6);
  const sw = mark('robot', 'switch');
  const cIn = sw - 0.35;
  const swAt = sEnd + 0.35; // the switch on the timeline
  const sk = skillBeat('skills', bEnd, sEnd);
  const segs = [
    { src: 'robot', in: 0, end: aEnd },
    { src: 'robot', in: 6.2, end: bEnd },
    ...sk.segs,
    { src: 'robot', in: cIn, end: LOGO_AT },
    { src: 'card-logo-land', in: 0, end: tb(9) },
  ];
  // Character creation: two beats per crab, every other cut punched in on the dais.
  const picks = [['create', 0.1], ...['orc', 'dwarf', 'undead', 'nightelf', 'tauren', 'mage', 'rnd1', 'rnd2', 'rnd3'].map((m) => ['create', mark('create', m) + 0.06])];
  // The default crab gets a beat and a half (the next pick lands 0.9 s into the clip), the last
  // Randomize two and a half.
  picks.forEach(([src, at], i) => segs.push({ src, in: at, end: i === picks.length - 1 ? tb(29) : tb(10.5 + i * 2), zoom: i % 2 ? 1.18 : 1, ...crab }));
  segs.push(
    { src: 'town-crane', in: 0.5, end: tb(41) },
    { src: 'town-brine', in: Math.max(0, mark('town-brine', 'wave') - 0.15), end: c0 },
    { src: 'warrior', in: 0.9, end: C(9) },
    { src: 'mage', in: mark('mage', 'nova') - 0.75, end: C(16) },
    { src: 'priest', in: mark('priest', 'tide') - 0.8, end: C(23) },
    { src: 'leap', in: 0.15, end: b0 },
    { src: 'beacon', in: mark('beacon', 'blaze') - 0.45, end: D(7) },
    { src: 'rise', in: mark('rise', 'wake') - 0.25, end: D(16) },
    { src: 'fight', in: 0.6, end: e0 },
    // Corrodius powers down (the trained death: his hull settles on the deck and stays), then
    // Little Red steps out.
    { src: 'death', in: 0.05, end: E(2) },
    { src: 'death', in: 3.88, end: E(5) },
    { src: 'dance', in: 1.2, end: E(9) },
    { src: 'card-end-land', in: 0, end: E(9) + 6.2 },
  );
  const captions = [
    ['jumper', 0.6, aEnd - 0.2],
    ['policy', aEnd + 0.2, bEnd - 0.15],
    ['skills', bEnd + 0.2, sEnd - 0.2],
    ['same', sEnd + 0.15, LOGO_AT - 0.3],
    ['races', tb(10.5), tb(21)],
    ['town', tb(29) + 0.4, tb(41) - 0.3],
    ['combat', c0 + 0.45, C(10)],
    ['boss', b0 + 0.35, D(13)],
    ['dance', E(5) + 0.25, E(9) - 0.2],
  ];
  const flashes = [
    { at: LOGO_AT, d: 0.32, a: 0.85 },
    { at: c0, d: 0.16, a: 0.55 },
    { at: b0, d: 0.16, a: 0.45 },
    { at: e0, d: 0.3, a: 0.7 },
  ];
  // Music: each track joins on a beat; the title's swell lands on the logo.
  const music = [
    { file: 'music-title', from: 0, at: TITLE_START, end: c0, fadeIn: 0.4, fadeOut: 0.06, gain: 1.0 },
    { file: 'music-combat', from: 0.261 + 2 * COMBAT_BEAT, at: c0, end: b0, fadeIn: 0.02, fadeOut: 0.06, gain: 0.95 },
    { file: 'music-boss', from: 0.209, at: b0, end: e0, fadeIn: 0.02, fadeOut: 0.08, gain: 0.85 },
    { file: 'music-ending', from: 0.842 + 3 * END_BEAT, at: e0, end: E(9) + 6.2, fadeIn: 0.03, fadeOut: 1.8, gain: 0.95 },
  ];
  const sfx = [
    ['sfx-servo-whir', 0.5, 0.35],
    ['sfx-servo-whir', aEnd + 0.05, 0.45],
    ...skillSfx(sk),
    ['sfx-levelup', swAt, 0.75],
    ['sfx-servo-whir', swAt + 0.05, 0.4],
    ['sfx-crit', LOGO_AT, 0.75],
    ['sfx-beacon', LOGO_AT + 0.02, 0.45],
    ...picks.slice(1, 7).map((_, i) => ['sfx-click', tb(10.5 + i * 2), 0.5]),
    ['sfx-servo-whir', tb(22.5), 0.35],
    ['sfx-servo-whir', tb(24.5), 0.35],
    ['sfx-servo-whir', tb(26.5), 0.35],
    ['sfx-quest-accept', tb(41) + 0.3, 0.55],
    ['sfx-hit', c0 + (mark('warrior', 'strike') - 0.9) + 0.25, 0.6],
    ['sfx-crit', c0 + (mark('warrior', 'whirlpool') - 0.9) + 0.05, 0.7],
    ['sfx-servo-whir', c0 + (mark('warrior', 'whirlpool') - 0.9), 0.45],
    ['sfx-cast', C(9) + 0.7, 0.5],
    ['sfx-crit', C(9) + 0.78, 0.7],
    ['sfx-heal', C(16) + 0.78, 0.8],
    ['sfx-crit', C(16) + 0.85, 0.35],
    ['sfx-hit', C(23) + 1.9, 0.6],
    ['sfx-beacon', b0 + 0.45, 0.9],
    ['sfx-boss-roar', D(7) + 0.25, 0.85],
    ['sfx-crit', D(16) + 1.6, 0.8],
    ['sfx-hit', D(16) + 1.62, 0.6],
    ['sfx-boss-roar', D(16) + (mark('fight', 'phase2') - 0.6), 0.6],
    ['sfx-death', e0 + 0.05, 0.6],
    ['sfx-boss-roar', e0 + 0.1, 0.45],
    ['sfx-levelup', E(2) + 0.2, 0.55],
    ['sfx-crit', E(5) + 0.5, 0.25],
    ['sfx-crit', E(5) + 1.6, 0.2],
    ['sfx-crit', E(5) + 2.7, 0.25],
  ];
  const cards = [
    ['tagline', LOGO_AT + 1.8, tb(9) - 0.1],
    ['endcard', E(9) + 0.9, E(9) + 5.9],
  ];
  return { segs, captions, cards, flashes, music, sfx, total: E(9) + 6.2, fadeIn: 0.5, fadeOut: 0.8 };
}

/**
 * Portrait cut (about 44 s) for Shorts, TikTok and Douyin: the same 4K masters re-framed with a
 * 9:16 crop that follows the subject, portrait title cards and captions placed above the app UI.
 */
function portCut() {
  const L = 12.8; // logo
  const tbp = (n) => L + n * TITLE_BEAT;
  const c0 = tbp(17); // combat
  const C = (n) => c0 + n * COMBAT_BEAT;
  const b0 = C(16);
  const D = (n) => b0 + n * BOSS_BEAT;
  const e0 = D(18);
  const E = (n) => e0 + n * END_BEAT;
  const end = E(5) + 5.2;
  const sw = mark('robot', 'switch');
  const aEnd = tbp(-21);
  const bEnd = tbp(-15);
  const sEnd = tbp(-6.5);
  // The skills come from their own portrait take (the HUD laid out for the tall page), uncropped.
  const sk = skillBeat('skills-port', bEnd, sEnd, { native: true });
  const segs = [
    // Robot: face push-in, the dance, three of the six skills, the switch (slow motion).
    { src: 'robot', in: 0.6, end: aEnd, px: 0.5 },
    { src: 'robot', in: 7.2, end: bEnd, px: 0.5 },
    ...sk.segs,
    { src: 'robot', in: sw - 0.5, end: L, px: 0.5 },
    { src: 'card-logo-port', in: 0, end: tbp(6) },
    { src: 'create', in: mark('create', 'orc') + 0.06, end: tbp(8), px: 0.4713 },
    { src: 'create', in: mark('create', 'undead') + 0.06, end: tbp(10), px: 0.4713 },
    { src: 'create', in: mark('create', 'nightelf') + 0.06, end: tbp(12), px: 0.4713 },
    { src: 'create', in: mark('create', 'tauren') + 0.06, end: tbp(14), px: 0.4713 },
    { src: 'town-crane', in: 2.4, end: c0, px: 0.5 },
    // Framed so the nameplates, the boss frame and the speech bubbles stay inside the 9:16 crop or
    // clear of it (measured on the 4K masters): in the warrior's shot the second Scrapling's plates
    // stay right of the frame until they swing in; the boss's yell sits right of Little Red; the
    // fight's bubble, boss frame and banner fit only between x 1417 and 1435 of 3840, at the cost
    // of the hero's left legs.
    { src: 'warrior', in: mark('warrior', 'whirlpool') - 0.35, end: C(6), px: 0.405 },
    { src: 'mage', in: mark('mage', 'nova') - 0.35, end: C(11), px: 0.69 },
    { src: 'priest', in: mark('priest', 'tide') - 0.45, end: b0, px: 0.65 },
    { src: 'beacon', in: mark('beacon', 'blaze') - 0.3, end: D(6), px: 0.5 },
    { src: 'rise', in: mark('rise', 'wake') + 0.2, end: D(12), px: 0.5 },
    { src: 'fight', in: 1.0, end: e0, px: 0.528 },
    { src: 'death', in: 3.6, end: E(2), px: 0.455, px2: 0.43 },
    { src: 'dance', in: 1.2, end: E(5), px: 0.5 },
    { src: 'card-end-port', in: 0, end },
  ];
  const captions = [
    ['jumper', 0.3, aEnd - 0.15],
    ['policy', aEnd + 0.15, bEnd - 0.15],
    ['skills', bEnd + 0.2, sEnd - 0.2],
    ['same', sEnd + 0.15, L - 0.25],
    ['races', tbp(6) + 0.3, tbp(14) - 0.2],
    ['combat', c0 + 0.3, C(11)],
    ['boss', b0 + 0.3, D(12)],
    ['dance', E(2) + 0.2, E(5) - 0.15],
  ];
  const flashes = [
    { at: L, d: 0.3, a: 0.85 },
    { at: c0, d: 0.15, a: 0.5 },
    { at: e0, d: 0.28, a: 0.65 },
  ];
  const music = [
    { file: 'music-title', from: 14.681 - (L - 0), at: 0, end: c0, fadeIn: 0.25, fadeOut: 0.06, gain: 1.0 },
    { file: 'music-combat', from: 0.261 + 2 * COMBAT_BEAT, at: c0, end: b0, fadeIn: 0.02, fadeOut: 0.06, gain: 0.95 },
    { file: 'music-boss', from: 0.209, at: b0, end: e0, fadeIn: 0.02, fadeOut: 0.08, gain: 0.85 },
    { file: 'music-ending', from: 0.842 + 3 * END_BEAT, at: e0, end, fadeIn: 0.03, fadeOut: 1.6, gain: 0.95 },
  ];
  const sfx = [
    ['sfx-servo-whir', 0.2, 0.35],
    ['sfx-servo-whir', aEnd + 0.05, 0.4],
    ...skillSfx(sk),
    ['sfx-levelup', sEnd + 0.5, 0.75],
    ['sfx-crit', L, 0.75],
    ['sfx-beacon', L + 0.02, 0.45],
    ['sfx-click', tbp(6), 0.5],
    ['sfx-click', tbp(8), 0.5],
    ['sfx-click', tbp(10), 0.5],
    ['sfx-click', tbp(12), 0.5],
    ['sfx-crit', c0 + 0.4, 0.7],
    ['sfx-crit', C(6) + 0.38, 0.7],
    ['sfx-heal', C(11) + 0.48, 0.8],
    ['sfx-beacon', b0 + 0.3, 0.9],
    ['sfx-boss-roar', D(6), 0.85],
    ['sfx-crit', D(12) + 1.15, 0.8],
    ['sfx-levelup', e0 + 0.2, 0.5],
    ['sfx-crit', E(2) + 0.6, 0.25],
    ['sfx-crit', E(2) + 1.8, 0.2],
  ];
  const cards = [
    ['tagline', L + 1.8, tbp(6) - 0.1],
    ['endcard', E(5) + 0.9, end - 0.3],
  ];
  return { segs, captions, cards, flashes, music, sfx, total: end, fadeIn: 0.3, fadeOut: 0.8 };
}

const plan = cut === 'port' ? portCut() : landCut();

// ---------------------------------------------------------------------------------- picture

const srcFile = (name) => (name.startsWith('card-') ? resolve(cardsDir, `${name}.mp4`) : resolve(shotsDir, `${name}.mp4`));
const frames = (s) => Math.round(s * FPS);
// The captures are Chrome JPEG screenshots: full-range BT.601 YCbCr. Deliver limited-range BT.709.
const SCALE = `scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`;
const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
let t = 0;
const list = [];
plan.segs.forEach((s, i) => {
  const start = frames(t);
  const stop = frames(s.end);
  const n = stop - start;
  if (n <= 0) throw new Error(`segment ${i} (${s.src}) has no length`);
  const f0 = frames(s.in);
  const srcFrames = s.src.startsWith('card-') ? Infinity : shot(s.src).frames;
  if (f0 + n > srcFrames) throw new Error(`segment ${i} (${s.src}) runs past its clip: ${f0}+${n} > ${srcFrames}`);
  // Sources are 3840x2160 (landscape) or 2160x3840 (portrait cards and `native` portrait takes).
  let vf;
  if (cut === 'port' && !s.src.startsWith('card-') && !s.native) {
    const cw = 1215;
    const x0 = Math.round((s.px ?? 0.5) * 3840 - cw / 2);
    const x1 = Math.round((s.px2 ?? s.px ?? 0.5) * 3840 - cw / 2);
    const clampX = (x) => Math.max(0, Math.min(3840 - cw, x));
    const x = x0 === x1 ? String(clampX(x0)) : `'max(0,min(${3840 - cw},${x0}+(${x1 - x0})*n/${n}))'`;
    vf = `crop=${cw}:2160:${x}:0,${SCALE}`;
  } else {
    const z = s.zoom ?? 1;
    const cw = Math.round(3840 / z / 2) * 2;
    const ch = Math.round(2160 / z / 2) * 2;
    const cx = Math.max(0, Math.min(3840 - cw, Math.round((s.cx ?? 0.5) * 3840 - cw / 2)));
    const cy = Math.max(0, Math.min(2160 - ch, Math.round((s.cy ?? 0.5) * 2160 - ch / 2)));
    vf = `${z !== 1 ? `crop=${cw}:${ch}:${cx}:${cy},` : ''}${SCALE}`;
  }
  const file = resolve(work, `seg-${String(i).padStart(2, '0')}.mp4`);
  // Re-render a segment only when its source, range or framing changed.
  const key = JSON.stringify([srcFile(s.src), statSync(srcFile(s.src)).mtimeMs, f0, n, vf]);
  const keyFile = `${file}.key`;
  if (!existsSync(file) || !existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) {
    ff(
      ['-i', srcFile(s.src), '-vf', `trim=start_frame=${f0}:end_frame=${f0 + n},setpts=PTS-STARTPTS,${vf},fps=${FPS},format=yuv420p`,
        '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'fast', '-crf', '9', '-g', '60', ...TAGS, '-an', file],
      `segment ${i}`,
    );
    writeFileSync(keyFile, key);
  }
  list.push(`file '${file}'`);
  console.log(`  seg ${String(i).padStart(2)} ${s.src.padEnd(15)} in ${s.in.toFixed(3).padStart(7)}  ${t.toFixed(3)} -> ${s.end.toFixed(3)} (${n} frames)`);
  t = stop / FPS;
});
writeFileSync(resolve(work, 'list.txt'), `${list.join('\n')}\n`);
const body = resolve(work, 'body.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', resolve(work, 'list.txt'), '-c', 'copy', body], 'concat');
const total = t;

// ---------------------------------------------------------------------------------- sound

const audioIn = [];
const aChains = [];
const addIn = (file) => {
  audioIn.push('-i', file);
  return audioIn.length / 2 - 1;
};
for (const m of plan.music) {
  const k = addIn(resolve(AUDIO, `${m.file}.ogg`));
  const dur = m.end - m.at + 0.03;
  aChains.push(
    `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${m.from.toFixed(4)}:duration=${dur.toFixed(4)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${m.fadeIn},afade=t=out:st=${(dur - m.fadeOut).toFixed(4)}:d=${m.fadeOut},volume=${m.gain},` +
      `adelay=${Math.round(Math.max(0, m.at) * 1000)}:all=1`,
  );
}
for (const [name, at, gain] of plan.sfx) {
  if (at < 0 || at > total) continue;
  const k = addIn(resolve(AUDIO, `${name}.ogg`));
  aChains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${gain},adelay=${Math.round(at * 1000)}:all=1`);
}
const labels = aChains.map((_, i) => `[a${i}]`);
const aGraph = `${aChains.map((c, i) => `${c}${labels[i]}`).join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=duration=${total.toFixed(4)},afade=t=out:st=${(total - 0.25).toFixed(3)}:d=0.25[mix]`;
const rawMix = resolve(work, 'mix-raw.wav');
ff([...audioIn, '-filter_complex', aGraph, '-map', '[mix]', '-c:a', 'pcm_f32le', '-ar', '48000', rawMix], 'audio mix');
// Tame the sound-effect transients with a limiter, then two-pass EBU R128 normalisation to
// -14 LUFS (linear gain, so nothing pumps), true peak under -2 dBTP so the AAC encode stays under -1.
const LN = 'I=-14:TP=-2:LRA=11';
const limited = resolve(work, 'mix-limited.wav');
ff(['-i', rawMix, '-af', 'alimiter=limit=0.4:attack=3:release=80:level=false,aresample=192000,alimiter=limit=0.4:attack=1:release=50:level=false,aresample=48000', '-c:a', 'pcm_f32le', limited], 'limiter');
const m1 = ff(['-i', limited, '-af', `loudnorm=${LN}:print_format=json`, '-f', 'null', '-'], 'loudnorm measure', 'info');
const js = JSON.parse(m1.slice(m1.lastIndexOf('{'), m1.lastIndexOf('}') + 1));
const normMix = resolve(work, 'mix.wav');
const m2 = ff(['-i', limited, '-af', `loudnorm=${LN}:measured_I=${js.input_i}:measured_TP=${js.input_tp}:measured_LRA=${js.input_lra}:measured_thresh=${js.input_thresh}:offset=${js.target_offset}:linear=true:print_format=json`, '-ar', '48000', '-c:a', 'pcm_f32le', normMix], 'loudnorm apply', 'info');
const js2 = JSON.parse(m2.slice(m2.lastIndexOf('{'), m2.lastIndexOf('}') + 1));
console.log(`  mix measured ${js.input_i} LUFS, ${js.input_tp} dBTP; normalised ${js2.output_i} LUFS, ${js2.output_tp} dBTP (${js2.normalization_type})`);

// ---------------------------------------------------------------------------------- overlays and encode

const vIn = ['-i', body, '-i', normMix];
const vChains = [];
let base = '[0:v]';
let k = 2;
let n = 0;
const fadeOutAt = (total - plan.fadeOut).toFixed(3);
vChains.push(`${base}fade=t=in:st=0:d=${plan.fadeIn},fade=t=out:st=${fadeOutAt}:d=${plan.fadeOut}[b${n}]`);
base = `[b${n++}]`;
for (const [id, a, b] of plan.captions) {
  const d = b - a;
  vIn.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', resolve(cardsDir, `cap-${id}-${cut}.png`));
  vChains.push(`[${k}:v]format=rgba,fade=t=in:st=0:d=0.28:alpha=1,fade=t=out:st=${(d - 0.28).toFixed(3)}:d=0.28:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB[c${k}]`);
  vChains.push(`${base}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[b${n}]`);
  base = `[b${n++}]`;
  k++;
}
for (const f of plan.flashes) {
  // On the frame grid, so a flash on a cut starts on the cut's first frame and not one after it.
  const at = frames(f.at) / FPS;
  vChains.push(`color=c=white:s=${W}x${H}:r=${FPS}:d=${f.d},format=rgba,colorchannelmixer=aa=${f.a},fade=t=out:st=0:d=${f.d}:alpha=1,setpts=PTS-STARTPTS+${at.toFixed(4)}/TB[f${n}]`);
  vChains.push(`${base}[f${n}]overlay=0:0:eof_action=pass:enable='between(t,${(at - 0.001).toFixed(4)},${(at + f.d).toFixed(4)})'[b${n}]`);
  base = `[b${n++}]`;
}
vChains.push(`${base}format=yuv420p[vout]`);
ff(
  [...vIn, '-filter_complex', vChains.join(';'), '-map', '[vout]', '-map', '1:a', '-t', total.toFixed(3),
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', cut === 'port' ? '18' : '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-x264-params', 'keyint=120:min-keyint=60', ...TAGS, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', outFile],
  'final encode',
);
console.log(`  wrote ${outFile} (${total.toFixed(2)} s)`);

// ---------------------------------------------------------------------------------- subtitles

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, '0')}`;
};
// The title cards' own text goes into the subtitles too.
const CARD_TEXT = {
  tagline: { en: 'Six shells. One tide.', zh: '六种甲壳，同一片潮汐' },
  endcard: { en: 'World of Crabcraft. Play in your browser: github.com/kubony/crabcraft', zh: 'World of Crabcraft，在浏览器里直接玩：github.com/kubony/crabcraft' },
};
for (const lang of ['en', 'zh']) {
  const rows = [
    ...plan.captions.map(([id, a, b]) => [a, b, CAPTIONS[id][lang]]),
    ...plan.cards.map(([id, a, b]) => [a, b, CARD_TEXT[id][lang]]),
  ].sort((x, y) => x[0] - y[0]);
  const body = rows.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join('\n');
  const file = outFile.replace(/\.mp4$/, `.${lang}.srt`);
  writeFileSync(file, body);
  console.log(`  wrote ${file}`);
}
writeFileSync(resolve(work, 'plan.json'), JSON.stringify({ ...plan, total }, null, 1));
