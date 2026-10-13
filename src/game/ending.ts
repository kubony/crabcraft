// The celebration: the whole town gathers in a ring around the player in Clawhaven Square, every
// crab plays the recorded dances, fireworks burst over the bay, the camera orbits slowly with
// depth of field, then the credits roll.
import * as THREE from 'three';
import type { MotionId } from '../motion/types';
import type { Game } from './game';
import type { Unit } from './unit';
import { ENDING_BARKS } from './quests';
import { C } from './vfx/vfx';
import { easeInOut, pick, rand, yawTo } from './util';

const DANCES: MotionId[] = ['dance_crab', 'dance_brazilian', 'dance_dream_wings', 'dance_maze'];
const FIREWORK_COLORS = [C.gold, C.redHot, C.water, C.purple, C.green, C.holy];
const LENGTH = 30;

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
  private captionIndex = -1;

  constructor(private readonly game: Game) {}

  async start(): Promise<void> {
    if (this.active) return;
    const g = this.game;
    this.active = true;
    g.hud.dialogue.close();
    g.hud.questLog.toggle(false);
    g.player.setTarget(null);
    g.hud.setCinematic(true);
    g.say(g.npcById('brinebeard')!.unit, 'Clawhaven! Gather round! Our hero is back!', true);
    g.audio.playMusic('music-ending', 2.5);
    await g.app.blackout(true, 1100);
    if (!g.alive) return;

    g.world.setMood(2);
    g.world.setBeaconLit(true);
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    for (const a of g.boss.adds) a.despawn();

    const spawn = g.world.pois.spawn;
    const p = g.player.unit;
    p.motion.stop(undefined, 0);
    p.teleport(g.world, spawn.position.x, spawn.position.z, spawn.yaw);
    this.centre.copy(p.pos);

    // Everyone in town, every race.
    const crowd = [...g.npcs.map((n) => n.unit), ...g.townsfolk.map((t) => t.unit)];
    const n = crowd.length;
    const radius = Math.max(4.2, n * 0.42);
    crowd.forEach((u, i) => {
      const a = (i / n) * Math.PI * 2 + spawn.yaw;
      const x = this.centre.x + Math.sin(a) * radius;
      const z = this.centre.z + Math.cos(a) * radius;
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
      dof: { focusDistance: 9, focusRange: 5, bokehScale: 3 },
      vignette: { offset: 0.25, darkness: 0.65 },
      saturation: 0.08,
    });
    this.t = 0;
    this.started = true;
    this.nextFirework = 1.2;
    this.nextBark = 2.5;
    this.placeCamera(0);
    await g.app.blackout(false, 1400);
  }

  private placeCamera(t: number): void {
    const g = this.game;
    const k = easeInOut(Math.min(1, t / 14));
    const r = 13 - 5.5 * k;
    const hgt = 4.2 - 2.2 * k;
    const a = this.orbit0 + t * 0.14;
    const cam = g.camera;
    cam.position.set(this.centre.x + Math.sin(a) * r, this.centre.y + hgt, this.centre.z + Math.cos(a) * r);
    cam.lookAt(this.centre.x, this.centre.y + 0.9 + (1 - k) * 0.6, this.centre.z);
    g.engine.setFocus(cam.position.distanceTo(this.centre), 4 + (1 - k) * 4);
  }

  update(dt: number): void {
    if (!this.active || !this.started) return;
    const g = this.game;
    this.t += dt;
    const t = this.t;
    this.placeCamera(t);

    const captions = [
      [1.5, 'The Rust Tide has ebbed. The Saltmere beacon burns again.'],
      [8, 'Clawhaven dances until the tide comes in.'],
      [15, "Every step you see is a recorded rollout of Jumper's real trained policies."],
      [22.5, `Thank you for playing, ${g.player.unit.name}.`],
    ] as const;
    let idx = -1;
    for (let i = 0; i < captions.length; i++) if (t >= captions[i][0]) idx = i;
    if (idx !== this.captionIndex) {
      this.captionIndex = idx;
      g.hud.setCaption(idx >= 0 ? captions[idx][1] : '');
    }
    if (t > 4) g.hud.showSkip(true);

    if (t >= this.nextFirework) {
      this.nextFirework = t + rand(0.5, 1.3);
      const sea = g.seaDirection();
      const base = this.centre.clone().addScaledVector(sea, rand(8, 30));
      base.y = g.world.heightAt(base.x, base.z);
      g.vfx.firework(base, pick(FIREWORK_COLORS));
      if (Math.random() < 0.4) g.audio.sfx('sfx-crit', { volume: 0.25, delay: 1.2 });
    }
    if (t >= this.nextBark && this.dancers.length > 1) {
      this.nextBark = t + rand(1.6, 3.2);
      g.say(pick(this.dancers.slice(1)), pick(ENDING_BARKS));
    }
    const skip = t > 4 && (g.input.wasPressed('Space') || g.input.wasPressed('Escape') || g.input.wasPressed('Enter'));
    if ((t >= LENGTH || skip) && !this.finishing) {
      this.finishing = true;
      void g.app.go('ending', { name: g.player.unit.name });
    }
  }
}
