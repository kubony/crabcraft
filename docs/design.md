# World of Crabcraft - game design

Single source for lore, races, classes, quest, art direction and asset names. Code data lives in
`src/data/`; keep the two in sync. Requirements: `requirements/crabcraft-spec.md`.

## Pitch

A browser fantasy RPG in the spirit of World of OLDcraft where every living thing is a
Jumper crab robot. Six races, three classes, one seaside starting zone, one quest chain that ends
in a boss fight and a town-wide dance party. Every walk cycle, gesture, dance and combat move the
crabs perform was recorded from Jumper's real trained policies, and Robot Mode runs those policies
live in the browser on the same MuJoCo model the physical robot is trained on. The six combat moves
(swipe, slam, cast, hit reaction, death, sit) had no policy, so they are six new Jumper tasks,
`jumper.skill_*`, published with this project in `jumper/` and trained for it: in each task's own environment,
from the standing pose, 0 falls in 84 rollouts and 0.26 to 1.54 degrees joint RMS over the move,
where standing still is 11 to 39 degrees off. Gameplay plays each move's window of the recorded
rollout (`src/motion/skills.ts`) and times hits, the cast release and the corpse settling by the
clip's own moments.

Tagline: **Six shells. One tide.**

## Rules for originality

- Nothing is copied from World of OLDcraft: no models, textures, UI art, names or text. We copy
  only the *layout* of its character creation screen (portrait grid left, crab on a round stone
  dais centre, lore parchment right, option arrows bottom centre) and the genre conventions.
- No Blizzard names or logos. Race names are generic fantasy words (Human, Orc, Dwarf, Undead,
  Night Elf, Tauren are common nouns in the genre; place and character names are ours).
- Every third-party file is CC0, CC-BY or Apache-2.0 and listed in `NOTICE.md` with source URL.

## World

The **Tidelands**, a warm coast of cliffs, tide pools and pine woods. Crabs of six peoples share
**Clawhaven**, a harbour town that grew around the old Lighthouse of Saltmere. Everyone walks
sideways and nobody finds this funny except tourists.

Starting zone: **Clawhaven and the Brine Shore**.

| POI id | Name | What is there |
|---|---|---|
| `spawn` | Clawhaven Square | Fountain shaped like a giant pincer, player spawn, quest giver |
| `forge` | Barnacle Forge | Dwarf smith NPC, anvil, sparks |
| `chapel` | Chapel of the Tide | Priest NPC, stained glass, candles |
| `tavern` | The Molting Kettle | Tavern, Tauren cook NPC, music |
| `grove` | Moonpool Grove | Night Elf NPC by a glowing tide pool at the edge of the pine wood |
| `shore` | Brine Shore | Beach with wreck debris; Scrapling enemies |
| `lighthouse` | Saltmere Lighthouse | Beacon to relight (interaction) |
| `wreck` | The Iron Wreck | Half-sunk iron ship at the end of the shore; boss arena on its deck |

## Races

Every crab is the Jumper robot body: glossy plastic shell, black visor, LED eyes, silver joint
caps, six legs (two claws, four walkers). Race identity comes from paint, gear, posture and LED
behaviour. Silhouette test: each race must be recognisable as a black silhouette.

| Race | Shell paints (first is default) | Gear (crest styles) | Posture | LED |
|---|---|---|---|---|
| Human | Jumper red, royal blue, ivory, bronze | Blue tabard with a gold claw crest draped over the back; crests: knight helm with plume, short cape only, circlet, leather cap | Standard stance | Cyan (default Jumper), gold, white |
| Orc | olive green, moss, rust brown, ash grey | Tusk guards on both pincers, spiked leather pauldrons, war-paint stripes on the shell; crests: topknot spike, horned skull cap, bone mohawk, iron band | Wide, low front claws | Amber, red, yellow |
| Dwarf | copper, slate, deep red, steel | Braided cable beard hanging under the visor, rivets on the shell; crests: horned helm, winged helm, miner lamp helm, bare with braids | Body lowered, legs splayed, short and broad | Warm white, amber, cyan |
| Undead | bone grey, faded red, grave green, bruise purple | Cracked shell with exposed wiring and servos, one walking leg stripped to its frame, tattered hood; crests: hood, cracked helm, exposed skull plate, lantern | Hunched, slight twitch | Sickly green, violet, pale blue; flickers |
| Night Elf | midnight violet, teal, silver, moonlit blue | Long swept antenna ears from the visor sides, crescent moon decals, leaf pauldrons; crests: leaf circlet, long antennae, moon diadem, hood | Tall, legs straight | Silver-white, moon blue, magenta; soft glow trail |
| Tauren | earth brown, cream, rust, charcoal | Large curved horns on the upper shell, nose ring under the visor, totem beads and a hide mantle; crests: great horns, short horns + feathers, totem headdress, braided mane | Body raised and scaled 1.15x | Green, amber, cyan |

Sex: `male` and `female` change the visor eye shape (female adds LED lashes and rounder eyes)
and the default gear tint; body geometry is the same robot.

Race lore (shown on the parchment):

- **Human** - *Polished, hopeful and a little too proud of their tabards.* Human crabs built
  Clawhaven's sea wall and repaint it every spring. They believe any problem can be solved by
  marching at it sideways in good formation, and so far the sea has not proven them wrong.
- **Orc** - *Loud, loyal, and very hard to dent.* Orc crabs came over the dunes in rusted
  war-shells and stayed for the fishing. They settle arguments with a friendly claw-wrestle and
  keep score on the tavern wall, which is now mostly scratches.
- **Dwarf** - *Short legs, long memories, longer beards.* Dwarf crabs dig, smelt and solder. Their
  braided cable beards carry a little current, which they insist is for warmth and which is
  really for showing off.
- **Undead** - *Rebooted against all advice.* These crabs were scrapped once and did not accept
  it. Their shells crack, their servos whine, and their LEDs flicker green, but they pay their
  tavern tab on time, which is more than can be said for some.
- **Night Elf** - *Patient watchers of the moonlit pools.* Night Elf crabs walk on tall straight
  legs and speak softly to the tide. Their long antennae hear the moon, or so they say.
- **Tauren** - *Big shells, bigger hearts.* Tauren crabs carry totems from the high grass plains
  and the best stew recipes on the coast. They are slow to anger and very quick to second
  helpings.

## Classes

Resource bar: Warrior uses **Rage** (red, builds on hitting and being hit), Mage and Priest use
**Mana** (blue, regenerates). Global cooldown 1.0 s. Auto-attack for all classes.

| Class | Weapon | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Warrior | Sword in right claw, round shield in left | **Pincer Strike** - heavy hit, 10 rage | **Shell Bash** - stun 2 s, 15 rage, 8 s cd | **Sideways Charge** - dash to target, generates 15 rage, 12 s cd | **Whirlpool** - spinning AoE around you, 30 rage, 10 s cd |
| Mage | Staff with a sea-glass orb in right claw | **Bubble Bolt** - ranged hit, 1.5 s cast | **Frost Spray** - cone, slows 50 % 4 s, 8 s cd | **Steam Blink** - teleport 8 m forward, 15 s cd | **Tidal Nova** - AoE burst, knockback, 20 s cd |
| Priest | Censer / holy lantern in right claw, book in left | **Smite** - ranged holy hit, 1.5 s cast | **Mend Shell** - heal 35 % HP, 2 s cast | **Barnacle Ward** - absorb shield, 20 s cd | **Holy Tide** - AoE damage + heal self, 15 s cd |

Class lore:

- **Warrior** - Warriors fight claw to claw with sword and shield, building Rage from every blow
  given or taken and spending it on bashes, charges and a spinning Whirlpool that scatters a crowd.
- **Mage** - Mages bend water, steam and frost through a sea-glass staff. Fragile up close, they
  blink away in a puff of steam and drown their foes in a Tidal Nova.
- **Priest** - Priests carry a lantern of the Tide and a book of very old hymns. They smite the
  wicked, mend cracked shells and ward allies with a barnacle shield.

## Quest chain: "The Rust Tide"

Target length 8 to 12 minutes. Level 1 to 3 (levels are cosmetic: +HP, ding effect).

1. **Arrival.** Player spawns at Clawhaven Square at dusk. Quest giver **Captain Brinebeard**
   (Dwarf, copper shell, captain's hat) waves with `gesture_hello`.
   Dialogue: rust is spreading through Clawhaven; crabs wake up stiff, LEDs dimmed. Scraplings
   (small rusted crab drones) crawl up from the Iron Wreck every night.
   Quest 1 **"Salt in the Gears"**: defeat 6 Scraplings on the Brine Shore and collect 4
   **Rusted Cogs** (drop 70 %).
2. **The Grove.** Turn in to Brinebeard. Quest 2 **"Moonwater"**: bring the cogs to
   **Lady Silvermoon** (Night Elf) at Moonpool Grove. She cleanses one in the pool and sees the
   rust comes from a corrupted lighthouse lens: the beacon went dark, and the thing in the wreck
   grew bold. Quest 3 **"Light the Beacon"**: climb Saltmere Lighthouse (enemies: 3 Rustclaw
   Scavengers, bigger Scraplings) and relight the beacon (hold F for 3 s, channel bar).
3. **The Wreck.** Relighting the beacon reveals the Iron Wreck and wakes the boss.
   Quest 4 **"The Rust Tide"**: defeat **Corrodius, the Rust Tyrant** on the wreck deck.
4. **Ending.** Return to the Square. The whole town (every race) gathers; the beacon sweeps the
   bay; crabs perform the real recorded dances (`dance_crab`, `dance_brazilian`,
   `dance_dream_wings`, `dance_maze`) in a ring around the player; fireworks; credits roll with
   the "real robot motion" note and an invitation to try Robot Mode.

NPC roster (all races appear):

| NPC | Race / sex | Role | Spot |
|---|---|---|---|
| Captain Brinebeard | Dwarf m | Quest giver | `spawn` |
| Lady Silvermoon | Night Elf f | Quest 2-3 | `grove` |
| Sister Coralline | Human f | Priest, flavour, heals player when talked to | `chapel` |
| Grukk Shellbreaker | Orc m | Guard, flavour, claw-wrestle emote | `spawn` gate |
| Mama Hoofclaw | Tauren f | Tavern cook, flavour | `tavern` |
| Old Rattlebolt | Undead m | Lighthouse keeper, hint dialogue | `lighthouse` base |
| Ironjaw Pip | Dwarf f | Smith, flavour | `forge` |
| Townsfolk | mixed | Ambient walkers, use real locomotion clips | streets |

Enemies:

| Enemy | Look | Behaviour |
|---|---|---|
| Scrapling | Small (0.6x) rusted crab drone, one red LED eye, scrap plates | Melee, weak, packs of 2 to 3 |
| Rustclaw Scavenger | Normal size, orange rust, mismatched claw, barnacles | Melee, leaps (uses `jump` clip) |
| **Corrodius, the Rust Tyrant** | 3.5x crab, iron hull plates, anchor-chain mantle, cracked crown, one giant claw, red furnace glow in the visor | Boss, see below |

Boss fight (about 90 s for a decent player):

- Phase 1 (100 to 60 %): **Anchor Slam** - telegraphed red circle under the player, 1.5 s wind-up,
  big hit. **Rust Spray** - cone, applies Rust (stacking slow). Auto-attacks with the claw.
- Phase 2 (60 to 25 %): summons 3 Scraplings, **Undertow** - pulls the player in then slams.
- Phase 3 (below 25 %): enrage, visor turns from red to white-hot, faster attacks.
- Death: powers down with the `death` clip (the `skill_powerdown` policy: the legs give way and the
  shell settles on the deck), rust peels off, a small ordinary red Jumper crab steps out
  of the hull, does `gesture_bow`, and scuttles into the sea (the tyrant was a crab trapped in
  rusted armour).

Fail state: on death, fade to grey, respawn at the Square with full HP; boss resets.

## Controls

WASD move (A/D strafe, crabs are sideways walkers), right-mouse drag orbit camera, left-mouse drag
orbit without turning, wheel zoom, Space jump (`jump` clip), Tab cycle target, click to target,
1 to 4 abilities, F interact, Esc menu, Enter chat bubbles off, M toggle music, R open Robot Mode.
Gamepad support is a stretch goal.

## Robot Mode

A separate scene (opened from the title screen or with R): a sunny tabletop arena styled like the
TVC (warm light, shallow depth of field). The chosen crab runs live: MuJoCo WASM physics plus the
bundle's ONNX policies and controller wasm, the same files the physical robot loads. Keyboard /
on-screen buttons switch modes exactly like the robot's controller (walk with WASD, jump, dances,
gestures, the six skills on 5 6 7 8 9 0, claw). A HUD shows the live mode, its control rate from the
contract (200 Hz for locomotion and jump, 50 Hz for dances, gestures, skills and claw) and the joint
telemetry. A toggle
shows the bare robot vs. the race appearance.

## Art direction

- **Crabs = the TVC product.** Glossy injection-moulded plastic (clearcoat, roughness ~0.25),
  Jumper red `#D2202F` default, black glossy visor, LED eyes cyan `#53F2E4` with bloom, brushed
  aluminium joint caps. Expressions: rounded-rectangle eyes, arrow eyes when determined, heart
  eyes, X eyes on death, as in the TVC.
- **World = stylised high fantasy.** Saturated, warm, painterly. Golden-hour key light, cool sky
  fill, soft shadows, light fog, bloom on lamps and LEDs, gentle depth of field in cinematics.
- **UI = dark slate + gold filigree + parchment** in the oldcraft layout tradition but with our own
  art: stone frames with gold claw-shaped corner ornaments, parchment panels, red lacquer buttons.
  Display font Cinzel (OFL), body font Alegreya or EB Garamond (OFL), self-hosted.

## Asset manifest (paths are the contract between workers)

2D art, `public/art/` (WebP unless noted):

| File | Size | Content |
|---|---|---|
| `logo.webp` | 1600x700, transparent | "World of Crabcraft" logo, gold and red, crab claw motif |
| `title-bg.webp` | 2560x1440 | Title screen painting: Clawhaven at dusk, lighthouse beam, crabs on the pier |
| `create-bg.webp` | 2560x1440 | Character creation backdrop painting: harbour town plaza at golden hour, no characters in the centre (the 3D crab stands there) |
| `loading-1.webp`, `loading-2.webp` | 2560x1440 | Loading screens |
| `portraits/<race>-<sex>.webp` | 512x512 | Circular race portrait of the crab (12 files) |
| `icons/class-<class>.webp` | 256x256 | Class emblem |
| `icons/ability-<class>-<1..4>.webp` | 128x128 | Ability icons (12) |
| `icons/item-rusted-cog.webp`, `icons/quest-*.webp` | 128x128 | Item and quest icons |
| `npc/<npc-id>.webp` | 512x512 | Dialogue portraits for named NPCs |
| `ui/frame-stone.webp`, `ui/parchment.webp`, `ui/button-red.webp`, `ui/corner-claw.webp` | as needed | UI textures (9-slice friendly) |
| `ending.webp` | 2560x1440 | Ending illustration: the whole town dancing under fireworks |

Audio, `public/audio/` (OGG + MP3): `music-title`, `music-town`, `music-combat`, `music-boss`,
`music-ending`, `sfx-*` (click, hover, hit, crit, heal, cast, levelup, quest-accept,
quest-complete, footstep-sand, footstep-stone, servo-whir, beacon, boss-roar).

3D, `public/models/`: `crab/jumper.glb` (base robot), `crab/jumper-lod.glb` (its far LOD, `tools/build_crab_lod.mjs`), `gear/<race>-*.glb`, `weapons/*.glb`,
`world/*.glb`. Motions in `public/motions/`. Robot Mode runtime in `public/robot/`.
