// Renderer, post-processing and the frame loop. One Engine per page; screens swap the view.
import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';

export type Quality = 'low' | 'high';

export interface FrameInfo {
  /** Seconds since the last frame, clamped to 0.1. */
  dt: number;
  /** Seconds since the engine started. */
  elapsed: number;
}

export interface ViewOptions {
  /** Bloom picks up LEDs, lamps, spell effects. Threshold is in linear HDR luminance. */
  bloom?: { intensity?: number; threshold?: number; smoothing?: number; radius?: number };
  /** Shallow depth of field (character creation, cinematics). Distances in world units. */
  dof?: { focusDistance: number; focusRange: number; bokehScale?: number } | null;
  exposure?: number;
  vignette?: { offset?: number; darkness?: number } | null;
  saturation?: number;
  contrast?: number;
}

type Updater = (f: FrameInfo) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: Quality;
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  private composer: EffectComposer;
  private updaters = new Set<Updater>();
  private afterUpdaters = new Set<Updater>();
  private timer = new THREE.Timer();
  private running = false;
  private elapsed = 0;
  private dof: DepthOfFieldEffect | null = null;
  private viewOpts: ViewOptions = {};
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Smoothed frames per second, updated twice a second. */
  fps = 0;

  constructor(container: HTMLElement, quality: Quality = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // the ToneMappingEffect does it
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cc-canvas';
    container.appendChild(this.canvas);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.setView(this.scene, this.camera);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /** Point the renderer at a scene and camera and rebuild the effect chain for it. */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: ViewOptions = {}): void {
    this.scene = scene;
    this.camera = camera;
    this.viewOpts = opts;
    this.composer.removeAllPasses();
    this.composer.addPass(new RenderPass(scene, camera));

    const effects: Effect[] = [];
    if (opts.dof) {
      this.dof = new DepthOfFieldEffect(camera, {
        worldFocusDistance: opts.dof.focusDistance,
        worldFocusRange: opts.dof.focusRange,
        bokehScale: opts.dof.bokehScale ?? 2.5,
        resolutionScale: this.quality === 'high' ? 0.75 : 0.5,
      });
      effects.push(this.dof);
    } else {
      this.dof = null;
    }
    const b = opts.bloom ?? {};
    effects.push(
      new BloomEffect({
        intensity: b.intensity ?? 1.1,
        luminanceThreshold: b.threshold ?? 0.85,
        luminanceSmoothing: b.smoothing ?? 0.25,
        mipmapBlur: true,
        radius: b.radius ?? 0.72,
      }),
    );
    if (opts.saturation !== undefined) effects.push(new HueSaturationEffect({ saturation: opts.saturation }));
    if (opts.contrast !== undefined) effects.push(new BrightnessContrastEffect({ contrast: opts.contrast }));
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    effects.push(tone);
    if (opts.vignette !== null) {
      effects.push(
        new VignetteEffect({ offset: opts.vignette?.offset ?? 0.32, darkness: opts.vignette?.darkness ?? 0.55 }),
      );
    }
    this.renderer.toneMappingExposure = opts.exposure ?? 1.0;
    this.composer.addPass(new EffectPass(camera, ...effects));
    // SMAA after tone mapping so edges are judged on display values.
    this.composer.addPass(
      new EffectPass(camera, new SMAAEffect({ preset: this.quality === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })),
    );
    this.resize();
  }

  /** Move the focus plane, e.g. to follow the crab on the character creation dais. */
  setFocus(distance: number, range?: number): void {
    if (!this.dof) return;
    this.dof.cocMaterial.worldFocusDistance = distance;
    if (range !== undefined) this.dof.cocMaterial.worldFocusRange = range;
  }

  get viewOptions(): Readonly<ViewOptions> {
    return this.viewOpts;
  }

  /** Register a per-frame callback. Returns a function that removes it. */
  onFrame(fn: Updater): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /** Runs after the frame is rendered (input reset, stats). */
  onAfterFrame(fn: Updater): () => void {
    this.afterUpdaters.add(fn);
    return () => this.afterUpdaters.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop(this.frame);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.setView(this.scene, this.camera, this.viewOpts);
  }

  readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private readonly frame = (): void => {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    const info: FrameInfo = { dt, elapsed: this.elapsed };
    for (const fn of this.updaters) fn(info);
    this.renderer.info.reset();
    this.composer.render(dt);
    for (const fn of this.afterUpdaters) fn(info);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  };

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}
