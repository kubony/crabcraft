// The Pincer Fountain at the heart of Clawhaven Square: a bronze crab claw rising from a round
// basin, water arcing from both fingertips.
import * as THREE from 'three';
import type { Collision } from './collision';
import { bezier, lathe, placed, tube } from './geom';
import { addPatch } from './materials';
import { GLSL_NOISE } from './noise';
import { CC_SKY, CC_SKY_UNIFORMS, type SkyUniforms } from './sky';

export interface Fountain {
  group: THREE.Group;
  /** World positions of the fingertip spouts. */
  spouts: THREE.Vector3[];
  waterY: number;
  radius: number;
}

/**
 * The claw statue wears Jumper's own finish: glossy red lacquer over a darker base, worn to warm
 * bronze on raised edges, with clearcoat highlights like the robot's shell.
 */
export function bronzeMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0.1, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.45 });
  addPatch(m, 'claw-lacquer', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW;\nvarying vec3 vBN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBW;\nvarying vec3 vBN;\n${GLSL_NOISE}\nfloat ccWear;`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float n = cc_fbm(vBW.xy * 2.1 + vBW.z * 1.7);
          // Wear shows on edges (normals near horizontal-sideways) and in noisy patches.
          float edge = 1.0 - abs(vBN.z);
          ccWear = smoothstep(0.62, 0.9, n * 0.7 + edge * 0.45);
          vec3 lacquer = vec3(0.21, 0.008, 0.012);
          vec3 bronze = vec3(0.55, 0.32, 0.12);
          diffuseColor.rgb *= mix(lacquer, bronze, ccWear);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.3, 0.5, ccWear);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.05, 0.8, ccWear);');
  });
  return m;
}

export function buildFountain(
  x: number,
  y: number,
  z: number,
  stone: THREE.Material,
  sky: SkyUniforms,
  col: Collision,
): Fountain {
  const group = new THREE.Group();
  group.name = 'fountain';
  group.position.set(x, y, z);

  // Basin rim and pedestal (stone).
  const rim = lathe(
    [
      [3.9, 0.05],
      [4.15, 0.3],
      [4.15, 0.62],
      [4.3, 0.82],
      [4.75, 0.82],
      [4.95, 0.66],
      [4.95, 0.12],
      [5.15, 0.0],
    ],
    64,
    0.45,
  );
  const ped = lathe(
    [
      [0.0, 2.25],
      [1.25, 2.25],
      [1.35, 2.05],
      [1.0, 1.9],
      [0.85, 1.2],
      [1.05, 0.6],
      [1.45, 0.45],
      [1.5, 0.0],
    ],
    12,
    0.45,
  );
  const stoneMesh = new THREE.Mesh(mergeAll([rim, ped]), stone);
  stoneMesh.castShadow = stoneMesh.receiveShadow = true;
  group.add(stoneMesh);

  // The claw: a jointed arm rising from the pedestal into a chunky extruded pincer, open to the sky.
  const bronze = bronzeMaterial();
  const parts: THREE.BufferGeometry[] = [];
  const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
  parts.push(tube(bezier(V(0, 2.1, 0), V(0, 2.7, 0), V(-0.2, 3.1, 0), V(-0.1, 3.7, 0), 12), (t) => 0.55 - 0.08 * Math.sin(t * Math.PI), 20));
  parts.push(placed(new THREE.SphereGeometry(0.62, 24, 16), -0.1, 3.75, 0, 0, 0, 0, [1.05, 0.72, 1.0]));
  // Pincer silhouette (x right, y up): a round palm, the fixed finger curving up on the left and
  // the dactyl swung open to the right, teeth along both inner edges.
  const sh = new THREE.Shape();
  sh.moveTo(-0.5, 0);
  sh.bezierCurveTo(-1.3, 0.1, -1.55, 1.3, -1.35, 2.35);
  sh.bezierCurveTo(-1.55, 3.6, -1.2, 5.3, -0.25, 6.35);
  sh.bezierCurveTo(-0.3, 5.6, -0.2, 4.6, -0.05, 3.9);
  for (const [x, y] of [
    [-0.32, 3.7],
    [0.0, 3.45],
    [-0.25, 3.25],
    [0.05, 3.0],
  ] as [number, number][])
    sh.lineTo(x, y);
  sh.quadraticCurveTo(0.25, 2.55, 0.55, 2.7);
  for (const [x, y] of [
    [0.75, 3.05],
    [1.0, 3.0],
    [1.15, 3.4],
    [1.42, 3.4],
    [1.55, 3.85],
  ] as [number, number][])
    sh.lineTo(x, y);
  sh.bezierCurveTo(1.9, 4.4, 2.3, 5.0, 2.75, 5.55);
  sh.bezierCurveTo(2.9, 4.4, 2.5, 3.0, 1.45, 2.2);
  sh.bezierCurveTo(1.6, 1.1, 1.2, 0.1, 0.5, 0);
  sh.lineTo(-0.5, 0);
  const pincer = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.34, bevelSegments: 6, curveSegments: 28 });
  pincer.translate(0, 0, -0.5);
  pincer.scale(1.15, 1.15, 1.15);
  pincer.translate(-0.3, 3.9, 0);
  pincer.computeVertexNormals();
  parts.push(pincer);
  const claw = new THREE.Mesh(mergeAll(parts), bronze);
  claw.rotation.y = 0.3;
  claw.castShadow = claw.receiveShadow = true;
  group.add(claw);
  claw.updateMatrix();
  const tipL = new THREE.Vector3(-0.25 * 1.15 - 0.3, 6.35 * 1.15 + 3.9, 0).applyMatrix4(claw.matrix);
  const tipR = new THREE.Vector3(2.75 * 1.15 - 0.3, 5.55 * 1.15 + 3.9, 0).applyMatrix4(claw.matrix);

  // Basin water.
  const waterY = 0.62;
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 48).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { ...(sky as unknown as Record<string, THREE.IUniform>) },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${CC_SKY_UNIFORMS}
        ${CC_SKY}
        uniform vec3 uCentre;
        varying vec3 vW;
        void main() {
          vec2 d = vW.xz - uCentre.xz;
          float r = length(d);
          float ring = sin(r * 7.0 - uTime * 3.5) * exp(-r * 0.25);
          vec2 g = normalize(d + 1e-4) * ring * 0.12 + vec2(cc_vnoise(vW.xz * 2.5 + uTime), cc_vnoise(vW.zx * 2.5 - uTime)) * 0.12 - 0.06;
          vec3 n = normalize(vec3(g.x, 1.0, g.y));
          vec3 v = normalize(cameraPosition - vW);
          vec3 rf = reflect(-v, n);
          rf.y = abs(rf.y);
          float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
          vec3 body = vec3(0.05, 0.32, 0.30);
          float caust = pow(cc_vnoise(vW.xz * 3.0 + vec2(uTime * 0.6, -uTime * 0.4)) * cc_vnoise(vW.zx * 2.6 - uTime * 0.5), 2.0) * 2.5;
          vec3 col = mix(body + caust * vec3(0.4, 0.8, 0.7), ccSky(rf, 0.0), fres);
          float foam = smoothstep(0.9, 1.0, cc_vnoise(vW.xz * 4.0 + uTime * 2.0)) * smoothstep(1.6, 1.0, r);
          col += foam * 0.6;
          gl_FragColor = vec4(col, 0.82);
        }`,
      transparent: true,
    }),
  );
  (water.material as THREE.ShaderMaterial).uniforms.uCentre = { value: new THREE.Vector3(x, y, z) };
  water.position.y = waterY;
  water.renderOrder = 3;
  group.add(water);

  col.addCircle(x, z, 5.0, y - 1, y + 9);
  const spouts = [tipL, tipR].map((p) => p.clone().add(group.position));
  return { group, spouts, waterY: y + waterY, radius: 4.2 };
}

export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Normalise to non-indexed-compatible indexed geometries with position/normal/uv.
  const prepared = geos.map((g) => {
    const out = g;
    if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
    if (!out.index) {
      const n = out.getAttribute('position').count;
      out.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
    return out;
  });
  let vcount = 0;
  let icount = 0;
  for (const g of prepared) {
    vcount += g.getAttribute('position').count;
    icount += g.index!.count;
  }
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const idx = new Uint32Array(icount);
  let vo = 0;
  let io = 0;
  for (const g of prepared) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      uv[(vo + i) * 2] = u.getX(i);
      uv[(vo + i) * 2 + 1] = u.getY(i);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx[io + i] = ix.getX(i) + vo;
    vo += p.count;
    io += ix.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
