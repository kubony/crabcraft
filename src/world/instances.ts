// Instanced vegetation with cell-level culling and distance LODs. Instances are bucketed into
// grid cells; each frame visible cells are packed into InstancedMesh buffers per LOD level, so
// every (level, part) is one draw call no matter how many instances it holds.
import * as THREE from 'three';

export interface LodPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
export interface LodLevel {
  /** Empty parts = draw nothing at this range (lets another field take over). */
  parts: LodPart[];
  /** Cells whose centre is closer than this use the level. */
  maxDist: number;
  castShadow?: boolean;
}

interface Cell {
  centre: THREE.Vector3;
  radius: number;
  mats: number[];
}

const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();

export class InstanceField {
  private cells = new Map<string, Cell>();
  private meshes: THREE.InstancedMesh[][] = [];
  private count = 0;
  readonly group = new THREE.Group();

  constructor(
    readonly name: string,
    readonly levels: LodLevel[],
    readonly cellSize = 40,
    /** Bounding radius of one instance (world units) for cell spheres. */
    readonly instanceRadius = 4,
  ) {
    this.group.name = name;
  }

  add(m: THREE.Matrix4): void {
    const x = m.elements[12];
    const y = m.elements[13];
    const z = m.elements[14];
    const i = Math.floor(x / this.cellSize);
    const j = Math.floor(z / this.cellSize);
    const key = `${i},${j}`;
    let c = this.cells.get(key);
    if (!c) {
      // Grid-cell centre (not the instance mean) so separate fields agree on LOD switches.
      c = { centre: new THREE.Vector3((i + 0.5) * this.cellSize, 0, (j + 0.5) * this.cellSize), radius: 0, mats: [] };
      this.cells.set(key, c);
    }
    c.mats.push(...m.elements);
    c.centre.y += y;
    this.count++;
  }

  get size(): number {
    return this.count;
  }

  build(): THREE.Group {
    for (const c of this.cells.values()) {
      const n = c.mats.length / 16;
      c.centre.y /= n;
      let r = 0;
      for (let i = 0; i < n; i++) {
        _v.set(c.mats[i * 16 + 12], c.mats[i * 16 + 13], c.mats[i * 16 + 14]);
        r = Math.max(r, _v.distanceTo(c.centre));
      }
      c.radius = r + this.instanceRadius;
    }
    this.meshes = this.levels.map((lvl) =>
      lvl.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, this.count));
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = lvl.castShadow ?? true;
        im.receiveShadow = true;
        im.visible = false;
        im.name = `${this.name}:${p.material.name}`;
        this.group.add(im);
        return im;
      }),
    );
    return this.group;
  }

  /** Pack visible cells into the LOD buffers. `keep` always includes cells this close (shadows). */
  update(camPos: THREE.Vector3, frustum: THREE.Frustum, keep = 20): void {
    const counts = this.levels.map(() => 0);
    const maxDist = this.levels[this.levels.length - 1].maxDist;
    for (const c of this.cells.values()) {
      // LOD by horizontal distance to the grid-cell centre (consistent across fields).
      const d = Math.hypot(c.centre.x - camPos.x, c.centre.z - camPos.z);
      if (d - c.radius > maxDist) continue;
      if (d - c.radius > keep) {
        _sphere.center.copy(c.centre);
        _sphere.radius = c.radius;
        if (!frustum.intersectsSphere(_sphere)) continue;
      }
      let li = this.levels.findIndex((l) => d < l.maxDist);
      if (li < 0) li = this.levels.length - 1;
      const meshes = this.meshes[li];
      if (!meshes.length) continue;
      const n = c.mats.length / 16;
      const at = counts[li];
      for (const im of meshes) (im.instanceMatrix.array as Float32Array).set(c.mats, at * 16);
      counts[li] = at + n;
    }
    this.meshes.forEach((meshes, li) => {
      for (const im of meshes) {
        im.count = counts[li];
        im.visible = counts[li] > 0;
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, counts[li] * 16);
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}

/** A cheap stylised pine for the far distance: trunk plus stacked cones, vertex coloured. */
export function lowPine(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colour = (g: THREE.BufferGeometry, c: THREE.Color, top?: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    const p = g.getAttribute('position');
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      y0 = Math.min(y0, p.getY(i));
      y1 = Math.max(y1, p.getY(i));
    }
    for (let i = 0; i < n; i++) {
      const t = (p.getY(i) - y0) / (y1 - y0 || 1);
      const col = top ? c.clone().lerp(top, t) : c;
      arr.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  parts.push(colour(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6).translate(0, 1.2, 0).toNonIndexed(), new THREE.Color('#4a2e1c')));
  const dark = new THREE.Color('#1e3a16');
  const light = new THREE.Color('#3f6a24');
  const tiers: [number, number, number][] = [
    [2.6, 3.4, 1.6],
    [2.1, 3.0, 3.3],
    [1.55, 2.6, 4.9],
    [1.0, 2.2, 6.3],
  ];
  for (const [r, h, y] of tiers) parts.push(colour(new THREE.ConeGeometry(r, h, 8, 1, true).translate(0, y + h / 2, 0).toNonIndexed(), dark, light));
  const merged = new THREE.BufferGeometry();
  const all = parts.map((g) => ({ p: g.getAttribute('position') as THREE.BufferAttribute, c: g.getAttribute('color') as THREE.BufferAttribute }));
  const total = all.reduce((a, b) => a + b.p.count, 0);
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const { p, c } of all) {
    pos.set(p.array as Float32Array, o * 3);
    col.set(c.array as Float32Array, o * 3);
    o += p.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeVertexNormals();
  return merged;
}
