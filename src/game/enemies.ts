// Scraplings and Rustclaw Scavengers: wander near their spawn, aggro (with their pack), chase,
// claw, leash back home, die, drop cogs and respawn out of sight.
import * as THREE from 'three';
import type { Game } from './game';
import type { Unit } from './unit';
import { C } from './vfx/vfx';
import { damp, rand, TAU, turnToward, yawTo } from './util';

export type EnemyKind = 'scrapling' | 'scavenger';

interface Stats {
  name: string;
  level: number;
  hp: number;
  speed: number;
  aggro: number;
  dmg: [number, number];
  swing: number;
  xp: number;
  leash: number;
  respawn: number;
}

export const ENEMY_STATS: Record<EnemyKind, Stats> = {
  scrapling: { name: 'Scrapling', level: 1, hp: 42, speed: 4.0, aggro: 8.5, dmg: [4, 6], swing: 2.0, xp: 20, leash: 30, respawn: 30 },
  scavenger: { name: 'Rustclaw Scavenger', level: 2, hp: 105, speed: 4.3, aggro: 11, dmg: [7, 10], swing: 2.2, xp: 50, leash: 32, respawn: 45 },
};

/** LED eye colours (design: Scraplings have one red eye; Scavengers glow amber). */
const LED: Record<EnemyKind, string> = { scrapling: '#ff2a1a', scavenger: '#ffb020' };

const v1 = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();

type State = 'idle' | 'chase' | 'leash' | 'dead' | 'gone';

export class Enemy {
  state: State = 'idle';
  readonly stats: Stats;
  pack: Enemy[] = [];
  /** Boss adds never respawn. */
  isAdd = false;
  private nextSwing = 0;
  private wanderAt = 0;
  private wander: THREE.Vector3 | null = null;
  private wanderSideways = false;
  private leapCd = 0;
  private leap: { fromX: number; fromZ: number; toX: number; toZ: number; t: number } | null = null;
  private deadAt = 0;
  private rise = 0;
  private velX = 0;
  private velZ = 0;

  constructor(
    private readonly game: Game,
    readonly unit: Unit,
    readonly kind: EnemyKind,
    readonly home: THREE.Vector3,
    readonly wanderRadius: number,
  ) {
    this.stats = ENEMY_STATS[kind];
    unit.ctrl = this;
    unit.level = this.stats.level;
    unit.maxHp = unit.hp = this.stats.hp;
    unit.setBaseTint(LED[kind]);
    this.wanderAt = game.time + rand(1, 6);
    this.leapCd = game.time + 2;
  }

  get alive(): boolean {
    return this.unit.alive;
  }

  onDamaged(src: Unit | null): void {
    if (this.state === 'idle' && src) this.aggro(true);
  }

  aggro(withPack: boolean): void {
    if (this.state !== 'idle' || !this.unit.alive) return;
    this.state = 'chase';
    this.unit.express('angry', 2);
    this.nextSwing = Math.max(this.nextSwing, this.game.time + 0.6);
    this.game.audio.sfx('sfx-servo-whir', { volume: 0.25, pitch: 0.2 });
    if (withPack) for (const m of this.pack) if (m !== this) m.aggro(false);
  }

  onDeath(): void {
    this.state = 'dead';
    this.deadAt = this.game.time;
    this.leap = null;
    this.unit.lift = 0;
  }

  /** Back to spawn instantly (player died, boss reset). */
  evade(): void {
    if (this.state === 'chase') {
      this.state = 'leash';
      this.unit.invulnerable = true;
    }
  }

  /** Remove from the world (boss adds when the fight ends). */
  despawn(): void {
    this.state = 'gone';
    this.unit.alive = false;
    this.unit.hidden = true;
    this.unit.rig.root.visible = false;
  }

  respawnAt(x: number, z: number): void {
    const u = this.unit;
    u.alive = true;
    u.hidden = false;
    u.hp = u.maxHp;
    u.invulnerable = false;
    u.stunUntil = u.slowUntil = 0;
    u.lift = 0;
    u.rig.root.visible = true;
    u.motion.stop(undefined, 0);
    u.express('neutral', 0.1);
    u.teleport(this.game.world, x, z, rand(0, TAU));
    u.setBaseTint(LED[this.kind]);
    this.state = 'idle';
    this.rise = 0.6;
    this.game.vfx.burrow(u.pos);
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const p = g.player.unit;
    if (this.state === 'gone') return;

    if (this.state === 'dead') {
      const t = now - this.deadAt;
      if (t > 8 && !u.hidden) {
        u.lift = -Math.min(1.4, (t - 8) * 0.9) * u.height;
        u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
        if (t > 9.6) {
          u.hidden = true;
          u.rig.root.visible = false;
        }
      }
      if (!this.isAdd && t > this.stats.respawn && this.canRespawnUnseen()) {
        const a = rand(0, TAU);
        const r = rand(0, this.wanderRadius * 0.7);
        this.respawnAt(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r);
      }
      return;
    }

    if (this.rise > 0) {
      this.rise = Math.max(0, this.rise - dt);
      u.lift = -this.rise * 1.3 * u.height;
    }

    const stunned = u.stunned(now);
    let tx = 0;
    let tz = 0;
    let speed = 0;
    let faceYaw: number | null = null;

    if (this.leap) {
      this.updateLeap(dt);
      u.feedLocomotion(dt);
      return;
    }

    if (this.state === 'idle') {
      if (p.alive && !g.controlsLocked && u.distTo(p) < this.stats.aggro && Math.abs(p.pos.y - u.pos.y) < 3) this.aggro(true);
      if (now > this.wanderAt) {
        this.wanderAt = now + rand(4, 9);
        const a = rand(0, TAU);
        const r = rand(0, this.wanderRadius);
        this.wander = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        this.wanderSideways = Math.random() < 0.6;
      }
      if (this.wander) {
        const dx = this.wander.x - u.pos.x;
        const dz = this.wander.z - u.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) this.wander = null;
        else {
          tx = dx / d;
          tz = dz / d;
          speed = 1.3;
          const travel = Math.atan2(tx, tz);
          faceYaw = this.wanderSideways ? travel + Math.PI / 2 : travel;
        }
      }
    } else if (this.state === 'chase') {
      const fromHome = Math.hypot(u.pos.x - this.home.x, u.pos.z - this.home.z);
      if (!p.alive || g.controlsLocked || (!this.isAdd && fromHome > this.stats.leash)) {
        this.state = 'leash';
        u.invulnerable = true;
        g.hud.floats.spawn(u, 'Evade', 'info');
      } else {
        const gap = u.gapTo(p);
        faceYaw = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
        if (gap > 0.9) {
          const d = u.distTo(p) || 1;
          tx = (p.pos.x - u.pos.x) / d;
          tz = (p.pos.z - u.pos.z) / d;
          speed = this.stats.speed;
        }
        if (this.kind === 'scavenger' && !stunned && now > this.leapCd && gap > 3.5 && gap < 10 && g.player.lineOfSight(u)) {
          this.startLeap();
        } else if (!stunned && gap <= 1.15 && now >= this.nextSwing) {
          this.nextSwing = now + this.stats.swing * rand(0.9, 1.1);
          u.act('attack_swipe', {
            upper: true,
            onHit: () => {
              if (!u.alive || !p.alive || u.gapTo(p) > 2) return;
              g.combat.damage(u, p, rand(this.stats.dmg[0], this.stats.dmg[1]));
              g.vfx.sparks(p.centre(v1), C.ember, 6, 4);
            },
          });
        }
      }
    } else if (this.state === 'leash') {
      const dx = this.home.x - u.pos.x;
      const dz = this.home.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.5 * dt);
      if (d < 1) {
        this.state = 'idle';
        u.invulnerable = false;
        u.hp = u.maxHp;
        u.express('neutral', 0.1);
      } else {
        tx = dx / d;
        tz = dz / d;
        speed = 7;
        faceYaw = Math.atan2(tx, tz);
      }
    }

    if (stunned) speed = 0;
    speed *= u.speedMul(now);
    this.velX = damp(this.velX, tx * speed, 10, dt);
    this.velZ = damp(this.velZ, tz * speed, 10, dt);
    let nx = u.pos.x + this.velX * dt;
    let nz = u.pos.z + this.velZ * dt;
    if (u.pushTime > 0) {
      u.pushTime -= dt;
      nx += u.pushX * dt;
      nz += u.pushZ * dt;
    }
    u.moveTo(g.world, nx, nz, dt);
    if (faceYaw !== null && !stunned) u.setYaw(turnToward(u.yaw, faceYaw, 7, dt));
    u.feedLocomotion(dt);
  }

  private startLeap(): void {
    const g = this.game;
    const u = this.unit;
    const p = g.player.unit;
    const d = u.distTo(p) || 1;
    const back = (u.radius + p.radius + 0.2) / d;
    this.leap = {
      fromX: u.pos.x,
      fromZ: u.pos.z,
      toX: p.pos.x + (u.pos.x - p.pos.x) * back,
      toZ: p.pos.z + (u.pos.z - p.pos.z) * back,
      t: 0,
    };
    this.leapCd = g.time + rand(7, 9);
    u.setYaw(yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z));
    // Crouch to landing of the recorded jump, stretched over the 0.75 s leap.
    u.act('jump', { fade: 0.06, from: 0.95, to: 1.6, speed: 0.87 });
    g.audio.sfx('sfx-servo-whir', { volume: 0.5 });
    g.hud.floats.spawn(u, 'Leap!', 'info');
  }

  private updateLeap(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const l = this.leap!;
    const dur = 0.75;
    l.t += dt;
    const k = Math.min(1, l.t / dur);
    const x = l.fromX + (l.toX - l.fromX) * k;
    const z = l.fromZ + (l.toZ - l.fromZ) * k;
    u.lift = Math.sin(k * Math.PI) * 2.2;
    u.moveTo(g.world, x, z, dt);
    u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
    if (k >= 1) {
      this.leap = null;
      u.lift = 0;
      g.vfx.slamImpact(u.pos, 1.6);
      g.follow.shake(0.1, 0.2);
      const p = g.player.unit;
      if (p.alive && u.gapTo(p) < 1.6) g.combat.damage(u, p, rand(8, 11));
      this.nextSwing = g.time + 0.8;
    }
  }

  private canRespawnUnseen(): boolean {
    const g = this.game;
    const p = g.player.unit;
    if (Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z) < 22) return false;
    const cam = g.camera;
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    v1.set(this.home.x, g.world.heightAt(this.home.x, this.home.z) + 0.5, this.home.z);
    return !frustum.containsPoint(v1) || cam.position.distanceTo(v1) > 45;
  }
}
