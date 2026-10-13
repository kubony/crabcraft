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
  kind: 'always' | 'crest' | 'weapon' | 'extra' | 'enemy';
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
 * How weapons sit in the claw socket beyond the modelled frame (tuned on the HOME pose so the
 * sword points up and forward, the shield faces forward and the lantern hangs).
 */
const WEAPON_MOUNT: Record<string, { rot: [number, number, number]; pos?: [number, number, number] }> = {
  sword: { rot: [0.25, 0, 0] },
  shield: { rot: [0, 0.9, 0], pos: [0, 0.03, 0] },
  staff: { rot: [0.1, 0, 0] },
  lantern: { rot: [0.15, 0, 0] },
  hymnal: { rot: [0, 0.6, 0], pos: [0, 0.025, 0] },
};

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

  const add = (p: Piece, tint: string, socket?: SocketName) => {
    const o = instantiate(p, tint);
    const parent = socket ? rig.getSocket(socket) : rig.linkNode(p.attach);
    if (socket) {
      const mount = WEAPON_MOUNT[p.id];
      if (mount) {
        o.rotation.set(...mount.rot);
        if (mount.pos) o.position.set(...mount.pos);
      }
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
}
