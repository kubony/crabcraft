// Material helpers shared by the zone: stylised colour grading for kit materials, wind sway for
// foliage (works with Mesh, InstancedMesh and BatchedMesh), and a few procedural materials.
import * as THREE from 'three';
import { GLSL_NOISE } from './noise';

/** Shared wind and time uniforms. */
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
};

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** Chain an onBeforeCompile patch onto a material without losing earlier ones. */
export function addPatch(mat: THREE.Material, key: string, patch: Patch): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|${key}`;
  mat.needsUpdate = true;
}

/**
 * Push albedo saturation and warmth a little (AgX tone mapping desaturates strongly). `hue` rotates
 * the albedo hue in radians (YIQ space), used to recolour kit foliage.
 */
export function stylise(mat: THREE.Material, sat = 1.25, tint: [number, number, number] = [1.03, 1.0, 0.95], hue = 0): void {
  addPatch(mat, `sty${sat}${tint.join()}${hue}`, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        ${
          hue !== 0
            ? `vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c;
        float hh = atan(yiq.z, yiq.y) + ${hue.toFixed(4)};
        float ch = length(yiq.yz);
        c = max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * vec3(yiq.x, ch * cos(hh), ch * sin(hh)), vec3(0.0));`
            : ''
        }
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = max(mix(vec3(l), c, ${sat.toFixed(3)}), vec3(0.0)) * vec3(${tint.map((v) => v.toFixed(3)).join(',')});
      }`,
    );
  });
}

/**
 * Wind sway: bends vertices by height above the instance origin. `stiff` is the height (in local
 * units) where motion reaches full strength; `amp` the displacement at that height.
 */
export function windSway(mat: THREE.Material, amp: number, stiff: number, freq = 1.0, flutter = 0.0): void {
  addPatch(mat, `wind${amp}${stiff}${freq}${flutter}`, (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = WORLD_UNIFORMS.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec2 uWind;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 origin = vec3(0.0);
          #ifdef USE_INSTANCING
            origin = instanceMatrix[3].xyz;
          #endif
          #ifdef USE_BATCHING
            origin = getBatchingMatrix(getIndirectIndex(gl_DrawID))[3].xyz;
          #endif
          origin = (modelMatrix * vec4(origin, 1.0)).xyz;
          float h = max(position.y, 0.0) / ${stiff.toFixed(3)};
          float bend = h * h;
          float ph = dot(origin.xz, vec2(0.11, 0.07));
          float gust = sin(uTime * ${(0.9 * freq).toFixed(3)} + ph) * 0.6 + sin(uTime * ${(2.1 * freq).toFixed(3)} + ph * 1.7) * 0.3 + 0.35;
          vec2 d = uWind * gust * ${amp.toFixed(3)} * bend;
          transformed.xz += d;
          ${flutter > 0 ? `transformed += normal * sin(uTime * 7.0 + dot(position, vec3(3.1, 2.3, 1.7)) + ph) * ${flutter.toFixed(3)} * h;` : ''}
        }`,
      );
  });
}

/**
 * Rusted riveted iron. Plates are laid out along `axis` (the ship's length) and either vertically
 * (hull sides) or across the deck. Rust patches, run-off streaks and a dark wet waterline band.
 */
export function rustMaterial(opts: { axis: THREE.Vector3; deck?: boolean; base?: string; rust?: string }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.5 });
  const u = {
    uBase: { value: new THREE.Color(opts.base ?? '#3d3a38') },
    uRust: { value: new THREE.Color(opts.rust ?? '#b04e1c') },
    uAxis: { value: opts.axis.clone().setY(0).normalize() },
  };
  addPatch(mat, `rust${opts.deck ? 'd' : 'h'}`, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRW;\nuniform vec3 uBase;\nuniform vec3 uRust;\nuniform vec3 uAxis;\n${GLSL_NOISE}\nfloat ccRust;`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float along = dot(vRW.xz, uAxis.xz);
          float across = dot(vRW.xz, vec2(-uAxis.z, uAxis.x));
          vec2 pc = ${opts.deck ? 'vec2(along / 2.6, across / 2.6)' : 'vec2(along / 3.2, vRW.y / 1.45)'};
          vec2 cell = floor(pc);
          vec2 f = fract(pc);
          float seam = smoothstep(0.0, 0.035, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
          // Rivet rows just inside the seams.
          vec2 rv = fract(pc * vec2(${opts.deck ? '8.0, 8.0' : '9.0, 6.0'}));
          float edge = 1.0 - smoothstep(0.06, 0.1, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
          float rivet = edge * (1.0 - smoothstep(0.18, 0.3, length(rv - 0.5)));
          float plateTone = cc_hash12(cell) * 0.18 - 0.09;
          float n = cc_fbm(vRW.xz * 0.28 + vRW.y * 0.31);
          float n2 = cc_fbm(vec2(along, vRW.y) * 0.9 + 3.0);
          float streak = cc_vnoise(vec2(along * 4.0, vRW.y * 0.35)) * smoothstep(0.2, 0.9, cc_vnoise(vec2(along * 0.7, 1.0)));
          ccRust = clamp(smoothstep(0.5, 0.82, n + n2 * 0.35) + ${opts.deck ? '0.1' : 'streak * 0.5'} + (1.0 - seam) * 0.3, 0.0, 1.0);
          vec3 darkRust = uRust * 0.42;
          vec3 c = mix(uBase * (1.0 + plateTone), mix(darkRust, uRust, smoothstep(0.4, 0.9, n2)), ccRust);
          c *= mix(0.55, 1.0, seam);
          c = mix(c, c * 1.35 + 0.02, rivet * 0.8);
          // Wet, weedy waterline.
          float wet = 1.0 - smoothstep(-0.2, 0.9, vRW.y);
          c = mix(c, vec3(0.05, 0.07, 0.05) + vec3(0.02, 0.06, 0.03) * cc_vnoise(vRW.xz * 3.0), wet * 0.85);
          diffuseColor.rgb *= c;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.48, 0.95, ccRust);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.7, 0.08, ccRust);');
  });
  return mat;
}

/** Simple coloured standard material (sRGB hex). */
export function std(color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** Weathered planks for procedural boxes (gangway, pier posts, gate beam): grain along local x. */
export function plankMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  addPatch(m, 'planks', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPW;\n${GLSL_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float grain = cc_vnoise(vec2((vPW.x + vPW.z) * 0.6, vPW.y * 9.0 + (vPW.x - vPW.z) * 2.0));
          float knot = smoothstep(0.82, 0.95, cc_vnoise(vPW.xz * 1.3 + vPW.y));
          vec3 c = mix(vec3(0.42, 0.27, 0.15), vec3(0.58, 0.40, 0.24), grain);
          c = mix(c, vec3(0.25, 0.15, 0.08), knot * 0.6);
          diffuseColor.rgb *= c;
        }`,
      );
  });
  return m;
}
