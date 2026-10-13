// Flagstone plaza under the dais. Irregular stones (grid Voronoi) with mortar joints; the disc
// fades out radially so it melts into the backdrop painting.
import * as THREE from 'three';
import { clamp01, dataTexture, fbmField, hash2, lerp, normalFromHeight, sampleField, smoothstep } from './textures';

export interface Ground {
  mesh: THREE.Mesh;
  dispose(): void;
}

let cache: { map: Uint8Array; orm: Uint8Array; normal: Uint8Array; alpha: Uint8Array } | null = null;
const N = 512;
const A = 256;

export function createGround(radius = 9): Ground {
  cache ??= buildGround();
  const tMap = dataTexture(cache.map, N, N, true, true);
  const tOrm = dataTexture(cache.orm, N, N, false, true);
  const tNrm = dataTexture(cache.normal, N, N, false, true);
  const rep = radius / 1.4;
  for (const t of [tMap, tOrm, tNrm]) t.repeat.set(rep, rep);
  const tAlpha = dataTexture(cache.alpha, A, A, false);

  const geo = new THREE.CircleGeometry(radius, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: tMap,
    roughnessMap: tOrm,
    aoMap: tOrm,
    normalMap: tNrm,
    normalScale: new THREE.Vector2(1.2, 1.2),
    alphaMap: tAlpha,
    transparent: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.2,
    color: new THREE.Color(0.86, 0.68, 0.52),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = -5;
  mesh.name = 'ground';
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
      for (const t of [tMap, tOrm, tNrm, tAlpha]) t.dispose();
      mesh.removeFromParent();
    },
  };
}

function buildGround() {
  const CELLS = 6; // stones per texture side
  const noise = fbmField(256, 6, 4, 41);
  const map = new Uint8Array(N * N * 4);
  const orm = new Uint8Array(N * N * 4);
  const height = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * CELLS;
      const v = (y / N) * CELLS;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let d1 = 9;
      let d2 = 9;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % CELLS) + CELLS) % CELLS;
          const wy = ((gy % CELLS) + CELLS) % CELLS;
          const px = gx + 0.15 + 0.7 * hash2(wx, wy, 1);
          const py = gy + 0.15 + 0.7 * hash2(wx, wy, 2);
          const d = Math.hypot(u - px, v - py);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = wy * CELLS + wx;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1; // 0 on the joint
      const joint = 1 - smoothstep(0.02, 0.07, edge);
      const n = sampleField(noise, 256, x / N, y / N);
      const tone = 0.85 + 0.3 * hash2(id, 9, 4);
      const warm = hash2(id, 3, 8);
      const base = [lerp(0.5, 0.58, warm), lerp(0.43, 0.47, warm), lerp(0.36, 0.38, warm)];
      const i = (y * N + x) * 4;
      for (let c = 0; c < 3; c++) {
        let col = base[c] * tone * (0.85 + 0.3 * n);
        col = lerp(col, 0.12, joint * 0.85);
        map[i + c] = Math.round(clamp01(col) * 255);
      }
      map[i + 3] = 255;
      height[y * N + x] = 0.6 + 0.12 * n + 0.15 * smoothstep(0.05, 0.25, edge) - joint * 0.5;
      orm[i] = Math.round((1 - joint * 0.6) * 255);
      orm[i + 1] = Math.round(clamp01(0.86 + 0.1 * n) * 255);
      orm[i + 2] = 0;
      orm[i + 3] = 255;
    }
  }

  // Radial fade: opaque near the dais, gone by the rim.
  const alpha = new Uint8Array(A * A * 4);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < A; x++) {
      const r = Math.hypot(x / (A - 1) - 0.5, y / (A - 1) - 0.5) * 2;
      const a = 1 - smoothstep(0.35, 0.95, r);
      const i = (y * A + x) * 4;
      alpha[i] = alpha[i + 1] = alpha[i + 2] = Math.round(a * 255);
      alpha[i + 3] = 255;
    }
  }
  return { map, orm, normal: normalFromHeight(height, N, N, 2.4), alpha };
}
