#!/usr/bin/env node
// The music of Robot Mode's live breakdance routine: the breakdance video's own beat
// (tools/trailer/breakdance/beat.py, synthesised from sine waves, noise and filters, no samples, at
// the toprock's 107.14 bpm) arranged on the routine's bars (src/robot/sim/routine.ts), so each
// section turns over on the downbeat a move starts on, the impacts fall on the two jumps' landings
// and the final stab on the one-claw freeze. Writes public/audio/music-breaking.ogg and .mp3 (-18
// LUFS, like the game's other music) and records the track in public/audio/index.json as original
// work. Re-run it when ROUTINE or ROUTINE_BARS change.
//
//   node tools/robot-routine-music.mjs [--out public/audio] [--arrangement-only]
// Needs uv (numpy, scipy, soundfile and pyloudnorm come with it) and ffmpeg with libmp3lame.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAR_S, ROUTINE, ROUTINE_BARS } from '../src/robot/sim/routine.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const outDir = resolve(opt('--out', join(here, '..', 'public', 'audio')));
export const ID = 'music-breaking';

/** beat.py's style for each move's bars: the first bar's, then the rest's. */
const STYLE = {
  break_toprock: ['grooveA'],
  break_sixstep: ['grooveB'],
  power_spin: ['finale'],
  power_jumpspin: ['drop', 'grooveA'],
  power_backflip: ['drop', 'grooveB'],
  // Two bars: a groove with a scratch under the bounces, then the final stab on the freeze, which
  // lands on the downbeat after the move's own (its clip's hit, 4 beats after the policy starts).
  break_oneclaw: ['outro'],
};
/**
 * Seconds from a jump's policy start to its touchdown, through the bundle's controller: the
 * recorded clips' `land` minus `policy_start` (src/motion/breakClips.ts), which the live routine
 * reproduces (tools/robot-sim-check.ts prints each jump's touchdown in the routine).
 */
const LANDING_S = { power_jumpspin: 0.63, power_backflip: 0.465 };
/** Seconds of ring-out after the last bar: the freeze held, released and stood up from. */
const TAIL_S = 4.6;

export function arrangement() {
  const sections = [];
  const add = (style, bars) => {
    if (bars <= 0) return;
    const last = sections[sections.length - 1];
    if (last && last.style === style && style !== 'drop' && style !== 'outro') last.bars += bars;
    else sections.push({ style, bars });
  };
  // Bar 0 (and any before the first move): the count-in, a riser and a reverse cymbal into it.
  add('hook', ROUTINE[0].bar);
  ROUTINE.forEach((m, i) => {
    const end = i + 1 < ROUTINE.length ? ROUTINE[i + 1].bar : ROUTINE_BARS;
    const [first, rest = first] = STYLE[m.mode] ?? ['grooveA'];
    if (first === 'outro' && end - m.bar !== 2) throw new Error(`the last move needs 2 bars of outro, it has ${end - m.bar}`);
    add(first, first === rest || first === 'outro' ? end - m.bar : 1);
    if (first !== rest) add(rest, end - m.bar - 1);
  });
  const hits = [{ t: ROUTINE[0].bar * BAR_S, kind: 'crash', vel: 0.8 }];
  for (const m of ROUTINE) if (LANDING_S[m.mode]) hits.push({ t: +(m.bar * BAR_S + LANDING_S[m.mode]).toFixed(3), kind: 'impact' });
  const bars = sections.reduce((s, x) => s + x.bars, 0);
  if (bars !== ROUTINE_BARS) throw new Error(`arrangement has ${bars} bars, the routine ${ROUTINE_BARS}`);
  return { sections, hits, tail: TAIL_S };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arr = arrangement();
  console.log(JSON.stringify(arr));
  if (!args.includes('--arrangement-only')) {
    const tmp = mkdtempSync(join(tmpdir(), 'routine-music-'));
    const arrFile = join(tmp, 'arrangement.json');
    const entryFile = join(tmp, 'entry.json');
    writeFileSync(arrFile, JSON.stringify(arr));
    writeFileSync(entryFile, JSON.stringify({
      loop: false,
      volume: 0.9,
      credit: 'Original beat for World of Crabcraft, synthesised (no samples) by tools/trailer/breakdance/beat.py',
      license: 'Apache-2.0',
      source: 'tools/trailer/breakdance/beat.py (procedural), arranged on the live routine by tools/robot-routine-music.mjs',
    }));
    const r = spawnSync(
      'uv',
      ['run', '-q', '--with', 'numpy', '--with', 'scipy', '--with', 'soundfile', '--with', 'pyloudnorm', 'python',
        join(here, 'trailer', 'breakdance', 'music_file.py'), arrFile, outDir, ID, entryFile],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error('music_file.py failed');
  }
}
