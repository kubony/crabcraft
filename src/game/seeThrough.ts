// See-through for an occluder: the parts of a crab that sit between the camera and a subject, close
// to the subject on screen, are dithered away (screen-door transparency). Corrodius thins out where
// his claws cover the player's crab; the player's own crab thins out where a claw or a sword crosses
// the face of the NPC it is talking to. It is a per-fragment test, so only the patch that actually
// covers the subject thins out; the rest of the crab, its shadow (cast by the shadow pass, which
// this does not touch) and everything else stay as they were.
import * as THREE from 'three';

const DECL = /* glsl */ `
uniform vec3 uSeeCentre;
uniform float uSeeRadius;
uniform float uSeeAmount;
const float SEE_BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
`;

// vViewPosition is the fragment's negated view-space position in three's lit materials.
const TEST = /* glsl */ `
if (uSeeAmount > 0.0) {
  float seeFd = vViewPosition.z;
  float seeSd = -uSeeCentre.z;
  if (seeFd > 0.01 && seeFd < seeSd + 0.1) {
    // Offset from the subject on the image plane, in world units at the subject's depth.
    float seeO = length((-vViewPosition.xy / seeFd - uSeeCentre.xy / seeSd) * seeSd);
    float seeBody = uSeeRadius * 0.5;
    // Over the subject itself anything nearer than its middle thins out (a claw reaching over it or
    // through it); in the soft ring around it only what stands well in front does, so the hull
    // just behind and above it keeps its shape.
    float seeNeed = seeBody * smoothstep(seeBody * 0.8, uSeeRadius, seeO) - 0.1;
    float seeFront = smoothstep(seeNeed, seeNeed + 0.45, seeSd - seeFd);
    float seeIn = 1.0 - smoothstep(seeBody, uSeeRadius, seeO);
    float seeKeep = 1.0 - 0.84 * seeIn * seeFront * uSeeAmount;
    ivec2 seeP = ivec2(mod(gl_FragCoord.xy, 4.0));
    if ((SEE_BAYER[seeP.x + seeP.y * 4] + 0.5) / 16.0 > seeKeep) discard;
  }
}
`;

const v = new THREE.Vector3();

export class SeeThrough {
  private readonly uniforms = {
    /** Subject centre in view space. */
    uSeeCentre: { value: new THREE.Vector3(0, 0, -1) },
    /** World radius of the clear area around the subject, at the subject's depth. */
    uSeeRadius: { value: 1 },
    /** 0 off, 1 full. */
    uSeeAmount: { value: 0 },
  };
  private amount = 0;

  /** Give every lit mesh under root its own see-through copy of its material. */
  apply(root: THREE.Object3D): void {
    const copies = new Map<THREE.Material, THREE.Material>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (mat: THREE.Material): THREE.Material => {
        if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || !mat.colorWrite) return mat;
        let c = copies.get(mat);
        if (!c) copies.set(mat, (c = this.patch(mat as THREE.MeshStandardMaterial)));
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /**
   * Call after the camera has moved for the frame. The strength eases toward `amount` (0..1);
   * `centre` is the subject's middle in world space and `radius` the clear area around it.
   */
  update(dt: number, camera: THREE.Camera, centre: THREE.Vector3, radius: number, amount: number): void {
    this.amount += (amount - this.amount) * (1 - Math.exp(-dt * 6));
    if (amount <= 0 && this.amount < 0.01) this.amount = 0;
    const u = this.uniforms;
    u.uSeeAmount.value = this.amount;
    if (!this.amount) return;
    camera.updateMatrixWorld();
    u.uSeeCentre.value.copy(v.copy(centre).applyMatrix4(camera.matrixWorldInverse));
    u.uSeeRadius.value = radius;
  }

  private patch(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const m = src.clone();
    m.name = `${src.name}+see`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${DECL}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${TEST}`);
    };
    // Every instance runs the same GLSL, so they share programs; each material still binds the
    // uniforms its own onBeforeCompile handed it.
    m.customProgramCacheKey = () => 'see-through';
    return m;
  }
}
