// Prints piece names and bounding boxes of a built kit GLB (debug helper).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const filt = process.argv[3] ? new RegExp(process.argv[3]) : /./;
for (const n of (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).listChildren()) {
  if (!filt.test(n.getName())) continue;
  const b = getBounds(n);
  let tris = 0;
  n.traverse((c) => {
    const m = c.getMesh();
    if (m) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  });
  console.log(n.getName().padEnd(40), b.min.map((v) => v.toFixed(2)).join(','), '|', b.max.map((v) => v.toFixed(2)).join(','), 'tris', tris);
}
