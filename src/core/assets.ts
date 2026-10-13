// glTF loading with every compression the asset pipelines may use (meshopt, Draco, KTX2),
// plus a cache so each file is fetched and parsed once.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const base = import.meta.env.BASE_URL;

let loader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, Promise<THREE.Texture>>();

/** Call once with the renderer so KTX2 can pick a supported GPU format. */
export function initAssets(renderer: THREE.WebGLRenderer): void {
  if (loader) return;
  const draco = new DRACOLoader().setDecoderPath(`${base}libs/draco/`);
  const ktx2 = new KTX2Loader().setTranscoderPath(`${base}libs/basis/`).detectSupport(renderer);
  loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

/** Resolve a public/ path ("models/crab/jumper.glb") against the site base. */
export function assetUrl(path: string): string {
  return /^(https?:|\/|data:|blob:)/.test(path) ? path : `${base}${path}`;
}

export function loadGLTF(path: string): Promise<GLTF> {
  if (!loader) throw new Error('initAssets(renderer) must run before loadGLTF');
  let p = gltfCache.get(path);
  if (!p) {
    p = loader.loadAsync(assetUrl(path));
    gltfCache.set(path, p);
  }
  return p;
}

export function loadTexture(path: string, srgb = true): Promise<THREE.Texture> {
  let p = texCache.get(path);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(assetUrl(path)).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    });
    texCache.set(path, p);
  }
  return p;
}

/** Preload images used by DOM screens so they do not pop in. Resolves even if some fail. */
export function preloadImages(paths: string[]): Promise<void> {
  return Promise.all(
    paths.map(
      (p) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve();
          img.src = assetUrl(p);
        }),
    ),
  ).then(() => undefined);
}
