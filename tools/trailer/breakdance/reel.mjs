#!/usr/bin/env node
// Cuts the showcase reel of every dance and move (landscape, 1920x1080): the logo; Jumper's four
// dances, live in Robot Mode; the seven breaking moves, live, the 720 and the back flip again in
// slow motion (the simulation stepped slower, not frames stretched); the whole live routine (P)
// under its own music (public/audio/music-breaking.ogg, from the routine's bar 1 on the frame the
// routine reached it); the crab breaking in the game (B) and at the ending; the end card. Each
// move has a lower third with its name and what it is, in English and Chinese
// (reel-captions.json). Everything else is on the original beat (beat.py), cut on its bars.
// Rendering (sound, captions, encode, SRT) is cut.mjs.
//
// Usage: node tools/trailer/breakdance/reel.mjs --shots <dir> --cards <dir> --work <dir> --out <file.mp4>
// The shots are capture.mjs's (dance-*, moves, jump-live-slow, flip-live-slow, live, routine-a,
// ending), the cards cards.mjs's with reel-captions.json. make.mjs --reel does it all in one command.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAK_CLIPS } from '../../../src/motion/breakClips.ts';
import { BAR_S } from '../../../src/robot/sim/routine.ts';
import { AUDIO, B, BAR, CARD_TEXT, FPS, render, shotTools } from './cut.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const shotsDir = resolve(opt('--shots', 'breakdance-out'));
const cardsDir = resolve(opt('--cards', 'breakdance-out'));
const work = resolve(opt('--work', 'reel-work'));
const outFile = resolve(opt('--out', 'crabcraft-moves-showcase-1080p.mp4'));

const S = (name) => (name.startsWith('card-') ? `${name}-land` : name);
const { atMove, atRoutine, jump, runStart, shot } = shotTools(shotsDir, S);
/** Seconds from a breaking clip's policy start to one of its events (src/motion/breakClips.ts). */
const rel = (clip, event) => BREAK_CLIPS[clip].events[event] - BREAK_CLIPS[clip].events.policy_start;
const DANCES = ['dance_crab', 'dance_brazilian', 'dance_maze', 'dance_dream_wings'];

/**
 * A slow-motion take's landing put on a beat of [t0, t1): the earliest beat for which the take has
 * the frames both before (from its start) and after (to its end), so as much of the landing and
 * the robot coming to rest is seen as the take holds.
 */
function landOnBeat(name, land, t0, t1) {
  const len = shot(name).frames / FPS - 1 / FPS;
  for (let k = 1; k * B < t1 - t0; k++) {
    const at = t0 + k * B;
    if (land - (at - t0) >= 0 && land + (t1 - at) <= len) return at;
  }
  throw new Error(`${name}: no beat of [${t0.toFixed(2)}, ${t1.toFixed(2)}) fits its landing at ${land.toFixed(3)} s of ${len.toFixed(3)} s`);
}

function plan() {
  const segs = [];
  const sfx = [];
  const hits = [];
  const lowers = [];
  const flashes = [];
  const sections = [];
  const tracks = [];
  const place = (src, clipAt, at, t0, t1) => segs.push({ src, in: clipAt - (at - t0), t0, end: t1 });
  const music = (style, bars) => sections.push({ style, bars });
  const lower = (id, t0, t1) => lowers.push([id, t0 + 0.25, t1 - 0.25]);
  let t = 0;

  // 0. The logo, two bars: the count-in and the drop.
  segs.push({ src: 'card-logo', in: 0.3, t0: 0, end: 2 * BAR });
  sfx.push(['sfx-beacon', BAR + 0.02, 0.35]);
  music('hook', 1);
  music('drop', 1);
  t = 2 * BAR;

  // 1. Jumper's four dances, two bars each, from the liveliest stretch of each (capture.mjs DANCES).
  flashes.push({ at: t, d: 0.25, a: 0.6 });
  for (const id of DANCES) {
    segs.push({ src: id.replaceAll('_', '-'), in: 0.5, t0: t, end: t + 2 * BAR });
    lower(`low-${id}`, t, t + 2 * BAR);
    t += 2 * BAR;
  }
  music('grooveA', 4);
  music('grooveB', 4);

  // 2. The seven breaking moves, live, from the one take (capture.mjs MOVES_AT), two bars each:
  //    the toprock stepping on the beat, the six-step once its turn is steady, the claw stand and
  //    the one-claw from their first bounce on the downbeat, the spin at speed, then each jump a
  //    bar live (landing on the third beat) and two bars slowed down.
  flashes.push({ at: t, d: 0.2, a: 0.5 });
  const ps = (mode) => runStart('moves', mode);
  const two = (mode, clipAt, style) => {
    place('moves', clipAt, t, t, t + 2 * BAR);
    lower(`low-${mode}`, t, t + 2 * BAR);
    sfx.push(['sfx-servo-whir', t + 0.02, 0.22]);
    music(style, 2);
    t += 2 * BAR;
  };
  two('break_toprock', ps('break_toprock') + rel('break_toprock', 'beat1') + B, 'grooveA');
  two('break_sixstep', ps('break_sixstep') + rel('break_sixstep', 'steady_from'), 'grooveB');
  for (const m of ['break_clawstand', 'break_oneclaw']) {
    const in0 = ps(m) + rel(m, 'bounce1');
    sfx.push(['sfx-footstep-stone', t + rel(m, 'hit') - rel(m, 'bounce1'), 0.55], ['sfx-crit', t + rel(m, 'hit') - rel(m, 'bounce1') + 0.03, 0.25]);
    two(m, in0, m === 'break_clawstand' ? 'grooveA' : 'grooveB');
  }
  // The spin from 0.4 s into its policy: up to speed within the first bar, let go late in the second.
  two('power_spin', ps('power_spin') + 0.4, 'finale');
  for (const [mode, slowShot, low] of [['power_jumpspin', 'jump-live-slow', 'low-jump-slow'], ['power_backflip', 'flip-live-slow', 'low-flip-slow']]) {
    const j = jump('moves', mode);
    const land = t + 2 * B;
    place('moves', j.land, land, t, t + BAR);
    lower(`low-${mode}`, t, t + BAR);
    sfx.push(['sfx-servo-whir', land - (j.land - j.takeoff) - 0.15, 0.3], ['sfx-footstep-stone', land, 0.65]);
    hits.push({ t: land, kind: 'impact', vel: 0.5 });
    music('drop', 1);
    t += BAR;
    const s = jump(slowShot, mode);
    const sLand = landOnBeat(slowShot, s.land, t, t + 2 * BAR);
    place(slowShot, s.land, sLand, t, t + 2 * BAR);
    lower(low, t, t + 2 * BAR);
    sfx.push(['sfx-servo-whir', sLand - (s.land - s.takeoff) - 0.3, 0.4], ['sfx-footstep-stone', sLand, 0.85]);
    hits.push({ t: sLand, kind: 'impact', vel: 0.8 });
    music('half', 2);
    t += 2 * BAR;
  }

  // 3. The whole routine, live, from its bar 1 (the toprock's downbeat) to its bar 18 (the robot
  //    walking again after the freeze), under its own music from the same bar.
  flashes.push({ at: t, d: 0.25, a: 0.55 });
  const R0 = 1;
  const R1 = 18;
  place('live', atRoutine('live', R0 * BAR_S), t, t, t + (R1 - R0) * BAR);
  tracks.push({ file: resolve(AUDIO, 'music-breaking.ogg'), from: R0 * BAR_S, to: R1 * BAR_S, at: t, fadeOut: 0.35 });
  lower('low-routine', t, t + 2 * BAR);
  music('rest', R1 - R0);
  t += (R1 - R0) * BAR;

  // 4. The game: B, the spin and the jumps (the back flip landing on the third beat) by the crab.
  flashes.push({ at: t, d: 0.16, a: 0.4 });
  place('routine-a', atMove('routine-a', 'spin', 'spin_from') + 0.8, t, t, t + BAR);
  const gLand = t + BAR + 3 * B;
  place('routine-a', atMove('routine-a', 'backflip', 'land'), gLand, t + BAR, t + 2 * BAR);
  const gOff = (move, ev) => gLand - (atMove('routine-a', 'backflip', 'land') - atMove('routine-a', move, ev));
  sfx.push(['sfx-servo-whir', t + 0.05, 0.35], ['sfx-footstep-stone', gOff('jumpspin', 'land'), 0.7], ['sfx-footstep-stone', gLand, 0.8]);
  hits.push({ t: gLand, kind: 'impact', vel: 0.55 });
  lower('low-game', t, t + 2 * BAR);
  music('drop', 1);
  music('grooveB', 1);
  t += 2 * BAR;

  // 5. The ending: the jumps in the ring, the freeze under fireworks.
  flashes.push({ at: t, d: 0.25, a: 0.6 });
  const eLand = t + 3 * B;
  place('ending', atMove('ending', 'backflip', 'land'), eLand, t, t + BAR);
  const eHit = t + BAR + B;
  place('ending', atMove('ending', 'oneclaw', 'hit'), eHit, t + BAR, t + 2 * BAR);
  sfx.push(['sfx-footstep-stone', eLand, 0.7], ['sfx-crit', eLand + 0.05, 0.35], ['sfx-footstep-stone', eHit, 0.6], ['sfx-crit', eHit + 0.05, 0.4], ['sfx-crit', eHit + 1.3, 0.25]);
  hits.push({ t: eLand, kind: 'impact', vel: 0.6 }, { t: eHit, kind: 'impact', vel: 0.6 });
  lower('low-ending', t, t + 2 * BAR);
  music('finale', 2);
  t += 2 * BAR;

  // 6. The end card, over the last bar and the final stab.
  flashes.push({ at: t, d: 0.3, a: 0.6 });
  const TAIL = 1.5;
  const total = t + 2 * BAR + TAIL;
  segs.push({ src: 'card-end', in: 0.4, t0: t, end: total });
  music('outro', 2);
  const cards = [['endcard', t + 0.9, total - 0.1]];
  return { segs, captions: [], lowers, flashes, music: { sections, hits, tail: TAIL }, tracks, sfx, cards, total };
}

const P = plan();
render(P, { cut: 'land', S, shotsDir, cardsDir, work, outFile, captions: resolve(here, 'reel-captions.json'), cardText: CARD_TEXT });
