// Procedural particle sprite atlas (4 x 2 cells of 128 px), drawn once on a canvas so effects
// never wait on image files.
import * as THREE from 'three';

export const Sprite = {
  Glow: 0,
  Star: 1,
  Smoke: 2,
  Bubble: 3,
  Flake: 4,
  Snow: 5,
  Ring: 6,
  Spark: 7,
} as const;

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;

export function createAtlas(): THREE.CanvasTexture {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * ATLAS_COLS;
  c.height = cell * ATLAS_ROWS;
  const g = c.getContext('2d')!;
  const origin = (i: number): [number, number] => [(i % ATLAS_COLS) * cell, Math.floor(i / ATLAS_COLS) * cell];
  const radial = (cx: number, cy: number, r: number, stops: [number, string][]) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    return grad;
  };

  // 0: soft glow
  {
    const [x, y] = origin(Sprite.Glow);
    g.fillStyle = radial(x + 64, y + 64, 62, [
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,255,255,0.85)'],
      [0.45, 'rgba(255,255,255,0.3)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(x, y, cell, cell);
  }
  // 1: four-point sparkle
  {
    const [x, y] = origin(Sprite.Star);
    g.save();
    g.translate(x + 64, y + 64);
    g.fillStyle = radial(0, 0, 30, [
      [0, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(-64, -64, 128, 128);
    for (let k = 0; k < 2; k++) {
      g.rotate(Math.PI / 2 * k);
      const lg = g.createLinearGradient(-62, 0, 62, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(-62, 0);
      g.quadraticCurveTo(0, -5, 62, 0);
      g.quadraticCurveTo(0, 5, -62, 0);
      g.fill();
    }
    g.restore();
  }
  // 2: smoke puff (lumpy blobs)
  {
    const [x, y] = origin(Sprite.Smoke);
    const rnd = mulberry(7);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 26;
      const r = 18 + rnd() * 22;
      g.fillStyle = radial(x + 64 + Math.cos(a) * d, y + 64 + Math.sin(a) * d, r, [
        [0, 'rgba(255,255,255,0.32)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      g.fillRect(x, y, cell, cell);
    }
  }
  // 3: bubble (rim plus highlight)
  {
    const [x, y] = origin(Sprite.Bubble);
    g.fillStyle = radial(x + 64, y + 64, 58, [
      [0, 'rgba(255,255,255,0.05)'],
      [0.75, 'rgba(255,255,255,0.18)'],
      [0.92, 'rgba(255,255,255,0.95)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.beginPath();
    g.arc(x + 64, y + 64, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = radial(x + 46, y + 44, 14, [
      [0, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(x, y, cell, cell);
  }
  // 4: rust flake (jagged shard)
  {
    const [x, y] = origin(Sprite.Flake);
    const rnd = mulberry(3);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 26 + rnd() * 30;
      const px = x + 64 + Math.cos(a) * r;
      const py = y + 64 + Math.sin(a) * r * 0.7;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.4})`;
      g.beginPath();
      g.arc(x + 40 + rnd() * 48, y + 44 + rnd() * 40, 4 + rnd() * 8, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  // 5: snowflake
  {
    const [x, y] = origin(Sprite.Snow);
    g.save();
    g.translate(x + 64, y + 64);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineCap = 'round';
    g.lineWidth = 7;
    for (let k = 0; k < 6; k++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -54);
      g.moveTo(0, -30);
      g.lineTo(-14, -44);
      g.moveTo(0, -30);
      g.lineTo(14, -44);
      g.stroke();
    }
    g.fillStyle = radial(0, 0, 24, [
      [0, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(-64, -64, 128, 128);
    g.restore();
  }
  // 6: thin ring
  {
    const [x, y] = origin(Sprite.Ring);
    g.fillStyle = radial(x + 64, y + 64, 60, [
      [0, 'rgba(255,255,255,0)'],
      [0.72, 'rgba(255,255,255,0)'],
      [0.86, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(x, y, cell, cell);
  }
  // 7: spark line (stretched along x)
  {
    const [x, y] = origin(Sprite.Spark);
    const lg = g.createLinearGradient(x, 0, x + cell, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(x + 64, y + 64, 62, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = radial(x + 64, y + 64, 20, [
      [0, 'rgba(255,255,255,1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    g.fillRect(x, y, cell, cell);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function mulberry(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
