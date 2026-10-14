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

  async playMusic(id: string, fadeSeconds = 1.5): Promise<void> {
    // Already playing it, or already on the way (a track that is still decoding).
    if (this.music?.id === id || (!this.music && this.wantMusic === id)) return;
    this.wantMusic = id;
    const ticket = ++this.musicTicket;
    const prev = this.music;
    this.music = null;
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
    if (!this.music) return;
    this.fadeOut(this.music, fadeSeconds);
    this.music = null;
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
