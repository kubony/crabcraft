// Renderer, post-processing and the frame loop. One Engine per page; screens swap the view.
import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

/** Content tier: foliage density, shadow map size, particle counts. */
export type Quality = 'low' | 'high';
/** What the player picks in the settings: a fixed tier, or 'auto' (high tier, dynamic resolution). */
export type QualitySetting = Quality | 'auto';

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
  /**
   * Tone mapping operator. Default: AgX with a saturation look (see AgxLookEffect), which keeps
   * Jumper red the product red instead of AgX's salmon. ACES keeps saturated reds deeper still.
   */
  toneMapping?: ToneMappingMode;
  /** The AgX look when toneMapping is left out. */
  agxLook?: { saturation?: number; power?: number };
}

type Updater = (f: FrameInfo) => void;

const agxLookFrag = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform float lookSaturation;
uniform float lookPower;

// three.js AgXToneMapping with the look step its source leaves out: an ASC CDL power and a
// saturation around luma, applied in AgX's log-encoded display space (Blender's "Punchy" look
// is power 1.35, saturation 1.4).
vec3 agxWithLook(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
  );
  const mat3 AgXOutsetMatrix = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
  );
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color *= toneMappingExposure;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, 0.0), vec3(lookPower));
  color = luma + lookSaturation * (color - luma);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(agxWithLook(inputColor.rgb), inputColor.a);
}
`;

/** AgX tone mapping with a look (saturation and power), see agxLookFrag. */
class AgxLookEffect extends Effect {
  constructor(saturation: number, power: number) {
    super('AgxLookEffect', agxLookFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ['lookSaturation', new THREE.Uniform(saturation)],
        ['lookPower', new THREE.Uniform(power)],
      ]),
    });
  }
}

/** Bloom whose luminance and blur chain run at a fraction of the frame size (high DPI screens). */
class ScaledBloomEffect extends BloomEffect {
  private baseW = 1;
  private baseH = 1;
  scale = 1;

  override setSize(width: number, height: number): void {
    this.baseW = width;
    this.baseH = height;
    super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  setScale(s: number): void {
    if (Math.abs(s - this.scale) < 1e-3) return;
    this.scale = s;
    this.setSize(this.baseW, this.baseH);
  }
}

/** Render pixel ratios dynamic resolution steps through. */
const PR_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
/** Frame time budget: below 55 fps the resolution steps down. */
const SLOW_MS = 1000 / 55;
const FAST_MS = 1000 / 58;
/** Predicted GPU time at the next step must stay under this to step up. */
const GPU_UP_MS = 11.5;
const RES_KEY = 'cc.resScale';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: Quality;
  setting: QualitySetting;
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  private composer: EffectComposer;
  private updaters = new Set<Updater>();
  private afterUpdaters = new Set<Updater>();
  private timer = new THREE.Timer();
  private running = false;
  private elapsed = 0;
  private dof: DepthOfFieldEffect | null = null;
  private bloom: ScaledBloomEffect | null = null;
  private fxPass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private viewOpts: ViewOptions = {};
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Smoothed frames per second, updated twice a second. */
  fps = 0;
  /** Render pixel ratio in use (dynamic in 'auto'). */
  pixelRatio = 1;
  /** Median GPU time of a frame over the last second, ms; -1 when the timer query is unavailable. */
  gpuMs = -1;
  /** Called when dynamic resolution changes the pixel ratio (settings UI, debug readout). */
  onResolutionChange: ((pr: number) => void) | null = null;

  // Dynamic resolution state.
  private autoPr = 1;
  private dtWin: number[] = [];
  private gpuWin: number[] = [];
  private winT = 0;
  private settleUntil = 0;
  private slowWins = 0;
  private fastWins = 0;
  private ceilingPr = 2;
  private lastUpAt = -1e9;
  private upBlockedUntil = 0;
  private saveAt = 0;
  // GPU timer (EXT_disjoint_timer_query_webgl2), only while 'auto' is on.
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private timerQueries: WebGLQuery[] = [];

  constructor(container: HTMLElement, quality: QualitySetting = 'high') {
    this.setting = quality;
    this.quality = quality === 'low' ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // the tone mapping effect does it
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
    this.autoPr = this.initialAutoPr();
    this.ensureTimer();
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
        resolutionScale: this.dofScale(),
      });
      effects.push(this.dof);
    } else {
      this.dof = null;
    }
    const b = opts.bloom ?? {};
    this.bloom = new ScaledBloomEffect({
      intensity: b.intensity ?? 1.1,
      luminanceThreshold: b.threshold ?? 0.85,
      luminanceSmoothing: b.smoothing ?? 0.25,
      mipmapBlur: true,
      radius: b.radius ?? 0.72,
    });
    this.bloom.scale = this.bloomScale();
    effects.push(this.bloom);
    if (opts.toneMapping !== undefined) effects.push(new ToneMappingEffect({ mode: opts.toneMapping }));
    else effects.push(new AgxLookEffect(opts.agxLook?.saturation ?? 1.22, opts.agxLook?.power ?? 1.06));
    // Grading runs on display values after tone mapping; before it, HDR highlights invert.
    if (opts.saturation !== undefined) effects.push(new HueSaturationEffect({ saturation: opts.saturation }));
    if (opts.contrast !== undefined) effects.push(new BrightnessContrastEffect({ contrast: opts.contrast }));
    if (opts.vignette !== null) {
      effects.push(
        new VignetteEffect({ offset: opts.vignette?.offset ?? 0.32, darkness: opts.vignette?.darkness ?? 0.55 }),
      );
    }
    this.renderer.toneMappingExposure = opts.exposure ?? 1.0;
    this.fxPass = new EffectPass(camera, ...effects);
    this.composer.addPass(this.fxPass);
    // SMAA after tone mapping so edges are judged on display values.
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: this.quality === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    this.composer.addPass(this.smaaPass);
    // A fresh chain compiles shaders on its first frames; do not judge the frame rate on them.
    this.settleUntil = this.elapsed + 1.5;
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

  /** Fixed tier, kept for callers that only know 'low' and 'high'. */
  setQuality(q: Quality): void {
    this.setQualitySetting(q);
  }

  /** Switch between 'auto', 'high' and 'low'. Rebuilds the effect chain when the tier changes. */
  setQualitySetting(s: QualitySetting): void {
    if (s === this.setting) return;
    const tier: Quality = s === 'low' ? 'low' : 'high';
    this.setting = s;
    this.resetDynamic();
    this.ensureTimer();
    if (tier !== this.quality) {
      this.quality = tier;
      this.setView(this.scene, this.camera, this.viewOpts);
    } else {
      this.resize();
    }
  }

  /** Highest pixel ratio the current tier allows on this screen. */
  get maxPixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1);
  }

  /** Render resolution as a fraction of the screen's native pixels (0..1). */
  get resolutionFraction(): number {
    return this.pixelRatio / Math.max(1, window.devicePixelRatio || 1);
  }

  readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const max = this.maxPixelRatio;
    if (this.setting === 'auto') this.autoPr = Math.min(this.autoPr, max);
    const pr = this.setting === 'auto' ? this.autoPr : max;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.applyResolutionScales();
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /** Post effects work in screen (CSS) pixels, so a Retina frame does not pay for them four times. */
  private applyResolutionScales(): void {
    this.bloom?.setScale(this.bloomScale());
    if (this.dof) this.dof.resolution.scale = this.dofScale();
    // SMAA buys little on a 1.75x+ frame; skip it there.
    const smaa = this.pixelRatio < 1.7;
    if (this.smaaPass && this.fxPass && this.smaaPass.enabled !== smaa) {
      this.smaaPass.enabled = smaa;
      this.smaaPass.renderToScreen = smaa;
      this.fxPass.renderToScreen = !smaa;
    }
  }

  private bloomScale(): number {
    return THREE.MathUtils.clamp(1 / this.pixelRatio, 0.5, 1);
  }

  private dofScale(): number {
    const base = this.quality === 'high' ? 0.6 : 0.45;
    return THREE.MathUtils.clamp(base / Math.max(1, this.pixelRatio), 0.25, base);
  }

  // ------------------------------------------------------------------ dynamic resolution

  private initialAutoPr(): number {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(RES_KEY));
    } catch {
      /* storage blocked */
    }
    const max = Math.min(window.devicePixelRatio || 1, 2);
    // First run on a Retina screen starts at 1.5x and climbs if the GPU has room.
    const start = Number.isFinite(saved) && saved > 0 ? saved : Math.min(max, 1.5);
    return this.snapPr(Math.min(start, max));
  }

  private snapPr(pr: number): number {
    let best = PR_STEPS[0];
    for (const s of PR_STEPS) if (s <= pr + 1e-3) best = s;
    return best;
  }

  private resetDynamic(): void {
    this.dtWin.length = 0;
    this.gpuWin.length = 0;
    this.winT = 0;
    this.slowWins = 0;
    this.fastWins = 0;
    this.settleUntil = this.elapsed + 1.5;
  }

  private ensureTimer(): void {
    if (this.setting !== 'auto') {
      this.timerExt = null;
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.timerExt = (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) ?? null;
  }

  private pollTimer(gl: WebGL2RenderingContext): void {
    const ext = this.timerExt;
    if (!ext) return;
    while (this.timerQueries.length) {
      const q = this.timerQueries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.timerQueries.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      if (!disjoint) this.gpuWin.push(ns / 1e6);
    }
  }

  private setAutoPr(pr: number, now: number): void {
    const next = THREE.MathUtils.clamp(pr, PR_STEPS[0], this.maxPixelRatio);
    if (Math.abs(next - this.autoPr) < 1e-3) return;
    this.autoPr = next;
    this.resize();
    this.settleUntil = now + 1.2;
    this.saveAt = now + 4;
    this.slowWins = 0;
    this.fastWins = 0;
    this.onResolutionChange?.(next);
  }

  private stepIndex(pr: number): number {
    let i = 0;
    for (let k = 0; k < PR_STEPS.length; k++) if (PR_STEPS[k] <= pr + 1e-3) i = k;
    return i;
  }

  /** Once a second: step the pixel ratio down when frames run long, up when there is room. */
  private updateDynamic(rawDt: number): void {
    const now = this.elapsed;
    if (this.saveAt && now > this.saveAt) {
      this.saveAt = 0;
      try {
        localStorage.setItem(RES_KEY, String(this.autoPr));
      } catch {
        /* storage blocked */
      }
    }
    if (now < this.settleUntil || document.hidden || rawDt > 0.25) return;
    this.dtWin.push(rawDt * 1000);
    this.winT += rawDt;
    if (this.winT < 1) return;
    const dts = this.dtWin.sort((a, b) => a - b);
    const med = dts[Math.floor(dts.length / 2)];
    const gpus = this.gpuWin.sort((a, b) => a - b);
    this.gpuMs = gpus.length >= 10 ? gpus[Math.floor(gpus.length / 2)] : -1;
    this.dtWin.length = 0;
    this.gpuWin.length = 0;
    this.winT = 0;
    if (dts.length < 20) return;

    const i = this.stepIndex(this.autoPr);
    // Only a GPU-bound frame gets faster at a lower resolution. A frame cap (a browser's battery
    // saver runs pages at 30 Hz) or a busy main thread shows long frames with an idle GPU; leave
    // the resolution alone then. Without a GPU timer, every long frame counts.
    const gpuBound = this.gpuMs < 0 || this.gpuMs > Math.min(0.55 * med, 14);
    if (med > SLOW_MS && gpuBound) {
      this.fastWins = 0;
      this.slowWins++;
      const urgent = med > 28;
      if (urgent || this.slowWins >= 2) {
        // A step up that did not hold: stay below it for a while.
        if (now - this.lastUpAt < 5) {
          this.ceilingPr = PR_STEPS[i - 1] ?? PR_STEPS[0];
          this.upBlockedUntil = now + 45;
        }
        this.setAutoPr(PR_STEPS[Math.max(0, i - (urgent ? 2 : 1))], now);
      }
      return;
    }
    this.slowWins = 0;
    if (med > FAST_MS) {
      this.fastWins = 0;
      return;
    }
    this.fastWins++;
    const next = PR_STEPS[i + 1];
    if (next === undefined || next > this.maxPixelRatio + 1e-3) return;
    if (now < this.upBlockedUntil && next > this.ceilingPr + 1e-3) return;
    if (this.gpuMs >= 0) {
      const predicted = this.gpuMs * (next / this.autoPr) ** 2;
      if (this.fastWins >= 3 && predicted < GPU_UP_MS) {
        this.lastUpAt = now;
        this.setAutoPr(next, now);
      }
    } else if (this.fastWins >= 8) {
      // No GPU timer: probe upward slowly; a probe that fails blocks itself (see above).
      this.lastUpAt = now;
      this.setAutoPr(next, now);
    }
  }

  private readonly frame = (): void => {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    this.elapsed += dt;
    const info: FrameInfo = { dt, elapsed: this.elapsed };
    for (const fn of this.updaters) fn(info);
    this.renderer.info.reset();
    const ext = this.timerExt;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    let q: WebGLQuery | null = null;
    if (ext && this.timerQueries.length < 6) {
      q = gl.createQuery();
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    }
    this.composer.render(dt);
    if (q && ext) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.timerQueries.push(q);
    }
    for (const fn of this.afterUpdaters) fn(info);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.setting === 'auto') {
      this.pollTimer(gl);
      this.updateDynamic(rawDt);
    }
  };

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}
