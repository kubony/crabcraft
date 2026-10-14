// Rendering layer for the simulated robot. Swappable: Robot Mode hands every layer the same
// per-frame physics state, so a stylised CrabRig layer (src/crab/types.ts) can replace the raw
// meshes without touching the simulation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MJ_TO_GAME, mjPosToGame, mjQuatToGame } from './frames';

/** What a rendering layer gets every frame. Poses are MuJoCo-frame, 7 floats per body. */
export interface RobotRenderFrame {
  bodies: readonly string[];
  poses: Float32Array;
  /** 22 joint angles in the bundle's wire order (named by `joints`), MuJoCo qpos convention. */
  q: Float32Array;
  /** Joint name of each entry of `q` (the bundle's wire_joint_order). */
  joints: readonly string[];
  mode: string;
  running: boolean;
  simTime: number;
}

export interface RobotViewLayer {
  readonly object: THREE.Object3D;
  update(frame: RobotRenderFrame, dt: number): void;
  /** The LED face's reaction to the current mode, for layers that have a face. */
  setExpression?(e: FaceExpr): void;
  dispose(): void;
}

// ---------- Materials (TVC product look) ----------

export function makeRobotMaterials() {
  const red = new THREE.MeshPhysicalMaterial({
    name: 'jumper-red',
    color: new THREE.Color('#a60a17'),
    roughness: 0.34,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 0.85,
  });
  const black = new THREE.MeshPhysicalMaterial({
    name: 'jumper-black',
    color: new THREE.Color('#0d0d10'),
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });
  const visor = new THREE.MeshPhysicalMaterial({
    name: 'jumper-visor',
    color: new THREE.Color('#020203'),
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.5,
    ior: 1.55,
    specularIntensity: 1,
  });
  const alu = new THREE.MeshPhysicalMaterial({
    name: 'jumper-aluminium',
    color: new THREE.Color('#d5d8dd'),
    roughness: 0.28,
    metalness: 1,
    envMapIntensity: 2.4,
  });
  const pad = new THREE.MeshPhysicalMaterial({
    name: 'jumper-silicone',
    color: new THREE.Color('#bfc1bd'),
    roughness: 0.62,
    metalness: 0.15,
    clearcoat: 0.2,
    clearcoatRoughness: 0.5,
  });
  return { red, black, visor, alu, pad };
}

type Mats = ReturnType<typeof makeRobotMaterials>;

function materialFor(body: string, rgba: number[] | undefined, m: Mats): THREE.Material {
  if (body === 'display_module_link') return m.visor;
  if (!rgba) return m.red;
  const [r, g, b] = rgba;
  if (r > 0.7 && g < 0.2) return m.red;
  if (r < 0.05 && g < 0.05 && b < 0.05) return m.black;
  if (r > 0.6 && r < 0.75) return m.alu;
  return m.pad;
}

// ---------- LED face ----------

export type FaceExpr = 'neutral' | 'blink' | 'happy' | 'focused' | 'dead' | 'love' | 'surprised' | 'sleepy';

/** The display behind the visor: two LED eyes drawn on a canvas, glowing through bloom. */
export class LedFace {
  readonly mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private expr: FaceExpr = 'neutral';
  private drawn = '';
  private blinkT = 2 + Math.random() * 2;
  private blinking = 0;
  private lookX = 0;
  private lookTarget = 0;
  private lookT = 1;
  color = new THREE.Color('#53f2e4');

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = Math.round((512 * height) / width);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      color: new THREE.Color(2.2, 2.2, 2.2),
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.name = 'led-face';
    this.mesh.renderOrder = 2;
    this.draw();
  }

  set(e: FaceExpr): void {
    this.expr = e;
  }

  update(dt: number): void {
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.expr !== 'dead') {
      this.blinking = 0.14;
      this.blinkT = 2.5 + Math.random() * 3.5;
    }
    if (this.blinking > 0) this.blinking -= dt;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookTarget = (Math.random() - 0.5) * 0.5;
      this.lookT = 1.5 + Math.random() * 3;
    }
    this.lookX += (this.lookTarget - this.lookX) * Math.min(1, dt * 6);
    this.draw();
  }

  private draw(): void {
    const e = this.blinking > 0 && (this.expr === 'neutral' || this.expr === 'focused') ? 'blink' : this.expr;
    const key = `${e}:${this.lookX.toFixed(2)}:${this.color.getHexString()}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const col = `#${this.color.getHexString()}`;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.lineCap = 'round';
    const cy = H * 0.5;
    const ox = this.lookX * W * 0.06;
    const eyes = [W * 0.3 + ox, W * 0.7 + ox];
    const ew = W * 0.12, eh = H * 0.62;
    for (const cx of eyes) {
      ctx.beginPath();
      switch (e) {
        case 'blink':
        case 'sleepy':
          ctx.lineWidth = H * 0.08;
          ctx.moveTo(cx - ew * 0.7, cy + eh * 0.1);
          ctx.lineTo(cx + ew * 0.7, cy + eh * 0.1);
          ctx.stroke();
          break;
        case 'happy':
          ctx.lineWidth = H * 0.1;
          ctx.arc(cx, cy + eh * 0.25, ew * 0.75, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          break;
        case 'focused': {
          // Arrow eyes, pointing at each other: determined.
          ctx.lineWidth = H * 0.09;
          const dir = cx < W / 2 ? 1 : -1;
          ctx.moveTo(cx - dir * ew * 0.6, cy - eh * 0.35);
          ctx.lineTo(cx + dir * ew * 0.5, cy);
          ctx.lineTo(cx - dir * ew * 0.6, cy + eh * 0.35);
          ctx.stroke();
          break;
        }
        case 'dead':
          ctx.lineWidth = H * 0.08;
          ctx.moveTo(cx - ew * 0.6, cy - eh * 0.3);
          ctx.lineTo(cx + ew * 0.6, cy + eh * 0.3);
          ctx.moveTo(cx + ew * 0.6, cy - eh * 0.3);
          ctx.lineTo(cx - ew * 0.6, cy + eh * 0.3);
          ctx.stroke();
          break;
        case 'love': {
          const s = ew * 0.9;
          ctx.moveTo(cx, cy + s * 0.75);
          ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.1, cx - s * 0.5, cy - s * 1.0, cx, cy - s * 0.35);
          ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.0, cx + s * 1.3, cy - s * 0.1, cx, cy + s * 0.75);
          ctx.fill();
          break;
        }
        case 'surprised':
          ctx.arc(cx, cy, ew * 0.75, 0, Math.PI * 2);
          ctx.fill();
          break;
        default: {
          // The TVC's rounded-rectangle eyes with a small catch-light.
          const r = ew * 0.45;
          ctx.roundRect(cx - ew / 2, cy - eh / 2, ew, eh, r);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.roundRect(cx - ew * 0.22, cy - eh * 0.36, ew * 0.24, eh * 0.26, ew * 0.12);
          ctx.fill();
          ctx.fillStyle = col;
          ctx.shadowBlur = 18;
        }
      }
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

// ---------- The raw robot: decimated visual STLs posed by the physics ----------

export class StlRobotView implements RobotViewLayer {
  readonly object = new THREE.Group();
  private nodes = new Map<string, THREE.Object3D>();
  private order: (THREE.Object3D | null)[] = [];
  private orderFor: readonly string[] | null = null;
  readonly face: LedFace;
  private mats: Mats;
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private meshes: THREE.Mesh[] = [];
  private xrayMeshes: THREE.Mesh[] | null = null;
  private xrayMat: THREE.ShaderMaterial | null = null;

  private constructor(gltfScene: THREE.Object3D, rgba: Record<string, number[]>) {
    this.object.name = 'jumper-robot';
    this.mats = makeRobotMaterials();
    const meshes: THREE.Mesh[] = [];
    gltfScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    let faceHost: THREE.Object3D | null = null;
    let faceBox: THREE.Box3 | null = null;
    for (const src of meshes) {
      const body = nodeName(src, rgba);
      let geo = src.geometry.clone();
      geo.applyMatrix4(MJ_TO_GAME);
      geo = cleanNormals(toCreasedNormals(dropDegenerate(geo), THREE.MathUtils.degToRad(55)));
      const mesh = new THREE.Mesh(geo, materialFor(body, rgba[body], this.mats));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const node = new THREE.Group();
      node.name = body;
      node.add(mesh);
      this.object.add(node);
      this.nodes.set(body, node);
      this.meshes.push(mesh);
      if (body === 'display_module_link') {
        faceHost = node;
        geo.computeBoundingBox();
        faceBox = geo.boundingBox!.clone();
      }
    }
    // The display is 107 mm wide; the eyes sit on its front face (game +Z is robot forward).
    const w = faceBox ? (faceBox.max.x - faceBox.min.x) * 0.78 : 0.08;
    const h = faceBox ? (faceBox.max.y - faceBox.min.y) * 0.62 : 0.02;
    this.face = new LedFace(w, h);
    if (faceHost && faceBox) {
      const c = faceBox.getCenter(new THREE.Vector3());
      this.face.mesh.position.set(c.x, c.y + h * 0.05, faceBox.max.z + 0.0012);
      faceHost.add(this.face.mesh);
    }
  }

  static async load(url: string, rgba: Record<string, number[]>): Promise<StlRobotView> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new StlRobotView(gltf.scene, rgba);
  }

  setExpression(e: FaceExpr): void {
    this.face.set(e);
  }

  /**
   * X-ray: the physics robot drawn over everything else on screen (depth test off) as a glowing
   * rim-lit hologram, at `opacity` (0 hides it; the meshes are built on the first call either
   * way, so they can be compiled ahead). Used to check that another layer follows the physics
   * exactly, and as the flash when the appearance switches.
   */
  setXray(opacity: number): void {
    if (!this.xrayMeshes) {
      this.xrayMat = new THREE.ShaderMaterial({
        name: 'jumper-xray',
        uniforms: { uColor: { value: new THREE.Color(0.32, 1.0, 0.94) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            float a = (0.07 + 0.93 * pow(rim, 2.6)) * uOpacity;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      this.xrayMeshes = this.meshes.map((m) => {
        const g = new THREE.Mesh(m.geometry, this.xrayMat!);
        g.renderOrder = 20;
        g.name = 'xray';
        g.castShadow = false;
        g.receiveShadow = false;
        m.parent!.add(g);
        return g;
      });
    }
    if (this.xrayMat) this.xrayMat.uniforms.uOpacity.value = opacity;
    for (const g of this.xrayMeshes ?? []) g.visible = opacity > 0;
  }

  /** Shows or hides the painted surfaces and the face (the x-ray is separate). */
  setSolid(on: boolean): void {
    for (const m of this.meshes) m.visible = on;
    this.face.mesh.visible = on;
  }

  update(f: RobotRenderFrame, dt: number): void {
    if (this.orderFor !== f.bodies) {
      this.orderFor = f.bodies;
      this.order = f.bodies.map((b) => this.nodes.get(b) ?? null);
    }
    for (let i = 0; i < this.order.length; i++) {
      const n = this.order[i];
      if (!n) continue;
      const o = i * 7;
      const p = f.poses;
      mjPosToGame(this.tmpV, p[o], p[o + 1], p[o + 2]);
      mjQuatToGame(this.tmpQ, p[o + 3], p[o + 4], p[o + 5], p[o + 6]);
      n.position.copy(this.tmpV);
      n.quaternion.copy(this.tmpQ);
    }
    this.face.update(dt);
  }

  dispose(): void {
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of Object.values(this.mats)) m.dispose();
    this.xrayMat?.dispose();
    this.face.dispose();
  }
}

/** Decimation leaves sliver triangles; their normals are NaN and render as black holes. */
function dropDegenerate(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length();
    if (area > 1e-12) keep.push(i);
  }
  const out = new Float32Array(keep.length * 9);
  keep.forEach((i, k) => {
    for (let v = 0; v < 3; v++) {
      out[k * 9 + v * 3] = pos.getX(i + v);
      out[k * 9 + v * 3 + 1] = pos.getY(i + v);
      out[k * 9 + v * 3 + 2] = pos.getZ(i + v);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Any normal that is still not unit length falls back to its face normal. */
function cleanNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    const l = Math.hypot(x, y, z);
    if (Number.isFinite(l) && l > 0.5) continue;
    const t = i - (i % 3);
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    f.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    n.setXYZ(i, f.x || 0, f.y || 1, f.z || 0);
  }
  return geo;
}

function nodeName(o: THREE.Object3D, known: Record<string, unknown>): string {
  // tools/build_robot_visual.py names each node after its body; GLTFLoader may suffix the mesh.
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name in known) return n.name;
    const bare = n.name.replace(/_\d+$/, '');
    if (bare in known) return bare;
  }
  return o.name;
}
