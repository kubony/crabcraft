// The LED face behind the black visor, drawn by a signed-distance shader on a surface that follows
// the display window. Shapes morph into each other (the distance fields are blended), the eyes
// blink, glance around, and talk; output is HDR so bloom makes them glow like the TVC's LEDs.
import * as THREE from 'three';
import type { CrabFace, Expression } from './types';

/** Shape ids in the shader. */
const SHAPE: Record<Exclude<Expression, 'blink' | 'talk'>, number> = {
  neutral: 0,
  happy: 1,
  angry: 2,
  hurt: 3,
  dead: 4,
  love: 5,
  sleepy: 6,
  surprised: 7,
  focused: 8,
};

const vert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uIntensity;
uniform int uShapeA;
uniform int uShapeB;
uniform float uMix;
uniform float uBlink;
uniform float uFemale;
uniform float uTalk;
uniform vec2 uLook;
uniform float uTime;
uniform float uFlicker;
uniform float uWell;
uniform float uMono;
uniform float uCyclops;
uniform float uFill;
uniform float uHalo;
varying vec2 vUv;

float dot2(vec2 v) { return dot(v, v); }
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// Arc of radius r around the origin, opening downward when sc.y > 0 is measured from +y.
float sdArc(vec2 p, vec2 sc, float r) {
  p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * r) : abs(length(p) - r));
}

// Eye shape in eye-local mm, x mirrored so +x points toward the face centre. R = eye radius.
float eyeShape(vec2 p, int s, float R) {
  float th = R * 0.16;                // stroke half-width
  float fem = uFemale;
  if (s == 0) {                       // neutral: upright pill (TVC), rounder for female
    vec2 b = mix(vec2(R * 0.26, R * 0.62), vec2(R * 0.42, R * 0.6), fem);
    return sdBox(p, b, b.x);
  }
  if (s == 1) {                       // happy: ^ squint
    vec2 q = p - vec2(0.0, -R * 0.12);
    float a = sdSeg(q, vec2(-R * 0.55, -R * 0.2), vec2(0.0, R * 0.32));
    float b = sdSeg(q, vec2(0.0, R * 0.32), vec2(R * 0.55, -R * 0.2));
    return min(a, b) - th;
  }
  if (s == 2) {                       // angry: pill with the inner top corner cut down
    float d = sdBox(p, vec2(R * 0.42, R * 0.55), R * 0.2);
    vec2 n = normalize(vec2(0.75, 1.0));
    return max(d, dot(p - vec2(0.0, -R * 0.05), n));
  }
  if (s == 3) {                       // hurt: squeezed wavy line
    float x = clamp(p.x, -R * 0.55, R * 0.55);
    float w = R * 0.16 * sin(x / R * 9.0);
    return length(vec2(p.x - x, p.y - w)) * 0.8 - th;
  }
  if (s == 4) {                       // dead: X
    float a = sdSeg(p, vec2(-R * 0.5, -R * 0.5), vec2(R * 0.5, R * 0.5));
    float b = sdSeg(p, vec2(-R * 0.5, R * 0.5), vec2(R * 0.5, -R * 0.5));
    return min(a, b) - th;
  }
  if (s == 5) {                       // love: heart
    float k = R * 1.15;
    return sdHeart(p / k + vec2(0.0, 0.55)) * k;
  }
  if (s == 6) {                       // sleepy: closed lids, u-curves
    vec2 q = p - vec2(0.0, R * 0.2);
    return sdArc(vec2(q.x, -q.y), vec2(sin(1.0), cos(1.0)), R * 0.5) - th;
  }
  if (s == 7) {                       // surprised: big round eye
    return length(p) - R * mix(0.62, 0.7, fem);
  }
  // focused: solid arrowheads pointing at each other, the TVC's determined look
  return sdTri(p, vec2(-R * 0.42, R * 0.5), vec2(R * 0.5, 0.0), vec2(-R * 0.42, -R * 0.5)) - R * 0.08;
}

float lashes(vec2 p, float R) {
  // three short LED strokes off the outer top of the eye (x mirrored: outer is -x)
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    float a = 2.0 + float(i) * 0.38;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 o = dir * R * 0.66;
    d = min(d, sdSeg(p, o, o + dir * R * 0.32));
  }
  return d - R * 0.07;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = (vUv - 0.5) * uSize;        // mm, origin at the window centre, +x = viewer's right
  float H = uSize.y;
  float R = H * 0.4;                   // eye radius
  // Readability at game distance: how many screen pixels the eye radius spans. Close up (character
  // creation, dialogue) nothing changes; once the eyes are a few pixels tall they grow to fill the
  // window, strokes thicken to at least a pixel and a half, and the glow drops so bloom does not
  // smear the shapes into blobs.
  vec2 fw = fwidth(p);
  float mmPx = max(0.5 * (fw.x + fw.y), 1e-4);
  float far = 1.0 - smoothstep(5.0, 15.0, R / mmPx);
  R *= mix(1.0, 1.55, far);
  vec2 c = vec2(uSize.x * mix(0.2, 0.215, far), H * mix(0.06, 0.02, far));
  float side = sign(p.x);
  vec2 e = vec2(abs(p.x), p.y) - c - vec2(uLook.x * side, uLook.y);
  e.x = -e.x;                          // +x toward the centre for both eyes
  if (uCyclops > 0.5) {                // one big eye in the middle (scrap drones)
    R *= 1.35;
    c = vec2(0.0, H * 0.04);
    e = p - c - uLook;
  }
  // blink squashes vertically
  float squash = max(1.0 - uBlink, 0.06);
  vec2 eb = vec2(e.x, e.y / squash);
  float dA = eyeShape(eb, uShapeA, R);
  float dB = eyeShape(eb, uShapeB, R);
  float d = mix(dA, dB, uMix) * mix(1.0, squash, 0.5);
  if (uFemale > 0.5 && uBlink < 0.5) {
    float l = lashes(e, R);
    float lw = (uShapeB == 0 || uShapeB == 7 || uShapeB == 5) ? uMix : (1.0 - uMix);
    if (uShapeA == uShapeB) lw = (uShapeA == 0 || uShapeA == 7 || uShapeA == 5) ? 1.0 : 0.0;
    d = min(d, mix(1e3, l, lw));
  }
  // mouth for talking: a small rounded bar between and below the eyes
  float mouth = 1e3;
  if (uTalk > 0.01) {
    vec2 m = p - vec2(0.0, -H * 0.27);
    mouth = sdBox(m, vec2(R * 0.38, max(R * 0.07, R * 0.26 * uTalk)), R * 0.07);
  }
  d = min(d, mouth);
  d -= far * mmPx * 0.75;              // dilate: thin strokes (^ ^, X X) stay solid when tiny
  float px = max(fwidth(d), 1e-3);
  float core = 1.0 - smoothstep(-px, px, d);
  float halo = exp(-max(d, 0.0) / (R * 0.22 * uHalo)) * 0.35 * mix(1.0, 0.2, far);
  // faint eye wells, like the TVC screen's backlit circles
  float well = (1.0 - smoothstep(R * 0.95, R * 1.05, length(uCyclops > 0.5 ? p - c : vec2(abs(p.x), p.y) - c))) * uWell;
  // LED matrix texture, fading out when pixels get small on screen
  vec2 g = fract(p / 0.9) - 0.5;
  float grid = 1.0 - 0.35 * smoothstep(0.25, 0.5, max(abs(g.x), abs(g.y)));
  float gridFade = clamp(1.0 - fwidth(p.x) * 2.0, 0.0, 1.0);
  core *= mix(1.0, grid, gridFade);
  float flick = 1.0;
  if (uFlicker > 0.0) {
    float n = fract(sin(floor(uTime * 23.0) * 91.7) * 43758.5);
    float drop = step(0.93, n);
    flick = 1.0 - uFlicker * (0.25 * n + 0.65 * drop);
    float band = step(0.96, fract(sin(floor(uTime * 7.0) * 17.3) * 9341.1));
    p.x += band * sin(p.y * 2.0 + uTime * 40.0) * 2.0;
  }
  // Hot LED core: the centre of a lit segment runs whiter, like the TVC screen (close up only).
  float hot = (1.0 - smoothstep(-R * 0.3, -R * 0.08, d)) * (1.0 - far) * 0.35;
  vec3 tint = mix(uColor, vec3(max(max(uColor.r, uColor.g), uColor.b)), hot);
  vec3 led = tint * uIntensity * mix(1.0, 0.42, far) * (core + halo) * flick;
  vec3 col = led + vec3(0.55, 0.6, 0.7) * well * 0.06;
  if (uFill > 0.0) {                   // furnace glow filling the whole window (boss)
    float heat = (0.55 + 0.45 * sin(uTime * 3.1 + p.x * 0.15) * sin(uTime * 1.7 - p.y * 0.3)) * (0.6 + 0.4 * (1.0 - vUv.y));
    col += uColor * uFill * heat;
  }
  col = mix(col, vec3(dot(col, vec3(0.333))), uMono);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export interface FaceStyle {
  color: string;
  female: boolean;
  flicker: boolean;
  /** 0..1, dims the LEDs (scrap drones). */
  intensity?: number;
  /** One big centred eye (scrap drones). */
  cyclops?: boolean;
  /** 0..1 glow filling the whole window (Corrodius' furnace). */
  fill?: number;
  /** Halo width multiplier (night elves' soft glow). */
  halo?: number;
}

export class LedFace implements CrabFace {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private base: THREE.Color;
  private tint: THREE.Color | null = null;
  private current: number = SHAPE.neutral;
  private previous: number = SHAPE.neutral;
  private mix = 1;
  private idleExpr: Expression = 'neutral';
  private expr: Expression = 'neutral';
  private hold = 0;
  private blinkTimer = 2 + Math.random() * 2;
  private blinkPhase = -1;
  private forceBlink = false;
  private talking = false;
  private talkT = 0;
  private lookTimer = 1;
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private time = Math.random() * 100;
  private flicker = false;
  private intensity = 1;

  constructor(geometry: THREE.BufferGeometry, sizeMm: THREE.Vector2, style: FaceStyle) {
    this.base = new THREE.Color(style.color);
    this.material = new THREE.ShaderMaterial({
      name: 'crab-face',
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uSize: { value: sizeMm.clone() },
          uColor: { value: new THREE.Color() },
          uIntensity: { value: 7 },
          uShapeA: { value: 0 },
          uShapeB: { value: 0 },
          uMix: { value: 1 },
          uBlink: { value: 0 },
          uFemale: { value: 0 },
          uTalk: { value: 0 },
          uLook: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uFlicker: { value: 0 },
          uWell: { value: 1 },
          uMono: { value: 0 },
          uCyclops: { value: 0 },
          uFill: { value: 0 },
          uHalo: { value: 1 },
        },
      ]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'crab-face';
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.setStyle(style);
  }

  setStyle(style: FaceStyle): void {
    this.base.set(style.color);
    this.material.uniforms.uFemale.value = style.female ? 1 : 0;
    this.flicker = style.flicker;
    this.intensity = style.intensity ?? 1;
    this.material.uniforms.uCyclops.value = style.cyclops ? 1 : 0;
    this.material.uniforms.uFill.value = style.fill ?? 0;
    this.material.uniforms.uHalo.value = style.halo ?? 1;
    this.applyColor();
  }

  /** The expression to return to after timed ones (e.g. 'sleepy' for a dozing NPC). */
  setIdle(e: Expression): void {
    this.idleExpr = e;
    if (this.hold <= 0) this.setExpression(e);
  }

  setExpression(e: Expression, holdSeconds?: number): void {
    this.expr = e;
    this.hold = holdSeconds ?? 0;
    this.talking = e === 'talk';
    this.forceBlink = e === 'blink';
    if (e === 'blink' || e === 'talk') return;
    const s = SHAPE[e];
    if (s === this.current) return;
    // Start a morph from whatever is showing now.
    this.previous = this.mix < 0.5 ? this.previous : this.current;
    this.current = s;
    this.mix = 0;
  }

  get expression(): Expression {
    return this.expr;
  }

  setTint(color: THREE.ColorRepresentation | null): void {
    this.tint = color === null ? null : new THREE.Color(color);
    this.applyColor();
  }

  private applyColor(): void {
    (this.material.uniforms.uColor.value as THREE.Color).copy(this.tint ?? this.base);
  }

  update(dt: number): void {
    const u = this.material.uniforms;
    this.time += dt;
    u.uTime.value = this.time;
    // timed expressions
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this.setExpression(this.idleExpr);
    }
    // morph
    this.mix = Math.min(1, this.mix + dt / 0.16);
    u.uShapeA.value = this.previous;
    u.uShapeB.value = this.current;
    u.uMix.value = this.mix * this.mix * (3 - 2 * this.mix);
    // blinking (not when dead, sleepy, or mid-morph)
    const canBlink = this.current !== SHAPE.dead && this.current !== SHAPE.sleepy;
    let blink = 0;
    if (this.forceBlink) {
      blink = 1;
    } else if (canBlink) {
      if (this.blinkPhase < 0) {
        this.blinkTimer -= dt;
        if (this.blinkTimer <= 0) {
          this.blinkPhase = 0;
          this.blinkTimer = 1.8 + Math.random() * 3.5;
          if (Math.random() < 0.15) this.blinkTimer = 0.25; // double blink
        }
      } else {
        this.blinkPhase += dt / 0.16;
        blink = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
        if (this.blinkPhase >= 1) this.blinkPhase = -1;
      }
    }
    u.uBlink.value = blink;
    // glances
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 0.8 + Math.random() * 2.6;
      this.lookTarget.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2);
      if (Math.random() < 0.4) this.lookTarget.set(0, 0);
    }
    this.look.lerp(this.lookTarget, 1 - Math.exp(-dt * 18));
    (u.uLook.value as THREE.Vector2).copy(this.current === SHAPE.dead ? new THREE.Vector2() : this.look);
    // talking: syllable-ish mouth flaps
    if (this.talking) {
      this.talkT += dt;
      const t = this.talkT;
      u.uTalk.value = 0.35 + 0.65 * Math.abs(Math.sin(t * 11) * Math.sin(t * 3.3 + 1));
    } else {
      u.uTalk.value = Math.max(0, u.uTalk.value - dt * 6);
    }
    // undead flicker
    u.uFlicker.value = this.flicker ? 1 : 0;
    const dead = this.current === SHAPE.dead ? 0.55 : 1;
    u.uIntensity.value = 7 * this.intensity * dead;
  }

  dispose(): void {
    this.material.dispose();
  }
}
