// Backdrop painting behind the dais. Uses public/art/create-bg.webp when it exists; otherwise
// paints a golden-hour harbour (sky, sun, sea, lighthouse headland, town and plaza) on a canvas
// with a brush-stroke pass, so the screen never shows an empty void.
import * as THREE from 'three';
import { loadTexture } from '../../core/assets';
import { makeCanvas, rng } from './textures';

export interface Backdrop {
  mesh: THREE.Mesh;
  /** True when the painted WebP was found, false for the procedural painting. */
  readonly painted: boolean;
  /** Resize the plane to cover the camera frustum (call on resize). */
  fit(camera: THREE.PerspectiveCamera, marginX?: number): void;
  dispose(): void;
}

const DISTANCE = 42;
/** The procedural painting is deterministic; paint it once per page. */
let paintingCache: HTMLCanvasElement | null = null;

export async function createBackdrop(): Promise<Backdrop> {
  let tex: THREE.Texture;
  let painted = true;
  try {
    tex = await loadTexture('art/create-bg.webp');
  } catch {
    painted = false;
    paintingCache ??= paintHarbour(2048, 1152);
    tex = new THREE.CanvasTexture(paintingCache);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const img = tex.image as { width: number; height: number };
  const aspect = img && img.width ? img.width / img.height : 16 / 9;
  const geo = new THREE.PlaneGeometry(1, 1);
  // Paintings are authored for screens; push them slightly brighter so AgX tone mapping keeps
  // their colours close to what the artist painted.
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.08, 1.04, 1.0), fog: false, depthWrite: true });
  // AgX tone mapping mutes saturated paint; pre-saturate the texture so it lands close to the
  // artist's colours. Clamped at zero so no channel goes negative.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(mix(vec3(l), diffuseColor.rgb, ${painted ? '1.15' : '1.35'}), vec3(0.0));
      }`,
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'backdrop';
  mesh.position.z = -DISTANCE;
  mesh.renderOrder = -10;
  return {
    mesh,
    painted,
    fit(camera, marginX = 0.12) {
      const h = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const w = h * camera.aspect;
      let pw = w * (1 + marginX);
      let ph = h * 1.08;
      if (pw / ph > aspect) ph = pw / aspect;
      else pw = ph * aspect;
      mesh.scale.set(pw, ph, 1);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
      mesh.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Procedural painting: Clawhaven harbour at golden hour, the town backlit by a low sun.
// ---------------------------------------------------------------------------------------------

function paintHarbour(W: number, H: number): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const rand = rng(1234);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const HZ = H * 0.535; // sea horizon
  const SUN = { x: W * 0.46, y: H * 0.49 };

  // ---- Sky ----
  const sky = ctx.createLinearGradient(0, 0, 0, HZ);
  sky.addColorStop(0, '#16224f');
  sky.addColorStop(0.25, '#2c3f80');
  sky.addColorStop(0.52, '#6c5f9c');
  sky.addColorStop(0.72, '#c9788a');
  sky.addColorStop(0.88, '#f59e6c');
  sky.addColorStop(1, '#ffcf86');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HZ + 2);

  const glow = (g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, SUN.x, SUN.y, W * 0.6, [[0, 'rgba(255,200,130,0.8)'], [0.22, 'rgba(255,150,90,0.38)'], [0.6, 'rgba(200,90,110,0.12)'], [1, 'rgba(160,80,120,0)']]);
  ctx.restore();

  // Sun rays, drawn sharp on a layer and blurred once (canvas filters are costly per call).
  const rays = layer(W, H);
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI + (i / 22) * Math.PI + R(-0.04, 0.04);
    const len = W * R(0.45, 0.85);
    const wdt = R(0.012, 0.035);
    rays.fillStyle = `rgba(255,214,160,${R(0.04, 0.11).toFixed(3)})`;
    rays.beginPath();
    rays.moveTo(SUN.x, SUN.y);
    rays.lineTo(SUN.x + Math.cos(a - wdt) * len, SUN.y + Math.sin(a - wdt) * len);
    rays.lineTo(SUN.x + Math.cos(a + wdt) * len, SUN.y + Math.sin(a + wdt) * len);
    rays.closePath();
    rays.fill();
  }
  composite(ctx, rays.canvas, 16, 'screen');

  // ---- Clouds: long golden-hour bands, violet on top, lit gold from below ----
  for (let li = 0; li < 3; li++) {
    const cl = layer(W, H);
    for (let i = 0; i < 22; i++) {
      const y = R(0.05, 0.42) * H;
      const x = R(-0.1, 1.1) * W;
      const w = R(220, 700);
      const h = R(12, 40) * (1 - y / H);
      const t = y / HZ;
      const nearSun = Math.max(0, 1 - Math.abs(x - SUN.x) / (W * 0.55));
      const top = `rgba(${Math.round(120 + 70 * t)},${Math.round(96 + 40 * t)},${Math.round(160 - 20 * t)},${(0.4 + 0.15 * li).toFixed(2)})`;
      const lit = `rgba(255,${Math.round(170 + 60 * nearSun)},${Math.round(110 + 70 * nearSun)},${(0.4 + 0.45 * nearSun).toFixed(2)})`;
      const g = cl.createLinearGradient(0, y - h, 0, y + h);
      g.addColorStop(0, top);
      g.addColorStop(0.55, top);
      g.addColorStop(1, lit);
      cl.fillStyle = g;
      for (let k = 0; k < 5; k++) {
        cl.beginPath();
        cl.ellipse(x + R(-w * 0.4, w * 0.4), y + R(-h * 0.3, h * 0.3), w * R(0.3, 0.6), h * R(0.5, 1), 0, 0, Math.PI * 2);
        cl.fill();
      }
    }
    composite(ctx, cl.canvas, 9 - li * 3, 'source-over');
  }

  // Sun disc on the horizon.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, SUN.x, SUN.y, 150, [[0, 'rgba(255,253,240,1)'], [0.25, 'rgba(255,240,200,0.95)'], [0.5, 'rgba(255,210,150,0.4)'], [1, 'rgba(255,190,120,0)']]);
  ctx.restore();

  // Brush the sky before any silhouettes go on, so their edges stay crisp.
  brushPass(ctx, W, HZ, rand);

  // ---- Far hills left and the lighthouse headland right, hazy violet ----
  ridge(ctx, 0, W * 0.44, HZ - H * 0.06, HZ + 2, H * 0.035, '#8a6c98', '#b0788c', rand);
  ctx.save();
  const cliff = ctx.createLinearGradient(0, H * 0.38, 0, HZ + 10);
  cliff.addColorStop(0, '#6e557e');
  cliff.addColorStop(1, '#8a6482');
  ctx.fillStyle = cliff;
  ctx.beginPath();
  ctx.moveTo(W * 0.56, HZ + 4);
  ctx.bezierCurveTo(W * 0.6, HZ - 6, W * 0.62, H * 0.45, W * 0.655, H * 0.43);
  ctx.lineTo(W * 0.7, H * 0.425);
  ctx.bezierCurveTo(W * 0.76, H * 0.41, W * 0.82, H * 0.44, W * 0.9, H * 0.45);
  ctx.lineTo(W * 0.9, HZ + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,130,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.56, HZ + 4);
  ctx.bezierCurveTo(W * 0.6, HZ - 6, W * 0.62, H * 0.45, W * 0.655, H * 0.43);
  ctx.stroke();
  ctx.restore();
  // Lighthouse.
  const lx = W * 0.675;
  const ly = H * 0.428;
  const th = H * 0.11;
  ctx.fillStyle = '#4c3b5a';
  ctx.beginPath();
  ctx.moveTo(lx - 15, ly);
  ctx.lineTo(lx - 10, ly - th);
  ctx.lineTo(lx + 10, ly - th);
  ctx.lineTo(lx + 15, ly);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,170,120,0.5)';
  ctx.fillRect(lx - 14, ly - th * 0.55, 3, th * 0.5);
  ctx.fillStyle = '#3a2c46';
  ctx.fillRect(lx - 15, ly - th - 5, 30, 5);
  ctx.fillStyle = '#ffeab0';
  ctx.fillRect(lx - 8, ly - th - 22, 16, 17);
  ctx.fillStyle = '#3a2c46';
  ctx.beginPath();
  ctx.moveTo(lx - 13, ly - th - 22);
  ctx.lineTo(lx, ly - th - 38);
  ctx.lineTo(lx + 13, ly - th - 22);
  ctx.closePath();
  ctx.fill();
  const lamp = layer(W, H);
  glow(lamp, lx, ly - th - 14, 110, [[0, 'rgba(255,244,200,1)'], [0.25, 'rgba(255,215,150,0.45)'], [1, 'rgba(255,200,120,0)']]);
  const beam = lamp.createLinearGradient(lx, 0, lx - W * 0.3, 0);
  beam.addColorStop(0, 'rgba(255,240,200,0.45)');
  beam.addColorStop(1, 'rgba(255,240,200,0)');
  lamp.fillStyle = beam;
  lamp.beginPath();
  lamp.moveTo(lx, ly - th - 14);
  lamp.lineTo(lx - W * 0.3, ly - th - 70);
  lamp.lineTo(lx - W * 0.3, ly - th + 30);
  lamp.closePath();
  lamp.fill();
  composite(ctx, lamp.canvas, 6, 'screen');

  // ---- Sea with a glitter road under the sun ----
  const sea = ctx.createLinearGradient(0, HZ, 0, H * 0.66);
  sea.addColorStop(0, '#f6b583');
  sea.addColorStop(0.1, '#b9808e');
  sea.addColorStop(0.45, '#4d5f8a');
  sea.addColorStop(1, '#24304e');
  ctx.fillStyle = sea;
  ctx.fillRect(0, HZ, W, H * 0.14);
  for (let i = 0; i < 1100; i++) {
    const t = Math.pow(rand(), 1.5);
    const y = HZ + 2 + t * H * 0.12;
    const spread = 14 + t * 300;
    const x = SUN.x + (rand() + rand() + rand() - 1.5) * spread;
    const w = R(6, 34) * (0.4 + t);
    ctx.fillStyle = `rgba(255,${Math.round(R(212, 248))},${Math.round(R(150, 205))},${R(0.25, 0.9).toFixed(2)})`;
    ctx.fillRect(x - w / 2, y, w, R(1, 2.4) * (0.6 + t));
  }
  // Boats at anchor, backlit.
  for (let i = 0; i < 6; i++) {
    const bx = W * R(0.34, 0.6);
    const by = H * R(0.552, 0.6);
    const s = (by / H) * R(0.9, 1.4);
    ctx.fillStyle = '#2e2440';
    ctx.beginPath();
    ctx.moveTo(bx - 34 * s, by);
    ctx.quadraticCurveTo(bx, by + 14 * s, bx + 38 * s, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2e2440';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - 120 * s);
    ctx.stroke();
    if (rand() < 0.6) {
      ctx.fillStyle = 'rgba(70,50,80,0.92)';
      ctx.beginPath();
      ctx.moveTo(bx + 3 * s, by - 112 * s);
      ctx.quadraticCurveTo(bx + 40 * s, by - 64 * s, bx + 3 * s, by - 16 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- Town: three backlit skyline layers framing the bay ----
  const layers = [
    { base: 0.62, minH: 70, maxH: 170, col: [136, 104, 150], rim: 0.5, win: 0.25 },
    { base: 0.68, minH: 110, maxH: 290, col: [86, 66, 110], rim: 0.55, win: 0.5 },
    { base: 0.75, minH: 160, maxH: 430, col: [44, 34, 60], rim: 0.6, win: 0.85 },
  ];
  layers.forEach((L, li) => {
    const leftEnd = W * (0.32 - li * 0.035);
    const rightStart = W * (0.66 + li * 0.04);
    skyline(ctx, -20, leftEnd, H * L.base, L.minH, L.maxH, L.col, L.rim, L.win, 'left', rand);
    skyline(ctx, rightStart, W + 20, H * L.base, L.minH, L.maxH, L.col, L.rim, L.win, 'right', rand);
    if (li === 2) {
      for (let k = 0; k < 6; k++) {
        tree(ctx, R(0, leftEnd), H * L.base + R(-10, 20), R(60, 110), L.col, rand);
        tree(ctx, R(rightStart, W), H * L.base + R(-10, 20), R(60, 110), L.col, rand);
      }
    }
  });

  // Quay across the bay.
  ctx.fillStyle = '#3c2f46';
  ctx.fillRect(W * 0.22, H * 0.64, W * 0.56, 18);
  ctx.fillStyle = 'rgba(255,180,120,0.35)';
  ctx.fillRect(W * 0.22, H * 0.64, W * 0.56, 3);

  // ---- Plaza ground, shaded, with a warm band of low sun ----
  const PY = H * 0.72;
  const ground = ctx.createLinearGradient(0, PY - 20, 0, H);
  ground.addColorStop(0, '#7a5c4c');
  ground.addColorStop(0.35, '#5a4338');
  ground.addColorStop(1, '#241a16');
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(0, PY + 30);
  ctx.quadraticCurveTo(W * 0.5, PY - 50, W, PY + 30);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, SUN.x, PY + H * 0.03, W * 0.4, [[0, 'rgba(255,170,110,0.35)'], [1, 'rgba(255,170,110,0)']]);
  ctx.restore();

  // ---- Haze over the horizon band ties the layers together ----
  const haze = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.78);
  haze.addColorStop(0, 'rgba(255,170,130,0)');
  haze.addColorStop(0.45, 'rgba(255,170,130,0.16)');
  haze.addColorStop(1, 'rgba(255,170,130,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, H * 0.4, W, H * 0.38);
  return c;
}

function layer(w: number, h: number): CanvasRenderingContext2D {
  return makeCanvas(w, h).getContext('2d')!;
}

/** Draw a layer onto the painting through one blur. */
function composite(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, blur: number, op: GlobalCompositeOperation): void {
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/**
 * One skyline layer: steep gables, towers with spires, crenellated keeps, all as one silhouette
 * against the low sun, with a warm rim on the roofline and a scatter of lit windows.
 */
function skyline(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  baseY: number,
  minH: number,
  maxH: number,
  col: number[],
  rim: number,
  win: number,
  outer: 'left' | 'right',
  rand: () => number,
): void {
  const R = (a: number, b: number) => a + (b - a) * rand();
  const path = new Path2D();
  const extras = new Path2D();
  const windows: [number, number, number][] = [];
  path.moveTo(x0, baseY + 60);
  let x = x0;
  while (x < x1) {
    // Taller toward the frame edge, lower toward the bay.
    const t = (x - x0) / (x1 - x0);
    const edge = outer === 'left' ? 1 - t : t;
    const hgt = minH + (maxH - minH) * (0.3 + 0.7 * edge) * R(0.6, 1.05);
    const w = R(60, 120) * (0.7 + 0.5 * (maxH / 430));
    const top = baseY - hgt;
    const kind = rand();
    path.lineTo(x, top);
    if (kind < 0.55) {
      const peak = w * R(0.55, 0.95);
      path.lineTo(x + w / 2, top - peak);
      path.lineTo(x + w, top);
      if (rand() < 0.45) {
        const cx = x + w * R(0.62, 0.74);
        const roofY = top - peak * (1 - (cx - x - w / 2) / (w / 2));
        extras.rect(cx, roofY - peak * 0.32, w * 0.09, peak * 0.4);
      }
    } else if (kind < 0.78) {
      const tw = w * 0.6;
      const tx = x + (w - tw) / 2;
      const tt = top - hgt * R(0.2, 0.42);
      const spire = tt - tw * R(1.4, 2.3);
      path.lineTo(tx, top);
      path.lineTo(tx, tt);
      path.lineTo(tx + tw / 2, spire);
      path.lineTo(tx + tw, tt);
      path.lineTo(tx + tw, top);
      path.lineTo(x + w, top);
      extras.moveTo(tx + tw / 2, spire);
      extras.lineTo(tx + tw / 2 + (outer === 'left' ? 1 : -1) * tw * 0.7, spire + tw * 0.18);
      extras.lineTo(tx + tw / 2, spire + tw * 0.36);
      extras.closePath();
      windows.push([tx + tw / 2, tt + 20, 1]);
    } else {
      const n = Math.max(3, Math.round(w / 18));
      for (let i = 0; i < n; i++) {
        const cx = x + (i / n) * w;
        path.lineTo(cx, top - 11);
        path.lineTo(cx + w / n / 2, top - 11);
        path.lineTo(cx + w / n / 2, top);
        path.lineTo(cx + w / n, top);
      }
    }
    const rows = Math.floor(hgt / 46);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 2; k++) {
        if (rand() > win * 0.5) continue;
        windows.push([x + w * (0.28 + k * 0.42), top + 24 + r * 46, 0]);
      }
    }
    x += w;
  }
  path.lineTo(x, baseY + 60);
  path.closePath();

  const [r, g, b] = col;
  const fill = ctx.createLinearGradient(0, baseY - maxH * 1.4, 0, baseY + 40);
  fill.addColorStop(0, `rgb(${Math.min(255, r + 24)},${Math.min(255, g + 14)},${Math.min(255, b + 14)})`);
  fill.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.fill(extras);
  ctx.save();
  ctx.strokeStyle = `rgba(255,178,120,${rim})`;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'screen';
  ctx.stroke(path);
  ctx.restore();
  for (const [wx, wy, round] of windows) {
    const a = 0.55 + 0.45 * rand();
    ctx.fillStyle = `rgba(255,${Math.round(R(186, 222))},${Math.round(R(100, 140))},${a.toFixed(2)})`;
    if (round) {
      ctx.beginPath();
      ctx.arc(wx, wy, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(wx - 5, wy, 10, 15);
    }
  }
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number[], rand: () => number): void {
  const [r, g, b] = col;
  ctx.fillStyle = `rgb(${Math.max(0, r - 10)},${g + 4},${Math.max(0, b - 8)})`;
  for (let k = 0; k < 9; k++) {
    const bx = x + (rand() - 0.5) * s * 0.9;
    const by = y - s * (0.45 + rand() * 0.75);
    const rr = s * (0.22 + rand() * 0.22);
    ctx.beginPath();
    ctx.arc(bx, by, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(x - s * 0.05, y - s * 0.5, s * 0.1, s * 0.5);
}

function ridge(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  yTop: number,
  yBase: number,
  amp: number,
  colTop: string,
  colBase: string,
  rand: () => number,
): void {
  const g = ctx.createLinearGradient(0, yTop - amp, 0, yBase);
  g.addColorStop(0, colTop);
  g.addColorStop(1, colBase);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, yBase);
  const phase = rand() * 10;
  for (let x = x0; x <= x1; x += 8) {
    const t = (x - x0) / (x1 - x0);
    const env = Math.sin(t * Math.PI) * 0.7 + 0.3 * (1 - t);
    const n = Math.sin(x * 0.004 + phase) * 0.5 + Math.sin(x * 0.011 + phase * 2) * 0.3 + Math.sin(x * 0.027) * 0.2;
    ctx.lineTo(x, yTop + (1 - env) * amp * 2 - n * amp);
  }
  ctx.lineTo(x1, yBase);
  ctx.closePath();
  ctx.fill();
}

/** Re-lay the sky (rows 0..h) as short, slightly jittered horizontal dabs so it reads as paint. */
function brushPass(ctx: CanvasRenderingContext2D, W: number, h: number, rand: () => number): void {
  const H = Math.ceil(h);
  const src = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < 12000; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * (H - 4));
    const k = (y * W + x) * 4;
    const len = 12 + rand() * 26;
    const wid = 3 + rand() * 5;
    const ang = (rand() - 0.5) * 0.25;
    const j = () => Math.round((rand() - 0.5) * 12);
    ctx.fillStyle = `rgba(${src[k] + j()},${src[k + 1] + j()},${src[k + 2] + j()},0.4)`;
    ctx.beginPath();
    ctx.ellipse(x, y, len, wid, ang, 0, Math.PI * 2);
    ctx.fill();
  }
}
