// Damage, healing, absorbs, crits and deaths. Every hit in the game goes through here so combat
// text, hit reactions, rage and aggro stay consistent.
import * as THREE from 'three';
import type { Game } from './game';
import type { Unit } from './unit';
import { C } from './vfx/vfx';

export type School = 'physical' | 'frost' | 'water' | 'holy' | 'rust';

export interface HitOptions {
  crit?: boolean;
  school?: School;
  /** Skip the hit-react clip (DoTs, big AoE ticks). */
  noReact?: boolean;
  /** Rage the attacker (if a warrior player) gains. */
  rage?: number;
}

const v = new THREE.Vector3();

export const CRIT_CHANCE = 0.12;
export const CRIT_MULT = 1.75;

export function rollCrit(chance = CRIT_CHANCE): boolean {
  return Math.random() < chance;
}

export class Combat {
  constructor(private readonly game: Game) {}

  damage(src: Unit | null, dst: Unit, amount: number, o: HitOptions = {}): number {
    const g = this.game;
    if (!dst.alive || dst.hidden) return 0;
    const now = g.time;
    if (src) src.lastCombat = now;
    dst.lastCombat = now;
    if (dst.invulnerable) {
      g.hud.floats.spawn(dst, 'Evade', 'info');
      return 0;
    }
    let dmg = Math.max(1, Math.round(amount));
    if (dst.kind === 'player' && g.god) {
      g.player.onDamaged(dmg);
      return 0;
    }
    // Absorb shields soak first.
    if (dst.absorb > 0 && now < dst.absorbUntil) {
      const soaked = Math.min(dst.absorb, dmg);
      dst.absorb -= soaked;
      dmg -= soaked;
      g.player.onWardHit(dst, dst.absorb <= 0);
      if (dmg <= 0) {
        g.hud.floats.spawn(dst, 'Absorbed', 'info');
        return 0;
      }
    }
    dst.hp = Math.max(0, dst.hp - dmg);
    const crit = !!o.crit;
    if (dst.kind === 'player') {
      g.hud.floats.spawn(dst, `-${dmg}`, 'taken');
      dst.flash('#ff2a1a', 0.18);
      g.hud.damageFlash(dmg / dst.maxHp);
      g.player.onDamaged(dmg);
    } else {
      g.hud.floats.spawn(dst, crit ? `${dmg}!` : `${dmg}`, crit ? 'crit' : 'dmg');
      dst.flash('#ffffff', 0.1);
    }
    if (src?.kind === 'player' && o.rage) g.player.gainRage(o.rage);
    if (crit) {
      g.follow.shake(dst.kind === 'boss' ? 0.18 : 0.12, 0.25);
      g.audio.sfx('sfx-crit', { volume: 0.8 });
    } else {
      g.audio.sfx('sfx-hit', { volume: 0.55 });
    }
    if (dst.hp <= 0) {
      this.kill(dst, src);
      return dmg;
    }
    if (!o.noReact && dst.kind !== 'boss') {
      // Keep attack animations readable: only react when not mid-swing.
      const act = dst.motion.action;
      if (!act || act === 'hit_react' || act.startsWith('walk')) dst.act('hit_react', { upper: dst.kind === 'player' });
      dst.express('hurt', 0.4);
    }
    // Wake the victim.
    const ctrl = dst.ctrl as { onDamaged?: (src: Unit | null, dmg: number) => void } | null;
    ctrl?.onDamaged?.(src, dmg);
    return dmg;
  }

  heal(src: Unit | null, dst: Unit, amount: number, crit = false): number {
    if (!dst.alive) return 0;
    const before = dst.hp;
    dst.hp = Math.min(dst.maxHp, dst.hp + Math.round(amount));
    const healed = dst.hp - before;
    if (amount > 0) this.game.hud.floats.spawn(dst, crit ? `+${Math.round(amount)}!` : `+${Math.round(amount)}`, 'heal');
    if (src) src.lastCombat = Math.max(src.lastCombat, this.game.time - 4);
    this.game.audio.sfx('sfx-heal', { volume: 0.6 });
    return healed;
  }

  kill(dst: Unit, src: Unit | null): void {
    const g = this.game;
    dst.alive = false;
    dst.hp = 0;
    dst.cancelPendingHit();
    dst.motion.stop(undefined, 0.1);
    // The power-down: the legs give way and the shell settles on the floor, where it stays.
    dst.act('death', {
      fade: 0.1,
      onEvent: (name) => {
        if (name !== 'settled' || dst.hidden || dst.culled) return;
        g.vfx.smoke(v.set(dst.pos.x, dst.pos.y + 0.05, dst.pos.z), C.dust, 6, 0.7 * dst.radius, 0.4, 0.35 * dst.height, 0.7);
      },
    });
    dst.express('dead', 999);
    dst.rig.face.setTint(null);
    dst.centre(v);
    g.vfx.deathPoof(dst);
    const ctrl = dst.ctrl as { onDeath?: (killer: Unit | null) => void } | null;
    ctrl?.onDeath?.(src);
    g.onUnitDied(dst, src);
  }
}
