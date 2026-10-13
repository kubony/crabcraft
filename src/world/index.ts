// Clawhaven and the Brine Shore: the playable zone. Implements the World contract (./types).
import * as THREE from 'three';
import { initAssets } from '../core/assets';
import type { CreateWorld, Poi, PoiId, SpawnArea, World } from './types';
import { TownBuilder } from './buildings';
import { Collision } from './collision';
import { buildDressing } from './dressing';
import { buildFoliage } from './foliage';
import { buildFx } from './fx';
import { buildFountain } from './fountain';
import { loadKit, StaticBatch, trs } from './kit';
import { GRID, GROVE, LIGHTHOUSE, LOTS, POI_DEFS, SPAWN_POINTS } from './layout';
import { buildLighthouse } from './lighthouse';
import { stylise, WORLD_UNIFORMS } from './materials';
import { blendMood, cloneMood, MOODS, type Mood } from './moods';
import { createSky, createSkyUniforms } from './sky';
import { createTerrainMaterial, Terrain } from './terrain';
import { createWater } from './water';
import { buildWreck } from './wreck';

export const createWorld: CreateWorld = async ({ renderer, scene, quality, onProgress }) => {
  const progress = (f: number, label: string) => onProgress?.(f, label);
  initAssets(renderer);
  const root = new THREE.Group();
  root.name = 'clawhaven';
  const uTime = WORLD_UNIFORMS.uTime;

  progress(0.02, 'Shaping the Tidelands');
  const terrain = new Terrain();
  await tick();

  progress(0.1, 'Unpacking the village');
  const [village, nature, props] = await Promise.all([
    loadKit('models/world/village.glb'),
    loadKit('models/world/nature.glb'),
    loadKit('models/world/props.glb'),
  ]);
  // Kit materials: non-metallic stone/wood/plaster, a little more saturated and warm.
  for (const [name, m] of [...village.materials, ...props.materials]) {
    const sm = m as THREE.MeshStandardMaterial;
    if (!/Metal/.test(name)) {
      sm.metalness = 0;
      sm.metalnessMap = null;
    }
    stylise(sm, name === 'MI_RoundTiles' ? 1.2 : 1.15);
  }

  progress(0.35, 'Painting the ground');
  const terrainMat = createTerrainMaterial(
    terrain,
    {
      cobble: village.material('MI_UnevenBrick')?.map ?? null,
      cobbleNormal: village.material('MI_UnevenBrick')?.normalMap ?? null,
      rock: nature.material('Rocks')?.map ?? null,
    },
    { uTime },
  );
  const terrainMesh = terrain.buildMesh(terrainMat);
  terrainMesh.castShadow = false;
  root.add(terrainMesh);

  // Sky and water share the sky uniforms so reflections match the dome.
  const skyU = createSkyUniforms(uTime);
  const sky = createSky(skyU);
  root.add(sky);

  const col = new Collision(terrain);

  progress(0.45, 'Raising Clawhaven');
  const windowGlass = new THREE.MeshStandardMaterial({
    name: 'cc-window',
    color: 0x2a1a0c,
    emissive: 0xffa040,
    emissiveIntensity: 1.4,
    roughness: 0.25,
    side: THREE.DoubleSide,
  });
  const townBatch = new StaticBatch(village, 'town');
  const town = new TownBuilder(village, townBatch, col, { MI_WindowGlass: windowGlass });
  for (const lot of LOTS) town.build(lot);
  root.add(townBatch.build());

  progress(0.55, 'Casting the Pincer Fountain');
  const fountain = buildFountain(0, POI_DEFS.spawn ? terrain.heightAt(0, 0) : 4, 0, village.material('MI_Brick')!, skyU, col);
  root.add(fountain.group);

  progress(0.6, 'Building Saltmere Lighthouse');
  const lighthouse = buildLighthouse(village, col, windowGlass);
  root.add(lighthouse.group);

  progress(0.65, 'Sinking the Iron Wreck');
  const propBatch = new StaticBatch(props, 'props');
  const dressBatch = new StaticBatch(village, 'village-dressing');
  const wreck = buildWreck(village, col, townBatch, propBatch);
  root.add(wreck.group);

  progress(0.7, 'Setting out the market');
  const dressing = buildDressing(village, props, terrain, col, propBatch, dressBatch, skyU);
  root.add(dressing.group);
  const doorGlows = town.doorLamps.map((d) => {
    propBatch.add('Lantern_Wall', trs(d.pos.x, d.pos.y, d.pos.z, d.yaw, 0.75));
    return {
      pos: d.pos.clone().add(new THREE.Vector3(Math.sin(d.yaw) * 0.8, 0.45, Math.cos(d.yaw) * 0.8)),
      color: new THREE.Color('#ffb35a'),
      size: 1.2,
      kind: 'lamp' as const,
    };
  });
  root.add(propBatch.build());
  root.add(dressBatch.build());

  progress(0.72, 'Growing the pine woods');
  const foliage = buildFoliage(nature, terrain, col, quality);
  root.add(foliage.group);

  const water = createWater(
    skyU,
    terrain.heightTexture(),
    new THREE.Vector2(GRID.minX, GRID.minZ),
    new THREE.Vector2(GRID.maxX - GRID.minX, GRID.maxZ - GRID.minZ),
    quality,
  );
  (water.mesh.material as THREE.ShaderMaterial).uniforms.uTime = uTime;
  root.add(water.mesh);

  col.buildBlocked();

  // Ambient particles.
  const fountainCentre = new THREE.Vector3(0, fountain.waterY, 0);
  const lhR = LIGHTHOUSE.stackRadius;
  const fx = buildFx(
    {
      glows: [
        ...dressing.glows,
        ...doorGlows,
        ...wreck.fires.map((p) => ({ pos: p, color: new THREE.Color('#ff7a2a'), size: 2.4, kind: 'fire' as const })),
        ...[0, 2.1, 4.2].map((a) => ({ pos: new THREE.Vector3(Math.cos(a) * 2.6, fountain.waterY - 0.15, Math.sin(a) * 2.6), color: new THREE.Color('#40d8ff'), size: 1.6, kind: 'lamp' as const })),
      ],
      forgeSparks: dressing.forgeSparks,
      chimneys: dressing.chimneys,
      fountainSpouts: fountain.spouts,
      fountainWaterY: fountain.waterY,
      fountainCentre,
      spray: [
        ...[0.4, 1.6, 2.8, 4.0, 5.2].map((a) => new THREE.Vector3(LIGHTHOUSE.x + Math.cos(a) * (lhR + 0.5), 0, LIGHTHOUSE.z + Math.sin(a) * (lhR + 0.5))),
        wreck.toWorld(0, 14, 0).setY(0),
        wreck.toWorld(-12, 14.5, 0).setY(0),
        wreck.toWorld(8, 13.8, 0).setY(0),
      ],
      embers: wreck.embers,
      fireflyZones: [
        { centre: new THREE.Vector3(GROVE.x, GROVE.h + 0.3, GROVE.z), extent: new THREE.Vector3(13, 3.5, 13), count: 140, color: new THREE.Color('#7affd9') },
        { centre: new THREE.Vector3(-48, 5, 18), extent: new THREE.Vector3(18, 3, 22), count: 50, color: new THREE.Color('#d8ff6a') },
        { centre: new THREE.Vector3(0, 4.5, 0), extent: new THREE.Vector3(20, 3, 20), count: 40, color: new THREE.Color('#ffe58a') },
      ],
      dustCentre: new THREE.Vector3(0, 4, 0),
      fireworksCentre: new THREE.Vector3(122, 50, 8),
    },
    quality,
    uTime,
  );
  root.add(fx.group);

  // A handful of real lights: forge, tavern door, square, chapel, gate, grove pool.
  const lightList = [
    ...wreck.fires.filter((_, i) => i % 3 === 0).map((p) => ({ pos: p.clone().add(new THREE.Vector3(0, 0.8, 0)), color: '#ff8a3a', intensity: 30, distance: 26, kind: 'fire' as const })),
    ...dressing.lights,
  ];
  const pointLights = lightList.slice(0, quality === 'high' ? 12 : 6).map((l) => {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
    pl.position.copy(l.pos);
    pl.userData = { base: l.intensity, kind: l.kind, seed: Math.random() * 10 };
    root.add(pl);
    return pl;
  });
  const flash = new THREE.PointLight('#ffffff', 0, 260, 1.0);
  flash.position.set(122, 55, 8);
  root.add(flash);
  const flickers: THREE.Mesh[] = [];
  const bobbers: THREE.Mesh[] = [];
  const runes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o.userData.flicker) flickers.push(o as THREE.Mesh);
    if (o.userData.bob !== undefined) bobbers.push(o as THREE.Mesh);
    if (o.userData.rune) runes.push(o as THREE.Mesh);
  });
  const groveU = (dressing.groveWater.material as THREE.ShaderMaterial).uniforms;

  // Lights.
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  const shadowSize = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const SHADOW_EXTENT = quality === 'high' ? 70 : 55;
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 460 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  root.add(hemi);
  const fog = new THREE.FogExp2(0xffffff, 0.003);
  scene.fog = fog;
  scene.background = null;

  // POIs and spawn areas.
  const pois = {} as Record<PoiId, Poi>;
  for (const [id, d] of Object.entries(POI_DEFS) as [PoiId, (typeof POI_DEFS)[PoiId]][]) {
    pois[id] = { id, position: new THREE.Vector3(d.x, d.y ?? col.heightAt(d.x, d.z), d.z), yaw: d.yaw, radius: d.radius };
  }
  const toV3 = ([x, z]: readonly [number, number]) => new THREE.Vector3(x, col.heightAt(x, z), z);
  const spawns: SpawnArea[] = [
    { id: 'scraplings', points: SPAWN_POINTS.scraplings.map(toV3), radius: 6 },
    { id: 'scavengers', points: SPAWN_POINTS.scavengers.map(toV3), radius: 3 },
    { id: 'townsfolk', points: SPAWN_POINTS.townsfolk.map(toV3), radius: 5 },
  ];

  // Moods.
  const mood: Mood = cloneMood(MOODS[0]);
  let target: Mood = MOODS[0];
  let blending = 1;
  let envDirty = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky(skyU));
  let envRT: THREE.WebGLRenderTarget | null = null;
  const applyMood = () => {
    sun.color.copy(mood.keyColor);
    sun.intensity = mood.keyIntensity;
    hemi.color.copy(mood.hemiSky);
    hemi.groundColor.copy(mood.hemiGround);
    hemi.intensity = mood.hemiIntensity;
    skyU.uSunDir.value.copy(MOODS[0].keyDir);
    skyU.uMoonDir.value.copy(MOODS[1].keyDir);
    skyU.uZenith.value.copy(mood.zenith);
    skyU.uMid.value.copy(mood.mid);
    skyU.uHorizon.value.copy(mood.horizon);
    skyU.uGround.value.copy(mood.ground);
    skyU.uSunColor.value.copy(mood.sunColor);
    skyU.uGlow.value.copy(mood.glow);
    skyU.uCloudLit.value.copy(mood.cloudLit);
    skyU.uCloudShade.value.copy(mood.cloudShade);
    skyU.uStars.value = mood.stars;
    skyU.uMoon.value = mood.moon;
    skyU.uSunVis.value = mood.sunVis;
    skyU.uCloudCover.value = mood.cloudCover;
    fog.color.copy(mood.fogColor);
    fog.density = mood.fogDensity;
    water.uniforms.uDeep.value.copy(mood.waterDeep);
    water.uniforms.uShallow.value.copy(mood.waterShallow);
    water.uniforms.uSunLight.value.copy(mood.waterLight);
    scene.environmentIntensity = mood.envIntensity;
    windowGlass.emissiveIntensity = 1.2 * mood.lamps;
    fx.uniforms.uLamps.value = 0.6 + 0.4 * mood.lamps;
    fx.uniforms.uFireflies.value = mood.fireflies;
    fx.uniforms.uDust.value = mood.sunVis;
    fx.uniforms.uNight.value = 1 - mood.sunVis;
    groveU.uPoolGlow.value = 0.7 + 0.5 * (1 - mood.sunVis);
    for (const pl of pointLights) pl.userData.mood = pl.userData.kind === 'magic' ? 0.6 + 0.6 * (1 - mood.sunVis) : 0.55 + 0.45 * mood.lamps;
  };
  applyMood();

  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  scene.add(root);
  progress(1, 'Ready');

  const world: World = {
    root,
    pois,
    spawns,
    heightAt: (x, z) => col.heightAt(x, z),
    resolveCollision: (x, z, r, out) => col.resolve(x, z, r, out),
    raycastSolid: (from, to) => col.raycast(from, to),
    update(dt, elapsed, camera) {
      uTime.value = elapsed;
      if (blending < 1) {
        const k = 1 - Math.exp(-dt * 1.6);
        blendMood(mood, target, k);
        blending = Math.min(1, blending + dt / 2.5);
        if (blending >= 1) {
          blendMood(mood, target, 1);
          envDirty = true;
        }
        applyMood();
      }
      if (envDirty) {
        envDirty = false;
        envRT?.dispose();
        envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
        scene.environment = envRT.texture;
      }
      lighthouse.update(dt, elapsed, camera, mood.lamps);
      // Particles: pixel scale for point sizes; fireworks only in the celebration mood.
      const pcam = camera as THREE.PerspectiveCamera;
      const hpx = renderer.domElement.height;
      fx.uniforms.uPixel.value = hpx / (2 * Math.tan(THREE.MathUtils.degToRad((pcam.fov ?? 50) / 2)));
      fx.uniforms.uFireworks.value += ((target === MOODS[2] ? 1 : 0) - fx.uniforms.uFireworks.value) * Math.min(1, dt * 0.8);
      for (const pl of pointLights) {
        const k = pl.userData.kind as string;
        const f = k === 'fire' ? 0.8 + 0.2 * Math.sin(elapsed * 13 + pl.userData.seed) * Math.sin(elapsed * 7.1) : k === 'candle' ? 0.9 + 0.1 * Math.sin(elapsed * 17 + pl.userData.seed) : 1;
        pl.intensity = pl.userData.base * f * (pl.userData.mood ?? 1);
      }
      for (const m of flickers) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.6 + 0.8 * Math.sin(elapsed * 9) * Math.sin(elapsed * 5.3);
      for (const b of bobbers) {
        b.position.y = 0.15 + Math.sin(elapsed * 1.1 + b.userData.bob) * 0.08;
        b.rotation.z = Math.sin(elapsed * 0.9 + b.userData.bob) * 0.05;
      }
      for (const r of runes) (r.material as THREE.MeshBasicMaterial).color.setRGB(0.4, 2.2, 2.4).multiplyScalar(0.75 + 0.25 * Math.sin(elapsed * 1.4));
      // Firework flashes light the bay.
      const fw = fx.uniforms.uFireworks.value;
      flash.intensity = fw > 0.01 ? fw * 900 * Math.pow(Math.max(0, Math.sin(elapsed * 2.1) * Math.sin(elapsed * 0.77 + 1)), 6) : 0;
      water.uniforms.uBeam.value = lighthouse.lit;
      water.uniforms.uBeamDir.value.copy(lighthouse.beamDir);
      water.uniforms.uBeamPos.value.copy(lighthouse.lens);
      // Sky follows the camera; the shadow frustum follows a focus point ahead of it.
      sky.position.copy(camera.position);
      camera.getWorldDirection(fwd);
      const ahead = THREE.MathUtils.clamp(camera.position.y * 1.2, 12, 45);
      focus.copy(camera.position).addScaledVector(fwd.setY(0).normalize(), ahead);
      focus.y = col.heightAt(focus.x, focus.z);
      const texel = (2 * SHADOW_EXTENT) / shadowSize;
      focus.x = Math.round(focus.x / texel) * texel;
      focus.z = Math.round(focus.z / texel) * texel;
      sun.position.copy(focus).addScaledVector(mood.keyDir, 220);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
    },
    setBeaconLit(lit) {
      lighthouse.setLit(lit);
    },
    setMood(m) {
      target = MOODS[m];
      blending = 0;
    },
    dispose() {
      scene.remove(root);
      envRT?.dispose();
      pmrem.dispose();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
  void wreck;
  pois.wreck.position.copy(wreck.gangwayFoot);
  pois.bossArena.position.copy(wreck.arena);
  // Debug info for the dev harness (not part of the World contract).
  (world as World & { debug?: unknown }).debug = { foliage: foliage.counts, collision: col };
  return world;
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
