// Corrodius, the Rust Tyrant (docs/design.md "Boss fight"). Three phases, telegraphed Anchor Slam,
// Rust Spray cone with a stacking slow, Scrapling adds and Undertow in phase 2, enrage in phase 3,
// and the death sequence where a small red crab steps out of the armour and walks into the sea.
import * as THREE from 'three';
import type { Poi } from '../world/types';
import type { Game } from './game';
import type { Unit } from './unit';
import type { Enemy } from './enemies';
import { skillDelay, skillWindow } from '../motion/skills';
import { BOSS_YELLS } from './quests';
import { C } from './vfx/vfx';
import type { Fx } from './vfx/effects';
import { angleDiff, rand, turnToward, yawTo } from './util';

export const BOSS_HP = 1300;
/** How far past the arena edge the player may kite before Corrodius gives up (after a grace period). */
const ARENA_LEASH = 30;
// The slam and spray mechanics land at a fixed moment (the telegraph's end); the swing starts as
// long before it as the clip takes to reach its own hit, so the claws meet the deck on the impact.
const SLAM_RATE = 1.2;
const SLAM_LEAD = skillDelay('attack_slam', 'hit', skillWindow('attack_slam', 'move', SLAM_RATE)) ?? 0.55;
const SPRAY_LEAD = skillDelay('attack_swipe', 'hit') ?? 0.4;

type Mech = 'slam' | 'spray' | 'undertow';
type State = 'dormant' | 'waking' | 'idle' | 'fight' | 'dying' | 'dead';

const v1 = new THREE.Vector3();
const g1 = new THREE.Vector3();
const g2 = new THREE.Vector3();
const g3 = new THREE.Vector3();
const gn = new THREE.Vector3();

interface ActiveMech {
  kind: Mech;
  t: number;
  dur: number;
  at: THREE.Vector3;
  yaw: number;
  fx: Fx[];
  fired: boolean;
  swung: boolean;
}

export class Boss {
  state: State = 'dormant';
  phase = 1;
  enraged = false;
  readonly adds: Enemy[] = [];
  private nextSwing = 0;
  private nextMech = 0;
  private mechIndex = 0;
  private mech: ActiveMech | null = null;
  private stateT = 0;
  private freedStarted = false;
  private outside = 0;

  constructor(private readonly game: Game, readonly unit: Unit, readonly arena: Poi, readonly freed: Unit) {
    unit.ctrl = this;
    unit.level = 4;
    unit.maxHp = unit.hp = BOSS_HP;
    unit.hidden = true;
    unit.targetable = false;
    unit.rig.root.visible = false;
    unit.setBaseTint('#ff3a12');
    freed.hidden = true;
    freed.targetable = false;
    freed.rig.root.visible = false;
    this.freedBaseScale = freed.rig.root.scale.x;
  }

  get engaged(): boolean {
    return this.state === 'fight';
  }

  get telegraphActive(): boolean {
    return !!this.mech && !this.mech.fired;
  }

  get mechName(): string | null {
    return this.mech?.kind ?? null;
  }

  /** The beacon is lit: Corrodius heaves himself up on the deck. */
  wake(): void {
    if (this.state !== 'dormant') return;
    const g = this.game;
    const u = this.unit;
    this.state = 'waking';
    this.stateT = 0;
    u.hidden = false;
    u.rig.root.visible = true;
    u.teleport(g.world, this.arena.position.x, this.arena.position.z, this.arena.yaw);
    u.lift = -u.height;
  }

  onDamaged(src: Unit | null): void {
    if (this.state === 'idle' && src) this.engage();
  }

  private engage(): void {
    const g = this.game;
    this.state = 'fight';
    this.nextSwing = g.time + 1.2;
    this.nextMech = g.time + 4;
    this.unit.express('angry', 3);
    g.say(this.unit, BOSS_YELLS.engage, true);
    g.audio.sfx('sfx-boss-roar');
    g.hud.bossFrame.show(this.unit);
    g.follow.shake(0.25, 0.6);
  }

  reset(): void {
    const g = this.game;
    const u = this.unit;
    if (this.state === 'dormant' || this.state === 'dead' || this.state === 'dying') return;
    this.clearMech();
    for (const a of this.adds) a.despawn();
    this.adds.length = 0;
    u.hp = u.maxHp;
    u.alive = true;
    u.stunUntil = u.slowUntil = 0;
    this.phase = 1;
    this.enraged = false;
    u.setBaseTint('#ff3a12');
    u.motion.stop(undefined, 0.2);
    u.teleport(g.world, this.arena.position.x, this.arena.position.z, this.arena.yaw);
    this.state = 'idle';
    g.hud.bossFrame.hide();
  }

  onDeath(): void {
    const g = this.game;
    this.state = 'dying';
    this.stateT = 0;
    this.clearMech();
    for (const a of this.adds) if (a.unit.alive) g.combat.kill(a.unit, null);
    g.say(this.unit, BOSS_YELLS.death, true);
    g.vfx.rustPeel(this.unit, 4.5);
    g.follow.shake(0.35, 1.2);
    g.audio.sfx('sfx-boss-roar', { volume: 0.7, pitch: 0 });
    this.unit.targetable = false;
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const p = g.player.unit;
    this.stateT += dt;
    switch (this.state) {
      case 'dormant':
      case 'dead':
        this.updateFreed(dt);
        return;
      case 'waking': {
        const k = Math.min(1, this.stateT / 2.4);
        u.lift = -u.height * (1 - k) * (1 - k);
        u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
        if (this.stateT < 2.4 && Math.random() < 0.5) g.vfx.burrow(v1.set(u.pos.x + rand(-2, 2), u.pos.y - u.lift, u.pos.z + rand(-2, 2)));
        if (k >= 1) {
          u.lift = 0;
          this.state = 'idle';
          u.targetable = true;
          u.act('attack_slam');
          g.say(u, BOSS_YELLS.wake, true);
          g.audio.sfx('sfx-boss-roar');
        }
        u.feedLocomotion(dt);
        return;
      }
      case 'idle': {
        // Wait on the deck; anyone stepping onto it is noticed.
        if (p.alive && !g.controlsLocked && Math.hypot(p.pos.x - this.arena.position.x, p.pos.z - this.arena.position.z) < this.arena.radius * 0.9) this.engage();
        u.setYaw(turnToward(u.yaw, p.alive ? yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z) : this.arena.yaw, 0.8, dt));
        u.feedLocomotion(dt);
        return;
      }
      case 'dying': {
        this.updateDeath(dt);
        return;
      }
      case 'fight':
        break;
    }

    // Leash: the player died, or left the wreck and stayed away.
    const fromArena = Math.hypot(p.pos.x - this.arena.position.x, p.pos.z - this.arena.position.z);
    this.outside = fromArena > this.arena.radius + ARENA_LEASH ? this.outside + dt : 0;
    if (!p.alive || this.outside > 4) {
      if (p.alive) g.say(u, 'Run, little shell. The rust remembers.', true);
      this.reset();
      return;
    }

    // Phase changes
    const frac = u.hp / u.maxHp;
    if (this.phase === 1 && frac < 0.6) this.enterPhase2();
    if (this.phase === 2 && frac < 0.25) this.enterPhase3();
    if (this.enraged) {
      g.vfx.heatVent(u);
      if (Math.random() < 0.3) g.vfx.heatVent(u);
    }

    const stunned = u.stunned(now);
    if (this.mech) {
      this.updateMech(dt);
    } else if (!stunned) {
      // Chase and claw.
      const gap = u.gapTo(p);
      const want = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
      u.setYaw(turnToward(u.yaw, want, this.enraged ? 3 : 2.2, dt));
      if (gap > 1.0) {
        const sp = (this.enraged ? 2.8 : 2.0) * u.speedMul(now);
        const d = u.distTo(p) || 1;
        u.moveTo(g.world, u.pos.x + ((p.pos.x - u.pos.x) / d) * sp * dt, u.pos.z + ((p.pos.z - u.pos.z) / d) * sp * dt, dt);
      }
      if (gap <= 1.6 && now >= this.nextSwing && Math.abs(angleDiff(want, u.yaw)) < 0.8) {
        this.nextSwing = now + (this.enraged ? 1.8 : 2.6);
        u.act('attack_swipe', {
          upper: true,
          hitAt: 0.35,
          speed: this.enraged ? 1.4 : 1,
          onHit: () => {
            if (!u.alive || !p.alive || u.gapTo(p) > 2.4) return;
            g.combat.damage(u, p, rand(7, 10) * (this.enraged ? 1.25 : 1));
            g.vfx.slash(u, p, C.ember, 1.3);
            g.follow.shake(0.08, 0.15);
          },
        });
      }
      if (now >= this.nextMech) this.startMech();
    }
    u.feedLocomotion(dt);
  }

  private enterPhase2(): void {
    const g = this.game;
    this.phase = 2;
    g.say(this.unit, BOSS_YELLS.phase2, true);
    g.audio.sfx('sfx-boss-roar');
    g.follow.shake(0.3, 0.6);
    g.hud.messages.banner('Phase 2', 'Corrodius calls up his Scraplings!', 'boss');
    const u = this.unit;
    for (let i = 0; i < 3; i++) {
      const a = u.yaw + Math.PI + (i - 1) * 0.9;
      const r = u.radius + 3.5;
      const add = g.spawnAdd(u.pos.x + Math.sin(a) * r, u.pos.z + Math.cos(a) * r);
      if (add) this.adds.push(add);
    }
    this.mechIndex = 0;
    this.nextMech = g.time + 3;
  }

  private enterPhase3(): void {
    const g = this.game;
    this.phase = 3;
    this.enraged = true;
    this.unit.setBaseTint('#fff1d6');
    this.unit.express('angry', 999);
    g.say(this.unit, BOSS_YELLS.phase3, true);
    g.audio.sfx('sfx-boss-roar');
    g.follow.shake(0.35, 0.8);
    g.hud.messages.banner('Enraged', 'His visor burns white-hot!', 'boss');
    this.nextMech = g.time + 2.5;
  }

  private startMech(): void {
    const g = this.game;
    const u = this.unit;
    const p = g.player.unit;
    const order: Mech[] =
      this.phase === 1 ? ['slam', 'spray'] : this.phase === 2 ? ['undertow', 'slam', 'spray', 'slam'] : ['slam', 'spray', 'undertow'];
    const kind = order[this.mechIndex++ % order.length];
    const m: ActiveMech = { kind, t: 0, dur: 1.5, at: new THREE.Vector3(), yaw: u.yaw, fx: [], fired: false, swung: false };
    const speedUp = this.enraged ? 0.8 : 1;
    if (kind === 'slam') {
      m.dur = 1.5 * speedUp;
      m.at.copy(p.pos);
      m.fx.push(g.vfx.telegraphCircle(m.at, 3.4, m.dur, undefined, this.deckUnder(m.at, 3.4, 0, Math.PI)));
      g.hud.messages.warn('Corrodius raises his anchor!');
    } else if (kind === 'spray') {
      m.dur = 1.1 * speedUp;
      m.at.copy(u.pos);
      m.yaw = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
      u.setYaw(m.yaw);
      m.fx.push(g.vfx.telegraphCone(m.at, m.yaw, 11, 0.55, m.dur, undefined, this.deckUnder(m.at, 11, m.yaw, 0.55)));
    } else {
      m.dur = 2.6;
      m.at.copy(u.pos);
      m.fx.push(g.vfx.telegraphCircle(m.at, 5.5, m.dur, undefined, this.deckUnder(m.at, 5.5, 0, Math.PI)));
      g.vfx.undertow(m.at, 5.5, m.dur);
      g.say(u, BOSS_YELLS.undertow, true);
      g.hud.messages.warn('The Undertow pulls you in. Run!');
    }
    this.mech = m;
    this.nextMech = g.time + m.dur + (this.phase === 3 ? 4.2 : this.phase === 2 ? 5.5 : 6);
  }

  /**
   * The plane of the deck under a telegraph (the wreck's deck tilts by up to half a unit across a
   * cone, enough to bury a flat mark): fitted through three points inside the mark, the mark's origin
   * moved onto it. Returns the plane's normal.
   */
  private deckUnder(at: THREE.Vector3, reach: number, yaw: number, half: number): THREE.Vector3 {
    const w = this.game.world;
    const cone = half < 3;
    const r = reach * (cone ? 0.85 : 0.7);
    const put = (out: THREE.Vector3, a: number, d: number) => {
      out.set(at.x + Math.sin(a) * d, 0, at.z + Math.cos(a) * d);
      out.y = w.heightAt(out.x, out.z);
      return out;
    };
    if (cone) {
      put(g1, yaw, 0);
      put(g2, yaw - half * 0.8, r);
      put(g3, yaw + half * 0.8, r);
    } else {
      put(g1, 0, r);
      put(g2, (Math.PI * 2) / 3, r);
      put(g3, (Math.PI * 4) / 3, r);
    }
    // Height of the plane at the origin: the apex of a cone, the centroid of a circle's samples.
    const gy = w.heightAt(at.x, at.z);
    at.y = cone ? gy : (g1.y + g2.y + g3.y) / 3;
    if (Math.abs(at.y - gy) > 0.5) at.y = gy;
    const n = gn.crossVectors(g2.sub(g1), g3.sub(g1)).normalize();
    if (!Number.isFinite(n.y)) n.set(0, 1, 0);
    if (n.y < 0) n.negate();
    // Never more than ~10 degrees: a sample off the deck edge must not stand the mark up.
    if (!(n.y >= 0.985)) n.set(n.x, 0, n.z).setLength(Math.sqrt(1 - 0.985 * 0.985)).setY(0.985);
    return n;
  }

  private updateMech(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const p = g.player.unit;
    const m = this.mech!;
    m.t += dt;
    if (m.kind === 'slam') {
      u.setYaw(turnToward(u.yaw, yawTo(u.pos.x, u.pos.z, m.at.x, m.at.z), 3, dt));
      if (!m.swung && m.t > m.dur - SLAM_LEAD) {
        m.swung = true;
        u.act('attack_slam', { speed: SLAM_RATE });
      }
      if (m.t >= m.dur) {
        m.fired = true;
        g.vfx.slamImpact(m.at, 3.4);
        g.follow.shake(0.5, 0.5);
        g.audio.sfx('sfx-crit');
        if (p.alive && Math.hypot(p.pos.x - m.at.x, p.pos.z - m.at.z) < 3.4 + p.radius * 0.5) {
          g.combat.damage(u, p, p.maxHp * 0.26);
          p.stunUntil = Math.max(p.stunUntil, g.time + 0.5);
        }
        this.mech = null;
      }
    } else if (m.kind === 'spray') {
      if (!m.swung && m.t > m.dur - SPRAY_LEAD) {
        m.swung = true;
        u.act('attack_swipe', { upper: true });
        g.vfx.rustSpray(m.at, m.yaw, 11, 0.55);
      }
      if (m.t >= m.dur) {
        m.fired = true;
        const d = Math.hypot(p.pos.x - m.at.x, p.pos.z - m.at.z);
        const a = yawTo(m.at.x, m.at.z, p.pos.x, p.pos.z);
        if (p.alive && d < 11 + p.radius && Math.abs(angleDiff(a, m.yaw)) < 0.55 + Math.atan2(p.radius, Math.max(1, d))) {
          g.combat.damage(u, p, rand(6, 9));
          p.rust = Math.min(5, (g.time < p.rustUntil ? p.rust : 0) + 1);
          p.rustUntil = g.time + 10;
          g.hud.floats.spawn(p, `Rust x${p.rust}`, 'info');
        }
        this.mech = null;
      }
    } else {
      // Undertow: drag the player toward the hull, then slam everything around it.
      if (p.alive && m.t < m.dur - 0.3) {
        const d = u.distTo(p);
        if (d < 18 && d > u.radius + p.radius + 0.3) {
          const pull = 3.2;
          p.pushX = ((u.pos.x - p.pos.x) / d) * pull;
          p.pushZ = ((u.pos.z - p.pos.z) / d) * pull;
          p.pushTime = 0.05;
        }
      }
      if (!m.swung && m.t > m.dur - SLAM_LEAD) {
        m.swung = true;
        u.act('attack_slam', { speed: SLAM_RATE });
      }
      if (m.t >= m.dur) {
        m.fired = true;
        g.vfx.slamImpact(m.at, 5.5);
        g.follow.shake(0.55, 0.6);
        g.audio.sfx('sfx-crit');
        if (p.alive && u.distTo(p) < 5.5 + p.radius * 0.5) g.combat.damage(u, p, p.maxHp * 0.24);
        this.mech = null;
      }
    }
  }

  private clearMech(): void {
    if (!this.mech) return;
    for (const f of this.mech.fx) this.game.vfx.fx.release(f);
    this.mech = null;
  }

  /** Debug F9: drop to the next phase threshold, then to zero. */
  debugAdvance(): void {
    const g = this.game;
    const u = this.unit;
    if (this.state === 'idle') this.engage();
    if (this.state !== 'fight') return;
    const target = this.phase === 1 ? 0.58 : this.phase === 2 ? 0.23 : 0;
    const dmg = u.hp - u.maxHp * target;
    if (target === 0) g.combat.damage(g.player.unit, u, u.hp + 10, { crit: true });
    else if (dmg > 0) g.combat.damage(g.player.unit, u, dmg, { crit: true });
  }

  // ---------------------------------------------------------------- death sequence

  private updateDeath(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const t = this.stateT;
    if (t > 2.2 && !this.freedStarted) {
      this.freedStarted = true;
      this.releaseFreed();
    }
    if (t > 6) {
      // The empty hull settles into the deck.
      u.lift = -Math.min(1, (t - 6) / 4) * u.height * 0.7;
      u.pos.y = g.world.heightAt(u.pos.x, u.pos.z) + u.lift;
    }
    if (t > 10.5) {
      u.hidden = true;
      u.rig.root.visible = false;
      this.state = 'dead';
      this.stateT = 0;
    }
    this.updateFreed(dt);
  }

  private freedT = -1;
  private freedYaw = 0;

  private releaseFreed(): void {
    const g = this.game;
    const f = this.freed;
    const u = this.unit;
    f.hidden = false;
    f.rig.root.visible = true;
    f.alive = true;
    const p = g.player.unit;
    const toward = yawTo(u.pos.x, u.pos.z, p.pos.x, p.pos.z);
    f.teleport(g.world, u.pos.x, u.pos.z, toward);
    f.rig.root.scale.setScalar(this.freedBaseScale * 0.3);
    this.freedT = 0;
    this.freedYaw = toward;
    g.vfx.steamPuff(f.pos);
    g.vfx.lootSparkle(f.pos);
    g.audio.sfx('sfx-servo-whir');
  }

  private freedBaseScale = 0;

  private updateFreed(dt: number): void {
    if (this.freedT < 0) return;
    const g = this.game;
    const f = this.freed;
    const u = this.unit;
    const p = g.player.unit;
    this.freedT += dt;
    const t = this.freedT;
    // 0..1.2 grow and step out of the hull
    if (t < 1.2) {
      const k = t / 1.2;
      f.rig.root.scale.setScalar(this.freedBaseScale * (0.3 + 0.7 * k));
      const out = u.radius + 1.6;
      f.moveTo(g.world, u.pos.x + Math.sin(this.freedYaw) * out * k, u.pos.z + Math.cos(this.freedYaw) * out * k, dt);
    } else if (t < 1.6) {
      f.rig.root.scale.setScalar(this.freedBaseScale);
      f.setYaw(turnToward(f.yaw, yawTo(f.pos.x, f.pos.z, p.pos.x, p.pos.z), 6, dt));
    } else if (t < 4.6) {
      if (!f.npcId) {
        f.npcId = 'bowed';
        f.act('gesture_bow');
        f.express('love', 3);
        g.say(f, 'Thank you. It was very dark in there.');
      }
    } else if (t < 12) {
      // Scuttle sideways into the sea.
      const sea = g.seaDirection();
      const yaw = Math.atan2(sea.x, sea.z) + Math.PI / 2;
      f.setYaw(turnToward(f.yaw, yaw, 4, dt));
      f.moveTo(g.world, f.pos.x + sea.x * 3.4 * dt, f.pos.z + sea.z * 3.4 * dt, dt);
      if (t > 10.5) f.lift = -(t - 10.5) * 0.8;
      if (Math.random() < 0.3) g.vfx.smoke(f.pos, C.foam, 1, 0.5, 0.6, 0.3, 0.6);
    } else {
      f.hidden = true;
      f.alive = false;
      f.rig.root.visible = false;
      this.freedT = -1;
    }
    f.feedLocomotion(dt);
  }
}
