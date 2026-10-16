// The celebration: the whole town gathers in a ring around the player in Clawhaven Square, every
// crab plays the recorded dances, then the ring makes room and the hero breaks: the breakdance
// routine (toprock, six-step, spin, 720, back flip, one-claw freeze), every move a trained Jumper
// policy, with the ring cheering the landings and the freeze. Then everyone dances again,
// fireworks burst over the bay, the camera orbits slowly with depth of field, and the credits roll.
import * as THREE from 'three';
import { routineLength, type RoutineStep } from '../motion/breakdance';
import type { MotionId } from '../motion/types';
import { BreakRoutine, preloadRoutine } from './breakdance';
import type { Game } from './game';
import type { Unit } from './unit';
import { ENDING_BARKS } from './quests';
import { C } from './vfx/vfx';
import { easeInOut, pick, rand, yawTo } from './util';

const DANCES: MotionId[] = ['dance_crab', 'dance_brazilian', 'dance_dream_wings', 'dance_maze'];
const FIREWORK_COLORS = [C.gold, C.redHot, C.water, C.purple, C.green, C.holy];
/** Seconds into the ending when the ring makes room and the hero starts the routine. */
const BREAK_AT = 3.2;
/** Seconds of dancing after the routine before the credits. */
const AFTER = 9;
/** The player's jump window (src/game/player.ts), for the ring hopping on a landing. */
const HOP = { from: 0.8, to: 1.56, speed: 1.15, fade: 0.06 } as const;

/** What the ring shouts at each move. */
const BREAK_BARKS: Partial<Record<RoutineStep['id'], string[]>> = {
  break_sixstep: ['Look at those legs go!', 'Footwork!'],
  break_spin: ['Spin it!', 'Round and round!'],
  break_jumpspin: ['Two full turns!', 'Seven-twenty!'],
  break_backflip: ['A back flip!', 'It flipped!'],
  break_oneclaw: ['Freeze!', 'On one claw!'],
};

/** Moves the ring answers when they land, not when they start. */
const ON_LANDING = new Set<RoutineStep['id']>(['break_jumpspin', 'break_backflip', 'break_oneclaw']);

interface Reaction {
  at: number;
  run: () => void;
}

/** Two staggered rings so the whole town fits around the hero in a small square. */
function ringSlots(n: number): { a: number; r: number }[] {
  const inner = Math.ceil(n / 2);
  const out: { a: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ring = i < inner ? 0 : 1;
    const k = ring === 0 ? i : i - inner;
    const m = ring === 0 ? inner : n - inner;
    out.push({ a: ((k + (ring ? 0.5 : 0)) / m) * Math.PI * 2, r: ring ? 6.4 : 4.2 });
  }
  return out;
}

export class EndingSequence {
  active = false;
  private t = 0;
  private started = false;
  private nextFirework = 0;
  private nextBark = 0;
  private dancers: Unit[] = [];
  private centre = new THREE.Vector3();
  private orbit0 = 0;
  private finishing = false;
  private captionText: string | null = null;
  /** The hero's breakdance, started at BREAK_AT (built with the ending: the player comes later). */
  routine: BreakRoutine | null = null;
  private breakStarted = false;
  /** Seconds into the ending when the routine ended (-1 until then). */
  private breakEnded = -1;
  private stepLabel = '';
  private length = BREAK_AT + routineLength() + AFTER;
  private reactions: Reaction[] = [];

  constructor(private readonly game: Game) {}

  async start(): Promise<void> {
    if (this.active) return;
    const g = this.game;
    this.active = true;
    g.hud.dialogue.close();
    g.hud.questLog.toggle(false);
    g.player.setTarget(null);
    g.player.breakdance.cancel(0);
    g.hud.setCinematic(true);
    g.say(g.npcById('brinebeard')!.unit, 'Clawhaven! Gather round! Our hero is back!', true);
    g.audio.playMusic('music-ending', 2.5);
    void preloadRoutine();
    await g.app.blackout(true, 1100);
    if (!g.alive) return;
    // Under the black: drop any dialogue shot and its long lens before the ending camera takes over.
    g.follow.cut();

    g.world.setMood(2);
    g.world.setBeaconLit(true);
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    for (const a of g.boss.adds) a.despawn();

    const spawn = g.world.pois.spawn;
    const p = g.player.unit;
    // Everyone in town, every race.
    const crowd = [...g.npcs.map((n) => n.unit), ...g.townsfolk.map((t) => t.unit)];
    const n = crowd.length;
    const slots = ringSlots(n);
    const c = this.openSquare(spawn.position, spawn.yaw, slots);
    p.motion.stop(undefined, 0);
    p.teleport(g.world, c.x, c.z, spawn.yaw);
    this.centre.copy(p.pos);

    crowd.forEach((u, i) => {
      const s = slots[i];
      const x = this.centre.x + Math.sin(s.a + spawn.yaw) * s.r;
      const z = this.centre.z + Math.cos(s.a + spawn.yaw) * s.r;
      u.hidden = false;
      u.motion.stop(undefined, 0);
      u.teleport(g.world, x, z, yawTo(x, z, this.centre.x, this.centre.z));
    });
    this.dancers = [p, ...crowd];
    this.dancers.forEach((u, i) => {
      u.express(i % 3 === 0 ? 'love' : 'happy', 60);
      u.act(DANCES[i % DANCES.length], { loop: true, fade: 0.3, speed: rand(0.95, 1.05) });
    });
    this.orbit0 = spawn.yaw + Math.PI * 0.85;
    g.engine.setView(g.scene, g.camera, {
      bloom: { intensity: 1.15, threshold: 0.8 },
      dof: { focusDistance: 9, focusRange: 7, bokehScale: 2.2 },
      vignette: { offset: 0.25, darkness: 0.65 },
      saturation: 0.08,
    });
    this.routine = new BreakRoutine(p, {
      onStep: (step) => this.onBreakStep(step),
      onEvent: (name, step) => this.onBreakEvent(name, step),
      onEnd: () => this.onBreakEnd(),
    });
    this.t = 0;
    this.breakStarted = false;
    this.breakEnded = -1;
    this.reactions = [];
    this.length = BREAK_AT + routineLength() + AFTER;
    this.started = true;
    this.nextFirework = 1.2;
    this.nextBark = 2.5;
    this.placeCamera(0);
    await g.app.blackout(false, 1400);
  }

  /** A spot near the square where the whole ring fits on open, level ground (fountains get in the way). */
  private openSquare(base: THREE.Vector3, yaw: number, slots: { a: number; r: number }[]): THREE.Vector3 {
    const w = this.game.world;
    const tmp = new THREE.Vector2();
    let best = base.clone();
    let bestScore = -Infinity;
    for (const dist of [0, 4, 8, 12]) {
      for (let k = 0; k < (dist === 0 ? 1 : 8); k++) {
        const a = yaw + (k / 8) * Math.PI * 2;
        const cx = base.x + Math.sin(a) * dist;
        const cz = base.z + Math.cos(a) * dist;
        const y0 = w.heightAt(cx, cz);
        let score = -dist * 0.6;
        for (const s of slots) {
          const x = cx + Math.sin(s.a + yaw) * s.r;
          const z = cz + Math.cos(s.a + yaw) * s.r;
          const r = w.resolveCollision(x, z, 0.6, tmp);
          const blocked = Math.hypot(r.x - x, r.y - z) > 0.05 || Math.abs(w.heightAt(x, z) - y0) > 0.6;
          score += blocked ? -1 : 1;
        }
        const own = w.resolveCollision(cx, cz, 0.6, tmp);
        if (Math.hypot(own.x - cx, own.y - cz) > 0.05) score -= slots.length;
        if (score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(cx, y0, cz);
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- the hero's breakdance

  private get crowd(): Unit[] {
    return this.dancers.slice(1);
  }

  /** Run `fn` `delay` seconds from now, on the ending's clock. */
  private later(delay: number, fn: () => void): void {
    this.reactions.push({ at: this.t + delay, run: fn });
  }

  private startBreak(): void {
    const g = this.game;
    this.breakStarted = true;
    // The ring stops to watch, facing the hero, and the hero takes the floor.
    for (const u of this.crowd) {
      u.motion.stop(undefined, 0.5);
      u.express('happy', 30);
    }
    const brine = g.npcById('brinebeard')?.unit;
    if (brine) g.say(brine, 'Make room! Our hero is going to break!', true);
    this.routine?.start();
  }

  private onBreakStep(step: RoutineStep): void {
    const g = this.game;
    this.stepLabel = step.label;
    const barks = BREAK_BARKS[step.id];
    const crowd = this.crowd;
    if (barks && crowd.length && !ON_LANDING.has(step.id)) {
      this.later(rand(1.2, 2), () => g.say(pick(crowd), pick(barks)));
    }
    if (step.id === 'break_toprock') {
      // A few in the ring wave along with the count.
      for (const u of crowd) if (Math.random() < 0.35) this.later(rand(0.6, 2.5), () => u.act('gesture_hello', { fade: 0.25 }));
    }
  }

  private onBreakEvent(name: string, step: RoutineStep): void {
    const g = this.game;
    if (name === 'takeoff') g.audio.sfx('sfx-servo-whir', { volume: 0.45 });
    const landing = name === 'land' && (step.id === 'break_jumpspin' || step.id === 'break_backflip');
    const freeze = name === 'hit' && step.id === 'break_oneclaw';
    if (!landing && !freeze) return;
    g.audio.sfx('sfx-footstep-stone', { volume: 0.6, pitch: 0.06 });
    g.audio.sfx('sfx-crit', { volume: 0.3, delay: 0.05 });
    // The ring erupts: hops, raised claws, a shout, fireworks right over the square.
    const crowd = this.crowd;
    const share = step.id === 'break_backflip' || freeze ? 0.85 : 0.6;
    for (const u of crowd) {
      if (Math.random() > share) continue;
      const d = rand(0.05, 0.35);
      if (freeze || Math.random() < 0.35) {
        const wave: MotionId = Math.random() < 0.5 ? 'gesture_salute' : 'gesture_hello';
        this.later(d, () => u.act(wave, { fade: 0.15 }));
      } else this.later(d, () => u.act('jump', HOP));
      u.express('love', 4);
    }
    const barks = BREAK_BARKS[step.id];
    if (barks && crowd.length) g.say(pick(crowd), pick(barks), true);
    for (let i = 0; i < (freeze ? 4 : 2); i++) {
      const a = Math.random() * Math.PI * 2;
      const at = this.centre.clone().add(new THREE.Vector3(Math.cos(a) * rand(6, 12), 0, Math.sin(a) * rand(6, 12)));
      at.y = g.world.heightAt(at.x, at.z);
      this.later(i * 0.18, () => g.vfx.firework(at, pick(FIREWORK_COLORS), rand(8, 11)));
    }
  }

  private onBreakEnd(): void {
    if (this.finishing) return;
    this.breakEnded = this.t;
    this.length = this.t + AFTER;
    // Everyone dances again, the hero with them.
    this.dancers.forEach((u, i) => {
      this.later(i === 0 ? 0.6 : rand(0.1, 0.8), () => u.act(DANCES[i % DANCES.length], { loop: true, fade: 0.4, speed: rand(0.95, 1.05) }));
    });
  }

  private caption(t: number): string {
    if (!this.breakStarted) return t >= 1.5 ? 'The Rust Tide has ebbed. The Saltmere beacon burns again.' : '';
    if (this.breakEnded < 0) return this.stepLabel;
    const after = t - this.breakEnded;
    if (after < 3.5) return 'Every move of that routine is a trained Jumper policy, rolled out in MuJoCo.';
    if (after < 6.5) return 'Clawhaven dances until the tide comes in.';
    return `Thank you for playing, ${this.game.player.unit.name}.`;
  }

  private placeCamera(t: number): void {
    const g = this.game;
    // Start high and wide over the ring, then settle inside it at crab height.
    const k = easeInOut(Math.min(1, t / 12));
    const r = 11 - 7 * k;
    const hgt = 6.5 - 4 * k;
    const a = this.orbit0 + t * 0.16;
    const cam = g.camera;
    cam.position.set(this.centre.x + Math.sin(a) * r, this.centre.y + hgt, this.centre.z + Math.cos(a) * r);
    cam.lookAt(this.centre.x, this.centre.y + 0.9 + (1 - k) * 0.6, this.centre.z);
    g.engine.setFocus(cam.position.distanceTo(this.centre), 6 + (1 - k) * 5);
  }

  update(dt: number): void {
    if (!this.active || !this.started) return;
    const g = this.game;
    this.t += dt;
    const t = this.t;

    if (!this.breakStarted && t >= BREAK_AT) this.startBreak();
    this.routine?.update(dt);
    // The camera's centre follows the hero, whose moves travel a little.
    const p = g.player.unit.pos;
    const follow = Math.min(1, dt * 1.5);
    this.centre.x += (p.x - this.centre.x) * follow;
    this.centre.z += (p.z - this.centre.z) * follow;
    this.placeCamera(t);
    for (let i = this.reactions.length - 1; i >= 0; i--) {
      const r = this.reactions[i];
      if (t < r.at) continue;
      this.reactions.splice(i, 1);
      r.run();
    }

    const text = this.caption(t);
    if (text !== this.captionText) {
      this.captionText = text;
      g.hud.setCaption(text);
    }
    if (t > 4) g.hud.showSkip(true);

    if (t >= this.nextFirework) {
      this.nextFirework = t + rand(0.5, 1.3);
      // Over the bay, and now and then right above the square so the camera always catches some.
      const sea = g.seaDirection();
      const a = Math.random() * Math.PI * 2;
      const base = Math.random() < 0.5 ? this.centre.clone().addScaledVector(sea, rand(16, 34)) : this.centre.clone().add(new THREE.Vector3(Math.cos(a) * rand(14, 24), 0, Math.sin(a) * rand(14, 24)));
      base.y = g.world.heightAt(base.x, base.z);
      g.vfx.firework(base, pick(FIREWORK_COLORS), rand(7, 12));
      if (Math.random() < 0.4) g.audio.sfx('sfx-crit', { volume: 0.25, delay: 1.2 });
    }
    // The ring chats while it dances; while the hero breaks it shouts at the moves instead.
    const dancing = !this.breakStarted || this.breakEnded >= 0;
    if (t >= this.nextBark && this.dancers.length > 1 && dancing) {
      this.nextBark = t + rand(1.6, 3.2);
      g.say(pick(this.dancers.slice(1)), pick(ENDING_BARKS));
    }
    const skip = t > 4 && (g.input.wasPressed('Space') || g.input.wasPressed('Escape') || g.input.wasPressed('Enter'));
    if ((t >= this.length || skip) && !this.finishing) {
      this.finishing = true;
      this.routine?.cancel(0.2);
      void g.app.go('ending', { name: g.player.unit.name });
    }
  }
}
