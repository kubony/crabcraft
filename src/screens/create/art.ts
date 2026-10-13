// Vector fallbacks for the character creation art: race portraits, class emblems, sex medallions
// and frame ornaments. Painted WebP files from public/art/ replace them when present; these keep
// the screen finished-looking before (or without) the 2D art pass.
import type { ClassId, RaceId, Sex } from '../../crab/types';
import { RACES } from '../../data/races';

/** Wrap SVG markup as a data URI usable in <img src> or CSS url(). */
export function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const GOLD_STOPS = `<stop offset="0" stop-color="#fff3c2"/><stop offset=".35" stop-color="#f0c868"/><stop offset=".62" stop-color="#a87422"/><stop offset="1" stop-color="#f6d98a"/>`;

interface Theme {
  bg: [string, string, string];
  rim: string;
}

const RACE_THEME: Record<RaceId, Theme> = {
  human: { bg: ['#7fa6ff', '#2c4aa6', '#0b1433'], rim: '#ffe7a6' },
  orc: { bg: ['#c6d66a', '#4f6d21', '#101a07'], rim: '#ffcf7a' },
  dwarf: { bg: ['#ffc27a', '#a2531f', '#250f05'], rim: '#ffd9a0' },
  undead: { bg: ['#a7ff8a', '#3f5a48', '#0c0f14'], rim: '#c9ffb8' },
  nightelf: { bg: ['#c7a8ff', '#3e2f8f', '#0a0820'], rim: '#e6dcff' },
  tauren: { bg: ['#ffd38a', '#7a5229', '#1a1007'], rim: '#ffe2a8' },
};

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const out = f >= 0 ? v + (255 - v) * f : v * (1 + f);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// A pincer pointing up with its base at the origin; mirrored for the right claw.
const CLAW = 'M-9 4 C-15 -8 -15 -22 -8 -32 C-4 -38 2 -40 6 -37 L1 -26 L10 -31 C14 -24 13 -12 9 -4 C5 3 -2 7 -9 4 Z';

/** Front-view bust of a Jumper crab in this race's default paint and gear. */
export function portraitSvg(race: RaceId, sex: Sex): string {
  const r = RACES[race];
  const t = RACE_THEME[race];
  const shell = r.shellColors[0].hex;
  const led = r.ledColors[0].hex;
  const hi = shade(shell, 0.35);
  const lo = shade(shell, -0.45);
  const female = sex === 'female';

  const eyes = female
    ? `<ellipse cx="54" cy="73" rx="6.2" ry="7.4" fill="${led}" filter="url(#glow)"/>
       <ellipse cx="74" cy="73" rx="6.2" ry="7.4" fill="${led}" filter="url(#glow)"/>
       <ellipse cx="55.5" cy="71" rx="2" ry="2.4" fill="#fff" opacity=".85"/>
       <ellipse cx="75.5" cy="71" rx="2" ry="2.4" fill="#fff" opacity=".85"/>
       <path d="M47 67 l-3 -3 M49 65.5 l-1.5 -3.6 M81 67 l3 -3 M79 65.5 l1.5 -3.6" stroke="${led}" stroke-width="1.6" stroke-linecap="round" filter="url(#glow)"/>`
    : `<rect x="48" y="66" width="11" height="14" rx="3.2" fill="${led}" filter="url(#glow)"/>
       <rect x="69" y="66" width="11" height="14" rx="3.2" fill="${led}" filter="url(#glow)"/>
       <rect x="50" y="68" width="3" height="4" rx="1" fill="#fff" opacity=".8"/>
       <rect x="71" y="68" width="3" height="4" rx="1" fill="#fff" opacity=".8"/>`;

  const gear = raceGear(race, sex, shell, led);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs>
  <radialGradient id="bg" cx="50%" cy="38%" r="70%">
    <stop offset="0" stop-color="${t.bg[0]}"/><stop offset=".45" stop-color="${t.bg[1]}"/><stop offset="1" stop-color="${t.bg[2]}"/>
  </radialGradient>
  <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${hi}"/><stop offset=".45" stop-color="${shell}"/><stop offset="1" stop-color="${lo}"/>
  </linearGradient>
  <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#34343e"/><stop offset=".3" stop-color="#0d0d12"/><stop offset="1" stop-color="#050507"/>
  </linearGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2f5f8"/><stop offset=".5" stop-color="#9aa3ad"/><stop offset="1" stop-color="#3e444c"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">${GOLD_STOPS}</linearGradient>
  <linearGradient id="ivory" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#e6d6b4"/><stop offset="1" stop-color="#8f7a58"/>
  </linearGradient>
  <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="vig" cx="50%" cy="50%" r="50%">
    <stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/>
  </radialGradient>
</defs>
<rect width="128" height="128" fill="url(#bg)"/>
<g opacity=".18" fill="${t.rim}">
  <path d="M64 30 L20 -10 L44 -10 Z"/><path d="M64 30 L84 -10 L108 -10 Z"/><path d="M64 30 L128 6 L128 26 Z"/><path d="M64 30 L0 6 L0 26 Z"/>
</g>
<ellipse cx="64" cy="112" rx="46" ry="10" fill="#000" opacity=".35"/>
<g stroke="${lo}" stroke-width="7" stroke-linecap="round" fill="none">
  <path d="M30 88 L14 104 L10 124"/><path d="M98 88 L114 104 L118 124"/>
</g>
<g stroke="${shell}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".9">
  <path d="M30 88 L14 104 L10 124"/><path d="M98 88 L114 104 L118 124"/>
</g>
<g transform="translate(26 90) rotate(-18)">
  <path d="M0 0 L-4 -18" stroke="${lo}" stroke-width="8" stroke-linecap="round"/>
  <g transform="translate(-4 -18)"><path d="${CLAW}" fill="url(#shell)" stroke="${lo}" stroke-width="1.2"/>
  <path d="M-8 -6 C-11 -16 -9 -26 -4 -32" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round"/></g>
</g>
<g transform="translate(102 90) rotate(18) scale(-1 1)">
  <path d="M0 0 L-4 -18" stroke="${lo}" stroke-width="8" stroke-linecap="round"/>
  <g transform="translate(-4 -18)"><path d="${CLAW}" fill="url(#shell)" stroke="${lo}" stroke-width="1.2"/></g>
</g>
<path d="M22 86 C20 60 36 42 64 42 C92 42 108 60 106 86 C106 95 96 100 64 100 C32 100 22 95 22 86 Z" fill="url(#shell)" stroke="${lo}" stroke-width="1.2"/>
<path d="M30 62 C36 50 48 46 60 46" stroke="#fff" stroke-opacity=".55" stroke-width="3.4" fill="none" stroke-linecap="round"/>
<ellipse cx="44" cy="55" rx="3" ry="1.6" fill="#fff" opacity=".8" transform="rotate(-30 44 55)"/>
<circle cx="25" cy="86" r="5" fill="url(#steel)"/><circle cx="103" cy="86" r="5" fill="url(#steel)"/>
<rect x="38" y="59" width="52" height="27" rx="10" fill="url(#visor)" stroke="#000" stroke-width="1"/>
<path d="M42 63 Q64 58 86 63" stroke="#fff" stroke-opacity=".22" stroke-width="2" fill="none"/>
${eyes}
${gear}
<rect width="128" height="128" fill="url(#vig)"/>
</svg>`;
}

function raceGear(race: RaceId, sex: Sex, shell: string, led: string): string {
  const female = sex === 'female';
  switch (race) {
    case 'human':
      return `
<path d="M38 52 C42 36 86 36 90 52 C80 47 48 47 38 52 Z" fill="url(#steel)" stroke="#2a2e35" stroke-width="1"/>
<path d="M36 53 C50 46 78 46 92 53" stroke="url(#gold)" stroke-width="3.2" fill="none"/>
<circle cx="64" cy="48" r="3.2" fill="#2f63e8" stroke="url(#gold)" stroke-width="1.4"/>
<path d="M64 40 C60 22 72 8 92 10 C82 14 78 20 80 26 C74 22 70 30 68 40 Z" fill="${female ? '#f2f2f6' : '#2f5fe0'}" stroke="${female ? '#9aa' : '#16307a'}" stroke-width="1"/>
<path d="M66 36 C66 26 72 18 84 14" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none"/>`;
    case 'orc':
      return `
<path d="M64 44 L58 22 L64 14 L70 22 Z" fill="url(#steel)" stroke="#222" stroke-width="1"/>
<rect x="57" y="40" width="14" height="6" rx="2" fill="#5a3418" stroke="#2a1508" stroke-width="1"/>
<g stroke="#1d1408" stroke-width="3.2" stroke-linecap="round" opacity=".75">
  <path d="M30 70 L40 64"/><path d="M28 78 L40 72"/><path d="M98 70 L88 64"/><path d="M100 78 L88 72"/>
</g>
<path d="M46 98 C40 92 38 84 42 74 C44 82 48 88 52 94 Z" fill="url(#ivory)" stroke="#5a4a30" stroke-width="1"/>
<path d="M82 98 C88 92 90 84 86 74 C84 82 80 88 76 94 Z" fill="url(#ivory)" stroke="#5a4a30" stroke-width="1"/>
${female ? '<circle cx="64" cy="22" r="3" fill="#c33" stroke="#511" stroke-width="1"/>' : ''}`;
    case 'dwarf':
      return `
<path d="M40 52 C42 36 86 36 88 52 Z" fill="url(#steel)" stroke="#2a2e35" stroke-width="1"/>
<path d="M38 52 L90 52" stroke="url(#gold)" stroke-width="3"/>
<path d="M42 46 C30 44 22 34 22 22 C28 30 34 34 44 38 Z" fill="url(#ivory)" stroke="#5a4a30" stroke-width="1"/>
<path d="M86 46 C98 44 106 34 106 22 C100 30 94 34 84 38 Z" fill="url(#ivory)" stroke="#5a4a30" stroke-width="1"/>
<g fill="#cfd4da">${[34, 46, 82, 94].map((x) => `<circle cx="${x}" cy="${x < 64 ? 66 + (x - 34) * 0.2 : 66 + (94 - x) * 0.2}" r="1.6"/>`).join('')}</g>
<path d="M48 86 C50 100 56 112 64 120 C72 112 78 100 80 86 Z" fill="${female ? '#c46a2c' : '#8a4c22'}" stroke="#3a1d0a" stroke-width="1"/>
<path d="M56 88 L60 94 L56 100 L60 106 L58 112 M72 88 L68 94 L72 100 L68 106 L70 112 M64 88 L64 118" stroke="#3a1d0a" stroke-width="1.4" fill="none" opacity=".7"/>
<circle cx="64" cy="118" r="3" fill="url(#gold)"/>
<path d="M50 90 Q64 96 78 90" stroke="${led}" stroke-width="1" fill="none" opacity=".6" filter="url(#glow)"/>`;
    case 'undead':
      return `
<path d="M18 92 C14 60 30 30 64 28 C98 30 114 60 110 92 L104 84 L100 94 L94 80 C96 56 84 44 64 44 C44 44 32 56 34 80 L28 94 L24 84 Z" fill="#2c2733" stroke="#120f17" stroke-width="1"/>
<path d="M30 70 C34 52 46 38 64 36" stroke="#4a4256" stroke-width="2" fill="none" opacity=".8"/>
<path d="M44 50 L50 56 L46 60 L54 66" stroke="#141014" stroke-width="1.6" fill="none"/>
<path d="M84 92 L88 86 L84 82" stroke="#141014" stroke-width="1.4" fill="none"/>
<path d="M88 52 C92 56 92 60 96 62" stroke="#d64b3b" stroke-width="1.4" fill="none"/>
<path d="M90 54 C95 57 94 63 99 64" stroke="#e6c43a" stroke-width="1.2" fill="none"/>
<rect x="69" y="66" width="11" height="14" rx="3.2" fill="#000" opacity="${female ? 0 : 0.55}"/>`;
    case 'nightelf':
      return `
<path d="M40 66 C30 60 16 44 6 22 C20 36 30 48 42 58 Z" fill="${shade(shell, 0.15)}" stroke="#120c2a" stroke-width="1"/>
<path d="M88 66 C98 60 112 44 122 22 C108 36 98 48 86 58 Z" fill="${shade(shell, 0.15)}" stroke="#120c2a" stroke-width="1"/>
<path d="M10 26 C16 34 22 40 30 48" stroke="#e8ecff" stroke-width="1.2" fill="none" opacity=".8"/>
<path d="M118 26 C112 34 106 40 98 48" stroke="#e8ecff" stroke-width="1.2" fill="none" opacity=".8"/>
<path d="M70 48 A8 8 0 1 1 70 40 A6 6 0 1 0 70 48 Z" fill="#e8ecff" opacity=".9" transform="translate(-6 -2)"/>
<path d="M40 50 C52 40 76 40 88 50" stroke="#9fe6b0" stroke-width="2.2" fill="none" stroke-dasharray="5 3" opacity=".85"/>
${female ? `<circle cx="64" cy="40" r="2.4" fill="${led}" filter="url(#glow)"/>` : ''}`;
    case 'tauren':
      return `
<path d="M38 50 C22 50 10 40 8 18 C14 28 22 34 34 38 C38 40 40 44 40 48 Z" fill="url(#ivory)" stroke="#4a3a24" stroke-width="1.2"/>
<path d="M90 50 C106 50 118 40 120 18 C114 28 106 34 94 38 C90 40 88 44 88 48 Z" fill="url(#ivory)" stroke="#4a3a24" stroke-width="1.2"/>
<path d="M9 19 C11 24 13 27 16 30" stroke="#3b2a18" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M119 19 C117 24 115 27 112 30" stroke="#3b2a18" stroke-width="3" fill="none" stroke-linecap="round"/>
<ellipse cx="64" cy="92" rx="6" ry="5" fill="none" stroke="url(#gold)" stroke-width="2.4"/>
<g>${[30, 36, 42].map((y, i) => `<circle cx="${24 - i}" cy="${y + 64}" r="2.6" fill="${['#c0392b', '#e6c43a', '#2e86c1'][i]}"/>`).join('')}</g>
${female ? '<path d="M96 52 C104 58 104 70 98 78" stroke="#e8d6b0" stroke-width="3" fill="none" stroke-linecap="round"/>' : ''}`;
  }
}

/** Class emblem: a square painted badge (frame is CSS). */
export function classEmblemSvg(id: ClassId): string {
  const defs = `<defs>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">${GOLD_STOPS}</linearGradient>
  <linearGradient id="blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d969f"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#6b737c"/></linearGradient>
  <radialGradient id="shield" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e6a35c"/><stop offset=".6" stop-color="#9a5420"/><stop offset="1" stop-color="#4a2209"/></radialGradient>
  <radialGradient id="orb" cx="40%" cy="35%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#8ff6ff"/><stop offset="1" stop-color="#0a7fb0"/></radialGradient>
  <radialGradient id="flame" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".4" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff9a1f" stop-opacity="0"/></radialGradient>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a2210"/><stop offset=".5" stop-color="#8a5a2e"/><stop offset="1" stop-color="#2a1608"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;
  const rays = (color: string, op: number) =>
    `<g fill="${color}" opacity="${op}">${Array.from({ length: 12 }, (_, i) => `<path d="M50 50 L${50 + 80 * Math.cos((i * Math.PI) / 6 - 0.09)} ${50 + 80 * Math.sin((i * Math.PI) / 6 - 0.09)} L${50 + 80 * Math.cos((i * Math.PI) / 6 + 0.09)} ${50 + 80 * Math.sin((i * Math.PI) / 6 + 0.09)} Z"/>`).join('')}</g>`;
  let body = '';
  if (id === 'warrior') {
    body = `
<radialGradient id="bgw" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#ffcf6a"/><stop offset=".35" stop-color="#e2461b"/><stop offset=".75" stop-color="#6a0d06"/><stop offset="1" stop-color="#1c0302"/></radialGradient>
<rect width="100" height="100" fill="url(#bgw)"/>${rays('#ffe2a0', 0.16)}
<g transform="rotate(42 50 52)">
  <path d="M46.5 0 L50 -6 L53.5 0 L54 66 L46 66 Z" fill="url(#blade)" stroke="#2b2f35" stroke-width="1" transform="translate(0 4)"/>
  <path d="M50 0 L50 70" stroke="#ffffff" stroke-opacity=".6" stroke-width=".8"/>
  <rect x="34" y="69" width="32" height="6" rx="2" fill="url(#gold)" stroke="#4a2c07" stroke-width="1"/>
  <rect x="47" y="75" width="6" height="15" fill="#3a1d0c" stroke="#1a0c04" stroke-width="1"/>
  <circle cx="50" cy="93" r="4.5" fill="url(#gold)" stroke="#4a2c07" stroke-width="1"/>
</g>
<circle cx="50" cy="54" r="21" fill="url(#shield)" stroke="url(#gold)" stroke-width="3.6"/>
<circle cx="50" cy="54" r="14" fill="none" stroke="#5a2a0a" stroke-width="1.1" opacity=".7"/>
<path d="M43 49 C41 44 44 40 48 41.5 L46.5 46 L51 43.5 C53 47 50.5 51.5 47 52.5 Z M57 49 C59 44 56 40 52 41.5 L53.5 46 L49 43.5 C47 47 49.5 51.5 53 52.5 Z" fill="url(#gold)" stroke="#4a2c07" stroke-width=".8" transform="translate(0 4)"/>
<circle cx="50" cy="62" r="3" fill="url(#gold)"/>`;
  } else if (id === 'mage') {
    body = `
<radialGradient id="bgm" cx="62%" cy="30%" r="80%"><stop offset="0" stop-color="#b8fbff"/><stop offset=".3" stop-color="#2fa7d8"/><stop offset=".7" stop-color="#123a86"/><stop offset="1" stop-color="#050b24"/></radialGradient>
<rect width="100" height="100" fill="url(#bgm)"/>${rays('#d8fbff', 0.12)}
<path d="M14 82 C30 92 56 90 70 74 C80 62 74 48 62 50 C52 52 54 64 62 62" stroke="#dffcff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>
<path d="M10 70 C26 80 48 78 60 66" stroke="#7fe6ff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>
<path d="M24 92 L64 32" stroke="url(#wood)" stroke-width="6" stroke-linecap="round"/>
<path d="M58 40 C56 30 62 22 70 22 C78 22 82 30 80 38" stroke="url(#gold)" stroke-width="3" fill="none"/>
<circle cx="68" cy="28" r="11" fill="url(#orb)" filter="url(#glow)"/>
<ellipse cx="64" cy="24" rx="3.6" ry="2.4" fill="#fff" opacity=".9"/>
<g fill="#e8feff">${[[30, 26, 1.6], [84, 58, 1.2], [20, 44, 1], [86, 14, 1.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
  } else {
    body = `
<radialGradient id="bgp" cx="50%" cy="46%" r="72%"><stop offset="0" stop-color="#fffbe8"/><stop offset=".28" stop-color="#f3cf6e"/><stop offset=".62" stop-color="#7a4a8a"/><stop offset="1" stop-color="#160a26"/></radialGradient>
<rect width="100" height="100" fill="url(#bgp)"/>${rays('#fff6d6', 0.25)}
<path d="M50 10 C44 10 42 16 46 18 L54 18 C58 16 56 10 50 10 Z" fill="none" stroke="url(#gold)" stroke-width="2.6"/>
<path d="M38 24 L62 24 L58 18 L42 18 Z" fill="url(#gold)" stroke="#4a2c07" stroke-width="1"/>
<path d="M38 24 L62 24 L66 66 L34 66 Z" fill="#2a1505" opacity=".35"/>
<circle cx="50" cy="46" r="15" fill="url(#flame)"/>
<path d="M50 34 C44 42 44 52 50 56 C56 52 56 42 50 34 Z" fill="#fff8d8" filter="url(#glow)"/>
<path d="M38 24 L34 66 M62 24 L66 66 M50 24 L50 34 M50 56 L50 66" stroke="url(#gold)" stroke-width="3" stroke-linecap="round"/>
<path d="M30 66 L70 66 L64 74 L36 74 Z" fill="url(#gold)" stroke="#4a2c07" stroke-width="1"/>
<path d="M40 74 L60 74 L56 82 L44 82 Z" fill="url(#gold)" stroke="#4a2c07" stroke-width="1" opacity=".9"/>
<path d="M24 88 L50 82 L76 88 L76 92 L50 86 L24 92 Z" fill="#6a1f2a" stroke="url(#gold)" stroke-width="1.2"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}${body}</svg>`;
}

/** Gold male/female glyph on transparent background. */
export function sexGlyphSvg(sex: Sex): string {
  const glyph =
    sex === 'male'
      ? `<circle cx="42" cy="58" r="20"/><path d="M56 44 L76 24 M60 24 L76 24 L76 40"/>`
      : `<circle cx="50" cy="40" r="20"/><path d="M50 60 L50 86 M38 74 L62 74"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${GOLD_STOPS}</linearGradient></defs>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="#1b1203" stroke-width="14" opacity=".75">${glyph}</g>
  <g stroke="url(#g)" stroke-width="9">${glyph}</g>
  <g stroke="#fff6cf" stroke-width="2" opacity=".55" transform="translate(-1.5 -1.5)">${glyph}</g>
</g></svg>`;
}

/** Gold corner filigree with a claw curl and a ruby, drawn for the top-left corner. */
export function cornerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${GOLD_STOPS}</linearGradient>
<radialGradient id="ruby" cx="40%" cy="35%" r="60%"><stop offset="0" stop-color="#ffb3a8"/><stop offset=".4" stop-color="#d0202a"/><stop offset="1" stop-color="#4a0508"/></radialGradient></defs>
<g fill="none" stroke="#1a1004" stroke-width="5" stroke-linecap="round" opacity=".7">
  <path d="M6 60 V16 Q6 6 16 6 H60"/>
</g>
<path d="M6 60 V16 Q6 6 16 6 H60" fill="none" stroke="url(#g)" stroke-width="3" stroke-linecap="round"/>
<path d="M13 52 V20 Q13 13 20 13 H52" fill="none" stroke="url(#g)" stroke-width="1.3" opacity=".85"/>
<path d="M4 30 C14 30 22 24 24 14 C18 18 12 16 10 10 C18 4 30 6 34 14 C36 24 28 34 16 36 C10 37 6 34 4 30 Z" fill="url(#g)" stroke="#3a2406" stroke-width="1"/>
<path d="M30 4 C30 14 24 22 14 24 C18 18 16 12 10 10" fill="none" stroke="#3a2406" stroke-width="1" opacity=".6"/>
<circle cx="22" cy="22" r="5.2" fill="url(#ruby)" stroke="url(#g)" stroke-width="2"/>
<circle cx="20.5" cy="20.5" r="1.4" fill="#fff" opacity=".8"/>
</svg>`;
}

/** Small gold diamond rule ornament for dividers. */
export function dividerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 16" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a77a28" stop-opacity="0"/><stop offset=".25" stop-color="#c99a3e"/><stop offset=".5" stop-color="#fff0b0"/><stop offset=".75" stop-color="#c99a3e"/><stop offset="1" stop-color="#a77a28" stop-opacity="0"/></linearGradient></defs>
<rect x="0" y="7" width="240" height="1.6" fill="url(#g)"/>
<path d="M120 2 L126 8 L120 14 L114 8 Z" fill="#f0c868" stroke="#5a3a0a" stroke-width="1"/>
<path d="M104 8 L110 5 L110 11 Z M136 8 L130 5 L130 11 Z" fill="#d9a640"/>
</svg>`;
}

/** Fine stone grain and mottling as a tileable SVG noise, for the stone frames. */
export function grainUri(): string {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
<filter id="a" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="4" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .9 .9 .9 0 -1.25"/></filter>
<filter id="b" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="4" seed="9" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.6 0 0 0 .95"/></filter>
<rect width="100%" height="100%" filter="url(#b)" opacity=".55"/>
<rect width="100%" height="100%" filter="url(#a)" opacity=".5"/>
</svg>`);
}

/** Parchment fibres and stains. */
export function fibreUri(): string {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
<filter id="f" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".012 .2" numOctaves="3" seed="2" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 .45  0 0 0 0 .28  0 0 0 0 .1  0 0 -1.4 0 .62"/></filter>
<filter id="s" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".006" numOctaves="3" seed="7" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 .5  0 0 0 0 .3  0 0 0 0 .08  1.8 0 0 0 -.95"/></filter>
<rect width="100%" height="100%" filter="url(#s)" opacity=".5"/>
<rect width="100%" height="100%" filter="url(#f)" opacity=".45"/>
</svg>`);
}

/** A torn paper edge as a CSS clip-path polygon (pixel jitter, so it scales with the element). */
export function tornEdge(seed: number): string {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const jitter = (t: number) => {
    const smooth = 2.2 + 2.2 * Math.sin(t * 37 + seed) * Math.sin(t * 11 + seed * 2);
    const tear = rnd() < 0.08 ? 3 + rnd() * 5 : rnd() * 1.6;
    return Math.max(0, smooth + tear).toFixed(1);
  };
  const pts: string[] = [];
  const n = 46;
  for (let i = 0; i <= n; i++) pts.push(`${((i / n) * 100).toFixed(2)}% ${jitter(i / n)}px`);
  for (let i = 1; i <= n; i++) pts.push(`calc(100% - ${jitter(i / n + 3)}px) ${((i / n) * 100).toFixed(2)}%`);
  for (let i = n - 1; i >= 0; i--) pts.push(`${((i / n) * 100).toFixed(2)}% calc(100% - ${jitter(i / n + 7)}px)`);
  for (let i = n - 1; i >= 1; i--) pts.push(`${jitter(i / n + 11)}px ${((i / n) * 100).toFixed(2)}%`);
  return `polygon(${pts.join(', ')})`;
}

const SEAL_WAX: Record<ClassId, [string, string, string]> = {
  warrior: ['#e2463a', '#a3161b', '#4a0607'],
  mage: ['#5aa8ff', '#1d4fb8', '#0a1a4a'],
  priest: ['#ffe28a', '#c99a2e', '#5a3c08'],
};

/** A wax seal with ribbon tails, pressed with a crab claw, in the class colour. */
export function waxSealSvg(id: ClassId): string {
  const [hi, mid, lo] = SEAL_WAX[id];
  // Irregular blob edge.
  const pts: string[] = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 40 + 3.2 * Math.sin(i * 2.7) + 2.2 * Math.cos(i * 5.3);
    pts.push(`${(60 + Math.cos(a) * r).toFixed(1)} ${(56 + Math.sin(a) * r).toFixed(1)}`);
  }
  const blob = `M${pts[0]} ` + pts.slice(1).map((p, i) => (i % 2 ? `L${p}` : `Q${p}`)).join(' ') + ' Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 130">
<defs>
  <radialGradient id="wax" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
  <radialGradient id="press" cx="55%" cy="60%" r="60%"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
  <linearGradient id="rib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#2a1404" flood-opacity=".55"/></filter>
</defs>
<g filter="url(#sh)">
  <path d="M44 74 L30 126 L40 118 L48 128 L58 80 Z" fill="url(#rib)"/>
  <path d="M76 74 L90 126 L80 118 L72 128 L62 80 Z" fill="url(#rib)"/>
  <path d="${blob}" fill="url(#wax)"/>
</g>
<circle cx="60" cy="56" r="27" fill="url(#press)" opacity=".85"/>
<circle cx="60" cy="56" r="27" fill="none" stroke="${lo}" stroke-width="2" opacity=".7"/>
<circle cx="60.8" cy="57" r="27" fill="none" stroke="${hi}" stroke-width="1" opacity=".5"/>
<circle cx="60" cy="56" r="21" fill="none" stroke="${lo}" stroke-width="1" stroke-dasharray="1.5 3" opacity=".8"/>
<g transform="translate(60 70) scale(0.62)">
  <path d="${CLAW}" fill="none" stroke="${lo}" stroke-width="3" transform="translate(-0.8 -0.8)" opacity=".85"/>
  <path d="${CLAW}" fill="${mid}" stroke="${hi}" stroke-width="1.6"/>
</g>
<path d="M34 42 C39 31 49 25 60 24" stroke="#fff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
}
