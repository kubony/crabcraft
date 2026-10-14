// Robot Mode's appearance switch: the bare robot (its own visual meshes) or a geared crab from
// the game, both posed from the same live physics frame. Switching swaps which one draws; the
// simulation never notices. A short x-ray flash of the physics robot marks every switch.
import * as THREE from 'three';
import type { CrabRigView } from './crabRigView';
import type { FaceExpr, RobotRenderFrame, RobotViewLayer, StlRobotView } from './robotView';

export type Appearance = 'bare' | 'crab';

/** Seconds the switch flash takes to fade. */
const FLASH = 0.7;
/** Opacity of the x-ray overlay (alignment check). */
const XRAY = 0.5;

export class AppearanceLayer implements RobotViewLayer {
  readonly object = new THREE.Group();
  readonly bare: StlRobotView;
  private crabView: CrabRigView | null = null;
  private kind: Appearance = 'bare';
  private xray = false;
  private flash = 0;
  private expr: FaceExpr = 'neutral';
  private last: RobotRenderFrame | null = null;

  constructor(bare: StlRobotView) {
    this.bare = bare;
    this.object.name = 'robot-appearance';
    this.object.add(bare.object);
    this.apply();
  }

  get appearance(): Appearance {
    return this.kind;
  }

  get crab(): CrabRigView | null {
    return this.crabView;
  }

  /** Installs (or replaces) the crab layer. The previous one is disposed. */
  setCrab(view: CrabRigView | null): void {
    if (view === this.crabView) return;
    this.crabView?.dispose();
    this.crabView = view;
    if (view) {
      this.object.add(view.object);
      view.setExpression(this.expr);
      // Pose it from the latest frame right away, so it never shows a frame at the origin.
      if (this.last) view.update(this.last, 0);
    }
    if (this.kind === 'crab') this.flash = FLASH;
    this.apply();
  }

  show(kind: Appearance): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.flash = FLASH;
    this.apply();
  }

  /** Draws the physics robot as a hologram over the crab, to check the crab follows it exactly. */
  setXray(on: boolean): void {
    this.xray = on;
    this.apply();
  }

  get xrayOn(): boolean {
    return this.xray;
  }

  private get crabShown(): boolean {
    return this.kind === 'crab' && !!this.crabView;
  }

  private apply(): void {
    const crab = this.crabShown;
    this.bare.setSolid(!crab);
    this.bare.object.visible = !crab || this.xray || this.flash > 0;
    if (this.crabView) this.crabView.object.visible = crab;
    this.bare.setXray(this.xrayOpacity());
  }

  private xrayOpacity(): number {
    const f = this.flash > 0 ? Math.pow(this.flash / FLASH, 1.6) * 0.95 : 0;
    return Math.max(f, this.xray && this.crabShown ? XRAY : 0);
  }

  update(f: RobotRenderFrame, dt: number): void {
    this.last = f;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      if (this.flash === 0) this.apply();
      else this.bare.setXray(this.xrayOpacity());
    }
    if (this.bare.object.visible) this.bare.update(f, dt);
    if (this.crabShown) this.crabView!.update(f, dt);
  }

  setExpression(e: FaceExpr): void {
    this.expr = e;
    this.bare.setExpression(e);
    this.crabView?.setExpression(e);
  }

  dispose(): void {
    this.bare.dispose();
    this.crabView?.dispose();
  }
}
