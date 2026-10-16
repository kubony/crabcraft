#!/usr/bin/env node
// Cuts the making-of from plan.mjs: the plates (plates.mjs) and the title cards in the scenes'
// order, each scene its number of bars of the beat; then the payoff from the game's own shots
// (../breakdance/capture.mjs): the live routine in Robot Mode, a bar each of the toprock, the 720
// and the back flip from the downbeats their policies start on, and the ending's jumps and freeze,
// placed on the probes those shots recorded as ../breakdance/edit.mjs places them. Each scene's
// chapter title, captions, music styles, sound effects and hits go on the same timeline; the
// rendering (beat.py, loudness, burned-in captions, encode, SRT) is ../breakdance/cut.mjs render().
//
// Usage: node tools/trailer/making-of/edit.mjs --shots <dir> --cards <dir> --work <dir> --out <file.mp4> [--cut land|port]
// --shots holds the plates and the game's shots (live, ending and their -port takes) side by side.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAR_S, ROUTINE } from '../../../src/robot/sim/routine.ts';
import { B, BAR, CARD_TEXT, render, shotTools } from '../breakdance/cut.mjs';
import { SCENES } from './plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const shotsDir = resolve(opt('--shots', 'making-of-plates'));
const cardsDir = resolve(opt('--cards', 'making-of-cards'));
const cut = opt('--cut', 'land');
const port = cut === 'port';
const work = resolve(opt('--work', 'making-of-work'), cut);
const outFile = resolve(opt('--out', `crabcraft-making-of-${cut}.mp4`));

const PLATE = new Set(SCENES.flatMap((s) => (s.plates ?? []).map((p) => p.id)));
/** A source's file name in this cut: cards and plates carry the layout, the game's portrait takes -port. */
const S = (name) => (name.startsWith('card-') || PLATE.has(name) ? `${name}-${cut}` : port ? `${name}-port` : name);
const { atMove, atRoutine, jump } = shotTools(shotsDir, S);
/** The live routine's bar `n` (and `beats` into it), in routine seconds (src/robot/sim/routine.ts). */
const bar = (n, beats = 0) => n * BAR_S + beats * B;
const BAR_OF = Object.fromEntries(ROUTINE.map((m) => [m.mode, m.bar]));
/** The end card's last stab rings out this long past the last bar. */
const TAIL = 1.5;

function plan() {
  const segs = [];
  const sfx = [];
  const hits = [];
  const captions = [];
  const lowers = [];
  const flashes = [];
  const sections = [];
  const cards = [];
  /** Play `src` so that its clip time `clipAt` lands on timeline time `at`, the segment filling [t0, t1). */
  const place = (src, clipAt, at, t0, t1) => segs.push({ src, in: clipAt - (at - t0), t0, end: t1 });

  /** The payoff in Robot Mode: a bar each of the live routine's toprock, 720 and back flip. */
  function live(t0) {
    let lt = t0;
    for (const L of [
      { r: bar(BAR_OF.break_toprock + 1) },
      { r: bar(BAR_OF.power_jumpspin), jump: 'power_jumpspin' },
      { r: bar(BAR_OF.power_backflip), jump: 'power_backflip' },
    ]) {
      const at = atRoutine('live', L.r);
      place('live', at, lt, lt, lt + BAR);
      sfx.push(['sfx-servo-whir', lt + 0.02, 0.22]);
      if (L.jump) {
        const j = jump('live', L.jump);
        sfx.push(['sfx-servo-whir', lt + j.takeoff - at - 0.15, 0.3], ['sfx-footstep-stone', lt + j.land - at, 0.65]);
        hits.push({ t: lt + j.land - at, kind: 'impact', vel: 0.5 });
      }
      lt += BAR;
    }
    return lt;
  }

  /** The ending: the back flip landing on the third beat in the ring, the freeze under fireworks. */
  function ending(e0) {
    const eLand = e0 + 3 * B;
    place('ending', atMove('ending', 'backflip', 'land'), eLand, e0, e0 + BAR);
    const eHit = e0 + BAR + B;
    place('ending', atMove('ending', 'oneclaw', 'hit'), eHit, e0 + BAR, e0 + 2 * BAR);
    sfx.push(['sfx-footstep-stone', eLand, 0.7], ['sfx-crit', eLand + 0.05, 0.35], ['sfx-footstep-stone', eHit, 0.6], ['sfx-crit', eHit + 0.05, 0.4],
      ['sfx-crit', eHit + 1.3, 0.25], ['sfx-crit', eHit + 1.5, 0.2]);
    hits.push({ t: eLand, kind: 'impact', vel: 0.6 }, { t: eHit, kind: 'impact', vel: 0.6 });
    return e0 + 2 * BAR;
  }

  let t = 0;
  for (const sc of SCENES) {
    const t0 = t;
    if (sc.game === 'live') t = live(t0);
    else if (sc.game === 'ending') t = ending(t0);
    else {
      for (const p of sc.plates) {
        const last = sc.id === 'end';
        const end = t + p.bars * BAR + (last ? TAIL : 0);
        segs.push({ src: p.id, in: p.in ?? 0, t0: t, end });
        t += p.bars * BAR;
      }
    }
    const bars = (t - t0) / BAR;
    if (Math.abs(bars - sc.music.length) > 1e-6) throw new Error(`${sc.id}: ${bars} bars of picture, ${sc.music.length} of music`);
    // One section per run of a style within the scene, so each scene starts its own (a crash on
    // the finale's and grooveB's first bar, the horns' alternation).
    for (const style of sc.music) {
      const prev = sections[sections.length - 1];
      if (prev && prev.style === style && prev.scene === sc.id) prev.bars++;
      else sections.push({ style, bars: 1, scene: sc.id });
    }
    for (const [id, a, b] of sc.captions ?? []) captions.push([id, t0 + a * BAR + 0.15, t0 + b * BAR - 0.15]);
    if (sc.chapter) lowers.push([sc.chapter, t0 + 0.1, t - 0.15]);
    for (const [name, at, gain] of sc.sfx ?? []) sfx.push([name, t0 + at, gain]);
    for (const h of sc.hits ?? []) hits.push({ ...h, t: t0 + h.at });
    if (sc.flash) flashes.push({ at: t0, ...sc.flash });
    if (sc.id === 'end') cards.push(['endcard', t0 + 0.9, t + TAIL - 0.1]);
  }
  const total = t + TAIL;
  return {
    segs, captions, lowers, flashes, sfx, cards, total,
    music: { sections: sections.map(({ style, bars }) => ({ style, bars })), hits, tail: TAIL },
  };
}

const P = plan();
render(P, { cut, S, shotsDir, cardsDir, work, outFile, captions: resolve(here, 'captions.json'), cardText: CARD_TEXT });
