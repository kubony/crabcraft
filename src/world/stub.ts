// Stand-in world: flat ground, boxes where buildings will be, a lighthouse and a wreck deck.
// Same World contract as the real zone; used until src/world/provider.ts points at it.
import * as THREE from 'three';
import type { CreateWorld, Poi, PoiId, SpawnArea, World } from './types';

const P = (x: number, z: number, yaw = 0, radius = 3): { position: THREE.Vector3; yaw: number; radius: number } => ({
  position: new THREE.Vector3(x, 0, z),
  yaw,
  radius,
});

export const createWorld: CreateWorld = async ({ scene }) => {
  const root = new THREE.Group();
  root.name = 'stub-world';
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6b8f4a, roughness: 1 }),
  );
  ground.receiveShadow = true;
  root.add(ground);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(60, 140).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9c38f }));
  sand.position.set(70, 0.01, 0);
  sand.receiveShadow = true;
  root.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b6f8f, roughness: 0.2 }));
  water.position.set(200, -0.3, 0);
  root.add(water);

  const boxes: THREE.Box3[] = [];
  const building = (x: number, z: number, w: number, d: number, h: number, color: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    boxes.push(new THREE.Box3().setFromObject(m));
  };
  building(-18, -14, 10, 8, 6, 0x9a7b5a); // forge
  building(16, -16, 10, 12, 9, 0xd8d0c0); // chapel
  building(-16, 16, 12, 10, 7, 0x8a5a3a); // tavern
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 22, 24), new THREE.MeshStandardMaterial({ color: 0xf0eee8 }));
  tower.position.set(60, 11, -60);
  tower.castShadow = true;
  root.add(tower);
  boxes.push(new THREE.Box3().setFromObject(tower));
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x332211 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), beaconMat);
  beacon.position.set(60, 23, -60);
  root.add(beacon);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 30), new THREE.MeshStandardMaterial({ color: 0x5a4636 }));
  deck.position.set(95, 0.5, 40);
  deck.receiveShadow = true;
  root.add(deck);

  const sun = new THREE.DirectionalLight(0xffd9a0, 3);
  sun.position.set(-60, 80, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 300 });
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(0x9ec9ff, 0x4a3a20, 1.2));
  scene.background = new THREE.Color(0xf0a868);
  scene.fog = new THREE.Fog(0xf0a868, 60, 260);
  scene.add(root);

  const poiList: [PoiId, ReturnType<typeof P>][] = [
    ['spawn', P(0, 0, 0, 6)],
    ['forge', P(-18, -8, 0)],
    ['chapel', P(16, -8, 0)],
    ['tavern', P(-16, 9, Math.PI)],
    ['grove', P(-40, 50, 0, 8)],
    ['shore', P(70, 0, 0, 25)],
    ['lighthouse', P(55, -52, 0, 6)],
    ['beacon', P(60, 0, -60, 3)],
    ['wreck', P(95, 40, 0, 12)],
    ['bossArena', P(95, 40, Math.PI, 12)],
    ['npc:brinebeard', P(3, 3, Math.PI, 1)],
    ['npc:silvermoon', P(-38, 48, 0.5, 1)],
    ['npc:coralline', P(16, -9, 0, 1)],
    ['npc:grukk', P(-6, 12, Math.PI, 1)],
    ['npc:hoofclaw', P(-16, 10, 0, 1)],
    ['npc:rattlebolt', P(54, -50, 0, 1)],
    ['npc:pip', P(-17, -8, 0, 1)],
  ];
  const pois = Object.fromEntries(poiList.map(([id, p]) => [id, { id, ...p } satisfies Poi])) as Record<PoiId, Poi>;
  const deckBox = new THREE.Box3().setFromObject(deck);
  const spawns: SpawnArea[] = [
    { id: 'scraplings', points: [new THREE.Vector3(68, 0, -10), new THREE.Vector3(74, 0, 8), new THREE.Vector3(66, 0, 22)], radius: 6 },
    { id: 'scavengers', points: [new THREE.Vector3(48, 0, -40), new THREE.Vector3(56, 0, -46), new THREE.Vector3(52, 0, -34)], radius: 4 },
    { id: 'townsfolk', points: [new THREE.Vector3(6, 0, -4), new THREE.Vector3(-6, 0, 4), new THREE.Vector3(8, 0, 8)], radius: 6 },
  ];
  const ray = new THREE.Raycaster();
  const solids = root.children.filter((o) => (o as THREE.Mesh).isMesh && o !== ground && o !== sand && o !== water);

  const world: World = {
    root,
    pois,
    spawns,
    heightAt(x, z) {
      return deckBox.containsPoint(new THREE.Vector3(x, 0.5, z)) ? 1 : 0;
    },
    resolveCollision(x, z, radius, out) {
      out.set(x, z);
      for (const b of boxes) {
        const cx = THREE.MathUtils.clamp(out.x, b.min.x, b.max.x);
        const cz = THREE.MathUtils.clamp(out.y, b.min.z, b.max.z);
        const dx = out.x - cx;
        const dz = out.y - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2) || 1e-4;
          out.x = cx + (dx / d) * radius;
          out.y = cz + (dz / d) * radius;
        }
      }
      return out;
    },
    raycastSolid(from, to) {
      const dir = to.clone().sub(from);
      const len = dir.length();
      ray.set(from, dir.normalize());
      ray.far = len;
      const hit = ray.intersectObjects(solids, false)[0];
      return hit ? hit.distance : null;
    },
    update() {},
    setBeaconLit(lit) {
      beaconMat.color.set(lit ? 0xfff2b0 : 0x332211).multiplyScalar(lit ? 6 : 1);
    },
    setMood(mood) {
      const c = mood === 1 ? 0x1a2238 : mood === 2 ? 0x2a1840 : 0xf0a868;
      (scene.background as THREE.Color).set(c);
      (scene.fog as THREE.Fog).color.set(c);
      sun.intensity = mood === 1 ? 0.6 : 3;
    },
    dispose() {
      scene.remove(root);
    },
  };
  return world;
};
