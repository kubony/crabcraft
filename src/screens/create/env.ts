// Studio reflection environment for the glossy crab: a warm golden-hour dome with a big warm
// softbox on the key side, cool strip lights behind for rim reflections and a soft top light,
// the way product films light glossy plastic. Rendered once into a PMREM cube.
import * as THREE from 'three';

export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  // Gradient dome via vertex colours: dark warm floor, amber horizon, dusk-blue zenith.
  const dome = new THREE.SphereGeometry(30, 48, 24);
  const colors: number[] = [];
  const pos = dome.getAttribute('position');
  const zenith = new THREE.Color(0.1, 0.13, 0.22);
  const horizon = new THREE.Color(0.55, 0.36, 0.22);
  const floor = new THREE.Color(0.07, 0.05, 0.04);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 30;
    if (y > 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(floor, Math.pow(-y, 0.4));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(dome, domeMat));
  disposables.push(dome, domeMat);

  const panel = (w: number, h: number, color: THREE.Color, at: THREE.Vector3, round = false) => {
    const geo = round ? new THREE.CircleGeometry(w / 2, 32) : new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.lookAt(0, 0, 0);
    scene.add(m);
    disposables.push(geo, mat);
  };
  // Key softbox: big, warm, front left and above (matches the key light).
  panel(12, 9, new THREE.Color(1.0, 0.78, 0.55).multiplyScalar(5.5), new THREE.Vector3(-12, 10, 12));
  // Fill card: front right, dim and neutral, so the visor shows a soft gradient.
  panel(10, 6, new THREE.Color(0.75, 0.8, 0.9).multiplyScalar(1.1), new THREE.Vector3(14, 4, 10));
  // Cool rim strips behind, tall and thin: the long highlights along the shell edges.
  panel(2.2, 16, new THREE.Color(0.65, 0.8, 1.0).multiplyScalar(7), new THREE.Vector3(14, 6, -12));
  panel(2.2, 16, new THREE.Color(1.0, 0.72, 0.45).multiplyScalar(5), new THREE.Vector3(-15, 5, -10));
  // Top light.
  panel(10, 10, new THREE.Color(1.0, 0.93, 0.85).multiplyScalar(2.4), new THREE.Vector3(0, 18, 0), true);
  // Low warm bounce off the stone dais.
  panel(20, 4, new THREE.Color(0.8, 0.5, 0.25).multiplyScalar(0.7), new THREE.Vector3(0, -8, 16));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return rt;
}
