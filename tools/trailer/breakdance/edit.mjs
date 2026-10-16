#!/usr/bin/env node
// Cuts the breakdance contest video from the shots (tools/trailer/breakdance/capture.mjs), the
// title cards and captions (tools/trailer/cards.mjs with this folder's captions.json) and an
// original beat (beat.py, at the toprock's 107.14 bpm). The picture is cut on that beat grid: the
// live 720 in slow motion as the hook, landing on the drop; the live routine in Robot Mode (P) as
// the centrepiece, a bar of each move, each move on the downbeat the routine itself started it on;
// the routine in the game close up, each move placed by the clock its shot recorded; the 720 and
// the back flip slowed down in the game; the ending's finale; the end card. The same timeline
// serves both cuts; the portrait one uses the portrait takes. Rendering (sound, captions, encode,
// SRT) is cut.mjs.
//
// Usage: node tools/trailer/breakdance/edit.mjs --shots <dir> --cards <dir> --work <dir> --out <file.mp4> [--cut land|port]
// Needs ffmpeg and uv (for beat.py's numpy and scipy).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAR_S, ROUTINE } from '../../../src/robot/sim/routine.ts';
import { B, BAR, CARD_TEXT, render, shotTools, T } from './cut.mjs';

const here = dirname(fileURLToPath(import.meta.url));
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

/** A shot's name in this cut (the portrait takes carry -port). */
const S = (name) => (name.startsWith('card-') ? `${name}-${cut}` : port ? `${name}-port` : name);
const { atMove, atRoutine, jump } = shotTools(shotsDir, S);
/** The live routine's bar `n` (and `beats` into it), in routine seconds (src/robot/sim/routine.ts). */
const bar = (n, beats = 0) => n * BAR_S + beats * B;
const BAR_OF = Object.fromEntries(ROUTINE.map((m) => [m.mode, m.bar]));

function plan() {
  const segs = [];
  const sfx = [];
  const hits = [];
  /** Play `src` so that its clip time `clipAt` lands on timeline time `at`, the segment filling [t0, t1). */
  const place = (src, clipAt, at, t0, t1, extra = {}) => segs.push({ src, in: clipAt - (at - t0), t0, end: t1, ...extra });

  // 0. The hook: the bare robot's 720, live, at a quarter of real speed; the landing is the drop.
  const hookLand = T(4);
  const hj = jump('jump-live-slow', 'power_jumpspin');
  place('jump-live-slow', hj.land, hookLand, 0, T(5));
  sfx.push(['sfx-servo-whir', hookLand - (hj.land - hj.takeoff) - 0.25, 0.45], ['sfx-footstep-stone', hookLand, 0.8], ['sfx-crit', hookLand + 0.02, 0.35]);
  hits.push({ t: hookLand, kind: 'impact', vel: 1.0 });
  // 1. The logo, on the beat after the landing.
  segs.push({ src: 'card-logo', in: 1.3, t0: T(5), end: T(8) });
  sfx.push(['sfx-beacon', T(5) + 0.02, 0.35]);

  // 2. The live routine (Robot Mode, P), a bar of each move from the one take: the toprock's second
  //    bar (a step on every beat), the six-step's second, the spin at speed (from the second beat of
  //    its first bar to the second of its next, where it is let go), the 720 and the back flip from
  //    the downbeats their policies start on, then the one-claw's two bars, the freeze landing on
  //    the second's downbeat.
  const r0 = T(8);
  const live = [
    { r: bar(BAR_OF.break_toprock + 1), bars: 1 },
    { r: bar(BAR_OF.break_sixstep + 1), bars: 1 },
    { r: bar(BAR_OF.power_spin, 2), bars: 1 },
    { r: bar(BAR_OF.power_jumpspin), bars: 1, jump: 'power_jumpspin' },
    { r: bar(BAR_OF.power_backflip), bars: 1, jump: 'power_backflip' },
    { r: bar(BAR_OF.break_oneclaw), bars: 2 },
  ];
  let lt = r0;
  for (const L of live) {
    const t1 = lt + L.bars * BAR;
    place('live', atRoutine('live', L.r), lt, lt, t1);
    sfx.push(['sfx-servo-whir', lt + 0.02, 0.22]);
    if (L.jump) {
      const j = jump('live', L.jump);
      const land = lt + j.land - atRoutine('live', L.r);
      const off = lt + j.takeoff - atRoutine('live', L.r);
      sfx.push(['sfx-servo-whir', off - 0.15, 0.3], ['sfx-footstep-stone', land, 0.65]);
      hits.push({ t: land, kind: 'impact', vel: L.jump === 'power_jumpspin' ? 0.45 : 0.5 });
    }
    lt = t1;
  }
  // The freeze: the one-claw's hit, 4 beats after its policy starts, the next downbeat.
  const lHit = r0 + 6 * BAR;
  sfx.push(['sfx-footstep-stone', lHit, 0.6], ['sfx-crit', lHit + 0.03, 0.3]);

  // 3. The routine in the game, close, one bar a move: the toprock, the six-step from overhead,
  //    and the 720 with the back flip, the back flip landing on the bar's third beat.
  const g0 = r0 + 7 * BAR;
  place('routine-a', atMove('routine-a', 'toprock', 'beat2'), g0, g0, g0 + BAR, { tag: 'tag-toprock' });
  place('routine-b', atMove('routine-b', 'sixstep', 'steady_from'), g0 + BAR, g0 + BAR, g0 + 2 * BAR, { tag: 'tag-sixstep' });
  const jLand = g0 + 2 * BAR + 3 * B;
  place('routine-b', atMove('routine-b', 'backflip', 'land'), jLand, g0 + 2 * BAR, g0 + 3 * BAR, { tag: 'tag-jumps' });
  const jOff = (move, ev) => jLand - (atMove('routine-b', 'backflip', 'land') - atMove('routine-b', move, ev));
  sfx.push(['sfx-servo-whir', jOff('jumpspin', 'takeoff') - 0.2, 0.4], ['sfx-footstep-stone', jOff('jumpspin', 'land'), 0.7],
    ['sfx-servo-whir', jOff('backflip', 'takeoff') - 0.15, 0.35], ['sfx-footstep-stone', jLand, 0.8]);
  hits.push({ t: jLand, kind: 'impact', vel: 0.55 });

  // 4. The replays: the 720 from below, the back flip from above, each its own bar in slow motion.
  const s0 = g0 + 3 * BAR;
  const jsIn = atMove('jump-slow', 'jumpspin', 'takeoff') - 0.3;
  segs.push({ src: 'jump-slow', in: jsIn, t0: s0, end: s0 + BAR });
  const jsLand = s0 + atMove('jump-slow', 'jumpspin', 'land') - jsIn;
  const fsIn = atMove('flip-slow2', 'backflip', 'takeoff') - 0.4;
  segs.push({ src: 'flip-slow2', in: fsIn, t0: s0 + BAR, end: s0 + 2 * BAR });
  const fsLand = s0 + BAR + atMove('flip-slow2', 'backflip', 'land') - fsIn;
  sfx.push(['sfx-servo-whir', s0 + 0.3, 0.4], ['sfx-footstep-stone', jsLand, 0.8], ['sfx-servo-whir', s0 + BAR + 0.25, 0.4], ['sfx-footstep-stone', fsLand, 0.85]);
  hits.push({ t: jsLand, kind: 'impact', vel: 0.75 }, { t: fsLand, kind: 'impact', vel: 0.85 });

  // 5. The finale: the jumps in the ring (it erupts), the freeze under fireworks.
  const e0 = s0 + 2 * BAR;
  const eLand = e0 + 3 * B;
  place('ending', atMove('ending', 'backflip', 'land'), eLand, e0, e0 + BAR);
  const eHit = e0 + BAR + B;
  place('ending', atMove('ending', 'oneclaw', 'hit'), eHit, e0 + BAR, e0 + 2 * BAR);
  sfx.push(['sfx-footstep-stone', eLand, 0.7], ['sfx-crit', eLand + 0.05, 0.35], ['sfx-footstep-stone', eHit, 0.6], ['sfx-crit', eHit + 0.05, 0.4],
    ['sfx-crit', eHit + 1.3, 0.25], ['sfx-crit', eHit + 1.5, 0.2]);
  hits.push({ t: eLand, kind: 'impact', vel: 0.6 }, { t: eHit, kind: 'impact', vel: 0.6 });

  // 6. The end card, over the beat's last bar and its final stab.
  const c0 = e0 + 2 * BAR;
  const TAIL = 1.5;
  const total = c0 + 2 * BAR + TAIL;
  segs.push({ src: 'card-end', in: 0.4, t0: c0, end: total });

  const captions = [
    ['hook', 0.25, T(4) - 0.1],
    ['live', r0 + 0.2, r0 + 3 * BAR - 0.2],
    ['ours', r0 + 3 * BAR + 0.15, r0 + 7 * BAR - 0.2],
    ['press', g0 + 0.2, g0 + 3 * BAR - 0.2],
    ['replay', s0 + 0.2, s0 + 2 * BAR - 0.2],
    ['finale', e0 + 0.2, e0 + 2 * BAR - 0.25],
  ];
  // The move names, one per bar of the game's routine.
  const tags = segs.filter((s) => s.tag).map((s) => [s.tag, s.t0 + 0.12, s.end - 0.12]);
  const flashes = [
    { at: T(5), d: 0.3, a: 0.85 },
    { at: g0, d: 0.16, a: 0.4 },
    { at: s0, d: 0.2, a: 0.5 },
    { at: e0, d: 0.25, a: 0.6 },
    { at: c0, d: 0.3, a: 0.6 },
  ];
  // The live bars take the styles the routine's own music gives their moves
  // (tools/robot-routine-music.mjs): the toprock's groove, the six-step's busier one, everything
  // under the spin, a drop on each jump, and a drop on the freeze.
  const music = {
    sections: [
      { style: 'hook', bars: 1 },
      { style: 'drop', bars: 1 },
      { style: 'grooveA', bars: 1 },
      { style: 'grooveB', bars: 1 },
      { style: 'finale', bars: 1 },
      { style: 'drop', bars: 1 },
      { style: 'drop', bars: 1 },
      { style: 'grooveA', bars: 1 },
      { style: 'drop', bars: 1 },
      { style: 'grooveB', bars: 3 },
      { style: 'half', bars: 2 },
      { style: 'finale', bars: 2 },
      { style: 'outro', bars: 2 },
    ],
    hits,
    tail: TAIL,
  };
  const cards = [['endcard', c0 + 0.9, total - 0.1]];
  return { segs, captions, tags, flashes, music, sfx, cards, total };
}

const P = plan();
render(P, { cut, S, shotsDir, cardsDir, work, outFile, captions: resolve(here, 'captions.json'), cardText: CARD_TEXT });
