// Vector fallbacks for ability, aura and menu icons. The painted icons from public/art/icons
// sit on top when they exist; these show when they do not.

type School = 'steel' | 'water' | 'frost' | 'steam' | 'holy' | 'heal' | 'ward' | 'rust' | 'moon' | 'stun';

const SCHOOL: Record<School, [string, string, string]> = {
  // inner, outer, glyph glow
  steel: ['#c8503a', '#3a0f0a', '#ffe1b0'],
  water: ['#2f9be8', '#0a2350', '#d6f6ff'],
  frost: ['#7fd8ff', '#0c3a6a', '#ffffff'],
  steam: ['#a8b8c8', '#2a3440', '#ffffff'],
  holy: ['#ffd36b', '#6a3a08', '#fffbe8'],
  heal: ['#4ee07a', '#0c4020', '#eaffee'],
  ward: ['#3fd8c8', '#0a3a40', '#f0fffb'],
  rust: ['#c0602a', '#3a1206', '#ffd0a0'],
  moon: ['#9a8aff', '#1a1450', '#f4f0ff'],
  stun: ['#ffcf4a', '#5a3a06', '#fffbe0'],
};

let uid = 0;

function frame(school: School, glyph: string): string {
  const [a, b, glow] = SCHOOL[school];
  const id = `ic${uid++}`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="${id}g" cx="40%" cy="32%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
<filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect width="64" height="64" fill="url(#${id}g)"/>
<g fill="none" stroke="${glow}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}f)" style="color:${glow}">${glyph}</g>
<rect width="64" height="64" fill="url(#${id}s)"/>
<rect x="1" y="1" width="62" height="62" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="2"/>
</svg>`;
}

const GLYPHS: Record<string, [School, string]> = {
  'pincer-strike': [
    'steel',
    `<path d="M16 50 C 12 34 18 18 36 14 C 31 22 30 27 33 31 L 47 23 C 52 33 45 46 30 47 Z" fill="currentColor" fill-opacity="0.25"/>
     <path d="M33 31 L 40 36"/><path d="M44 12 l 6 -4 M50 18 l 6 -2 M48 28 l 7 1"/>`,
  ],
  'shell-bash': [
    'steel',
    `<circle cx="30" cy="34" r="15" fill="currentColor" fill-opacity="0.2"/><circle cx="30" cy="34" r="5"/>
     <path d="M48 14 l 8 -6 M52 24 l 8 0 M42 8 l 3 -6"/>`,
  ],
  'sideways-charge': [
    'steel',
    `<path d="M8 22 H 30 M4 32 H 34 M8 42 H 30"/><path d="M38 18 L 56 32 L 38 46 Z" fill="currentColor" fill-opacity="0.35"/>`,
  ],
  whirlpool: [
    'water',
    `<path d="M32 32 m -2 0 a 2 2 0 1 1 4 0 a 6 6 0 1 1 -12 0 a 10 10 0 1 1 20 0 a 14 14 0 1 1 -28 0 a 18 18 0 1 1 36 0"/>`,
  ],
  'bubble-bolt': [
    'water',
    `<circle cx="34" cy="30" r="15" fill="currentColor" fill-opacity="0.18"/><path d="M26 22 a 10 10 0 0 1 8 -4"/>
     <circle cx="14" cy="48" r="4"/><circle cx="22" cy="54" r="2.5"/><path d="M6 58 L 20 44"/>`,
  ],
  'frost-spray': [
    'frost',
    `<path d="M32 8 V 56 M11 20 L 53 44 M11 44 L 53 20"/><path d="M26 12 l 6 6 l 6 -6 M26 52 l 6 -6 l 6 6 M12 28 l 8 -2 l -2 -8 M52 36 l -8 2 l 2 8 M12 36 l 8 2 l -2 8 M52 28 l -8 -2 l 2 -8"/>`,
  ],
  'steam-blink': [
    'steam',
    `<path d="M14 44 a 7 7 0 0 1 2 -13 a 9 9 0 0 1 17 -4 a 7 7 0 0 1 9 9 a 6 6 0 0 1 -2 8 Z" fill="currentColor" fill-opacity="0.25"/>
     <path d="M40 22 L 56 12 M50 12 h 6 v 6"/>`,
  ],
  'tidal-nova': [
    'water',
    `<circle cx="32" cy="32" r="6" fill="currentColor" fill-opacity="0.4"/><circle cx="32" cy="32" r="14"/><path d="M32 6 a 26 26 0 0 1 26 26 M32 58 a 26 26 0 0 1 -26 -26"/>`,
  ],
  smite: [
    'holy',
    `<path d="M26 4 h 12 l -2 36 h -8 Z" fill="currentColor" fill-opacity="0.35"/><path d="M14 52 h 36 M20 46 l -6 -6 M44 46 l 6 -6 M32 46 v 12"/>`,
  ],
  'mend-shell': [
    'heal',
    `<path d="M10 40 a 22 18 0 0 1 44 0 Z" fill="currentColor" fill-opacity="0.2"/><path d="M32 14 v 20 M22 24 h 20" stroke-width="5"/>`,
  ],
  'barnacle-ward': [
    'ward',
    `<circle cx="32" cy="32" r="22" fill="currentColor" fill-opacity="0.15"/>
     <path d="M32 18 l 8 5 v 9 l -8 5 l -8 -5 v -9 Z M32 37 v 9 M40 32 l 8 4 M24 32 l -8 4"/>`,
  ],
  'holy-tide': [
    'holy',
    `<circle cx="32" cy="32" r="9" fill="currentColor" fill-opacity="0.4"/><path d="M32 6 v 8 M32 50 v 8 M6 32 h 8 M50 32 h 8 M13 13 l 6 6 M45 45 l 6 6 M13 51 l 6 -6 M45 19 l 6 -6"/>`,
  ],
  // Auras
  stun: ['stun', `<path d="M32 10 l 5 12 l 13 1 l -10 8 l 3 13 l -11 -7 l -11 7 l 3 -13 l -10 -8 l 13 -1 Z" fill="currentColor" fill-opacity="0.4"/>`],
  slow: ['frost', `<path d="M32 10 V 54 M13 21 L 51 43 M13 43 L 51 21"/>`],
  rust: ['rust', `<path d="M32 10 C 22 26 18 32 18 40 a 14 14 0 0 0 28 0 C 46 32 42 26 32 10 Z" fill="currentColor" fill-opacity="0.35"/>`],
  ward: ['ward', `<path d="M32 10 l 18 8 v 12 c 0 12 -8 20 -18 24 c -10 -4 -18 -12 -18 -24 v -12 Z" fill="currentColor" fill-opacity="0.25"/>`],
  blessing: ['moon', `<path d="M40 12 a 20 20 0 1 0 12 30 a 16 16 0 1 1 -12 -30 Z" fill="currentColor" fill-opacity="0.35"/><path d="M18 46 q 6 -4 12 0 t 12 0"/>`],
  // Menu
  log: ['holy', `<path d="M16 12 h 28 a 4 4 0 0 1 4 4 v 36 h -28 a 4 4 0 0 1 -4 -4 Z M22 22 h 18 M22 30 h 18 M22 38 h 12"/>`],
  menu: ['steel', `<path d="M14 20 h 36 M14 32 h 36 M14 44 h 36"/>`],
  music: ['moon', `<path d="M24 46 V 16 l 22 -4 v 30"/><circle cx="19" cy="46" r="5" fill="currentColor"/><circle cx="41" cy="42" r="5" fill="currentColor"/>`],
  'music-off': ['steel', `<path d="M24 46 V 16 l 22 -4 v 30"/><circle cx="19" cy="46" r="5" fill="currentColor"/><circle cx="41" cy="42" r="5" fill="currentColor"/><path d="M10 10 L 54 54" stroke="#ff6a5a"/>`],
  cog: ['rust', `<circle cx="32" cy="32" r="8"/><path d="M32 8 v 8 M32 48 v 8 M8 32 h 8 M48 32 h 8 M15 15 l 6 6 M43 43 l 6 6 M15 49 l 6 -6 M43 21 l 6 -6"/><circle cx="32" cy="32" r="16"/>`],
};

export function iconSvg(id: string): string {
  const g = GLYPHS[id] ?? GLYPHS.menu;
  return frame(g[0], g[1]);
}

/** Icon element: painted art if it loads, vector fallback underneath. */
export function iconEl(id: string, artPath: string | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:3px;border-radius:4px;overflow:hidden';
  wrap.innerHTML = iconSvg(id);
  const svg = wrap.firstElementChild as SVGElement;
  svg.style.cssText = 'width:100%;height:100%;display:block';
  if (artPath) {
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    img.onerror = () => img.remove();
    img.src = `${import.meta.env.BASE_URL}${artPath}`;
    wrap.append(img);
  }
  return wrap;
}
