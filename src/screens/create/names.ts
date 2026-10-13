// Race-flavoured crab-pun name generator for the Randomize button.
// Every result is 2 to 12 ASCII letters, capitalised, so it always passes name validation.
import type { RaceId, Sex } from '../../crab/types';

interface NameBook {
  /** Hand-written names, by sex. */
  male: string[];
  female: string[];
  /** Syllable kits for generated names: prefix + suffix. */
  prefix: string[];
  maleSuffix: string[];
  femaleSuffix: string[];
}

const BOOKS: Record<RaceId, NameBook> = {
  human: {
    male: ['Clawrence', 'Pinchard', 'Shelldon', 'Crabert', 'Clawford', 'Shellbert', 'Snapton', 'Pincival', 'Clawdric', 'Tidewell'],
    female: ['Clawdia', 'Shellby', 'Pincella', 'Crabigail', 'Shellena', 'Clawrette', 'Pearlina', 'Coralie', 'Marinna', 'Tidelle'],
    prefix: ['Claw', 'Pinch', 'Shell', 'Crab', 'Tide', 'Snap', 'Brine'],
    maleSuffix: ['ric', 'bert', 'ford', 'ton', 'wick', 'ald', 'win'],
    femaleSuffix: ['ette', 'ina', 'wyn', 'ia', 'elle', 'ora'],
  },
  orc: {
    male: ['Grukclaw', 'Snapjaw', 'Krabgar', 'Pinchgrok', 'Thrakshell', 'Gorsnap', 'Muzpinch', 'Krakkle', 'Shellgor', 'Zugsnap'],
    female: ['Snaggra', 'Grukka', 'Clawsha', 'Brakka', 'Pinchka', 'Shellga', 'Mogsnap', 'Krakka'],
    prefix: ['Gruk', 'Krag', 'Thrak', 'Zug', 'Mok', 'Gor', 'Brak', 'Snag', 'Durz'],
    maleSuffix: ['claw', 'snap', 'pinch', 'shell', 'jaw', 'krak', 'tusk', 'gar'],
    femaleSuffix: ['ka', 'ra', 'sha', 'ga', 'snap', 'claw'],
  },
  dwarf: {
    male: ['Barnabolt', 'Brassbeard', 'Coppergrip', 'Rivetclaw', 'Bronzeclaw', 'Durnsnap', 'Grimbolt', 'Bromsolder', 'Thorshell', 'Anvilpinch'],
    female: ['Brassilda', 'Copperwyn', 'Rivetta', 'Boltdis', 'Solderwyn', 'Pinchilda', 'Gemclaw', 'Ironella'],
    prefix: ['Brass', 'Copper', 'Rivet', 'Bolt', 'Iron', 'Barna', 'Thor', 'Dur', 'Brom', 'Anvil'],
    maleSuffix: ['beard', 'grip', 'claw', 'bolt', 'shell', 'snap', 'forge'],
    femaleSuffix: ['hilda', 'wyn', 'dis', 'ella', 'gret'],
  },
  undead: {
    male: ['Rattlebolt', 'Creakshell', 'Rustmoan', 'Grimpinch', 'Hollowclaw', 'Boneclack', 'Clattersby', 'Wheezegear', 'Mortsnap', 'Glooming'],
    female: ['Creakessa', 'Rustabelle', 'Wraithshell', 'Gloomina', 'Hollowyn', 'Morticlaw', 'Clackina', 'Witherella'],
    prefix: ['Rattle', 'Creak', 'Rust', 'Grim', 'Hollow', 'Mort', 'Bone', 'Clatter', 'Gloom', 'Wither'],
    maleSuffix: ['claw', 'shell', 'pinch', 'bolt', 'gear', 'snip', 'clack'],
    femaleSuffix: ['ina', 'essa', 'wyn', 'ella', 'shell'],
  },
  nightelf: {
    male: ['Tidewhisper', 'Moonpincer', 'Sylvaclaw', 'Starsnap', 'Nightclaw', 'Duskshell', 'Mistpincer', 'Shadeclaw', 'Moonfall', 'Tidesong'],
    female: ['Shellwyn', 'Lunashell', 'Sylvanna', 'Moonriel', 'Tidelyn', 'Starshell', 'Mistara', 'Duskwyn'],
    prefix: ['Moon', 'Tide', 'Star', 'Sylva', 'Luna', 'Shade', 'Dusk', 'Mist'],
    maleSuffix: ['whisper', 'claw', 'shade', 'pincer', 'song', 'fall'],
    femaleSuffix: ['shell', 'wyn', 'ara', 'iel', 'lyn', 'riel'],
  },
  tauren: {
    male: ['Hoofclaw', 'Grassnapper', 'Plainshell', 'Stewpincer', 'Thundersnap', 'Mudhoof', 'Totemclaw', 'Bisonshell', 'Hornpinch', 'Grazeclaw'],
    female: ['Hoofbloom', 'Stewsong', 'Plainhide', 'Grassmane', 'Totemsong', 'Mudbloom', 'Hornhide', 'Clawbloom'],
    prefix: ['Hoof', 'Thunder', 'Grass', 'Plain', 'Totem', 'Mud', 'Stew', 'Bison', 'Horn'],
    maleSuffix: ['claw', 'hoof', 'shell', 'horn', 'snap', 'mane'],
    femaleSuffix: ['hide', 'bloom', 'song', 'mane', 'shell'],
  },
};

export const NAME_MIN = 2;
export const NAME_MAX = 12;
const LETTERS = /^[A-Za-z]+$/;

/** "sHELLby" -> "Shellby". */
export function capitaliseName(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function isLetters(s: string): boolean {
  return LETTERS.test(s);
}

export function isValidName(s: string): boolean {
  return s.length >= NAME_MIN && s.length <= NAME_MAX && isLetters(s);
}

function pick<T>(list: T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length)];
}

/** A crab-pun name for this race and sex, never equal to `avoid`. */
export function randomName(race: RaceId, sex: Sex, avoid = '', rnd: () => number = Math.random): string {
  const book = BOOKS[race];
  for (let tries = 0; tries < 24; tries++) {
    let name: string;
    if (rnd() < 0.55) {
      name = pick(sex === 'male' ? book.male : book.female, rnd);
    } else {
      const pre = pick(book.prefix, rnd);
      let suf = pick(sex === 'male' ? book.maleSuffix : book.femaleSuffix, rnd);
      // Avoid doubled seams like "Clawclaw".
      if (pre.toLowerCase().endsWith(suf.toLowerCase()) || suf.toLowerCase() === pre.toLowerCase()) suf = 'a';
      name = pre + suf;
    }
    name = capitaliseName(name);
    if (isValidName(name) && name !== avoid) return name;
  }
  return capitaliseName(book.male[0]);
}
