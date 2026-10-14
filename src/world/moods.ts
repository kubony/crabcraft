// Lighting moods: 0 dusk (golden hour, the default), 1 night (boss fight), 2 celebration (fireworks).
// Every value is a target; the world blends toward it over a couple of seconds.
import * as THREE from 'three';
import { MOON_DIR, SUN_DIR_DUSK } from './layout';

export interface Mood {
  keyDir: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sunColor: THREE.Color;
  glow: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  sunVis: number;
  stars: number;
  moon: number;
  cloudCover: number;
  fogColor: THREE.Color;
  fogDensity: number;
  waterDeep: THREE.Color;
  waterShallow: THREE.Color;
  waterLight: THREE.Color;
  /** Emissive multiplier for windows, lamps, candles. */
  lamps: number;
  fireflies: number;
}

const c = (hex: string) => new THREE.Color(hex);
const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]).normalize();

export const MOODS: Mood[] = [
  {
    // Dusk: low sun over the bay, amber key light, deep blue zenith, gold-peach horizon.
    keyDir: v(SUN_DIR_DUSK),
    keyColor: c('#ffb36b'),
    keyIntensity: 5.0,
    hemiSky: c('#8eaaf2'),
    hemiGround: c('#5e3e24'),
    hemiIntensity: 0.7,
    envIntensity: 0.38,
    zenith: c('#2a5cc4'),
    mid: c('#e8988e'),
    horizon: c('#ffbe6a'),
    ground: c('#f4b077'),
    sunColor: c('#fff0c0'),
    glow: c('#ff9c45'),
    cloudLit: c('#ffc68e'),
    cloudShade: c('#9a6a8a'),
    sunVis: 1,
    stars: 0,
    moon: 0,
    cloudCover: 0.55,
    fogColor: c('#eab07e'),
    fogDensity: 0.0011,
    waterDeep: c('#0c4470'),
    waterShallow: c('#2ab8a8'),
    waterLight: c('#ffd7a8'),
    lamps: 1,
    fireflies: 0.35,
  },
  {
    // Night: cold moonlight, deep navy sky, warm windows and lamps carry the town.
    keyDir: v(MOON_DIR),
    keyColor: c('#9fb4ff'),
    keyIntensity: 1.5,
    hemiSky: c('#4a62b8'),
    hemiGround: c('#241a2a'),
    hemiIntensity: 0.85,
    envIntensity: 0.35,
    zenith: c('#050a1e'),
    mid: c('#0f1a3e'),
    horizon: c('#283a6e'),
    ground: c('#1a2448'),
    sunColor: c('#000000'),
    glow: c('#3a4a8a'),
    cloudLit: c('#3b4a7a'),
    cloudShade: c('#141a33'),
    sunVis: 0,
    stars: 1,
    moon: 1,
    cloudCover: 0.35,
    fogColor: c('#1a2448'),
    fogDensity: 0.0042,
    waterDeep: c('#04142a'),
    waterShallow: c('#0f4a5a'),
    waterLight: c('#4a5a90'),
    lamps: 2.2,
    fireflies: 1,
  },
  {
    // Celebration: violet night with a magenta horizon, festive lights everywhere.
    keyDir: v(MOON_DIR),
    keyColor: c('#c0a8ff'),
    keyIntensity: 1.4,
    hemiSky: c('#7a58c0'),
    hemiGround: c('#2e1a34'),
    hemiIntensity: 0.85,
    envIntensity: 0.45,
    zenith: c('#0c0624'),
    mid: c('#2a1452'),
    horizon: c('#8a3a7a'),
    ground: c('#3a1a48'),
    sunColor: c('#000000'),
    glow: c('#b0408a'),
    cloudLit: c('#7a4a9a'),
    cloudShade: c('#2a1440'),
    sunVis: 0,
    stars: 0.85,
    moon: 1,
    cloudCover: 0.3,
    fogColor: c('#3a1f50'),
    fogDensity: 0.0034,
    waterDeep: c('#0a0a2a'),
    waterShallow: c('#2a3a7a'),
    waterLight: c('#a080c0'),
    lamps: 2.6,
    fireflies: 0.8,
  },
];

export function cloneMood(m: Mood): Mood {
  const o = { ...m } as Mood;
  for (const k of Object.keys(m) as (keyof Mood)[]) {
    const val = m[k] as unknown;
    if (val instanceof THREE.Color || val instanceof THREE.Vector3) (o as unknown as Record<string, unknown>)[k] = val.clone();
  }
  return o;
}

/** cur = lerp(cur, target, t) for every field. */
export function blendMood(cur: Mood, target: Mood, t: number): void {
  for (const k of Object.keys(target) as (keyof Mood)[]) {
    const a = cur[k] as unknown;
    const b = target[k] as unknown;
    if (a instanceof THREE.Color) a.lerp(b as THREE.Color, t);
    else if (a instanceof THREE.Vector3) a.lerp(b as THREE.Vector3, t).normalize();
    else (cur as unknown as Record<string, number>)[k] = (a as number) + ((b as number) - (a as number)) * t;
  }
}
