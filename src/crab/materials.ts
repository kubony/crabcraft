// Shared crab materials. Everything is cached by its parameters so 25 crabs of the same paint use
// the same material objects (one shader program, no per-crab uniforms to upload).
import * as THREE from 'three';
import type { PartClass } from './template';

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

export interface ShellLook {
  /** sRGB hex paint. */
  color: string;
  /** 0 = factory gloss, 1 = weathered (undead, scrap): rougher, less clearcoat. */
  wear?: number;
  /** Rust/iron enemy hulls: some metalness. */
  metal?: number;
}

/** The injection-moulded shell: Jumper red by default, glossy with a clearcoat. */
export function shellMaterial(look: ShellLook): THREE.MeshPhysicalMaterial {
  const wear = look.wear ?? 0;
  const metal = look.metal ?? 0;
  return cached(`shell:${look.color}:${wear}:${metal}`, () => {
    // Paint calibration: the TVC's moulded red reads deeper than the raw sRGB swatch under
    // AgX, so the albedo is darkened a little (in linear space) for every paint.
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(look.color).multiplyScalar(0.82),
      roughness: THREE.MathUtils.lerp(0.26, 0.62, wear),
      metalness: metal,
      clearcoat: THREE.MathUtils.lerp(1, 0.15, wear),
      clearcoatRoughness: THREE.MathUtils.lerp(0.06, 0.4, wear),
      specularIntensity: 0.55,
      sheen: 0.0,
      envMapIntensity: 1.0,
    });
    return m;
  });
}

export function partMaterial(cls: Exclude<PartClass, 'shell'>, variant = ''): THREE.Material {
  return cached(`part:${cls}:${variant}`, () => {
    switch (cls) {
      case 'dark':
        return new THREE.MeshPhysicalMaterial({
          color: variant === 'rust' ? 0x2a1a12 : 0x16171a,
          roughness: variant === 'rust' ? 0.7 : 0.38,
          clearcoat: variant === 'rust' ? 0 : 0.6,
          clearcoatRoughness: 0.2,
        });
      case 'visor':
        // Deep black glass: a crisp clearcoat highlight, but little sky in it, so the LED face
        // keeps its contrast at game distance.
        return new THREE.MeshPhysicalMaterial({
          color: 0x010102,
          roughness: 0.16,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          specularIntensity: 0.45,
          envMapIntensity: 0.45,
        });
      case 'metal':
        return new THREE.MeshStandardMaterial({
          color: variant === 'rust' ? 0x6e4a33 : 0xc4c8ce,
          metalness: variant === 'rust' ? 0.5 : 0.9,
          roughness: variant === 'rust' ? 0.75 : 0.34,
        });
      case 'joint':
        return new THREE.MeshStandardMaterial({
          color: variant === 'rust' ? 0x7a5a40 : 0xd9dce0,
          metalness: 1,
          roughness: variant === 'rust' ? 0.7 : 0.26,
        });
      case 'rubber':
        return new THREE.MeshStandardMaterial({
          color: variant === 'rust' ? 0x3a3430 : 0x9b9c99,
          metalness: 0,
          roughness: 0.78,
        });
    }
  });
}

/** Gear materials by name (from the gear GLBs), optionally tinted. */
export function gearMaterial(src: THREE.Material, tint?: string | null): THREE.Material {
  const key = `gear:${src.name}:${tint ?? ''}`;
  return cached(key, () => {
    const m = (src as THREE.MeshStandardMaterial).clone();
    if (tint && 'color' in m) (m as THREE.MeshStandardMaterial).color.set(tint);
    // Every gear piece is closed (cloth is solidified), so back faces never show.
    m.side = THREE.FrontSide;
    return m;
  });
}
