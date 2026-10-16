# Notices

World of Crabcraft is licensed under the Apache License 2.0 (see `LICENSE`).

## Third-party material

| Material | Source | License | Used for |
|---|---|---|---|
| Jumper robot model, meshes, policies, bundle runtime | https://github.com/KingKongRobotics/jumper | Apache-2.0, Copyright 2026 KingKong Robotics | Every crab body, recorded motions, Robot Mode |
| Jumper policy bundle, web half (`public/robot/bundle/`: `bundle.json`, `controller.toml`, contracts, `models/*.onnx`, trajectories, `reference.json`, `manual.en.json`, `README.md`, `runtime/web/controller.{js,wasm}` built from commit ce71f79) and the physics model exported from `assets/jumper/jumper.xml` (`public/robot/jumper/`) | https://github.com/KingKongRobotics/jumper (`out/bundle_example/jumper`, `assets/jumper/`) | Apache-2.0, Copyright 2026 KingKong Robotics | Robot Mode: the controller, policies, contact model and visual meshes the robot runs |
| MuJoCo JavaScript/WASM bindings `@mujoco/mujoco` 3.11.0 | https://github.com/google-deepmind/mujoco (npm `@mujoco/mujoco`) | Apache-2.0, Copyright Google DeepMind | Robot Mode physics |
| ONNX Runtime Web `onnxruntime-web` 1.30.0 (and its `onnxruntime-common`) | https://github.com/microsoft/onnxruntime (npm `onnxruntime-web`) | MIT, Copyright Microsoft Corporation | Robot Mode policy inference |
| "Oak Wood Planks" texture by Dimitrios Savva (`public/robot/arena/oak_wood_planks_*`, re-encoded JPEG) | https://polyhaven.com/a/oak_wood_planks | CC0 | Robot Mode desk |
| "Cayley Interior" HDRI by Greg Zaal (`public/robot/arena/cayley_interior_1k.hdr`) | https://polyhaven.com/a/cayley_interior | CC0 | Robot Mode reflections |
| Medieval Village MegaKit (Standard), Quaternius | https://quaternius.com/packs/medievalvillagemegakit.html (https://quaternius.itch.io/medieval-village-megakit) | CC0 1.0 | Clawhaven buildings, pier planks, fences, wagon, cobble and brick textures (`public/models/world/village.glb`) |
| Stylized Nature MegaKit (Standard), Quaternius | https://quaternius.com/packs/stylizednaturemegakit.html (https://quaternius.itch.io/stylized-nature-megakit) | CC0 1.0 | Pines, trees, bushes, ferns, flowers, mushrooms, rocks, cliff rock texture (`public/models/world/nature.glb`) |
| Fantasy Props MegaKit (Standard), Quaternius | https://quaternius.com/packs/fantasypropsmegakit.html (https://quaternius.itch.io/fantasy-props-megakit) | CC0 1.0 | Market stalls, forge tools, barrels, crates, lanterns, candles, tavern furniture (`public/models/world/props.glb`) |

## Art, fonts and audio

2D art in `public/art/` was generated for this project, so it is ours (Apache-2.0 with the rest of the
repository). Generators: OpenAI GPT image generation (the `image_generation` tool behind the Codex
ChatGPT backend, model `gpt-5.5`) for every painting, portrait, icon, UI texture and the logo, and
Google Gemini 3 Pro Image ("Nano Banana Pro", `gemini-3-pro-image-preview`) for the 2x detail pass on
the five 2560x1440 paintings. Crab images were prompted with stills from the Jumper TVC as visual
reference only; no frame of the video is shipped. Prompts and the post-processing script are in
`tools/art/`. No prompt named or asked for any existing game, character or logo.

| Material | Author | Source | License | Used for |
|---|---|---|---|---|
| Cinzel (variable, Latin subset, WOFF2) | The Cinzel Project Authors (Natanael Gama) | https://github.com/google/fonts/tree/main/ofl/cinzel via https://fontsource.org/fonts/cinzel | OFL-1.1 (`public/fonts/OFL-Cinzel.txt`) | Display font |
| Cinzel Decorative (400, 700, 900, Latin subset, WOFF2) | Natanael Gama | https://github.com/google/fonts/tree/main/ofl/cinzeldecorative via https://fontsource.org/fonts/cinzel-decorative | OFL-1.1, Reserved Font Name "Cinzel" (`public/fonts/OFL-CinzelDecorative.txt`) | Decorative headings |
| Alegreya (variable, roman and italic, Latin subset, WOFF2) | The Alegreya Project Authors (Huerta Tipografica) | https://github.com/google/fonts/tree/main/ofl/alegreya via https://fontsource.org/fonts/alegreya | OFL-1.1 (`public/fonts/OFL-Alegreya.txt`) | Body text |
| "Fantasy Orchestral Theme" | Joth | https://opengameart.org/content/fantasy-orchestral-theme | CC0-1.0 | `music-title` |
| "Town Theme RPG" | cynicmusic | https://opengameart.org/content/town-theme-rpg | CC0-1.0 | `music-town` |
| "Battle Theme A" | cynicmusic | https://opengameart.org/content/battle-theme-a | CC0-1.0 | `music-combat` |
| "Epic Boss Battle [Seamlessly Looping]" | Juhani Junkala (SubspaceAudio) | https://opengameart.org/content/boss-battle-music | CC0-1.0 | `music-boss` |
| "Medieval: Rejoicing" (loop version) | RandomMind | https://opengameart.org/content/medieval-rejoicing | CC0-1.0 | `music-ending` |
| UI Audio | Kenney (kenney.nl) | https://kenney.nl/assets/ui-audio | CC0-1.0 | `sfx-click`, `sfx-hover` |
| Interface Sounds | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | CC0-1.0 | `sfx-error` |
| Impact Sounds | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | CC0-1.0 | `sfx-hit`, `sfx-crit`, `sfx-boss-roar`, `sfx-death` layers |
| RPG Audio | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | CC0-1.0 | `sfx-loot`, page and latch layers in `sfx-quest-accept`, `sfx-servo-whir`, footsteps |
| Sci-fi Sounds | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | CC0-1.0 | Layers in `sfx-beacon`, `sfx-boss-roar` |
| Music Jingles | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | CC0-1.0 | Pizzicato phrase in `sfx-quest-complete` |
| "20 Sword Sound Effects (Attacks and Clashes)" | StarNinjas | https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes | CC0-1.0 | Metal layer in `sfx-hit`, `sfx-crit` |
| "Cure Magic" | Someoneman | https://opengameart.org/content/cure-magic | CC0-1.0 | Base of `sfx-heal` |
| "RPG Sound Pack" | artisticdude | https://opengameart.org/content/rpg-sound-pack | CC0-1.0 | Base of `sfx-cast` |
| "Fantozzi's Footsteps (Grass/Sand & Stone)" | Fantozzi, sliced by qubodup | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | CC0-1.0 | `sfx-footstep-sand`, `sfx-footstep-stone` |
| "80 CC0 RPG SFX" | rubberduck | https://opengameart.org/content/80-cc0-rpg-sfx | CC0-1.0 | Fire burst in `sfx-beacon` |
| "CC0 Deep Monster Roar" | trazzz123 | https://opengameart.org/content/cc0-deep-monster-roar | CC0-1.0 | Base of `sfx-boss-roar` |
| "Machine shutting down" | Cough-E | https://opengameart.org/content/machine-shutting-down | CC0-1.0 | Base of `sfx-death` |

Synthesised parts (bells, pads, sparkles, the servo motor, sweeps) and all of `sfx-levelup` were made
procedurally by `tools/art/audio_build.py` and are ours. Per-file credits are also in
`public/audio/index.json`.

The music of the breakdance video is not a file in this repository: `tools/trailer/breakdance/beat.py`
synthesises it from sine waves, noise and filters (no samples, no third-party audio) each time the
video is cut, and it is ours like the rest of the project. The same generator, arranged on Robot
Mode's live routine by `tools/robot-routine-music.mjs`, made `public/audio/music-breaking.ogg` and
`.mp3`; they are ours too (Apache-2.0).

Every asset added to this repository must get a row here (source URL, author, license).
