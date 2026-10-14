// Route finding for the quest hint only (crabs still steer straight). Nodes are the world's POIs and
// spawn points, which the world places on streets, paths and decks; an edge exists when a crab can
// walk the straight segment (no solids, no cliff steps), tested with World.resolveCollision and
// World.heightAt. The hint then points at the next reachable waypoint instead of through a house.
import * as THREE from 'three';
import type { World } from '../world/types';

const STEP = 1.0;
const RADIUS = 0.45;
const MAX_EDGE = 75;
const MAX_RISE = 1.1;

const tmp = new THREE.Vector2();

export class NavHints {
  private nodes: THREE.Vector3[] = [];
  private adj: { to: number; cost: number }[][] = [];
  private path: THREE.Vector3[] = [];
  private goal = new THREE.Vector3(Infinity, 0, 0);
  private replanAt = 0;
  private checkAt = 0;
  private readonly next = new THREE.Vector3();

  constructor(private readonly world: World) {
    const pts: THREE.Vector3[] = [];
    for (const p of Object.values(world.pois)) pts.push(p.position.clone());
    for (const s of world.spawns) for (const p of s.points) pts.push(p.clone());
    // Drop near-duplicates.
    for (const p of pts) if (!this.nodes.some((n) => n.distanceTo(p) < 2)) this.nodes.push(p);
    this.adj = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > MAX_EDGE || !this.walkable(a, b)) continue;
        this.adj[i].push({ to: j, cost: d });
        this.adj[j].push({ to: i, cost: d });
      }
    }
  }

  /** Can a crab walk the straight segment a to b? */
  walkable(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const w = this.world;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / STEP));
    let prevY = w.heightAt(a.x, a.z);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const r = w.resolveCollision(x, z, RADIUS, tmp);
      // The end points themselves may sit against a wall (an NPC at a counter); be lenient there.
      if (i < n && Math.hypot(r.x - x, r.y - z) > 0.08) return false;
      const y = w.heightAt(x, z);
      if (Math.abs(y - prevY) > MAX_RISE * (d / n)) return false;
      prevY = y;
    }
    return true;
  }

  /**
   * Where the hint should point this frame for a player at `from` going to `goal`: the furthest
   * waypoint on the route that is directly walkable, or the goal itself.
   */
  waypoint(from: THREE.Vector3, goal: THREE.Vector3, now: number): THREE.Vector3 {
    if (goal.distanceToSquared(this.goal) > 1 || now >= this.replanAt) {
      this.goal.copy(goal);
      this.replanAt = now + 1.5;
      this.path = this.plan(from, goal);
    }
    // Skip waypoints we have reached or can already walk past.
    while (this.path.length > 1 && Math.hypot(this.path[0].x - from.x, this.path[0].z - from.z) < 3) this.path.shift();
    if (now >= this.checkAt) {
      this.checkAt = now + 0.3;
      for (let i = Math.min(this.path.length - 1, 3); i > 0; i--) {
        if (this.walkable(from, this.path[i])) {
          this.path.splice(0, i);
          break;
        }
      }
    }
    return this.next.copy(this.path[0] ?? goal);
  }

  private plan(from: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
    if (this.walkable(from, goal)) return [goal.clone()];
    const N = this.nodes.length;
    const S = N;
    const G = N + 1;
    const edgesFrom = (i: number): { to: number; cost: number }[] => {
      if (i === S) {
        const out: { to: number; cost: number }[] = [];
        for (let j = 0; j < N; j++) {
          const d = Math.hypot(this.nodes[j].x - from.x, this.nodes[j].z - from.z);
          if (d < MAX_EDGE && this.walkable(from, this.nodes[j])) out.push({ to: j, cost: d });
        }
        return out;
      }
      const out = i < N ? [...this.adj[i]] : [];
      if (i < N) {
        const n = this.nodes[i];
        const d = Math.hypot(goal.x - n.x, goal.z - n.z);
        if (d < MAX_EDGE && (d < 2 || this.walkable(n, goal))) out.push({ to: G, cost: d });
      }
      return out;
    };
    // Dijkstra over a few dozen nodes.
    const dist = new Array<number>(N + 2).fill(Infinity);
    const prev = new Array<number>(N + 2).fill(-1);
    const done = new Array<boolean>(N + 2).fill(false);
    dist[S] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N + 2; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === G) break;
      done[u] = true;
      for (const e of edgesFrom(u)) {
        const nd = dist[u] + e.cost;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
        }
      }
    }
    if (dist[G] === Infinity) return [goal.clone()];
    const out: THREE.Vector3[] = [];
    for (let v = prev[G]; v >= 0 && v !== S; v = prev[v]) out.unshift(this.nodes[v].clone());
    out.push(goal.clone());
    return out;
  }
}
