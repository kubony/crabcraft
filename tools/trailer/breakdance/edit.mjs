#!/usr/bin/env node
// Cuts the breakdance video from the shots (tools/trailer/breakdance/capture.mjs), the title cards
// and captions (tools/trailer/cards.mjs with this folder's captions.json) and an original beat
// (beat.py, at the toprock's 107.14 bpm): the picture is cut on that beat grid, each move placed by
// the routine clock its shot recorded (a toprock step on a beat, a landing on a beat), burned-in
// English and Chinese captions and move names, the beat with impacts on the landings and the game's
// own sound effects, two-pass loudness normalisation to -14 LUFS, H.264 high + AAC, and English and
// Chinese SRT files. The same timeline serves both cuts; the portrait one uses the portrait takes.
//
// Usage: node tools/trailer/breakdance/edit.mjs --shots <dir> --cards <dir> --work <dir> --out <file.mp4> [--cut land|port]
// Needs ffmpeg and uv (for beat.py's numpy and scipy).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVE } from './routine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const AUDIO = resolve(repo, 'public', 'audio');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const shotsDir = resolve(opt('--shots', 'breakdance-out'));
const cardsDir = resolve(opt('--cards', 'breakdance-out'));
const cut = opt('--cut', 'land');
const port = cut === 'port';
const work = resolve(opt('--work', 'breakdance-work'), cut);
const outFile = resolve(opt('--out', `crabcraft-breakdance-${cut}.mp4`));
mkdirSync(work, { recursive: true });
mkdirSync(dirname(outFile), { recursive: true });

const FPS = 60;
const [W, H] = port ? [1080, 1920] : [1920, 1080];
const CAPTIONS = Object.fromEntries(JSON.parse(readFileSync(resolve(here, 'captions.json'), 'utf8')).map((c) => [c.id, c]));

function ff(argv, label, level = 'error') {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-v', level, '-y', ...argv], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(r.stderr.toString());
    throw new Error(`ffmpeg failed: ${label}`);
  }
  return r.stderr.toString();
}

// ---------------------------------------------------------------------------------- the shots

/** A shot's name in this cut (the portrait takes carry -port). */
const S = (name) => (name.startsWith('card-') ? `${name}-${cut}` : port ? `${name}-port` : name);
const meta = {};
const shot = (name) => (meta[name] ??= JSON.parse(readFileSync(resolve(shotsDir, `${S(name)}.json`), 'utf8')));

/**
 * Clip time (s) of a move's event in a game shot: where the move's own clock (the probe's `st`,
 * BreakRoutine's step time) reaches the event's offset into the move (routine.mjs, from
 * src/motion/breakClips.ts), interpolated between frames. The routine starts a move on the frame
 * its predecessor's window runs out, so a move's start on the routine clock drifts from the ideal
 * by up to a frame per move; its own clock does not.
 */
function atMove(name, move, event) {
  const m = MOVE[move];
  const want = m.ev[event];
  const p = shot(name).probe;
  const first = p.findIndex((x) => x.step === m.index && x.active !== false);
  // An event before the move's first recorded frame (its start, say): one frame's step back.
  if (first >= 0 && first + 1 < p.length && want <= p[first].st && p[first + 1].step === m.index) {
    return (first - (p[first].st - want) / (p[first + 1].st - p[first].st)) / FPS;
  }
  for (let i = 1; i < p.length; i++) {
    if (p[i].step !== m.index || p[i - 1].step !== m.index || p[i].active === false) continue;
    const a = p[i - 1].st;
    const b = p[i].st;
    if (a <= want && b >= want && b > a) return (i - 1 + (want - a) / (b - a)) / FPS;
  }
  throw new Error(`${S(name)}: ${m.id} never reaches ${event} (${want.toFixed(3)} s in)`);
}

/** Clip time (s) of the first frame the robot runs `mode`'s policy. */
function runStart(name, mode) {
  const p = shot(name).probe;
  const i = p.findIndex((x) => x.mode === mode && x.run);
  if (i < 0) throw new Error(`${S(name)}: ${mode} never ran`);
  return i / FPS;
}

// ---------------------------------------------------------------------------------- the cut

/** The toprock's step, 0.56 s (src/motion/breakClips.ts break_toprock beat1 to beat8): 107.14 bpm. */
const B = 0.56;
const T = (n) => n * B;
const BAR = 4 * B;

/**
 * In Robot Mode, seconds from the frame a policy starts running (runStart) to its toprock's first
 * step, its one-claw's freeze and each jump's take-off and landing: the recorded clips' events
 * less their policy start (the clips are recorded through the same bundle).
 */
const ROBOT = {
  toprockBeat1: MOVE.toprock.ev.beat1 - MOVE.toprock.ev.policy_start,
  clawHit: MOVE.oneclaw.ev.hit - MOVE.oneclaw.ev.policy_start,
  jumpspinOff: MOVE.jumpspin.ev.takeoff - MOVE.jumpspin.ev.policy_start,
  jumpspinLand: MOVE.jumpspin.ev.land - MOVE.jumpspin.ev.policy_start,
  backflipOff: MOVE.backflip.ev.takeoff - MOVE.backflip.ev.policy_start,
  backflipLand: MOVE.backflip.ev.land - MOVE.backflip.ev.policy_start,
};

function plan() {
  const segs = [];
  const sfx = [];
  const hits = [];
  /** Play `src` so that its clip time `clipAt` lands on timeline time `at`, the segment filling [t0, t1). */
  const place = (src, clipAt, at, t0, t1, extra = {}) => segs.push({ src, in: clipAt - (at - t0), t0, end: t1, ...extra });

  // 0. The hook: the back flip at a seventh of real speed from its side; the landing is the drop.
  const hookLand = T(4);
  place('flip-slow', atMove('flip-slow', 'backflip', 'land'), hookLand, 0, T(5));
  const hookTake = atMove('flip-slow', 'backflip', 'takeoff') - (atMove('flip-slow', 'backflip', 'land') - hookLand);
  sfx.push(['sfx-servo-whir', hookTake - 0.25, 0.45], ['sfx-footstep-stone', hookLand, 0.8], ['sfx-crit', hookLand + 0.02, 0.35]);
  hits.push({ t: hookLand, kind: 'impact', vel: 1.0 });
  // 1. The logo, on the beat after the landing.
  segs.push({ src: 'card-logo', in: 1.3, t0: T(5), end: T(8) });
  sfx.push(['sfx-beacon', T(5) + 0.02, 0.35]);

  // 2. Robot Mode, one bar a move: toprock (a step on every beat), six-step, the one-claw freeze, the
  //    spin; then the 720 and the back flip share a bar, live, the 720 landing on its second beat and
  //    the back flip on its fourth.
  const r0 = T(8);
  place('robot', runStart('robot', 'break_toprock') + ROBOT.toprockBeat1 + B, r0, r0, r0 + BAR);
  place('robot', runStart('robot', 'break_sixstep') + 0.9, r0 + BAR, r0 + BAR, r0 + 2 * BAR);
  place('robot', runStart('robot', 'break_oneclaw') + ROBOT.clawHit, r0 + 2 * BAR + 2 * B, r0 + 2 * BAR, r0 + 3 * BAR);
  place('robot', runStart('robot', 'power_spin') + 1.0, r0 + 3 * BAR, r0 + 3 * BAR, r0 + 4 * BAR);
  for (let k = 0; k < 4; k++) sfx.push(['sfx-servo-whir', r0 + k * BAR + 0.02, 0.22]);
  const rj = r0 + 4 * BAR;
  const rjLand = rj + B;
  const rfLand = rj + 3 * B;
  place('robot', runStart('robot', 'power_jumpspin') + ROBOT.jumpspinLand, rjLand, rj, rj + 2 * B);
  place('robot', runStart('robot', 'power_backflip') + ROBOT.backflipLand, rfLand, rj + 2 * B, rj + BAR);
  sfx.push(['sfx-servo-whir', rjLand - (ROBOT.jumpspinLand - ROBOT.jumpspinOff) - 0.15, 0.3], ['sfx-footstep-stone', rjLand, 0.6],
    ['sfx-servo-whir', rfLand - (ROBOT.backflipLand - ROBOT.backflipOff) - 0.12, 0.3], ['sfx-footstep-stone', rfLand, 0.7]);
  hits.push({ t: rjLand, kind: 'impact', vel: 0.4 }, { t: rfLand, kind: 'impact', vel: 0.5 });

  // 3. The routine in the game, one bar a move, alternating the two takes; the 720 and the back
  //    flip share a bar, the back flip landing on its third beat.
  const g0 = r0 + 5 * BAR;
  place('routine-a', atMove('routine-a', 'toprock', 'beat2'), g0, g0, g0 + BAR, { tag: 'tag-toprock' });
  // The six-step from overhead once its turn is steady, the spin from 0.8 s into it.
  place('routine-b', atMove('routine-b', 'sixstep', 'steady_from'), g0 + BAR, g0 + BAR, g0 + 2 * BAR, { tag: 'tag-sixstep' });
  place('routine-a', atMove('routine-a', 'spin', 'spin_from') + 0.8, g0 + 2 * BAR, g0 + 2 * BAR, g0 + 3 * BAR, { tag: 'tag-spin' });
  const jLand = g0 + 3 * BAR + 3 * B;
  place('routine-b', atMove('routine-b', 'backflip', 'land'), jLand, g0 + 3 * BAR, g0 + 4 * BAR, { tag: 'tag-jumps' });
  const jOff = (move, ev) => jLand - (atMove('routine-b', 'backflip', 'land') - atMove('routine-b', move, ev));
  sfx.push(['sfx-servo-whir', jOff('jumpspin', 'takeoff') - 0.2, 0.4], ['sfx-footstep-stone', jOff('jumpspin', 'land'), 0.7],
    ['sfx-servo-whir', jOff('backflip', 'takeoff') - 0.15, 0.35], ['sfx-footstep-stone', jLand, 0.8]);
  hits.push({ t: jLand, kind: 'impact', vel: 0.55 });
  const fHit = g0 + 4 * BAR + B;
  place('routine-a', atMove('routine-a', 'oneclaw', 'hit'), fHit, g0 + 4 * BAR, g0 + 5 * BAR, { tag: 'tag-freeze' });
  sfx.push(['sfx-footstep-stone', fHit, 0.7], ['sfx-crit', fHit + 0.03, 0.3]);

  // 4. The replays: the 720 from below, the back flip from above, each its own bar in slow motion.
  const s0 = g0 + 5 * BAR;
  const jsIn = atMove('jump-slow', 'jumpspin', 'takeoff') - 0.3;
  segs.push({ src: 'jump-slow', in: jsIn, t0: s0, end: s0 + BAR });
  const jsLand = s0 + atMove('jump-slow', 'jumpspin', 'land') - jsIn;
  const fsIn = atMove('flip-slow2', 'backflip', 'takeoff') - 0.4;
  segs.push({ src: 'flip-slow2', in: fsIn, t0: s0 + BAR, end: s0 + 2 * BAR });
  const fsLand = s0 + BAR + atMove('flip-slow2', 'backflip', 'land') - fsIn;
  sfx.push(['sfx-servo-whir', s0 + 0.3, 0.4], ['sfx-footstep-stone', jsLand, 0.8], ['sfx-servo-whir', s0 + BAR + 0.25, 0.4], ['sfx-footstep-stone', fsLand, 0.85]);
  hits.push({ t: jsLand, kind: 'impact', vel: 0.75 }, { t: fsLand, kind: 'impact', vel: 0.85 });

  // 5. The finale: the toprock in the ring, the jumps (the ring erupts), the freeze under fireworks.
  const e0 = s0 + 2 * BAR;
  place('ending', atMove('ending', 'toprock', 'beat2'), e0, e0, e0 + BAR);
  const eLand = e0 + BAR + 3 * B;
  place('ending', atMove('ending', 'backflip', 'land'), eLand, e0 + BAR, e0 + 2 * BAR);
  const eHit = e0 + 2 * BAR + B;
  place('ending', atMove('ending', 'oneclaw', 'hit'), eHit, e0 + 2 * BAR, e0 + 3 * BAR);
  sfx.push(['sfx-footstep-stone', eLand, 0.7], ['sfx-crit', eLand + 0.05, 0.35], ['sfx-footstep-stone', eHit, 0.6], ['sfx-crit', eHit + 0.05, 0.4],
    ['sfx-crit', eHit + 1.3, 0.25], ['sfx-crit', eHit + 1.5, 0.2]);
  hits.push({ t: eLand, kind: 'impact', vel: 0.6 }, { t: eHit, kind: 'impact', vel: 0.6 });

  // 6. The end card, over the beat's last bar and its final stab.
  const c0 = e0 + 3 * BAR;
  const TAIL = 1.5;
  const total = c0 + 2 * BAR + TAIL;
  segs.push({ src: 'card-end', in: 0.4, t0: c0, end: total });

  const captions = [
    ['hook', 0.25, T(4) - 0.1],
    ['robot', r0 + 0.2, r0 + 2 * BAR - 0.2],
    ['ours', r0 + 2 * BAR + 0.15, r0 + 5 * BAR - 0.2],
    ['press', g0 + 0.2, g0 + 2 * BAR - 0.2],
    ['replay', s0 + 0.2, s0 + 2 * BAR - 0.2],
    ['finale', e0 + 0.2, e0 + 3 * BAR - 0.25],
  ];
  // The move names, one per bar of the routine.
  const tags = segs.filter((s) => s.tag).map((s) => [s.tag, s.t0 + 0.12, s.end - 0.12]);
  const flashes = [
    { at: T(5), d: 0.3, a: 0.85 },
    { at: g0, d: 0.16, a: 0.4 },
    { at: s0, d: 0.2, a: 0.5 },
    { at: e0, d: 0.25, a: 0.6 },
    { at: c0, d: 0.3, a: 0.6 },
  ];
  const music = {
    sections: [
      { style: 'hook', bars: 1 },
      { style: 'drop', bars: 1 },
      { style: 'grooveA', bars: 5 },
      { style: 'grooveB', bars: 5 },
      { style: 'half', bars: 2 },
      { style: 'finale', bars: 3 },
      { style: 'outro', bars: 2 },
    ],
    hits,
    tail: TAIL,
  };
  const cards = [['endcard', c0 + 0.9, total - 0.1]];
  return { segs, captions, tags, flashes, music, sfx, cards, total };
}

const P = plan();

// ---------------------------------------------------------------------------------- picture

const srcFile = (name) => (name.startsWith('card-') ? resolve(cardsDir, `${S(name)}.mp4`) : resolve(shotsDir, `${S(name)}.mp4`));
const frames = (s) => Math.round(s * FPS);
// The captures are Chrome JPEG screenshots: full-range BT.601 YCbCr. Deliver limited-range BT.709.
const SCALE = `scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`;
const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const list = [];
let t = 0;
P.segs.forEach((s, i) => {
  const start = frames(t);
  const stop = frames(s.end);
  const n = stop - start;
  if (n <= 0) throw new Error(`segment ${i} (${s.src}) has no length`);
  const f0 = Math.round(s.in * FPS);
  if (f0 < 0) throw new Error(`segment ${i} (${s.src}) starts before its clip: in ${s.in.toFixed(3)}`);
  const srcFrames = s.src.startsWith('card-') ? Infinity : shot(s.src).frames;
  if (f0 + n > srcFrames) throw new Error(`segment ${i} (${s.src}) runs past its clip: ${f0}+${n} > ${srcFrames}`);
  const file = resolve(work, `seg-${String(i).padStart(2, '0')}.mp4`);
  // Re-render a segment only when its source or range changed.
  const key = JSON.stringify([srcFile(s.src), statSync(srcFile(s.src)).mtimeMs, f0, n, SCALE]);
  const keyFile = `${file}.key`;
  if (!existsSync(file) || !existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) {
    ff(
      ['-i', srcFile(s.src), '-vf', `trim=start_frame=${f0}:end_frame=${f0 + n},setpts=PTS-STARTPTS,${SCALE},fps=${FPS},format=yuv420p`,
        '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'fast', '-crf', '9', '-g', '60', ...TAGS, '-an', file],
      `segment ${i}`,
    );
    writeFileSync(keyFile, key);
  }
  list.push(`file '${file}'`);
  console.log(`  seg ${String(i).padStart(2)} ${S(s.src).padEnd(18)} in ${s.in.toFixed(3).padStart(7)}  ${t.toFixed(3)} -> ${s.end.toFixed(3)} (${n} frames)`);
  t = stop / FPS;
});
writeFileSync(resolve(work, 'list.txt'), `${list.join('\n')}\n`);
const body = resolve(work, 'body.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', resolve(work, 'list.txt'), '-c', 'copy', body], 'concat');
const total = t;

// ---------------------------------------------------------------------------------- sound

// The beat, arranged on the cut (sections in bars, impacts on the landings).
const arrFile = resolve(work, 'beat.json');
const beatWav = resolve(work, 'beat.wav');
writeFileSync(arrFile, JSON.stringify(P.music, null, 1));
const r = spawnSync('uv', ['run', '-q', '--with', 'numpy', '--with', 'scipy', 'python', resolve(here, 'beat.py'), arrFile, beatWav], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('beat.py failed');

const audioIn = ['-i', beatWav];
const aChains = [`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0`];
for (const [name, at, gain] of P.sfx) {
  if (at < 0 || at > total) continue;
  audioIn.push('-i', resolve(AUDIO, `${name}.ogg`));
  const k = audioIn.length / 2 - 1;
  aChains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${gain},adelay=${Math.round(at * 1000)}:all=1`);
}
const labels = aChains.map((_, i) => `[a${i}]`);
const aGraph = `${aChains.map((c, i) => `${c}${labels[i]}`).join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=duration=${total.toFixed(4)},afade=t=out:st=${(total - 0.25).toFixed(3)}:d=0.25[mix]`;
const rawMix = resolve(work, 'mix-raw.wav');
ff([...audioIn, '-filter_complex', aGraph, '-map', '[mix]', '-c:a', 'pcm_f32le', '-ar', '48000', rawMix], 'audio mix');
// A limiter for the transients, then two-pass EBU R128 normalisation to -14 LUFS (linear gain),
// true peak under -2 dBTP so the AAC encode stays under -1.
const LN = 'I=-14:TP=-2:LRA=11';
const limited = resolve(work, 'mix-limited.wav');
ff(['-i', rawMix, '-af', 'alimiter=limit=0.5:attack=3:release=80:level=false,aresample=192000,alimiter=limit=0.5:attack=1:release=50:level=false,aresample=48000', '-c:a', 'pcm_f32le', limited], 'limiter');
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
for (const [id, a, b] of [...P.captions, ...P.tags]) {
  const d = b - a;
  const fd = id.startsWith('tag-') ? 0.12 : 0.24;
  vIn.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', resolve(cardsDir, `cap-${id}-${cut}.png`));
  vChains.push(`[${k}:v]format=rgba,fade=t=in:st=0:d=${fd}:alpha=1,fade=t=out:st=${(d - fd).toFixed(3)}:d=${fd}:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB[c${k}]`);
  vChains.push(`${base}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[b${n}]`);
  base = `[b${n++}]`;
  k++;
}
for (const f of P.flashes) {
  // On the frame grid, so a flash on a cut starts on the cut's first frame.
  const at = frames(f.at) / FPS;
  vChains.push(`color=c=white:s=${W}x${H}:r=${FPS}:d=${f.d},format=rgba,colorchannelmixer=aa=${f.a},fade=t=out:st=0:d=${f.d}:alpha=1,setpts=PTS-STARTPTS+${at.toFixed(4)}/TB[f${n}]`);
  vChains.push(`${base}[f${n}]overlay=0:0:eof_action=pass:enable='between(t,${(at - 0.001).toFixed(4)},${(at + f.d).toFixed(4)})'[b${n}]`);
  base = `[b${n++}]`;
}
vChains.push(`${base}format=yuv420p[vout]`);
ff(
  [...vIn, '-filter_complex', vChains.join(';'), '-map', '[vout]', '-map', '1:a', '-t', total.toFixed(3),
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', port ? '18' : '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
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
// The end card's own text goes into the subtitles too.
const CARD_TEXT = {
  endcard: {
    en: 'World of Crabcraft. Play in your browser: github.com/kubony/crabcraft\n#Jumper #CrabRobot #OpenSourceRobot @KingKong Robotics. Trained in simulation; not yet run on a physical Jumper.',
    zh: 'World of Crabcraft，在浏览器里直接玩：github.com/kubony/crabcraft\n#Jumper #CrabRobot #OpenSourceRobot @KingKong Robotics。仿真训练结果，尚未在实体 Jumper 上运行。',
  },
};
for (const lang of ['en', 'zh']) {
  const rows = [
    ...P.captions.map(([id, a, b]) => [a, b, CAPTIONS[id][lang]]),
    ...P.cards.map(([id, a, b]) => [a, b, CARD_TEXT[id][lang]]),
  ].sort((x, y) => x[0] - y[0]);
  const srt = rows.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join('\n');
  const file = outFile.replace(/\.mp4$/, `.${lang}.srt`);
  writeFileSync(file, srt);
  console.log(`  wrote ${file}`);
}
writeFileSync(resolve(work, 'plan.json'), JSON.stringify({ ...P, total }, null, 1));
