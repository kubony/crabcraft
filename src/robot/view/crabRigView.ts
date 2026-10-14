// The player's crab as a Robot Mode layer: the same race paint, LED face and gear the game shows,
// posed every frame from the live simulation (base pose plus the 22 joint angles), so the geared
// crab moves exactly as the physics robot does. Same live policy, any appearance.
import * as THREE from 'three';
import { createRobotCrab } from '../../crab/index';
import { JOINT_NAMES, type CrabRig, type CrabSpec } from '../../crab/types';
import { mjPosToGame, mjQuatToGame } from './frames';
import type { FaceExpr, RobotRenderFrame, RobotViewLayer } from './robotView';

/** Lowest point a held weapon may reach at HOME, metres above the desk. */
const DESK_CLEARANCE = 0.008;

/** Lowest world y over every vertex of the meshes under `o` (world matrices must be current). */
function lowestPoint(o: THREE.Object3D, v: THREE.Vector3): number {
  let low = Infinity;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (v.y < low) low = v.y;
    }
  });
  return low;
}

/** How far the crab's links are from the physics bodies of the same name, robot metres. */
export interface AlignmentSample {
  /** Bodies compared (every robot body that has a link of the same name in the rig). */
  bodies: number;
  mean: number;
  max: number;
  worst: string;
  /** Lowest point of the weapons held in the claws, metres above the desk. */
  weaponLow: number;
}

export class CrabRigView implements RobotViewLayer {
  readonly object = new THREE.Group();
  readonly rig: CrabRig;
  private q = new Float32Array(JOINT_NAMES.length);
  private jointMap: Int16Array = new Int16Array(JOINT_NAMES.length);
  private jointsFor: readonly string[] | null = null;
  private base = -1;
  private bodiesFor: readonly string[] | null = null;
  private expr: FaceExpr | null = null;
  private links: (THREE.Object3D | null)[] = [];
  private linksFor: readonly string[] | null = null;
  private tmpV = new THREE.Vector3();
  private tmpW = new THREE.Vector3();

  private constructor(rig: CrabRig) {
    this.rig = rig;
    this.object.name = `robot-crab:${rig.spec.name}`;
    // The rig is built in world units (shell top at CRAB_HEIGHT); Robot Mode's scene is in robot
    // metres, so undo metersToUnits on the root and let the body move in rig units below it.
    rig.root.scale.setScalar(1 / rig.metersToUnits);
    this.object.add(rig.root);
    this.clearDesk();
  }

  /**
   * Jumper stands on its claws, and the class weapons ride in them: at HOME a staff held mid-shaft
   * reaches about 54 mm into the desk, a sword, shield or lantern 17 to 20 mm. Each held piece
   * slides along its own handle (straight up when the handle lies flat) until its lowest point
   * clears the desk, once, at HOME; it then follows the claw rigidly as before.
   */
  private clearDesk(): void {
    const rig = this.rig;
    // A fresh rig stands at HOME on the ground plane (body at STAND_Z, HOME_POSE).
    this.object.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const name of ['clawL', 'clawR'] as const) {
      const socket = rig.getSocket(name);
      socket.getWorldQuaternion(q);
      const scale = socket.getWorldScale(v).y;
      for (const piece of socket.children) {
        const deficit = DESK_CLEARANCE - lowestPoint(piece, v);
        if (!(deficit > 0) || !Number.isFinite(deficit)) continue;
        const handle = new THREE.Vector3(0, 1, 0).applyQuaternion(piece.quaternion);
        const upness = handle.clone().applyQuaternion(q).y;
        if (upness > 0.35) piece.position.addScaledVector(handle, deficit / upness / scale);
        else piece.position.add(new THREE.Vector3(0, deficit / scale, 0).applyQuaternion(q.clone().invert()));
        piece.updateWorldMatrix(false, true);
      }
    }
  }

  /** Loads the crab model and gear (shared with every other crab on the page) and dresses it. */
  static async create(spec: CrabSpec): Promise<CrabRigView> {
    return new CrabRigView(await createRobotCrab(spec));
  }

  get spec(): Readonly<CrabSpec> {
    return this.rig.spec;
  }

  update(f: RobotRenderFrame, dt: number): void {
    const rig = this.rig;
    if (this.jointsFor !== f.joints) {
      this.jointsFor = f.joints;
      this.jointMap = Int16Array.from(JOINT_NAMES, (n) => f.joints.indexOf(n));
    }
    if (this.bodiesFor !== f.bodies) {
      this.bodiesFor = f.bodies;
      this.base = f.bodies.indexOf('base_link');
    }
    for (let i = 0; i < this.q.length; i++) {
      const k = this.jointMap[i];
      if (k >= 0) this.q[i] = f.q[k];
    }
    if (this.base >= 0) {
      const p = f.poses;
      const o = this.base * 7;
      mjPosToGame(rig.body.position, p[o], p[o + 1], p[o + 2]).multiplyScalar(rig.metersToUnits);
      mjQuatToGame(rig.body.quaternion, p[o + 3], p[o + 4], p[o + 5], p[o + 6]);
    }
    rig.setPose(this.q);
    rig.update(dt);
  }

  setExpression(e: FaceExpr): void {
    if (e === this.expr) return;
    this.expr = e;
    this.rig.face.setExpression(e);
  }

  /**
   * Poses the rig from `f`, then compares every robot body's physics position with the rig link
   * of the same name. A debug measure: it walks the rig's world matrices.
   */
  measure(f: RobotRenderFrame): AlignmentSample {
    this.update(f, 0);
    if (this.linksFor !== f.bodies) {
      this.linksFor = f.bodies;
      const byName = new Map<string, THREE.Object3D>();
      this.rig.root.traverse((o) => {
        if (o.name && !byName.has(o.name) && !o.name.startsWith('socket:')) byName.set(o.name, o);
      });
      this.links = f.bodies.map((b) => byName.get(b) ?? null);
    }
    this.object.updateWorldMatrix(true, true);
    let n = 0, sum = 0, max = 0, worst = '';
    for (let i = 0; i < this.links.length; i++) {
      const link = this.links[i];
      if (!link) continue;
      const o = i * 7;
      mjPosToGame(this.tmpV, f.poses[o], f.poses[o + 1], f.poses[o + 2]);
      link.getWorldPosition(this.tmpW);
      const d = this.tmpV.distanceTo(this.tmpW);
      n++;
      sum += d;
      if (d > max) {
        max = d;
        worst = f.bodies[i];
      }
    }
    let weaponLow = Infinity;
    for (const name of ['clawL', 'clawR'] as const) {
      for (const piece of this.rig.getSocket(name).children) weaponLow = Math.min(weaponLow, lowestPoint(piece, this.tmpV));
    }
    return { bodies: n, mean: n ? sum / n : 0, max, worst, weaponLow };
  }

  dispose(): void {
    this.rig.dispose();
    this.object.removeFromParent();
  }
}
