// ?debug=1 only: F8 god mode, F9 complete the current objective, F10 teleport to the next
// objective, an fps / draw-call readout, and window.cc for the playtest script.
import * as THREE from 'three';
import type { Game } from './game';
import { QUESTS } from './quests';
import { C } from './vfx/vfx';

export class DebugTools {
  private acc = 0;

  constructor(private readonly game: Game) {
    window.addEventListener('keydown', this.onKey, true);
    game.hud.debugEl.classList.remove('hidden');
    (window as unknown as { cc: unknown }).cc = {
      game,
      state: () => this.state(),
      C,
      THREE,
    };
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F8' || e.code === 'F9' || e.code === 'F10') {
      e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'F8') this.toggleGod();
      if (e.code === 'F9') this.completeObjective();
      if (e.code === 'F10') this.teleport();
    }
  };

  toggleGod(): void {
    const g = this.game;
    g.god = !g.god;
    g.hud.messages.info(g.god ? 'God mode ON' : 'God mode OFF');
  }

  completeObjective(): void {
    const g = this.game;
    const cur = g.quests.current();
    if (!cur) return;
    if (cur.step === 'accept') {
      g.acceptQuest(cur.quest);
      return;
    }
    if (cur.step === 'turnin') {
      g.turnIn(cur.quest);
      return;
    }
    const o = cur.objective!;
    switch (o.kind) {
      case 'kill-scrapling':
      case 'kill-scavenger':
      case 'collect-cog':
      case 'deliver':
        g.quests.completeObjective(o);
        break;
      case 'beacon':
        g.lightBeacon();
        break;
      case 'boss':
        if (g.boss.state === 'dormant') g.boss.wake();
        else g.boss.debugAdvance();
        break;
    }
  }

  teleport(): void {
    const g = this.game;
    let target = g.objectivePos();
    if (!target) return;
    const p = g.player.unit;
    const cur = g.quests.current();
    // Hunting from far away: drop in next to the pack nearest the middle of the hunting ground.
    const hunt = cur?.objective?.kind;
    if (hunt === 'kill-scrapling' || hunt === 'kill-scavenger' || hunt === 'collect-cog') {
      const area = g.world.pois[cur!.objective!.poi].position;
      const kind = hunt === 'kill-scavenger' ? 'scavenger' : 'scrapling';
      let best: THREE.Vector3 | null = null;
      let bestD = Infinity;
      for (const e of g.enemies) {
        if (e.kind !== kind || e.isAdd || !e.unit.alive || e.unit.hidden) continue;
        const d = Math.hypot(e.unit.pos.x - area.x, e.unit.pos.z - area.z);
        if (d < bestD) {
          bestD = d;
          best = e.unit.pos;
        }
      }
      if (best && target.distanceTo(area) < 0.01) target = best;
    }
    let back = 3.2;
    if (cur?.objective?.kind === 'boss') back = Math.min(4.5, g.world.pois.bossArena.radius * 0.6);
    // The beacon spot is the walkable gallery tile itself; stepping back could drop us off the tower.
    if (cur?.objective?.kind === 'beacon') back = 0;
    if (cur?.objective?.kind === 'kill-scrapling' || cur?.objective?.kind === 'kill-scavenger' || cur?.objective?.kind === 'collect-cog') back = 9;
    let dx = p.pos.x - target.x;
    let dz = p.pos.z - target.z;
    // For hunting objectives come in from the open middle of the area, not from behind a hut.
    const k = cur?.objective?.kind;
    if (k === 'kill-scrapling' || k === 'kill-scavenger' || k === 'collect-cog') {
      const area = g.world.pois[cur!.objective!.poi].position;
      if (Math.hypot(area.x - target.x, area.z - target.z) > 2) {
        dx = area.x - target.x;
        dz = area.z - target.z;
      }
    }
    const len = Math.hypot(dx, dz);
    if (len < 0.01) {
      dx = 1;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    const x = target.x + dx * back;
    const z = target.z + dz * back;
    p.teleport(g.world, x, z, Math.atan2(-dx, -dz));
    g.follow.yaw = p.yaw + Math.PI;
    g.player.cancelChannel();
    g.player.interruptCast();
  }

  state(): Record<string, unknown> {
    const g = this.game;
    const cur = g.quests.current();
    return {
      loaded: g.loaded,
      time: g.time,
      fps: g.engine.fps,
      pixelRatio: g.engine.pixelRatio,
      gpuMs: g.engine.gpuMs,
      drawCalls: g.engine.drawCalls,
      quests: { ...g.quests.status },
      current: cur ? { quest: cur.quest, step: cur.step, label: cur.label, title: QUESTS[cur.quest].title } : null,
      playerHp: g.player.unit.hp,
      playerAlive: g.player.unit.alive,
      level: g.player.unit.level,
      target: g.player.target?.name ?? null,
      dialogueOpen: g.hud.dialogue.isOpen,
      boss: { state: g.boss.state, phase: g.boss.phase, hp: g.boss.unit.hp, telegraph: g.boss.telegraphActive, mech: g.boss.mechName, adds: g.boss.adds.filter((a) => a.unit.alive).length },
      ending: g.ending.active,
      zone: g.zone,
      crabs: g.units.filter((u) => !u.hidden && !u.culled).length,
      particles: g.vfx.add.count + g.vfx.alpha.count,
    };
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const g = this.game;
    const s = this.state();
    g.hud.debugEl.classList.toggle('god', g.god);
    const e = g.engine;
    const gpu = e.gpuMs >= 0 ? `  gpu ${e.gpuMs.toFixed(1)} ms` : '';
    g.hud.debugEl.textContent = `${e.fps.toFixed(0)} fps  ${e.drawCalls} calls\nres ${e.pixelRatio}x ${e.setting}${gpu}\ncrabs ${s.crabs}  particles ${s.particles}${g.god ? '\nGOD MODE' : ''}\nF8 god  F9 objective  F10 teleport`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    delete (window as unknown as { cc?: unknown }).cc;
  }
}
