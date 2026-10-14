// Public entry for the crab model: createCrab / createEnemyCrab (same signatures as ./stub).
import { RACES } from '../data/races';
import { dressCrab, preloadGear, type EnemyKind } from './gear';
import { JumperRig, type CrabLook } from './rig';
import { loadCrabTemplate, type CrabTemplate } from './template';
import type { CrabRig, CrabSpec, Expression } from './types';

export { HOME, HOME_POSE, STAND_Z } from './pose';
export type { EnemyKind } from './gear';

const clampIdx = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(i) || 0));

/** How a player/NPC spec looks: paint, LED, posture, which links lose their cover. */
export function lookForSpec(spec: CrabSpec): CrabLook {
  const race = RACES[spec.race];
  const shell = race.shellColors[clampIdx(spec.shell, race.shellColors.length)].hex;
  const led = race.ledColors[clampIdx(spec.led, race.ledColors.length)].hex;
  const undead = spec.race === 'undead';
  return {
    shell: { color: shell, wear: undead ? 0.55 : spec.race === 'orc' ? 0.2 : spec.race === 'dwarf' ? 0.08 : 0 },
    parts: undead ? 'rust' : '',
    led,
    female: spec.sex === 'female',
    flicker: undead,
    posture: { ...race.posture },
    // Undead: the rear-left walking leg is stripped to its frame (gear adds the bare struts).
    without: undead ? ['LR_hip_link', 'LR_calf_link'] : [],
    idle: 'neutral' as Expression,
    ledHalo: spec.race === 'nightelf' ? 2.2 : 1,
    twitch: undead,
  };
}

/**
 * The same look on the real robot's kinematics: paint, LED and gear stay, but the race posture
 * (scale, body height, stance, hunch, joint bias) and the undead servo twitch go, so every link
 * sits exactly where the physics puts the robot's.
 */
export function exactLook(look: CrabLook): CrabLook {
  return { ...look, posture: { scale: 1, bodyHeight: 1, stanceWidth: 1, hunch: 0 }, twitch: false };
}

class Crab extends JumperRig {
  private extras: string[];
  private enemy: EnemyKind | null;
  private exact: boolean;
  private dressing = 0;

  constructor(t: CrabTemplate, spec: CrabSpec, look: CrabLook, extras: string[], enemy: EnemyKind | null, exact = false) {
    super(t, spec, exact ? exactLook(look) : look);
    this.extras = extras;
    this.enemy = enemy;
    this.exact = exact;
  }

  async dress(): Promise<void> {
    const ticket = ++this.dressing;
    await dressCrab(this, this.spec, this.extras, this.enemy, () => ticket === this.dressing);
  }

  override async applySpec(spec: CrabSpec): Promise<void> {
    this.spec = { ...spec };
    this.root.name = `crab:${spec.name}`;
    if (!this.enemy) this.applyLook(this.exact ? exactLook(lookForSpec(spec)) : lookForSpec(spec));
    await this.dress();
  }
}

/**
 * A player or NPC crab. `extras` adds optional NPC props by id (e.g. 'captain-hat').
 * Shares geometry and materials with every other crab; the first call loads the model.
 */
export async function createCrab(spec: CrabSpec, extras: string[] = []): Promise<CrabRig> {
  const [t] = await Promise.all([loadCrabTemplate(), preloadGear()]);
  const crab = new Crab(t, spec, lookForSpec(spec), extras, null);
  await crab.dress();
  return crab;
}

/**
 * A player crab for Robot Mode: dressed exactly like createCrab's, but on the robot's own
 * kinematics (see exactLook), so posing it from live physics state overlays the simulated robot.
 * metersToUnits is the plain CRAB_HEIGHT scale; scale root by 1 / metersToUnits for metres.
 */
export async function createRobotCrab(spec: CrabSpec): Promise<CrabRig> {
  const [t] = await Promise.all([loadCrabTemplate(), preloadGear()]);
  const crab = new Crab(t, spec, lookForSpec(spec), [], null, true);
  await crab.dress();
  return crab;
}

const ENEMY_LOOK: Record<EnemyKind, () => CrabLook> = {
  scrapling: () => ({
    shell: { color: '#7a4a2c', wear: 1, metal: 0.25 },
    parts: 'rust',
    led: '#ff2a1a',
    female: false,
    flicker: true,
    ledIntensity: 1.2,
    posture: { scale: 0.6, bodyHeight: 0.85, stanceWidth: 1.1, hunch: 0.15 },
    without: [],
    idle: 'angry',
  }),
  scavenger: () => ({
    shell: { color: '#b4541c', wear: 0.85, metal: 0.15 },
    parts: 'rust',
    led: '#ffb020',
    female: false,
    flicker: false,
    posture: { scale: 1.0, bodyHeight: 0.95, stanceWidth: 1.15, hunch: 0.12, extra: { RF_J1_joint: 0.15 } },
    without: [],
    linkScale: { RF_palm_link: 1.55 },
    idle: 'angry',
  }),
  corrodius: () => ({
    shell: { color: '#7a3d1e', wear: 0.9, metal: 0.45 },
    parts: 'rust',
    led: '#ff3a12',
    female: false,
    flicker: false,
    ledIntensity: 1.6,
    posture: { scale: 3.5, bodyHeight: 1.0, stanceWidth: 1.1, hunch: 0.08, extra: { RF_J1_joint: 0.1 } },
    without: [],
    linkScale: { RF_palm_link: 1.8 },
    idle: 'angry',
  }),
};

/** Enemies use the same rig, so every motion clip plays on them. */
export async function createEnemyCrab(kind: EnemyKind): Promise<CrabRig> {
  const [t] = await Promise.all([loadCrabTemplate(), preloadGear()]);
  const spec: CrabSpec = { race: 'undead', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: kind };
  const crab = new Crab(t, spec, ENEMY_LOOK[kind](), [], kind);
  await crab.dress();
  return crab;
}
