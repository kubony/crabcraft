#!/usr/bin/env node
// Build public/models/crab/jumper-lod.glb, the far level of detail of the crab, from jumper.glb.
// Same node tree and extras (one node per URDF link, material classes by name), so the game binds
// it to the same skeleton; every link mesh is welded without normals and simplified with
// meshoptimizer. The game recomputes creased normals at load (src/crab/template.ts).
//
//   npm i --prefix /tmp/gt @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer
//   GLTF_TRANSFORM_MODULES=/tmp/gt/node_modules node tools/build_crab_lod.mjs [--ratio 0.1] [--error 0.03]
//
// GLTF_TRANSFORM_MODULES is any node_modules folder holding those packages (the npx cache of
// @gltf-transform/cli works too); a build-time tool adds no project dependency.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const root = process.env.GLTF_TRANSFORM_MODULES;
if (!root) {
  console.error('set GLTF_TRANSFORM_MODULES to a node_modules folder with @gltf-transform/* and meshoptimizer');
  process.exit(2);
}
const req = createRequire(resolve(root, 'x.js'));
const load = (id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { dequantize, weld, simplify, prune, meshopt } = await load('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = await load('meshoptimizer');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const here = new URL('..', import.meta.url).pathname;
const input = resolve(here, opt('--in', 'public/models/crab/jumper.glb'));
const output = resolve(here, opt('--out', 'public/models/crab/jumper-lod.glb'));
const ratio = Number(opt('--ratio', '0.1'));
const error = Number(opt('--error', '0.03'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(input);
await doc.transform(dequantize());

let before = 0;
let after = 0;
const count = () => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? 0) / 3;
  return n;
};
before = count();
// Normals split vertices along sharp edges, which pins the simplifier; drop them (the game rebuilds
// creased normals) and drop the face screen (the game keeps the full-detail one).
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const p of mesh.listPrimitives()) {
    if (p.getMaterial()?.getName() === 'face') {
      mesh.removePrimitive(p);
      continue;
    }
    p.setAttribute('NORMAL', null);
  }
  if (!mesh.listPrimitives().length) node.setMesh(null);
}
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }), prune({ keepLeaves: true, keepExtras: true }));
after = count();
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, doc);
console.log(`crab LOD: ${before} -> ${after} triangles (${((after / before) * 100).toFixed(1)}%), wrote ${output}`);
