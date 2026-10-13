// The sunny tabletop: a varnished desk the size of a room (for a 37 cm robot), toys that are
// MuJoCo bodies, desk props that are MuJoCo geoms, a warm out-of-focus room and TVC lighting.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { RobotPackage } from '../sim/types';
import { mjPosToGame, mjQuatToGame } from './frames';
import { blockFace, radialTexture, roomPanorama, soccerTexture, woodTextures } from './textures';

const LETTERS: Record<string, string> = {
  toy_block_red: 'J',
  toy_block_blue: 'U',
  toy_block_yellow: 'M',
  toy_block_green: 'P',
  toy_block_purple: 'R',
};

export class Arena {
  readonly scene = new THREE.Scene();
  readonly key: THREE.DirectionalLight;
  private toys: { name: string; obj: THREE.Object3D }[] = [];
  private toyIndex: (THREE.Object3D | null)[] = [];
  private toyFor: readonly string[] | null = null;
  private room: THREE.Mesh;
  private contact: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];
  private deskMat: THREE.MeshStandardMaterial;
  private renderer: THREE.WebGLRenderer;
  static readonly DESK = 60;
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  /** Background colour the fog fades the desk into. */
  static readonly FOG = new THREE.Color('#3d2716');
  static readonly SUN = new THREE.Vector3(1.35, 1.25, 0.55);

  constructor(renderer: THREE.WebGLRenderer, pkg: RobotPackage) {
    this.renderer = renderer;
    const s = this.scene;
    s.background = Arena.FOG.clone();
    s.fog = new THREE.Fog(Arena.FOG, 2.6, 8.8);

    // Image-based reflections for the clearcoat: a neutral studio, dimmed and warmed by lights.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    s.environment = env;
    s.environmentIntensity = 0.26;
    this.disposables.push(env);

    // Lights: warm low key from the front-left (the robot faces +Z), cool rim from behind.
    s.add(new THREE.HemisphereLight('#ffe1bd', '#4a2c18', 0.25));
    // Late-afternoon sun from the robot's left, low enough to throw long soft shadows.
    const key = new THREE.DirectionalLight('#ffc98a', 4.2);
    key.position.copy(Arena.SUN);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -0.75; sc.right = 0.75; sc.top = 0.75; sc.bottom = -0.75; sc.near = 0.2; sc.far = 5;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.004;
    key.shadow.radius = 3;
    s.add(key, key.target);
    this.key = key;
    const rim = new THREE.DirectionalLight('#ffe6cc', 1.0);
    rim.position.set(0.8, 1.0, -1.6);
    s.add(rim);

    // The desk.
    const wood = woodTextures();
    const tile = 1.2; // metres per texture repeat: 8 boards of 15 cm
    const deskSize = Arena.DESK;
    wood.map.repeat.set(deskSize / tile, deskSize / tile);
    wood.roughness.repeat.copy(wood.map.repeat);
    // Standard, not physical: the desk fills most of the frame, and a clearcoat on it costs a
    // second specular lobe per pixel for a sheen the roughness map already gives.
    const deskMat = new THREE.MeshStandardMaterial({
      map: wood.map,
      roughnessMap: wood.roughness,
      roughness: 1,
      color: '#ffffff',
    });
    this.deskMat = deskMat;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(deskSize, deskSize), deskMat);
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    desk.name = 'desk';
    s.add(desk);
    this.disposables.push(wood.map, wood.roughness, deskMat, desk.geometry);

    // Soft contact shadow under the body, on top of the shadow map.
    const blob = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 128, 0.1);
    const cmat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), cmat);
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.0008;
    this.contact.renderOrder = 1;
    s.add(this.contact);
    this.disposables.push(blob, cmat, this.contact.geometry);

    // The room: a panorama cylinder that stays centred on the camera, far out of focus.
    const pano = roomPanorama(4096, 1024, `#${Arena.FOG.getHexString()}`, 1 - 0.8 / 6);
    pano.repeat.set(2, 1);
    const roomMat = new THREE.MeshBasicMaterial({ map: pano, side: THREE.BackSide, fog: false, color: '#d8c8b4' });
    this.room = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 6, 64, 1, true), roomMat);
    this.room.position.y = 2.2;
    s.add(this.room);
    this.disposables.push(pano, roomMat, this.room.geometry);

    // Bokeh: lamps and window glints in the room, HDR so bloom and the depth of field catch them.
    const bokeh = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, 0.55);
    this.disposables.push(bokeh);
    const r = mulberry(9);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const rad = 7.5 + r() * 1.2;
      const warm = r() < 0.8;
      const m = new THREE.SpriteMaterial({
        map: bokeh,
        color: warm ? new THREE.Color(2.4, 1.6, 0.85) : new THREE.Color(1.2, 1.5, 2.2),
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.35 + r() * 0.5,
      });
      const sp = new THREE.Sprite(m);
      sp.position.set(Math.cos(a) * rad, 0.5 + r() * 2.6, Math.sin(a) * rad);
      const sz = 0.15 + r() * 0.35;
      sp.scale.set(sz, sz, 1);
      this.room.add(sp);
      sp.position.y -= this.room.position.y;
      this.disposables.push(m);
    }

    // Desk props from the physics scene (static geoms).
    for (const p of pkg.scene.props) this.addProp(p);

    // Toys (free bodies).
    const ballTex = soccerTexture();
    this.disposables.push(ballTex);
    for (const t of pkg.scene.toys) {
      let obj: THREE.Mesh;
      if (t.kind === 'sphere') {
        const mat = new THREE.MeshPhysicalMaterial({ map: ballTex, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 });
        obj = new THREE.Mesh(new THREE.SphereGeometry(t.size[0], 48, 32), mat);
        this.disposables.push(mat, obj.geometry);
      } else {
        const col = `#${new THREE.Color().setRGB(t.rgba[0], t.rgba[1], t.rgba[2], THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
        const tex = blockFace(LETTERS[t.body] ?? 'A', col);
        const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 });
        const [hx, hy, hz] = t.size;
        obj = new THREE.Mesh(roundedBox(hy * 2, hz * 2, hx * 2, Math.min(hx, hy, hz) * 0.18), mat);
        this.disposables.push(tex, mat, obj.geometry);
      }
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.name = t.body;
      s.add(obj);
      this.toys.push({ name: t.body, obj });
    }
  }

  private addProp(p: RobotPackage['scene']['props'][number]): void {
    const color = new THREE.Color().setRGB(p.rgba[0], p.rgba[1], p.rgba[2], THREE.SRGBColorSpace);
    let mesh: THREE.Object3D;
    if (p.kind === 'box') {
      // A hardback book: cover boards and a cream page block.
      const [hx, hy, hz] = p.size;
      const g = new THREE.Group();
      const cover = new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, clearcoat: 0.2 });
      const pages = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.9 });
      const board = 0.0025;
      const top = new THREE.Mesh(new THREE.BoxGeometry(hy * 2, board, hx * 2), cover);
      top.position.y = hz - board / 2;
      const bottom = top.clone();
      bottom.position.y = -hz + board / 2;
      const spine = new THREE.Mesh(new THREE.BoxGeometry(board, hz * 2, hx * 2), cover);
      spine.position.x = hy; // spines toward the opening camera
      const block = new THREE.Mesh(new THREE.BoxGeometry(hy * 2 - board * 2, hz * 2 - board * 2, hx * 2 - board * 2), pages);
      block.position.x = -board / 2;
      g.add(top, bottom, spine, block);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      mesh = g;
      this.disposables.push(cover, pages);
    } else {
      const [rad, half] = p.size;
      const g = new THREE.Group();
      const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.94, half * 2, 48, 1, true), mat);
      const base = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.94, 48), mat);
      base.rotation.x = Math.PI / 2;
      base.position.y = -half + 0.004;
      const coffee = new THREE.Mesh(
        new THREE.CircleGeometry(rad * 0.92, 48),
        new THREE.MeshPhysicalMaterial({ color: '#2a160b', roughness: 0.1, clearcoat: 1 }),
      );
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.y = half * 0.7;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.93, rad * 0.88, half * 2 - 0.006, 48, 1, true), new THREE.MeshStandardMaterial({ color, side: THREE.BackSide, roughness: 0.3 }));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(half * 0.5, rad * 0.16, 16, 32, Math.PI * 1.2), mat);
      handle.position.set(rad * 1.02, 0, 0);
      handle.rotation.z = -Math.PI * 0.6;
      g.add(body, base, coffee, inner, handle);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      mesh = g;
      this.disposables.push(mat);
    }
    mjPosToGame(mesh.position, p.pos[0], p.pos[1], p.pos[2]);
    const half = THREE.MathUtils.degToRad(p.yawDeg) / 2;
    mjQuatToGame(mesh.quaternion, Math.cos(half), 0, 0, Math.sin(half));
    mesh.name = p.name;
    this.scene.add(mesh);
  }

  /**
   * Photographic upgrade (Poly Haven, CC0): a varnished table top and an interior HDRI for the
   * reflections on the clearcoat. The procedural desk and studio stay if either fails to load.
   */
  async upgrade(base: string): Promise<void> {
    const url = (f: string) => new URL(`arena/${f}`, base).href;
    const tl = new THREE.TextureLoader();
    try {
      const [hdr, diff, rough, nor] = await Promise.all([
        new HDRLoader().loadAsync(url('cayley_interior_1k.hdr')),
        tl.loadAsync(url('oak_wood_planks_diff_2k.jpg')),
        tl.loadAsync(url('oak_wood_planks_rough_1k.jpg')),
        tl.loadAsync(url('oak_wood_planks_nor_gl_1k.jpg')),
      ]);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      this.scene.environment?.dispose();
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.42;
      // Put the HDRI's big window on the robot's left, where the sun comes from.
      this.scene.environmentRotation.set(0, -1.1, 0);
      this.disposables.push(env);
      const tile = 1.2; // the scan is 1.2 m square
      const rep = Arena.DESK / tile;
      diff.colorSpace = THREE.SRGBColorSpace;
      for (const t of [diff, rough, nor]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rep, rep);
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.disposables.push(t);
      }
      const m = this.deskMat;
      m.map?.dispose();
      m.roughnessMap?.dispose();
      m.map = diff;
      m.roughnessMap = rough;
      m.normalMap = nor;
      m.normalScale.set(0.6, 0.6);
      m.roughness = 0.72;
      m.color.set('#e8e0d6');
      m.needsUpdate = true;
    } catch (err) {
      console.warn('Robot Mode: photo textures unavailable, keeping the procedural desk', err);
    }
  }

  /** Toy poses from the physics frame (7 floats per body, MuJoCo frame), and camera-centred room. */
  update(bodies: readonly string[], poses: Float32Array, base: THREE.Vector3, camera: THREE.Camera): void {
    if (this.toyFor !== bodies) {
      this.toyFor = bodies;
      this.toyIndex = bodies.map((b) => this.toys.find((t) => t.name === b)?.obj ?? null);
    }
    for (let i = 0; i < this.toyIndex.length; i++) {
      const obj = this.toyIndex[i];
      if (!obj) continue;
      const o = i * 7;
      mjPosToGame(this.tmpV, poses[o], poses[o + 1], poses[o + 2]);
      mjQuatToGame(this.tmpQ, poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]);
      obj.position.copy(this.tmpV);
      obj.quaternion.copy(this.tmpQ);
    }
    this.contact.position.x = base.x;
    this.contact.position.z = base.z;
    const lift = Math.max(0, base.y - 0.1);
    (this.contact.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - lift * 6);
    this.contact.scale.setScalar(1 + lift * 3);
    // Shadow frustum and key light follow the robot.
    this.key.target.position.copy(base).setY(0);
    this.key.position.copy(base).setY(0).add(Arena.SUN);
    this.room.position.x = camera.position.x;
    this.room.position.z = camera.position.z;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box with bevelled edges, centred, sized x by y by z (game axes). */
function roundedBox(x: number, y: number, z: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = x / 2 - r, h = z / 2 - r;
  shape.moveTo(-w, -z / 2);
  shape.lineTo(w, -z / 2);
  shape.quadraticCurveTo(x / 2, -z / 2, x / 2, -h);
  shape.lineTo(x / 2, h);
  shape.quadraticCurveTo(x / 2, z / 2, w, z / 2);
  shape.lineTo(-w, z / 2);
  shape.quadraticCurveTo(-x / 2, z / 2, -x / 2, h);
  shape.lineTo(-x / 2, -h);
  shape.quadraticCurveTo(-x / 2, -z / 2, -w, -z / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, y - r * 2),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r * 0.9,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  // Box-style UVs so each face shows the whole texture.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const px = pos.getX(i) / x + 0.5, py = pos.getY(i) / y + 0.5, pz = pos.getZ(i) / z + 0.5;
    if (nx >= ny && nx >= nz) { uv[i * 2] = pz; uv[i * 2 + 1] = py; }
    else if (ny >= nz) { uv[i * 2] = px; uv[i * 2 + 1] = pz; }
    else { uv[i * 2] = px; uv[i * 2 + 1] = py; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
