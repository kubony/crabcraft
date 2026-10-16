// Page side of the simulation worker: boots it, forwards input, keeps the latest frame.
import mujocoWasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { FrameMsg, FromWorker, PadFrame, ReadyInfo, ToWorker } from './protocol';
import { capture } from '../capture/clock';

export interface Progress {
  loaded: number;
  total: number;
  label: string;
}

/** What frames report once: kept from every frame until the page takes them. */
export interface FrameEvents {
  transitions: FrameMsg['transitions'];
  autoLeft: FrameMsg['autoLeft'];
  routineEvents: FrameMsg['routineEvents'];
}

export class SimClient {
  private worker: Worker;
  info: ReadyInfo | null = null;
  /** The latest frame. Its one-off reports are also queued for drainEvents(). */
  frame: FrameMsg | null = null;
  private events: FrameEvents = { transitions: [], autoLeft: [], routineEvents: [] };
  /** Frames received since start, for the HUD's transition log. */
  private frameListeners = new Set<(f: FrameMsg) => void>();
  readonly ready: Promise<ReadyInfo>;
  onProgress: ((p: Progress) => void) | null = null;
  /** A policy that streamed in after start, or failed to. */
  onPolicy: ((mode: string, ok: boolean, checked: number, mismatched: string[]) => void) | null = null;
  /** Policies that have streamed in so far, for a listener attached late. */
  readonly policies = new Map<string, { ok: boolean; checked: number; mismatched: string[] }>();
  /** A fault after start (the loop keeps running). */
  onFault: ((message: string) => void) | null = null;
  // Capture mode (dev only): the page steps the simulation in lockstep with its own frames.
  private speed = 1;
  private paused = false;
  private simTarget = 0;
  private resync = true;
  private advanceId = 0;
  private advancing = new Map<number, (simTime: number) => void>();
  private leaveCapture: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module', name: 'robot-sim' });
    this.ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'frame') {
          this.frame = m;
          // The page renders the latest frame only; the transitions, presses and routine moments
          // of the frames in between must not be lost with them.
          this.events.transitions.push(...m.transitions);
          this.events.autoLeft.push(...m.autoLeft);
          this.events.routineEvents.push(...m.routineEvents);
          for (const fn of this.frameListeners) fn(m);
        } else if (m.type === 'progress') {
          this.onProgress?.(m);
        } else if (m.type === 'ready') {
          this.info = m.info;
          resolve(m.info);
        } else if (m.type === 'policy') {
          this.policies.set(m.mode, { ok: m.ok, checked: m.digests.checked, mismatched: m.digests.mismatched });
          this.onPolicy?.(m.mode, m.ok, m.digests.checked, m.digests.mismatched);
        } else if (m.type === 'advanced') {
          this.advancing.get(m.id)?.(m.simTime);
          this.advancing.delete(m.id);
        } else if (m.type === 'error') {
          if (this.info) this.onFault?.(m.message);
          else reject(new Error(m.message));
        }
      };
      this.worker.onerror = (e) => reject(new Error(e.message || 'robot worker failed to start'));
    });
    this.send({
      type: 'init',
      baseUrl,
      mujocoWasmUrl: new URL(mujocoWasmUrl, location.href).href,
      ortWasmUrl: new URL(ortWasmUrl, location.href).href,
    });
    if (capture) {
      this.leaveCapture = capture.join({
        begin: async () => {
          await this.ready;
          this.send({ type: 'capture', on: true });
          this.resync = true;
        },
        step: (dtMs, nowMs) => this.advance(dtMs, nowMs),
      });
    }
  }

  send(m: ToWorker): void {
    if (m.type === 'speed') this.speed = Math.max(0.05, Math.min(2, m.value));
    else if (m.type === 'pause') this.paused = m.paused;
    else if (m.type === 'reset') this.resync = true;
    this.worker.postMessage(m);
  }

  /** Capture mode: tick the simulation by the page's step, wait for the frame. */
  private async advance(dtMs: number, nowMs: number): Promise<void> {
    if (!this.info) return;
    const ask = (to: number) =>
      new Promise<number>((resolve) => {
        const id = ++this.advanceId;
        this.advancing.set(id, resolve);
        this.send({ type: 'advance', to, now: nowMs, id });
      });
    // Where the simulation is now (after a reset or when stepping begins): an advance to 0 ticks nothing.
    if (this.resync) {
      this.resync = false;
      this.simTarget = await ask(0);
    }
    if (!this.paused) this.simTarget += (dtMs / 1000) * this.speed;
    await ask(this.simTarget);
  }

  /** Every transition, host press and routine moment reported since the last call. */
  drainEvents(): FrameEvents {
    const e = this.events;
    this.events = { transitions: [], autoLeft: [], routineEvents: [] };
    return e;
  }

  key(code: string, down: boolean, repeat = false): void {
    this.send({ type: 'key', code, down, repeat });
  }

  pad(p: PadFrame | null): void {
    this.send({ type: 'pad', pad: p });
  }

  onFrame(fn: (f: FrameMsg) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  stop(): void {
    this.leaveCapture?.();
    for (const done of this.advancing.values()) done(0);
    this.advancing.clear();
    this.send({ type: 'stop' });
    // The worker closes itself; terminate as a backstop.
    setTimeout(() => this.worker.terminate(), 200);
  }
}
