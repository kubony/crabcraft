# New Jumper tasks for World of Crabcraft

The [Jumper repository](https://github.com/KingKongRobotics/jumper) (Apache-2.0) had no policy for
World of Crabcraft's combat moves or for a breakdance, so we wrote new tasks for it and trained
them: six skills, four tracked breaking moves and five reward-driven power-move tasks, of which the
game ships three. They are published here as patches against upstream commit `78966f4`.

**The skills** replace the six combat clips that were hand keyframes:

| task | game move | the move |
|---|---|---|
| `jumper.skill_swipe` | `attack_swipe` | the right claw winds up high and sweeps across the front |
| `jumper.skill_slam` | `attack_slam` | rock back, both claws up and open, down onto the floor in front |
| `jumper.skill_cast` | `cast` | claws gathered, raised and held through a flourish, flung wide on the release |
| `jumper.skill_flinch` | `hit_react` | the shell jolts back while the left claw snaps up across the visor |
| `jumper.skill_powerdown` | `death` | the legs give way one at a time and the shell settles on the floor, then it stands up |
| `jumper.skill_sit` | `sit` | the feet step out, the rear sits down with the front up on the claws, then it stands up |

**The breakdance** is the routine the hero performs (B in the game, and the ending's finale):
toprock, six-step, spin, 720 jump spin, back flip, one-claw freeze.

| task | game clip | the move | how it is trained |
|---|---|---|---|
| `jumper.break_toprock` | `break_toprock` | an 8-count at 107 bpm, a jab with each claw, side steps | tracks a reference clip |
| `jumper.break_sixstep` | `break_sixstep` | footwork: the body low and wide turns once round the point between its claws | tracks a reference clip |
| `jumper.break_clawstand` | `break_clawstand` | a freeze: nose 34 degrees down on both claws, rear legs up | tracks a reference clip |
| `jumper.break_oneclaw` | `break_oneclaw` | the same freeze on the left claw alone | tracks a reference clip |
| `jumper.power_spin_feet` | `break_spin` | spins in place on its feet, about 2.3 turns a second | paid for its yaw rate |
| `jumper.power_jumpspin720` | `break_jumpspin` | jumps and turns about 720 degrees in the air | paid for the turn it lands |
| `jumper.power_backflip` | `break_backflip` | jumps and flips backwards through a whole turn | paid for the pitch turn it lands |

The patch also carries `jumper.power_spin` and `jumper.power_jumpspin`, the tasks the shipped spin
and jump spin are one constant away from (more charge for touching the floor off its feet; two
turns instead of one).

## Files

| file | size | contents |
|---|---|---|
| `crabcraft-tasks.patch` | 762 KB | the tasks (`tasks/jumper/skill_*`, `break_*`, `power_*`, the reference clips in `media/`); `tools/author_skill_clips.py` and `tools/author_breaking_clips.py` (author the clips and run the feasibility checks); `tools/eval_skill.py` and `tools/eval_power.py` (the acceptance checks); `deploy/crabcraft.manifests.json` and `deploy/crabcraft.controller.toml` (the example bundle plus the six skills and all seven breakdance moves); `scripts/deploy.py` carrying a manifest mode's `skip_tilt_check` into its state (with `deploy/BUNDLE.md` and a test in `tests/test_deploy_hook.py`); the controller vocabulary for keys 5 to 0; `tests/test_power_handover.py` and the test list entries; `docs/CRABCRAFT_SKILLS.md`, `docs/CRABCRAFT_BREAKING.md`, `docs/CRABCRAFT_POWER.md` |
| `crabcraft-tasks-exports.patch` | 20.0 MB | the 13 trained policies as exported by `scripts/export.py`: `tasks/jumper/*/out/crabcraft/` (`actor.onnx`, `layout.json`, the trajectory for a tracked move, README), without the checkpoints |

The ONNX policies of the six skills and of all seven breakdance moves ship in this game, in the
crabcraft bundle at `public/robot/bundle/`.

## Apply

```bash
git clone https://github.com/KingKongRobotics/jumper.git && cd jumper
git checkout -b crabcraft 78966f4
git apply /path/to/crabcraft/jumper/crabcraft-tasks.patch
git apply /path/to/crabcraft/jumper/crabcraft-tasks-exports.patch   # optional, the trained policies
```

The exports live under `out/`, which Jumper's `.gitignore` ignores; use `git add -f` if you commit
them. Both patches applied to a fresh `78966f4` reproduce our branch file for file (1077 files,
`diff -r` empty).

## Train, check, bundle

The three docs in the patch have the details. In short, on a CUDA machine:

```bash
python scripts/train.py --task jumper.break_sixstep --backend warp --device cuda:0 --num_envs 4096 --headless --max-iterations 4000
python tools/eval_skill.py --move sixstep --checkpoint <model_N.pt> --dr on --envs 10 --out <dir>
python tools/eval_power.py --task jumpspin720 --checkpoint <model_N.pt> --dr on --envs 32 --out <dir>
python scripts/export.py ...   # see Jumper's docs/USAGE.md
python scripts/deploy.py --manifests deploy/crabcraft.manifests.json --allow-incomplete
```

Each task trained on one H100 at 4096 environments, about 1 s per iteration: the skills 2,000
or 3,000 iterations, the breaking moves 2,000 to 4,000, the power moves 2,500 to 4,000 in
stages.

## How good they are

`tools/eval_skill.py` plays a tracked move from `HOME` through one pass of its clip and reports
the joint RMS against the reference over the move next to what standing still would score (these
clips are mostly lead-in, lead-out and holds, so a rising reward alone does not show a move was
learned). 10 rollouts each with the training's domain randomisation, 0 falls in every row:

| move | joint RMS over the move | standing still |
|---|---|---|
| swipe | 1.12 deg | 21.07 deg |
| slam | 1.44 deg | 27.65 deg |
| cast | 1.68 deg | 39.35 deg |
| flinch | 0.75 deg | 11.15 deg |
| powerdown | 0.83 deg | 17.73 deg |
| sit | 0.42 deg | 16.26 deg |
| toprock | 0.65 deg | 10.06 deg |
| six-step | 2.76 deg | 14.66 deg |
| claw stand | 1.01 deg | 23.79 deg |
| one claw | 1.58 deg | 32.84 deg |

The six-step turns 345.9 of its 360 degrees without randomisation (329 to 359 with it): the robot
cannot see its heading, so the turn is open loop. It did not pass the check we wrote for it
(within 10 degrees of a full turn) and the game uses it as it is.

The power moves, measured by `tools/eval_power.py` in their own environment (native MuJoCo, 32
rollouts with the training's randomisation): the spin 2.32 turns a second (2.25 to 2.44), staying
within 0.28 m of its spot. The two jumps are measured from the handover, the pose a controller
switching into their mode hands them (each joint up to 0.1 rad off `HOME`, held 0.05 to 1.0 s):
the 720 turns 735 degrees in the air on average (664 to 802) at 0.34 m of rise, 32 of 32 landing
upright; the back flip turns 385 degrees nose-up in the air on average over all 32 (376 to 401 in
the 31 that landed upright; the other was a weak take-off, 115 degrees, that tipped onto its rear
feet), touching down 31 degrees nose-up (median; 36.6 at most).

Through the crabcraft bundle's own controller (`tools/motion/jumper_sim.py` in this game, the
mode switched into from standing, walking or turning): the 720 took off and landed 20 of 20
times, turning 512 to 674 degrees in the air; the back flip landed 12 of 12 with the tilt fallback
lifted for its mode (385 to 393 degrees in the air, under 2.7 degrees of tilt 0.3 s after the
touchdown) and 0 of 12 without it (the controller dropped it to `safe` at the top of the flip).

## Not done

**Nothing here has run on a physical Jumper.** The bundle was built with `--allow-incomplete`: it
has the browser and MuJoCo hosts but no board controller and no `.rknn` models. The power moves and
the six-step are results in simulation only.

**The back flip's mode lifts the controller's tilt fallback.** The flip turns upside down in the air
(177 degrees of tilt), and the cascade's 50-degree `tilted` rule would drop it to `safe`, damping
only, at the top of the flip. So `power_backflip` sets `skip_tilt_check` in the manifest, which
`scripts/deploy.py` now writes into that mode's state and no other. On a physical robot this means
nothing catches a fall while the flip runs: a weak take-off that tips over keeps running the flip's
policy until the mode is left. The entering tick is still checked and `feedback_stale` still
applies. A first try on hardware would want a soft floor and a hand on the release.

**The 720 and the back flip have no end of their own.** Like the spin they have no recording and no
clock: each jumps once and then stands at `HOME` until its switch is pressed again, or Menu (Ctrl)
on its own. The game's Robot Mode presses the switch for the person at a fixed time after the
handover, 1.4 s for the 720 and 1.2 s for the flip, measured on the game's recordings of both
moves through this bundle; it does not detect the landing.

## License

Apache-2.0, like Jumper. The patches change and add files in the Jumper repository, whose
copyright notice is KingKong Robotics; the additions are ours.
