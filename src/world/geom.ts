// Procedural geometry helpers for the landmarks (fountain claw, lighthouse, wreck, pier).
import * as THREE from 'three';

/**
 * Tube along a polyline with a radius function r(t) (t = 0..1 along the path) and an optional
 * cross-section squash (x scale of the ring). Normals are smooth; uv.x around, uv.y along.
 */
export function tube(
  path: THREE.Vector3[],
  radius: (t: number) => number,
  radial = 16,
  opts: { squash?: (t: number) => number; capEnd?: boolean; up?: THREE.Vector3 } = {},
): THREE.BufferGeometry {
  const n = path.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const up = opts.up ?? new THREE.Vector3(0, 0, 1);
  let len = 0;
  const acc: number[] = [0];
  for (let i = 1; i < n; i++) {
    len += path[i].distanceTo(path[i - 1]);
    acc.push(len);
  }
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    N.crossVectors(up, T);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    N.normalize();
    B.crossVectors(T, N).normalize();
    const t = acc[i] / (len || 1);
    const r = radius(t);
    const sq = opts.squash ? opts.squash(t) : 1;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const cx = Math.cos(ang) * sq;
      const cy = Math.sin(ang);
      const nx = N.x * cx + B.x * cy;
      const ny = N.y * cx + B.y * cy;
      const nz = N.z * cx + B.z * cy;
      pos.push(path[i].x + nx * r, path[i].y + ny * r, path[i].z + nz * r);
      const nl = Math.hypot(N.x * Math.cos(ang) / sq + B.x * cy, N.y * Math.cos(ang) / sq + B.y * cy, N.z * Math.cos(ang) / sq + B.z * cy) || 1;
      nor.push((N.x * Math.cos(ang) / sq + B.x * cy) / nl, (N.y * Math.cos(ang) / sq + B.y * cy) / nl, (N.z * Math.cos(ang) / sq + B.z * cy) / nl);
      uv.push(j / radial, acc[i]);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  if (opts.capEnd) {
    const c = pos.length / 3;
    const p = path[n - 1];
    pos.push(p.x, p.y, p.z);
    T.subVectors(path[n - 1], path[n - 2]).normalize();
    nor.push(T.x, T.y, T.z);
    uv.push(0.5, len);
    for (let j = 0; j < radial; j++) idx.push((n - 1) * row + j, c, (n - 1) * row + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Quadratic/cubic Bezier sampled into points. */
export function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, n: number): THREE.Vector3[] {
  const c = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  return c.getPoints(n);
}

/** Lathe with uv.x around (scaled to world units) and uv.y along the profile length. */
export function lathe(profile: [number, number][], segments: number, uvScale = 1): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  // Re-map uvs: u around in units of the largest radius, v by profile arc length.
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const maxR = Math.max(...profile.map((p) => p[0]));
  const acc: number[] = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  for (let i = 0; i < uv.count; i++) {
    const j = i % pts.length;
    uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR * uvScale, acc[j] * uvScale);
  }
  void pos;
  return g;
}

/** Box whose uvs are in world units (so tiling textures keep their scale). */
export function worldBox(w: number, h: number, d: number, uvScale = 0.5): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const sx = ax > 0.5 ? d : w;
    const sy = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx * uvScale, uv.getY(i) * sy * uvScale);
  }
  return g;
}

export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s: number | [number, number, number] = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
  );
  return g.applyMatrix4(m);
}
