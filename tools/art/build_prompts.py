import json, os, sys
# Prompts for every generated image in public/art/. Writes <out>/prompts/*.txt and <out>/jobs.json
# (id, prompt, reference set, aspect). Usage: python build_prompts.py [out dir]
# Crab jobs ("refs": "crab") were sent with three stills of the Jumper robot from the TVC as references.
S = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(S, 'prompts')
STYLE = ("Style: high-end stylised high-fantasy key art, a richly painted digital painting with visible painterly brushwork, "
         "warm golden-hour light, saturated jewel-tone colours, strong rim light, soft volumetric atmosphere, the polish of classic "
         "fantasy MMO cinematic paintings, but entirely original. Any banners, flags, shields or tabards show only a simple crab-claw sigil, never any existing game faction emblem. No text, no letters, no watermark, no signature, no logos.")
CRAB = ("Every crab character is the Jumper crab robot shown in the reference photos: a small quadruped robot with a glossy rounded "
        "injection-moulded plastic shell (a soft-cornered box shape, wider than tall, gently domed top), a dark charcoal band around "
        "the lower body, a wide black glossy visor across its front face with two glowing rounded-rectangle LED eyes, two big front "
        "pincer claws on jointed arms, four thin jointed walking legs, and brushed silver aluminium caps at every joint. It has no mouth, "
        "no organic parts and no human face; it must read clearly as that robot, painted in the fantasy style.")
RACE = {
 'human': ("Human race: shell painted glossy Jumper red (#D2202F). Wears a royal-blue cloth tabard with a gold embroidered claw crest draped over the back of the shell. Cyan LED eyes (#53F2E4).",
           {'male': "A polished steel knight helm with a tall red plume is fitted on top of the shell.",
            'female': "A slim gold circlet with a small blue gem sits on top of the shell, and a short blue cape."},
           "a softly blurred noble castle of pale stone with royal-blue banners under a clear sky, overall cool royal-blue tint with warm sunlight"),
 'orc': ("Orc race: shell painted olive green with rough red-brown war-paint stripes across the shell; curved bone-white tusk guards fitted onto both pincers; spiked leather shoulder pauldrons. Amber LED eyes (#FFA62B). Wide, low, aggressive stance with claws raised.",
           {'male': "A tall iron topknot spike crest on top of the shell.",
            'female': "A bone mohawk crest of small horns running over the top of the shell, and bead charms."},
           "blurred red desert dunes under a crimson sunset sky with tattered war banners, overall red-orange tint"),
 'dwarf': ("Dwarf race: shell painted copper with rows of rivets; a thick braided beard made of twisted copper cables hanging under the visor, with small metal beard rings. Warm-white LED eyes. Short, broad and stocky.",
           {'male': "A horned iron helm on top of the shell.",
            'female': "A miner's helm with a glowing brass lamp on top of the shell, and two braided cable pigtails."},
           "a blurred dwarven forge hall with molten metal glow, flying sparks and an anvil, warm orange forge-light tint"),
 'undead': ("Undead race: shell painted pale bone grey, cracked, with broken gaps showing exposed wiring, servos and corroded metal; a tattered dark hooded cloak draped over the shell. Sickly green glowing LED eyes (#8DFF6A). Slightly hunched.",
           {'male': "A cracked iron helm under the hood.",
            'female': "Only the tattered hood, with a small hanging grave lantern charm."},
           "a misty graveyard with crooked tombstones and ghostly green fog under a dark teal sky, overall eerie green tint"),
 'nightelf': ("Night Elf race: shell painted midnight violet (#3B2A6B) with silver crescent-moon decals; long elegant swept-back antenna ears rising from both sides of the visor like elven ears; leaf-shaped silver pauldrons. Glowing silver-white LED eyes. Tall and graceful.",
           {'male': "A leaf circlet of silver leaves on top of the shell.",
            'female': "A silver moon diadem with a crescent moon on top of the shell."},
           "a moonlit enchanted forest with glowing blue-violet pools, giant ancient trees and fireflies, overall violet-blue moonlight tint"),
 'tauren': ("Tauren race: shell painted earth brown; a brass nose ring hanging under the visor; totem beads, feathers and a shaggy hide mantle over the back. Green LED eyes (#7DFF8A). Big, heavy and gentle.",
           {'male': "Large curved ivory bull horns mounted on the upper shell.",
            'female': "Short curved horns and a feathered totem headdress on the upper shell."},
           "golden grassland plains at sunset with distant totem poles and hide tents, overall warm golden tint"),
}
SEX = {'male': "The LED eyes are the default Jumper eyes: tall rounded rectangles.",
       'female': "This is a female crab: the LED eyes are rounder and slightly larger, with three short glowing LED eyelash lines above each eye."}
jobs = []
for r, (desc, crest, bg) in RACE.items():
    for s in ('male', 'female'):
        p = ("Square character portrait for a fantasy RPG character-select screen. Head-and-shoulders view of ONE crab robot hero, "
             "front three-quarter view with the visor and eyes facing the viewer, centred, the shell and visor filling the central circle "
             "of the frame (a circular crop will be applied: keep everything important inside the middle 80% circle). "
             f"{desc} {crest[s]} {SEX[s]} Background: {bg}, softly out of focus. Painterly portrait lighting with a warm key light and a coloured rim light. "
             f"{CRAB} {STYLE}")
        jobs.append({'id': f'portraits/{r}-{s}', 'prompt': p, 'refs': 'crab', 'aspect': '1:1', 'size': '1024x1024'})

WIDE = "Wide 16:9 landscape painting, cinematic composition. "
jobs.append({'id': 'create-bg', 'refs': None, 'aspect': '16:9', 'size': '1536x1024', 'prompt': WIDE +
  "Background painting for a fantasy RPG character creation screen: the central plaza of Clawhaven, a seaside harbour town, at golden hour. "
  "A wide cobbled stone square; timber-framed and stone guild houses with steep slate roofs and warm glowing windows on the LEFT and RIGHT sides; "
  "colourful hanging banners and pennants (deep red and royal blue) bearing a simple gold crab-claw crest; lanterns, flower boxes, barrels, a market awning; "
  "in the far distance between the buildings, the harbour with tall-masted ships, gulls, and a white lighthouse on a cliff against a glowing sunset sky. "
  "Camera at eye level, horizon LOW, roughly at the lower third. The CENTRE of the image must stay EMPTY and uncluttered: a broad open area of clean, "
  "softly lit paving stones in the middle foreground and middle ground where a round stone platform and a character will be composited later, "
  "with only open sky and distant sea glow behind it. Absolutely no people, no characters, no creatures, no crabs anywhere in the image. "
  "Architecture frames the left and right thirds; gentle depth of field softens the distance. Do not paint any platform, dais, stage, circle or pattern in the centre of the paving: plain cobbles only. " + STYLE})


CROWD = ("All the characters are crab robots of six fantasy peoples, each the Jumper robot body with its own paint and gear: red crabs in blue tabards and plumed helms (Human), "
         "olive-green crabs with tusk guards and spiked pauldrons (Orc), stocky copper crabs with braided cable beards and horned helms (Dwarf), cracked bone-grey crabs in "
         "tattered hoods with green LED eyes (Undead), tall midnight-violet crabs with long swept antenna ears and moon decals (Night Elf), big brown crabs with curved horns "
         "and feathered totems (Tauren). No humans, no animals other than gulls.")
jobs.append({'id': 'title-bg', 'refs': 'crab', 'aspect': '16:9', 'size': '1536x1024', 'prompt': WIDE +
  "Title screen key art for the fantasy RPG 'World of Crabcraft': Clawhaven, a seaside harbour town on cliffs, at dusk. A tall white stone lighthouse on a rocky headland "
  "on the right sweeps a brilliant golden beam of light across a deep violet-and-amber twilight sky. Warm lantern light glows in the windows of timber-framed houses "
  "stacked up the cliffs; tall-masted ships rest in the calm bay reflecting the last orange sunset glow. In the lower foreground, a long wooden pier with lanterns where "
  "a small party of three crab robot heroes of different races stands together, three-quarter view, LED eyes glowing: a glossy red Human warrior crab in a blue tabard "
  "with a sword and round shield, a midnight-violet Night Elf mage crab with long swept antenna ears holding a staff topped by a glowing sea-glass orb, and a big earth-brown "
  "Tauren priest crab with curved horns holding a glowing holy lantern. Composition rules, strictly: the three crab heroes stand together on the pier in the LEFT THIRD "
  "of the image only (they occupy at most the left 38% of the width and the lower half of the height), seen three-quarter, facing right toward the sea; the TOP-CENTRE "
  "is open twilight sky (a logo will be placed there); the BOTTOM-CENTRE is empty, slightly darker pier boards and calm water with no characters (menu buttons go there); "
  "the lighthouse with its beam is on the right. Epic, inviting, magical. " + CRAB + " " + STYLE})
jobs.append({'id': 'loading-1', 'refs': 'crab', 'aspect': '16:9', 'size': '1536x1024', 'prompt': WIDE +
  "Loading screen painting: the Brine Shore, a golden beach below sea cliffs and pine woods at late afternoon. Shallow tide pools mirror the sky; broken wreck timbers, "
  "rusted iron plates and coils of chain litter the sand. Three crab robot adventurers advance sideways along the shoreline in a heroic diagonal: a red Human warrior crab "
  "in a blue tabard with a sword and round shield, an olive Orc crab with tusk guards, and a midnight-violet Night Elf mage crab holding a sea-glass staff with a glowing orb. "
  "Ahead of them, a pack of small rusted scrap crab drones with single red glowing eyes crawls out of the surf. The Saltmere lighthouse stands far away on the headland. "
  "Keep the bottom 15% of the image calm and slightly darker (a loading bar goes there). " + CRAB + " " + STYLE})
jobs.append({'id': 'loading-2', 'refs': 'crab', 'aspect': '16:9', 'size': '1536x1024', 'prompt': WIDE +
  "Loading screen painting: the Iron Wreck, a huge half-sunk iron sailing ship stranded at the end of a beach at stormy dusk, its deck tilted, masts broken, hull "
  "crusted with rust and barnacles. On the deck towers Corrodius the Rust Tyrant: a gigantic crab robot (the Jumper body scaled up enormously) clad in riveted rusted "
  "iron hull plates, wearing a mantle of heavy anchor chains and a cracked iron crown, one colossal claw raised, its visor glowing red like a furnace with ember sparks. "
  "Far behind, the lighthouse beam cuts through storm clouds. In the lower left foreground, a small brave red crab robot hero with sword and shield faces the tyrant, "
  "its cyan LED eyes glowing. Dramatic scale contrast, orange rust and red glow against cold teal sea. Keep the bottom 15% calmer and darker (loading bar). " + CRAB + " " + STYLE})
jobs.append({'id': 'ending', 'refs': 'crab', 'aspect': '16:9', 'size': '1536x1024', 'prompt': WIDE +
  "Ending celebration painting: night festival in Clawhaven Square. The whole town of crab robots, dozens of them of every race, dances in a joyful ring around a fountain "
  "shaped like a giant crab pincer; claws raised, legs mid-step, some spinning, some waving. Colourful fireworks burst over the harbour in gold, red, cyan and violet, "
  "reflected in the water; the restored lighthouse on the headland sweeps a bright golden beam across the bay; strings of warm lanterns and bunting crisscross above the square; "
  "timber-framed houses glow. A small red crab hero in the centre foreground raises a claw in triumph. Warm, joyful, triumphant. " + CROWD + " " + CRAB + " " + STYLE})

NPC = {
 'brinebeard': ("Captain Brinebeard, a Dwarf sea-captain crab robot (male): stocky copper-painted shell with rivets, a thick braided beard of twisted copper cables "
                "hanging under the visor, a weathered navy captain's tricorn hat with gold trim on top of the shell, a brass spyglass held in one claw, the other claw raised in a friendly wave. "
                "Warm-white LED eyes (tall rounded rectangles), cheerful. Background: Clawhaven harbour square at dusk with a pincer-shaped fountain and warm lanterns, softly blurred."),
 'silvermoon': ("Lady Silvermoon, a Night Elf crab robot (female): midnight-violet glossy shell with silver crescent-moon decals, long elegant swept antenna ears rising "
                "from both sides of the visor, a silver moon diadem, leaf-shaped silver pauldrons, a flowing gossamer shawl. Silver-white glowing LED eyes, round, with three short LED eyelash lines above each eye. "
                "Serene and wise. Background: Moonpool Grove at night, a glowing blue tide pool among ancient pines, fireflies, moonlight, softly blurred."),
 'coralline': ("Sister Coralline, a Human priestess crab robot (female): glossy ivory-white shell, white and gold priest vestments with a gold tide-wave symbol draped over the shell, "
               "a small golden halo-like circlet, holding a glowing holy lantern in one claw. Warm gold LED eyes, round, with three short LED eyelash lines above each eye. Kind and gentle. "
               "Background: Chapel of the Tide interior with stained-glass windows in sea colours and many candles, softly blurred."),
 'grukk': ("Grukk Shellbreaker, an Orc guard crab robot (male): olive-green shell with red-brown war-paint stripes and dents, curved bone tusk guards on both big pincers, "
           "heavy spiked leather pauldrons, an iron band crest, a big axe resting on the shoulder. Amber LED eyes shaped as determined downward-slanted bars. Tough but friendly grin-like posture. "
           "Background: the timber-and-stone town gate of Clawhaven with torches, softly blurred."),
 'hoofclaw': ("Mama Hoofclaw, a Tauren cook crab robot (female): big earth-brown shell, short curved ivory horns with feathers, a brass nose ring under the visor, a stained "
              "cream apron, holding a big wooden ladle, a steaming stew pot nearby. Green LED eyes, round, with three short LED eyelash lines above each eye, warm and motherly. "
              "Background: the cosy Molting Kettle tavern with a hearth fire, hanging pots and warm light, softly blurred."),
 'rattlebolt': ("Old Rattlebolt, an Undead lighthouse-keeper crab robot (male): pale bone-grey shell, cracked and patched with rivets, exposed wiring and servos in the gaps, "
                "a tattered dark hood, holding an old brass lantern, one leg stripped to its metal frame. Flickering sickly green LED eyes. Old, wry and mysterious. "
                "Background: the foot of the stone Saltmere lighthouse in sea fog at dusk, softly blurred."),
 'pip': ("Ironjaw Pip, a Dwarf blacksmith crab robot (female): deep-red shell with rivets, two braided copper-cable pigtails, brass goggles pushed up on top of the shell, "
         "a scorched leather smith's apron, holding a smith's hammer in one claw. Amber LED eyes, round, with three short LED eyelash lines above each eye, spirited. "
         "Background: Barnacle Forge with an anvil, glowing coals and flying sparks, softly blurred."),
}
for k, d in NPC.items():
    jobs.append({'id': f'npc/{k}', 'refs': 'crab', 'aspect': '1:1', 'size': '1024x1024', 'prompt':
      "Square dialogue portrait for a fantasy RPG non-player character. Head-and-shoulders view of ONE crab robot character, front three-quarter view, the visor and "
      "LED eyes facing the viewer, centred and filling the frame (keep everything important inside the middle 80% circle). " + d + " " + CRAB + " " + STYLE})

EMBLEM = ("Circular heraldic class emblem medallion for a fantasy RPG: a round, thick, ornate polished gold rim with small engraved crab-claw ornaments, framing "
          "{inner}. Front-on, perfectly centred, the medallion fills the whole square image edge to edge, painted with crisp detail, strong rim light, rich saturated colour. "
          "Outside the circle, a flat pure black background. No text, no letters.")
jobs.append({'id': 'icons/class-warrior', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': EMBLEM.format(inner=
  "a deep crimson field with a steel longsword crossed over a round steel-and-gold shield, with a big red crab pincer gripping the sword hilt, sparks of battle")})
jobs.append({'id': 'icons/class-mage', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': EMBLEM.format(inner=
  "a deep ocean-blue field with a twisted driftwood staff topped by a glowing teal sea-glass orb, swirling ribbons of water, steam and frost crystals around it")})
jobs.append({'id': 'icons/class-priest', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': EMBLEM.format(inner=
  "an ivory and pale-gold field with a radiant golden holy lantern shining light rays, above a stylised breaking tide wave and an open hymn book")})

ICON = ("Square ability icon for a classic fantasy MMO action bar, in the painted icon style of classic 2000s MMO spell icons: one bold, simple central symbol, "
        "large and instantly readable even when shrunk to 48 pixels, painterly with strong value contrast and saturated colour, dramatic lighting, darker vignette "
        "toward the edges. The painting fills the whole square edge to edge: no border, no frame, no rounded corners, no text. Subject: {s}")
ABIL = {
 'warrior-1': "Pincer Strike: a huge glossy red robotic crab pincer slamming down, a bright white-orange impact flash and shock lines at the tip, steel and crimson tones.",
 'warrior-2': "Shell Bash: a round steel shield with a gold rim smashing forward, a burst of yellow stun stars and a cracked impact ring, orange and steel tones.",
 'warrior-3': "Sideways Charge: a red crab robot dashing sideways at great speed, strong horizontal motion streaks and kicked-up sand, warm red and gold tones.",
 'warrior-4': "Whirlpool: a spinning vortex of steel sword-arcs and sea water, a swirling blade whirlwind seen from above, steel blue and crimson.",
 'mage-1': "Bubble Bolt: a single glowing scalding-hot bubble projectile with steam trails and a bright core, teal and white on deep blue.",
 'mage-2': "Frost Spray: a cone of icy blue frost shards and snowflake crystals bursting outward, pale cyan and white on dark navy.",
 'mage-3': "Steam Blink: a puff of white steam with a fading teal afterimage of a crab robot and magical sparkles, a teleport effect, misty blue-violet.",
 'mage-4': "Tidal Nova: a circular explosion of ocean water bursting outward in a ring with spray and foam, deep blue and bright aqua.",
 'priest-1': "Smite: a blazing column of golden holy light striking down from above with radiant rays, gold and white on deep amber.",
 'priest-2': "Mend Shell: a cracked red crab shell fragment glowing as golden-green healing light seals the crack, soft sparkles, green and gold.",
 'priest-3': "Barnacle Ward: a protective shimmering bubble shield encrusted with pale barnacles and shells, glowing golden edges, teal and ivory.",
 'priest-4': "Holy Tide: a radiant wave of golden glowing water curling upward with holy light motes, gold and turquoise.",
}
for k, s in ABIL.items():
    jobs.append({'id': f'icons/ability-{k}', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': ICON.format(s=s)})
ITEMS = {
 'item-rusted-cog': "a rusted iron cog gear crusted with orange rust and barnacles, dripping sea water, on dark teal.",
 'quest-moonwater': "a small glass vial of glowing silver-blue moon water with a cork stopper and a crescent moon reflection, on deep violet.",
 'quest-scroll': "a rolled parchment quest scroll tied with a red ribbon and sealed with a red wax seal stamped with a crab claw, on warm brown.",
 'quest-beacon': "the burning golden flame of a lighthouse beacon inside a great faceted crystal lens, radiant light rays, on dark blue night.",
 'quest-boss': "a menacing cracked iron crab-robot helm with a broken crown, its visor slit glowing furnace red, rust flaking, on black and dark red.",
}
for k, s in ITEMS.items():
    jobs.append({'id': f'icons/{k}', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': ICON.format(s=s).replace('ability icon', 'item icon')})

UI = "Game UI texture asset, front-on orthographic view, flat even lighting, perfectly symmetrical, crisp clean edges, high detail, no text, no letters. "
jobs.append({'id': 'ui/frame-stone', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': UI +
  "A square ornate panel frame for a fantasy MMO interface: a border band of dark carved slate stone about 9% of the width on every side, edged inside and outside "
  "with a thin polished gold filigree trim, and at each of the four corners a gold ornament shaped like a stylised crab claw curling around the corner. The large centre "
  "area is a plain, even, dark blue-grey slate stone texture with subtle grain (no ornaments in the centre). The four sides are identical, suitable for 9-slice scaling."})
jobs.append({'id': 'ui/corner-claw', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'bg': 'transparent', 'prompt': UI.replace('perfectly symmetrical, ', '') +
  "A single gold filigree corner ornament for the TOP-LEFT corner of a UI panel: polished gold metal shaped like a stylised crab claw and scrollwork, the two arms of "
  "the ornament run along the top edge and the left edge of the image meeting at the top-left corner, with a small red gem at the corner. Isolated on a transparent background."})
jobs.append({'id': 'ui/parchment', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': UI.replace('perfectly symmetrical, ', '') +
  "A sheet of aged parchment paper filling the whole image edge to edge: warm cream and tan tones, subtle fibres, faint water stains and soft darker toasted edges, "
  "evenly lit, completely blank with no writing and no drawings, no torn edges, no background visible."})
jobs.append({'id': 'ui/button-red', 'refs': None, 'aspect': '21:9', 'size': '1536x1024', 'prompt': UI +
  "A wide horizontal fantasy MMO menu button, about four times wider than tall, filling the image: glossy deep red lacquer surface with a soft top highlight, "
  "framed by a thin bevelled polished gold rim with small claw-shaped gold end caps on the left and right ends. Blank, no text. Flat dark background around it."})
jobs.append({'id': 'ui/divider-gold', 'refs': None, 'aspect': '21:9', 'size': '1536x1024', 'bg': 'transparent', 'prompt': UI +
  "A long thin horizontal ornamental divider line in polished gold filigree, tapering to fine points at both ends, with a small central ornament of two crab claws "
  "around a red gem. Very thin and wide (about 16 times wider than tall), centred. Isolated on a transparent background."})
jobs.append({'id': 'ui/portrait-ring', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'bg': 'transparent', 'prompt': UI +
  "A circular ornate portrait frame ring: a thick polished gold ring with engraved filigree and a dark steel inner bevel, small crab-claw ornaments at the top and bottom, "
  "the inside of the ring completely empty and transparent. Isolated on a transparent background."})
jobs.append({'id': 'ui/unit-frame', 'refs': None, 'aspect': '21:9', 'size': '1536x1024', 'bg': 'transparent', 'prompt': UI.replace('perfectly symmetrical, ', '') +
  "A player unit frame for a fantasy MMO HUD: on the LEFT a large circular portrait socket ring in gold filigree (its inside empty and transparent), joined on the RIGHT to "
  "a horizontal dark slate stone plate with two long empty recessed bar slots stacked vertically (for health and mana bars, empty dark insets) trimmed in thin gold, a "
  "small gold claw ornament at the right end. Isolated on a transparent background."})
jobs.append({'id': 'ui/action-slot', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': UI +
  "A single square action-bar button slot for a fantasy MMO: a recessed, empty dark stone well with soft inner shadow, framed by a bevelled polished gold border with "
  "tiny claw ornaments at the four corners. The slot fills the whole image edge to edge. Empty, no icon inside."})
jobs.append({'id': 'ui/tooltip-bg', 'refs': None, 'aspect': '1:1', 'size': '1024x1024', 'prompt': UI.replace('perfectly symmetrical, ', '') +
  "A tooltip panel background texture: a deep midnight-navy, very dark, slightly translucent-looking surface with subtle cloudy texture, filling the image edge to edge, "
  "with a thin muted gold border line inset a little from every edge and tiny gold corner flourishes. Mostly plain and dark so text stays readable."})
jobs.append({'id': 'logo', 'refs': None, 'aspect': '16:9', 'size': '1536x1024', 'bg': 'transparent', 'prompt':
  "Game logo for a fantasy MMO titled exactly \"World of Crabcraft\". Layout: the small words \"WORLD OF\" on a top line, and the large word \"CRABCRAFT\" below, in heavy "
  "carved classical capitals, polished gold metal letters with a deep red enamel inner face, bevelled, with a dark bronze outline and a subtle glow. Behind and above the "
  "text sits an emblem: a heraldic shield of red lacquer with gold trim bearing two crossed crab claws, flanked by sweeping gold wings of filigree. The spelling must be "
  "exactly W-O-R-L-D O-F C-R-A-B-C-R-A-F-T. Centred, wide composition, isolated on a transparent background, no other text."})

jobs.append({'id': 'logo-face', 'refs': 'crab', 'aspect': '16:9', 'size': '1536x1024', 'bg': 'transparent', 'prompt':
  "Game logo for a fantasy MMO titled exactly \"World of Crabcraft\". Layout: the small words \"WORLD OF\" on a top banner line, and the large word \"CRABCRAFT\" below, in heavy "
  "carved classical capitals, polished gold metal letters with a deep red enamel inner face, bevelled, with a dark bronze outline and a subtle glow. Above the text sits a heraldic "
  "emblem: a red lacquer shield with gold trim showing the face of the crab robot from the reference photos (a glossy red rounded shell with a black visor and two glowing cyan "
  "rounded-rectangle LED eyes) with its two big pincer claws raised on either side, flanked by sweeping gold filigree wings. The spelling must be exactly "
  "W-O-R-L-D O-F C-R-A-B-C-R-A-F-T. Centred, wide composition, isolated on a transparent background, no other text."})

os.makedirs(P, exist_ok=True)
for j in jobs:
    fp = os.path.join(P, j['id'].replace('/', '__') + '.txt')
    open(fp, 'w').write(j['prompt'])
    j['prompt_file'] = fp
json.dump(jobs, open(os.path.join(S, 'jobs.json'), 'w'), indent=1)
print(len(jobs), 'jobs')

# Gemini 3 Pro Image detail pass for the five 2560x1440 paintings (input: the chosen GPT image take, 16:9, 2K).
# create-bg used the "empty" variant because the plain prompt let the model add figures to the square.
UPSCALE = "Re-render this exact painting at higher resolution. Keep the composition, framing, every object, every character, the crab robots' exact shapes, faces, eyes and gear, the colours and the lighting exactly the same. Only add crisp fine painterly detail and sharpness, as a high-end fantasy key art painting. Do not add, move or remove anything. No text, no watermark."
UPSCALE_EMPTY = 'Re-render this exact painting at higher resolution. It is an empty town square background with NO characters: keep it completely empty of people, crabs, creatures and figures; do not add anything to the paving. Keep the composition, framing, buildings, banners, ships, lighthouse, colours and lighting exactly the same. Only add crisp fine painterly detail and sharpness, as a high-end fantasy key art painting. Do not add, move or remove anything. No text, no watermark.'
