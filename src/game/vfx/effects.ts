// Pooled mesh effects (shockwave rings, ground telegraphs, light pillars, shields, slash arcs,
// water swirls, projectile orbs). Each kind shares one geometry and one shader program; pooled
// instances keep their own uniforms so nothing is compiled mid-fight.
import * as THREE from 'three';

export type FxKind = 'ring' | 'decal' | 'pillar' | 'shield' | 'arc' | 'swirl' | 'wall' | 'orb';

export interface Fx {
  kind: FxKind;
  mesh: THREE.Mesh;
  u: Record<string, THREE.IUniform>;
  t: number;
  dur: number;
  /** Per-frame animation, k = t / dur in 0..1 (0 while dur is Infinity). */
  anim?: (fx: Fx, dt: number, k: number) => void;
  onDone?: () => void;
  alive: boolean;
}

const commonVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const header = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uProgress;
uniform float uTime;
uniform vec4 uParam;
`;

const FRAG: Record<FxKind, string> = {
  // uParam.x = inner radius fraction
  ring: /* glsl */ `
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float inner = uParam.x;
  float a = smoothstep(inner, mix(inner, 1.0, 0.55), r) * (1.0 - smoothstep(0.9, 1.0, r));
  a *= uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`,
  // uParam.x = half angle (>= 3.1 means full circle)
  decal: /* glsl */ `
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float halfA = uParam.x;
  float ang = abs(atan(p.x, p.y));
  bool full = halfA > 3.1;
  float cone = full ? 1.0 : 1.0 - smoothstep(halfA - 0.012, halfA, ang);
  if (cone <= 0.0) discard;
  float rim = smoothstep(0.86, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float side = full ? 0.0 : smoothstep(halfA - 0.09, halfA - 0.02, ang);
  float grow = 1.0 - smoothstep(uProgress - 0.03, uProgress, r);
  float pulse = 0.5 + 0.5 * sin(uTime * 14.0);
  float stripes = step(0.55, fract((p.x + p.y) * 5.0 - uTime * 1.2));
  float edge = max(rim, side);
  float a = 0.14 + 0.05 * pulse + grow * 0.3 + edge * 0.85 + stripes * 0.05;
  a *= cone * uAlpha;
  gl_FragColor = vec4(uColor * (0.8 + edge * 0.45 + grow * 0.2), a);
}`,
  pillar: /* glsl */ `
void main() {
  float y = vUv.y;
  float fade = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(uParam.x, 1.0, y));
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float streak = 0.62 + 0.38 * sin(vUv.x * 6.2831 * 5.0 + y * 22.0 - uTime * 7.0);
  float a = fade * core * streak * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColor2, uColor, core), a);
}`,
  // uParam.x = hit flash
  shield: /* glsl */ `
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(f, 2.2);
  vec3 q = vP * 5.5;
  float cells = abs(sin(q.x + uTime * 0.7) * sin(q.y * 1.1 - uTime * 0.5) * sin(q.z * 0.9 + uTime * 0.3));
  float pattern = smoothstep(0.72, 0.95, cells);
  float hit = uParam.x;
  float a = (fres * 0.9 + pattern * 0.22 + 0.035) * uAlpha + hit * 0.45 * fres;
  vec3 col = mix(uColor, uColor2, pattern) * (1.0 + hit * 2.5);
  gl_FragColor = vec4(col, a);
}`,
  // uParam.x = arc length in radians
  arc: /* glsl */ `
void main() {
  float ang = atan(vP.y, vP.x);
  if (ang < 0.0) ang += 6.28318;
  float t = ang / uParam.x;
  float r = clamp((length(vP) - 0.45) / 0.55, 0.0, 1.0);
  float lead = uProgress;
  float tail = smoothstep(lead - 0.8, lead, t) * (1.0 - smoothstep(lead, lead + 0.04, t));
  float prof = pow(sin(r * 3.14159), 0.5) * (0.6 + 0.4 * r);
  float a = min(1.0, tail * prof * 1.9) * uAlpha;
  if (a < 0.003) discard;
  vec3 col = mix(uColor2, uColor, tail);
  col = mix(col, vec3(2.2, 2.05, 1.8), smoothstep(0.8, 1.0, tail) * smoothstep(0.3, 0.8, r) * 0.7);
  gl_FragColor = vec4(col, a);
}`,
  // uParam.x = spin direction
  swirl: /* glsl */ `
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float dir = uParam.x;
  float s = sin(ang * 5.0 + r * 9.0 * dir - uTime * 9.0 * dir);
  float band = smoothstep(0.05, 0.95, s);
  float ring = smoothstep(0.1, 0.38, r) * (1.0 - smoothstep(0.78, 1.0, r));
  float a = (band * 0.85 + 0.12) * ring * uAlpha;
  gl_FragColor = vec4(mix(uColor, uColor2, band), a);
}`,
  wall: /* glsl */ `
void main() {
  float y = vUv.y;
  float s = sin(vUv.x * 6.2831 * 4.0 + y * 7.0 * uParam.x - uTime * 11.0 * uParam.x);
  float band = smoothstep(0.0, 1.0, s);
  float fade = smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.35, 1.0, y));
  float a = (band * 0.8 + 0.15) * fade * uAlpha;
  gl_FragColor = vec4(mix(uColor, uColor2, band), a);
}`,
  orb: /* glsl */ `
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (f * 1.3 + vec3(0.0, 0.33, 0.67)) + uTime * 3.0);
  vec3 col = mix(uColor, irid * uColor2, pow(f, 1.2));
  float a = (0.22 + pow(f, 1.6) * 0.95) * uAlpha;
  gl_FragColor = vec4(col, a);
}`,
};

const geometries: Partial<Record<FxKind, THREE.BufferGeometry>> = {};
function geometryFor(kind: FxKind): THREE.BufferGeometry {
  let g = geometries[kind];
  if (g) return g;
  switch (kind) {
    case 'ring':
    case 'decal':
    case 'swirl':
      g = new THREE.PlaneGeometry(2, 2).rotateX(Math.PI / 2);
      break;
    case 'pillar':
    case 'wall':
      g = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
      break;
    case 'shield':
    case 'orb':
      g = new THREE.SphereGeometry(1, 40, 24);
      break;
    case 'arc':
      g = new THREE.RingGeometry(0.45, 1, 48, 1, 0, ARC_LEN);
      break;
  }
  geometries[kind] = g;
  return g;
}

const ARC_LEN = 2.6;
/** Light (beams, shields, orbs) adds; ground marks and water keep their hue with normal blending. */
const ADDITIVE = new Set<FxKind>(['pillar', 'shield', 'orb']);

export class FxPool {
  readonly group = new THREE.Group();
  private free = new Map<FxKind, Fx[]>();
  private active: Fx[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'fx';
  }

  private create(kind: FxKind): Fx {
    const u: Record<string, THREE.IUniform> = {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uColor2: { value: new THREE.Color(1, 1, 1) },
      uAlpha: { value: 1 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uParam: { value: new THREE.Vector4() },
    };
    const additive = ADDITIVE.has(kind);
    const mat = new THREE.ShaderMaterial({
      vertexShader: commonVert,
      fragmentShader: header + FRAG[kind],
      uniforms: u,
      transparent: true,
      depthWrite: false,
      side: kind === 'shield' || kind === 'orb' ? THREE.FrontSide : THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: kind === 'decal' || kind === 'ring' || kind === 'swirl',
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometryFor(kind), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = kind === 'decal' ? 5 : 18;
    return { kind, mesh, u, t: 0, dur: 1, alive: false };
  }

  /** Get a pooled effect, reset and added to the scene. Caller sets transform and uniforms. */
  spawn(kind: FxKind, dur: number, anim?: Fx['anim'], onDone?: () => void): Fx {
    const list = this.free.get(kind);
    const fx = list?.pop() ?? this.create(kind);
    fx.t = 0;
    fx.dur = dur;
    fx.anim = anim;
    fx.onDone = onDone;
    fx.alive = true;
    fx.mesh.position.set(0, 0, 0);
    fx.mesh.rotation.set(0, 0, 0);
    fx.mesh.scale.set(1, 1, 1);
    fx.mesh.visible = true;
    (fx.mesh.material as THREE.ShaderMaterial).blending = ADDITIVE.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending;
    fx.u.uAlpha.value = 1;
    fx.u.uProgress.value = 0;
    (fx.u.uParam.value as THREE.Vector4).set(kind === 'arc' ? ARC_LEN : 0, 0, 0, 0);
    if (kind === 'pillar') (fx.u.uParam.value as THREE.Vector4).x = 0.55;
    if (kind === 'swirl' || kind === 'wall') (fx.u.uParam.value as THREE.Vector4).x = 1;
    this.group.add(fx.mesh);
    this.active.push(fx);
    return fx;
  }

  /** Switch one pooled instance between additive and normal blending (no recompile). */
  setAdditive(fx: Fx, additive: boolean): void {
    (fx.mesh.material as THREE.ShaderMaterial).blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  release(fx: Fx): void {
    if (!fx.alive) return;
    fx.alive = false;
    fx.mesh.visible = false;
    this.group.remove(fx.mesh);
    const i = this.active.indexOf(fx);
    if (i >= 0) this.active.splice(i, 1);
    let list = this.free.get(fx.kind);
    if (!list) this.free.set(fx.kind, (list = []));
    list.push(fx);
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      fx.t += dt;
      fx.u.uTime.value = this.time;
      const k = Number.isFinite(fx.dur) ? Math.min(1, fx.t / fx.dur) : 0;
      fx.anim?.(fx, dt, k);
      if (fx.alive && Number.isFinite(fx.dur) && fx.t >= fx.dur) {
        const done = fx.onDone;
        this.release(fx);
        done?.();
      }
    }
  }

  /** Create one of every kind so all shader programs exist before the first fight. */
  prewarm(): THREE.Mesh[] {
    const kinds: FxKind[] = ['ring', 'decal', 'pillar', 'shield', 'arc', 'swirl', 'wall', 'orb'];
    const out: THREE.Mesh[] = [];
    for (const k of kinds) {
      const fx = this.spawn(k, 0.05);
      fx.u.uAlpha.value = 0;
      fx.mesh.position.set(0, -500, 0);
      out.push(fx.mesh);
    }
    return out;
  }

  clear(): void {
    for (const fx of [...this.active]) this.release(fx);
  }

  dispose(): void {
    this.clear();
    for (const list of this.free.values()) for (const fx of list) (fx.mesh.material as THREE.Material).dispose();
    this.free.clear();
  }
}
