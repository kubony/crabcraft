// Camera direction on top of the player's follow camera: the Corrodius fight framing (higher and
// further back, the player's crab low in frame with the boss above it, the camera kept out of his
// body, his armour thinned where it covers the crab) and the over-the-shoulder dialogue shot (the
// player's own claws and gear thinned where they cross the NPC's face).
import * as THREE from 'three';
import type { CameraAvoid, CameraShot } from '../core/followCamera';
import type { Game } from './game';
import { Npc } from './npcs';
import type { Unit } from './unit';
import { SeeThrough } from './seeThrough';
import { clamp } from './util';

/** Zoom the fight starts at (the player can still wheel in or out). */
const BOSS_DISTANCE = 14.5;
/** Seconds the dialogue shot holds after the window closes, so a quest chain does not cut out and in. */
const SHOT_LINGER = 0.45;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraDirector {
  /** On the boss: his armour thins where it covers the player's crab. */
  readonly bossSee = new SeeThrough();
  /** On the player: its claws and gear thin where they cross the NPC's face in the dialogue shot. */
  readonly playerSee = new SeeThrough();
  private bossCam = false;
  private userDistance = 7.5;
  private readonly avoid: CameraAvoid = { center: new THREE.Vector3(), rx: 1, ry: 1 };
  private readonly shot: CameraShot = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  private talkUnit: Unit | null = null;
  private lastTalk: Unit | null = null;
  private released = false;
  private linger = 0;
  private dlgRight = 0;
  private dlgW = 0;
  private dlgFor: Unit | null = null;
  private readonly face = new THREE.Vector3();
  private readonly cheat = new THREE.Vector3();
  private cheating: Npc | null = null;
  private faceRadius = 0.6;

  constructor(private readonly game: Game) {}

  update(dt: number): void {
    const g = this.game;
    const f = g.follow;
    const b = g.boss;
    const bu = b.unit;
    const p = g.player.unit;

    // Fight framing: pull back once when the fight starts, give the zoom back when it ends.
    const fight = b.engaged;
    if (fight && !this.bossCam) {
      this.bossCam = true;
      this.userDistance = f.distance;
      f.distance = Math.max(f.distance, BOSS_DISTANCE);
    } else if (!fight && this.bossCam) {
      this.bossCam = false;
      f.distance = Math.min(f.distance, Math.max(this.userDistance, 4));
    }
    f.assist = fight ? 1 : 0;
    f.hasFocus = fight && !bu.hidden;
    if (f.hasFocus) f.focus.set(bu.pos.x, bu.pos.y + bu.height * 0.55, bu.pos.z);
    // His body (shell and legs, not the reach of the claws) is solid to the camera.
    const bossShown = !bu.hidden && bu.rig.root.visible;
    if (bossShown) {
      this.avoid.center.set(bu.pos.x, bu.pos.y + bu.height * 0.5, bu.pos.z);
      this.avoid.rx = bu.radius * 1.35;
      this.avoid.ry = bu.height * 0.62;
    }
    f.avoid = bossShown ? this.avoid : null;

    f.shot = this.dialogueShot(dt);
    if (!f.shot && this.cheating) {
      this.cheating.lookAt = null;
      this.cheating = null;
    }
    f.update(dt, g.input, p.pos);

    const see = bossShown && p.alive && !p.hidden && p.distTo(bu) < 30;
    this.bossSee.update(dt, g.camera, p.centre(v1), Math.max(1.3, p.height * 1.25 + 0.55), see ? 1 : 0);
    // Only once the shot has mostly arrived, so the crab's back does not thin while the camera swings past it.
    this.playerSee.update(dt, g.camera, this.face, this.faceRadius, f.shot ? f.shotBlend ** 2 : 0);
  }

  /** The player is steering, walking or zooming: they want the camera back. */
  private takingControl(): boolean {
    const inp = this.game.input;
    if ((inp.isButtonDown(0) || inp.isButtonDown(2)) && Math.abs(inp.dx) + Math.abs(inp.dy) > 1) return true;
    if (inp.wheel) return true;
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      if (inp.isDown(k)) return true;
    }
    return this.game.player.unit.moveSpeed > 0.8;
  }

  /**
   * Over the player's shoulder onto the NPC: the NPC's face in the open part of the screen right of
   * the dialogue window, the player's shell at the right edge, a slightly long lens.
   */
  private dialogueShot(dt: number): CameraShot | null {
    const g = this.game;
    const dlg = g.hud.dialogue;
    const u = dlg.unit;
    if (u !== this.talkUnit) {
      this.talkUnit = u;
      if (u) {
        if (u !== this.lastTalk || this.linger <= 0) this.released = false;
        this.lastTalk = u;
      }
    }
    if (u) this.linger = SHOT_LINGER;
    else this.linger -= dt;
    const n = u ?? (this.linger > 0 ? this.lastTalk : null);
    if (n && this.takingControl()) this.released = true;
    const p = g.player.unit;
    if (!n || this.released || g.boss.engaged || !p.alive) return null;

    let ux = n.pos.x - p.pos.x;
    let uz = n.pos.z - p.pos.z;
    const d = Math.hypot(ux, uz);
    if (d < 0.05) return null;
    ux /= d;
    uz /= d;
    // Screen right when looking from the player toward the NPC.
    const rx = -uz;
    const rz = ux;
    const face = n.socketPos('face', v1);
    if (!Number.isFinite(face.y) || face.y < n.pos.y + 0.1) face.set(n.pos.x, n.pos.y + n.height * 0.75, n.pos.z);

    // Behind the player and well off its left shoulder: the NPC clear in frame, seen three-quarter
    // on as it faces the player, whose shell just edges into the right of the picture. If a wall
    // stands there, try the right shoulder instead.
    const back = clamp(5.6 - d, 2.2, 3);
    const side = p.radius * 1.6 + 1.5;
    const camY = Math.max(p.pos.y, n.pos.y) + Math.max(p.height, n.height) + 0.95;
    const cam = this.shot.position;
    let best = -1;
    for (const s of [-1, 1]) {
      v2.set(p.pos.x - ux * back + rx * side * s, camY, p.pos.z - uz * back + rz * side * s);
      const reach = v2.distanceTo(face);
      const hit = g.world.raycastSolid(face, v2);
      const clear = hit === null || hit >= reach ? reach : Math.max(1.2, hit - 0.3);
      // The left shoulder wins unless a wall cuts it noticeably shorter.
      if (best < 0 || clear > best + 0.75) {
        best = clear;
        cam.copy(v2).sub(face).setLength(clear).add(face);
      }
    }
    // A lens that keeps the NPC about 40% of the frame tall wherever the player stopped.
    const dist = cam.distanceTo(face);
    const fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan((n.height * 1.35) / (2 * 0.4 * dist))), 24, 46);

    // Put the face in the middle of the open area right of the window, a little above centre.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (u && (this.dlgW !== w || this.dlgFor !== u)) {
      // Layout box, not the slide-in transform; measured once per dialogue and window size.
      const el = dlg.el;
      this.dlgRight = el.offsetWidth ? el.offsetLeft + el.offsetWidth : 0;
      this.dlgW = w;
      this.dlgFor = u;
    }
    const xFrac = clamp((this.dlgRight + w) / 2 / w, 0.5, 0.72);
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const tanH = tanV * (w / Math.max(1, h));
    const fwd = v2.copy(face).sub(cam).normalize();
    const right = v3.crossVectors(fwd, UP).normalize();
    const camUp = v2.crossVectors(right, fwd);
    this.shot.target
      .copy(face)
      .addScaledVector(right, -(xFrac * 2 - 1) * tanH * dist)
      .addScaledVector(camUp, -0.12 * tanV * dist);
    this.shot.fov = fov;
    // Cheat the look: the NPC turns most of the way from the player toward the lens, so its face
    // reads and its own raised claws (Grukk's sword) stay off it.
    if (n.ctrl instanceof Npc) {
      if (this.cheating && this.cheating !== n.ctrl) this.cheating.lookAt = null;
      this.cheating = n.ctrl;
      n.ctrl.lookAt = this.cheat.set(THREE.MathUtils.lerp(p.pos.x, cam.x, 0.6), 0, THREE.MathUtils.lerp(p.pos.z, cam.z, 0.6));
    }
    this.face.copy(face);
    this.faceRadius = n.height * 0.6;
    return this.shot;
  }
}
