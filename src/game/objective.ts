// World-space quest guidance: a soft gold light beam over the current objective, a chevron on the
// ground at the player's feet pointing toward it, and glowing breadcrumbs flowing along the way.
import * as THREE from 'three';
import type { World } from '../world/types';
import type { FxPool, Fx } from './vfx/effects';
import { C } from './vfx/vfx';

const CRUMBS = 9;
const SPACING = 2.2;

export class ObjectiveMarker {
  readonly group = new THREE.Group();
  private beam: Fx;
  private chevron: THREE.Mesh;
  private crumbs: THREE.InstancedMesh;
  private chevMat: THREE.MeshBasicMaterial;
  private crumbMat: THREE.MeshBasicMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private col = new THREE.Color();
  enabled = true;

  constructor(fx: FxPool) {
    this.beam = fx.spawn('pillar', Infinity);
    (this.beam.u.uColor.value as THREE.Color).copy(C.gold).multiplyScalar(0.6);
    (this.beam.u.uColor2.value as THREE.Color).copy(C.goldSoft).multiplyScalar(0.5);
    (this.beam.u.uParam.value as THREE.Vector4).x = 0.25;
    this.beam.mesh.visible = false;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.lineTo(0.42, 0.05);
    shape.lineTo(0.22, 0.05);
    shape.lineTo(0, 0.3);
    shape.lineTo(-0.22, 0.05);
    shape.lineTo(-0.42, 0.05);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // tip points to +Z after this rotation
    this.chevMat = new THREE.MeshBasicMaterial({
      color: C.gold.clone().multiplyScalar(0.32),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.chevron = new THREE.Mesh(geo, this.chevMat);
    this.chevron.renderOrder = 6;
    this.chevron.frustumCulled = false;

    this.crumbMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const disc = new THREE.CircleGeometry(0.24, 20).rotateX(-Math.PI / 2);
    this.crumbs = new THREE.InstancedMesh(disc, this.crumbMat, CRUMBS);
    this.crumbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CRUMBS * 3), 3);
    this.crumbs.frustumCulled = false;
    this.crumbs.renderOrder = 6;
    this.group.add(this.chevron, this.crumbs);
  }

  /** `target` gets the beam; the chevron and breadcrumbs lead toward `via`, the next waypoint. */
  update(time: number, world: World, from: THREE.Vector3, target: THREE.Vector3 | null, via: THREE.Vector3 | null, combat: boolean): void {
    const show = this.enabled && !!target;
    const dist = target ? Math.hypot(target.x - from.x, target.z - from.z) : 0;
    this.beam.mesh.visible = show && dist > 5;
    if (target && this.beam.mesh.visible) {
      this.beam.mesh.position.set(target.x, world.heightAt(target.x, target.z), target.z);
      const r = 0.5 + Math.min(1.2, dist / 80);
      this.beam.mesh.scale.set(r, 34, r);
      this.beam.u.uAlpha.value = (0.45 + Math.sin(time * 2.2) * 0.12) * Math.min(1, (dist - 5) / 8);
    }
    const near = !show || dist < 7;
    this.chevron.visible = !near && !combat;
    this.crumbs.visible = !near && !combat && dist > 10;
    if (near || !target) return;
    const lead = via ?? target;
    const leadDist = Math.max(0.001, Math.hypot(lead.x - from.x, lead.z - from.z));
    const dx = (lead.x - from.x) / leadDist;
    const dz = (lead.z - from.z) / leadDist;
    const yaw = Math.atan2(dx, dz);
    const cr = 1.55;
    const cx = from.x + dx * cr;
    const cz = from.z + dz * cr;
    this.chevron.position.set(cx, world.heightAt(cx, cz) + 0.09, cz);
    this.chevron.rotation.set(0, yaw, 0);
    this.chevMat.opacity = 0.45 + Math.sin(time * 5) * 0.2;
    this.chevron.scale.setScalar(0.8);
    if (!this.crumbs.visible) return;
    const flow = (time * 2.6) % SPACING;
    const n = Math.min(CRUMBS, Math.floor((Math.min(dist, leadDist + 2) - 4) / SPACING));
    for (let i = 0; i < CRUMBS; i++) {
      const d = 3 + i * SPACING + flow;
      const x = from.x + dx * d;
      const z = from.z + dz * d;
      this.p.set(x, world.heightAt(x, z) + 0.07, z);
      const k = i < n ? 1 - i / CRUMBS : 0;
      const fadeIn = i === 0 ? flow / SPACING : 1;
      const sc = (0.6 + 0.4 * k) * (i < n ? 1 : 0.0001);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.crumbs.setMatrixAt(i, this.m);
      this.col.copy(C.gold).multiplyScalar(0.9 * k * fadeIn);
      this.crumbs.setColorAt(i, this.col);
    }
    this.crumbs.instanceMatrix.needsUpdate = true;
    if (this.crumbs.instanceColor) this.crumbs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.chevron.geometry.dispose();
    this.chevMat.dispose();
    this.crumbs.geometry.dispose();
    this.crumbMat.dispose();
    this.group.removeFromParent();
  }
}
