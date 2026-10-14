// Stylised bay water: depth tint from the terrain heightmap, animated shore foam, layered wave
// normals, sky reflection with fresnel, sun glint, and the lighthouse beam sweeping across it.
import * as THREE from 'three';
import { CC_SKY, CC_SKY_UNIFORMS, type SkyUniforms } from './sky';

export interface WaterUniforms {
  uHeight: { value: THREE.Texture };
  uOrigin: { value: THREE.Vector2 };
  uSize: { value: THREE.Vector2 };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uFoam: { value: THREE.Color };
  uBeamDir: { value: THREE.Vector2 };
  uBeamPos: { value: THREE.Vector3 };
  uBeam: { value: number };
  uSunLight: { value: THREE.Color };
  uLampGlow: { value: number };
}

export function createWater(
  sky: SkyUniforms,
  heightTex: THREE.Texture,
  origin: THREE.Vector2,
  size: THREE.Vector2,
  quality: 'low' | 'high',
): { mesh: THREE.Mesh; uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    uHeight: { value: heightTex },
    uOrigin: { value: origin },
    uSize: { value: size },
    uDeep: { value: new THREE.Color('#0b3a5c') },
    uShallow: { value: new THREE.Color('#2fb3a6') },
    uFoam: { value: new THREE.Color('#fff6e8') },
    uBeamDir: { value: new THREE.Vector2(1, 0) },
    uBeamPos: { value: new THREE.Vector3() },
    uBeam: { value: 0 },
    uSunLight: { value: new THREE.Color('#ffd1a0') },
    uLampGlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]) as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      uniform float uTime;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${CC_SKY_UNIFORMS}
      ${CC_SKY}
      uniform sampler2D uHeight;
      uniform vec2 uOrigin;
      uniform vec2 uSize;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform vec2 uBeamDir;
      uniform vec3 uBeamPos;
      uniform float uBeam;
      uniform vec3 uSunLight;
      uniform float uLampGlow;
      varying vec3 vWorld;

      vec2 waveGrad(vec2 p, float t) {
        // Sum of directional sines plus noise: returns d(height)/dx, d(height)/dz.
        vec2 g = vec2(0.0);
        vec2 dirs[4];
        dirs[0] = normalize(vec2(-1.0, 0.25));
        dirs[1] = normalize(vec2(-0.7, -0.6));
        dirs[2] = normalize(vec2(-0.9, 0.8));
        dirs[3] = normalize(vec2(0.2, 1.0));
        float freqs[4];
        freqs[0] = 0.21; freqs[1] = 0.37; freqs[2] = 0.73; freqs[3] = 1.31;
        for (int i = 0; i < 4; i++) {
          float f = freqs[i];
          float ph = dot(dirs[i], p) * f + t * (0.9 + f * 1.6);
          g += dirs[i] * cos(ph) * f * (0.32 / (1.0 + float(i)));
        }
        // Two octaves of value-noise ripples on top of the swell (analytic enough to stay smooth).
        vec2 q = p * 0.9 + t * vec2(-0.35, 0.12);
        float e = 0.12;
        float n0 = cc_vnoise(q) + 0.5 * cc_vnoise(q * 2.1 + 5.0);
        float nx = cc_vnoise(q + vec2(e, 0.0)) + 0.5 * cc_vnoise((q + vec2(e, 0.0)) * 2.1 + 5.0);
        float nz = cc_vnoise(q + vec2(0.0, e)) + 0.5 * cc_vnoise((q + vec2(0.0, e)) * 2.1 + 5.0);
        g += vec2(nx - n0, nz - n0) / e * 0.12;
        return g;
      }

      void main() {
        vec2 xz = vWorld.xz;
        vec2 uv = (xz - uOrigin) / uSize;
        float ground = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ground = -30.0;
        float depth = max(0.0, vWorld.y - ground);
        float dist = length(cameraPosition - vWorld);

        float t = uTime;
        vec2 g = waveGrad(xz, t) * mix(1.0, 0.35, smoothstep(60.0, 260.0, dist));
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);

        // Body colour by depth.
        float dk = 1.0 - exp(-depth * 0.32);
        vec3 body = mix(uShallow, uDeep, dk);
        // Subsurface glow on wave faces toward the sun.
        float sss = pow(max(dot(-v, uSunDir) * 0.5 + 0.5, 0.0), 4.0) * max(g.x * uSunDir.x + g.y * uSunDir.z, 0.0);
        body += uShallow * sss * 1.4 * uSunVis;
        // Diffuse light from the sky/sun on the body.
        body *= 0.55 + 0.45 * uSunLight;

        // Reflection.
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        vec3 refl = ccSky(r, 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        fres = clamp(fres * 1.15, 0.0, 1.0);
        vec3 col = mix(body, refl, fres);

        // Sun glint.
        vec3 hv = normalize(uSunDir + v);
        float spec = pow(max(dot(n, hv), 0.0), 380.0) * 18.0 + pow(max(dot(n, hv), 0.0), 40.0) * 0.25;
        col += uSunColor * spec * uSunVis;
        // Moon glint at night.
        vec3 hm = normalize(uMoonDir + v);
        col += vec3(0.6, 0.7, 1.0) * pow(max(dot(n, hm), 0.0), 300.0) * 6.0 * uMoon;

        // Shore foam: lapping bands that run up the beach plus noisy edge foam.
        float fn = texture2D(uNoise, (xz * 0.35 + vec2(t * 0.05, -t * 0.03)) / 9.0 + 0.5).g;
        float band = sin(depth * 6.0 - t * 1.6 + fn * 5.0) * 0.5 + 0.5;
        float shore = 1.0 - smoothstep(0.0, 0.55, depth);
        float foam = smoothstep(0.55, 0.9, band) * (1.0 - smoothstep(0.1, 1.1, depth)) * 0.85;
        foam = max(foam, smoothstep(0.35, 0.75, fn) * shore);
        foam = max(foam, shore * 0.55);
        // Whitecaps far out, sparse.
        foam += smoothstep(0.78, 0.92, texture2D(uNoise, (xz * 0.08 + t * 0.03) / 3.0).r) * smoothstep(8.0, 20.0, depth) * 0.25;
        col = mix(col, uFoam * (0.6 + 0.4 * uSunLight), clamp(foam, 0.0, 1.0));

        // Lighthouse beam on the water: a bright sweep along its heading plus a halo at the base.
        if (uBeam > 0.0) {
          vec2 toP = xz - uBeamPos.xz;
          float dl = length(toP);
          vec2 dirP = toP / max(dl, 0.001);
          float a = max(dot(dirP, uBeamDir), 0.0);
          float sweep = pow(a, 900.0) * smoothstep(8.0, 30.0, dl) * exp(-dl * 0.008);
          float sweep2 = pow(max(dot(dirP, -uBeamDir), 0.0), 900.0) * smoothstep(8.0, 30.0, dl) * exp(-dl * 0.008);
          float halo = exp(-dl * 0.06) * 0.6;
          float sparkle = 0.5 + 0.5 * cc_vnoise(xz * 2.0 + t);
          col += vec3(1.0, 0.86, 0.55) * ((sweep + sweep2) * (2.5 + 3.0 * sparkle * fres) + halo) * uBeam;
        }

        // Alpha: clear in the shallows so the sand shows through.
        float alpha = clamp(smoothstep(0.0, 1.8, depth) * 0.85 + fres * 0.4 + foam, 0.0, 1.0);
        alpha = max(alpha, smoothstep(0.0, 0.25, depth) * 0.35);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: true,
    fog: true,
  });
  Object.assign(mat.uniforms, sky, uniforms);
  // Fine grid near the bay only matters for wave silhouettes; the shading is all per pixel.
  const seg = quality === 'high' ? 8 : 4;
  const geo = new THREE.PlaneGeometry(4000, 4000, seg, seg).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.set(100, 0, 0);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
