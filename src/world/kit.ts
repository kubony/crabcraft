// Kit libraries (public/models/world/*.glb): every top-level node is one piece ("Wall_Plaster_Straight").
// StaticBatch merges many placed pieces into one mesh per material; Scatter builds instanced meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLTF } from '../core/assets';

export interface PiecePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
export interface Piece {
  name: string;
  parts: PiecePart[];
  box: THREE.Box3;
}

export class Kit {
  readonly pieces = new Map<string, Piece>();
  readonly materials = new Map<string, THREE.Material>();

  get(name: string): Piece {
    const p = this.pieces.get(name);
    if (!p) throw new Error(`kit piece missing: ${name}`);
    return p;
  }
  has(name: string): boolean {
    return this.pieces.has(name);
  }
  material(name: string): THREE.MeshStandardMaterial | null {
    return (this.materials.get(name) as THREE.MeshStandardMaterial | undefined) ?? null;
  }
}

/** Plain float attributes (de-quantised) so pieces from different files merge cleanly. */
function toFloat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color'] as const) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const size = name === 'color' ? 4 : a.itemSize;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      arr[i * size] = a.getX(i);
      if (size > 1) arr[i * size + 1] = a.getY(i);
      if (size > 2) arr[i * size + 2] = a.getZ(i);
      if (size > 3) arr[i * size + 3] = a.itemSize > 3 ? a.getW(i) : 1;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = geo.getIndex();
  if (idx) out.setIndex(Array.from(idx.array as ArrayLike<number>));
  return out;
}

export async function loadKit(path: string, kit = new Kit()): Promise<Kit> {
  const gltf = await loadGLTF(path);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  for (const holder of scene.children) {
    inv.copy(holder.matrixWorld).invert();
    const parts: PiecePart[] = [];
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      if (mats.length === 1) {
        const g = toFloat(m.geometry).applyMatrix4(local);
        parts.push({ geometry: g, material: register(kit, mats[0]) });
      } else {
        for (const grp of m.geometry.groups) {
          const sub = toFloat(m.geometry);
          const idx = sub.getIndex()!;
          const arr = (idx.array as Uint32Array).slice(grp.start, grp.start + grp.count);
          sub.setIndex(Array.from(arr));
          parts.push({ geometry: sub.applyMatrix4(local), material: register(kit, mats[grp.materialIndex ?? 0]) });
        }
      }
    });
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    kit.pieces.set(holder.name, { name: holder.name, parts, box });
  }
  return kit;
}

function register(kit: Kit, mat: THREE.Material): THREE.Material {
  const have = kit.materials.get(mat.name);
  if (have) return have;
  kit.materials.set(mat.name, mat);
  return mat;
}

export interface PlaceOptions {
  /** Replace a material by name for this placement (stained glass, rusted variants...). */
  override?: Record<string, THREE.Material>;
  /** Skip parts using these material names. */
  skip?: string[];
  castShadow?: boolean;
}

/** Collects placed pieces and merges them into one mesh per material (and shadow flag). */
export class StaticBatch {
  private lists = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }[]>();
  constructor(readonly kit: Kit, readonly name: string) {}

  add(piece: string, m: THREE.Matrix4, opts: PlaceOptions = {}): void {
    const p = this.kit.get(piece);
    for (const part of p.parts) {
      if (opts.skip?.includes(part.material.name)) continue;
      const mat = opts.override?.[part.material.name] ?? part.material;
      this.addGeometry(part.geometry, mat, m, opts.castShadow ?? true);
    }
  }

  addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4 | null, castShadow = true): void {
    let entry = this.lists.get(mat);
    if (!entry) {
      entry = [
        { geos: [], shadow: true },
        { geos: [], shadow: false },
      ];
      this.lists.set(mat, entry);
    }
    const g = geo.clone();
    if (m) g.applyMatrix4(m);
    entry[castShadow ? 0 : 1].geos.push(g);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [mat, entries] of this.lists) {
      for (const e of entries) {
        if (!e.geos.length) continue;
        const geo = mergeGeometries(harmonise(e.geos), false);
        if (!geo) continue;
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `${this.name}:${mat.name}`;
        mesh.castShadow = e.shadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    this.lists.clear();
    return group;
  }
}

/** Give every geometry the same attribute set so mergeGeometries accepts them. */
export function harmonise(geos: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const want = new Set<string>();
  for (const g of geos) for (const k of Object.keys(g.attributes)) want.add(k);
  for (const g of geos) {
    const n = g.getAttribute('position').count;
    for (const k of want) {
      if (g.getAttribute(k)) continue;
      const size = k === 'color' ? 4 : k === 'uv' ? 2 : 3;
      const arr = new Float32Array(n * size);
      if (k === 'color') arr.fill(1);
      if (k === 'normal') for (let i = 0; i < n; i++) arr[i * 3 + 1] = 1;
      g.setAttribute(k, new THREE.BufferAttribute(arr, size));
    }
    // Colour may be RGB in some sources.
    const c = g.getAttribute('color');
    if (c && c.itemSize === 3) {
      const arr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        arr[i * 4] = c.getX(i);
        arr[i * 4 + 1] = c.getY(i);
        arr[i * 4 + 2] = c.getZ(i);
        arr[i * 4 + 3] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 4));
    }
    if (!g.getIndex()) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
  }
  return geos;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
/** Matrix from position, yaw (and optional pitch/roll) and uniform or vector scale. */
export function trs(x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, pitch = 0, roll = 0): THREE.Matrix4 {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.copy(scale);
  return _m.clone().compose(_p, _q, _s);
}

/**
 * Instanced scattering of kit pieces: one BatchedMesh per material holds every piece and every
 * instance using it, with per-instance frustum culling (also against the shadow camera).
 */
export class Scatter {
  private items = new Map<string, THREE.Matrix4[]>();
  constructor(readonly kit: Kit, readonly name: string) {}

  add(piece: string, m: THREE.Matrix4): void {
    let list = this.items.get(piece);
    if (!list) {
      list = [];
      this.items.set(piece, list);
    }
    list.push(m.clone());
  }

  build(opts: { castShadow?: boolean; materialFor?: (m: THREE.Material) => THREE.Material } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    const byMat = new Map<THREE.Material, { geo: THREE.BufferGeometry; mats: THREE.Matrix4[] }[]>();
    for (const [piece, mats] of this.items) {
      for (const part of this.kit.get(piece).parts) {
        let l = byMat.get(part.material);
        if (!l) byMat.set(part.material, (l = []));
        l.push({ geo: part.geometry.clone(), mats });
      }
    }
    for (const [mat, list] of byMat) {
      harmonise(list.map((e) => e.geo));
      let inst = 0;
      let verts = 0;
      let idx = 0;
      for (const e of list) {
        inst += e.mats.length;
        verts += e.geo.getAttribute('position').count;
        idx += e.geo.getIndex()!.count;
      }
      const material = opts.materialFor ? opts.materialFor(mat) : mat;
      const bm = new THREE.BatchedMesh(inst, verts, idx, material);
      bm.sortObjects = false;
      bm.perObjectFrustumCulled = true;
      for (const e of list) {
        const gid = bm.addGeometry(e.geo);
        for (const m of e.mats) bm.setMatrixAt(bm.addInstance(gid), m);
      }
      bm.computeBoundingBox();
      bm.computeBoundingSphere();
      bm.castShadow = opts.castShadow ?? true;
      bm.receiveShadow = true;
      bm.name = `${this.name}:${mat.name}`;
      group.add(bm);
    }
    return group;
  }

  get count(): number {
    let n = 0;
    for (const l of this.items.values()) n += l.length;
    return n;
  }
}
