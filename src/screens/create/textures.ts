// Procedural texture helpers for the character creation stage: seeded noise, tileable fbm,
// height-to-normal conversion and DataTexture wrappers. Everything runs once at screen entry.
import * as THREE from 'three';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash to 0..1. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Tileable fractal value noise, n x n, normalised to 0..1. `cells` is the lattice count of the
 * first octave; each octave doubles it, so the field wraps seamlessly at every octave.
 */
export function fbmField(n: number, cells: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = hash2(i % c, Math.floor(i / c), seed + o * 101);
    const step = c / n;
    for (let y = 0; y < n; y++) {
      const fy = y * step;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % c) * c;
      const r1 = ((y0 + 1) % c) * c;
      for (let x = 0; x < n; x++) {
        const fx = x * step;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % c;
        const xb = (x0 + 1) % c;
        const a = lattice[r0 + xa] + (lattice[r0 + xb] - lattice[r0 + xa]) * sx;
        const b = lattice[r1 + xa] + (lattice[r1 + xb] - lattice[r1 + xa]) * sx;
        out[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Bilinear sample of a square tileable field with wrap-around, u/v in any range. */
export function sampleField(f: Float32Array, n: number, u: number, v: number): number {
  const x = (((u % 1) + 1) % 1) * n;
  const y = (((v % 1) + 1) % 1) * n;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const a = f[y0 * n + x0] + (f[y0 * n + x1] - f[y0 * n + x0]) * tx;
  const b = f[y1 * n + x0] + (f[y1 * n + x1] - f[y1 * n + x0]) * tx;
  return a + (b - a) * ty;
}

/** Tangent-space normal map from a height field (0..1 heights), RGBA8. */
export function normalFromHeight(h: Float32Array, w: number, hgt: number, strength: number, wrapX = true, wrapY = true): Uint8Array {
  const out = new Uint8Array(w * hgt * 4);
  const at = (x: number, y: number) => {
    if (wrapX) x = (x + w) % w;
    else x = Math.max(0, Math.min(w - 1, x));
    if (wrapY) y = (y + hgt) % hgt;
    else y = Math.max(0, Math.min(hgt - 1, y));
    return h[y * w + x];
  };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel. Texture v runs bottom-to-top in three.js (flipY = false for DataTexture means row 0
      // is v = 0), so +y in the array is +v in UV space.
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

export function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean, repeat = false): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Read a 2D canvas back as per-channel float masks (0..1). Row 0 of the result is the canvas bottom. */
export function canvasChannels(canvas: HTMLCanvasElement): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h).data;
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const i = (src + x) * 4;
      const o = y * w + x;
      r[o] = img[i] / 255;
      g[o] = img[i + 1] / 255;
      b[o] = img[i + 2] / 255;
    }
  }
  return { r, g, b };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Soft radial sprite, white with alpha falloff; used for glows, contact shadows and particles. */
export function radialSprite(size = 128, inner = 0, stops: [number, number][] = [[0, 1], [1, 0]]): THREE.CanvasTexture {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, inner, size / 2, size / 2, size / 2);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
