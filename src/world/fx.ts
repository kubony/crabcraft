// Ambient particles, all simulated in the vertex shader from a seed and the clock:
// lamp and fire glows, fireflies, forge sparks, fountain water, sea spray, wreck embers,
// dust motes, celebration fireworks (additive pass) and chimney smoke (alpha pass).
import * as THREE from 'three';
import type { GlowSpot } from './dressing';
import { rng } from './noise';

export const enum Kind {
  Glow = 0,
  Firefly = 1,
  Spark = 2,
  Spray = 3,
  Fountain = 4,
  Firework = 5,
  Dust = 6,
  Ember = 7,
  Smoke = 8,
}

export interface FxUniforms {
  uTime: { value: number };
  uLamps: { value: number };
  uFireflies: { value: number };
  uFireworks: { value: number };
  uDust: { value: number };
  uNight: { value: number };
  uPixel: { value: number };
}

interface P {
  pos: THREE.Vector3;
  kind: Kind;
  color: THREE.Color;
  size: number;
  /** Velocity or wander extents depending on kind. */
  vel?: THREE.Vector3;
  seed?: number;
  param?: number;
  lag?: number;
}

const VERT = /* glsl */ `
  attribute float aKind;
  attribute vec3 aColor;
  attribute vec4 aData; // x size, y seed, z param, w spare
  attribute vec3 aVel;
  uniform float uTime;
  uniform float uLamps;
  uniform float uFireflies;
  uniform float uFireworks;
  uniform float uDust;
  uniform float uNight;
  uniform float uPixel;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  #ifdef USE_FOG
  varying float vFogDepth;
  #endif

  float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  vec3 h3(float n) { return vec3(h1(n), h1(n + 17.3), h1(n + 41.9)); }

  void main() {
    vec3 p = position;
    float size = aData.x;
    float seed = aData.y;
    float param = aData.z;
    float a = 1.0;
    vSoft = 1.0;
    vec3 col = aColor;
    int k = int(aKind + 0.5);
    float t = uTime;
    if (k == 0) {
      // Glow: lamps brighten at night; fires and candles flicker; magic pulses.
      float f = 1.0;
      if (param > 0.5 && param < 1.5) f = 0.75 + 0.25 * sin(t * 13.0 + seed * 40.0) * sin(t * 7.3 + seed * 11.0);
      else if (param > 1.5 && param < 2.5) f = 0.85 + 0.15 * sin(t * 17.0 + seed * 60.0);
      else if (param > 2.5) f = 0.7 + 0.3 * sin(t * 1.3 + seed * 9.0);
      a = f * (param > 2.5 ? 0.6 + 0.6 * uNight : (param > 0.5 && param < 1.5) ? 0.8 + 0.4 * uNight : uLamps * (0.3 + 0.7 * uNight));
      vSoft = 2.2;
    } else if (k == 1) {
      // Firefly: lazy wander inside aVel extents, blinking.
      vec3 ph = h3(seed) * 6.2831;
      p += vec3(sin(t * 0.31 + ph.x) * aVel.x, sin(t * 0.47 + ph.y) * aVel.y, cos(t * 0.37 + ph.z) * aVel.z);
      p += vec3(sin(t * 1.7 + ph.y), sin(t * 2.3 + ph.z), cos(t * 1.9 + ph.x)) * 0.25;
      float blink = smoothstep(0.2, 0.9, sin(t * (1.3 + h1(seed) * 1.5) + ph.x * 3.0) * 0.5 + 0.5);
      a = blink * uFireflies;
    } else if (k == 2) {
      // Forge sparks: bursts every ~1.6 s from the anvil.
      float cycle = floor(t / 1.6 + h1(seed) * 0.15);
      float lt = fract(t / 1.6 + h1(seed) * 0.15) * 1.6;
      vec3 r = h3(seed + cycle * 3.1);
      vec3 v = vec3((r.x - 0.5) * 4.0, 2.5 + r.y * 4.0, (r.z - 0.5) * 4.0);
      p += v * lt + vec3(0.0, -6.0, 0.0) * lt * lt;
      a = (1.0 - smoothstep(0.2, 0.9, lt)) * step(lt, 0.9) * step(p.y, position.y + 4.0) * step(position.y - 0.4, p.y);
      col = mix(vec3(4.0, 2.2, 0.6), vec3(3.0, 0.7, 0.1), lt / 0.9);
    } else if (k == 3) {
      // Sea spray where waves hit rocks and the hull.
      float lt = fract(t * 0.23 + h1(seed) * 0.3 + param);
      vec3 r = h3(seed);
      vec3 v = vec3((r.x - 0.5) * 3.0, 3.5 + r.y * 3.0, (r.z - 0.5) * 3.0);
      float tt = lt * 2.2;
      p += v * tt + vec3(0.0, -7.0, 0.0) * tt * tt;
      a = smoothstep(0.0, 0.05, lt) * (1.0 - smoothstep(0.2, 0.45, lt)) * step(0.0, p.y + 0.2) * 0.55;
      size *= 1.0 + lt * 3.0;
      vSoft = 1.5;
    } else if (k == 4) {
      // Fountain jets: drops along a ballistic arc from the fingertip spouts into the basin.
      float lt = fract(t * 0.55 + h1(seed));
      float tt = lt * 1.25;
      vec3 v = aVel + (h3(seed) - 0.5) * 0.35;
      p += v * tt + vec3(0.0, -9.0, 0.0) * tt * tt;
      a = step(param, p.y) * 0.75;
      size *= 0.8 + h1(seed + 3.0) * 0.6;
      col = mix(vec3(0.75, 0.95, 1.1), vec3(1.4), h1(seed + 9.0));
    } else if (k == 5) {
      // Fireworks: a rocket climbs, bursts into a shell of streaking sparks that droop and crackle.
      // aData.w is the streak index (0 head, 1-2 trailing copies).
      float lag = aData.w;
      float period = 3.1 + mod(param * 0.77, 1.3);
      float off = param * 0.91;
      float tt = t - lag * 0.03;
      float cycle = floor((tt + off) / period);
      float lt = mod(tt + off, period);
      vec3 rc = h3(param * 13.0 + cycle * 7.7);
      vec3 centre = position + vec3((rc.x - 0.5) * 70.0, rc.y * 24.0, (rc.z - 0.5) * 80.0);
      // Palette per shell: gold, crimson, teal, violet, lime, silver.
      float pi = floor(h1(param * 3.3 + cycle * 1.91) * 6.0);
      vec3 hueA = pi < 1.0 ? vec3(1.0, 0.62, 0.15) : pi < 2.0 ? vec3(1.0, 0.18, 0.22) : pi < 3.0 ? vec3(0.2, 0.95, 0.9) : pi < 4.0 ? vec3(0.75, 0.35, 1.0) : pi < 5.0 ? vec3(0.55, 1.0, 0.25) : vec3(0.9, 0.92, 1.0);
      vec3 hueB = mix(hueA, vec3(1.0, 0.9, 0.6), 0.5);
      vec3 dir = normalize(aVel);
      float rocket = 0.85;
      if (lt < rocket) {
        float f = lt / rocket;
        vec3 start = vec3(centre.x - 6.0, 1.0, centre.z);
        p = mix(start, centre, f * (2.0 - f)) - vec3(0.0, h1(seed) * 4.0 * f, 0.0);
        a = step(0.86, h1(seed + 5.0)) * (1.0 - lag * 0.4) * 1.4;
        col = vec3(3.2, 2.2, 1.0);
        size *= 0.7;
      } else {
        float e = lt - rocket;
        float sp = (10.0 + rc.z * 8.0) * (0.78 + 0.44 * h1(seed + 2.0));
        p = centre + dir * sp * (1.0 - exp(-e * 2.6)) / 2.6 * 2.4 + vec3(0.0, -2.6, 0.0) * e * e;
        float fade = 1.0 - smoothstep(0.7, 2.2, e);
        float crackle = e > 1.2 ? step(0.5, fract(sin(seed * 91.7 + floor(t * 18.0)) * 43758.5)) : 1.0;
        a = fade * crackle * (1.0 - lag * 0.24);
        col = mix(mix(hueA, hueB, h1(seed + 8.0)) * 5.0, vec3(5.0, 4.6, 3.6), exp(-e * 6.0));
        size *= (1.0 + exp(-e * 4.0)) * (1.0 - lag * 0.18);
      }
      a *= uFireworks;
    } else if (k == 6) {
      // Dust motes drifting in the low sun.
      vec3 ph = h3(seed) * 6.2831;
      p += vec3(sin(t * 0.07 + ph.x) * 6.0, sin(t * 0.11 + ph.y) * 1.5, cos(t * 0.09 + ph.z) * 6.0);
      a = uDust * (0.4 + 0.6 * sin(t * 0.8 + ph.z) * sin(t * 0.8 + ph.z));
    } else if (k == 7) {
      // Embers rising from the wreck's furnace glow.
      float lt = fract(t * 0.18 + h1(seed));
      vec3 ph = h3(seed) * 6.2831;
      p += vec3(sin(lt * 9.0 + ph.x) * 0.8, lt * 7.0, cos(lt * 7.0 + ph.y) * 0.8);
      a = smoothstep(0.0, 0.1, lt) * (1.0 - lt) * (0.4 + 0.8 * uNight);
      col = mix(vec3(4.0, 1.4, 0.3), vec3(2.0, 0.3, 0.05), lt);
    } else {
      // Chimney smoke (alpha pass).
      float lt = fract(t * 0.07 + h1(seed));
      vec3 ph = h3(seed) * 6.2831;
      p += vec3(lt * 7.0 + sin(lt * 4.0 + ph.x) * 0.8, lt * 11.0, -lt * 3.0 + cos(lt * 3.0 + ph.y) * 0.8);
      size *= 1.0 + lt * 4.0;
      a = smoothstep(0.0, 0.12, lt) * (1.0 - smoothstep(0.5, 1.0, lt)) * 0.32;
    }
    vColor = col;
    vAlpha = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = a > 0.001 ? clamp(size * uPixel / -mv.z, 0.0, 256.0) : 0.0;
    #ifdef USE_FOG
    vFogDepth = -mv.z;
    #endif
  }
`;

const FRAG_ADD = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d > 1.0) discard;
    float f = pow(1.0 - d, vSoft) ;
    float core = exp(-d * 12.0) * 0.8;
    gl_FragColor = vec4(vColor * (f + core) * vAlpha, 1.0);
  }
`;

const FRAG_SMOKE = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.0 - d) * (1.0 - d) * vAlpha);
    #include <fog_fragment>
  }
`;

function points(list: P[], frag: string, uniforms: FxUniforms, additive: boolean): THREE.Points {
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const color = new Float32Array(n * 3);
  const data = new Float32Array(n * 4);
  const vel = new Float32Array(n * 3);
  list.forEach((p, i) => {
    pos.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
    kind[i] = p.kind;
    color.set([p.color.r, p.color.g, p.color.b], i * 3);
    data.set([p.size, p.seed ?? i * 0.618, p.param ?? 0, p.lag ?? 0], i * 4);
    const v = p.vel ?? new THREE.Vector3();
    vel.set([v.x, v.y, v.z], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: additive ? (uniforms as unknown as Record<string, THREE.IUniform>) : { ...(uniforms as unknown as Record<string, THREE.IUniform>), ...THREE.UniformsLib.fog },
    vertexShader: VERT,
    fragmentShader: additive ? frag : `#include <fog_pars_fragment>\n${frag}`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: !additive,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 8 : 5;
  return pts;
}

export interface FxSources {
  glows: GlowSpot[];
  forgeSparks: THREE.Vector3;
  chimneys: THREE.Vector3[];
  fountainSpouts: THREE.Vector3[];
  fountainWaterY: number;
  fountainCentre: THREE.Vector3;
  spray: THREE.Vector3[];
  embers: THREE.Vector3[];
  fireflyZones: { centre: THREE.Vector3; extent: THREE.Vector3; count: number; color: THREE.Color }[];
  dustCentre: THREE.Vector3;
  fireworksCentre: THREE.Vector3;
}

export function buildFx(src: FxSources, quality: 'low' | 'high', uTime: { value: number }): { group: THREE.Group; uniforms: FxUniforms } {
  const R = rng(5);
  const u: FxUniforms = {
    uTime,
    uLamps: { value: 1 },
    uFireflies: { value: 0.3 },
    uFireworks: { value: 0 },
    uDust: { value: 1 },
    uNight: { value: 0 },
    uPixel: { value: 800 },
  };
  const add: P[] = [];
  const kindParam = { lamp: 0, fire: 1, candle: 2, magic: 3 };
  for (const g of src.glows) add.push({ pos: g.pos, kind: Kind.Glow, color: g.color.clone().multiplyScalar(g.kind === 'magic' ? 1.4 : 1.5), size: g.size * 0.75, param: kindParam[g.kind], seed: R() * 100 });
  for (const z of src.fireflyZones) {
    for (let i = 0; i < z.count; i++) {
      const p = z.centre.clone().add(new THREE.Vector3((R() - 0.5) * 2 * z.extent.x, R() * z.extent.y, (R() - 0.5) * 2 * z.extent.z));
      add.push({ pos: p, kind: Kind.Firefly, color: z.color.clone().multiplyScalar(3.5), size: 0.11, vel: new THREE.Vector3(2.5, 1.0, 2.5), seed: R() * 100 });
    }
  }
  for (let i = 0; i < 90; i++) add.push({ pos: src.forgeSparks, kind: Kind.Spark, color: new THREE.Color(), size: 0.09, seed: R() * 100 });
  const water = new THREE.Color(1, 1, 1);
  for (const s of src.fountainSpouts) {
    // Aim each jet outward and down into the basin, away from the claw.
    const out = s.clone().sub(src.fountainCentre).setY(0).normalize();
    for (let i = 0; i < (quality === 'high' ? 160 : 80); i++) {
      const v = out.clone().multiplyScalar(2.6 + R() * 0.4).add(new THREE.Vector3(0, 2.2 + R() * 0.4, 0));
      add.push({ pos: s, kind: Kind.Fountain, color: water, size: 0.14, vel: v, seed: R() * 100, param: src.fountainWaterY });
    }
  }
  for (const s of src.spray) for (let i = 0; i < 26; i++) add.push({ pos: s.clone().add(new THREE.Vector3((R() - 0.5) * 3, 0, (R() - 0.5) * 3)), kind: Kind.Spray, color: new THREE.Color(0.8, 0.85, 0.9), size: 0.2, seed: R() * 100, param: R() });
  for (const e of src.embers) for (let i = 0; i < 24; i++) add.push({ pos: e.clone().add(new THREE.Vector3((R() - 0.5) * 2, 0, (R() - 0.5) * 2)), kind: Kind.Ember, color: new THREE.Color(), size: 0.12, seed: R() * 100 });
  for (let i = 0; i < 160; i++) {
    const p = src.dustCentre.clone().add(new THREE.Vector3((R() - 0.5) * 50, 1 + R() * 7, (R() - 0.5) * 50));
    add.push({ pos: p, kind: Kind.Dust, color: new THREE.Color(1.6, 1.25, 0.8), size: 0.07, seed: R() * 100 });
  }
  const bursts = quality === 'high' ? 9 : 6;
  const perBurst = quality === 'high' ? 170 : 100;
  for (let b = 0; b < bursts; b++) {
    for (let i = 0; i < perBurst; i++) {
      // Even-ish directions on a sphere (Fibonacci), each with two trailing copies for streaks.
      const k = i + 0.5;
      const phi = Math.acos(1 - (2 * k) / perBurst);
      const th = Math.PI * (1 + Math.sqrt(5)) * k;
      const dir = new THREE.Vector3(Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi));
      const seed = R() * 100;
      for (let lag = 0; lag < 4; lag++) add.push({ pos: src.fireworksCentre, kind: Kind.Firework, color: new THREE.Color(), size: 0.62, vel: dir, seed, param: b, lag });
    }
  }
  const smoke: P[] = [];
  for (const c of src.chimneys) for (let i = 0; i < 26; i++) smoke.push({ pos: c, kind: Kind.Smoke, color: new THREE.Color('#5c5652'), size: 1.6, seed: R() * 100 });

  const group = new THREE.Group();
  group.name = 'fx';
  group.add(points(add, FRAG_ADD, u, true));
  group.add(points(smoke, FRAG_SMOKE, u, false));
  return { group, uniforms: u };
}
