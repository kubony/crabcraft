// The live routine's music (public/audio/music-breaking.*, tools/robot-routine-music.mjs), kept in
// step with the simulation. The track's zero is the routine's bar 0 (sim time t0) and every move is
// timed in simulated seconds, so where the track should be is the simulated time since t0 in the
// frame on screen. The simulation stays the clock; the music follows it: a rate within 3 percent of
// 1 takes up small drift, a seek takes up anything over 0.12 s, and the music goes quiet while the
// simulation runs slower than real time (slow motion, a paused or overloaded simulation) and comes
// back at the right place.
import type { AudioManager, MusicCue } from '../core/audio';
import type { FrameMsg } from './protocol';

export const ROUTINE_MUSIC = 'music-breaking';

const SEEK_S = 0.12;
const MAX_RATE_DEV = 0.03;

export class RoutineMusic {
  private cue: MusicCue | null = null;
  private cueing = false;
  private t0 = Number.NaN;
  /** Where the track should be now, s (sim time since t0 in the latest frame). */
  private pos = 0;
  private err = 0;
  private ended = true;
  /** The music that was playing before the routine, brought back after it. */
  private before = '';
  private restoreAt = 0;

  constructor(private readonly audio: AudioManager) {
    void audio.preload([ROUTINE_MUSIC]);
  }

  /** Per rendered frame. `quiet`: the simulation runs slower than real time. */
  update(f: FrameMsg, quiet: boolean): void {
    const r = f.routine;
    const now = performance.now();
    if (this.restoreAt && now >= this.restoreAt) {
      this.restoreAt = 0;
      if (this.before && !this.audio.currentMusic) void this.audio.playMusic(this.before, 2.5);
    }
    if (!r || Number.isNaN(r.t0)) return;
    if (r.state === 'running' && r.t0 !== this.t0) this.begin(r.t0);
    if (r.t0 !== this.t0) return;
    this.pos = f.simTime - r.t0;
    const cue = this.cue;
    if (r.state === 'stopped' || r.state === 'failed') {
      if (!this.ended) this.end(0.8);
      return;
    }
    if (!cue) return;
    if (cue.ended) {
      if (!this.ended) this.end(0);
      return;
    }
    if (quiet) {
      cue.setMuted(true);
      return;
    }
    cue.setMuted(false);
    const err = this.pos - cue.position();
    if (Math.abs(err) > SEEK_S) {
      cue.seek(this.pos);
      cue.setRate(1);
      this.err = 0;
      return;
    }
    // Frames carry the simulation's time in small bursts: smooth before steering on it.
    this.err += (err - this.err) * 0.1;
    cue.setRate(1 + Math.max(-MAX_RATE_DEV, Math.min(MAX_RATE_DEV, this.err * 0.6)));
  }

  /** Where the track should be and where it is, s (null when nothing plays): for the checks. */
  sync(): { want: number; at: number | null; id: string } {
    const c = this.cue;
    return { want: this.pos, at: c && !c.ended ? c.position() : null, id: c?.id ?? '' };
  }

  /** The routine was stopped from the page (its frames will say so too). */
  stop(): void {
    if (!this.ended) this.end(0.8);
  }

  private begin(t0: number): void {
    this.t0 = t0;
    this.pos = 0;
    this.err = 0;
    this.ended = false;
    this.restoreAt = 0;
    const cur = this.audio.currentMusic;
    if (cur && cur !== ROUTINE_MUSIC) this.before = cur;
    if (this.cue && !this.cue.ended) {
      this.cue.seek(0);
      return;
    }
    if (this.cueing) return;
    this.cueing = true;
    void this.audio
      .cueMusic(ROUTINE_MUSIC, () => this.pos)
      .then((c) => {
        this.cue = c;
        if (c && this.ended) c.stop(0.3);
      })
      .finally(() => {
        this.cueing = false;
      });
  }

  private end(fade: number): void {
    this.ended = true;
    if (this.cue && !this.cue.ended) this.cue.stop(fade);
    this.cue = null;
    this.restoreAt = performance.now() + fade * 1000 + 600;
  }

  dispose(): void {
    if (this.cue && !this.cue.ended) this.cue.stop(0.4);
    this.cue = null;
  }
}
