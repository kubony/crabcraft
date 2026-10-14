// The real Jumper crab rig: shared skinned geometry from the URDF meshes, one bone per link,
// joint rotations in exact MuJoCo qpos convention, LED face, race posture and gear.
import * as THREE from 'three';
import { LedFace } from './face';
import { partMaterial, shellMaterial, type ShellLook } from './materials';
import { HOME, HOME_POSE } from './pose';
import { HUNCH_PITCH, linkMatrix, solvePostureBias, type Posture } from './posture';
import type { CrabTemplate, PartClass } from './template';
import { CRAB_HEIGHT, JOINT_NAMES, type CrabRig, type CrabSpec, type Expression, type JointName, type SocketName } from './types';

const JOINT_INDEX = new Map<JointName, number>(JOINT_NAMES.map((n, i) => [n, i]));

let proxyMat: THREE.MeshBasicMaterial | null = null;
/** Draws nothing in the camera's view; the shadow pass uses its own depth material. */
function shadowProxyMaterial(): THREE.MeshBasicMaterial {
  if (!proxyMat) {
    proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    proxyMat.name = 'crab-shadow-proxy';
  }
  return proxyMat;
}

/** Everything that decides how one crab looks. Built from a CrabSpec (or an enemy kind). */
export interface CrabLook {
  shell: ShellLook;
  /** Variant for dark/metal/joint/rubber parts ('' factory, 'rust'). */
  parts: string;
  led: string;
  female: boolean;
  flicker: boolean;
  ledIntensity?: number;
  posture: Posture;
  /** URDF links whose geometry is left out (e.g. an undead leg stripped to its frame). */
  without: string[];
  /** Per-link scale (giant claws). */
  linkScale?: Record<string, number>;
  /** Idle expression the face returns to. */
  idle: Expression;
  /** LED halo width multiplier. */
  ledHalo?: number;
  /** Undead: occasional servo twitches of the whole body (on the posture group). */
  twitch?: boolean;
}

/** Attach point inside a link frame, robot metres. */
interface SocketDef {
  link: string;
  pos: [number, number, number];
  /** Rotation as a basis: socket +Y and +Z expressed in the link frame. */
  y?: [number, number, number];
  z?: [number, number, number];
}

export class JumperRig implements CrabRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Object3D();
  /** Race posture offset/pitch under the body (motion never touches it). */
  readonly posture = new THREE.Group();
  /** Robot-metre space, scaled to world units. */
  readonly model = new THREE.Group();
  /** One node per URDF link (Bones for moving links and the base). */
  readonly links: THREE.Object3D[] = [];
  readonly bones: THREE.Bone[] = [];
  readonly skeleton: THREE.Skeleton;
  readonly face: LedFace;
  spec: CrabSpec;
  look!: CrabLook;

  private template: CrabTemplate;
  private jointNodes: THREE.Object3D[] = [];
  private axes: THREE.Vector3[] = [];
  private q: Float32Array = Float32Array.from(HOME_POSE);
  private bias: Float32Array = new Float32Array(JOINT_NAMES.length);
  private sockets = new Map<SocketName, THREE.Object3D>();
  private parts = new Map<PartClass, THREE.SkinnedMesh>();
  /** Far LOD meshes (same skeleton and materials), shown instead of parts at lod 1. */
  private lodMeshes = new Map<PartClass, THREE.SkinnedMesh>();
  private lod = 0;
  /** Casts the crab's shadow from the LOD body when on (see useShadowProxy). */
  private shadowProxy: THREE.SkinnedMesh | null = null;
  private m2u = 1;
  private nameplateBase = 0;
  /** Gear and weapons owned by the current spec; removed on applySpec. */
  readonly gear = new THREE.Group();
  readonly gearMeshes: THREE.Object3D[] = [];
  private updaters: ((dt: number) => void)[] = [];

  constructor(template: CrabTemplate, spec: CrabSpec, look: CrabLook) {
    this.template = template;
    this.spec = { ...spec };
    this.root.name = `crab:${spec.name}`;
    this.body.name = 'body';
    this.posture.name = 'posture';
    this.model.name = 'model';
    this.root.add(this.body);
    this.body.add(this.posture);
    this.posture.add(this.model);

    // Link nodes, parents first.
    for (const l of template.links) {
      const node: THREE.Object3D = l.parent < 0 || l.joint ? new THREE.Bone() : new THREE.Object3D();
      node.name = l.name;
      if (l.parent >= 0) node.position.copy(l.offset);
      (l.parent >= 0 ? this.links[l.parent] : this.model).add(node);
      this.links.push(node);
    }
    for (const li of template.boneLinks) this.bones.push(this.links[li] as THREE.Bone);
    this.skeleton = new THREE.Skeleton(this.bones, template.boneInverses);
    JOINT_NAMES.forEach((_j, i) => {
      const l = template.links[template.jointLinks[i]];
      this.jointNodes[i] = this.links[l.index];
      this.axes[i] = l.axis!;
    });

    // Face screen on the display module.
    const r = template.info.faceRect;
    this.face = new LedFace(template.face, new THREE.Vector2((r.x1 - r.x0) * 1000, (r.y1 - r.y0) * 1000), {
      color: look.led,
      female: look.female,
      flicker: look.flicker,
    });
    this.linkNode('display_module_link').add(this.face.mesh);

    this.buildSockets();
    this.gear.name = 'gear';
    this.applyLook(look);
    this.setPose(HOME_POSE);
  }

  get metersToUnits(): number {
    return this.m2u;
  }

  linkNode(name: string): THREE.Object3D {
    const l = this.template.linkByName.get(name);
    if (!l) throw new Error(`no link ${name}`);
    return this.links[l.index];
  }

  /** Applies shell, parts, face style, posture and scale. Gear is handled by the caller. */
  applyLook(look: CrabLook): void {
    this.look = look;
    const t = this.template;
    // Scale: shell top at CRAB_HEIGHT for a standard crab standing at HOME.
    this.m2u = (CRAB_HEIGHT / t.info.shellTopHome) * look.posture.scale;
    this.model.scale.setScalar(this.m2u);
    this.body.position.set(0, t.info.standZ * this.m2u, 0);
    this.body.quaternion.identity();
    this.posture.position.set(0, t.info.standZ * (look.posture.bodyHeight - 1) * this.m2u, 0);
    this.posture.rotation.set(look.posture.hunch * HUNCH_PITCH, 0, 0);
    this.bias = solvePostureBias(t, look.posture);

    // Skinned parts, full detail and the far LOD.
    this.syncParts(this.parts, t.parts(look.without), look, '', this.lod === 0);
    if (t.lodParts) this.syncParts(this.lodMeshes, t.lodParts(look.without), look, '-lod', this.lod === 1);
    if (this.shadowProxy && t.lodShadow) this.shadowProxy.geometry = t.lodShadow(look.without);
    this.applyShadowCasting();

    // Per-link scale (enemy claws); reset others.
    for (const [i, node] of this.links.entries()) {
      const s = look.linkScale?.[t.links[i].name] ?? 1;
      node.scale.setScalar(s);
    }

    this.face.setStyle({ color: look.led, female: look.female, flicker: look.flicker, intensity: look.ledIntensity, halo: look.ledHalo });
    this.face.setIdle(look.idle);
    this.setPose(this.q);
    this.updateNameplate();
  }

  private syncParts(
    meshes: Map<PartClass, THREE.SkinnedMesh>,
    geos: Map<PartClass, THREE.BufferGeometry>,
    look: CrabLook,
    suffix: string,
    visible: boolean,
  ): void {
    for (const [cls, mesh] of meshes) {
      if (!geos.has(cls)) {
        mesh.removeFromParent();
        meshes.delete(cls);
      }
    }
    for (const [cls, geo] of geos) {
      const mat = cls === 'shell' ? shellMaterial(look.shell) : partMaterial(cls, look.parts);
      let mesh = meshes.get(cls);
      if (!mesh) {
        mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.name = `crab-${cls}${suffix}`;
        mesh.castShadow = cls !== 'visor';
        mesh.receiveShadow = true;
        mesh.bind(this.skeleton, new THREE.Matrix4());
        mesh.visible = visible;
        this.model.add(mesh);
        meshes.set(cls, mesh);
      } else {
        mesh.geometry = geo;
        mesh.material = mat;
      }
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.02, 0), 0.55);
    }
  }

  /**
   * Level of detail: 0 full, 1 far (the simplified body, and gear pieces too small to read at that
   * size are hidden). Cheap to call every frame; it only touches visibility on a change.
   */
  setLod(level: number): void {
    const lod = level > 0 && this.lodMeshes.size ? 1 : 0;
    if (lod === this.lod) return;
    this.lod = lod;
    for (const m of this.parts.values()) m.visible = lod === 0;
    for (const m of this.lodMeshes.values()) m.visible = lod === 1;
    for (const o of this.gearDetail) o.visible = lod === 0;
  }

  get lodLevel(): number {
    return this.lod;
  }

  /**
   * Shadows from the LOD body: a single invisible mesh (no colour, no depth in the camera's view)
   * casts the crab's shadow with 11.6k triangles in one draw instead of the six full-detail
   * meshes' 70k. At the sun shadow map's 29 texels per unit nobody can tell the difference.
   * Close-up screens (character creation) leave it off.
   */
  useShadowProxy(on: boolean): void {
    const t = this.template;
    if (on && !this.shadowProxy && t.lodShadow) {
      const m = new THREE.SkinnedMesh(t.lodShadow(this.look.without), shadowProxyMaterial());
      m.name = 'crab-shadow-proxy';
      m.castShadow = true;
      m.receiveShadow = false;
      m.bind(this.skeleton, new THREE.Matrix4());
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.02, 0), 0.55);
      this.model.add(m);
      this.shadowProxy = m;
    } else if (!on && this.shadowProxy) {
      this.shadowProxy.removeFromParent();
      this.shadowProxy = null;
    }
    this.applyShadowCasting();
  }

  private applyShadowCasting(): void {
    const proxy = !!this.shadowProxy;
    for (const [cls, m] of this.parts) m.castShadow = !proxy && cls !== 'visor';
    for (const [cls, m] of this.lodMeshes) m.castShadow = !proxy && cls !== 'visor';
  }

  /** Gear pieces hidden at the far LOD (small next to the crab); filled by the gear dresser. */
  readonly gearDetail: THREE.Object3D[] = [];

  private buildSockets(): void {
    const r = this.template.info.faceRect;
    const defs: Record<SocketName, SocketDef> = {
      head: { link: 'base_link', pos: [0, 0.0725, -0.012] },
      face: { link: 'display_module_link', pos: [0, (r.y0 + r.y1) / 2, r.z + 0.003] },
      back: { link: 'base_link', pos: [0, 0.045, -0.108] },
      chest: { link: 'base_link', pos: [0, 0.012, 0.098] },
      // Between the palm and finger grip pads; +Y along the jaw hinge (points up at HOME),
      // +Z out along the jaw.
      clawL: { link: 'LF_palm_link', pos: [0.104, -0.0058, 0.0004], y: [0, 0, 1], z: [1, 0, 0] },
      clawR: { link: 'RF_palm_link', pos: [-0.104, -0.0058, -0.0004], y: [0, 0, 1], z: [-1, 0, 0] },
      nameplate: { link: 'base_link', pos: [0, 0, 0] },
    };
    for (const [name, d] of Object.entries(defs) as [SocketName, SocketDef][]) {
      const o = new THREE.Object3D();
      o.name = `socket:${name}`;
      o.position.fromArray(d.pos);
      if (d.y && d.z) {
        const y = new THREE.Vector3().fromArray(d.y);
        const z = new THREE.Vector3().fromArray(d.z);
        const x = new THREE.Vector3().crossVectors(y, z);
        o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      }
      if (name === 'nameplate') this.root.add(o);
      else this.linkNode(d.link).add(o);
      this.sockets.set(name, o);
    }
  }

  /** Nameplate above the tallest gear (call after gear changes). */
  updateNameplate(extraTop = 0): void {
    const top = this.template.info.shellTopHome * this.m2u;
    const lift = this.template.info.standZ * (this.look.posture.bodyHeight - 1) * this.m2u;
    this.nameplateBase = top + lift + extraTop * this.m2u + 0.35;
    this.sockets.get('nameplate')!.position.set(0, this.nameplateBase, 0);
  }

  setJoint(name: JointName, angle: number): void {
    const i = JOINT_INDEX.get(name);
    if (i === undefined) return;
    this.q[i] = angle;
    this.jointNodes[i].quaternion.setFromAxisAngle(this.axes[i], angle + this.bias[i]);
  }

  setPose(q: ArrayLike<number>): void {
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      const a = q[i] ?? 0;
      this.q[i] = a;
      this.jointNodes[i].quaternion.setFromAxisAngle(this.axes[i], a + this.bias[i]);
    }
  }

  /** Raw pose as last set (without posture bias). */
  getPose(out = new Float32Array(JOINT_NAMES.length)): Float32Array {
    out.set(this.q);
    return out;
  }

  /** Posture joint bias, JOINT_NAMES order (radians, added to every angle). */
  get jointBias(): Readonly<Float32Array> {
    return this.bias;
  }

  /** Orientation of a socket relative to base_link when standing at HOME with this posture. */
  homeSocketQuaternion(name: SocketName): THREE.Quaternion {
    const sock = this.getSocket(name);
    const link = this.template.linkByName.get(sock.parent?.name ?? 'base_link');
    const q: Record<string, number> = { ...HOME };
    JOINT_NAMES.forEach((j, i) => (q[j] += this.bias[i]));
    const m = link ? linkMatrix(this.template, q, link.index, new THREE.Matrix4(), new THREE.Matrix4()) : new THREE.Matrix4();
    const out = new THREE.Quaternion().setFromRotationMatrix(m);
    return out.multiply(sock.quaternion);
  }

  getSocket(name: SocketName): THREE.Object3D {
    return this.sockets.get(name) ?? this.body;
  }

  onUpdate(fn: (dt: number) => void): void {
    this.updaters.push(fn);
  }

  clearUpdaters(): void {
    this.updaters.length = 0;
  }

  /** Overridden by the crab factory (src/crab/index.ts), which also re-dresses the gear. */
  async applySpec(spec: CrabSpec): Promise<void> {
    this.spec = { ...spec };
  }

  private twitchT = 1 + Math.random() * 3;
  private twitchA = 0;
  private twitchAxis = 0;

  update(dt: number): void {
    this.face.update(dt);
    if (this.look.twitch) {
      // A servo that skips: a sharp jerk that settles in ~0.2 s, every few seconds.
      this.twitchT -= dt;
      if (this.twitchT <= 0) {
        this.twitchT = 1.2 + Math.random() * 3.5;
        this.twitchA = (Math.random() < 0.5 ? -1 : 1) * (0.035 + Math.random() * 0.04);
        this.twitchAxis = Math.random() < 0.6 ? 2 : 1;
      }
      this.twitchA *= Math.exp(-dt * 14);
      const p = this.look.posture;
      this.posture.rotation.set(p.hunch * HUNCH_PITCH, this.twitchAxis === 1 ? this.twitchA : 0, this.twitchAxis === 2 ? this.twitchA : 0);
    }
    for (const fn of this.updaters) fn(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.face.dispose();
    this.skeleton.dispose();
    this.updaters.length = 0;
  }
}
