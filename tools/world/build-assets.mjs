#!/usr/bin/env node
// Offline asset pipeline for the Clawhaven zone (src/world).
//
// Packs the CC0 Quaternius kits into three compact GLB libraries that src/world/kit.ts loads:
//   public/models/world/village.glb  Medieval Village MegaKit (Standard) building modules
//   public/models/world/nature.glb   Stylized Nature MegaKit (Standard) trees, grass, rocks
//   public/models/world/props.glb    Fantasy Props MegaKit (Standard) town props
// Every source file becomes one top-level node named after the file ("Wall_Plaster_Straight").
// Materials and textures are deduplicated across pieces, textures are resized and re-encoded to
// WebP, geometry is welded and meshopt-compressed.
//
// Usage (downloads stay outside the repo; see NOTICE.md for the source URLs):
//   cd tools/world && npm install --no-package-lock
//   node build-assets.mjs --village <dir with glTF/> --nature <dir> --props <dir>
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, simplify, textureCompress, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../public/models/world');
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** Pieces to keep from each kit (regex on the file base name). */
const KITS = {
  village: {
    dir: arg('--village'),
    keep: /./,
    drop: /^(Floor_RedBrick|Stair_Interior_Rails|Door_2_)/,
  },
  nature: {
    dir: arg('--nature'),
    // Trees are the bulk of the zone's triangles: simplify them (the leaf cards survive at this ratio).
    simplify: { match: /^(Pine_|CommonTree_|TwistedTree_|DeadTree_)/, ratio: 0.42, error: 0.008 },
    keep: /^(Pine_\d|CommonTree_\d|TwistedTree_[1-3]|DeadTree_[1-3]|Bush_Common.*|Fern_1|Flower_[34]_(Group|Single)|Grass_.*|Clover_\d|Plant_1.*|Plant_7.*|Mushroom_.*|Rock_Medium_\d|Pebble_Round_[1-3]|Pebble_Square_[1-3]|RockPath_Round_.*|Petal_\d)$/,
  },
  props: {
    dir: arg('--props'),
    // Small props are dense meshes (lanterns ~2.8k triangles); simplify the heavy ones.
    simplify: { match: /^(Lantern_Wall|CandleStick_Stand|CandleStick_Triple|FarmCrate_|Chain_Coil|Barrel_Apples|Barrel_Holder|Anvil_Log|Chest_Wood|Crate_Metal|Cage_Small|Dummy|WeaponStand|Stall_Cart_Empty|Rope_|Coin_Pile|Chandelier|Cauldron)/, ratio: 0.35, error: 0.004 },
    keep: /^(Anvil|Anvil_Log|Barrel|Barrel_Apples|Barrel_Holder|Bench|Bucket_Metal|Bucket_Wooden_1|Cauldron|CandleStick_Stand|CandleStick_Triple|Candle_1|Candle_2|Chest_Wood|Crate_Wooden|Crate_Metal|Dummy|FarmCrate_Apple|FarmCrate_Carrot|Lantern_Wall|Rope_1|Rope_2|Rope_3|Stall_Cart_Empty|Stall_Empty|Stool|Table_Large|Torch_Metal|Vase_2|Vase_4|Vase_Rubble_Medium|WeaponStand|Whetstone|Workbench|Chain_Coil|Banner_1|Banner_2|Bag|Shield_Wooden|Sword_Bronze|Axe_Bronze|Pickaxe_Bronze|Mug|Pot_1|Coin_Pile|Cage_Small|Chandelier|Peg_Rack|Shelf_Simple)$/,
  },
};

async function buildKit(name, { dir, keep, drop, simplify: simp }) {
  await MeshoptSimplifier.ready;
  if (!dir) {
    console.log(`skip ${name} (no --${name} dir)`);
    return;
  }
  const files = readdirSync(dir)
    .filter((f) => /\.(gltf|glb)$/.test(f))
    .map((f) => f.replace(/\.(gltf|glb)$/, ''))
    .filter((n) => keep.test(n) && !(drop && drop.test(n)))
    .sort();
  const target = new Document();
  target.createBuffer();
  const scene = target.createScene(name);
  target.getRoot().setDefaultScene(scene);
  for (const piece of files) {
    const file = readdirSync(dir).find((f) => f === `${piece}.gltf` || f === `${piece}.glb`);
    const src = await io.read(resolve(dir, file));
    if (simp && simp.match.test(piece)) {
      await src.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: simp.ratio, error: simp.error }));
    }
    const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
    const map = mergeDocuments(target, src);
    const tScene = map.get(srcScene);
    const holder = target.createNode(piece);
    for (const child of tScene.listChildren()) holder.addChild(child);
    scene.addChild(holder);
    for (const s of target.getRoot().listScenes()) if (s !== scene) s.dispose();
  }
  // Keep the original image names so the runtime can find textures (e.g. T_WindowGradient).
  for (const t of target.getRoot().listTextures()) {
    if (!t.getName()) t.setName(basename(t.getURI() || 'tex').replace(/\.[a-z]+$/i, ''));
  }
  await target.transform(
    unpartition(),
    dedup(),
    prune({ keepLeaves: false }),
    weld(),
    // Normal maps keep more quality; base colour at 1024; small masks at 512.
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [1024, 1024], quality: 88 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [1024, 1024], quality: 84 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, `${name}.glb`);
  await io.write(out, target);
  const root = target.getRoot();
  console.log(
    `${name}: ${files.length} pieces, ${root.listMaterials().length} materials, ${root.listTextures().length} textures -> ${out} (${(statSync(out).size / 1e6).toFixed(2)} MB)`,
  );
  console.log('  materials:', root.listMaterials().map((m) => m.getName()).join(', '));
}

for (const [name, kit] of Object.entries(KITS)) await buildKit(name, kit);
