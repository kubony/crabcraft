// Atmosphere and reaction particles for the creation stage: drifting golden dust motes in the
// key light, a dust puff when the crab lands, and gold sparks that spiral up from the rune ring.
import * as THREE from 'three';

const moteVert = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
void main() {
  vec3 p = position;
  float speed = 0.05 + 0.07 * fract(aSeed * 7.31);
  p.y = mod(p.y + uTime * speed, 4.2) - 0.3;
  p.x += sin(uTime * 0.21 + aSeed * 12.7) * 0.35;
  p.z += cos(uTime * 0.17 + aSeed * 5.3) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  float fade = smoothstep(-0.3, 0.4, p.y) * (1.0 - smoothstep(3.0, 3.9, p.y));
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + fract(aSeed * 3.7)) + aSeed * 40.0);
  // Brighter on the sunlit (key) side, as dust only shows where light hits it.
  float lit = 0.45 + 0.55 * smoothstep(1.5, -2.5, p.x - p.z * 0.4);
  vAlpha = fade * twinkle * lit;
}`;

const moteFrag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(uColor * a * vAlpha, a * vAlpha);
}`;

export interface Motes {
  points: THREE.Points;
  update(elapsed: number): void;
  setScale(pxPerUnit: number): void;
  dispose(): void;
}

export function createMotes(count = 320): Motes {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 1] = Math.random() * 4.2 - 0.3;
    pos[i * 3 + 2] = -5 + Math.random() * 8.5;
    seed[i] = Math.random();
    // Mostly fine dust, a few big soft out-of-focus flecks near the lens.
    size[i] = Math.random() < 0.08 ? 0.09 + Math.random() * 0.1 : 0.018 + Math.random() * 0.03;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: moteVert,
    fragmentShader: moteFrag,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 900 },
      uColor: { value: new THREE.Color(1.6, 1.15, 0.65) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return {
    points,
    update(elapsed) {
      mat.uniforms.uTime.value = elapsed;
    },
    setScale(px) {
      mat.uniforms.uScale.value = px;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CPU particle bursts (tens of particles, simulated in JS)
// ---------------------------------------------------------------------------------------------

const burstVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  vAlpha = aAlpha;
}`;

const burstFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uSoft;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.5 * uSoft, d) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; age: number;
  size0: number; size1: number;
  spin: number;
}

export interface Burst {
  points: THREE.Points;
  /** Ring of dust kicked up from the dais around (x, z) at height y. */
  puff(x: number, y: number, z: number, radius: number): void;
  /** Gold sparks rising in a spiral from a ring. */
  sparkle(y: number, radius: number): void;
  update(dt: number): void;
  setScale(pxPerUnit: number): void;
  dispose(): void;
}

export function createBurst(kind: 'dust' | 'spark', max = 120): Burst {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const dust = kind === 'dust';
  const mat = new THREE.ShaderMaterial({
    vertexShader: burstVert,
    fragmentShader: burstFrag,
    uniforms: {
      uScale: { value: 900 },
      uColor: { value: dust ? new THREE.Color(0.78, 0.66, 0.52) : new THREE.Color(2.4, 1.6, 0.6) },
      uSoft: { value: dust ? 0.0 : 0.15 },
    },
    transparent: true,
    depthWrite: false,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  const parts: P[] = [];

  const spawn = (p: P) => {
    if (parts.length >= max) parts.shift();
    parts.push(p);
  };

  return {
    points,
    puff(x, y, z, radius) {
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.5 + Math.random() * 0.6);
        const sp = 0.6 + Math.random() * 1.4;
        spawn({
          x: x + Math.cos(a) * r, y: y + 0.03, z: z + Math.sin(a) * r,
          vx: Math.cos(a) * sp, vy: 0.15 + Math.random() * 0.5, vz: Math.sin(a) * sp,
          life: 0.9 + Math.random() * 0.8, age: 0,
          size0: 0.08 + Math.random() * 0.08, size1: 0.35 + Math.random() * 0.3,
          spin: 0,
        });
      }
    },
    sparkle(y, radius) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        spawn({
          x: Math.cos(a) * radius, y: y + 0.02, z: Math.sin(a) * radius,
          vx: 0, vy: 0.5 + Math.random() * 1.3, vz: a,
          life: 0.9 + Math.random() * 0.9, age: 0,
          size0: 0.035 + Math.random() * 0.04, size1: 0.0,
          spin: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.5),
        });
      }
    },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) {
          parts.splice(i, 1);
          continue;
        }
        if (dust) {
          const drag = Math.exp(-dt * 3.2);
          p.vx *= drag;
          p.vz *= drag;
          p.vy = p.vy * Math.exp(-dt * 1.5) + 0.05 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
        } else {
          // vz holds the angle; sparks spiral inward and up.
          p.vz += p.spin * dt;
          const r = Math.hypot(p.x, p.z) * Math.exp(-dt * 0.5);
          p.x = Math.cos(p.vz) * r;
          p.z = Math.sin(p.vz) * r;
          p.y += p.vy * dt;
        }
      }
      for (let i = 0; i < max; i++) {
        const p = parts[i];
        if (!p) {
          alpha[i] = 0;
          size[i] = 0;
          continue;
        }
        const t = p.age / p.life;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        size[i] = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
        alpha[i] = dust ? 0.55 * (1 - t) * Math.min(1, t * 8) : (1 - t) * Math.min(1, t * 10) * (0.6 + 0.4 * Math.sin(p.age * 30 + i));
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
    setScale(px) {
      mat.uniforms.uScale.value = px;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}
