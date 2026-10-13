// MuJoCo (Z-up, robot forward +X, left +Y) to game (Y-up, crab faces +Z, left +X):
//   game.x = mj.y, game.y = mj.z, game.z = mj.x
// A cyclic permutation, so a proper rotation; quaternions map the same way (src/crab/types.ts).
import * as THREE from 'three';

/** Maps a MuJoCo-frame vector into game axes. */
export const MJ_TO_GAME = new THREE.Matrix4().set(
  0, 1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
);

export function mjPosToGame(out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
  return out.set(y, z, x);
}

/** MuJoCo quaternion (w, x, y, z) to a game-axes THREE.Quaternion. */
export function mjQuatToGame(out: THREE.Quaternion, w: number, x: number, y: number, z: number): THREE.Quaternion {
  return out.set(y, z, x, w);
}
