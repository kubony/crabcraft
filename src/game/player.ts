// The player's crab: WASD movement with acceleration, WoW-style turning and steering, jumping,
// targeting, auto-attack, the cast/channel bars, resources, cooldowns and the global cooldown.
import * as THREE from 'three';
import type { AbilityDef, ClassDef } from '../data/classes';
import type { Game } from './game';
import type { Unit } from './unit';
import { executeAbility, abilityNeedsTarget, isMeleeAbility } from './abilities';
import { rollCrit, CRIT_MULT } from './combat';
import { C, N, type WardHandle } from './vfx/vfx';
import { Sprite } from './vfx/atlas';
import { angleDiff, damp, dampAngle, rand, turnToward, yawTo } from './util';

/** Window of the recorded jump clip that is played: crouch, take-off (1.08 s), landing (1.37 s). */
const JUMP_FROM = 0.8;
const JUMP_TO = 1.56;
const JUMP_RATE = 1.15;

export const GCD = 1.0;
export const LEVEL_XP = [0, 300, 900];
export const MAX_LEVEL = 3;
const WALK_SPEED = 5;
const MELEE_GAP = 1.5;
const RANGED_AUTO = 20;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const ray = new THREE.Ray();
const sphere = new THREE.Sphere();

export interface CastState {
  ability: AbilityDef;
  start: number;
  end: number;
  target: Unit | null;
}

export interface ChannelState {
  label: string;
  start: number;
  end: number;
  key: string;
  to: THREE.Vector3;
  onDone: () => void;
}

export class Player {
  resource = 0;
  maxResource = 100;
  xp = 0;
  gcdStart = 0;
  gcdEnd = 0;
  readonly cooldowns = new Map<string, { start: number; end: number }>();
  cast: CastState | null = null;
  channel: ChannelState | null = null;
  target: Unit | null = null;
  ward: WardHandle | null = null;
  private nextSwing = 0;
  private lastAttack = -10;
  private queued: AbilityDef | null = null;
  private velX = 0;
  private velZ = 0;
  private jumpT = 0;
  private spinT = 0;
  private dash: { target: Unit; t: number } | null = null;
  private lastSpend = -10;
  private targetDeadAt = 0;
  baseMaxHp: number;

  constructor(private readonly game: Game, readonly unit: Unit, readonly cls: ClassDef) {
    this.baseMaxHp = cls.baseHp;
    unit.maxHp = unit.hp = cls.baseHp;
    if (cls.resource === 'mana') this.maxResource = this.resource = 120;
  }

  get isRage(): boolean {
    return this.cls.resource === 'rage';
  }

  get level(): number {
    return this.unit.level;
  }

  get dmgMul(): number {
    return 1 + 0.12 * (this.unit.level - 1);
  }

  get inCombat(): boolean {
    return this.game.time - this.unit.lastCombat < 5;
  }

  cooldownLeft(a: AbilityDef): number {
    const cd = this.cooldowns.get(a.id);
    return cd ? Math.max(0, cd.end - this.game.time) : 0;
  }

  gainRage(n: number): void {
    if (!this.isRage) return;
    this.resource = Math.min(this.maxResource, this.resource + n);
  }

  onDamaged(dmg: number): void {
    if (this.isRage) this.gainRage(dmg * 0.5);
    if (this.cast && this.cast.ability.castTime > 0) {
      // Pushback: taking damage delays the cast a little, like the old games.
      this.cast.end = Math.min(this.cast.end + 0.25, this.cast.start + this.cast.ability.castTime + 0.75);
    }
  }

  onWardHit(dst: Unit, broken: boolean): void {
    if (dst !== this.unit || !this.ward) return;
    if (broken) {
      this.ward.pop();
      this.ward = null;
      dst.absorb = 0;
    } else this.ward.hit();
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const inp = g.input;
    if (!u.alive) {
      u.feedLocomotion(dt);
      return;
    }
    const free = !g.controlsLocked;
    let fwd = 0;
    let strafe = 0;
    let turn = 0;
    if (free) {
      fwd = (inp.isDown('KeyW') || inp.isDown('ArrowUp') ? 1 : 0) - (inp.isDown('KeyS') || inp.isDown('ArrowDown') ? 1 : 0);
      strafe = (inp.isDown('KeyA') ? 1 : 0) - (inp.isDown('KeyD') ? 1 : 0);
      turn = (inp.isDown('KeyQ') || inp.isDown('ArrowLeft') ? 1 : 0) - (inp.isDown('KeyE') || inp.isDown('ArrowRight') ? 1 : 0);
      if (inp.isButtonDown(0) && inp.isButtonDown(2)) fwd = 1;
    }
    const stunned = u.stunned(now);
    if (stunned || this.dash) fwd = strafe = turn = 0;

    // Facing: right-drag steers to the camera, Q/E turn and drag the camera along.
    if (free && g.follow.steering && !stunned && !this.dash) {
      u.setYaw(g.follow.forwardYaw);
    } else if (turn) {
      const d = turn * 2.9 * dt;
      u.setYaw(u.yaw + d);
      if (!inp.isButtonDown(0)) g.follow.yaw += d;
    }
    const moving = fwd !== 0 || strafe !== 0;
    if (moving) {
      if (this.cast && this.cast.ability.castTime > 0) this.interruptCast();
      if (this.channel) this.cancelChannel();
    }
    // Face the target while fighting from a standstill.
    const t = this.target;
    if (!moving && !turn && !g.follow.steering && t && t.alive && t !== u && (this.cast || now - this.lastAttack < 1.6)) {
      u.setYaw(turnToward(u.yaw, yawTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z), 9, dt));
    }
    // Turn to the crab you are talking to, so the dialogue shot looks over your shoulder at it.
    const talk = g.hud.dialogue.unit;
    if (talk && !moving && !turn && !g.follow.steering && !stunned && !this.dash) {
      u.setYaw(turnToward(u.yaw, yawTo(u.pos.x, u.pos.z, talk.pos.x, talk.pos.z), 4.5, dt));
    }

    // Jump
    if (free && inp.wasPressed('Space') && this.jumpT <= 0 && !stunned && !this.dash) {
      // The recorded jump rollout spends 1.08 s getting ready before take-off and another 2 s
      // settling after landing. Play only crouch, flight and landing, a little faster, so the
      // crab leaves the ground at once and walks on as soon as it lands.
      this.jumpT = (JUMP_TO - JUMP_FROM) / JUMP_RATE;
      u.act('jump', {
        fade: 0.06,
        from: JUMP_FROM,
        to: JUMP_TO,
        speed: JUMP_RATE,
        onEvent: (name) => {
          if (name === 'land') {
            const sand = g.zone === 'The Brine Shore' || g.zone === 'The Iron Wreck';
            g.audio.sfx(sand ? 'sfx-footstep-sand' : 'sfx-footstep-stone', { volume: 0.45, pitch: 0.08 });
          }
        },
      });
      g.audio.sfx('sfx-servo-whir', { volume: 0.35 });
      if (this.cast && this.cast.ability.castTime > 0) this.interruptCast();
      if (this.channel) this.cancelChannel();
    }
    if (this.jumpT > 0) this.jumpT -= dt;

    // Velocity
    let nx = u.pos.x;
    let nz = u.pos.z;
    if (this.dash) {
      this.updateDash(dt);
      nx = u.pos.x;
      nz = u.pos.z;
    } else {
      const sp = WALK_SPEED * u.speedMul(now);
      let lx = strafe;
      let lz = fwd;
      const len = Math.hypot(lx, lz);
      if (len > 0) {
        lx /= len;
        lz /= len;
      }
      if (lz < 0) {
        lz *= 0.62;
        lx *= 0.8;
      }
      const s = Math.sin(u.yaw);
      const c = Math.cos(u.yaw);
      const tx = (lx * c + lz * s) * sp;
      const tz = (-lx * s + lz * c) * sp;
      const k = moving ? 12 : 16;
      this.velX = damp(this.velX, tx, k, dt);
      this.velZ = damp(this.velZ, tz, k, dt);
      nx += this.velX * dt;
      nz += this.velZ * dt;
    }
    if (u.pushTime > 0) {
      u.pushTime -= dt;
      nx += u.pushX * dt;
      nz += u.pushZ * dt;
    }
    u.moveTo(g.world, nx, nz, dt);
    if (this.spinT > 0) {
      this.spinT = Math.max(0, this.spinT - dt);
      u.rig.root.rotation.y = u.yaw + (1 - this.spinT / 0.6) * Math.PI * 4;
    } else {
      u.rig.root.rotation.y = u.yaw;
    }

    // Camera swings behind the crab while walking, unless the player is holding a mouse button.
    if (moving && !inp.isButtonDown(0) && !inp.isButtonDown(2)) {
      g.follow.yaw = dampAngle(g.follow.yaw, u.yaw + Math.PI, fwd !== 0 ? 1.7 : 0.6, dt);
    }

    // Footsteps
    const speed = Math.hypot(this.velX, this.velZ);
    if (speed > 1 && this.jumpT <= 0) {
      u.footstepT -= dt * speed / WALK_SPEED;
      if (u.footstepT <= 0) {
        u.footstepT = 0.34;
        g.audio.sfx(g.zone === 'The Brine Shore' || g.zone === 'The Iron Wreck' ? 'sfx-footstep-sand' : 'sfx-footstep-stone', { volume: 0.22, pitch: 0.12 });
      }
    }

    u.feedLocomotion(dt);
    this.updateCombat();
    this.updateResources(dt);
  }

  private updateCombat(): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const t = this.target;
    if (t && (t.hidden || (!t.alive && now - this.targetDeadAt > 1.5))) this.setTarget(null);
    if (t && !t.alive && this.targetDeadAt === 0) this.targetDeadAt = now;

    // Cast bar
    if (this.cast) {
      const c = this.cast;
      const claw = u.socketPos('clawR', v1);
      const col = c.ability.id === 'smite' || c.ability.id === 'mend-shell' ? (c.ability.id === 'smite' ? C.holy : C.heal) : C.water;
      g.vfx.castMotes(claw, col, c.ability.id === 'mend-shell' ? Sprite.Star : Sprite.Glow);
      if (c.target && !c.target.alive) {
        this.interruptCast('Invalid target');
      } else if (now >= c.end) {
        this.cast = null;
        // The channel hands over to the cast's release: the claws fling wide as the spell goes.
        u.act('cast', { upper: true, part: 'release', fade: 0.1 });
        g.hud.castBar.finish();
        if (c.target && abilityNeedsTarget(c.ability) && !this.checkReach(c.ability, c.target)) return;
        this.commit(c.ability, c.target);
      }
    }

    // Channel (beacon)
    if (this.channel) {
      const ch = this.channel;
      if (!g.input.isDown(ch.key)) {
        this.cancelChannel();
      } else {
        const claw = u.socketPos('clawR', v1);
        g.vfx.beaconStream(claw, ch.to, (now - ch.start) / (ch.end - ch.start));
        if (now >= ch.end) {
          this.channel = null;
          u.act('cast', { upper: true, part: 'release', fade: 0.1 });
          g.hud.castBar.finish();
          ch.onDone();
        }
      }
    }

    // Queued ability fires as soon as the GCD ends.
    if (this.queued && now >= this.gcdEnd && !this.cast) {
      const q = this.queued;
      this.queued = null;
      this.useAbility(q.slot);
    }

    // Auto-attack
    if (t && t.alive && t.hostile && !this.cast && !this.channel && !this.dash && now >= this.nextSwing && u.alive && !u.stunned(now)) {
      if (this.isRage) {
        if (u.gapTo(t) <= MELEE_GAP) {
          this.nextSwing = now + 2.0;
          this.lastAttack = now;
          u.act('attack_swipe', {
            upper: true,
            onHit: () => {
              if (!t.alive || u.gapTo(t) > MELEE_GAP + 0.8) return;
              const crit = rollCrit();
              const dmg = rand(8, 11) * this.dmgMul * (crit ? CRIT_MULT : 1);
              g.combat.damage(u, t, dmg, { crit, rage: crit ? 15 : 9 });
              g.vfx.slash(u, t, C.steel, 0.8);
            },
          });
        }
      } else if (u.distTo(t) <= RANGED_AUTO && this.lineOfSight(t)) {
        this.nextSwing = now + 1.8;
        this.lastAttack = now;
        const from = u.socketPos('clawR', v1).clone();
        const style = this.cls.id === 'priest' ? 'holy' : 'spark';
        g.vfx.projectile(from, t, style, 22, () => {
          if (!t.alive) return;
          const crit = rollCrit();
          g.combat.damage(u, t, rand(5, 7) * this.dmgMul * (crit ? CRIT_MULT : 1), { crit, school: style === 'holy' ? 'holy' : 'frost', noReact: true });
        });
      }
    }
  }

  private updateResources(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    const ooc = now - u.lastCombat > 5;
    if (this.isRage) {
      if (now - u.lastCombat > 3) this.resource = Math.max(0, this.resource - 4 * dt);
    } else {
      const rate = ooc ? 10 : now - this.lastSpend > 5 ? 5 : 2.8;
      this.resource = Math.min(this.maxResource, this.resource + rate * dt);
    }
    if (u.alive) {
      let regen = 0;
      if (ooc) regen += u.maxHp * 0.05;
      if (now < u.blessingUntil) regen += u.maxHp * 0.02;
      if (regen > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + regen * dt);
    }
    if (u.absorb > 0 && now >= u.absorbUntil) {
      u.absorb = 0;
      this.ward?.pop();
      this.ward = null;
    }
  }

  // ---------------------------------------------------------------- abilities

  useAbility(slot: number): void {
    const g = this.game;
    const u = this.unit;
    const ab = this.cls.abilities[slot - 1];
    if (!ab || !u.alive || g.controlsLocked) return;
    const now = g.time;
    g.hud.actionBar.press(slot);
    if (u.stunned(now)) return this.error('You are stunned.');
    if (this.channel) return this.error('Another action is in progress.');
    if (this.cast) {
      if (now > this.cast.end - 0.3) this.queued = ab;
      else this.error('Another action is in progress.');
      return;
    }
    const wait = Math.max(this.gcdEnd - now, this.cooldownLeft(ab));
    if (wait > 0) {
      if (wait < 0.4 && this.cooldownLeft(ab) < 0.4) this.queued = ab;
      else this.error('Ability is not ready yet.');
      return;
    }
    if (this.resource < ab.cost) return this.error(this.isRage ? 'Not enough rage.' : 'Not enough mana.');
    let target: Unit | null = null;
    if (abilityNeedsTarget(ab)) {
      target = this.target;
      if (!target) return this.error('You have no target.');
      if (!target.alive || !target.hostile) return this.error('Invalid target.');
      if (!this.checkReach(ab, target)) return;
    }
    this.gcdStart = now;
    this.gcdEnd = now + GCD;
    this.lastAttack = now;
    if (ab.castTime > 0) {
      this.cast = { ability: ab, start: now, end: now + ab.castTime, target };
      u.act('cast', { upper: true, loop: true, fade: 0.15 });
      g.audio.sfx('sfx-cast', { volume: 0.5 });
      g.hud.castBar.start(ab.name, ab.castTime);
    } else {
      this.commit(ab, target);
    }
  }

  private checkReach(ab: AbilityDef, t: Unit): boolean {
    const u = this.unit;
    const d = u.distTo(t) - t.radius;
    let err = '';
    if (isMeleeAbility(ab)) err = u.gapTo(t) > MELEE_GAP + 0.3 ? 'Out of range.' : '';
    else if (d > ab.range) err = 'Out of range.';
    else if (ab.id === 'sideways-charge' && u.gapTo(t) < 2) err = 'Target too close.';
    else if (!this.lineOfSight(t)) err = 'Target not in line of sight.';
    if (err) this.error(err);
    return !err;
  }

  lineOfSight(t: Unit): boolean {
    const from = v1.set(this.unit.pos.x, this.unit.pos.y + this.unit.height * 0.8, this.unit.pos.z);
    const to = t.centre(v2);
    const hit = this.game.world.raycastSolid(from, to);
    return hit === null || hit >= from.distanceTo(to) - t.radius - 0.3;
  }

  /** Pay, start the cooldown, run the ability. */
  private commit(ab: AbilityDef, target: Unit | null): void {
    const g = this.game;
    if (this.resource < ab.cost) return this.error(this.isRage ? 'Not enough rage.' : 'Not enough mana.');
    this.resource -= ab.cost;
    if (ab.cost > 0) this.lastSpend = g.time;
    if (ab.generates) this.gainRage(ab.generates);
    if (ab.cooldown > 0) this.cooldowns.set(ab.id, { start: g.time, end: g.time + ab.cooldown });
    this.lastAttack = g.time;
    executeAbility(g, this, ab, target);
  }

  interruptCast(reason = 'Interrupted'): void {
    if (!this.cast) return;
    this.cast = null;
    this.unit.motion.stop('cast', 0.15);
    this.game.hud.castBar.fail(reason);
  }

  startChannel(label: string, seconds: number, key: string, to: THREE.Vector3, onDone: () => void): void {
    if (this.cast) this.interruptCast();
    const now = this.game.time;
    this.channel = { label, start: now, end: now + seconds, key, to, onDone };
    this.velX = this.velZ = 0;
    this.unit.act('cast', { upper: true, loop: true, fade: 0.2 });
    this.game.hud.castBar.start(label, seconds, true);
    this.game.audio.sfx('sfx-cast', { volume: 0.5 });
  }

  cancelChannel(): void {
    if (!this.channel) return;
    this.channel = null;
    this.unit.motion.stop('cast', 0.2);
    this.game.hud.castBar.fail('Interrupted');
  }

  // Ability helpers used by abilities.ts

  startDash(target: Unit): void {
    this.dash = { target, t: 0 };
    this.velX = this.velZ = 0;
    this.game.vfx.dashTrail(this.unit, 0.5);
  }

  private updateDash(dt: number): void {
    const d = this.dash!;
    const u = this.unit;
    const t = d.target;
    d.t += dt;
    const dist = u.gapTo(t);
    const step = 26 * dt;
    // Crabs charge sideways: face along the dash with the body turned, it reads as a scuttle.
    const yaw = yawTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
    u.setYaw(yaw);
    if (dist <= 0.6 + step || d.t > 0.9 || !t.alive) {
      this.dash = null;
      u.lift = 0;
      const g = this.game;
      g.vfx.impact(t.centre(v1), C.steel, 1.2);
      g.vfx.ring(t.pos, N.gold, 0.3, 2.2, 0.35, 0.8);
      g.follow.shake(0.12, 0.2);
      g.audio.sfx('sfx-hit', { volume: 0.8 });
      this.nextSwing = Math.min(this.nextSwing, g.time + 0.1);
      return;
    }
    const k = step / Math.max(0.001, u.distTo(t));
    u.pos.x += (t.pos.x - u.pos.x) * k;
    u.pos.z += (t.pos.z - u.pos.z) * k;
    u.lift = Math.sin(Math.min(1, d.t / 0.45) * Math.PI) * 0.25;
  }

  spin(): void {
    this.spinT = 0.6;
  }

  error(msg: string): void {
    this.game.hud.messages.error(msg);
    this.game.audio.sfx('sfx-error', { volume: 0.6 });
  }

  // ---------------------------------------------------------------- targeting

  setTarget(t: Unit | null): void {
    if (t === this.target) return;
    this.target = t;
    this.targetDeadAt = t && !t.alive ? this.game.time : 0;
    this.game.hud.targetFrame.setUnit(t, t?.kind === 'npc' ? `art/npc/${t.npcId}.webp` : null);
    if (t) this.game.audio.sfx('sfx-click', { volume: 0.35 });
  }

  /** Nearest hostile in front of the camera; repeated presses cycle. */
  tabTarget(): void {
    const g = this.game;
    const u = this.unit;
    const fy = g.follow.forwardYaw;
    const list = g.units
      .filter((o) => o.hostile && o.alive && !o.hidden && o.targetable && u.distTo(o) < 32)
      .filter((o) => Math.abs(angleDiff(yawTo(u.pos.x, u.pos.z, o.pos.x, o.pos.z), fy)) < 1.45 || u.distTo(o) < 4)
      .sort((a, b) => u.distTo(a) - u.distTo(b));
    if (!list.length) return;
    const i = this.target ? list.indexOf(this.target) : -1;
    this.setTarget(list[(i + 1) % list.length]);
  }

  /** Ray-pick a crab under the mouse. */
  pick(clientX: number, clientY: number): Unit | null {
    const g = this.game;
    const cam = g.camera;
    const ndc = v1.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(cam);
    ray.origin.copy(cam.position);
    ray.direction.copy(ndc.sub(cam.position).normalize());
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const o of g.units) {
      if (o === this.unit || o.hidden || !o.targetable || o.culled) continue;
      sphere.center.set(o.pos.x, o.pos.y + o.height * 0.5, o.pos.z);
      sphere.radius = Math.max(o.radius * 1.05, o.height * 0.6);
      const hit = ray.intersectSphere(sphere, v2);
      if (!hit) continue;
      const d = hit.distanceTo(cam.position);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- progression

  gainXp(n: number): void {
    const g = this.game;
    if (this.unit.level >= MAX_LEVEL) return;
    this.xp += n;
    g.hud.floats.spawn(this.unit, `+${n} XP`, 'xp');
    g.hud.chat.system(`You gain ${n} experience.`);
    while (this.unit.level < MAX_LEVEL && this.xp >= LEVEL_XP[this.unit.level]) this.levelUp();
  }

  private levelUp(): void {
    const g = this.game;
    const u = this.unit;
    u.level++;
    const oldMax = u.maxHp;
    u.maxHp = Math.round(this.baseMaxHp * (1 + 0.15 * (u.level - 1)));
    u.hp = u.maxHp;
    if (!this.isRage) {
      this.maxResource = 120 + 20 * (u.level - 1);
      this.resource = this.maxResource;
    }
    g.vfx.levelUp(u);
    g.audio.sfx('sfx-levelup');
    u.express('happy', 2);
    g.hud.messages.banner(`Level ${u.level}`, `Your shell hardens. Health ${oldMax} to ${u.maxHp}.`, 'level');
    g.hud.chat.system(`Congratulations, you have reached level ${u.level}!`);
  }

  respawn(): void {
    const u = this.unit;
    u.alive = true;
    u.hp = u.maxHp;
    this.resource = this.isRage ? 0 : this.maxResource;
    this.cast = null;
    this.channel = null;
    this.dash = null;
    this.queued = null;
    u.stunUntil = u.slowUntil = u.rustUntil = 0;
    u.rust = 0;
    u.absorb = 0;
    u.lift = 0;
    this.ward?.pop();
    this.ward = null;
    this.velX = this.velZ = 0;
    u.lastCombat = -1e9;
    u.motion.stop(undefined, 0);
    u.express('neutral', 0.1);
    u.rig.face.setTint(null);
    this.setTarget(null);
  }
}
