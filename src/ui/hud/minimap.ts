// Round minimap (top right). The zone picture is a top-down render of the world made at load;
// the map turns with the camera so "up" is always where you are looking.
import { h } from '../dom';
import type { Game } from '../../game/game';
import type { MapSnapshot } from '../../game/snapshots';
import type { PoiId } from '../../world/types';

const POI_ICONS: Partial<Record<PoiId, { label: string; color: string }>> = {
  forge: { label: 'Forge', color: '#ff9a4a' },
  chapel: { label: 'Chapel', color: '#ffe9a0' },
  tavern: { label: 'Tavern', color: '#ffb36b' },
  grove: { label: 'Grove', color: '#b7a0ff' },
  lighthouse: { label: 'Lighthouse', color: '#fff3c0' },
  wreck: { label: 'Wreck', color: '#ff6a4a' },
};

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoneEl: HTMLElement;
  private northEl: HTMLElement;
  private snap: MapSnapshot | null = null;
  private acc = 0;
  /** World units from centre to rim. */
  radius = 52;
  private size = 196;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(private readonly game: Game) {
    this.canvas = h('canvas');
    this.canvas.width = this.canvas.height = Math.round(this.size * this.dpr);
    this.ctx = this.canvas.getContext('2d')!;
    this.zoneEl = h('div', { class: 'mm-zone' }, 'Clawhaven');
    this.northEl = h('div', { class: 'mm-n' }, 'N');
    const ring = h('div', { class: 'mm-ring hud-i', title: 'Mouse wheel over the map to zoom' }, this.canvas, this.northEl);
    ring.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.radius = Math.max(25, Math.min(110, this.radius * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    this.el = h('div', { class: 'mm' }, this.zoneEl, ring);
  }

  setSnapshot(s: MapSnapshot): void {
    this.snap = s;
  }

  setZone(name: string, combat: boolean): void {
    if (this.zoneEl.textContent !== name) this.zoneEl.textContent = name;
    this.zoneEl.classList.toggle('combat', combat);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const g = this.game;
    const c = this.ctx;
    const S = this.canvas.width;
    const half = S / 2;
    const scale = half / this.radius;
    const p = g.player.unit.pos;
    const a = g.follow.forwardYaw;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const rx = -Math.cos(a);
    const rz = Math.sin(a);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - p.x;
      const dz = z - p.z;
      return [half + (dx * rx + dz * rz) * scale, half - (dx * fx + dz * fz) * scale];
    };

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(half, half, half, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1d3d52';
    c.fillRect(0, 0, S, S);
    if (this.snap) {
      const s = this.snap;
      const k = s.size / s.canvas.width;
      c.setTransform(
        scale * rx * k,
        -scale * fx * k,
        scale * rz * k,
        -scale * fz * k,
        half + scale * (rx * (s.minX - p.x) + rz * (s.minZ - p.z)),
        half - scale * (fx * (s.minX - p.x) + fz * (s.minZ - p.z)),
      );
      c.imageSmoothingEnabled = true;
      c.drawImage(s.canvas, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Warm parchment wash so the render reads as a map.
    const grad = c.createRadialGradient(half, half, half * 0.2, half, half, half);
    grad.addColorStop(0, 'rgba(255, 230, 180, 0.04)');
    grad.addColorStop(1, 'rgba(40, 20, 0, 0.45)');
    c.fillStyle = grad;
    c.fillRect(0, 0, S, S);

    const d = this.dpr;
    // POIs
    c.font = `600 ${10 * d}px Georgia, serif`;
    c.textAlign = 'center';
    for (const [id, info] of Object.entries(POI_ICONS)) {
      const poi = g.world.pois[id as PoiId];
      if (!poi) continue;
      const [x, y] = toScreen(poi.position.x, poi.position.z);
      if (Math.hypot(x - half, y - half) > half - 6 * d) continue;
      c.fillStyle = info!.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2 * d;
      c.beginPath();
      c.arc(x, y, 3.5 * d, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.lineWidth = 3 * d;
      // Keep the whole label inside the round map: below the dot near the top edge, and slid
      // sideways along the rim instead of cut off by it.
      let ly = y - 7 * d;
      if (ly - 10 * d < half - Math.sqrt(Math.max(0, (half - 8 * d) ** 2 - (x - half) ** 2))) ly = y + 14 * d;
      const w = c.measureText(info!.label).width;
      const chord = Math.sqrt(Math.max(0, (half - 10 * d) ** 2 - (ly - 4 * d - half) ** 2));
      const lx = Math.min(Math.max(x, half - chord + w / 2), half + chord - w / 2);
      c.strokeText(info!.label, lx, ly);
      c.fillText(info!.label, lx, ly);
    }
    // Units
    for (const u of g.units) {
      if (u.kind === 'player' || u.hidden || !u.alive) continue;
      const [x, y] = toScreen(u.pos.x, u.pos.z);
      if (Math.hypot(x - half, y - half) > half - 4 * d) continue;
      if (u.hostile) {
        c.fillStyle = u.kind === 'boss' ? '#ff2a1a' : '#ff4a3a';
        c.beginPath();
        c.arc(x, y, (u.kind === 'boss' ? 5 : 2.6) * d, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#2a0000';
        c.lineWidth = 1 * d;
        c.stroke();
      } else {
        const mark = g.questMark(u);
        if (mark) {
          c.font = `900 ${15 * d}px Georgia, serif`;
          c.lineWidth = 3 * d;
          c.strokeStyle = '#000';
          c.fillStyle = mark === '?' ? '#bdbdb5' : '#ffd200';
          const ch = mark === '!' ? '!' : '?';
          c.strokeText(ch, x, y + 5 * d);
          c.fillText(ch, x, y + 5 * d);
          c.font = `600 ${10 * d}px Georgia, serif`;
        } else if (u.kind === 'npc') {
          c.fillStyle = '#ffe58a';
          c.beginPath();
          c.arc(x, y, 2.4 * d, 0, Math.PI * 2);
          c.fill();
        } else {
          c.fillStyle = 'rgba(160, 230, 140, 0.8)';
          c.beginPath();
          c.arc(x, y, 1.6 * d, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    // Quest objective: a gold star, pinned to the rim when off the map.
    const obj = g.objectivePos();
    if (obj) {
      let [x, y] = toScreen(obj.x, obj.z);
      const dist = Math.hypot(x - half, y - half);
      const rim = half - 11 * d;
      const pulse = 1 + Math.sin(g.time * 5) * 0.12;
      if (dist > rim) {
        const ang = Math.atan2(y - half, x - half);
        x = half + Math.cos(ang) * rim;
        y = half + Math.sin(ang) * rim;
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.fillStyle = '#ffd23a';
        c.strokeStyle = '#3a2400';
        c.lineWidth = 1.5 * d;
        c.beginPath();
        c.moveTo(9 * d * pulse, 0);
        c.lineTo(-5 * d, -7 * d);
        c.lineTo(-2 * d, 0);
        c.lineTo(-5 * d, 7 * d);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      } else {
        star(c, x, y, 7.5 * d * pulse, '#ffd23a');
      }
    }
    c.restore();

    // Player arrow
    const py = g.player.unit.yaw;
    const vx = Math.sin(py) * rx + Math.cos(py) * rz;
    const vy = -(Math.sin(py) * fx + Math.cos(py) * fz);
    const ang = Math.atan2(vy, vx);
    c.save();
    c.translate(half, half);
    c.rotate(ang + Math.PI / 2);
    c.fillStyle = '#ffe9a0';
    c.strokeStyle = '#1a1000';
    c.lineWidth = 2 * d;
    c.beginPath();
    c.moveTo(0, -9 * d);
    c.lineTo(6.5 * d, 7 * d);
    c.lineTo(0, 3.5 * d);
    c.lineTo(-6.5 * d, 7 * d);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // "N" marker on the rim: world -Z is north, which lands at (-rz, fz) on screen.
    this.northEl.style.left = `${(0.5 - rz * 0.5) * this.size}px`;
    this.northEl.style.top = `${(0.5 + fz * 0.5) * this.size}px`;
  }
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.save();
  c.translate(x, y);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.shadowColor = 'rgba(255, 200, 40, 0.9)';
  c.shadowBlur = 8;
  c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = '#3a2400';
  c.lineWidth = 1.5;
  c.stroke();
  c.restore();
}

