// "The Rust Tide" quest chain (docs/design.md): data, dialogue and progress state.
import type { PoiId } from '../world/types';
import { Emitter } from './util';

export type QuestId = 'q1' | 'q2' | 'q3' | 'q4';
export type NpcId = 'brinebeard' | 'silvermoon' | 'coralline' | 'grukk' | 'hoofclaw' | 'rattlebolt' | 'pip';
export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';
export type ObjectiveKind = 'kill-scrapling' | 'kill-scavenger' | 'collect-cog' | 'deliver' | 'beacon' | 'boss';

export interface ObjectiveDef {
  id: string;
  kind: ObjectiveKind;
  label: string;
  count: number;
  poi: PoiId;
}

export interface QuestDef {
  id: QuestId;
  title: string;
  giver: NpcId;
  /** null = completes by itself when the objectives are done. */
  turnIn: NpcId | null;
  offer: string[];
  progress: string;
  complete: string[];
  /** Quest log description. */
  summary: string;
  /** Tracker line once every objective is done. */
  readyHint: string;
  objectives: ObjectiveDef[];
  xp: number;
  completeButton?: string;
}

export const QUESTS: Record<QuestId, QuestDef> = {
  q1: {
    id: 'q1',
    title: 'Salt in the Gears',
    giver: 'brinebeard',
    turnIn: 'brinebeard',
    offer: [
      "Ahoy, fresh shell! Captain Brinebeard, Clawhaven Watch. You've got sturdy pincers, and I've got a rusty problem.",
      'Every night Scraplings crawl up the Brine Shore from the Iron Wreck. Little rustbuckets. Wherever they scuttle, crabs wake up stiff as old hinges with their LEDs gone dim.',
      'Take the road out of the square down to the Brine Shore. Scrap 6 Scraplings and bring me 4 Rusted Cogs from their innards. I want to know what makes them tick. And creak.',
    ],
    progress: 'Still crunching? The Brine Shore is down the road past the gate. Follow the surf and the smell of old pennies.',
    complete: [
      "Four cogs! Look at this rust, it's practically growing a beard. Mine's nicer.",
      "You've done Clawhaven proud, shellmate. But a cog this rotten didn't rot on its own...",
    ],
    summary:
      'Captain Brinebeard wants 6 Scraplings scrapped on the Brine Shore and 4 Rusted Cogs brought back to him in Clawhaven Square.',
    readyHint: 'Return to Captain Brinebeard in Clawhaven Square.',
    objectives: [
      { id: 'q1-kill', kind: 'kill-scrapling', label: 'Scraplings scrapped', count: 6, poi: 'shore' },
      { id: 'q1-cog', kind: 'collect-cog', label: 'Rusted Cogs', count: 4, poi: 'shore' },
    ],
    xp: 250,
  },
  q2: {
    id: 'q2',
    title: 'Moonwater',
    giver: 'brinebeard',
    turnIn: 'silvermoon',
    offer: [
      "This rust isn't natural. It smells like trouble and tastes like a battery. Don't ask how I know.",
      "Lady Silvermoon keeps the Moonpool in the grove at the edge of the pine wood. If anyone can read a rusted cog, it's her. Take these to her, and mind the pinecones. They're pointy and they know it.",
    ],
    progress: 'Lady Silvermoon is at Moonpool Grove, where the pine wood starts. Follow the glow.',
    complete: [
      'Hush now. Let the moonwater speak.',
      '(She dips a cog into the glowing pool. The rust hisses away like steam off a kettle.)',
      'Do you see that red glint? This rust was cast by light. Corrupted light. The Saltmere Lighthouse has gone dark, and in that darkness something in the Iron Wreck has grown bold.',
    ],
    summary: 'Bring the Rusted Cogs to Lady Silvermoon at Moonpool Grove, on the edge of the pine wood.',
    readyHint: 'Speak with Lady Silvermoon at Moonpool Grove.',
    objectives: [{ id: 'q2-deliver', kind: 'deliver', label: 'Cogs brought to Lady Silvermoon', count: 1, poi: 'npc:silvermoon' }],
    xp: 120,
  },
  q3: {
    id: 'q3',
    title: 'Light the Beacon',
    giver: 'silvermoon',
    turnIn: null,
    offer: [
      'The lighthouse stands on the cliff past the Brine Shore. Rustclaw Scavengers nest along its path, and they leap like startled shrimp. Clear 3 of them.',
      'Then climb to the lantern and relight the beacon. Hold F and keep the flame steady until it catches. The moon will be watching. So will I, from a comfortable distance.',
    ],
    progress:
      'The lighthouse is past the Brine Shore, up the cliff path. Old Rattlebolt keeps it, if he is still keeping anything.',
    complete: [],
    summary:
      'Defeat 3 Rustclaw Scavengers on the path to Saltmere Lighthouse, then relight the beacon at the top. Hold F at the beacon until the flame catches.',
    readyHint: 'The beacon blazes!',
    objectives: [
      { id: 'q3-kill', kind: 'kill-scavenger', label: 'Rustclaw Scavengers defeated', count: 3, poi: 'lighthouse' },
      { id: 'q3-beacon', kind: 'beacon', label: 'Saltmere beacon relit (hold F)', count: 1, poi: 'beacon' },
    ],
    xp: 330,
  },
  q4: {
    id: 'q4',
    title: 'The Rust Tide',
    giver: 'silvermoon',
    turnIn: 'brinebeard',
    offer: [
      'The beacon swept across the bay and found the Iron Wreck. Something enormous heaved itself up on the deck, crowned in rust and furnace light: Corrodius, the Rust Tyrant.',
      "Board the wreck at the far end of the shore and end the Rust Tide. Lady Silvermoon's moonwater blessing will keep your shell mending while you fight.",
    ],
    progress: 'Corrodius waits on the deck of the Iron Wreck.',
    complete: [
      'You did WHAT? Corrodius was a wee red crab stuck in a rusty tin can the whole time?',
      "Ha! Well, the sea will be kinder to him than rust ever was. And the beacon's burning bright again. Listen... hear that? The whole town's turned out.",
      "Clawhaven owes you a dance, shellmate. Several, actually. We're crabs. We've got a lot of legs.",
    ],
    summary: 'Defeat Corrodius, the Rust Tyrant, on the deck of the Iron Wreck at the far end of the Brine Shore.',
    readyHint: 'Return to Captain Brinebeard in Clawhaven Square.',
    objectives: [{ id: 'q4-boss', kind: 'boss', label: 'Corrodius defeated', count: 1, poi: 'bossArena' }],
    xp: 600,
    completeButton: "Let's dance!",
  },
};

export const QUEST_ORDER: QuestId[] = ['q1', 'q2', 'q3', 'q4'];

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  race: 'human' | 'orc' | 'dwarf' | 'undead' | 'nightelf' | 'tauren';
  sex: 'male' | 'female';
  classId: 'warrior' | 'mage' | 'priest';
  shell: number;
  crest: number;
  led: number;
  extras: string[];
  poi: PoiId;
  /** Idle gestures this NPC likes. */
  gestures: ('gesture_paw' | 'gesture_salute' | 'gesture_bow' | 'claw_left' | 'claw_right' | 'gesture_hello')[];
  lines: string[];
}

export const NPCS: NpcDef[] = [
  {
    id: 'brinebeard',
    name: 'Captain Brinebeard',
    title: 'Clawhaven Watch',
    race: 'dwarf',
    sex: 'male',
    classId: 'warrior',
    shell: 0,
    crest: 3,
    led: 1,
    extras: ['captain-hat'],
    poi: 'npc:brinebeard',
    gestures: ['gesture_salute', 'gesture_paw'],
    lines: [
      "The tide's turned, shellmate. I can feel it in my joints. Mostly because they're not creaking.",
      'Best crab on the Watch, you are. Second best. I am the best. But you are close.',
    ],
  },
  {
    id: 'silvermoon',
    name: 'Lady Silvermoon',
    title: 'Keeper of the Moonpool',
    race: 'nightelf',
    sex: 'female',
    classId: 'priest',
    shell: 0,
    crest: 2,
    led: 1,
    extras: [],
    poi: 'npc:silvermoon',
    gestures: ['gesture_bow', 'gesture_paw'],
    lines: [
      'The moon is pleased with you. I can tell. It is doing the thing with the light.',
      'The pool remembers every crab who has looked into it. It remembers you as brave, and slightly sandy.',
    ],
  },
  {
    id: 'coralline',
    name: 'Sister Coralline',
    title: 'Chapel of the Tide',
    race: 'human',
    sex: 'female',
    classId: 'priest',
    shell: 2,
    crest: 2,
    led: 0,
    extras: [],
    poi: 'npc:coralline',
    gestures: ['gesture_bow', 'gesture_paw'],
    lines: [
      'May the Tide mend your shell. There, good as new, and only slightly holier.',
      'Light a candle for the lighthouse, child. Then step back. Candles and claws do not mix.',
    ],
  },
  {
    id: 'grukk',
    name: 'Grukk Shellbreaker',
    title: 'Gate Guard',
    race: 'orc',
    sex: 'male',
    classId: 'warrior',
    shell: 0,
    crest: 1,
    led: 0,
    extras: [],
    poi: 'npc:grukk',
    gestures: ['claw_left', 'claw_right'],
    lines: [
      'Grukk guard gate. Grukk also guard snacks. You want claw-wrestle? No? Smart crab.',
      'Scraplings come at night. Grukk bonk them. Grukk run out of bonk. You help.',
      'Tavern wall says Grukk 212, everyone else 0. Wall does not lie. Grukk wrote it.',
    ],
  },
  {
    id: 'hoofclaw',
    name: 'Mama Hoofclaw',
    title: 'The Molting Kettle',
    race: 'tauren',
    sex: 'female',
    classId: 'priest',
    shell: 1,
    crest: 2,
    led: 1,
    extras: [],
    poi: 'npc:hoofclaw',
    gestures: ['gesture_paw', 'gesture_hello'],
    lines: [
      "Sit, sit! Kelp stew's on. Two bowls for heroes, three if you're Grukk. He says he's not hungry, then he's hungry.",
      'The secret ingredient is patience. And barnacles. Mostly barnacles.',
    ],
  },
  {
    id: 'rattlebolt',
    name: 'Old Rattlebolt',
    title: 'Lighthouse Keeper',
    race: 'undead',
    sex: 'male',
    classId: 'mage',
    shell: 0,
    crest: 3,
    led: 0,
    extras: [],
    poi: 'npc:rattlebolt',
    gestures: ['gesture_paw', 'claw_left'],
    lines: [
      "Eh? The light's been out three nights now. Can't see my own claws, and I've got spares.",
      'Scavengers on my stairs again. Rude. They never wipe their legs.',
    ],
  },
  {
    id: 'pip',
    name: 'Ironjaw Pip',
    title: 'Barnacle Forge',
    race: 'dwarf',
    sex: 'female',
    classId: 'warrior',
    shell: 1,
    crest: 2,
    led: 2,
    extras: [],
    poi: 'npc:pip',
    gestures: ['claw_right', 'gesture_salute'],
    lines: [
      "Mind the sparks! This anvil's older than my beard, and my beard's older than me. Long story. Involves a cable spool.",
      "Bring me a Rusted Cog and I'll... no, actually, keep it. It's disgusting.",
    ],
  },
];

export const RATTLEBOLT_Q3 =
  'Climbing my lighthouse? The beacon is up top. Hold the flame till it catches. F for Flame, I always say. Well, I said it once. Then I died. Then I came back.';
export const RATTLEBOLT_AFTER = "Lovely light. I'd cry, but my tear ducts rusted shut years ago.";

export const TOWNSFOLK_BARKS = [
  'Lovely evening for a scuttle.',
  'Have you tried walking forwards? Me neither.',
  'My LEDs feel dim today. Must be the rust.',
  'Grukk owes me three claw-wrestles.',
  'Did the lighthouse just blink? No? Just me?',
  'I polished my shell for nothing. NOTHING.',
  'Six legs and I still trip on the cobbles.',
  "The tavern stew smells like victory. And kelp.",
  'Sideways is the only way.',
  "I heard the Captain's beard is load-bearing.",
];

export const ENDING_BARKS = ['Hooray!', 'Dance, everyone!', 'Mind my legs!', 'The light is back!', 'Best night ever!', 'Pinch me, I am dreaming!'];

export const BOSS_YELLS = {
  wake: 'Who dares shine a light on MY rust?',
  engage: 'Fresh bolts! Come closer, little shell!',
  phase2: 'Rise, my rustlings! Feast!',
  undertow: 'The tide... takes... ALL!',
  phase3: 'I... WILL... CORRODE... EVERYTHING!',
  kill: 'Another shell for the scrap heap!',
  death: 'The light... it is... warm...',
};

export const ZONE_SUBTITLES: Record<string, string> = {
  Clawhaven: 'Harbour town of six peoples',
  'The Brine Shore': 'Where the Scraplings crawl',
  'Saltmere Lighthouse': 'Dark these three nights',
  'The Iron Wreck': 'Rust and ruin',
  'Moonpool Grove': 'Where the moon listens',
};

// ------------------------------------------------------------------ state

export interface QuestEvents extends Record<string, unknown> {
  accepted: QuestId;
  progress: { quest: QuestId; objective: ObjectiveDef; value: number };
  ready: QuestId;
  completed: QuestId;
}

export interface CurrentObjective {
  quest: QuestId;
  /** 'objective' = go do it; 'turnin' / 'accept' = talk to an NPC. */
  step: 'objective' | 'turnin' | 'accept';
  objective?: ObjectiveDef;
  poi: PoiId;
  label: string;
}

export class QuestLog {
  readonly status: Record<QuestId, QuestStatus> = { q1: 'available', q2: 'locked', q3: 'locked', q4: 'locked' };
  readonly progress = new Map<string, number>();
  readonly events = new Emitter<QuestEvents>();
  cogs = 0;

  value(o: ObjectiveDef): number {
    return this.progress.get(o.id) ?? 0;
  }

  objectiveDone(o: ObjectiveDef): boolean {
    return this.value(o) >= o.count;
  }

  accept(id: QuestId): void {
    if (this.status[id] !== 'available' && this.status[id] !== 'locked') return;
    this.status[id] = 'active';
    this.events.emit('accepted', id);
    // Delivery quests are ready as soon as they start if the player already has the goods.
    this.checkReady(id);
  }

  /** Count an event toward every active quest objective of that kind. */
  bump(kind: ObjectiveKind, amount = 1): void {
    for (const id of QUEST_ORDER) {
      if (this.status[id] !== 'active') continue;
      for (const o of QUESTS[id].objectives) {
        if (o.kind !== kind) continue;
        const v = this.value(o);
        if (v >= o.count) continue;
        const nv = Math.min(o.count, v + amount);
        this.progress.set(o.id, nv);
        this.events.emit('progress', { quest: id, objective: o, value: nv });
      }
      this.checkReady(id);
    }
  }

  /** Force the next missing objective of an active quest (debug F9). */
  completeObjective(o: ObjectiveDef): void {
    const v = this.value(o);
    if (v >= o.count) return;
    this.bump(o.kind, o.count - v);
  }

  private checkReady(id: QuestId): void {
    if (this.status[id] !== 'active') return;
    const def = QUESTS[id];
    if (!def.objectives.every((o) => this.objectiveDone(o))) return;
    if (def.turnIn === null) {
      this.complete(id);
    } else {
      this.status[id] = 'ready';
      this.events.emit('ready', id);
    }
  }

  complete(id: QuestId): void {
    if (this.status[id] === 'done') return;
    this.status[id] = 'done';
    const i = QUEST_ORDER.indexOf(id);
    const next = QUEST_ORDER[i + 1];
    if (next && this.status[next] === 'locked') this.status[next] = 'available';
    this.events.emit('completed', id);
  }

  /** Quests this NPC can offer right now. */
  offeredBy(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) if (this.status[id] === 'available' && QUESTS[id].giver === npc && id !== 'q4') return id;
    return null;
  }

  readyAt(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) if (this.status[id] === 'ready' && QUESTS[id].turnIn === npc) return id;
    return null;
  }

  /** Active (not ready) quest whose giver or turn-in is this NPC. */
  inProgressAt(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) {
      const d = QUESTS[id];
      if (this.status[id] === 'active' && (d.turnIn === npc || d.giver === npc)) return id;
    }
    return null;
  }

  active(): QuestId[] {
    return QUEST_ORDER.filter((id) => this.status[id] === 'active' || this.status[id] === 'ready');
  }

  get allDone(): boolean {
    return QUEST_ORDER.every((id) => this.status[id] === 'done');
  }

  current(): CurrentObjective | null {
    for (const id of QUEST_ORDER) {
      const def = QUESTS[id];
      if (this.status[id] === 'ready' && def.turnIn) {
        return { quest: id, step: 'turnin', poi: `npc:${def.turnIn}` as PoiId, label: def.readyHint };
      }
      if (this.status[id] === 'active') {
        const o = def.objectives.find((x) => !this.objectiveDone(x));
        if (o) return { quest: id, step: 'objective', objective: o, poi: o.poi, label: o.label };
      }
    }
    for (const id of QUEST_ORDER) {
      // The Rust Tide is pushed to the player when the beacon catches; nobody hands it out.
      if (this.status[id] === 'available' && id !== 'q4') {
        const giver = QUESTS[id].giver;
        return { quest: id, step: 'accept', poi: `npc:${giver}` as PoiId, label: `Speak with ${npcName(giver)}` };
      }
    }
    return null;
  }
}

export function npcName(id: NpcId): string {
  return NPCS.find((n) => n.id === id)?.name ?? id;
}
