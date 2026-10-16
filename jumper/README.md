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
| `crabcraft-tasks.patch` | 859 KB | the tasks (`tasks/jumper/skill_*`, `break_*`, `power_*`, the reference clips in `media/`, the jumps' settling terms in `power_jumpspin/mdp/calm.py`); `tools/author_skill_clips.py` and `tools/author_breaking_clips.py` (author the clips and run the feasibility checks); `tools/eval_skill.py`, `tools/eval_power.py` and `tools/eval_calm.py` (the acceptance checks, the last how still a jump stands after its landing) and `tools/cap_noise.py`; `deploy/crabcraft.manifests.json` and `deploy/crabcraft.controller.toml` (the example bundle plus the six skills and all seven breakdance moves); a mode's `target_margin` in the controller (`deploy/fsm/src/config.rs`, `control.rs`) and `scripts/deploy.py` carrying a manifest mode's `skip_tilt_check` and `target_margin` into its state (with `deploy/BUNDLE.md` and tests in `tests/test_deploy_hook.py` and the crate); the controller vocabulary for keys 5 to 0; `tests/test_power_handover.py`, `tests/test_power_settle.py` and the test list entries; `docs/CRABCRAFT_SKILLS.md`, `docs/CRABCRAFT_BREAKING.md`, `docs/CRABCRAFT_POWER.md` |
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
them. Both patches applied to a fresh `78966f4` reproduce our branch file for file (1081 files,
`diff -r` empty).

## Train, check, bundle

The three docs in the patch have the details. In short, on a CUDA machine:

```bash
python scripts/train.py --task jumper.break_sixstep --backend warp --device cuda:0 --num_envs 4096 --headless --max-iterations 4000
python tools/eval_skill.py --move sixstep --checkpoint <model_N.pt> --dr on --envs 10 --out <dir>
python tools/eval_power.py --task jumpspin720 --checkpoint <model_N.pt> --dr on --envs 32 --out <dir>
python tools/eval_calm.py --task backflip --checkpoint <model_N.pt> --dr on --envs 16 --out <dir>
python scripts/export.py ...   # see Jumper's docs/USAGE.md
python scripts/deploy.py --manifests deploy/crabcraft.manifests.json --allow-incomplete
```

Each task trained on one H100 at 4096 environments, about 1 s per iteration: the skills 2,000
or 3,000 iterations, the breaking moves 2,000 to 4,000, the power moves 2,500 to 4,000 in
stages, and then the two jumps 1,250 (the 720) and 1,900 (the flip, its last 950 on an RTX 5090
laptop GPU) more to come to rest after their landing.

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
the 720 turns 706 degrees in the air on average (600 to 753) at 0.37 m of rise, 32 of 32 landing
upright; the back flip turns 387 degrees nose-up in the air on average (379 to 406), 32 of 32
landing upright, touching down 25 degrees nose-up (median; 35.3 at most). Both then come to rest
(`tools/eval_calm.py`, from 0.5 s after the landing, 16 rollouts with the randomisation): the
720's joints move at 0.03 rad/s RMS and the flip's at 0.10, against 1.42 and 3.03 for the jumps
shipped before these, which shook after landing; the flip stands 6 to 8 degrees nose-down on its
rear and middle legs swung back until a switch to another mode brings it to that mode's `HOME`.

Through the crabcraft bundle's own controller (`tools/motion/jumper_sim.py` in this game, the
mode switched into from standing and from walking, 12 trials each): the 720, its targets let 1.7
rad past the joint stops (below), took off and landed 24 of 24 times, turning 673 to 744 degrees
in the air at 0.37 to 0.40 m of rise (511 to 653 with them clamped at the stops), and was at rest
0.99 to 1.14 s after the handover; the back flip landed 24 of 24 with the tilt fallback lifted for
its mode (385 to 395 degrees in the air) and was at rest 0.70 to 0.86 s after it, and without the
lift went to `safe` at the top of the flip 4 of 4 times. The spin, its targets let past the stops
too, ran 2.33 turns a second (2.29 to 2.36) from 2 s to 6 s, against 2.04 clamped. On the game's
browser physics the 720 turns 690 to 746 degrees and the flip 381 to 395 (12 trials each from
standing and walking). The numbers are in `docs/CRABCRAFT_POWER.md`, "The final bundle".

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

**The 720 and the spin send targets past the joint stops.** Training clamps no joint target, and
the controller clamped every decoded target at its joint's stops, which cost the 720 100 to 150
degrees of its turn (on average from walking and from standing) and the spin 0.3 turns a second
through the bundle. Their two modes now set
`target_margin = 1.7` (rad): the controller lets their targets go up to 1.7 rad past a stop, and
every other mode keeps the clamp. On a robot this means a joint that reaches its stop is held
against it at the PD's torque, up to 1.746 N m (1.2 N m once the 0.3 s peak budget is spent), for
as long as its target points past it, where under the clamp the torque fell to zero there: for the
720 in 6.2 to 7.4% of the joint-steps over the 1.5 s after the handover and none after 1.0 s, for
the spin for as long as it is held. The transmitted target can reach about 6.45 rad (the
shoulders' -4.75 rad stop less 1.7; the 720 sent 4.45 at most), and whether the servos take a
position command that far outside their range is not checked against their protocol. None of
this has run on a physical Jumper. The back flip keeps the clamp: given the margin it turned no
further and bounced after 20 of 24 landings.

**The 720 and the back flip have no end of their own.** Like the spin they have no recording and no
clock: each jumps once and then stands still, the flip on its splayed rear legs, until its switch
is pressed again, or Menu (Ctrl) on its own. The game's Robot Mode presses the switch for the
person at a fixed time after the handover, 1.4 s for the 720 and 1.2 s for the flip, 0.26 s and
0.34 s after the latest moment either was at rest through this bundle; it does not detect the
landing.

## License

Apache-2.0, like Jumper. The patches change and add files in the Jumper repository, whose
copyright notice is KingKong Robotics; the additions are ours.
