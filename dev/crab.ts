// Crab studio: TVC-like turntable for the crab model, race/sex/class lineups, silhouettes,
// enemies, the LED expression sheet, a 25-crab perf scene and the browser FK check.
//   /dev/crab.html?view=hero|lineup|silhouette|enemies|faces|perf|fk  (&clean hides the UI)
import '../src/ui/kit.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Engine } from '../src/core/engine';
import { initAssets } from '../src/core/assets';
import { createCrab, createEnemyCrab, HOME_POSE } from '../src/crab/index';
import type { JumperRig } from '../src/crab/rig';
import { createMotionController } from '../src/motion/stub';
import { RACES, RACE_ORDER } from '../src/data/races';
import { CLASS_ORDER } from '../src/data/classes';
import { JOINT_NAMES, type CrabRig, type CrabSpec, type Expression, type RaceId, type Sex } from '../src/crab/types';

declare global {
  interface Window {
    __ready?: boolean;
    __crab?: unknown;
    __fk?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'hero';
if (params.has('clean')) document.body.classList.add('clean');

const engine = new Engine(document.getElementById('app')!, 'high');
initAssets(engine.renderer);
engine.renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 200);
const pmrem = new THREE.PMREMGenerator(engine.renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = Number(params.get('env') ?? 0.25);

const silhouette = view === 'silhouette';
const panel = document.getElementById('panel')!;
const stats = document.getElementById('stats')!;
const labels: { el: HTMLDivElement; obj: THREE.Object3D; dy: number }[] = [];

function studio(opts: { floor?: number; bg?: number; fog?: [number, number] } = {}): THREE.DirectionalLight {
  scene.background = new THREE.Color(opts.bg ?? 0x2a1d14);
  if (opts.fog) scene.fog = new THREE.Fog(opts.bg ?? 0x2a1d14, opts.fog[0], opts.fog[1]);
  const hemi = new THREE.HemisphereLight(0xffe9d0, 0x3a2a20, 0.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe0b5, 2.4);
  key.position.set(-4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
  rim.position.set(5, 3, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffc89a, 0.35);
  fill.position.set(6, 2, 4);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: opts.floor ?? 0xcfc6b8, roughness: 0.55, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  return key;
}

function bokeh(count: number, radius: number, y: [number, number]): void {
  const g = new THREE.SphereGeometry(0.12, 12, 8);
  const cols = [0xffb15a, 0xffd28a, 0xff8a3a, 0xfff0c0];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % 4]).multiplyScalar(2 + Math.random() * 3) }));
    const a = Math.PI * (0.65 + Math.random() * 0.7);
    m.position.set(Math.cos(a) * radius * (0.8 + Math.random() * 0.4), y[0] + Math.random() * (y[1] - y[0]), Math.sin(a) * radius);
    m.scale.setScalar(0.6 + Math.random() * 1.2);
    scene.add(m);
  }
}

function label(text: string, obj: THREE.Object3D, dy = 0): void {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = text;
  document.body.appendChild(el);
  labels.push({ el, obj, dy });
}

const v = new THREE.Vector3();
function updateLabels(): void {
  for (const l of labels) {
    l.obj.getWorldPosition(v);
    v.y += l.dy;
    v.project(cam);
    l.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    l.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    l.el.style.display = v.z < 1 ? '' : 'none';
  }
}

const spec = (race: RaceId, sex: Sex = 'male', classId: CrabSpec['classId'] = 'warrior', extra: Partial<CrabSpec> = {}): CrabSpec => ({
  race,
  sex,
  classId,
  shell: 0,
  crest: 0,
  led: 0,
  name: `${race}-${sex}`,
  ...extra,
});

const crabs: CrabRig[] = [];
let controls: OrbitControls | null = null;
let ready = () => setTimeout(() => (window.__ready = true), 900);

async function hero(): Promise<void> {
  studio({ floor: 0xd6d0c6, bg: 0x1e140d, fog: [9, 26] });
  bokeh(26, 14, [0.5, 5]);
  const s = spec('human');
  const crab = (await createCrab(s)) as JumperRig;
  crab.root.rotation.y = 0.0;
  scene.add(crab.root);
  crabs.push(crab);
  window.__crab = crab;
  cam.fov = 26;
  cam.position.set(0.55, 0.62, 3.0);
  controls = new OrbitControls(cam, engine.canvas);
  controls.target.set(0, 0.55, 0);
  controls.update();
  engine.setView(scene, cam, { dof: { focusDistance: 3.0, focusRange: 1.4, bokehScale: 3 }, bloom: { intensity: 1.0, threshold: 0.9 }, exposure: 1.0 });
  buildPanel(crab);
  ready();
}

async function lineup(): Promise<void> {
  studio({ floor: 0xcbc3b4, bg: 0x241a12, fog: [16, 40] });
  const jobs: Promise<void>[] = [];
  RACE_ORDER.forEach((race, i) => {
    (['male', 'female'] as Sex[]).forEach((sex, k) => {
      const cls = CLASS_ORDER[(i + k) % 3];
      jobs.push(
        createCrab(spec(race, sex, cls, { shell: k, crest: k, led: 0 })).then((c) => {
          c.root.position.set((i - 2.5) * 2.5, 0, k === 0 ? 0 : -2.6);
          scene.add(c.root);
          crabs.push(c);
          if (k === 0) label(`${RACES[race].name}`, c.root, -0.35);
        }),
      );
    });
  });
  await Promise.all(jobs);
  cam.fov = 32;
  cam.position.set(0, 4.2, 13.5);
  controls = new OrbitControls(cam, engine.canvas);
  controls.target.set(0, 0.6, -1.3);
  controls.update();
  engine.setView(scene, cam, { bloom: { intensity: 0.9, threshold: 0.9 } });
  ready();
}

async function raceSheet(): Promise<void> {
  studio({ floor: 0xcbc3b4, bg: 0x241a12, fog: [16, 40] });
  const race = (params.get('race') ?? 'human') as RaceId;
  const jobs = [0, 1, 2, 3].map((crest) =>
    createCrab(spec(race, crest % 2 ? 'female' : 'male', CLASS_ORDER[crest % 3], { crest, shell: crest, led: crest % 3 })).then((c) => {
      c.root.position.set((crest - 1.5) * 2.3, 0, 0);
      c.root.rotation.y = 0.5;
      scene.add(c.root);
      crabs.push(c);
      label(`${RACES[race].crestStyles[crest].name} (${c.spec.sex}, ${c.spec.classId})`, c.root, -0.3);
    }),
  );
  await Promise.all(jobs);
  cam.fov = 30;
  cam.position.set(0, 2.6, 8.2);
  controls = new OrbitControls(cam, engine.canvas);
  controls.target.set(0, 0.55, 0);
  controls.update();
  engine.setView(scene, cam, { bloom: { intensity: 0.9, threshold: 0.9 } });
  ready();
}

async function silhouettes(): Promise<void> {
  scene.background = new THREE.Color(0xf4efe6);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  const jobs = RACE_ORDER.map((race, i) =>
    createCrab(spec(race, 'male', 'warrior', { crest: 0 })).then((c) => {
      c.root.position.set((i - 2.5) * 2.45, 0, 0);
      c.root.rotation.y = 0.85;
      const r = c as JumperRig;
      r.face.mesh.visible = false;
      // Race identity only: hide the class weapons.
      for (const g of r.gearMeshes) if (g.parent?.name.startsWith('socket:')) g.visible = false;
      scene.add(c.root);
      crabs.push(c);
      label(RACES[race].name, c.root, -0.3);
    }),
  );
  await Promise.all(jobs);
  cam.fov = 26;
  cam.position.set(0, 1.6, 13);
  cam.lookAt(0, 0.6, 0);
  engine.setView(scene, cam, { bloom: { intensity: 0 }, vignette: null });
  for (const l of labels) l.el.style.color = '#222';
  for (const l of labels) l.el.style.textShadow = 'none';
  ready();
}

async function enemies(): Promise<void> {
  studio({ floor: 0xb9ad98, bg: 0x1a120c, fog: [14, 45] });
  const human = await createCrab(spec('human'));
  human.root.position.set(-3.2, 0, 1.2);
  scene.add(human.root);
  crabs.push(human);
  label('Human (scale)', human.root, -0.3);
  const s1 = await createEnemyCrab('scrapling');
  s1.root.position.set(-1.6, 0, 1.6);
  const s2 = await createEnemyCrab('scrapling');
  s2.root.position.set(-0.8, 0, 2.3);
  s2.root.rotation.y = -0.4;
  const sc = await createEnemyCrab('scavenger');
  sc.root.position.set(0.6, 0, 1.4);
  sc.root.rotation.y = -0.3;
  const boss = await createEnemyCrab('corrodius');
  boss.root.position.set(4.6, 0, -2.5);
  boss.root.rotation.y = -0.45;
  for (const c of [s1, s2, sc, boss]) {
    scene.add(c.root);
    crabs.push(c);
  }
  label('Scrapling', s1.root, -0.25);
  label('Rustclaw Scavenger', sc.root, -0.3);
  label('Corrodius, the Rust Tyrant', boss.root, -0.4);
  cam.fov = 34;
  cam.position.set(-1.5, 3.6, 11);
  controls = new OrbitControls(cam, engine.canvas);
  controls.target.set(0.8, 1.2, 0);
  controls.update();
  engine.setView(scene, cam, { bloom: { intensity: 1.1, threshold: 0.85 } });
  ready();
}

const EXPRESSIONS: Expression[] = ['neutral', 'blink', 'happy', 'angry', 'hurt', 'dead', 'love', 'sleepy', 'surprised', 'focused', 'talk'];

async function faces(): Promise<void> {
  scene.background = new THREE.Color(0x0e0b09);
  scene.add(new THREE.HemisphereLight(0xffe9d0, 0x3a2a20, 0.6));
  const key = new THREE.DirectionalLight(0xffe0b5, 1.6);
  key.position.set(-2, 4, 6);
  scene.add(key);
  const female = params.has('female');
  const race = (params.get('race') ?? 'human') as RaceId;
  const cols = 4;
  const list: Expression[] = [...EXPRESSIONS, 'neutral'];
  const jobs = list.map((e, i) =>
    createCrab(spec(race, i === list.length - 1 || female ? 'female' : 'male', 'mage', { crest: 2 })).then((c) => {
      const r = c as JumperRig;
      for (const g of r.gearMeshes) g.visible = false;
      const x = (i % cols) - (cols - 1) / 2;
      const row = Math.floor(i / cols);
      c.root.position.set(x * 2.5, row * 0.62, -row * 2.4);
      c.face.setExpression(e);
      scene.add(c.root);
      crabs.push(c);
      label(i === list.length - 1 ? 'female (neutral)' : e, r.getSocket('face'), -0.2);
    }),
  );
  await Promise.all(jobs);
  cam.fov = 24;
  cam.position.set(0, 2.6, 10.5);
  cam.lookAt(0, 1.05, -2.4);
  engine.setView(scene, cam, { bloom: { intensity: 0.9, threshold: 0.9 }, vignette: null });
  ready();
}

async function faceClose(): Promise<void> {
  studio({ floor: 0xd6d0c6, bg: 0x1e140d });
  const race = (params.get('race') ?? 'human') as RaceId;
  const c = (await createCrab(spec(race, params.has('female') ? 'female' : 'male', 'mage', { crest: Number(params.get('crest') ?? 2), led: Number(params.get('led') ?? 0) }))) as JumperRig;
  for (const g of c.gearMeshes) if (g.parent?.name.startsWith('socket:')) g.visible = false;
  scene.add(c.root);
  crabs.push(c);
  window.__crab = c;
  const e = (params.get('expr') ?? 'neutral') as Expression;
  c.face.setExpression(e);
  c.root.updateMatrixWorld(true);
  const f = c.getSocket('face').getWorldPosition(new THREE.Vector3());
  cam.fov = 18;
  cam.position.set(f.x + 0.25, f.y + 0.32, f.z + 2.1);
  cam.lookAt(f.x, f.y - 0.02, f.z);
  engine.setView(scene, cam, { bloom: { intensity: 0.9, threshold: 0.9 } });
  ready();
}

async function perf(): Promise<void> {
  studio({ floor: 0xbdb39f, bg: 0x241a12, fog: [20, 60] });
  const n = Number(params.get('n') ?? 25);
  const motions: ReturnType<typeof createMotionController>[] = [];
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const race = RACE_ORDER[i % 6];
    jobs.push(
      createCrab(spec(race, i % 2 ? 'female' : 'male', CLASS_ORDER[i % 3], { shell: i % 4, crest: i % 4, led: i % 3 })).then((c) => {
        const a = (i / n) * Math.PI * 2;
        c.root.position.set(Math.cos(a) * 6, 0, Math.sin(a) * 6);
        c.root.userData.a = a;
        scene.add(c.root);
        crabs.push(c);
        motions.push(createMotionController(c));
      }),
    );
  }
  await Promise.all(jobs);
  cam.position.set(0, 9, 16);
  controls = new OrbitControls(cam, engine.canvas);
  controls.target.set(0, 0.5, 0);
  controls.update();
  engine.setView(scene, cam, {});
  engine.onFrame(({ dt }) => {
    crabs.forEach((c, i) => {
      const a = (c.root.userData.a += dt * 0.12);
      c.root.position.set(Math.cos(a) * 6, 0, Math.sin(a) * 6);
      c.root.rotation.y = -a;
      motions[i]?.setLocomotion(2, 0, 0);
      motions[i]?.update(dt);
      c.body.position.y = (c.body.position.y - 0.55) + RACES[c.spec.race].posture.scale * 0.597;
    });
  });
  ready();
}

async function fk(): Promise<void> {
  studio({});
  const fixture = (await (await fetch(new URL('./fixtures/crab-fk.json', import.meta.url))).json()) as {
    joints: string[];
    bodies: string[];
    poses: { q: number[]; xpos: Record<string, number[]> }[];
  };
  const crab = (await createCrab(spec('human'))) as JumperRig;
  scene.add(crab.root);
  // Compare in robot metres: undo the rig's scale and body height.
  let worst = 0;
  let where = '';
  const inv = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const [pi, pose] of fixture.poses.entries()) {
    crab.setPose(pose.q);
    crab.root.updateMatrixWorld(true);
    inv.copy(crab.linkNode('base_link').matrixWorld).invert();
    for (const b of fixture.bodies) {
      p.setFromMatrixPosition(crab.linkNode(b).matrixWorld).applyMatrix4(inv);
      const e = p.distanceTo(new THREE.Vector3().fromArray(pose.xpos[b]));
      if (e > worst) {
        worst = e;
        where = `pose ${pi} ${b}`;
      }
    }
  }
  const result = { poses: fixture.poses.length, bodies: fixture.bodies.length, maxErrorMm: worst * 1000, where, pass: worst < 1e-3 };
  window.__fk = result;
  stats.textContent = `FK browser check\n${JSON.stringify(result, null, 1)}`;
  console.warn(`FK_RESULT ${JSON.stringify(result)}`);
  crab.setPose(HOME_POSE);
  cam.position.set(1.5, 1.5, 4);
  cam.lookAt(0, 0.5, 0);
  engine.setView(scene, cam, {});
  ready();
}

// ------------------------------------------------------------------------------------------
// Controls panel: cycle race / sex / class / shell / crest / led / expression.
function buildPanel(crab: JumperRig): void {
  const s: CrabSpec = { ...crab.spec };
  let ei = 0;
  const rows: [string, () => string, (d: number) => void][] = [
    ['Race', () => RACES[s.race].name, (d) => { s.race = RACE_ORDER[(RACE_ORDER.indexOf(s.race) + d + 6) % 6]; s.shell = s.crest = s.led = 0; }],
    ['Sex', () => s.sex, () => { s.sex = s.sex === 'male' ? 'female' : 'male'; }],
    ['Class', () => s.classId, (d) => { s.classId = CLASS_ORDER[(CLASS_ORDER.indexOf(s.classId) + d + 3) % 3]; }],
    ['Shell', () => RACES[s.race].shellColors[s.shell].name, (d) => { s.shell = (s.shell + d + 4) % 4; }],
    ['Crest', () => RACES[s.race].crestStyles[s.crest].name, (d) => { s.crest = (s.crest + d + 4) % 4; }],
    ['LED', () => RACES[s.race].ledColors[s.led].name, (d) => { s.led = (s.led + d + 3) % 3; }],
    ['Expression', () => EXPRESSIONS[ei], (d) => { ei = (ei + d + EXPRESSIONS.length) % EXPRESSIONS.length; crab.face.setExpression(EXPRESSIONS[ei]); }],
  ];
  panel.innerHTML = '';
  const vals: HTMLSpanElement[] = [];
  rows.forEach(([name, get, step], i) => {
    const l = document.createElement('span');
    l.textContent = name;
    const box = document.createElement('span');
    const prev = document.createElement('button');
    prev.textContent = '<';
    const next = document.createElement('button');
    next.textContent = '>';
    const val = document.createElement('span');
    val.className = 'v';
    val.textContent = get();
    vals.push(val);
    const go = async (d: number) => {
      step(d);
      if (i < 6) await crab.applySpec({ ...s });
      rows.forEach(([, g], k) => (vals[k].textContent = g()));
    };
    prev.onclick = () => void go(-1);
    next.onclick = () => void go(1);
    box.append(prev, ' ', val, ' ', next);
    panel.append(l, box);
  });
  const spin = document.createElement('label');
  spin.innerHTML = '<input type="checkbox" id="spin"> turntable';
  panel.append(spin, document.createElement('span'));
}

(window as unknown as Record<string, unknown>).__applySpec = async (s: Partial<CrabSpec>) => {
  const c = window.__crab as JumperRig;
  await c.applySpec({ ...c.spec, ...s });
};
(window as unknown as Record<string, unknown>).__expr = (e: Expression) => (window.__crab as JumperRig).face.setExpression(e);

const views: Record<string, () => Promise<void>> = { hero, lineup, race: raceSheet, face: faceClose, silhouette: silhouettes, enemies, faces, perf, fk };
await (views[view] ?? hero)();

engine.onFrame(({ dt }) => {
  const spin = document.getElementById('spin') as HTMLInputElement | null;
  if (spin?.checked && crabs[0]) crabs[0].root.rotation.y += dt * 0.5;
  for (const c of crabs) c.update(dt);
  controls?.update();
  updateLabels();
  if (view !== 'fk') {
    const info = engine.renderer.info;
    stats.textContent = `${view}  ${engine.fps.toFixed(0)} fps\ncalls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\ncrabs ${crabs.length}  joints ${JOINT_NAMES.length}`;
  }
});
engine.start();
if (silhouette) document.body.style.background = '#f4efe6';
