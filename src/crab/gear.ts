// Race gear, crests, class weapons, NPC extras and enemy armour from the gear GLBs built by
// tools/build_gear.py. Each GLB top-level node is one piece; its extras say which link (or claw
// socket) it rides on. Pieces are cloned per crab (geometry shared), materials are shared through
// the material cache and tinted where the material name ends in "-tint".
import * as THREE from 'three';
import { loadGLTF } from '../core/assets';
import { RACES } from '../data/races';
import { gearMaterial } from './materials';
import type { JumperRig } from './rig';
import type { ClassId, CrabSpec, RaceId, SocketName } from './types';

export type EnemyKind = 'scrapling' | 'scavenger' | 'corrodius';

const FILES = {
  human: 'models/gear/human-gear.glb',
  orc: 'models/gear/orc-gear.glb',
  dwarf: 'models/gear/dwarf-gear.glb',
  undead: 'models/gear/undead-gear.glb',
  nightelf: 'models/gear/nightelf-gear.glb',
  tauren: 'models/gear/tauren-gear.glb',
  weapons: 'models/weapons/class-weapons.glb',
  extras: 'models/gear/npc-extras.glb',
  enemies: 'models/gear/enemy-gear.glb',
} as const;

interface Piece {
  node: THREE.Object3D;
  attach: string;
  kind: 'always' | 'crest' | 'weapon' | 'extra' | 'enemy' | 'under-hat';
  id: string;
  top: number;
}

const pieces = new Map<keyof typeof FILES, Piece[]>();
let loading: Promise<void> | null = null;

/** Loads every gear file once (about 200 KB together). */
export function preloadGear(): Promise<void> {
  if (!loading) {
    loading = Promise.all(
      (Object.keys(FILES) as (keyof typeof FILES)[]).map(async (k) => {
        const gltf = await loadGLTF(FILES[k]);
        const list: Piece[] = [];
        for (const node of gltf.scene.children) {
          const ud = node.userData as { attach?: string; kind?: Piece['kind']; id?: string; top?: number };
          if (!ud.attach || !ud.kind) continue;
          node.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
            }
          });
          list.push({ node, attach: ud.attach, kind: ud.kind, id: ud.id ?? node.name, top: ud.top ?? 0 });
        }
        pieces.set(k, list);
      }),
    ).then(() => undefined);
  }
  return loading;
}

/** Cloth/heraldry tint per race and sex ("default gear tint"). */
const GEAR_TINT: Record<RaceId, [string, string]> = {
  human: ['#2747a8', '#3a78c8'],
  orc: ['#7a2a1a', '#8a4a1e'],
  dwarf: ['#2c5a86', '#6a2a5a'],
  undead: ['#3c3448', '#4a3a3a'],
  nightelf: ['#4a3a8a', '#2a6a7a'],
  tauren: ['#8a5a2a', '#a8402a'],
};

const CLASS_WEAPONS: Record<ClassId, string[]> = {
  warrior: ['sword', 'shield'],
  mage: ['staff'],
  priest: ['lantern', 'hymnal'],
};

/** Hats replace the crest. */
const HATS = new Set(['captain-hat', 'chef-hat']);

/**
 * How each weapon should sit at the HOME pose, in the body frame (game axes): the weapon's +Y
 * (handle/blade) and +Z (face) directions for a weapon in the LEFT claw; the right claw mirrors X.
 * The mount rotation inside the claw socket is solved from the claw's HOME orientation, so the
 * weapon then follows the claw through every motion clip.
 */
const WEAPON_POSE: Record<string, { y: [number, number, number]; z: [number, number, number]; offset?: [number, number, number] }> = {
  sword: { y: [-0.12, 0.88, 0.45], z: [0.0, -0.45, 0.88] },
  shield: { y: [0.0, 1.0, 0.0], z: [0.55, 0.05, 0.84], offset: [0, 0.015, 0] },
  staff: { y: [-0.08, 1.0, 0.12], z: [0, 0, 1] },
  lantern: { y: [0.0, 1.0, 0.05], z: [0, 0, 1] },
  hymnal: { y: [0.0, 0.85, -0.5], z: [0.25, 0.5, 0.83], offset: [0, 0.02, 0] },
};

function mountRotation(rig: JumperRig, socket: SocketName, id: string): THREE.Quaternion | null {
  const pose = WEAPON_POSE[id];
  if (!pose) return null;
  const left = socket === 'clawL';
  const sx = left ? 1 : -1;
  const y = new THREE.Vector3(pose.y[0] * sx, pose.y[1], pose.y[2]).normalize();
  const z0 = new THREE.Vector3(pose.z[0] * sx, pose.z[1], pose.z[2]);
  const x = new THREE.Vector3().crossVectors(y, z0).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const sock = rig.homeSocketQuaternion(socket);
  return sock.invert().multiply(want);
}

function instantiate(p: Piece, tint: string): THREE.Object3D {
  const o = p.node.clone(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material;
    m.material = gearMaterial(src, src.name.endsWith('-tint') ? tint : null);
  });
  return o;
}

function find(file: keyof typeof FILES, pred: (p: Piece) => boolean): Piece[] {
  return (pieces.get(file) ?? []).filter(pred);
}

export async function dressCrab(
  rig: JumperRig,
  spec: CrabSpec,
  extras: string[],
  enemy: EnemyKind | null,
  current: () => boolean,
): Promise<void> {
  await preloadGear();
  if (!current()) return;
  for (const o of rig.gearMeshes) o.removeFromParent();
  rig.gearMeshes.length = 0;
  rig.gearDetail.length = 0;

  const add = (p: Piece, tint: string, socket?: SocketName) => {
    const o = instantiate(p, tint);
    const parent = socket ? rig.getSocket(socket) : rig.linkNode(p.attach);
    if (socket) {
      const q = mountRotation(rig, socket, p.id);
      if (q) o.quaternion.copy(q);
      const off = WEAPON_POSE[p.id]?.offset;
      if (off) o.position.fromArray(off);
    }
    parent.add(o);
    rig.gearMeshes.push(o);
    return o;
  };

  let top = 0;
  const shellTop = 0.0719;
  if (enemy) {
    for (const p of find('enemies', (p) => p.id === enemy)) {
      add(p, '#6a3a20');
      if (p.attach === 'base_link') top = Math.max(top, p.top - shellTop);
    }
    rig.face.setStyle({
      color: rig.look.led,
      female: false,
      flicker: rig.look.flicker,
      intensity: rig.look.ledIntensity,
      cyclops: enemy === 'scrapling',
      fill: enemy === 'corrodius' ? 0.5 : 0,
    });
    rig.updateNameplate(top);
    markGearDetail(rig);
    return;
  }

  const race = RACES[spec.race];
  const tint = GEAR_TINT[spec.race][spec.sex === 'female' ? 1 : 0];
  for (const p of find(spec.race, (p) => p.kind === 'always')) add(p, tint);
  const hat = extras.find((e) => HATS.has(e));
  const crestId = race.crestStyles[Math.max(0, Math.min(race.crestStyles.length - 1, spec.crest | 0))].id;
  if (!hat) {
    for (const p of find(spec.race, (p) => p.kind === 'crest' && p.id === crestId)) {
      add(p, tint);
      top = Math.max(top, p.top - shellTop);
    }
  } else {
    // Race features that live in the crest slot but must survive a hat (tauren horns).
    for (const p of find(spec.race, (p) => p.kind === 'under-hat')) add(p, tint);
  }
  for (const id of extras) {
    for (const p of find('extras', (p) => p.id === id)) {
      add(p, tint);
      top = Math.max(top, p.top - shellTop);
    }
  }
  for (const id of CLASS_WEAPONS[spec.classId]) {
    for (const p of find('weapons', (p) => p.id === id)) add(p, tint, p.attach as SocketName);
  }
  rig.updateNameplate(Math.max(0, top));
  markGearDetail(rig);
}

const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** Gear meshes smaller than 7 % of the crab's height are hidden at the far LOD (beads, rivets, lamps). */
function markGearDetail(rig: JumperRig): void {
  rig.root.updateMatrixWorld(true);
  const height = rig.root.matrixWorld.getMaxScaleOnAxis() * rig.metersToUnits * 0.178;
  for (const g of rig.gearMeshes) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.matrixWorld.decompose(tmpP, new THREE.Quaternion(), tmpS);
      const r = m.geometry.boundingSphere!.radius * Math.max(tmpS.x, tmpS.y, tmpS.z);
      if (r < height * 0.07) {
        rig.gearDetail.push(m);
        m.visible = rig.lodLevel === 0;
      }
    });
  }
}
