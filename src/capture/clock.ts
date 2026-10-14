// Deterministic capture mode for trailers and frame-exact renders (dev server only, `?capture=1`).
//
// The page keeps running in real time while it loads. Once a capture script calls
// `__capture.begin()`, time stops: performance.now, Date.now, timers, requestAnimationFrame and
// CSS animations and transitions only move when the script calls `__capture.step()`, by exactly
// the step's dt (1/60 s by default). Each step fires the timers that came due, lets registered
// participants catch up (Robot Mode's simulation worker advances to the same instant), runs the
// animation frame callbacks (the engine renders one frame) and poses every CSS animation at the
// virtual time. A screenshot taken after a step shows exactly that instant, however long the
// machine took to make it. Math.random is seeded (`&seed=N`) so takes repeat.
//
// Outside `pnpm dev` with `?capture` this module does nothing, and a production build drops it.

export interface CaptureParticipant {
  /** Called when stepping begins (the page leaves real time). */
  begin?(): void | Promise<void>;
  /** Called on every step after the timers, before the frame renders. */
  step(dtMs: number, nowMs: number): void | Promise<void>;
}

export interface CaptureApi {
  /** True after begin(): time only moves on step(). */
  readonly stepping: boolean;
  /** Virtual time, ms (same clock as performance.now()). */
  readonly now: number;
  /** Frames stepped since begin(). */
  readonly frame: number;
  /** Leave real time. Resolves once every participant is in lockstep. */
  begin(): Promise<void>;
  /** Advance `n` frames of `dtMs` each; resolves when the last frame is rendered. */
  step(n?: number, dtMs?: number): Promise<void>;
  /** Join the lockstep (Robot Mode's simulation). Returns a function that leaves. */
  join(p: CaptureParticipant): () => void;
}

type TimerFn = (...args: unknown[]) => void;
interface Timer {
  id: number;
  due: number;
  fn: TimerFn;
  args: unknown[];
  interval: number | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function install(seed: number): CaptureApi {
  const nativeNow = performance.now.bind(performance);
  const nativeDateNow = Date.now.bind(Date);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const dateOrigin = nativeDateNow() - nativeNow();

  let stepping = false;
  let vt = 0;
  let frame = 0;
  const now = (): number => (stepping ? vt : nativeNow());

  Object.defineProperty(performance, 'now', { configurable: true, value: now });
  Date.now = () => Math.floor(dateOrigin + now());
  Math.random = mulberry32(seed);

  // ---- Timers: one virtual queue. In real time each timer also gets a native timeout that
  // sweeps the queue; while stepping only step() sweeps it.
  const timers = new Map<number, Timer>();
  let nextId = 1;
  const add = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean): number => {
    const id = nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    const f: TimerFn = typeof fn === 'function' ? (fn as TimerFn) : () => undefined;
    timers.set(id, { id, due: now() + delay, fn: f, args, interval: repeat ? Math.max(1, delay) : null });
    if (!stepping) nativeSetTimeout(sweep, delay);
    return id;
  };
  const clear = (id: unknown): void => {
    timers.delete(Number(id));
  };
  /** Fire due timers in due order (ties in creation order). Returns how many fired. */
  function fireDue(limit: number): number {
    let fired = 0;
    for (;;) {
      let best: Timer | null = null;
      for (const t of timers.values()) if (t.due <= limit && (!best || t.due < best.due || (t.due === best.due && t.id < best.id))) best = t;
      if (!best) return fired;
      if (best.interval !== null) best.due += best.interval;
      else timers.delete(best.id);
      fired++;
      try {
        best.fn(...best.args);
      } catch (err) {
        console.error(err);
      }
      if (fired > 10000) return fired;
    }
  }
  function sweep(): void {
    if (!stepping) fireDue(now());
  }
  const w = window as unknown as Record<string, unknown>;
  w.setTimeout = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, false);
  w.setInterval = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, true);
  w.clearTimeout = clear;
  w.clearInterval = clear;

  // ---- Animation frames: a queue the native rAF pumps in real time and step() pumps after.
  let rafQueue = new Map<number, FrameRequestCallback>();
  let rafId = 1;
  let pumpQueued = false;
  const runRaf = (ts: number): void => {
    const q = rafQueue;
    rafQueue = new Map();
    for (const cb of q.values()) {
      try {
        cb(ts);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const pump = (): void => {
    pumpQueued = false;
    if (stepping) return;
    runRaf(now());
  };
  w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = rafId++;
    rafQueue.set(id, cb);
    if (!stepping && !pumpQueued) {
      pumpQueued = true;
      nativeRaf(pump);
    }
    return id;
  };
  w.cancelAnimationFrame = (id: number): void => {
    rafQueue.delete(id);
  };

  // ---- CSS animations and transitions: paused, then posed at the virtual time on every step.
  const births = new WeakMap<Animation, number>();
  const poseAnimations = (first: boolean): void => {
    for (const a of document.getAnimations()) {
      let birth = births.get(a);
      if (birth === undefined) {
        // Already running when stepping began: keep its progress. New ones start at 0 now.
        const ct = first ? Number(a.currentTime ?? 0) : 0;
        birth = vt - ct;
        births.set(a, birth);
        a.pause();
      }
      a.currentTime = vt - birth;
    }
  };

  const macrotask = (): Promise<void> => new Promise((r) => nativeSetTimeout(r, 0));
  const participants = new Set<CaptureParticipant>();

  const api: CaptureApi = {
    get stepping() {
      return stepping;
    },
    get now() {
      return now();
    },
    get frame() {
      return frame;
    },
    async begin() {
      if (stepping) return;
      vt = nativeNow();
      stepping = true;
      frame = 0;
      for (const p of participants) await p.begin?.();
      poseAnimations(true);
    },
    async step(n = 1, dtMs = 1000 / 60) {
      if (!stepping) await api.begin();
      for (let i = 0; i < n; i++) {
        vt += dtMs;
        frame++;
        // Timers, then whatever their promises chain into (an awaited sleep() resumes in a
        // microtask that may set the next timer), a few rounds deep.
        for (let round = 0; round < 8; round++) {
          if (fireDue(vt) === 0 && round > 0) break;
          await macrotask();
        }
        for (const p of participants) await p.step(dtMs, vt);
        runRaf(vt);
        poseAnimations(false);
      }
      // Let the frame's own microtasks settle before the caller takes its screenshot.
      await macrotask();
    },
    join(p) {
      participants.add(p);
      if (stepping) void p.begin?.();
      return () => participants.delete(p);
    },
  };
  return api;
}

const params = new URLSearchParams(location.search);
/** The capture API when the page runs in capture mode, else null. */
export const capture: CaptureApi | null =
  import.meta.env.DEV && params.has('capture') ? install(Number(params.get('seed') ?? 1) || 1) : null;
if (capture) (window as unknown as { __capture: CaptureApi }).__capture = capture;
