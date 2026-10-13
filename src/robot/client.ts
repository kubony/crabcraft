// Page side of the simulation worker: boots it, forwards input, keeps the latest frame.
import mujocoWasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { FrameMsg, FromWorker, PadFrame, ReadyInfo, ToWorker } from './protocol';

export interface Progress {
  loaded: number;
  total: number;
  label: string;
}

export class SimClient {
  private worker: Worker;
  info: ReadyInfo | null = null;
  frame: FrameMsg | null = null;
  /** Frames received since start, for the HUD's transition log. */
  private frameListeners = new Set<(f: FrameMsg) => void>();
  readonly ready: Promise<ReadyInfo>;
  onProgress: ((p: Progress) => void) | null = null;

  constructor(baseUrl: string) {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module', name: 'robot-sim' });
    this.ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'frame') {
          this.frame = m;
          for (const fn of this.frameListeners) fn(m);
        } else if (m.type === 'progress') {
          this.onProgress?.(m);
        } else if (m.type === 'ready') {
          this.info = m.info;
          resolve(m.info);
        } else if (m.type === 'error') {
          reject(new Error(m.message));
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
  }

  send(m: ToWorker): void {
    this.worker.postMessage(m);
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
    this.send({ type: 'stop' });
    // The worker closes itself; terminate as a backstop.
    setTimeout(() => this.worker.terminate(), 200);
  }
}
