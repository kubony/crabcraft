// The carved stone dais the crab stands on: three bevelled stone tiers built as lathes, a carved
// top face with a gold star medallion, radial slabs and a ring of glowing runes, and a gold rim.
// All textures are generated here so the dais needs no image files.
import * as THREE from 'three';
import {
  canvasChannels,
  clamp01,
  dataTexture,
  fbmField,
  hash2,
  lerp,
  makeCanvas,
  normalFromHeight,
  rng,
  sampleField,
  smoothstep,
} from './textures';

export const DAIS_TOP = 0.38;

interface Tier {
  r: number;
  y0: number;
  y1: number;
}
const TIERS: Tier[] = [
  { r: 1.86, y0: 0, y1: 0.12 },
  { r: 1.68, y0: 0.12, y1: 0.25 },
  { r: 1.5, y0: 0.25, y1: DAIS_TOP },
];
const BEVEL = 0.034;
/** Radius of the carved top disc (inside the top tier's bevel). */
export const TOP_RADIUS = TIERS[2].r - BEVEL;
/** Rune band, as a fraction of TOP_RADIUS. */
const RUNE_IN = 0.575;
const RUNE_OUT = 0.745;
export const RUNE_RING_RADIUS = TOP_RADIUS * (RUNE_IN + RUNE_OUT) * 0.5;

const STONE_A = [0.7, 0.57, 0.42];
const STONE_B = [0.46, 0.37, 0.29];
const DARK = [0.16, 0.145, 0.135];
const GOLD = [0.86, 0.66, 0.3];
const RUNE = [1.0, 0.84, 0.5];

interface RawSet {
  map: Uint8Array;
  orm: Uint8Array;
  normal: Uint8Array;
  emissive?: Uint8Array;
}
let rawCache: { side: RawSet; top: Required<RawSet> } | null = null;

export interface Dais {
  group: THREE.Group;
  /** Brighten the runes for a moment (any change of the character). */
  flare(strength?: number): void;
  update(dt: number, elapsed: number): void;
  /** 0..1 glow level this frame, for lights that follow the runes. */
  readonly glow: number;
  dispose(): void;
}

export function createDais(): Dais {
  const group = new THREE.Group();
  group.name = 'dais';
  const disposables: { dispose(): void }[] = [];

  // Texture data is deterministic: build it once per page and reuse it on later visits.
  if (!rawCache) {
    const fine = fbmField(256, 8, 5, 11);
    const coarse = fbmField(256, 3, 4, 23);
    rawCache = { side: buildSideTextures(fine, coarse), top: buildTopTextures(fine, coarse) };
  }
  const side = {
    map: dataTexture(rawCache.side.map, 512, 256, true, true),
    orm: dataTexture(rawCache.side.orm, 512, 256, false, true),
    normal: dataTexture(rawCache.side.normal, 512, 256, false, true),
  };

  // ---------- Side stone (tileable along u) ----------
  disposables.push(side.map, side.orm, side.normal);
  const sideMat = new THREE.MeshStandardMaterial({
    map: side.map,
    roughnessMap: side.orm,
    aoMap: side.orm,
    aoMapIntensity: 0.8,
    normalMap: side.normal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  disposables.push(sideMat);

  TIERS.forEach((t, i) => {
    const inner = i < TIERS.length - 1 ? TIERS[i + 1].r - 0.01 : TOP_RADIUS;
    const geo = tierGeometry(t, inner);
    disposables.push(geo);
    const m = new THREE.Mesh(geo, sideMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  // ---------- Carved top face ----------
  const T = rawCache.top;
  const top = {
    map: dataTexture(T.map, 1024, 1024, true),
    orm: dataTexture(T.orm, 1024, 1024, false),
    normal: dataTexture(T.normal, 1024, 1024, false),
    emissive: dataTexture(T.emissive, 1024, 1024, true),
  };
  disposables.push(top.map, top.orm, top.normal, top.emissive);
  const topMat = new THREE.MeshStandardMaterial({
    map: top.map,
    roughnessMap: top.orm,
    metalnessMap: top.orm,
    aoMap: top.orm,
    aoMapIntensity: 0.9,
    normalMap: top.normal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    emissiveMap: top.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.55,
  });
  disposables.push(topMat);
  const topGeo = new THREE.CircleGeometry(TOP_RADIUS, 128);
  topGeo.rotateX(-Math.PI / 2);
  disposables.push(topGeo);
  const topMesh = new THREE.Mesh(topGeo, topMat);
  topMesh.position.y = DAIS_TOP;
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // ---------- Gold rims ----------
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9aa4c, metalness: 1, roughness: 0.26, envMapIntensity: 1.3 });
  disposables.push(goldMat);
  const rimGeo = new THREE.TorusGeometry(TOP_RADIUS - 0.018, 0.017, 10, 160);
  rimGeo.rotateX(Math.PI / 2);
  disposables.push(rimGeo);
  const rim = new THREE.Mesh(rimGeo, goldMat);
  rim.position.y = DAIS_TOP + 0.002;
  rim.castShadow = true;
  group.add(rim);
  const rim2Geo = new THREE.TorusGeometry(TIERS[0].r - BEVEL * 0.6, 0.012, 8, 160);
  rim2Geo.rotateX(Math.PI / 2);
  disposables.push(rim2Geo);
  const rim2 = new THREE.Mesh(rim2Geo, goldMat);
  rim2.position.y = TIERS[0].y1 - BEVEL * 0.45;
  group.add(rim2);

  // ---------- Rune halo: a soft additive ring that hovers over the band ----------
  const haloTex = haloTexture();
  disposables.push(haloTex);
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    color: new THREE.Color(1.0, 0.72, 0.32),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });
  disposables.push(haloMat);
  const haloGeo = new THREE.RingGeometry(TOP_RADIUS * (RUNE_IN - 0.08), TOP_RADIUS * (RUNE_OUT + 0.08), 128, 1);
  haloGeo.rotateX(-Math.PI / 2);
  // Map radial position to u so the texture is a 1D radial profile.
  {
    const pos = haloGeo.getAttribute('position');
    const uv = haloGeo.getAttribute('uv');
    const r0 = TOP_RADIUS * (RUNE_IN - 0.08);
    const r1 = TOP_RADIUS * (RUNE_OUT + 0.08);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      uv.setXY(i, (r - r0) / (r1 - r0), 0.5);
    }
  }
  disposables.push(haloGeo);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = DAIS_TOP + 0.006;
  halo.renderOrder = 2;
  group.add(halo);

  // Energy arcs: two bright comets of light that run around the rune band.
  const arcTex = arcTexture();
  disposables.push(arcTex);
  const arcMat = new THREE.MeshBasicMaterial({
    map: arcTex,
    color: new THREE.Color(2.4, 1.55, 0.6),
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(arcMat);
  const arcGeo = new THREE.RingGeometry(TOP_RADIUS * (RUNE_IN - 0.02), TOP_RADIUS * (RUNE_OUT + 0.02), 160, 1);
  arcGeo.rotateX(-Math.PI / 2);
  disposables.push(arcGeo);
  const arcs = new THREE.Mesh(arcGeo, arcMat);
  arcs.position.y = DAIS_TOP + 0.008;
  arcs.renderOrder = 3;
  group.add(arcs);

  let flareLevel = 0;
  let glow = 0.5;

  return {
    group,
    get glow() {
      return glow;
    },
    flare(strength = 1) {
      flareLevel = Math.min(1.6, flareLevel + strength);
    },
    update(dt, elapsed) {
      flareLevel *= Math.exp(-dt * 2.4);
      const breathe = 0.5 + 0.5 * Math.sin(elapsed * 1.25);
      glow = 0.55 + 0.25 * breathe + flareLevel * 0.9;
      topMat.emissiveIntensity = 1.4 + 1.6 * glow;
      haloMat.opacity = 0.05 + 0.12 * glow;
      arcs.rotation.y = -elapsed * 0.32;
      arcMat.opacity = 0.45 + 0.4 * glow;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };
}

/** Lathe for one tier: rounded bevel at the top edge, small chamfer at the bottom, flat top annulus. */
function tierGeometry(t: Tier, innerTop: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const b = BEVEL;
  pts.push(new THREE.Vector2(t.r - b * 0.6, t.y0));
  pts.push(new THREE.Vector2(t.r, t.y0 + b * 0.5));
  pts.push(new THREE.Vector2(t.r, (t.y0 + t.y1) * 0.5));
  pts.push(new THREE.Vector2(t.r, t.y1 - b));
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(t.r - b + b * Math.cos(a), t.y1 - b + b * Math.sin(a)));
  }
  if (innerTop < t.r - b - 0.005) pts.push(new THREE.Vector2(innerTop, t.y1));
  const segments = 160;
  // A bottom-to-top profile gives outward normals and outward-facing triangles.
  const geo = new THREE.LatheGeometry(pts, segments);
  // Arc-length v and a u that repeats one stone block every ~0.55 units of circumference.
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const blocks = Math.round((2 * Math.PI * t.r) / 0.55 / 8) * 8;
  const uv = geo.getAttribute('uv');
  const n = pts.length;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < n; j++) {
      uv.setXY(i * n + j, (i / segments) * (blocks / 8), lens[j] / total);
    }
  }
  return geo;
}

function buildSideTextures(fine: Float32Array, coarse: Float32Array) {
  const W = 512;
  const H = 256;
  const BLOCKS = 8;
  const height = new Float32Array(W * H);
  const map = new Uint8Array(W * H * 4);
  const orm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const bx = Math.floor(u * BLOCKS);
      // Stagger the seam slightly per block so it does not look machined.
      const fx = u * BLOCKS - bx;
      const seamPx = Math.min(fx, 1 - fx) * (W / BLOCKS);
      const seam = 1 - smoothstep(0.5, 5, seamPx);
      const n1 = sampleField(fine, 256, u * 2, v);
      const n2 = sampleField(coarse, 256, u, v * 0.5);
      const chip = smoothstep(0.62, 0.72, sampleField(fine, 256, u * 3 + 0.3, v * 1.5 + 0.2)) * (seam > 0.05 ? 1 : 0.3);
      // A carved running-wave band around the middle of every tier.
      const waveY = 0.52 + 0.07 * Math.sin(u * Math.PI * 2 * BLOCKS * 2);
      const wave = 1 - smoothstep(0.008, 0.02, Math.abs(v - waveY));
      const band = (1 - smoothstep(0.004, 0.012, Math.abs(v - 0.4))) + (1 - smoothstep(0.004, 0.012, Math.abs(v - 0.64)));
      const tone = 0.92 + 0.16 * hash2(bx, 3, 5);
      let h = 0.6 + 0.18 * (n1 - 0.5) + 0.12 * (n2 - 0.5);
      h -= seam * 0.55 + chip * 0.18 + wave * 0.28 + band * 0.16;
      height[y * W + x] = h;
      const mixv = clamp01(n2 * 1.2 - 0.1);
      const carve = clamp01(seam + wave * 0.7 + band * 0.6 + chip * 0.5);
      // Weathering: darker near the bottom of each tier, warm sun-bleached near the top.
      const grime = (1 - smoothstep(0.0, 0.3, v)) * 0.25;
      const i = (y * W + x) * 4;
      const f = tone * (0.9 + 0.2 * n1) * (1 - carve * 0.45 - grime);
      map[i] = Math.round(clamp01(lerp(STONE_A[0], STONE_B[0], mixv) * f) * 255);
      map[i + 1] = Math.round(clamp01(lerp(STONE_A[1], STONE_B[1], mixv) * f) * 255);
      map[i + 2] = Math.round(clamp01(lerp(STONE_A[2], STONE_B[2], mixv) * f) * 255);
      map[i + 3] = 255;
      orm[i] = Math.round((1 - carve * 0.55) * 255);
      orm[i + 1] = Math.round(clamp01(0.82 + 0.12 * n1 + carve * 0.05) * 255);
      orm[i + 2] = 0;
      orm[i + 3] = 255;
    }
  }
  return { map, orm, normal: normalFromHeight(height, W, H, 2.2, true, false) };
}

function buildTopTextures(fine: Float32Array, coarse: Float32Array) {
  const N = 1024;
  const R = N / 2;
  // Vector masks: red = carved grooves, green = gold inlay, blue = rune glyphs.
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  ctx.translate(R, R);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // Grooves: drawn sharp on their own layer, then blurred once onto the mask for a soft bevel.
  const gc = makeCanvas(N, N).getContext('2d')!;
  gc.translate(R, R);
  gc.lineCap = 'round';
  gc.strokeStyle = '#ff0000';
  const ring = (rn: number, w: number) => {
    gc.lineWidth = w * R;
    gc.beginPath();
    gc.arc(0, 0, rn * R, 0, Math.PI * 2);
    gc.stroke();
  };
  ring(0.185, 0.014);
  ring(0.535, 0.012);
  ring(0.79, 0.012);
  ring(0.985, 0.012);
  const seams = (n: number, r0: number, r1: number, off: number, w: number) => {
    gc.lineWidth = w * R;
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      gc.beginPath();
      gc.moveTo(Math.cos(a) * r0 * R, Math.sin(a) * r0 * R);
      gc.lineTo(Math.cos(a) * r1 * R, Math.sin(a) * r1 * R);
      gc.stroke();
    }
  };
  seams(8, 0.19, 0.53, 0.5, 0.011);
  seams(24, 0.795, 0.98, 0, 0.01);
  // A second, finer course of slabs splitting the inner ring.
  gc.lineWidth = 0.008 * R;
  gc.beginPath();
  gc.arc(0, 0, 0.36 * R, 0, Math.PI * 2);
  gc.stroke();
  seams(16, 0.36, 0.53, 0, 0.008);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'blur(1.6px)';
  ctx.drawImage(gc.canvas, 0, 0);
  ctx.restore();

  // Gold inlay: eight-point star, the two rune band rails and studs on the outer seams.
  ctx.save();
  ctx.fillStyle = '#00ff00';
  ctx.strokeStyle = '#00ff00';
  const star = (rOut: number, rIn: number, pts: number, rot: number) => {
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const rr = (i % 2 ? rIn : rOut) * R;
      const a = rot + (i / (pts * 2)) * Math.PI * 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  };
  star(0.165, 0.06, 8, -Math.PI / 2);
  ctx.lineWidth = 0.007 * R;
  ctx.beginPath();
  ctx.arc(0, 0, RUNE_IN * R - 0.004 * R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, RUNE_OUT * R + 0.004 * R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.003 * R;
  ctx.beginPath();
  ctx.arc(0, 0, RUNE_IN * R + 0.012 * R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, RUNE_OUT * R - 0.012 * R, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = 0.9 * R;
    ctx.save();
    ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.rotate(a);
    ctx.beginPath();
    const s = i % 2 ? 0.012 : 0.02;
    ctx.moveTo(-s * R * 1.6, 0);
    ctx.lineTo(0, -s * R);
    ctx.lineTo(s * R * 1.6, 0);
    ctx.lineTo(0, s * R);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Centre boss.
  ctx.beginPath();
  ctx.arc(0, 0, 0.03 * R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Runes: procedural glyphs from a 3x4 anchor grid, oriented along the ring.
  ctx.save();
  ctx.strokeStyle = '#0000ff';
  ctx.lineJoin = 'round';
  const rand = rng(77);
  const COUNT = 30;
  const glyphH = (RUNE_OUT - RUNE_IN - 0.05) * R;
  const glyphW = glyphH * 0.55;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const rr = ((RUNE_IN + RUNE_OUT) / 2) * R;
    ctx.save();
    ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.rotate(a + Math.PI / 2);
    ctx.lineWidth = 0.0075 * R;
    const P = (gx: number, gy: number): [number, number] => [(gx / 2 - 0.5) * glyphW, (gy / 3 - 0.5) * glyphH];
    // Every rune has a stave plus 2-3 branches, like old carved alphabets.
    const stave = rand() < 0.75;
    if (stave) {
      const sx = rand() < 0.5 ? 1 : rand() < 0.5 ? 0 : 2;
      ctx.beginPath();
      ctx.moveTo(...P(sx, 0));
      ctx.lineTo(...P(sx, 3));
      ctx.stroke();
    }
    const branches = 2 + Math.floor(rand() * 2);
    for (let b = 0; b < branches; b++) {
      const x0 = Math.floor(rand() * 3);
      const y0 = Math.floor(rand() * 4);
      let x1 = Math.floor(rand() * 3);
      let y1 = Math.floor(rand() * 4);
      if (x1 === x0 && y1 === y0) {
        x1 = (x0 + 1) % 3;
        y1 = (y0 + 1) % 4;
      }
      ctx.beginPath();
      ctx.moveTo(...P(x0, y0));
      ctx.lineTo(...P(x1, y1));
      ctx.stroke();
    }
    if (rand() < 0.3) {
      ctx.beginPath();
      ctx.arc(...P(1, 1.5), glyphW * 0.18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // A small dot between runes.
    const ad = ((i + 0.5) / COUNT) * Math.PI * 2;
    ctx.beginPath();
    ctx.fillStyle = '#0000ff';
    ctx.arc(Math.cos(ad) * rr, Math.sin(ad) * rr, 0.006 * R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const { r: groove, g: inlay, b: rune } = canvasChannels(canvas);

  const height = new Float32Array(N * N);
  const map = new Uint8Array(N * N * 4);
  const orm = new Uint8Array(N * N * 4);
  const emi = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = y * N + x;
      const px = (x + 0.5) / R - 1;
      const py = (y + 0.5) / R - 1;
      const rn = Math.hypot(px, py);
      const ang = Math.atan2(py, px);
      const u = x / N;
      const v = y / N;
      const n1 = sampleField(fine, 256, u * 3, v * 3);
      const n2 = sampleField(coarse, 256, u, v);
      const speck = sampleField(fine, 256, u * 9 + 0.37, v * 9 + 0.11);
      // Which slab this pixel is on, for per-slab tone.
      let slab = 0;
      if (rn > 0.795) slab = 100 + Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 24);
      else if (rn > 0.36 && rn < 0.535) slab = 200 + Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16);
      else if (rn > 0.19 && rn < 0.36) slab = 300 + Math.floor(((ang + Math.PI) / (Math.PI * 2) + 0.0625) * 8);
      const tone = 0.9 + 0.2 * hash2(slab, 7, 3);
      const darkZone = rn < 0.185 || (rn > RUNE_IN && rn < RUNE_OUT);
      const g = groove[o];
      const gi = inlay[o];
      const k = rune[o];

      let h = 0.6 + 0.12 * (n1 - 0.5) + 0.08 * (n2 - 0.5);
      if (darkZone) h = 0.55 + 0.03 * (n1 - 0.5);
      h -= g * 0.5;
      h += gi * 0.06;
      h -= k * 0.2;
      // Worn slab edges: slightly lower toward grooves.
      height[o] = h;

      let cr: number;
      let cg: number;
      let cb: number;
      let rough: number;
      let metal = 0;
      if (darkZone) {
        const d = 0.85 + 0.3 * n1;
        cr = DARK[0] * d;
        cg = DARK[1] * d;
        cb = DARK[2] * d;
        rough = 0.36 + 0.12 * n2;
      } else {
        const m = clamp01(n2 * 1.3 - 0.15);
        let f = tone * (0.9 + 0.2 * n1);
        if (speck > 0.68) f *= 0.82;
        else if (speck < 0.3) f *= 1.06;
        cr = lerp(STONE_A[0], STONE_B[0], m) * f;
        cg = lerp(STONE_A[1], STONE_B[1], m) * f;
        cb = lerp(STONE_A[2], STONE_B[2], m) * f;
        rough = 0.78 + 0.14 * n1;
      }
      // Worn, dusty centre where crabs stand.
      const worn = (1 - smoothstep(0.2, 0.5, rn)) * 0.06;
      const gd = 1 - g * 0.5;
      cr = cr * gd + worn;
      cg = cg * gd + worn;
      cb = cb * gd + worn;
      if (gi > 0.02) {
        const gn = 0.82 + 0.3 * n1;
        cr = lerp(cr, GOLD[0] * gn, gi);
        cg = lerp(cg, GOLD[1] * gn, gi);
        cb = lerp(cb, GOLD[2] * gn, gi);
        rough = lerp(rough, 0.26 + 0.1 * n2, gi);
        metal = gi;
      }
      if (k > 0.02) {
        cr = lerp(cr, RUNE[0], k);
        cg = lerp(cg, RUNE[1], k);
        cb = lerp(cb, RUNE[2], k);
        rough = lerp(rough, 0.35, k);
        metal = Math.max(metal, k * 0.85);
      }
      const i = o * 4;
      map[i] = Math.round(clamp01(cr) * 255);
      map[i + 1] = Math.round(clamp01(cg) * 255);
      map[i + 2] = Math.round(clamp01(cb) * 255);
      map[i + 3] = 255;
      orm[i] = Math.round(clamp01(1 - g * 0.65) * 255);
      orm[i + 1] = Math.round(clamp01(rough) * 255);
      orm[i + 2] = Math.round(clamp01(metal) * 255);
      orm[i + 3] = 255;
      // Runes glow; the gold rails of the band glow faintly.
      const railGlow = gi * (rn > RUNE_IN - 0.03 && rn < RUNE_OUT + 0.03 ? 0.22 : rn < 0.2 ? 0.16 : 0.0);
      const e = clamp01(k + railGlow);
      emi[i] = Math.round(e * 255);
      emi[i + 1] = Math.round(e * 0.62 * 255);
      emi[i + 2] = Math.round(e * 0.24 * 255);
      emi[i + 3] = 255;
    }
  }
  const nn = normalFromHeight(height, N, N, 3.0, false, false);
  return { map, orm, normal: nn, emissive: emi };
}

function haloTexture(): THREE.DataTexture {
  const W = 128;
  const data = new Uint8Array(W * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // Bright in the band, soft falloff either side.
      const d = Math.abs(u - 0.5) / 0.5;
      const a = Math.pow(1 - smoothstep(0.0, 1.0, d), 2.2);
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(a * 255);
      data[i + 3] = 255;
    }
  }
  const t = dataTexture(data, W, 4, false);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** Polar texture for the energy ring: soft radial band, two comet-shaped bright arcs. */
function arcTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = makeCanvas(N, N);
  const ctx = c.getContext('2d')!;
  const cx = N / 2;
  const g = ctx.createConicGradient(0, cx, cx);
  // Comet heads with long fading tails, twice around the circle.
  for (const base of [0, 0.5]) {
    g.addColorStop(base + 0.0, 'rgba(255,255,255,0)');
    g.addColorStop(base + 0.32, 'rgba(255,255,255,0)');
    g.addColorStop(base + 0.42, 'rgba(255,255,255,0.18)');
    g.addColorStop(base + 0.47, 'rgba(255,255,255,0.65)');
    g.addColorStop(base + 0.485, 'rgba(255,255,255,1)');
    g.addColorStop(base + 0.495, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  // Keep only the band, soft at both edges (RingGeometry UVs map the ring to the square).
  ctx.globalCompositeOperation = 'destination-in';
  const rIn = (RUNE_IN - 0.02) / (RUNE_OUT + 0.02);
  const r = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  r.addColorStop(0, 'rgba(0,0,0,0)');
  r.addColorStop(rIn, 'rgba(0,0,0,0)');
  r.addColorStop(rIn + (1 - rIn) * 0.5, 'rgba(0,0,0,1)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
