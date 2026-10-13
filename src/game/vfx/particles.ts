// GPU-instanced billboard particles. One draw call per system; particles live in typed arrays and
// dead ones are swap-removed so the instance buffer stays packed.
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './atlas';

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  /** Linear colour; values above 1 bloom. */
  color: THREE.Color;
  colorEnd?: THREE.Color;
  alpha?: number;
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  sprite?: number;
  rot?: number;
  spin?: number;
  /** >0 stretches the quad along its screen-space velocity (sparks, streaks). */
  stretch?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
}

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iMisc;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iMisc.x;
  float rot = iMisc.y;
  float sprite = iMisc.z;
  float stretch = iMisc.w;
  vec2 corner = position.xy;
  vec2 p;
  if (stretch > 0.0) {
    vec2 d = (modelViewMatrix * vec4(iVel, 0.0)).xy;
    float len = length(d);
    vec2 ax = len > 1e-4 ? d / len : vec2(1.0, 0.0);
    vec2 ay = vec2(-ax.y, ax.x);
    p = ax * corner.x * (size + len * stretch) + ay * corner.y * size;
  } else {
    float c = cos(rot);
    float s = sin(rot);
    p = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  mv.xy += p;
  gl_Position = projectionMatrix * mv;
  float col = mod(sprite, uAtlas.x);
  float row = floor(sprite / uAtlas.x);
  vUv = (vec2(col, uAtlas.y - 1.0 - row) + corner + 0.5) / uAtlas;
  vColor = iColor;
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}`;

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private n = 0;
  // CPU state
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array; // start, end
  private col: Float32Array; // rgb start, rgb end
  private alpha: Float32Array;
  private phys: Float32Array; // gravity, drag, spin, fadeIn
  private misc: Float32Array; // rot, sprite, stretch
  // GPU attributes
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;

  constructor(readonly capacity: number, additive: boolean, map: THREE.Texture) {
    const cap = capacity;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap * 2);
    this.col = new Float32Array(cap * 6);
    this.alpha = new Float32Array(cap);
    this.phys = new Float32Array(cap * 4);
    this.misc = new Float32Array(cap * 3);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3);
    this.aVel = mk(3);
    this.aColor = mk(4);
    this.aMisc = mk(4);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iMisc', this.aMisc);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uMap: { value: map }, uAtlas: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  get count(): number {
    return this.n;
  }

  emit(o: EmitOptions): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = o.x;
    this.pos[i3 + 1] = o.y;
    this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0;
    this.vel[i3 + 1] = o.vy ?? 0;
    this.vel[i3 + 2] = o.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = Math.max(0.01, o.life);
    this.size[i * 2] = o.size;
    this.size[i * 2 + 1] = o.sizeEnd ?? o.size;
    const c0 = o.color;
    const c1 = o.colorEnd ?? o.color;
    const i6 = i * 6;
    this.col[i6] = c0.r;
    this.col[i6 + 1] = c0.g;
    this.col[i6 + 2] = c0.b;
    this.col[i6 + 3] = c1.r;
    this.col[i6 + 4] = c1.g;
    this.col[i6 + 5] = c1.b;
    this.alpha[i] = o.alpha ?? 1;
    const i4 = i * 4;
    this.phys[i4] = o.gravity ?? 0;
    this.phys[i4 + 1] = o.drag ?? 0;
    this.phys[i4 + 2] = o.spin ?? 0;
    this.phys[i4 + 3] = o.fadeIn ?? 0.08;
    this.misc[i3] = o.rot ?? Math.random() * Math.PI * 2;
    this.misc[i3 + 1] = o.sprite ?? 0;
    this.misc[i3 + 2] = o.stretch ?? 0;
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    const copy = (arr: Float32Array, stride: number) => {
      for (let k = 0; k < stride; k++) arr[i * stride + k] = arr[last * stride + k];
    };
    copy(this.pos, 3);
    copy(this.vel, 3);
    copy(this.age, 1);
    copy(this.life, 1);
    copy(this.size, 2);
    copy(this.col, 6);
    copy(this.alpha, 1);
    copy(this.phys, 4);
    copy(this.misc, 3);
  }

  update(dt: number): void {
    const P = this.pos;
    const V = this.vel;
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      const i4 = i * 4;
      const drag = this.phys[i4 + 1];
      if (drag > 0) {
        const k = Math.exp(-drag * dt);
        V[i3] *= k;
        V[i3 + 1] *= k;
        V[i3 + 2] *= k;
      }
      V[i3 + 1] -= this.phys[i4] * dt;
      P[i3] += V[i3] * dt;
      P[i3 + 1] += V[i3 + 1] * dt;
      P[i3 + 2] += V[i3 + 2] * dt;
      this.misc[i3] += this.phys[i4 + 2] * dt;
    }
    // Write GPU buffers.
    const ap = this.aPos.array as Float32Array;
    const av = this.aVel.array as Float32Array;
    const ac = this.aColor.array as Float32Array;
    const am = this.aMisc.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      const u = this.age[i] / this.life[i];
      ap[i3] = P[i3];
      ap[i3 + 1] = P[i3 + 1];
      ap[i3 + 2] = P[i3 + 2];
      av[i3] = V[i3];
      av[i3 + 1] = V[i3 + 1];
      av[i3 + 2] = V[i3 + 2];
      const i6 = i * 6;
      const fadeIn = this.phys[i4 + 3];
      const a = this.alpha[i] * (fadeIn > 0 ? Math.min(1, u / fadeIn) : 1) * (1 - u * u);
      ac[i4] = this.col[i6] + (this.col[i6 + 3] - this.col[i6]) * u;
      ac[i4 + 1] = this.col[i6 + 1] + (this.col[i6 + 4] - this.col[i6 + 1]) * u;
      ac[i4 + 2] = this.col[i6 + 2] + (this.col[i6 + 5] - this.col[i6 + 2]) * u;
      ac[i4 + 3] = a;
      am[i4] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * u;
      am[i4 + 1] = this.misc[i3];
      am[i4 + 2] = this.misc[i3 + 1];
      am[i4 + 3] = this.misc[i3 + 2];
    }
    const n = this.n;
    for (const [attr, size] of [
      [this.aPos, 3],
      [this.aVel, 3],
      [this.aColor, 4],
      [this.aMisc, 4],
    ] as const) {
      attr.clearUpdateRanges();
      if (n > 0) {
        attr.addUpdateRange(0, n * size);
        attr.needsUpdate = true;
      }
    }
    this.geo.instanceCount = n;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
