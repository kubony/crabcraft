// The making-of's script: what plays, in order, bar by bar of the beat (../breakdance/cut.mjs B
// and BAR, the toprock's 107.14 bpm). Each scene is a run of plates, pieces of picture with a
// length in bars: a plate from the Jumper review videos (rendered by plates.mjs: one panel, or two
// side by side, BEFORE and AFTER, each a window of a source video at a speed, with its label), a
// title card (cards.mjs), or the game's own shots for the payoff (edit.mjs places those on their
// probes). A scene also carries its chapter title, its captions ([id, from bar, to bar] within the
// scene, ids in captions.json), one music style a bar (beat.py) and its sound effects
// ([name, seconds into the scene, gain], public/audio) and beat.py hits.
//
// Sources are paths under the folder holding the Jumper worktrees (make.mjs --jumper); a panel's
// `crop` is [x, y, w, h] in the source's pixels (the review videos' own text strips cut away),
// `from` the source second its first frame shows, `speed` how fast the source plays (every source
// here already runs at the speed its label states: real time, or 4x slowed down as rendered; 0.5
// halves that again), `hold` seconds of its first frame held before it runs, `freeze` to show only
// the frame at `from` for the whole plate (a source that is a still image is shown so too), `zoom` a
// slow push in:
// { z: [from, to], at: [from s, to s], focus: [x, y] as fractions of the panel }.

import { BAR } from '../breakdance/cut.mjs';

const DANCE = 'feat-crabcraft-dance/out/review';
const CALM = 'feat-crabcraft-calm/out/review';
const BREAK = 'feat-crabcraft-breaking/out/review';
const POWER = 'feat-crabcraft-power/out/videos';

/** The Jumper review videos the plates cut from, by name. */
export const SOURCES = {
  // The 720 and the back flip trained from the simulator's reset, handed a robot standing at HOME
  // (replay, 0.5 s at HOME before the go, 60 fps), and the same moves trained from the handover.
  old720: `${DANCE}/old_jumpspin720_handover.mp4`,
  new720: `${DANCE}/jumpspin720_handover.mp4`,
  oldFlip: `${DANCE}/old_backflip_handover.mp4`,
  newFlip: `${DANCE}/backflip_handover.mp4`,
  // The back flip through the bundle's controller at 4x slow motion: as shipped (its 50 degree tilt
  // fallback sends it to Safe Hold in the air, from standing) and with the tilt check lifted for
  // its mode (from walking).
  tiltStock: `${DANCE}/backflip_controller_stock_tilt_fallback_slow4x.mp4`,
  tiltLifted: `${DANCE}/backflip_controller_no_tilt_check_from_walk_slow4x.mp4`,
  // Side by side at 4x slow motion: the flip chattering after its landing and fine-tuned to rest;
  // that flip resting splayed and the one taught to rest near HOME.
  calm: `${CALM}/calm_backflip_old_vs_new_slow4x.mp4`,
  rest: `${CALM}/home_side_old_vs_new_2s_slow4x.mp4`,
  // A still: the two settled poses side by side.
  restStill: `${CALM}/home_settled_pose_old_vs_new.png`,
  // The 720 before it was retrained, through the bundle's controller as it clipped every mode's
  // targets at the stops, switched into while walking (4x slow motion, 50 fps; its mode line at
  // the top; the handover 7.44 s in); and the 720 retrained within the stops, through the
  // controller, from a side-by-side review (4x slow, the handover 0.4 s in).
  clipped: `${DANCE}/jumpspin720_controller_from_walk_slow4x.mp4`,
  stops: 'feat-crabcraft-safe720/out/review/720_old_vs_new/review_720_4x.mp4',
  // The six-step from above, without and with its heading error (real time for its first 6.6 s).
  heading: 'feat-crabcraft-sixstep360/out/review/sixstep_F_vs_new_top.mp4',
  // Reference and policy side by side (real time for the first pass, then half speed).
  toprock: `${BREAK}/toprock_review.mp4`,
  six28: `${BREAK}/sixstep_0.28s_rejected_review.mp4`,
  six32: `${BREAK}/sixstep_0.32s_rejected_review.mp4`,
  // The first power moves, reward only, from the simulator's reset (60 fps; the spin 30).
  jump180: `${POWER}/power_jumpspin_180.mp4`,
  jump360: `${POWER}/power_jumpspin_360.mp4`,
  jump720: `${POWER}/power_jumpspin_best_720.mp4`,
  flipReset: `${POWER}/power_backflip_best.mp4`,
  spinFast: `${POWER}/power_spin_best.mp4`,
};

const HANDOVER = [0, 40, 640, 440];
/** The middle square of a 1280x720 power-move take, for the portrait cut. */
const SQUARE = [280, 0, 720, 720];
const REVIEW_L = [0, 80, 640, 400];
const REVIEW_R = [640, 80, 640, 400];
const WIDE_L = [0, 56, 960, 484];
const WIDE_R = [960, 56, 960, 484];
/** A whole 960x540 controller take, its mode line cut away. */
const TAKE = [0, 24, 960, 516];
/** The six-step's top view, either half, its readout cut away. */
const HEAD_L = [0, 66, 640, 574];
const HEAD_R = [648, 66, 640, 574];

/** A side-by-side review's two halves as panels, from the same second. */
const halves = (src, l, r, opts) => [{ src, crop: l, ...opts }, { src, crop: r, ...opts }];

export const SCENES = [
  {
    id: 'cold',
    plates: [
      { id: 'cold', bars: 2, panels: [{ src: 'old720', crop: HANDOVER, from: 0, speed: 0.5, zoom: { z: [1, 1.35], at: [0, 4.4], focus: [0.5, 0.62] } }], labels: ['lbl-sim'] },
    ],
    captions: [['cold1', 0, 1], ['cold2', 1, 2]],
    music: ['hook', 'rest'],
    // The go (0.5 s into the source at half speed): the servos whir, and nothing happens.
    sfx: [['sfx-servo-whir', 1.0, 0.5]],
    hits: [{ at: BAR, kind: 'scratch' }, { at: BAR + 0.26, kind: 'sad', vel: 1.6 }],
  },
  {
    id: 'title',
    plates: [{ id: 'card-logo', bars: 2, card: true, in: 0.3 }],
    music: ['drop', 'grooveA'],
    sfx: [['sfx-beacon', 0.02, 0.35]],
    flash: { d: 0.3, a: 0.8 },
  },
  {
    id: 'keyframe',
    // The toprock's first pass is real time; its steps (every 0.56 s from 0.32 s) fall on the beat.
    plates: [{ id: 'keyframe', bars: 2, panels: halves('toprock', REVIEW_L, REVIEW_R, { from: 0.88 }), labels: ['lbl-ref', 'lbl-policy'] }],
    captions: [['keyframe', 0, 2]],
    music: ['grooveA', 'grooveB'],
  },
  {
    id: 'reward',
    plates: [
      { id: 'reward-180', bars: 1, panels: [{ src: 'jump180', from: 0, portCrop: SQUARE }], labels: ['lbl-180'] },
      { id: 'reward-360', bars: 1, panels: [{ src: 'jump360', from: 0, portCrop: SQUARE }], labels: ['lbl-360'] },
      { id: 'reward-720', bars: 1, panels: [{ src: 'jump720', from: 0, portCrop: SQUARE }], labels: ['lbl-720'] },
    ],
    captions: [['reward', 0, 3]],
    music: ['drop', 'grooveB', 'grooveB'],
    sfx: [0, 1, 2].flatMap((k) => [['sfx-footstep-stone', k * BAR + 0.62, 0.6]]),
    hits: [0, 1, 2].map((k) => ({ at: k * BAR + 0.62, kind: 'impact', vel: 0.4 })),
    flash: { d: 0.16, a: 0.4 },
  },
  {
    id: 'bug1',
    chapter: 'ch1',
    plates: [
      { id: 'bug1-720', bars: 2, panels: [{ src: 'old720', crop: HANDOVER, from: 0.3, speed: 0.5 }, { src: 'new720', crop: HANDOVER, from: 0.3, speed: 0.5 }], labels: ['lbl-b1-old720', 'lbl-b1-new720'] },
      { id: 'bug1-flip', bars: 2, panels: [{ src: 'oldFlip', crop: HANDOVER, from: 0.3, speed: 0.5 }, { src: 'newFlip', crop: HANDOVER, from: 0.3, speed: 0.5 }], labels: ['lbl-b1-oldflip', 'lbl-b1-newflip'] },
    ],
    captions: [['b1why', 0, 2], ['b1fix', 2, 4]],
    music: ['half', 'half', 'grooveA', 'grooveB'],
  },
  {
    id: 'bug2',
    chapter: 'ch2',
    // Aligned on the handover: 6.8 s into the shipped take, 7.4 s into the other; Safe Hold comes
    // 0.22 s of simulated time after it, 0.88 s here.
    plates: [{ id: 'bug2', bars: 4, panels: [{ src: 'tiltStock', crop: TAKE, from: 6.6 }, { src: 'tiltLifted', crop: TAKE, from: 7.2 }], labels: ['lbl-b2-old', 'lbl-b2-new'] }],
    captions: [['b2why', 0, 2], ['b2fix', 2, 4]],
    music: ['half', 'half', 'grooveA', 'grooveB'],
    sfx: [['sfx-death', 1.08, 0.3]],
  },
  {
    id: 'bug3',
    chapter: 'ch3',
    // From the take-off; after the landing the view pushes in so the shaking shows.
    plates: [{ id: 'bug3', bars: 4, panels: halves('calm', WIDE_L, WIDE_R, { from: 2.0, zoom: { z: [1, 1.75], at: [2.2, 6.2], focus: [0.5, 0.6] } }), labels: ['lbl-b3-old', 'lbl-b3-new'] }],
    captions: [['b3why', 0, 2], ['b3fix', 2, 4]],
    music: ['half', 'half', 'grooveA', 'grooveA'],
  },
  {
    id: 'bug4',
    chapter: 'ch4',
    // The landing and the rest at quarter speed, then the review's still of the two settled poses.
    plates: [
      { id: 'bug4', bars: 3, panels: halves('rest', WIDE_L, WIDE_R, { from: 0 }), labels: ['lbl-b4-old', 'lbl-b4-new'] },
      { id: 'bug4-still', bars: 1, panels: halves('restStill', WIDE_L, WIDE_R, { from: 0, zoom: { z: [1, 1.12], at: [0, 2.3], focus: [0.5, 0.6] } }), labels: ['lbl-b4-old-still', 'lbl-b4-new-still'] },
    ],
    captions: [['b4why', 0, 2], ['b4fix', 2, 4]],
    music: ['half', 'half', 'grooveA', 'grooveB'],
  },
  {
    id: 'bug5',
    chapter: 'ch5',
    // Both 4x slow-motion takes slowed to three quarters of that again (about 5.3x), to fill four
    // bars, aligned on the handover (0.48 s into the plate). The controller take is cut to the
    // review half's shape, its mode line cut away.
    plates: [{
      id: 'bug5', bars: 4,
      panels: [{ src: 'clipped', crop: [91, 24, 780, 516], from: 7.08, speed: 0.75 }, { src: 'stops', crop: [640, 56, 640, 424], from: 0.04, speed: 0.75 }],
      labels: ['lbl-b5-old', 'lbl-b5-new'],
    }],
    captions: [['b5why', 0, 2], ['b5fix', 2, 4]],
    music: ['half', 'half', 'grooveA', 'grooveB'],
  },
  {
    id: 'bug6',
    chapter: 'ch6',
    // The first pass, in real time, up to 4.84 s (4.87 s simulated, both turns done, the robots
    // still in the six-step), the start pose held a moment first; then that frame is held with a
    // push in, the heading (blue) against the recording's (white).
    plates: [
      { id: 'bug6', bars: 2.25, panels: halves('heading', HEAD_L, HEAD_R, { from: 0, hold: 0.2 }), labels: ['lbl-b6-old', 'lbl-b6-new'] },
      { id: 'bug6-end', bars: 1.75, panels: halves('heading', HEAD_L, HEAD_R, { from: 4.84, freeze: true, zoom: { z: [1, 1.35], at: [0.2, 3.9], focus: [0.37, 0.44] } }), labels: ['lbl-b6-old', 'lbl-b6-new'] },
    ],
    captions: [['b6why', 0, 2], ['b6fix', 2, 4]],
    music: ['grooveA', 'grooveA', 'grooveB', 'grooveB'],
  },
  {
    id: 'montage',
    plates: [
      { id: 'montage-six28', bars: 0.75, panels: halves('six28', REVIEW_L, REVIEW_R, { from: 0.6 }), labels: ['lbl-ref', 'lbl-policy'], stamp: 'stamp-six28' },
      { id: 'montage-six32', bars: 0.75, panels: halves('six32', REVIEW_L, REVIEW_R, { from: 0.6 }), labels: ['lbl-ref', 'lbl-policy'], stamp: 'stamp-six32' },
      { id: 'montage-spin', bars: 0.75, panels: [{ src: 'spinFast', from: 2.0, portCrop: SQUARE }], stamp: 'stamp-spin' },
      { id: 'montage-flip', bars: 0.75, panels: [{ src: 'flipReset', from: 0, portCrop: SQUARE }], stamp: 'stamp-flip' },
    ],
    captions: [['montage', 0, 3]],
    music: ['drop', 'grooveB', 'grooveB'],
    // A thud as each stamp lands (plates.mjs STAMP_AT).
    sfx: [0, 1, 2, 3].map((k) => ['sfx-hit', k * 0.75 * BAR + 0.35, 0.5]),
    flash: { d: 0.2, a: 0.5 },
  },
  // The payoff and the end card: edit.mjs builds these from the game's shots and the cards.
  { id: 'live', game: 'live', bars: 3, captions: [['live', 0, 3]], music: ['finale', 'finale', 'drop'], flash: { d: 0.25, a: 0.6 } },
  { id: 'ending', game: 'ending', bars: 2, captions: [['ending', 0, 2]], music: ['finale', 'finale'], flash: { d: 0.25, a: 0.6 } },
  { id: 'end', plates: [{ id: 'card-end', bars: 2, card: true, in: 0.4 }], music: ['outro', 'outro'], flash: { d: 0.3, a: 0.6 } },
];

/** Every plate plates.mjs renders (not the cards, not the game's shots). */
export const PLATES = SCENES.flatMap((s) => (s.plates ?? []).filter((p) => !p.card));

/** Each chapter's bug and fix in the sound: an error buzz under its title, a jingle on the fix. */
for (const s of SCENES) {
  if (!s.chapter) continue;
  const fix = s.captions.find(([id]) => id.endsWith('fix'));
  s.sfx = [...(s.sfx ?? []), ['sfx-error', 0.12, 0.55], ['sfx-quest-complete', fix[1] * BAR + 0.05, 0.22]];
  s.flash = { d: 0.2, a: 0.45 };
}
