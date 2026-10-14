// Painted sky dome: dusk gradient, sun and glow, drifting clouds, stars and moon at night.
// The same GLSL (CC_SKY) is reused by the water for reflections so the bay mirrors the sky.
import * as THREE from 'three';
import { GLSL_NOISE } from './noise';

export interface SkyUniforms {
  uSunDir: { value: THREE.Vector3 };
  uMoonDir: { value: THREE.Vector3 };
  uZenith: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGround: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uCloudLit: { value: THREE.Color };
  uCloudShade: { value: THREE.Color };
  uStars: { value: number };
  uMoon: { value: number };
  uSunVis: { value: number };
  uCloudCover: { value: number };
  uTime: { value: number };
  /** Tiling RGBA noise shared by sky and water (see terrain.noiseTexture). */
  uNoise: { value: THREE.Texture | null };
}

export function createSkyUniforms(uTime: { value: number }, noise: THREE.Texture | null = null): SkyUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0, 0.2, 1).normalize() },
    uMoonDir: { value: new THREE.Vector3(0, 0.5, 1).normalize() },
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uStars: { value: 0 },
    uMoon: { value: 0 },
    uSunVis: { value: 1 },
    uCloudCover: { value: 0.5 },
    uTime,
    uNoise: { value: noise },
  };
}

export const CC_SKY_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uStars;
uniform float uMoon;
uniform float uSunVis;
uniform float uCloudCover;
uniform float uTime;
uniform sampler2D uNoise;
`;

/** vec3 ccSky(vec3 dir, float detail): detail 1 adds sun disk, clouds and stars. */
export const CC_SKY = /* glsl */ `
${GLSL_NOISE}
float cc_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 ccSkyGradient(vec3 d) {
  float y = d.y;
  // Sun-side horizon glows gold; the opposite side shows a rosy band over a bluer sky.
  float side = dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)) * 0.5 + 0.5;
  vec3 hor = mix(uMid, uHorizon, smoothstep(0.15, 0.85, side));
  vec3 midc = mix(mix(uMid, uZenith, 0.82), mix(uMid, uHorizon, 0.35), smoothstep(0.3, 0.95, side));
  vec3 col = mix(hor, midc, smoothstep(0.0, 0.16, y));
  col = mix(col, uZenith, smoothstep(0.12, 0.7, y));
  col = mix(col, uGround, smoothstep(0.0, -0.1, y));
  float sd = max(dot(d, uSunDir), 0.0);
  // Broad warm glow around the sun, strongest along the horizon.
  float hz = 1.0 - smoothstep(-0.05, 0.45, y);
  col += uGlow * (pow(sd, 5.0) * (0.35 + 0.65 * hz) + pow(sd, 48.0) * 0.9) * uSunVis;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.35, 0.45, 0.75) * pow(md, 24.0) * 0.25 * uMoon;
  return col;
}
vec3 ccSky(vec3 d, float detail) {
  vec3 col = ccSkyGradient(d);
  if (detail < 0.5) return col;
  float y = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  // Sun disk (HDR so bloom catches it).
  col += uSunColor * smoothstep(0.99975, 0.99988, sd) * 30.0 * uSunVis;
  // Stars.
  if (uStars > 0.0 && y > -0.02) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float hs = cc_hash13(cell);
    if (hs > 0.985) {
      vec3 c = cell + 0.5 + (vec3(cc_hash13(cell + 1.7), cc_hash13(cell + 3.1), cc_hash13(cell + 5.3)) - 0.5) * 0.6;
      float dist = length(p - c);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hs * 4.0) + hs * 50.0);
      float b = smoothstep(0.32, 0.0, dist) * (hs - 0.985) / 0.015;
      col += vec3(0.9, 0.95, 1.0) * b * tw * 3.0 * uStars * smoothstep(-0.02, 0.15, y);
    }
  }
  // Moon.
  float md = dot(d, uMoonDir);
  if (uMoon > 0.0) {
    float disk = smoothstep(0.99955, 0.9997, md);
    float shade = 0.75 + 0.25 * cc_vnoise(d.xy * 900.0);
    col = mix(col, vec3(1.0, 0.97, 0.88) * 3.0 * shade, disk * uMoon);
  }
  // Clouds: a painterly band of cumulus low over the horizon plus high wisps.
  if (y > 0.0) {
    vec2 p = d.xz / (y + 0.06);
    vec2 wind = uTime * vec2(0.006, 0.0025);
    float c = texture2D(uNoise, (p * 0.55 + wind) / 3.0).r;
    float c2 = texture2D(uNoise, (p * 1.4 - wind * 1.7) / 9.0 + 0.3).g;
    float band = smoothstep(0.015, 0.08, y) * (1.0 - smoothstep(0.32, 0.7, y));
    float dens = smoothstep(0.62 - uCloudCover * 0.25, 0.82, c + c2 * 0.18) * band;
    float wisp = smoothstep(0.55, 0.8, texture2D(uNoise, (vec2(p.x * 0.25, p.y * 1.8) + wind * 2.0) / 5.0 + 0.6).a) * smoothstep(0.08, 0.3, y) * 0.5;
    float lit = clamp(pow(sd, 3.0) * 0.8 + (c2 - 0.35) * 0.9, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uGlow * pow(sd, 12.0) * 0.8 * uSunVis;
    col = mix(col, cc, clamp(dens * 0.92 + wisp * 0.45, 0.0, 1.0));
  }
  return col;
}
`;

export function createSky(u: SkyUniforms): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${CC_SKY_UNIFORMS}
      ${CC_SKY}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        gl_FragColor = vec4(ccSky(d, 1.0), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.scale.setScalar(1500);
  return mesh;
}
