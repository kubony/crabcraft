// Procedural canvas textures for the tabletop arena. No downloaded art: every pixel is made here.
import * as THREE from 'three';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 1D value noise with smooth interpolation, period `n`. */
function noise1(n: number, seed: number): (x: number) => number {
  const r = rng(seed);
  const v = Array.from({ length: n }, r);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = v[((i % n) + n) % n];
    const b = v[(((i + 1) % n) + n) % n];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/**
 * Varnished walnut desk planks. Returns colour and roughness maps; the texture spans `planks`
 * boards across U and the grain runs along V.
 */
export function woodTextures(size = 1024, planks = 8): { map: THREE.Texture; roughness: THREE.Texture } {
  const [c, ctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const pw = size / planks;
  const r = rng(7);
  const plankTone = Array.from({ length: planks }, () => 0.86 + r() * 0.24);
  const plankHue = Array.from({ length: planks }, () => r() * 0.08 - 0.04);
  const plankShift = Array.from({ length: planks }, () => r() * 1000);
  const plankFreq = Array.from({ length: planks }, () => 5 + r() * 4);
  const warp = noise1(256, 3);
  const fibre = noise1(1024, 11);
  const fibre2 = noise1(1024, 13);
  const blotch = noise1(128, 5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = Math.floor(x / pw);
      const lx = (x - p * pw) / pw;
      const s = plankShift[p];
      // Long straight fibres along the board, with slow cathedral arches of the growth rings.
      const fib = 0.6 * fibre(x * 1.7 + s) + 0.4 * fibre2(x * 5.3 + s * 2);
      const arch = warp((y + s) * 0.004) * 3.2 + warp((y + s) * 0.019) * 0.6;
      const ring = (lx - 0.5) * (lx - 0.5) * plankFreq[p] * 6 + arch;
      const fr = ring - Math.floor(ring);
      const line = Math.max(0, 1 - Math.abs(fr - 0.5) * 9); // thin dark latewood line
      const bl = blotch((y + s * 5) * 0.01);
      let tone = plankTone[p] * (0.9 + 0.18 * fib) * (1 - 0.32 * line) * (0.94 + 0.12 * bl);
      const edge = Math.min(lx, 1 - lx) * pw;
      if (edge < 1.2) tone *= 0.35;
      else if (edge < 2.6) tone *= 0.75;
      const i = (y * size + x) * 4;
      const hue = plankHue[p];
      img.data[i] = Math.min(255, (122 + hue * 200) * tone);
      img.data[i + 1] = Math.min(255, (74 + hue * 60) * tone);
      img.data[i + 2] = Math.min(255, 42 * tone);
      img.data[i + 3] = 255;
      const rough = edge < 2.6 ? 0.9 : 0.42 + 0.2 * line + 0.1 * (1 - fib);
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.min(255, rough * 255);
      rimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughness = new THREE.CanvasTexture(rc);
  for (const t of [map, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.generateMipmaps = true;
  }
  return { map, roughness };
}

/** Classic black-and-white football: 12 pentagons and 20 hexagons with dark seams (equirect). */
export function soccerTexture(w = 1024, h = 512): THREE.Texture {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico: THREE.Vector3[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    ico.push(new THREE.Vector3(0, a, b * phi), new THREE.Vector3(a, b * phi, 0), new THREE.Vector3(b * phi, 0, a));
  }
  ico.forEach((v) => v.normalize());
  // Hexagon centres: the icosahedron's face centres.
  const faces: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    const d = 1.06;
    if (ico[i].distanceTo(ico[j]) < d * 1.1 && ico[i].distanceTo(ico[k]) < d * 1.1 && ico[j].distanceTo(ico[k]) < d * 1.1) {
      faces.push(ico[i].clone().add(ico[j]).add(ico[k]).normalize());
    }
  }
  const centres = [...ico.map((v) => ({ v, pent: true })), ...faces.map((v) => ({ v, pent: false }))];
  const d = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - y / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      d.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
      let best = -2, second = -2, pent = false;
      for (const cn of centres) {
        // Pentagons are smaller than hexagons on a truncated icosahedron: weight them down.
        const dot = d.dot(cn.v) + (cn.pent ? -0.012 : 0);
        if (dot > best) {
          second = best;
          best = dot;
          pent = cn.pent;
        } else if (dot > second) second = dot;
      }
      const seam = best - second < 0.006;
      const base = pent ? 22 : 242;
      const v = seam ? 70 : base;
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = pent && !seam ? 28 : v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A wooden alphabet block face: painted colour, a lighter inset and a letter. */
export function blockFace(letter: string, color: string): THREE.Texture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,248,230,0.9)';
  ctx.lineWidth = 12;
  ctx.strokeRect(22, 22, 212, 212);
  ctx.fillStyle = '#fff8e8';
  ctx.font = '900 168px "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round blob for contact shadows and bokeh sprites. */
export function radialTexture(inner = 'rgba(0,0,0,1)', outer = 'rgba(0,0,0,0)', size = 256, hard = 0): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, (size / 2) * hard, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The room behind the desk, as a wrap-around panorama: warm walls, bookshelves with book spines
 * and lamps. Rendered far out of focus, it reads like the TVC's bokeh backgrounds.
 */
export function roomPanorama(w = 4096, h = 1024, floor = '#3d2716', floorAt = 0.867): THREE.Texture {
  const [c, ctx] = canvas(w, h);
  const r = rng(42);
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#1c120b');
  wall.addColorStop(0.55, '#3e2817');
  wall.addColorStop(1, '#24170d');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // Shelving units.
  const units = 7;
  for (let u = 0; u < units; u++) {
    const x0 = (u / units) * w + 30;
    const uw = w / units - 60;
    if (r() < 0.25) continue;
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(x0, h * 0.08, uw, h * 0.9);
    const shelves = 4;
    for (let s = 0; s < shelves; s++) {
      const sy = h * 0.12 + (s * h * 0.84) / shelves;
      const sh = (h * 0.84) / shelves - 18;
      ctx.fillStyle = '#2b1a0e';
      ctx.fillRect(x0 + 14, sy, uw - 28, sh);
      // Books.
      let bx = x0 + 18;
      while (bx < x0 + uw - 40) {
        const bw = 12 + r() * 26;
        const bh = sh * (0.55 + r() * 0.4);
        if (r() < 0.12) {
          bx += bw * 2;
          continue;
        }
        const hue = [20, 32, 200, 350, 140, 45, 0][Math.floor(r() * 7)];
        const light = 30 + r() * 45;
        ctx.fillStyle = `hsl(${hue}, ${20 + r() * 40}%, ${light}%)`;
        ctx.fillRect(bx, sy + sh - bh, bw, bh);
        bx += bw + 2;
      }
      ctx.fillStyle = '#7b5230';
      ctx.fillRect(x0, sy + sh, uw, 18);
    }
  }
  // Warm light falling on the wall.
  for (let i = 0; i < 6; i++) {
    const x = r() * w, y = h * (0.2 + r() * 0.5), rad = 200 + r() * 300;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,200,130,0.35)');
    g.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Where the desk meets the wall, fade into the fog colour so the horizon has no seam.
  const fade = ctx.createLinearGradient(0, h * (floorAt - 0.14), 0, h * floorAt);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, floor);
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * (floorAt - 0.14), w, h * 0.14);
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * floorAt, w, h * (1 - floorAt));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
