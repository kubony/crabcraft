<p align="center">
  <img src="docs/media/hero.webp" alt="The whole town of Clawhaven dances the recorded Jumper dance policies at the end of the quest" width="100%">
</p>

<h1 align="center">World of Crabcraft</h1>

<p align="center">
  <b>A fantasy RPG in the browser where every character is a Jumper crab robot,<br>
  and every walk, wave and dance comes from the robot's own trained policies.</b>
</p>

<p align="center">
  Crab Robot Open-source Challenge 2026 (BE UNLIMITED) entry |
  <a href="LICENSE">Apache-2.0</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="docs/SUBMISSION.md">Contest entry text</a>
</p>

Six races, three classes, one harbour town, a four-quest chain, a three-phase boss and a town-wide
dance party at the end. Every crab, from the player to the boss, is the
[Jumper](https://github.com/KingKongRobotics/jumper) robot by KingKong Robotics wearing different
paint and gear. Then open **Robot Mode** and the crab you made runs on Jumper's real controller and
policies, live, in MuJoCo, in the same tab.

*Six shells. One tide.*

## What makes it different

**The motion is the robot's, not an animator's.** All 37 of the game's motion clips are closed-loop
rollouts of Jumper policies, driven through a bundle's own controller extension in MuJoCo 3.11.
31 come from the Jumper example bundle: walking in 8 directions, turning, the fast gait, the jump,
both claw modes, 4 gestures and 4 dances, with `dance_crab` at its full 238.6 s. The 6 combat moves
the robot had no policy for (`attack_swipe`, `attack_slam`, `cast`, `hit_react`, `death`, `sit`)
come from **six new Jumper tasks, published with this project in [`jumper/`](jumper/)**: `jumper.skill_swipe`, `skill_slam`,
`skill_cast`, `skill_flinch`, `skill_powerdown` and `skill_sit`, reference clips authored on the
robot's own model and trained with motion-imitation reinforcement learning (2,000 to 3,000 PPO iterations each on one
H100). Started from the standing pose in the task's own environment, the six policies did not fall
in 84 rollouts (10 per move with the training's domain randomisation, 4 without), and track their
reference within 0.26 to 1.54 degrees joint RMS over the move, where standing still would be 11 to
39 degrees off. Death is now the power-down policy: the legs give way and the shell settles on the
ground, where the corpse stays.

**Robot Mode runs the real stack in your browser.** The official MuJoCo 3.11.0 WebAssembly build
(`@mujoco/mujoco`), onnxruntime-web 1.30.0 and the bundle's own `controller.wasm` load 17 ONNX
policies (18 modes): the example bundle's 11 and the six skills, built into one bundle by Jumper's
own `scripts/deploy.py`, at the robot's control rate (199 Hz measured while walking). Keys 5 6 7 8 9 0
swipe, slam, cast, flinch, power down and sit, live, and hand back to walking. Before the robot
wakes, the page proves it agrees with the bundle: it replays `reference.json` through the controller
(24 frames, diff 0), compares the policy outputs with the recorded actions (max diff 8.3e-7) and
checks 53 bundle files against their SHA-256.

**Same policy, any appearance.** Press <kbd>T</kbd> in Robot Mode to switch between the bare robot and
the crab you created, gear, weapon and LED face included, posed every frame from the same live
simulation. The crab's skeleton is Jumper's URDF, so its links sit on the physics bodies (within 0.0013 mm).

<p align="center">
  <img src="docs/media/robot-switch.webp" alt="Robot Mode: a geared crab dances the live dance_crab policy, switches to the bare Jumper robot and back, without the simulation noticing" width="100%">
  <br><sub>Robot Mode, live: one <code>dance_crab</code> policy run, drawn as the player's crab, then as the bare robot, then as the crab again.</sub>
</p>

## Feature tour

### Title

<img src="docs/media/title.jpg" alt="Title screen: painted harbour at dusk with crab heroes and the World of Crabcraft logo" width="100%">

Painted key art and logo made for this project. Enter World, Robot Mode and Credits; Continue appears
once you have saved a crab.

### Character creation

<img src="docs/media/create.jpg" alt="Character creation: race portraits, a human warrior crab on a stone dais, class and race lore on parchment" width="100%">

The genre's classic layout with our own art: race portraits and class emblems on the left, your crab
on a carved dais, lore on the parchment. Pick one of 6 races, 2 sexes (visor eye shape) and 3 classes,
then 4 shell paints, 4 crest styles and 3 LED colours per race, a name or Randomize. Drag to rotate.

<img src="docs/media/races.jpg" alt="The six races side by side: Human, Orc, Dwarf, Undead, Night Elf, Tauren" width="100%">

One robot body, six peoples. Race comes from paint, posture, LED behaviour and gear modelled against
the real shell: a plumed helm and tabard, tusk guards and a horned skull cap, a braided cable beard,
a cracked shell with exposed servos, long swept antennae, great horns with totem beads. The class
puts a sword and shield, a sea-glass staff or a lantern and hymn book in the claws.

### Clawhaven

<img src="docs/media/town.jpg" alt="Clawhaven Square at dusk: the player's Human Warrior crab, the pincer fountain and Captain Brinebeard calling out" width="100%">

The starting zone: Clawhaven Square with its pincer fountain, Barnacle Forge, the Chapel of the Tide,
the Molting Kettle tavern, Moonpool Grove, the Brine Shore, Saltmere Lighthouse and the Iron Wreck.
Seven named NPCs, covering all six races, hand out quests, hints and flavour, gesture and talk;
townsfolk stroll the streets on the recorded walking clips. Buildings, props and nature come from Quaternius CC0 kits.

### Combat

<img src="docs/media/combat.jpg" alt="A Night Elf mage crab casts Tidal Nova on the Brine Shore and knocks back three Scraplings" width="100%">

Three classes with four abilities each: the Warrior builds Rage and spends it on Shell Bash, Sideways
Charge and Whirlpool; the Mage casts Bubble Bolt, Frost Spray, Steam Blink and Tidal Nova; the Priest
uses Smite, Mend Shell, Barnacle Ward and Holy Tide. Cast bars, cooldowns, a 1 s global cooldown,
target frames, nameplates, a quest tracker and a minimap. Enemies are Scraplings and Rustclaw
Scavengers, rusted crab drones from the wreck.

### Corrodius, the Rust Tyrant

<img src="docs/media/boss.jpg" alt="Corrodius raises his anchor on the deck of the Iron Wreck; a red Anchor Slam circle marks the mage crab's spot" width="100%">

The quest chain "The Rust Tide" (Salt in the Gears, Moonwater, Light the Beacon, The Rust Tide) ends
on the deck of the Iron Wreck. Corrodius fights in 3 phases: telegraphed Anchor Slam and a Rust Spray
cone, then Scrapling adds and Undertow, then an enrage. When he falls, a small red crab steps out of
the armour.

### The ending

<img src="docs/media/ending.jpg" alt="The player's crab dances in Clawhaven Square at night with the townsfolk; caption: every step you see is a recorded rollout of Jumper's real trained policies" width="100%">

Back in the square the whole town gathers in a ring around you and dances the recorded dance policies
(`dance_crab`, `dance_brazilian`, `dance_dream_wings`, `dance_maze`) under fireworks, then the credits
roll.

### Robot Mode

<img src="docs/media/robot.jpg" alt="Robot Mode. Top: an Orc Warrior crab walking on a sunny desk, with the HUD showing the live locomotion policy at 199 Hz, joint telemetry and the start-up checks. Bottom: the same dance_crab policy drawn as the crab and as the bare Jumper robot" width="100%">

A sunny tabletop in the style of the Jumper TVC. Drive the robot with the keyboard, the on-screen dock
or a gamepad, all through the bundle's own bindings. The HUD shows the live mode and control rate,
inference and physics timings, all 22 joints (angle, target, torque) and the start-up checks. Top: an
Orc Warrior crab walking on the locomotion policy. Bottom: one `dance_crab` run, drawn as that crab
and, after <kbd>T</kbd>, as the bare robot.

## Controls

**In the game**

| Input | Action |
|---|---|
| <kbd>W</kbd> <kbd>S</kbd> or <kbd>Up</kbd> <kbd>Down</kbd> | Walk forward, back |
| <kbd>A</kbd> <kbd>D</kbd> | Walk sideways (crabs strafe) |
| <kbd>Q</kbd> <kbd>E</kbd> or <kbd>Left</kbd> <kbd>Right</kbd> | Turn |
| Left drag, right drag, wheel | Orbit the camera, orbit and steer, zoom |
| Both mouse buttons | Walk forward |
| <kbd>Space</kbd> | Jump |
| <kbd>Tab</kbd>, click | Target the nearest enemy in front; target what you click (a nearby NPC also starts talking) |
| <kbd>1</kbd> to <kbd>4</kbd> | Abilities |
| <kbd>F</kbd> | Talk, interact, take the main dialogue choice; hold to relight the beacon |
| <kbd>L</kbd> | Quest log |
| <kbd>M</kbd> | Music on or off |
| <kbd>Enter</kbd> | Chat bubbles on or off |
| <kbd>Esc</kbd> | Cancel a cast, clear the target, open the menu (graphics quality Low or High) |
| <kbd>R</kbd> twice | Open Robot Mode (resets quest progress) |

**In Robot Mode** (the bundle's own bindings from its `controller.toml` and manual; <kbd>Q</kbd>
<kbd>E</kbd>, <kbd>T</kbd>, <kbd>C</kbd> and <kbd>R</kbd> are added by the page)

| Input | Action |
|---|---|
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows | Walk and step sideways |
| <kbd>Q</kbd> <kbd>E</kbd> (or <kbd>J</kbd> <kbd>L</kbd>) | Turn |
| <kbd>N</kbd> <kbd>M</kbd> | Stand taller, crouch lower |
| <kbd>Space</kbd> | Jump |
| <kbd>1</kbd> to <kbd>4</kbd> | Gestures: hello, bow, paw, salute |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> to <kbd>4</kbd> | Dances: crab, Brazilian, maze, dream wings |
| <kbd>V</kbd> <kbd>B</kbd> | Left or right claw mode |
| <kbd>Ctrl</kbd> | End a gesture or dance early |
| <kbd>Esc</kbd> | Let go of every control |
| <kbd>T</kbd> | Bare robot or your crab |
| <kbd>C</kbd>, <kbd>R</kbd> | Follow camera on or off, reset the robot |
| Drag, wheel | Orbit, zoom |
| Gamepad | The robot's own pad bindings (sticks walk and turn, A jumps, D-pad gestures, menu + D-pad dances, LB and RB claws) |

## Run it

You need Node.js and pnpm (tested with Node 26.7, which also runs the `.ts` tools directly, and
pnpm 11.22) and a desktop browser with WebGL2 and WebAssembly (tested in Chrome on an Apple M4 Pro
Mac).

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check, then a static site in dist/
pnpm preview    # serve dist/ locally
```

Every built asset is committed under `public/`, so no offline pipeline has to run to play.
The build uses a relative base (`base: './'`), so `dist/` can be served from any path. Robot Mode
runs onnxruntime-web on one thread and does not need cross-origin isolation: the built site,
Robot Mode included, also runs from a plain `python3 -m http.server` without COOP or COEP headers
(the dev server sends them anyway).

URL parameters:

| URL | Opens |
|---|---|
| `/` | Title screen |
| `/?screen=create` | Character creation |
| `/?screen=game` | Clawhaven with your saved crab (a default Human Warrior if none is saved) |
| `/?screen=robot` | Robot Mode (wears your saved crab, or offers a race and class picker) |
| `/?screen=credits` | Credits |
| `&debug=1` (with `screen=game`) | Debug keys: <kbd>F8</kbd> god mode, <kbd>F9</kbd> complete the current objective, <kbd>F10</kbd> teleport to the next objective, plus an fps readout |

Your crab is saved in `localStorage` under `cc.spec`.

## How it works

```mermaid
flowchart LR
  subgraph J["Jumper repo (KingKong Robotics, Apache-2.0)"]
    URDF["URDF + visual meshes"]
    MJCF["jumper.xml (MJCF)"]
    BUNDLE["Example policy bundle<br/>11 ONNX policies, controller,<br/>contracts, reference.json"]
    SKILL["Six new tasks, jumper.skill_*<br/>trained for this game<br/>crabcraft bundle = example + 6"]
  end
  subgraph T["Offline pipelines (tools/)"]
    BC["build_crab.py<br/>Blender"]
    BG["build_gear.py<br/>gear, weapons, enemies"]
    REC["motion/record_clips.py<br/>MuJoCo 3.11 + controller + ONNX"]
    EXP["motion/export_clips.py"]
    ER["export_robot.py<br/>build_robot_visual.py"]
    WB["world/build-assets.mjs<br/>Quaternius CC0 kits"]
  end
  subgraph P["public/ (committed)"]
    GLB["models/crab/jumper.glb"]
    GEAR["models/gear, models/weapons"]
    MOT["motions/ (37 clips)"]
    RB["robot/bundle, robot/jumper"]
    WG["models/world"]
  end
  subgraph R["Browser runtime (src/)"]
    CRAB["crab/<br/>rig, LED face, gear"]
    MOTION["motion/<br/>clip blending"]
    WORLD["world/<br/>Clawhaven"]
    GAME["game/<br/>quests, combat, boss, ending"]
    ROBOT["robot/ (Web Worker)<br/>MuJoCo WASM + controller.wasm<br/>+ onnxruntime-web"]
  end
  URDF --> BC --> GLB --> CRAB
  URDF --> BG --> GEAR --> CRAB
  MJCF --> REC
  BUNDLE --> REC --> EXP --> MOT --> MOTION
  SKILL --> REC
  MJCF --> ER --> RB
  BUNDLE --> RB --> ROBOT
  SKILL --> RB
  WB --> WG --> WORLD
  CRAB --> GAME
  MOTION --> GAME
  WORLD --> GAME
  CRAB -->|appearance layer| ROBOT
```

- **Crab model.** `tools/build_crab.py` builds `public/models/crab/jumper.glb` from Jumper's URDF and
  visual meshes in headless Blender: one node per link with the joint axis and limits, rotating a
  link about its axis by `q` gives MuJoCo `qpos = q`. `src/crab/` skins it (about six draw calls per
  crab), adds the signed-distance LED face (11 expressions: neutral, happy, angry, hurt, dead, love,
  sleepy, surprised, focused, blink, talk) and dresses it with gear from `tools/build_gear.py`:
  6 races x 4 crests, 3 class weapons, NPC extras and 3 enemies (Scrapling, Rustclaw Scavenger,
  Corrodius).
- **Motion.** `tools/motion/jumper_sim.py` is a headless host for a bundle: MuJoCo, onnxruntime and
  the bundle's own controller extension, with the contact, solver and servo settings taken from the
  upstream training configuration. `record_clips.py` drives it the way `play --app` does (velocity
  commands for walking, the bundle's own pad bindings for jump, gestures, dances, claws and, through
  the crabcraft bundle, the six skills). `export_clips.py` cuts seamless loops and quantises them into
  `public/motions/`; for the skills it also moves each reference moment (the swipe's hit, the slam's
  impact, read off the claw pads' contact, the cast's release, the shell settling) to where the policy
  played it and writes the game's windows to `src/motion/skillClips.ts`. In the game, `src/motion/`
  blends the clips (phase-synchronised walking underneath, actions layered on top) and
  `src/motion/skills.ts` plays each skill's move, not its whole rollout, with gameplay timed by the
  clip's own moments. Gameplay crabs play recorded rollouts; physics runs live only in Robot Mode.
- **Robot Mode.** `tools/export_robot.py` exports Jumper's physics model with the training contact
  and solver settings; `tools/build_robot_visual.py` decimates the visual meshes. In the browser a Web
  Worker (`src/robot/sim/`) loads the bundle the way its README asks a host to, builds MuJoCo, the
  controller and one onnxruntime-web session per policy, and steps
  `set_state, operator input, tick, infer, positions/kp/kd` every 5 ms with the robot's servo law
  (PD torque clipped to the measured torque-speed curve and thermal budget). The page renders about
  120 pose frames a second on the TVC-style desk and hands your keys and gamepad to the controller.
- **World and game.** `src/world/` builds Clawhaven and the Brine Shore from code plus the Quaternius
  kits; `src/game/` runs quests, combat, AI, the boss, effects, music and the HUD.

## How it was verified

| Check | Command | Result |
|---|---|---|
| Motion host agrees with the bundle | `tools/motion/check_bundle.py [--bundle <crabcraft bundle>]` | Controller replay of `reference.json`: observation diff 0, target diff 0. ONNX vs recorded actions: max diff 9.5e-07 (example bundle), 0 (crabcraft bundle) |
| The six skill policies track their moves | evaluation in each task's own environment, from the standing pose | 0 falls in 84 rollouts; joint RMS over the move 0.26 to 1.54 deg without domain randomisation, 0.42 to 1.68 deg with it (standing still: 11.2 to 39.4 deg) |
| Crab model is kinematically Jumper | `tools/check_crab_fk.py` | 41 bodies x 13 poses vs MuJoCo: max position error 0.000534 mm |
| Robot Mode simulation, headless | `node tools/robot-sim-check.ts` | 21.65 m in 30 s of walking without a fall, max tilt 1.88 deg, jump apex 0.228 m; each of the six skills entered on its key, played out and handed back to walking (max tilt 11.3 deg, the sit) |
| Robot Mode start-up checks, in the page | open `/?screen=robot` | `reference.json` replay 24 frames, diff 0; policy outputs vs recorded actions 8.3e-7; 53 bundle files match their SHA-256 |
| Crab drawn on the live simulation | `node tools/robot-skin-shots.mjs <app url> <out dir>` | All 41 crab links within 0.0013 mm of the physics bodies while standing, walking and dancing |
| Whole game, end to end | `pnpm dev --port 5206` in one terminal, `node tools/playtest.mjs` in another | Warrior, Mage and Priest each play every quest, the boss and the ending with 0 console errors |

The Python tools need a Jumper checkout (`JUMPER_ROOT`, with the example bundle built at
`out/bundle_example/jumper`; the skills need the six `jumper.skill_*` tasks applied from [`jumper/`](jumper/) and the
crabcraft bundle, `python scripts/deploy.py --manifests deploy/crabcraft.manifests.json
--allow-incomplete`) and an
interpreter with `mujoco` and `onnxruntime`; the Blender scripts need Blender. See the docstring at
the top of each script.

## Project layout

```
src/
  app.ts, main.ts   screen switching (title, create, game, robot, ending, credits)
  core/             renderer and post-processing, input, audio, asset loading, follow camera
  crab/             Jumper rig from jumper.glb, LED face, race posture, gear
  data/             races and classes
  motion/           clip library and the blending motion controller
  world/            Clawhaven, the shore, lighthouse, wreck, water, sky, foliage
  game/             quests, combat, abilities, enemies, boss, NPCs, ending, VFX
  robot/            Robot Mode: HUD, worker client, sim/ (MuJoCo + controller + ONNX), view/
  screens/          title, character creation, game, Robot Mode
  ui/               HUD widgets, fonts, theme
public/             built assets: art, audio, fonts, models, motions, robot bundle
tools/              asset pipelines, motion recording, checks, playtest and screenshot scripts
dev/                standalone harness pages (crab turntable, motion viewer, world, robot)
docs/               design document, contest entry text, README media
requirements/       the original requirements
```

## Known limits

- One zone, single player, desktop keyboard and mouse. Gamepad input exists only in Robot Mode.
- In the game the crabs replay recorded policy rollouts; they are not simulated. Robot Mode is the
  part that runs physics and policies live.
- The bundle has no get-up policy. If the robot tips over in Robot Mode it holds in `safe`, and the
  page stands it back up after 3 s.
- The bundle marks its web controller as not verified by the consumer; Robot Mode shows that notice
  next to its own start-up checks.
- Frame rate: the playtest reported 60 fps in town, combat, the boss fight and the ending on an
  Apple M4 Pro Mac in Chrome. Other hardware has not been measured; the Esc menu has a Low quality
  setting.
- The music and sound effects were not checked by listening; they are built by script from CC0
  sources.

## Credits

- **Jumper** robot model, meshes, policies and bundle runtime: KingKong Robotics,
  [github.com/KingKongRobotics/jumper](https://github.com/KingKongRobotics/jumper), Apache-2.0.
- **MuJoCo** WASM bindings (Google DeepMind, Apache-2.0), **onnxruntime-web** (Microsoft, MIT),
  **three.js** and **postprocessing** for rendering.
- **World kits**: Quaternius Medieval Village, Stylized Nature and Fantasy Props MegaKits (CC0).
- **2D art** (paintings, portraits, icons, UI, logo) generated for this project with OpenAI GPT image
  generation, with Google Gemini 3 Pro Image for the upscaling pass; prompts are in `tools/art/`.
- **Music and sound**: CC0 tracks and effects from OpenGameArt and Kenney, plus procedural layers.
- **Fonts**: Cinzel, Cinzel Decorative and Alegreya (OFL-1.1).

Every third-party file, with its source URL, author and license, is listed in [NOTICE.md](NOTICE.md).
Game design and lore: [docs/design.md](docs/design.md).

## License

World of Crabcraft is released under the [Apache License 2.0](LICENSE). Jumper materials are
Copyright 2026 KingKong Robotics under the same license. The art, models, lore and UI were made for
this project or come from the sources in [NOTICE.md](NOTICE.md); only the classic layout of the
genre's character creation screen is borrowed.
