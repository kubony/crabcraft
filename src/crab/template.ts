// Loads public/models/crab/jumper.glb once and turns it into what every crab shares:
// the kinematic link table, and one skinned geometry per material class (rigid skinning, one bone
// per moving link) so a whole crab draws in about six calls however many links it has.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLTF } from '../core/assets';
import { JOINT_NAMES, type JointName } from './types';

export type PartClass = 'shell' | 'dark' | 'visor' | 'metal' | 'joint' | 'rubber';
export const PART_CLASSES: PartClass[] = ['shell', 'dark', 'visor', 'metal', 'joint', 'rubber'];

export interface LinkDef {
  name: string;
  index: number;
  /** Parent link index, -1 for base_link. */
  parent: number;
  /** Joint origin in the parent link frame (robot metres, game axes). */
  offset: THREE.Vector3;
  /** Joint axis in the link frame (unit), null for fixed links. */
  axis: THREE.Vector3 | null;
  joint: JointName | null;
  lower: number;
  upper: number;
  /** Bone that carries this link's vertices (its own if it moves, else the parent's). */
  bone: number;
}

export interface TemplateInfo {
  standZ: number;
  shellTopHome: number;
  faceRect: { x0: number; x1: number; y0: number; y1: number; z: number };
  feetHome: Record<string, [number, number, number]>;
}

export interface CrabTemplate {
  links: LinkDef[];
  linkByName: Map<string, LinkDef>;
  /** Link index for each bone. Bone 0 is base_link. */
  boneLinks: number[];
  boneInverses: THREE.Matrix4[];
  /** Link index of each joint in JOINT_NAMES order. */
  jointLinks: number[];
  info: TemplateInfo;
  /** Merged skinned geometry per class; links listed in `without` are left out (cached). */
  parts(without?: readonly string[]): Map<PartClass, THREE.BufferGeometry>;
  /** LED screen surface in the display_module_link frame, uv across the window. */
  face: THREE.BufferGeometry;
  /** Rest-pose (q = 0) frame of every link relative to base_link. */
  restMatrix: THREE.Matrix4[];
  /**
   * Far level of detail (jumper-lod.glb, about a sixth of the triangles), same classes and
   * skinning as parts(); null when the file is missing.
   */
  lodParts: ((without?: readonly string[]) => Map<PartClass, THREE.BufferGeometry>) | null;
  /** Every LOD class merged into one geometry: the crab's shadow caster (one draw, 11.6k tris). */
  lodShadow: ((without?: readonly string[]) => THREE.BufferGeometry) | null;
}

const URL = 'models/crab/jumper.glb';
const LOD_URL = 'models/crab/jumper-lod.glb';
let pending: Promise<CrabTemplate> | null = null;

export function loadCrabTemplate(): Promise<CrabTemplate> {
  if (!pending) pending = build();
  return pending;
}

async function build(): Promise<CrabTemplate> {
  const lodGltf = loadGLTF(LOD_URL).catch(() => null);
  const gltf = await loadGLTF(URL);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const linkNodes: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData.link) linkNodes.push(o);
  });
  // Parents before children (traverse is depth first from the root, so this holds already).
  const index = new Map<THREE.Object3D, number>();
  linkNodes.forEach((o, i) => index.set(o, i));

  const links: LinkDef[] = [];
  const boneLinks: number[] = [];
  for (const [i, o] of linkNodes.entries()) {
    const ud = o.userData as { link: string; joint?: string; axis?: number[]; lower?: number; upper?: number };
    let p = o.parent;
    while (p && !index.has(p)) p = p.parent;
    const parent = p ? index.get(p)! : -1;
    const moving = !!ud.joint;
    const def: LinkDef = {
      name: ud.link,
      index: i,
      parent,
      offset: o.position.clone(),
      axis: moving ? new THREE.Vector3().fromArray(ud.axis!).normalize() : null,
      joint: moving ? (ud.joint as JointName) : null,
      lower: ud.lower ?? 0,
      upper: ud.upper ?? 0,
      bone: -1,
    };
    if (parent < 0 || moving) {
      def.bone = boneLinks.length;
      boneLinks.push(i);
    } else {
      def.bone = links[parent].bone;
    }
    links.push(def);
  }
  const linkByName = new Map(links.map((l) => [l.name, l]));
  const jointLinks = JOINT_NAMES.map((j) => {
    const l = links.find((k) => k.joint === j);
    if (!l) throw new Error(`jumper.glb has no link for ${j}`);
    return l.index;
  });

  // Rest frames relative to base_link (the GLB root is base_link at the origin).
  const restMatrix = linkNodes.map((o) => o.matrixWorld.clone());
  const boneInverses = boneLinks.map((li) => restMatrix[li].clone().invert());

  // Per-link, per-class geometry pieces in model space with rigid skin attributes.
  const pieces = new Map<string, Map<PartClass, THREE.BufferGeometry[]>>();
  let face: THREE.BufferGeometry | null = null;
  const tmpN = new THREE.Matrix3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let p: THREE.Object3D | null = mesh.parent;
    while (p && !index.has(p)) p = p.parent;
    if (!p) return;
    const link = links[index.get(p)!];
    const mat = mesh.material as THREE.Material;
    if (mat.name === 'face') {
      const rel = p.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
      face = dequantize(mesh.geometry, rel, tmpN, true);
      return;
    }
    const cls = mat.name as PartClass;
    if (!PART_CLASSES.includes(cls)) return;
    const g = dequantize(mesh.geometry, mesh.matrixWorld, tmpN, false);
    skinTo(g, link.bone);
    let byCls = pieces.get(link.name);
    if (!byCls) pieces.set(link.name, (byCls = new Map()));
    const list = byCls.get(cls) ?? [];
    list.push(g);
    byCls.set(cls, list);
  });
  if (!face) throw new Error('jumper.glb has no face_screen');

  const base = linkNodes[0].userData as Record<string, unknown>;
  const parse = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
  const info: TemplateInfo = {
    standZ: Number(base.standZ),
    shellTopHome: Number(base.shellTopHome),
    faceRect: parse(base.faceRect),
    feetHome: parse(base.feetHome),
  };

  const parts = mergedParts(pieces, '');

  // Far LOD: the same link tree, simplified; pieces go to the main template's bones by link name.
  let lodParts: CrabTemplate['lodParts'] = null;
  let lodShadow: CrabTemplate['lodShadow'] = null;
  const lod = await lodGltf;
  if (lod) {
    lod.scene.updateMatrixWorld(true);
    const lodPieces = new Map<string, Map<PartClass, THREE.BufferGeometry[]>>();
    lod.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let p: THREE.Object3D | null = mesh.parent;
      while (p && !p.userData.link) p = p.parent;
      const link = p ? linkByName.get(p.userData.link as string) : undefined;
      const cls = (mesh.material as THREE.Material).name as PartClass;
      if (!link || !PART_CLASSES.includes(cls)) return;
      const g = creased(dequantize(mesh.geometry, mesh.matrixWorld, tmpN, false));
      skinTo(g, link.bone);
      let byCls = lodPieces.get(link.name);
      if (!byCls) lodPieces.set(link.name, (byCls = new Map()));
      const list = byCls.get(cls) ?? [];
      list.push(g);
      byCls.set(cls, list);
    });
    if (lodPieces.size) {
      const lp = mergedParts(lodPieces, '-lod');
      lodParts = lp;
      const shadowCache = new Map<string, THREE.BufferGeometry>();
      lodShadow = (without: readonly string[] = []) => {
        const key = [...without].sort().join(',');
        let g = shadowCache.get(key);
        if (!g) {
          const list = [...lp(without).values()].map((geo) => {
            const c = new THREE.BufferGeometry();
            for (const name of ['position', 'skinIndex', 'skinWeight']) c.setAttribute(name, geo.getAttribute(name));
            return c;
          });
          g = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
          g.name = `crab-shadow${key ? `-without-${key}` : ''}`;
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.45);
          shadowCache.set(key, g);
        }
        return g;
      };
    }
  }

  return {
    links,
    linkByName,
    boneLinks,
    boneInverses,
    jointLinks,
    info,
    parts,
    face,
    restMatrix,
    lodParts,
    lodShadow,
  };
}

/** Rigid skinning: every vertex follows one bone. */
function skinTo(g: THREE.BufferGeometry, bone: number): void {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    si[v * 4] = bone;
    sw[v * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

/** Normals for the simplified LOD (it ships without them): smooth, split at edges over 40 degrees. */
function creased(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // toCreasedNormals hashes positions at 0.01 units; work in millimetres so nearby vertices stay apart.
  g.scale(1000, 1000, 1000);
  const out = toCreasedNormals(g, THREE.MathUtils.degToRad(40));
  out.scale(0.001, 0.001, 0.001);
  return out;
}

/** One merged skinned geometry per material class, cached per set of left-out links. */
function mergedParts(pieces: Map<string, Map<PartClass, THREE.BufferGeometry[]>>, suffix: string) {
  const cache = new Map<string, Map<PartClass, THREE.BufferGeometry>>();
  return (without: readonly string[] = []) => {
    const key = [...without].sort().join(',');
    let out = cache.get(key);
    if (out) return out;
    out = new Map();
    for (const cls of PART_CLASSES) {
      const list: THREE.BufferGeometry[] = [];
      for (const [name, byCls] of pieces) {
        if (without.includes(name)) continue;
        list.push(...(byCls.get(cls) ?? []));
      }
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`could not merge ${cls}${suffix}`);
      merged.name = `crab-${cls}${suffix}${key ? `-without-${key}` : ''}`;
      // Generous bounds: the rig poses far from the bind pose, culling uses the mesh sphere.
      merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.45);
      out.set(cls, merged);
    }
    cache.set(key, out);
    return out;
  };
}

/** Float copy of a (possibly quantized) glTF geometry, transformed by m, non-indexed kept indexed. */
function dequantize(src: THREE.BufferGeometry, m: THREE.Matrix4, nm: THREE.Matrix3, keepUv: boolean): THREE.BufferGeometry {
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const n = pos.count;
  const p = new Float32Array(n * 3);
  const q = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  nm.getNormalMatrix(m);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    p[i * 3] = v.x;
    p[i * 3 + 1] = v.y;
    p[i * 3 + 2] = v.z;
    if (nor) {
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      q[i * 3] = v.x;
      q[i * 3 + 1] = v.y;
      q[i * 3 + 2] = v.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (nor) g.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  if (keepUv && src.attributes.uv) {
    const uv = src.attributes.uv;
    const u = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      u[i * 2] = uv.getX(i);
      // glTF stores v top-down; the face shader wants v = 0 at the bottom of the window.
      u[i * 2 + 1] = 1 - uv.getY(i);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  return g;
}
