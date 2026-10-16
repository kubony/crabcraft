// Music and sound effects over WebAudio. Reads public/audio/index.json (written by the art
// pipeline). Missing files are skipped silently so the game runs before audio lands.

export interface AudioEntry {
  id: string;
  files: string[];
  loop?: boolean;
  volume?: number;
}

const base = import.meta.env.BASE_URL;

/**
 * A music track kept in step with an outside clock (Robot Mode's live routine follows the
 * simulation): the caller says where the track should be, and seeks or nudges the rate to get there.
 */
export interface MusicCue {
  readonly id: string;
  /** Seconds into the track now. */
  position(): number;
  /** Jump to `offset` seconds in, with a short crossfade. */
  seek(offset: number): void;
  /** Playback rate, kept near 1: a small correction, never an effect. */
  setRate(rate: number): void;
  /** Silent without losing its place (slow motion, a paused simulation), or audible again. */
  setMuted(muted: boolean): void;
  stop(fadeSeconds?: number): void;
  /** Played to its end or stopped. */
  readonly ended: boolean;
}

/**
 * Equal-power (quarter sine) fade between two gains as a few linear ramps. Ramps, unlike value
 * curves, may follow or cut into other automation, so a fade can start mid-fade.
 */
function rampEqualPower(p: AudioParam, from: number, to: number, t0: number, seconds: number): void {
  const n = 8;
  const d = Math.max(0.05, seconds);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const w = from < to ? Math.sin(k * Math.PI * 0.5) : Math.cos(k * Math.PI * 0.5);
    p.linearRampToValueAtTime(from < to ? to * w : from * w, t0 + d * k);
  }
}

export class AudioManager {
  readonly ctx: AudioContext;
  private master: GainNode;
  private musicBus: GainNode;
  private sfxBus: GainNode;
  private entries = new Map<string, AudioEntry>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private music: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** The cued track, while it holds the music slot. */
  private cue: Cue | null = null;
  /** Bumped by every playMusic/stopMusic; a decode that finishes late checks it. */
  private musicTicket = 0;
  private wantMusic = '';
  private ready: Promise<void>;
  musicVolume = 0.55;
  sfxVolume = 0.8;
  muted = false;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.ready = this.loadIndex();
    // Browsers start the context suspended until a user gesture.
    const unlock = () => {
      void this.ctx.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private async loadIndex(): Promise<void> {
    try {
      const res = await fetch(`${base}audio/index.json`);
      if (!res.ok) return;
      const data = (await res.json()) as AudioEntry[] | { tracks?: AudioEntry[]; entries?: AudioEntry[] };
      const list = Array.isArray(data) ? data : (data.entries ?? data.tracks ?? []);
      for (const e of list) this.entries.set(e.id, e);
    } catch {
      /* no audio yet */
    }
  }

  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      p = this.ready.then(async () => {
        const e = this.entries.get(id);
        if (!e) return null;
        const canOgg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
        const file = e.files.find((f) => (canOgg ? f.endsWith('.ogg') : f.endsWith('.mp3'))) ?? e.files[0];
        try {
          const url = file.startsWith('http') || file.startsWith('/') ? file : `${base}audio/${file.replace(/^audio\//, '')}`;
          const buf = await (await fetch(url)).arrayBuffer();
          return await this.ctx.decodeAudioData(buf);
        } catch {
          return null;
        }
      });
      this.buffers.set(id, p);
    }
    return p;
  }

  /** Warm the cache so the first play has no delay. */
  preload(ids: string[]): Promise<unknown> {
    return Promise.all(ids.map((id) => this.load(id)));
  }

  /** The music playing or on its way ('' for none). */
  get currentMusic(): string {
    return this.music?.id ?? this.wantMusic;
  }

  async playMusic(id: string, fadeSeconds = 1.5): Promise<void> {
    // Already playing it, or already on the way (a track that is still decoding).
    if (!this.cue && (this.music?.id === id || (!this.music && this.wantMusic === id))) return;
    this.wantMusic = id;
    const ticket = ++this.musicTicket;
    const prev = this.music;
    this.music = null;
    this.cue = null;
    if (prev) this.fadeOut(prev, fadeSeconds);
    const buf = await this.load(id);
    // A newer request (or stopMusic) came in while this one decoded: never start two tracks.
    if (!buf || ticket !== this.musicTicket) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = this.entries.get(id)?.loop ?? true;
    const gain = this.ctx.createGain();
    const vol = this.entries.get(id)?.volume ?? 1;
    const t = this.ctx.currentTime;
    // Equal-power fade in: no dip in loudness halfway through a crossfade.
    gain.gain.setValueAtTime(0, t);
    rampEqualPower(gain.gain, 0, vol, t, fadeSeconds);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.music = { id, src, gain };
  }

  stopMusic(fadeSeconds = 1.5): void {
    this.musicTicket++;
    this.wantMusic = '';
    this.cue = null;
    if (!this.music) return;
    this.fadeOut(this.music, fadeSeconds);
    this.music = null;
  }

  /**
   * Plays `id` once from `at()` seconds in (read when the track is decoded and starts), in place of
   * the music playing, through the music bus (so the music volume and mute apply). The returned cue
   * keeps it in step with whatever `at` follows. Null when the track cannot play or another music
   * request came in while it decoded.
   */
  async cueMusic(id: string, at: () => number, fadeSeconds = 0.05): Promise<MusicCue | null> {
    this.wantMusic = id;
    const ticket = ++this.musicTicket;
    const buf = await this.load(id);
    if (!buf || ticket !== this.musicTicket) return null;
    const prev = this.music;
    if (prev) this.fadeOut(prev, Math.max(0.3, fadeSeconds));
    const gain = this.ctx.createGain();
    gain.connect(this.musicBus);
    const cue = new Cue(this, id, buf, gain, this.entries.get(id)?.volume ?? 1);
    this.cue = cue;
    cue.seek(Math.max(0, at()), fadeSeconds);
    return cue;
  }

  /** The cue now holds the music slot with this source (called by Cue on every (re)start). */
  claimSlot(cue: Cue, src: AudioBufferSourceNode, gain: GainNode): boolean {
    if (this.cue !== cue) return false;
    this.music = { id: cue.id, src, gain };
    return true;
  }

  /** A cue that ended by itself gives up the music slot. */
  releaseSlot(cue: Cue): void {
    if (this.cue !== cue) return;
    this.cue = null;
    this.music = null;
    this.wantMusic = '';
  }

  private fadeOut(m: { src: AudioBufferSourceNode; gain: GainNode }, fadeSeconds: number): void {
    const t = this.ctx.currentTime;
    const g = m.gain.gain;
    const from = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(from, t);
    rampEqualPower(g, from, 0, t, fadeSeconds);
    m.src.stop(t + fadeSeconds + 0.05);
  }

  /** Fire-and-forget sound effect. `pitch` jitters playback rate by ± that fraction. */
  sfx(id: string, opts: { volume?: number; pitch?: number; delay?: number } = {}): void {
    if (this.muted) return;
    void this.load(id).then((buf) => {
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const jitter = opts.pitch ?? 0.06;
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
      const gain = this.ctx.createGain();
      gain.gain.value = (opts.volume ?? 1) * (this.entries.get(id)?.volume ?? 1);
      src.connect(gain).connect(this.sfxBus);
      src.start(this.ctx.currentTime + (opts.delay ?? 0));
    });
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    this.musicBus.gain.value = v;
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    this.sfxBus.gain.value = v;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }
}

/** AudioManager.cueMusic's track: one source at a time, each (re)start a short crossfade. */
class Cue implements MusicCue {
  private src: AudioBufferSourceNode | null = null;
  private srcGain: GainNode | null = null;
  /** Track position at `anchorCtx` (context seconds), and the rate since. */
  private anchorPos = 0;
  private anchorCtx = 0;
  private rate = 1;
  private muted = false;
  ended = false;

  constructor(
    private readonly audio: AudioManager,
    readonly id: string,
    private readonly buf: AudioBuffer,
    /** The cue's own gain, under each source's crossfade gain: muting. */
    private readonly out: GainNode,
    private readonly volume: number,
  ) {}

  private get ctx(): AudioContext {
    return this.audio.ctx;
  }

  position(): number {
    return this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  seek(offset: number, fadeSeconds = 0.03): void {
    if (this.ended) return;
    const t = this.ctx.currentTime;
    this.dropSource(fadeSeconds);
    if (offset >= this.buf.duration) {
      this.finish();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf;
    src.playbackRate.value = this.rate;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(this.volume, t + Math.max(0.005, fadeSeconds));
    src.connect(g).connect(this.out);
    src.onended = () => {
      if (this.src === src) this.finish();
    };
    src.start(t, Math.max(0, offset));
    this.src = src;
    this.srcGain = g;
    this.anchorPos = Math.max(0, offset);
    this.anchorCtx = t;
    if (!this.audio.claimSlot(this, src, g)) {
      // Something else took the music over while this cue was being set up.
      this.stop(0.05);
    }
  }

  setRate(rate: number): void {
    if (this.ended || !this.src) return;
    const r = Math.max(0.9, Math.min(1.1, rate));
    if (Math.abs(r - this.rate) < 1e-4) return;
    this.anchorPos = this.position();
    this.anchorCtx = this.ctx.currentTime;
    this.rate = r;
    this.src.playbackRate.setValueAtTime(r, this.ctx.currentTime);
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(muted ? 0 : 1, t + (muted ? 0.25 : 0.08));
  }

  stop(fadeSeconds = 0.6): void {
    if (this.ended) return;
    this.dropSource(fadeSeconds);
    this.finish();
  }

  private dropSource(fadeSeconds: number): void {
    const src = this.src;
    const g = this.srcGain;
    this.src = null;
    this.srcGain = null;
    if (!src || !g) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + Math.max(0.005, fadeSeconds));
    src.onended = null;
    src.stop(t + Math.max(0.005, fadeSeconds) + 0.02);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.audio.releaseSlot(this);
    const out = this.out;
    setTimeout(() => out.disconnect(), 2000);
  }
}
