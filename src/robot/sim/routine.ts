// Robot Mode's live breakdance routine: the game's whole set (toprock, six-step, spin, 720, back flip,
// one-claw freeze) performed by the bare robot's policies under the bundle's controller, one after
// the other, each started on the downbeat of a bar of the routine's beat.
//
// Nothing here moves a joint. The routine only presses the bundle's own mode switches, as its
// keyboard binds them (Shift + 1 to 7, held 40 ms), at times it plans on the beat grid, and waits
// for each mode to hand the robot back to walking before it asks for the next: the bundle takes each
// of these switches from walking only. The recorded moves end by themselves, the spin is ended by
// its own switch pressed again, and the 720 and the back flip by the host's press after the landing
// (core.ts AUTO_LEAVE_S). Every press it makes is reported, so the page can say so.
//
// Timing is simulated time, so the routine lands on the same ticks whatever the machine's speed:
// the page keeps the music in step with the simulation, not the other way round.
//
// Environment agnostic like core.ts: no imports, so Node runs it from tools/robot-sim-check.ts.

/** One beat, s: the toprock's own step (src/motion/breakClips.ts, beat1 to beat8), 107.14 bpm. */
export const BEAT_S = 0.56;
export const BAR_S = 4 * BEAT_S;
export const BPM = 60 / BEAT_S;

export interface RoutineMove {
  mode: string;
  /** The bar whose downbeat the move's policy starts on (bar 0 starts with the routine). */
  bar: number;
  /** For a held move (the spin): beats after its downbeat at which its switch is pressed again. */
  holdBeats?: number;
}

/**
 * The set, in breaking's order: toprock, footwork, power moves, freeze. The bars come from the live
 * simulation (tools/robot-sim-check.ts --routine prints every phase), each move given room to end,
 * hand back to walking and stand for SETTLE_S before the next press:
 *
 *   move        press to policy   policy to walking again          bars to the next downbeat
 *   toprock     0.70-0.83 s       6.24 s (its recording)           4
 *   six-step    0.70-0.83 s       5.32 s (its recording)           3
 *   spin        0.58-0.69 s       6 beats held, then 0.93-0.99 s   3
 *   720         0.58-0.69 s       1.40 s + 0.74-0.75 s             2
 *   back flip   0.58-0.69 s       1.20 s + 0.93-0.94 s             2
 *   one-claw    0.70-0.83 s       6.52 s (its recording)           (the end)
 *
 * The one-claw freeze lands on the downbeat after its own (its clip's hit, 4 beats after the policy
 * starts), which is where the music's final stab is.
 */
export const ROUTINE: readonly RoutineMove[] = [
  { mode: 'break_toprock', bar: 1 },
  { mode: 'break_sixstep', bar: 5 },
  { mode: 'power_spin', bar: 8, holdBeats: 6 },
  { mode: 'power_jumpspin', bar: 11 },
  { mode: 'power_backflip', bar: 13 },
  { mode: 'break_oneclaw', bar: 15 },
];

/** Bars of the routine's music before its tail rings out (public/audio/music-breaking.*). */
export const ROUTINE_BARS = 17;

/**
 * Seconds from the press of a mode's switch to its policy's start, as `a + b / d`, `d` the largest
 * distance of a joint from the mode's home pose at the press (rad). The controller slides the joints
 * to that pose (mode_switch_ramp_s, ramp_kp / ramp_kd) and starts the policy when every joint is
 * within pose_reach_tol of it, so the further they start, the later it hands over. Fitted on this
 * simulation to 455 presses of the six moves, each made after another move had played out and the
 * robot had stood (or walked or turned, then stood) in walking mode for 0.6 to 2.2 s, the joints
 * 0.19 to 0.24 rad from home at most:
 *
 *   the power moves (200 Hz, physics at 2.5 ms)   230 presses, 0.575 to 0.69 s; the model is off by
 *                                                 4 ms (std), 29 ms at worst
 *   the tracked moves (50 Hz, physics at 5 ms)    225 presses, 0.695 to 0.83 s, mean 0.784; the
 *                                                 distance explains none of the spread (21 ms std,
 *                                                 40 ms for 95 of 100, 85 ms at worst), so a
 *                                                 constant is used
 *
 * The press goes this long before the downbeat.
 */
export const LEAD: Readonly<Record<string, { a: number; b: number }>> = {
  break_toprock: { a: 0.784, b: 0 },
  break_sixstep: { a: 0.784, b: 0 },
  break_clawstand: { a: 0.784, b: 0 },
  break_oneclaw: { a: 0.784, b: 0 },
  power_spin: { a: 1.0816, b: -0.0948 },
  power_jumpspin: { a: 1.0816, b: -0.0948 },
  power_backflip: { a: 1.0816, b: -0.0948 },
};

/** The lead for `mode` with its joints `d` rad from its home pose at most (see LEAD). */
export function leadFor(mode: string, d: number, table: Readonly<Record<string, { a: number; b: number }>> = LEAD): number {
  const m = table[mode] ?? { a: 0.75, b: 0 };
  return Math.max(0.3, Math.min(1.0, m.a + m.b / Math.max(0.15, d)));
}

/**
 * Seconds the robot has to have walked (stood) again before the next press. Right after a move hands
 * back its joints are still within the tolerance of every mode's home pose and a press starts the
 * policy at once; over the next 0.3 s the walking policy moves them out and back in. From 0.6 s on
 * the lead above holds.
 */
export const SETTLE_S = 0.6;

const TICK_S = 0.005;
/** A press the controller has not acted on by then was refused. */
const ENTER_TIMEOUT_S = 0.25;
/** A ramp that has not handed over by then is stuck (the controller waits on the pose for ever). */
const HAND_TIMEOUT_S = 2.5;
/** No move of the routine runs longer than this before handing back. */
const MOVE_TIMEOUT_S = 12;
/** Bars the routine waits for a robot that is not ready before it gives up. */
const MAX_SLIPS = 4;

/** What the routine reads from and asks of the simulation, once per control tick. */
export interface RoutineHost {
  readonly simTime: number;
  /** The controller's mode as of the last tick, and whether its policy runs (not ramping). */
  readonly mode: string;
  readonly runningPolicy: boolean;
  /** Sim seconds at which the current mode's policy started; null while it has not. */
  readonly policySince: number | null;
  /** Presses `mode`'s switch as the bundle binds it on the keyboard; the key codes, or null. */
  pressSwitch(mode: string): string[] | null;
  /** Presses the binding that leaves `mode` for walking (leave_motion: Ctrl); the codes, or null. */
  pressLeave(mode: string): string[] | null;
  /** Whether the host itself ends `mode` after its landing (core.ts AUTO_LEAVE_S). */
  endsByItself(mode: string): boolean;
  /** The largest distance of a joint from `mode`'s home pose now, rad. */
  homeDistance(mode: string): number;
  /** The operator lets go of every held control. */
  letGo(): void;
}

export type RoutineState = 'running' | 'done' | 'stopped' | 'failed';
export type RoutinePhase = 'wait' | 'enter' | 'ramp' | 'live' | 'back' | 'end';

export interface RoutineEvent {
  kind: 'press' | 'live' | 'back' | 'slip' | 'end';
  /** Sim seconds, and beats since the routine started. */
  at: number;
  beat: number;
  mode: string;
  /** Key codes the routine pressed (kind 'press'). */
  keys?: string[];
  /** Why it pressed: to start the move, to end it, or to stop the routine. */
  why?: 'start' | 'end' | 'stop';
  /** Seconds the policy started after (+) or before (-) its downbeat (kind 'live'). */
  offBeat?: number;
  /** The end: done, stopped or failed, and why. */
  state?: RoutineState;
  text?: string;
}

export interface RoutineStatus {
  state: RoutineState;
  /** Sim time of the routine's bar 0, s: the music's zero. */
  t0: number;
  /** The move being prepared or performed, as an index into the plan (plan length when done). */
  move: number;
  phase: RoutinePhase;
  /** Bars every remaining move was pushed back by because one was not ready on its downbeat. */
  slips: number;
  /** Why it stopped or failed. */
  why: string;
}

/** Per move, what happened, in sim seconds (for the checks and the log). */
export interface MoveRecord {
  mode: string;
  /** The downbeat the policy was meant to start on. */
  downbeat: number;
  pressAt: number | null;
  /** The lead the press was timed for, s. */
  leadPlanned: number | null;
  liveAt: number | null;
  /** The press that ended a held move. */
  endPressAt: number | null;
  leftAt: number | null;
  backAt: number | null;
}

export class LiveRoutine {
  state: RoutineState = 'running';
  t0 = Number.NaN;
  move = 0;
  phase: RoutinePhase = 'wait';
  slips = 0;
  why = '';
  /** Since the last drain. */
  events: RoutineEvent[] = [];
  readonly moves: MoveRecord[];
  readonly plan: readonly RoutineMove[];
  private readonly lead: Readonly<Record<string, { a: number; b: number }>>;
  private readonly settle: number;
  private stopAsked: string | null = null;
  private phaseAt = 0;

  // Plain fields, no parameter properties: Node's type stripping runs this file as it is.
  constructor(plan: readonly RoutineMove[] = ROUTINE, lead: Readonly<Record<string, { a: number; b: number }>> = LEAD, settle = SETTLE_S) {
    this.plan = plan;
    this.lead = lead;
    this.settle = settle;
    this.moves = plan.map((m) => ({ mode: m.mode, downbeat: Number.NaN, pressAt: null, leadPlanned: null, liveAt: null, endPressAt: null, leftAt: null, backAt: null }));
  }

  status(): RoutineStatus {
    return { state: this.state, t0: this.t0, move: this.move, phase: this.phase, slips: this.slips, why: this.why };
  }

  /** The downbeat of move `i` as planned now (slips included), sim s. */
  downbeat(i: number): number {
    return this.t0 + (this.plan[i].bar + this.slips) * BAR_S;
  }

  /** Beats since bar 0 at sim time `t`. */
  beatAt(t: number): number {
    return (t - this.t0) / BEAT_S;
  }

  /** Ask it to stop at the next tick, handing the robot back to walking. */
  stop(why: string): void {
    if (this.state === 'running') this.stopAsked = why;
  }

  /** Ended from outside without a press (the simulation was reset). */
  cancel(why: string): void {
    if (this.state !== 'running') return;
    this.finish('stopped', why, Number.isNaN(this.t0) ? 0 : this.t0, '');
  }

  /** Once per control tick, before the keys are handed to the controller. */
  tick(h: RoutineHost): void {
    if (this.state !== 'running') return;
    const t = h.simTime;
    if (Number.isNaN(this.t0)) {
      this.t0 = t;
      this.phaseAt = t;
      // Whatever the person held is let go: the routine starts from rest.
      h.letGo();
      // From another mode (a dance, a claw), back to walking first; the first move then waits for
      // its bar like any late one.
      if (h.mode !== 'locomotion' && h.mode !== 'safe') this.pressOut(h, t, 'stop');
    }
    if (h.mode === 'safe') {
      this.finish('failed', 'the robot went to the Safe Hold', t, h.mode);
      return;
    }
    if (this.stopAsked !== null) {
      const why = this.stopAsked;
      this.stopAsked = null;
      this.handBack(h, t);
      this.finish('stopped', why, t, h.mode);
      return;
    }
    const m = this.plan[this.move];
    const rec = this.moves[this.move];
    const down = this.downbeat(this.move);
    rec.downbeat = down;
    switch (this.phase) {
      case 'wait': {
        // Not before the earliest a press could be due; from then on, every tick, the lead the
        // joints' pose predicts now.
        if (t + TICK_S / 2 < down - 1.0) return;
        const lead = leadFor(m.mode, h.homeDistance(m.mode), this.lead);
        if (t + TICK_S / 2 < down - lead) return;
        const ready = h.mode === 'locomotion' && h.runningPolicy && h.policySince !== null && t - h.policySince >= this.settle - 1e-9;
        if (!ready) {
          // Not walking, or not for long enough to start the ramp from a known pose: the move (and
          // every one after it) waits for the next bar instead of starting off the beat.
          this.slips++;
          this.events.push({ kind: 'slip', at: t, beat: this.beatAt(t), mode: m.mode, text: `not ready in ${h.mode}${h.runningPolicy ? '' : ' (ramping)'}` });
          if (this.slips > MAX_SLIPS) this.fail(h, t, `the robot was not ready to start ${m.mode} for ${MAX_SLIPS} bars`);
          return;
        }
        const keys = h.pressSwitch(m.mode);
        if (!keys) {
          this.finish('failed', `the bundle binds no key to ${m.mode}`, t, h.mode);
          return;
        }
        rec.pressAt = t;
        rec.leadPlanned = lead;
        this.events.push({ kind: 'press', at: t, beat: this.beatAt(t), mode: m.mode, keys, why: 'start' });
        this.setPhase('enter', t);
        return;
      }
      case 'enter':
      case 'ramp': {
        if (h.mode === m.mode && h.runningPolicy) {
          // The policy took over in the tick before this one.
          const live = t - TICK_S;
          rec.liveAt = live;
          this.events.push({ kind: 'live', at: live, beat: this.beatAt(live), mode: m.mode, offBeat: live - down });
          this.setPhase('live', t);
        } else if (h.mode === m.mode) {
          if (this.phase === 'enter') this.setPhase('ramp', t);
          if (t - this.phaseAt > HAND_TIMEOUT_S) this.fail(h, t, `${m.mode}'s ramp never handed over`);
        } else if (t - this.phaseAt > ENTER_TIMEOUT_S) {
          this.fail(h, t, `the controller did not switch to ${m.mode} (in ${h.mode})`);
        }
        return;
      }
      case 'live': {
        if (h.mode !== m.mode) {
          rec.leftAt = t;
          this.setPhase('back', t);
          return;
        }
        if (m.holdBeats !== undefined && rec.endPressAt === null && t + TICK_S / 2 >= down + m.holdBeats * BEAT_S) {
          const keys = h.pressSwitch(m.mode);
          rec.endPressAt = t;
          if (keys) this.events.push({ kind: 'press', at: t, beat: this.beatAt(t), mode: m.mode, keys, why: 'end' });
        }
        if (t - this.phaseAt > MOVE_TIMEOUT_S) this.fail(h, t, `${m.mode} did not end`);
        return;
      }
      case 'back': {
        if (h.mode === 'locomotion' && h.runningPolicy) {
          rec.backAt = t;
          this.events.push({ kind: 'back', at: t, beat: this.beatAt(t), mode: m.mode });
          this.move++;
          if (this.move >= this.plan.length) this.finish('done', '', t, h.mode);
          else this.setPhase('wait', t);
        } else if (h.mode !== 'locomotion') {
          this.fail(h, t, `${m.mode} handed over to ${h.mode}, not to walking`);
        } else if (t - this.phaseAt > HAND_TIMEOUT_S) {
          this.fail(h, t, 'the ramp back to walking never handed over');
        }
        return;
      }
    }
  }

  private setPhase(p: RoutinePhase, t: number): void {
    this.phase = p;
    this.phaseAt = t;
  }

  /** Hands the robot back to walking from wherever the routine left it, by the bundle's bindings. */
  private handBack(h: RoutineHost, t: number): void {
    const m = this.plan[this.move];
    if (!m || h.mode !== m.mode) return;
    // A jump in the air is not interrupted: the host ends it after the landing.
    if (this.phase === 'live' && h.endsByItself(m.mode)) return;
    // The spin's own switch ends the spin; anything else (a recording, a ramp) leaves on Ctrl.
    if (this.phase === 'live' && m.holdBeats !== undefined) {
      if (this.moves[this.move].endPressAt !== null) return;
      const keys = h.pressSwitch(m.mode);
      if (keys) this.events.push({ kind: 'press', at: t, beat: this.beatAt(t), mode: m.mode, keys, why: 'stop' });
      return;
    }
    this.pressOut(h, t, 'stop');
  }

  private pressOut(h: RoutineHost, t: number, why: 'stop'): void {
    const keys = h.pressLeave(h.mode);
    if (keys) this.events.push({ kind: 'press', at: t, beat: this.beatAt(t), mode: h.mode, keys, why });
  }

  private fail(h: RoutineHost, t: number, why: string): void {
    this.handBack(h, t);
    this.finish('failed', why, t, h.mode);
  }

  private finish(state: RoutineState, why: string, t: number, mode: string): void {
    this.state = state;
    this.why = why;
    this.phase = 'end';
    this.events.push({ kind: 'end', at: t, beat: this.beatAt(t), mode, state, text: why });
  }
}
