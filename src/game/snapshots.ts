// Offscreen renders: 3D portraits of crabs (unit frames and dialogue fall back to these when the
// painted portraits are missing) and a top-down picture of the zone for the minimap.
import * as THREE from 'three';
import type { CrabRig } from '../crab/types';

const SRGB = new Uint8ClampedArray(256);
for (let i = 0; i < 256; i++) {
  const l = i / 255;
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  SRGB[i] = Math.round(Math.min(1, s) * 255);
}

/** Read a render target into a 2D canvas, flipping Y and converting linear to sRGB. */
function targetToCanvas(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, out: HTMLCanvasElement, keepAlpha: boolean): void {
  const w = rt.width;
  const h = rt.height;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      d[dst + x] = SRGB[buf[src + x]];
      d[dst + x + 1] = SRGB[buf[src + x + 1]];
      d[dst + x + 2] = SRGB[buf[src + x + 2]];
      d[dst + x + 3] = keepAlpha ? buf[src + x + 3] : 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  const g = out.getContext('2d')!;
  g.clearRect(0, 0, out.width, out.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, 0, 0, out.width, out.height);
}

export class PortraitStudio {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  private rt = new THREE.WebGLRenderTarget(384, 384, { type: THREE.UnsignedByteType });
  private canvas = document.createElement('canvas');

  constructor(private readonly renderer: THREE.WebGLRenderer, environment: THREE.Texture | null) {
    this.canvas.width = this.canvas.height = 192;
    this.scene.environment = environment;
    const key = new THREE.DirectionalLight(0xfff1d8, 2.6);
    key.position.set(1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight(0x8fc8ff, 2.2);
    rim.position.set(-2.5, 1.5, -2);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xcfe4ff, 0x40302a, 1.4));
  }

  /** Render the rig's head and visor, returns a PNG data URL. The rig is put back afterwards. */
  shoot(rig: CrabRig): string {
    const root = rig.root;
    const parent = root.parent;
    const pos = root.position.clone();
    const rot = root.rotation.y;
    const vis = root.visible;
    this.scene.add(root);
    root.position.set(0, 0, 0);
    root.rotation.y = 0.45;
    root.visible = true;
    root.updateMatrixWorld(true);
    const face = rig.getSocket('face').getWorldPosition(new THREE.Vector3());
    const head = rig.getSocket('head').getWorldPosition(new THREE.Vector3());
    const h = Math.max(0.3, head.y);
    const look = new THREE.Vector3(face.x * 0.6, (face.y + head.y) * 0.5, face.z * 0.4);
    this.cam.position.set(look.x + h * 0.55, look.y + h * 0.18, look.z + h * 2.0);
    this.cam.lookAt(look);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    this.renderer.setRenderTarget(prevTarget);
    targetToCanvas(this.renderer, this.rt, this.canvas, true);
    if (parent) parent.add(root);
    else this.scene.remove(root);
    root.position.copy(pos);
    root.rotation.y = rot;
    root.visible = vis;
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.rt.dispose();
  }
}

export interface MapSnapshot {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  size: number;
}

/**
 * Top-down orthographic picture of the static world for the minimap. `hide` lists objects to
 * hide during the shot (crabs, effects).
 */
export function snapshotMap(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; topY: number },
  hide: THREE.Object3D[],
): MapSnapshot {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = size / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, bounds.topY + 200);
  cam.position.set(cx, bounds.topY, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  const rt = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.UnsignedByteType });
  const fog = scene.fog;
  const bg = scene.background;
  const vis = hide.map((o) => o.visible);
  scene.fog = null;
  scene.background = new THREE.Color(0x1d3d52);
  hide.forEach((o) => (o.visible = false));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x1d3d52, 1);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  scene.fog = fog;
  scene.background = bg;
  hide.forEach((o, i) => (o.visible = vis[i]));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  targetToCanvas(renderer, rt, canvas, false);
  rt.dispose();
  // cam.up = -Z means the top of the image is -Z; minimap code maps world (x, z) to
  // ((x - minX) / size, (z - minZ) / size) in image space.
  return { canvas, minX: cx - half, minZ: cz - half, size };
}
