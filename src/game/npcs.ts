// Named NPCs (stand at their POI, greet the player, gesture now and then, talk) and ambient
// townsfolk (stroll between the town's spawn points with real locomotion).
import * as THREE from 'three';
import type { Poi } from '../world/types';
import type { Game } from './game';
import type { Unit } from './unit';
import type { NpcDef } from './quests';
import { TOWNSFOLK_BARKS } from './quests';
import { damp, pick, rand, TAU, turnToward, yawTo } from './util';

export class Npc {
  private helloCd = 0;
  private gestureAt: number;
  talking = false;
  /** While talking: a point to face instead of the player (the dialogue camera cheats the look). */
  lookAt: THREE.Vector3 | null = null;
  private lineIndex = 0;

  constructor(private readonly game: Game, readonly unit: Unit, readonly def: NpcDef, readonly poi: Poi) {
    unit.ctrl = this;
    unit.npcId = def.id;
    unit.title = def.title;
    this.gestureAt = game.time + rand(6, 16);
  }

  nextLine(): string {
    const l = this.def.lines[this.lineIndex % this.def.lines.length];
    this.lineIndex++;
    return l;
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const p = g.player.unit;
    const now = g.time;
    if (g.ending.active) {
      u.feedLocomotion(dt);
      return;
    }
    const d = u.distTo(p);
    const near = p.alive && d < 9;
    const look = this.talking && this.lookAt ? this.lookAt : p.pos;
    const want = near || this.talking ? yawTo(u.pos.x, u.pos.z, look.x, look.z) : this.poi.yaw;
    u.setYaw(turnToward(u.yaw, want, 2.6, dt));
    if (p.alive && d < 7 && now > this.helloCd && !this.talking && !u.motion.action) {
      this.helloCd = now + 40;
      u.act('gesture_hello');
      u.express('happy', 1.5);
    } else if (now > this.gestureAt && !this.talking && !u.motion.action) {
      this.gestureAt = now + rand(14, 26);
      if (u.culled) return;
      u.act(pick(this.def.gestures));
    }
    if (d > 12) this.helloCd = Math.min(this.helloCd, now + 3);
    u.feedLocomotion(dt);
  }
}

export class Townsfolk {
  private dest = new THREE.Vector3();
  private walking = false;
  private pauseUntil = 0;
  private speed = rand(1.3, 2.1);
  private sideways = false;
  private velX = 0;
  private velZ = 0;
  private barkCd = 0;
  /** Set by the ending: stand still and dance. */
  frozen = false;

  constructor(
    private readonly game: Game,
    readonly unit: Unit,
    private readonly points: THREE.Vector3[],
    private readonly radius: number,
  ) {
    unit.ctrl = this;
    this.pauseUntil = game.time + rand(0, 4);
  }

  bark(): void {
    const g = this.game;
    if (g.time < this.barkCd) return;
    this.barkCd = g.time + 4;
    g.say(this.unit, pick(TOWNSFOLK_BARKS));
    this.walking = false;
    this.pauseUntil = g.time + 4;
    this.unit.act('gesture_hello');
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    if (this.frozen || g.ending.active) {
      u.feedLocomotion(dt);
      return;
    }
    let tx = 0;
    let tz = 0;
    if (!this.walking && now > this.pauseUntil) {
      const base = pick(this.points);
      const a = rand(0, TAU);
      const r = rand(0, this.radius);
      this.dest.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
      this.walking = true;
      this.sideways = Math.random() < 0.55;
      this.speed = rand(1.3, 2.1);
    }
    if (this.walking) {
      const dx = this.dest.x - u.pos.x;
      const dz = this.dest.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) {
        this.walking = false;
        this.pauseUntil = now + rand(3, 9);
        if (Math.random() < 0.35 && !u.culled) u.act(pick(['gesture_paw', 'gesture_hello', 'claw_left', 'gesture_salute'] as const));
      } else {
        tx = dx / d;
        tz = dz / d;
        const travel = Math.atan2(tx, tz);
        u.setYaw(turnToward(u.yaw, this.sideways ? travel + Math.PI / 2 : travel, 3, dt));
      }
    }
    // Step around the player instead of walking through them.
    const p = g.player.unit;
    const pd = u.distTo(p);
    if (pd < u.radius + p.radius + 0.4 && pd > 0.01) {
      tx += ((u.pos.x - p.pos.x) / pd) * 1.5;
      tz += ((u.pos.z - p.pos.z) / pd) * 1.5;
    }
    this.velX = damp(this.velX, tx * this.speed, 6, dt);
    this.velZ = damp(this.velZ, tz * this.speed, 6, dt);
    const ox = u.pos.x;
    const oz = u.pos.z;
    u.moveTo(g.world, u.pos.x + this.velX * dt, u.pos.z + this.velZ * dt, dt);
    // Stuck against a wall: pick a new stroll.
    if (this.walking && Math.hypot(u.pos.x - ox, u.pos.z - oz) < this.speed * dt * 0.2) {
      this.walking = false;
      this.pauseUntil = now + rand(0.5, 2);
    }
    u.feedLocomotion(dt);
  }

  faceToward(target: Unit): void {
    this.unit.setYaw(yawTo(this.unit.pos.x, this.unit.pos.z, target.pos.x, target.pos.z));
  }
}
