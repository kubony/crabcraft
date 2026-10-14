// Walk test for the zone: a 0.75-radius crab steers along waypoint routes at 5 units/s using
// only the World contract (heightAt + resolveCollision). Reports arrival, time and height jumps.
import * as THREE from 'three';
import type { PoiId, World } from '../src/world/types';
import { ROADS } from '../src/world/layout';

export interface RouteResult {
  name: string;
  ok: boolean;
  seconds: number;
  distance: number;
  maxStepRise: number;
  riseAt?: [number, number];
  stuckAt?: [number, number];
}

type WP = [number, number] | PoiId;

export function walkTest(world: World): RouteResult[] {
  const P = (id: PoiId): [number, number] => [world.pois[id].position.x, world.pois[id].position.z];
  const road = (i: number, reverse = false) => {
    const pts = ROADS[i].points.map((p) => [p[0], p[1]] as [number, number]);
    return reverse ? pts.reverse() : pts;
  };
  const routes: { name: string; wps: WP[] }[] = [
    { name: 'spawn -> shore', wps: ['spawn', [12, 1], ...road(0), ...road(1), 'shore'] },
    { name: 'shore -> wreck (gangway foot)', wps: ['shore', [114, 50], [118, 80], [122, 100], [121, 112], [127, 124], [133, 133], 'wreck'] },
    { name: 'wreck -> boss arena', wps: ['wreck', 'bossArena'] },
    { name: 'shore -> lighthouse (cliff path)', wps: ['shore', [114, 17], [104, 14], [92, 9], ...road(6), 'lighthouse'] },
    { name: 'lighthouse -> beacon (bridge)', wps: ['lighthouse', [174.5, -126], 'beacon'] },
    { name: 'spawn -> grove', wps: ['spawn', [-8, 7], [-12, -1], ...road(3), ...road(4), 'grove'] },
    { name: 'spawn -> forge', wps: ['spawn', [-8, 7], [-14, -2], 'forge'] },
    { name: 'spawn -> chapel', wps: ['spawn', [8, 6], [8, -7], [0, -14], 'chapel'] },
    { name: 'spawn -> gate (Grukk)', wps: ['spawn', [8, 6], [14, 2], ...road(0), 'npc:grukk'] },
    { name: 'spawn -> tavern', wps: ['spawn', [-6, 12], [-1, 22], 'tavern'] },
  ];
  const out: RouteResult[] = [];
  const v = new THREE.Vector2();
  for (const r of routes) {
    const pts = r.wps.map((w) => (typeof w === 'string' ? P(w) : w));
    let [x, z] = pts[0];
    let y = world.heightAt(x, z);
    let t = 0;
    let dist = 0;
    let maxRise = 0;
    let riseAt: [number, number] | undefined;
    let ok = true;
    let stuckAt: [number, number] | undefined;
    const dt = 1 / 30;
    for (let i = 1; i < pts.length && ok; i++) {
      const [tx, tz] = pts[i];
      let lastProgress = t;
      let best = Infinity;
      while (true) {
        const dx = tx - x;
        const dz = tz - z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) break;
        if (d < best - 0.05) {
          best = d;
          lastProgress = t;
        }
        if (t - lastProgress > 4) {
          ok = false;
          stuckAt = [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
          break;
        }
        const step = Math.min(5 * dt, d);
        // Slide along obstacles: try straight, then deflect left/right.
        let moved = false;
        for (const ang of [0, 0.6, -0.6, 1.2, -1.2]) {
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const ux = (dx / d) * c - (dz / d) * s;
          const uz = (dx / d) * s + (dz / d) * c;
          world.resolveCollision(x + ux * step, z + uz * step, 0.75, v);
          if (Math.hypot(v.x - x, v.y - z) > step * 0.3) {
            const ny = world.heightAt(v.x, v.y);
            if (Math.abs(ny - y) > maxRise) {
              maxRise = Math.abs(ny - y);
              riseAt = [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10];
            }
            dist += Math.hypot(v.x - x, v.y - z);
            x = v.x;
            z = v.y;
            y = ny;
            moved = true;
            break;
          }
        }
        t += dt;
        if (!moved && t - lastProgress > 4) {
          ok = false;
          stuckAt = [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
          break;
        }
        if (t > 600) {
          ok = false;
          break;
        }
      }
    }
    out.push({ name: r.name, ok, seconds: Math.round(t * 10) / 10, distance: Math.round(dist), maxStepRise: Math.round(maxRise * 100) / 100, riseAt, stuckAt });
  }
  return out;
}

/** Frame-time probe: renders `frames` frames back to back (synchronised with a 1-pixel read) per view. */
export function perfProbe(
  world: World,
  engine: { renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; renderOnce(): void },
  views: Record<string, { p: number[]; t: number[]; fov?: number }>,
  frames = 40,
): { view: string; ms: number; fps: number; calls: number; triangles: number }[] {
  const out: { view: string; ms: number; fps: number; calls: number; triangles: number }[] = [];
  const gl = engine.renderer.getContext();
  const px = new Uint8Array(4);
  const cam = engine.camera;
  for (const [name, v] of Object.entries(views)) {
    cam.position.set(v.p[0], v.p[1], v.p[2]);
    cam.fov = v.fov ?? 50;
    cam.updateProjectionMatrix();
    cam.lookAt(v.t[0], v.t[1], v.t[2]);
    cam.updateMatrixWorld();
    for (let i = 0; i < 8; i++) {
      world.update(1 / 60, 10 + i / 60, cam);
      engine.renderOnce();
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    let calls = 0;
    let tris = 0;
    for (let i = 0; i < frames; i++) {
      world.update(1 / 60, 11 + i / 60, cam);
      engine.renderOnce();
      calls = engine.renderer.info.render.calls;
      tris = engine.renderer.info.render.triangles;
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / frames;
    out.push({ view: name, ms: Math.round(ms * 100) / 100, fps: Math.round(1000 / ms), calls, triangles: tris });
  }
  return out;
}

/** GPU time per frame (EXT_disjoint_timer_query_webgl2), median over `frames`, plus CPU submit time. */
export async function gpuProbe(
  world: World,
  engine: { renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; renderOnce(): void },
  views: Record<string, { p: number[]; t: number[]; fov?: number }>,
  frames = 30,
): Promise<{ view: string; gpuMs: number; gpuMin: number; cpuMs: number; calls: number; triangles: number }[]> {
  const gl = engine.renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return [];
  const out: { view: string; gpuMs: number; gpuMin: number; cpuMs: number; calls: number; triangles: number }[] = [];
  const cam = engine.camera;
  const wait = () => new Promise((r) => setTimeout(r, 30));
  for (const [name, v] of Object.entries(views)) {
    cam.position.set(v.p[0], v.p[1], v.p[2]);
    cam.fov = v.fov ?? 50;
    cam.updateProjectionMatrix();
    cam.lookAt(v.t[0], v.t[1], v.t[2]);
    cam.updateMatrixWorld();
    for (let i = 0; i < 6; i++) {
      world.update(1 / 60, 20 + i / 60, cam);
      engine.renderOnce();
      await wait();
    }
    const gpu: number[] = [];
    const cpu: number[] = [];
    let calls = 0;
    let tris = 0;
    for (let i = 0; i < frames; i++) {
      const q = gl.createQuery()!;
      const t0 = performance.now();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      world.update(1 / 60, 21 + i / 60, cam);
      engine.renderOnce();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      cpu.push(performance.now() - t0);
      calls = engine.renderer.info.render.calls;
      tris = engine.renderer.info.render.triangles;
      // Wait for the result (frames are spaced so the GPU is idle between them).
      for (let k = 0; k < 100; k++) {
        await wait();
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      }
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    gpu.sort((a, b) => a - b);
    cpu.sort((a, b) => a - b);
    const med = (a: number[]) => (a.length ? Math.round(a[Math.floor(a.length / 2)] * 100) / 100 : -1);
    out.push({ view: name, gpuMs: med(gpu), gpuMin: Math.round((gpu[0] ?? -1) * 100) / 100, cpuMs: med(cpu), calls, triangles: tris });
  }
  return out;
}

/** POIs and spawn points must be standable: not inside a solid or blocked cell, sensible height. */
export function validatePoints(world: World): string[] {
  const issues: string[] = [];
  const v = new THREE.Vector2();
  const check = (label: string, p: THREE.Vector3) => {
    world.resolveCollision(p.x, p.z, 0.75, v);
    const moved = Math.hypot(v.x - p.x, v.y - p.z);
    const h = world.heightAt(p.x, p.z);
    if (moved > 0.05) issues.push(`${label} pushed ${moved.toFixed(2)} by collision at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    if (Math.abs(h - p.y) > 0.05) issues.push(`${label} y ${p.y.toFixed(2)} != heightAt ${h.toFixed(2)}`);
    if (h < 0.1) issues.push(`${label} below/at sea level (${h.toFixed(2)})`);
  };
  for (const [id, poi] of Object.entries(world.pois)) check(`poi ${id}`, poi.position);
  for (const s of world.spawns) s.points.forEach((p, i) => check(`spawn ${s.id}[${i}]`, p));
  // Line of sight sanity: across the open square is clear, through a house is blocked.
  const a = new THREE.Vector3(-10, 5.6, 8.5);
  const b = new THREE.Vector3(10, 5.6, 8.5);
  if (world.raycastSolid(a, b) !== null) issues.push('raycast across the square should be clear');
  const a2 = new THREE.Vector3(-8, 5.5, 8);
  const b2 = new THREE.Vector3(8, 5.5, -8);
  if (world.raycastSolid(a2, b2) === null) issues.push('raycast through the fountain should hit');
  const c = new THREE.Vector3(21, 6, -8);
  const d = new THREE.Vector3(21, 6, -30);
  if (world.raycastSolid(c, d) === null) issues.push('raycast through house h-ne should hit');
  const e = new THREE.Vector3(50, 40, 0);
  const f = new THREE.Vector3(50, -5, 0);
  if (world.raycastSolid(e, f) === null) issues.push('raycast into the ground should hit');
  return issues;
}
