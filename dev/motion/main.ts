// Motion harness: every clip on a stand-in Jumper, locomotion on WASD, crossfades, layers,
// scrubbing and event markers. URL parameters make screenshots reproducible:
//   ?clip=jump&t=1.19&pause=1   play a clip, jump to a time and freeze
//   ?walk=0,0.25,0              constant locomotion command (m/s left, m/s forward, rad/s)
//   ?warm=2.3                   simulate this many seconds before the first shot
//   ?layer=cast                 walk forward with an upper-body clip on top
//   ?cam=150,18,3.2             orbit camera: azimuth deg, elevation deg, distance
//   ?hideui=1  ?fk=1 (FK check against tools/motion/fk_check.py output)
import * as THREE from 'three';
import '../../src/ui/kit.css';
import { Engine } from '../../src/core/engine';
import { Input } from '../../src/core/input';
import { createMotionController, getMotionLibrary, type ClipIndexEntry } from '../../src/motion';
import type { MotionId } from '../../src/motion/types';
import { createViewerRig, type ViewerRig } from './viewerRig';

declare global {
  interface Window {
    __ready?: boolean;
    __fk?: unknown;
    __motion?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
if (params.get('hideui') === '1') document.body.classList.add('hideui');

const engine = new Engine(document.getElementById('app')!, 'high');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8cf);
scene.fog = new THREE.Fog(0x9fb8cf, 30, 90);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 300);
engine.setView(scene, camera, { bloom: { intensity: 0.4, threshold: 1.2 }, vignette: { darkness: 0.35 } });

// ---------------------------------------------------------------- stage
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6b5a44, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
sun.position.set(4, 8, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -4;
sun.shadow.camera.right = sun.shadow.camera.top = 4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

function checker(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#c9b48e' : '#d8c6a2';
      g.fillRect(x * 128, y * 128, 128, 128);
    }
  g.strokeStyle = 'rgba(90,70,40,.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(100, 100);
  t.anisotropy = 8;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------- crab + motion
const lib = getMotionLibrary();
const rig: ViewerRig = await createViewerRig();
scene.add(rig.root);
const motion = createMotionController(rig, lib);
window.__motion = motion;
await lib.ready;
await lib.preload();

const input = new Input(engine.canvas);
let yaw = 0;
let camAz = num('az', 35) * (Math.PI / 180);
let camEl = num('el', 16) * (Math.PI / 180);
let camDist = num('dist', 4.2);
if (params.has('cam')) {
  const [a, e, d] = params.get('cam')!.split(',').map(Number);
  camAz = (a * Math.PI) / 180;
  camEl = (e * Math.PI) / 180;
  camDist = d;
}
const look = new THREE.Vector3();

// ---------------------------------------------------------------- UI
const ui = document.getElementById('ui')!;
const logEl = document.getElementById('log')!;
const tlTitle = document.getElementById('tl-title')!;
const tlTrack = document.getElementById('tl-track')!;
const tlHead = document.getElementById('tl-head')!;
const events: string[] = [];
function logEvent(s: string) {
  events.unshift(s);
  events.length = Math.min(events.length, 9);
  logEl.textContent = events.join('\n');
}
motion.onLocomotionEvent = (name) => {
  if (name === 'footstep') logEvent(`step  ${engineTime.toFixed(2)}s`);
};

const opts = { fade: 0.2, speed: 1, loop: false, upper: false };
ui.innerHTML = `
  <h1>Motion harness</h1>
  <div class="sub">Jumper policy rollouts (MuJoCo), whole: the game plays the skills' windows</div>
  <h2>Play</h2>
  <div class="row"><label>fade</label><input id="o-fade" type="range" min="0" max="1" step="0.05" value="0.2"><output id="v-fade">0.20</output></div>
  <div class="row"><label>speed</label><input id="o-speed" type="range" min="0.25" max="2" step="0.05" value="1"><output id="v-speed">1.00</output></div>
  <div class="row"><label><input id="o-loop" type="checkbox"> loop</label><label><input id="o-upper" type="checkbox"> claws only</label></div>
  <div class="row"><button id="b-stop">stop</button><button id="b-pause">pause</button><button id="b-layer">walk + cast</button></div>
  <div id="groups"></div>
  <h2>Locomotion</h2>
  <div id="weights"></div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$('o-fade').oninput = (e) => {
  opts.fade = Number((e.target as HTMLInputElement).value);
  $('v-fade').textContent = opts.fade.toFixed(2);
};
$('o-speed').oninput = (e) => {
  opts.speed = Number((e.target as HTMLInputElement).value);
  $('v-speed').textContent = opts.speed.toFixed(2);
};
$('o-loop').onchange = (e) => (opts.loop = (e.target as HTMLInputElement).checked);
$('o-upper').onchange = (e) => (opts.upper = (e.target as HTMLInputElement).checked);
$('b-stop').onclick = () => {
  motion.stop(undefined, opts.fade);
  layerWalk = false;
};
$('b-pause').onclick = () => {
  motion.paused = !motion.paused;
  $('b-pause').textContent = motion.paused ? 'resume' : 'pause';
};
let layerWalk = false;
$('b-layer').onclick = () => startLayer('cast');

function startLayer(id: MotionId) {
  layerWalk = true;
  play(id, { loop: true, upper: true });
}

const groups: Record<string, ClipIndexEntry[]> = {};
for (const c of lib.list()) (groups[c.kind] ??= []).push(c);
const order = ['locomotion', 'jump', 'claw', 'gesture', 'dance', 'skill', 'break'];
const buttons = new Map<string, HTMLButtonElement>();
for (const kind of order) {
  if (!groups[kind]) continue;
  const h = document.createElement('h2');
  h.textContent = kind === 'skill' ? 'skills (jumper.skill_*)' : kind === 'break' ? 'breakdance (jumper.break_* and the power moves)' : kind;
  $('groups').appendChild(h);
  const box = document.createElement('div');
  box.className = 'clips';
  for (const c of groups[kind].sort((a, b) => a.id.localeCompare(b.id))) {
    const b = document.createElement('button');
    b.innerHTML = `${c.id}<span class="src">${c.duration.toFixed(1)}s</span>`;
    b.title = `${c.source}, ${c.frameCount} frames @ ${c.fps.toFixed(1)} fps, ${(c.bytes / 1024).toFixed(1)} KB`;
    b.onclick = () => {
      if (kind === 'locomotion') {
        const v = c.velocity ?? [0, 0];
        forced = { x: v[0], z: v[1], yaw: c.yawRate ?? 0 };
        return;
      }
      play(c.id as MotionId, {});
    };
    buttons.set(c.id, b);
    box.appendChild(b);
  }
  $('groups').appendChild(box);
}

let current: { id: MotionId; started: number } | null = null;
function play(id: MotionId, o: { loop?: boolean; upper?: boolean }) {
  motion.play(id, {
    fade: opts.fade,
    speed: opts.speed,
    loop: o.loop ?? opts.loop,
    upperBodyOnly: o.upper ?? opts.upper,
    onEvent: (name) => {
      if (!name.startsWith('foot_')) logEvent(`${id}: ${name}`);
    },
    onEnd: () => logEvent(`${id}: end`),
  });
  current = { id, started: engineTime };
  for (const [k, b] of buttons) b.classList.toggle('on', k === id);
  drawTimeline(id);
}

function drawTimeline(id: MotionId) {
  for (const el of [...tlTrack.querySelectorAll('.ev, .ev-label')]) el.remove();
  const clip = lib.get(id);
  if (!clip) {
    lib.load(id).then(() => drawTimeline(id)).catch(() => undefined);
    return;
  }
  tlTitle.textContent = `${id}  (${clip.source}, ${clip.length.toFixed(2)} s, ${clip.frameCount} frames)`;
  const colors: Record<string, string> = { hit: '#ff6a4d', grab: '#ff6a4d', release: '#7fd3ff', beat: 'rgba(255,255,255,.18)', apex: '#ffe17a' };
  const labelled = new Set<string>();
  for (const [name, times] of Object.entries(clip.events)) {
    if (name.startsWith('foot_')) continue;
    for (const t of times) {
      const x = (t / Math.max(1e-6, clip.length)) * 100;
      const el = document.createElement('div');
      el.className = 'ev';
      el.style.left = `${x}%`;
      el.style.background = colors[name] ?? (name === 'footstep' ? 'rgba(170,200,150,.5)' : '#e0b25a');
      el.title = `${name} ${t.toFixed(2)}s`;
      tlTrack.appendChild(el);
      const key = t.toFixed(2);
      if (name !== 'footstep' && name !== 'beat' && !labelled.has(key)) {
        labelled.add(key);
        const lab = document.createElement('div');
        lab.className = 'ev-label';
        lab.style.left = `${x}%`;
        lab.textContent = name;
        tlTrack.appendChild(lab);
      }
    }
  }
}
tlTrack.addEventListener('pointerdown', (e) => {
  if (!current) return;
  const clip = lib.get(current.id);
  if (!clip) return;
  const r = tlTrack.getBoundingClientRect();
  motion.paused = true;
  $('b-pause').textContent = 'resume';
  motion.seek(((e.clientX - r.left) / r.width) * clip.length);
});

// ---------------------------------------------------------------- driving
let forced: { x: number; z: number; yaw: number } | null = null; // m/s, rad/s
if (params.has('walk')) {
  const [x, z, w] = params.get('walk')!.split(',').map(Number);
  forced = { x, z, yaw: w ?? 0 };
}
let engineTime = 0;

function drive(dt: number) {
  const m = rig.metersToUnits;
  let vx = 0;
  let vz = 0;
  let w = 0;
  const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  const side = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
  const turn = (input.isDown('KeyQ') ? 1 : 0) - (input.isDown('KeyE') ? 1 : 0);
  if (fwd || side || turn) forced = null;
  if (forced) {
    vx = forced.x * m;
    vz = forced.z * m;
    w = forced.yaw;
  } else if (layerWalk && !fwd && !side) {
    vz = 0.25 * m;
  } else {
    const s = (run ? 0.6 : 0.26) * m;
    vz = fwd * (fwd < 0 ? 0.21 * m : s);
    vx = side * s;
    if (fwd && side) {
      vx *= Math.SQRT1_2;
      vz *= Math.SQRT1_2;
    }
    w = turn * 1.4;
  }
  motion.setLocomotion(vx, vz, w);
  if (input.wasPressed('Space')) play('jump', { loop: false, upper: false });
  for (const [k, id] of [['Digit1', 'gesture_hello'], ['Digit2', 'gesture_bow'], ['Digit3', 'gesture_paw'], ['Digit4', 'gesture_salute']] as const) {
    if (input.wasPressed(k)) play(id, { loop: false, upper: false });
  }
  if (input.wasPressed('KeyF')) play('cast', { loop: false, upper: true });
  if (input.wasPressed('KeyR')) play('attack_swipe', { loop: false, upper: true });
  // gameplay moves the root at the velocity the clips are actually playing
  if (!motion.paused) {
    const v = motion.velocity;
    yaw += v.yaw * dt;
    rig.root.rotation.y = yaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    rig.root.position.x += (c * v.x + s * v.z) * dt;
    rig.root.position.z += (-s * v.x + c * v.z) * dt;
  }
}

function updateCamera() {
  if (input.isButtonDown(0) || input.isButtonDown(2)) {
    camAz -= input.dx * 0.006;
    camEl = THREE.MathUtils.clamp(camEl + input.dy * 0.005, -0.2, 1.3);
  }
  if (input.wheel) camDist = THREE.MathUtils.clamp(camDist * (1 + input.wheel * 0.1), 1.2, 20);
  const target = rig.root.position;
  // follow the body up (jumps) but not down (collapses)
  const by = Math.max(0.55, rig.body.position.y * 0.8);
  look.lerp(new THREE.Vector3(target.x, by, target.z), look.lengthSq() ? 0.15 : 1);
  const a = camAz + yaw;
  camera.position.set(
    look.x + Math.sin(a) * Math.cos(camEl) * camDist,
    look.y + Math.sin(camEl) * camDist,
    look.z + Math.cos(a) * Math.cos(camEl) * camDist,
  );
  camera.lookAt(look);
  sun.position.set(target.x + 4, 8, target.z + 3);
  sun.target.position.copy(target);
}

function weightsText() {
  const lines = [...motion.weights].sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k.padEnd(18)} ${w.toFixed(2)}`);
  const v = motion.velocity;
  const m = rig.metersToUnits;
  lines.push('', `v  ${(v.x / m).toFixed(2)} ${(v.z / m).toFixed(2)} m/s  yaw ${v.yaw.toFixed(2)}`, `phase ${motion.gaitPhase.toFixed(2)}  action ${motion.action ?? '-'}`);
  return lines.join('\n');
}

const weightsEl = $('weights');
let uiTick = 0;
engine.onFrame(({ dt }) => {
  engineTime += dt;
  drive(dt);
  motion.update(dt);
  rig.update();
  updateCamera();
  if ((uiTick = (uiTick + 1) % 6) === 0) weightsEl.textContent = weightsText();
  const p = motion.actionProgress;
  tlHead.style.left = `${Math.max(0, p) * 100}%`;
  if (p < 0 && current && engineTime - current.started > 0.5 && !motion.action) {
    tlTitle.textContent = 'no action';
  }
});
engine.onAfterFrame(() => input.endFrame());

// ---------------------------------------------------------------- scripted start (screenshots)
// an action needs its fade-in before a paused shot shows it
const warm = Math.max(num('warm', 0), params.has('t') ? num('fade', 0.2) + 0.1 : 0);
const dtFix = 1 / 60;
if (params.has('layer')) startLayer((params.get('layer') || 'cast') as MotionId);
if (params.has('clip')) {
  const id = params.get('clip') as MotionId;
  await lib.load(id).catch(() => undefined);
  opts.fade = num('fade', 0.2);
  play(id, { loop: params.get('loop') === '1', upper: params.get('upper') === '1' });
}
for (let t = 0; t < warm; t += dtFix) {
  engineTime += dtFix;
  drive(dtFix);
  motion.update(dtFix);
}
if (params.has('t')) {
  motion.update(0);
  motion.seek(num('t', 0));
}
if (params.get('pause') === '1') motion.paused = true;
motion.update(0);
updateCamera();

if (params.get('fk') === '1') {
  const { runFkCheck } = await import('./fkCheck');
  window.__fk = await runFkCheck(rig, lib);
}

if (params.get('selftest') === '1') {
  const { runSelfTest } = await import('./checks');
  await runSelfTest(lib);
}
if (params.get('bench') === '1') {
  const { runBench } = await import('./checks');
  await runBench(lib);
}
if (params.has('slide')) {
  const { runSlide } = await import('./checks');
  for (const spec of params.get('slide')!.split(';')) {
    const cmd = spec.split(',').map(Number) as [number, number, number];
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    runSlide(rig, motion, cmd);
  }
  forced = null;
}

engine.start();
let frames = 0;
engine.onAfterFrame(() => {
  if (++frames === 20) window.__ready = true;
});
