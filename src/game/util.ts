// Small math and randomness helpers shared by gameplay modules.
import * as THREE from 'three';

export const TAU = Math.PI * 2;

/** Deterministic PRNG so the town looks the same on every visit. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export function pick<T>(arr: readonly T[], r: () => number = Math.random): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Shortest signed difference a - b wrapped to [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Frame-rate independent exponential smoothing. */
export function damp(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

export function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  return cur + angleDiff(target, cur) * (1 - Math.exp(-lambda * dt));
}

/** Rotate toward a target angle at a maximum rate (rad/s). */
export function turnToward(cur: number, target: number, rate: number, dt: number): number {
  const d = angleDiff(target, cur);
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

/** Yaw (0 = +Z) that looks from (ax, az) toward (bx, bz). */
export function yawTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, bz - az);
}

export function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Linear float colour from a hex string, multiplied for HDR glow. */
export function hdr(hex: THREE.ColorRepresentation, intensity = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

/** Tiny event emitter with typed payloads. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as (p: never) => void);
    return () => s!.delete(fn as (p: never) => void);
  }
  emit<K extends keyof E>(k: K, p: E[K]): void {
    const s = this.map.get(k);
    if (s) for (const fn of [...s]) (fn as (p: E[K]) => void)(p);
  }
  clear(): void {
    this.map.clear();
  }
}
