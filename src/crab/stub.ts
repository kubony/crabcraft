// Stand-in crab built from primitives so screens and gameplay can be developed before the real
// Jumper model lands. Same CrabRig contract; joint axes are approximations.
import * as THREE from 'three';
import { RACES } from '../data/races';
import {
  CRAB_HEIGHT,
  JOINT_NAMES,
  type CrabFace,
  type CrabRig,
  type CrabSpec,
  type Expression,
  type JointName,
  type SocketName,
} from './types';

const shellGeo = new THREE.SphereGeometry(0.5, 32, 16);
const visorGeo = new THREE.BoxGeometry(0.62, 0.22, 0.08);
const eyeGeo = new THREE.PlaneGeometry(0.1, 0.07);
const segGeo = new THREE.CylinderGeometry(0.05, 0.04, 1, 10);
const clawGeo = new THREE.ConeGeometry(0.09, 0.32, 10);
const capGeo = new THREE.SphereGeometry(0.065, 12, 8);

const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.15, clearcoat: 1 });
const capMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.35 });

function segment(len: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(segGeo, mat);
  m.scale.set(1, len, 1);
  m.rotation.z = Math.PI / 2;
  m.position.x = len / 2;
  m.castShadow = true;
  return m;
}

export async function createCrab(spec: CrabSpec): Promise<CrabRig> {
  return new StubCrab(spec);
}

export async function createEnemyCrab(kind: 'scrapling' | 'scavenger' | 'corrodius'): Promise<CrabRig> {
  const crab = new StubCrab({ race: 'undead', sex: 'male', classId: 'warrior', shell: 1, crest: 0, led: 0, name: kind });
  const s = kind === 'scrapling' ? 0.6 : kind === 'corrodius' ? 3.5 : 1;
  crab.root.scale.setScalar(s);
  crab.shellMat.color.set(kind === 'corrodius' ? 0x5a3a2a : 0x8a4a22);
  crab.face.setTint(0xff2a1a);
  return crab;
}

class StubCrab implements CrabRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly metersToUnits = 1;
  spec: CrabSpec;
  readonly face: CrabFace;
  readonly shellMat: THREE.MeshPhysicalMaterial;
  private joints = new Map<JointName, THREE.Object3D>();
  private sockets = new Map<SocketName, THREE.Object3D>();
  private eyeMat: THREE.MeshBasicMaterial;

  constructor(spec: CrabSpec) {
    this.spec = { ...spec };
    const race = RACES[spec.race];
    this.shellMat = new THREE.MeshPhysicalMaterial({
      color: race.shellColors[spec.shell]?.hex ?? '#d2202f',
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(race.ledColors[spec.led]?.hex ?? '#53f2e4').multiplyScalar(3) });
    this.root.name = `crab:${spec.name}`;
    this.root.add(this.body);
    this.body.position.y = 0.55;

    const shell = new THREE.Mesh(shellGeo, this.shellMat);
    shell.scale.set(1.15, 0.62, 1.0);
    shell.castShadow = true;
    this.body.add(shell);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.04, 0.47);
    this.body.add(visor);
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(x, 0.05, 0.515);
      this.body.add(eye);
    }

    // Claws: shoulder yaw (J0), upper arm pitch (J1), forearm (J2), palm (J3), finger (J4).
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const j0 = new THREE.Group();
      j0.position.set(0.32 * sx, -0.02, 0.32);
      this.body.add(j0);
      const j1 = new THREE.Group();
      j0.add(j1);
      const upper = segment(0.36, this.shellMat);
      upper.rotation.y = sx > 0 ? -0.6 : Math.PI + 0.6;
      j1.add(upper);
      const j2 = new THREE.Group();
      j2.position.set(0.36 * Math.cos(0.6) * sx, 0, 0.36 * Math.sin(0.6));
      j1.add(j2);
      const fore = segment(0.3, this.shellMat);
      fore.rotation.y = -Math.PI / 2;
      j2.add(fore);
      j2.add(new THREE.Mesh(capGeo, capMat));
      const j3 = new THREE.Group();
      j3.position.set(0, 0, 0.3);
      j2.add(j3);
      const palm = new THREE.Mesh(clawGeo, this.shellMat);
      palm.rotation.x = Math.PI / 2;
      palm.position.z = 0.16;
      j3.add(palm);
      const j4 = new THREE.Group();
      j4.position.set(0.05 * sx, 0, 0.05);
      j3.add(j4);
      const finger = new THREE.Mesh(clawGeo, this.shellMat);
      finger.scale.setScalar(0.8);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(0.04 * sx, 0, 0.13);
      j4.add(finger);
      const names = [0, 1, 2, 3, 4].map((i) => `${side}F_J${i}_joint` as JointName);
      [j0, j1, j2, j3, j4].forEach((j, i) => this.joints.set(names[i], j));
      const socket = new THREE.Object3D();
      socket.position.set(0, 0, 0.18);
      j3.add(socket);
      this.sockets.set(side === 'L' ? 'clawL' : 'clawR', socket);
    }

    // Walking legs: hip yaw (J0), thigh pitch (J1), calf pitch (J2).
    const legs: [string, number, number][] = [
      ['LM', 1, 0.05], ['RM', -1, 0.05], ['LR', 1, -0.25], ['RR', -1, -0.25],
    ];
    for (const [prefix, sx, z] of legs) {
      const j0 = new THREE.Group();
      j0.position.set(0.42 * sx, -0.05, z);
      j0.rotation.y = sx > 0 ? (z < 0 ? -0.5 : 0) : Math.PI + (z < 0 ? 0.5 : 0);
      this.body.add(j0);
      const j1 = new THREE.Group();
      j0.add(j1);
      j1.add(segment(0.32, this.shellMat));
      j1.add(new THREE.Mesh(capGeo, capMat));
      const j2 = new THREE.Group();
      j2.position.x = 0.32;
      j1.add(j2);
      const calf = segment(0.5, this.shellMat);
      j2.add(calf);
      j2.rotation.z = -1.9;
      j1.rotation.z = 0.55;
      [j0, j1, j2].forEach((j, i) => this.joints.set(`${prefix}_J${i}_joint` as JointName, j));
      j0.userData.base = j0.rotation.y;
      j1.userData.base = j1.rotation.z;
      j2.userData.base = j2.rotation.z;
    }
    for (const [name, j] of this.joints) {
      if (!j.userData.base) j.userData.base = 0;
      j.userData.axis = name.endsWith('J0_joint') ? 'y' : name.startsWith('L') || name.startsWith('R') ? (name.includes('F_') ? 'x' : 'z') : 'z';
    }

    const addSocket = (name: SocketName, pos: THREE.Vector3) => {
      const o = new THREE.Object3D();
      o.position.copy(pos);
      this.body.add(o);
      this.sockets.set(name, o);
    };
    addSocket('head', new THREE.Vector3(0, 0.32, 0));
    addSocket('face', new THREE.Vector3(0, 0.05, 0.52));
    addSocket('back', new THREE.Vector3(0, 0.15, -0.45));
    addSocket('chest', new THREE.Vector3(0, -0.1, 0.48));
    const plate = new THREE.Object3D();
    plate.position.y = CRAB_HEIGHT + 0.45;
    this.root.add(plate);
    this.sockets.set('nameplate', plate);

    this.root.scale.setScalar(race.posture.scale);
    const eyeMat = this.eyeMat;
    this.face = {
      setExpression(e: Expression) {
        eyeMat.visible = e !== 'dead' && e !== 'blink';
      },
      setTint(c) {
        if (c === null) eyeMat.color.set(race.ledColors[0].hex).multiplyScalar(3);
        else eyeMat.color.set(c).multiplyScalar(3);
      },
    };
  }

  setJoint(name: JointName, angle: number): void {
    const j = this.joints.get(name);
    if (!j) return;
    const axis = j.userData.axis as 'x' | 'y' | 'z';
    j.rotation[axis] = (j.userData.base as number) + angle;
  }

  setPose(q: ArrayLike<number>): void {
    for (let i = 0; i < JOINT_NAMES.length; i++) this.setJoint(JOINT_NAMES[i], q[i] ?? 0);
  }

  getSocket(name: SocketName): THREE.Object3D {
    return this.sockets.get(name) ?? this.body;
  }

  async applySpec(spec: CrabSpec): Promise<void> {
    this.spec = { ...spec };
    const race = RACES[spec.race];
    this.shellMat.color.set(race.shellColors[spec.shell]?.hex ?? race.shellColors[0].hex);
    this.eyeMat.color.set(race.ledColors[spec.led]?.hex ?? race.ledColors[0].hex).multiplyScalar(3);
    this.root.scale.setScalar(race.posture.scale);
  }

  private blinkT = 2;
  update(dt: number): void {
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.eyeMat.visible = this.blinkT < -0.12;
      if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    }
  }

  dispose(): void {
    this.shellMat.dispose();
    this.eyeMat.dispose();
    this.root.removeFromParent();
  }
}
