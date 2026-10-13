// Temporary CrabRig for the motion harness: the Jumper visual meshes (decimated) on the exact
// body tree of the MuJoCo model the clips were recorded on (tools/motion/export_viewer.py).
// The game uses src/crab's model; this exists so motion can be checked against MuJoCo one to one.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CRAB_HEIGHT,
  JOINT_NAMES,
  type CrabFace,
  type CrabRig,
  type CrabSpec,
  type JointName,
  type SocketName,
} from '../../src/crab/types';
import meta from '../assets/motion-viewer/jumper-lite.json';
import binUrl from '../assets/motion-viewer/jumper-lite.bin?url';

interface BodyMeta {
  name: string;
  parent: number;
  pos: number[];
  quat: number[];
  joint: { name: string; axis: number[]; pos: number[] } | null;
  geoms: { mesh: number; pos: number[]; quat: number[]; rgba: number[] }[];
}
interface Meta {
  positionCount: number;
  indexCount: number;
  bodies: BodyMeta[];
  meshes: { name: string; vertOffset: number; vertCount: number; indexOffset: number; indexCount: number }[];
}

const mjQuat = (q: number[]) => new THREE.Quaternion(q[1], q[2], q[3], q[0]);

/** MuJoCo (Z-up, X forward) to game (Y-up, crab faces +Z): game.x = mj.y, game.y = mj.z, game.z = mj.x. */
export const MJ_TO_GAME = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);

let geometryCache: Promise<THREE.BufferGeometry[]> | null = null;

function loadGeometries(m: Meta): Promise<THREE.BufferGeometry[]> {
  geometryCache ??= fetch(binUrl)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const pos = new Float32Array(buf, 0, m.positionCount);
      const idx = new Uint32Array(buf, m.positionCount * 4, m.indexCount);
      return m.meshes.map((mesh) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos.slice(mesh.vertOffset * 3, (mesh.vertOffset + mesh.vertCount) * 3), 3));
        g.setIndex(new THREE.BufferAttribute(idx.slice(mesh.indexOffset, mesh.indexOffset + mesh.indexCount), 1));
        // smooth shells, crisp panel edges
        return toCreasedNormals(g, (40 * Math.PI) / 180);
      });
    });
  return geometryCache;
}

export class ViewerRig implements CrabRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly metersToUnits: number;
  readonly spec: CrabSpec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Jumper' };
  readonly face: CrabFace = { setExpression: () => undefined, setTint: () => undefined };
  /** Body frames by MuJoCo body name (after their joint rotation). */
  readonly frames = new Map<string, THREE.Object3D>();
  private joints = new Map<JointName, { node: THREE.Object3D; axis: THREE.Vector3 }>();
  private sockets = new Map<SocketName, THREE.Object3D>();
  private mj = new THREE.Group();

  constructor(geoms: THREE.BufferGeometry[], m: Meta, shellTopMetres: number) {
    this.metersToUnits = CRAB_HEIGHT / shellTopMetres;
    this.root.name = 'viewer-crab';
    this.root.add(this.body);
    this.body.add(this.mj);
    this.mj.quaternion.setFromRotationMatrix(MJ_TO_GAME);
    this.mj.scale.setScalar(this.metersToUnits);
    const mats = new Map<string, THREE.Material>();
    const material = (rgba: number[]) => {
      const key = rgba.join(',');
      let mat = mats.get(key);
      if (!mat) {
        const dark = rgba[0] + rgba[1] + rgba[2] < 0.3;
        mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace),
          roughness: dark ? 0.12 : 0.32,
          metalness: rgba[0] > 0.6 && rgba[1] > 0.6 ? 0.55 : 0.0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.15,
        });
        mats.set(key, mat);
      }
      return mat;
    };
    const holders: THREE.Object3D[] = [];
    for (const b of m.bodies) {
      const frame = new THREE.Group();
      frame.name = b.name;
      frame.position.fromArray(b.pos);
      frame.quaternion.copy(mjQuat(b.quat));
      (b.parent < 0 ? this.mj : holders[b.parent]).add(frame);
      let holder: THREE.Object3D = frame;
      if (b.joint) {
        const pivot = new THREE.Group();
        pivot.position.fromArray(b.joint.pos);
        frame.add(pivot);
        const rot = new THREE.Group();
        pivot.add(rot);
        const unpivot = new THREE.Group();
        unpivot.position.set(-b.joint.pos[0], -b.joint.pos[1], -b.joint.pos[2]);
        rot.add(unpivot);
        holder = unpivot;
        this.joints.set(b.joint.name as JointName, { node: rot, axis: new THREE.Vector3().fromArray(b.joint.axis).normalize() });
      }
      holders.push(holder);
      this.frames.set(b.name, holder);
      for (const g of b.geoms) {
        const mesh = new THREE.Mesh(geoms[g.mesh], material(g.rgba));
        mesh.position.fromArray(g.pos);
        mesh.quaternion.copy(mjQuat(g.quat));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        holder.add(mesh);
      }
    }
    const socket = (name: SocketName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.name = `socket:${name}`;
      o.position.set(x, y, z);
      parent.add(o);
      this.sockets.set(name, o);
    };
    const u = this.metersToUnits;
    socket('head', this.body, 0, 0.05 * u, 0);
    socket('face', this.body, 0, 0.02 * u, 0.07 * u);
    socket('back', this.body, 0, 0.03 * u, -0.07 * u);
    socket('chest', this.body, 0, -0.01 * u, 0.06 * u);
    socket('nameplate', this.root, 0, CRAB_HEIGHT * 1.6, 0);
    socket('clawL', this.frames.get('LF_palm_link') ?? this.body, 0, 0.03, 0);
    socket('clawR', this.frames.get('RF_palm_link') ?? this.body, 0, -0.03, 0);
  }

  setJoint(name: JointName, angle: number): void {
    const j = this.joints.get(name);
    if (j) j.node.quaternion.setFromAxisAngle(j.axis, angle);
  }

  setPose(q: ArrayLike<number>): void {
    for (let i = 0; i < JOINT_NAMES.length; i++) this.setJoint(JOINT_NAMES[i], q[i]);
  }

  getSocket(name: SocketName): THREE.Object3D {
    return this.sockets.get(name) ?? this.body;
  }

  async applySpec(spec: CrabSpec): Promise<void> {
    Object.assign(this.spec, spec);
  }

  update(): void {}

  dispose(): void {
    this.root.removeFromParent();
  }

  /** World position of a MuJoCo body frame, in world units. */
  bodyWorld(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.frames.get(name);
    if (!f) throw new Error(`no body ${name}`);
    this.root.updateWorldMatrix(true, true);
    return f.getWorldPosition(out);
  }
}

/** Build the harness crab; its shell top stands at CRAB_HEIGHT like the game's crabs. */
export async function createViewerRig(): Promise<ViewerRig> {
  const m = meta as unknown as Meta;
  const geoms = await loadGeometries(m);
  // shell top above the ground at the standing pose, from the meshes themselves
  const probe = new ViewerRig(geoms, m, 1);
  const { HOME_Q, STAND_HEIGHT } = await import('../../src/motion/pose');
  probe.setPose(HOME_Q);
  probe.body.position.set(0, STAND_HEIGHT, 0);
  probe.root.updateWorldMatrix(true, true);
  const top = new THREE.Box3().setFromObject(probe.root).max.y;
  return new ViewerRig(geoms, m, top);
}
