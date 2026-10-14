// 3D stage of the character creation screen: painted backdrop, flagstone plaza, carved dais,
// golden-hour product lighting, dust motes and the player's crab on a turntable.
import * as THREE from 'three';
import type { Engine, ViewOptions } from '../../core/engine';
import { createCrab } from '../../crab/provider';
import type { CrabRig, CrabSpec, Expression } from '../../crab/types';
import { CRAB_HEIGHT } from '../../crab/types';
import { createMotionController } from '../../motion/provider';
import { skillPlayOptions } from '../../motion/skills';
import type { MotionController, MotionId } from '../../motion/types';
import { createBackdrop, type Backdrop } from './backdrop';
import { createDais, DAIS_TOP, RUNE_RING_RADIUS, type Dais } from './dais';
import { createStudioEnvironment } from './env';
import { createGround, type Ground } from './ground';
import { createBurst, createMotes, type Burst, type Motes } from './particles';
import { makeCanvas, radialSprite } from './textures';

export const DEFAULT_YAW = -0.42;
const CAM_FOV = 24;
const CAM_POS = new THREE.Vector3(0, 2.15, 8.3);
const CAM_TARGET = new THREE.Vector3(0, 0.95, 0);
const DROP_HEIGHT = 3.4;
const FOCUS_LEAD = 2.0;
const GRAVITY = 17;

export type Reaction = 'race' | 'class' | 'sex' | 'shell' | 'crest' | 'led' | 'random' | 'accept';

export const VIEW: ViewOptions = {
  dof: { focusDistance: 3.6, focusRange: 15, bokehScale: 1.9 },
  bloom: { intensity: 0.85, threshold: 0.82, smoothing: 0.3, radius: 0.72 },
  vignette: { offset: 0.26, darkness: 0.62 },
  exposure: 0.95,
  // No saturation/contrast here: the engine applies them to HDR colour before tone mapping,
  // where they push saturated highlights negative and AgX turns those pixels black.
};

interface Timed {
  at: number;
  fn: () => void;
}

export class CreateStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  rig!: CrabRig;
  motion!: MotionController;
  /** Turntable yaw in radians; the arrows, keys and dragging change it. */
  yaw = DEFAULT_YAW;
  /** -1..1 from held arrow buttons or arrow keys. */
  spinInput = 0;
  /** Fired once when the crab touches down on the dais. */
  onLanded: (() => void) | null = null;

  private turntable = new THREE.Group();
  private yawVel = 0;
  private dragging = false;
  private dragVel = 0;
  private time = 0;
  private dropT = -1;
  private dropDelay = 0;
  private landed = false;
  private squashT = 99;
  private shakeT = 99;
  private pushT = 0;
  private timeline: Timed[] = [];
  private faceUntil = 0;
  private nextBlink = 3;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private dais!: Dais;
  private ground!: Ground;
  private backdrop!: Backdrop;
  private motes!: Motes;
  private dust!: Burst;
  private sparks!: Burst;
  private contact!: THREE.Mesh;
  private underGlow!: THREE.DirectionalLight;
  private shafts: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private pendingSpec: CrabSpec | null = null;
  private applying = false;
  private disposed = false;
  private viewOffset = { x: 0, y: 0 };
  private sway = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private look = 0;
  private lookTarget = 0;
  private lookNext = 4;
  private focusTarget = new THREE.Vector3();

  constructor(private readonly engine: Engine) {}

  async init(spec: CrabSpec): Promise<void> {
    const { scene, camera } = this;
    scene.background = new THREE.Color(0x120d0a);
    this.envRT = createStudioEnvironment(this.engine.renderer);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.85;
    scene.fog = null;

    camera.position.copy(CAM_POS);
    camera.lookAt(CAM_TARGET);
    scene.add(camera);

    // Painting behind everything, attached to the camera so it always fills the frame.
    this.backdrop = await createBackdrop();
    camera.add(this.backdrop.mesh);

    this.ground = createGround(9);
    scene.add(this.ground.mesh);

    this.dais = createDais();
    scene.add(this.dais.group);
    // Give the set pieces the env map explicitly: materials that fall back to scene.environment
    // ignore their own envMapIntensity, and the stone needs far less ambient than the glossy crab
    // or its shadow washes out.
    for (const root of [this.dais.group, this.ground.mesh]) {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) m.envMap = this.envRT!.texture;
      });
    }

    this.addLights();
    this.addShafts();

    this.motes = createMotes();
    scene.add(this.motes.points);
    this.dust = createBurst('dust', 80);
    this.sparks = createBurst('spark', 160);
    scene.add(this.dust.points, this.sparks.points);

    // Soft contact shadow under the crab: grounds it even where the shadow map is thin.
    const blob = radialSprite(128, 0, [[0, 1], [0.35, 0.7], [0.7, 0.2], [1, 0]]);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blob, transparent: true, opacity: 0.55, depthWrite: false });
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    this.contact = new THREE.Mesh(blobGeo, blobMat);
    this.contact.position.y = DAIS_TOP + 0.004;
    this.contact.renderOrder = 1;
    scene.add(this.contact);
    this.disposables.push(blob, blobMat, blobGeo);

    this.turntable.position.y = DAIS_TOP;
    scene.add(this.turntable);
    this.rig = await createCrab(spec);
    this.rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.turntable.add(this.rig.root);
    this.motion = createMotionController(this.rig);
    this.motion.setLocomotion(0, 0, 0);
    // Hidden above the frame until the entrance drop.
    this.turntable.visible = false;
    this.turntable.rotation.y = this.yaw;
  }

  /** Start the entrance: the crab falls onto the dais after `delay` seconds. */
  startEntrance(delay: number): void {
    this.dropDelay = delay;
    this.dropT = 0;
    this.pushT = 0;
    this.turntable.position.y = DAIS_TOP + DROP_HEIGHT;
  }

  /** Skip the entrance (reduced motion). */
  placeNow(): void {
    this.dropT = -1;
    this.turntable.visible = true;
    this.turntable.position.y = DAIS_TOP;
    this.landed = true;
    this.pushT = 10;
  }

  get hasLanded(): boolean {
    return this.landed;
  }

  /** Re-skin the crab in place and play the matching reaction. */
  apply(spec: CrabSpec, reaction: Reaction | null): void {
    this.pendingSpec = { ...spec };
    if (!this.applying) void this.flushSpec();
    if (reaction && this.landed) this.react(reaction, spec);
  }

  /** applySpec may be async (gear models load); apply only the latest spec, one at a time. */
  private async flushSpec(): Promise<void> {
    this.applying = true;
    while (this.pendingSpec && !this.disposed) {
      const next = this.pendingSpec;
      this.pendingSpec = null;
      try {
        await this.rig.applySpec(next);
      } catch (err) {
        console.warn('applySpec failed', err);
      }
      // New gear meshes cast shadows too.
      this.rig.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
    }
    this.applying = false;
  }

  react(kind: Reaction, spec: CrabSpec): void {
    const now = this.time;
    switch (kind) {
      case 'race':
      case 'random':
        this.play('gesture_hello');
        this.expression('happy', 2.0);
        this.dais.flare(1.0);
        this.sparks.sparkle(DAIS_TOP, RUNE_RING_RADIUS);
        break;
      case 'class':
        this.play(spec.classId === 'warrior' ? 'attack_swipe' : 'cast');
        this.expression('focused', 1.5);
        this.dais.flare(0.8);
        if (spec.classId !== 'warrior') this.sparks.sparkle(DAIS_TOP, RUNE_RING_RADIUS * 0.6);
        break;
      case 'led':
        this.dais.flare(0.35);
        this.at(now, () => this.rig.face.setExpression('blink', 0.08));
        this.at(now + 0.09, () => this.rig.face.setExpression('neutral'));
        this.at(now + 0.2, () => this.rig.face.setExpression('blink', 0.08));
        this.at(now + 0.29, () => this.rig.face.setExpression('neutral'));
        this.faceUntil = now + 0.4;
        this.nextBlink = now + 3 + Math.random() * 2;
        break;
      case 'sex':
        this.expression('happy', 0.9);
        this.dais.flare(0.4);
        break;
      case 'crest':
        this.dais.flare(0.5);
        this.sparks.sparkle(DAIS_TOP, RUNE_RING_RADIUS * 0.45);
        break;
      case 'shell':
        this.dais.flare(0.4);
        break;
      case 'accept':
        this.play('gesture_salute');
        this.expression('happy', 2.5);
        this.dais.flare(1.4);
        this.sparks.sparkle(DAIS_TOP, RUNE_RING_RADIUS);
        break;
    }
  }

  private play(id: MotionId): void {
    // A skill clip plays its move (the class pick shows the whole swipe or cast), not the rollout.
    this.motion.play(id, skillPlayOptions(id, { fade: 0.2 }));
  }

  private expression(e: Expression, hold: number): void {
    this.rig.face.setExpression(e, hold);
    this.faceUntil = this.time + hold;
    this.at(this.time + hold, () => {
      if (this.time >= this.faceUntil - 1e-3) this.rig.face.setExpression('neutral');
    });
  }

  private at(t: number, fn: () => void): void {
    this.timeline.push({ at: t, fn });
  }

  // ---------------------------------------------------------------------------------------
  // Rotation input
  // ---------------------------------------------------------------------------------------

  beginDrag(): void {
    this.dragging = true;
    this.yawVel = 0;
    this.dragVel = 0;
  }

  drag(dxPixels: number, dt: number): void {
    const d = dxPixels * 0.0085;
    this.yaw += d;
    if (dt > 0) this.dragVel = this.dragVel * 0.6 + (d / dt) * 0.4;
  }

  endDrag(): void {
    this.dragging = false;
    this.yawVel = THREE.MathUtils.clamp(this.dragVel, -6, 6);
  }

  /** Pointer position in -1..1 (x right, y down) for a gentle parallax on the camera. */
  setPointer(nx: number, ny: number): void {
    this.pointer.set(THREE.MathUtils.clamp(nx, -1, 1), THREE.MathUtils.clamp(ny, -1, 1));
  }

  // ---------------------------------------------------------------------------------------
  // Framing
  // ---------------------------------------------------------------------------------------

  /** Place the crab's screen position at (cx, cy) CSS pixels of a w x h viewport. */
  frame(w: number, h: number, cx: number, cy: number): void {
    this.viewOffset.x = w / 2 - cx;
    this.viewOffset.y = h / 2 - cy;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, this.viewOffset.x, this.viewOffset.y, w, h);
    this.camera.updateProjectionMatrix();
    this.backdrop.fit(this.camera, (Math.abs(this.viewOffset.x) * 2) / w + 0.1);
    const size = this.engine.renderer.getDrawingBufferSize(new THREE.Vector2());
    const pxPerUnit = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2)));
    this.motes.setScale(pxPerUnit);
    this.dust.setScale(pxPerUnit);
    this.sparks.setScale(pxPerUnit);
  }

  // ---------------------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------------------

  update(dt: number, elapsed: number): void {
    this.time += dt;
    const now = this.time;

    // Timeline.
    if (this.timeline.length) {
      const due = this.timeline.filter((e) => e.at <= now);
      this.timeline = this.timeline.filter((e) => e.at > now);
      for (const e of due) e.fn();
    }

    // Turntable.
    if (!this.dragging) {
      if (this.spinInput !== 0) {
        const target = this.spinInput * 2.0;
        this.yawVel += (target - this.yawVel) * Math.min(1, dt * 8);
      } else {
        this.yawVel *= Math.exp(-dt * 4.5);
        if (Math.abs(this.yawVel) < 0.002) this.yawVel = 0;
      }
      this.yaw += this.yawVel * dt;
    }
    this.turntable.rotation.y = this.yaw;

    // Entrance drop with a squash on landing.
    if (this.dropT >= 0) {
      this.dropT += dt;
      const t = this.dropT - this.dropDelay;
      if (t > 0) {
        this.turntable.visible = true;
        const y = DROP_HEIGHT - 0.5 * GRAVITY * t * t;
        if (y <= 0) {
          this.turntable.position.y = DAIS_TOP;
          this.dropT = -1;
          this.land();
        } else {
          this.turntable.position.y = DAIS_TOP + y;
        }
      }
    }
    this.squashT += dt;
    const sq = 0.16 * Math.exp(-this.squashT * 7) * Math.cos(this.squashT * 19);
    this.turntable.scale.set(1 + sq * 0.45, 1 - sq, 1 + sq * 0.45);

    // Contact shadow follows the crab's height and race scale.
    const hAbove = this.turntable.position.y - DAIS_TOP;
    const scale = this.rig.root.scale.x;
    const s = (1.6 + hAbove * 0.5) * scale;
    this.contact.scale.set(s * 1.1, 1, s * 0.85);
    (this.contact.material as THREE.MeshBasicMaterial).opacity = this.turntable.visible ? 0.72 / (1 + hAbove * 1.5) : 0;

    // Crab: idle unless an action is playing; occasional blink.
    this.motion.setLocomotion(0, 0, 0);
    if (this.landed && now > this.faceUntil && now > this.nextBlink) {
      this.rig.face.setExpression('blink', 0.11);
      this.at(now + 0.11, () => {
        if (this.time >= this.faceUntil) this.rig.face.setExpression('neutral');
      });
      this.nextBlink = now + 2.5 + Math.random() * 4;
    }
    // Idle: now and then the crab glances a little to one side, then back to the camera.
    if (this.motion.action || now < this.faceUntil) this.lookTarget = 0;
    else if (now > this.lookNext) {
      this.lookTarget = this.lookTarget === 0 ? (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.12) : 0;
      this.lookNext = now + (this.lookTarget === 0 ? 4 + Math.random() * 4 : 1.6 + Math.random() * 1.4);
    }
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * 2.2);
    this.rig.root.rotation.y = this.look;
    this.motion.update(dt);
    this.rig.update(dt);

    // Dais, lights, particles.
    this.dais.update(dt, elapsed);
    this.underGlow.intensity = 0.25 + 0.65 * this.dais.glow;
    this.motes.update(elapsed);
    this.dust.update(dt);
    this.sparks.update(dt);
    this.shafts.forEach((m, i) => {
      (m.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.035 * Math.sin(elapsed * 0.35 + i * 2.1);
    });

    // Camera: slow push-in on entrance, breathing sway, a jolt on landing.
    this.pushT += dt;
    const push = 1 + 0.14 * Math.pow(1 - Math.min(1, this.pushT / 2.6), 3);
    this.pointerSmooth.lerp(this.pointer, Math.min(1, dt * 2.5));
    this.sway.set(
      Math.sin(elapsed * 0.23) * 0.07 + this.pointerSmooth.x * 0.16,
      Math.sin(elapsed * 0.31 + 1.3) * 0.035 - this.pointerSmooth.y * 0.07,
      Math.sin(elapsed * 0.17) * 0.05,
    );
    this.shakeT += dt;
    const shake = 0.035 * Math.exp(-this.shakeT * 9);
    const cam = this.camera;
    cam.position.copy(CAM_POS).sub(CAM_TARGET).multiplyScalar(push).add(CAM_TARGET).add(this.sway);
    cam.position.y += Math.sin(this.shakeT * 55) * shake;
    cam.lookAt(CAM_TARGET.x + this.sway.x * 0.4, CAM_TARGET.y, CAM_TARGET.z);
    this.focusTarget.set(0, DAIS_TOP + CRAB_HEIGHT * 0.5 * scale, 0);
    // The focus plane sits just in front of the crab: the whole crab falls in the gentle start of
    // the far-field ramp (sharp), the painting at the end of it (soft), and nothing visible is in
    // the near field, whose dilation leaves dark fringes on glossy edges.
    this.engine.setFocus(cam.position.distanceTo(this.focusTarget) - FOCUS_LEAD);
  }

  private land(): void {
    this.landed = true;
    this.squashT = 0;
    this.shakeT = 0;
    this.dust.puff(0, DAIS_TOP, 0, 0.75 * this.rig.root.scale.x);
    this.dais.flare(1.2);
    this.nextBlink = this.time + 2;
    this.onLanded?.();
  }

  // ---------------------------------------------------------------------------------------
  // Scene pieces
  // ---------------------------------------------------------------------------------------

  private addLights(): void {
    const { scene } = this;
    // Warm golden-hour key from the front left, casting soft shadows across the dais.
    const key = new THREE.DirectionalLight(0xffbf80, 3.0);
    key.position.set(-5.6, 5.6, 2.8);
    key.target.position.set(0, 0.4, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -2.8;
    sc.right = 2.8;
    sc.top = 2.8;
    sc.bottom = -2.8;
    sc.near = 2;
    sc.far = 18;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 5;
    scene.add(key, key.target);

    // Cool rim from behind right: the edge highlight that separates the shell from the painting.
    const rim = new THREE.DirectionalLight(0x9ec4ff, 3.0);
    rim.position.set(4.5, 3.6, -5.5);
    scene.add(rim);
    // Warm kicker from behind left, low: the setting sun grazing the shell.
    const kick = new THREE.DirectionalLight(0xffa860, 1.6);
    kick.position.set(-5, 1.6, -4.5);
    scene.add(kick);
    // Sky fill.
    const hemi = new THREE.HemisphereLight(0x8a98c8, 0x3a2a20, 0.3);
    scene.add(hemi);
    // The runes light the crab from below. A directional light, not a point light: a point light
    // this close to the legs produces HDR values the depth of field pass turns into black holes.
    this.underGlow = new THREE.DirectionalLight(0xffa640, 0.6);
    this.underGlow.position.set(0, -2, 1.2);
    this.underGlow.target.position.set(0, 0.6, 0);
    scene.add(this.underGlow, this.underGlow.target);
  }

  private addShafts(): void {
    const c = makeCanvas(64, 256);
    const ctx = c.getContext('2d')!;
    const gx = ctx.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const gy = ctx.createLinearGradient(0, 0, 0, 256);
    gy.addColorStop(0, 'rgba(0,0,0,0.0)');
    gy.addColorStop(0.25, 'rgba(0,0,0,1)');
    gy.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gy;
    ctx.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.disposables.push(tex, geo);
    const specs = [
      { x: -2.2, z: -3.2, w: 1.1, h: 9, rot: -0.52 },
      { x: -0.6, z: -4.4, w: 0.7, h: 9, rot: -0.5 },
      { x: 1.4, z: -5.4, w: 1.5, h: 10, rot: -0.48 },
    ];
    for (const s of specs) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(1.0, 0.78, 0.5),
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(s.w, s.h, 1);
      m.position.set(s.x, 2.6, s.z);
      m.rotation.z = s.rot;
      m.renderOrder = 4;
      this.scene.add(m);
      this.shafts.push(m);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.motion?.dispose();
    this.rig?.dispose();
    this.dais?.dispose();
    this.ground?.dispose();
    this.backdrop?.dispose();
    this.motes?.dispose();
    this.dust?.dispose();
    this.sparks?.dispose();
    for (const d of this.disposables) d.dispose();
    this.envRT?.dispose();
    this.scene.clear();
  }
}
