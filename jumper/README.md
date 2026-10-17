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
| `jumper.power_spin_feet` | `break_spin` | spins in place on its feet, about 2.3 turns a second, a calf, a claw palm or the shell on the floor in about a fifth of its steps | paid for its yaw rate, charged for a non-foot part on the floor |
| `jumper.power_jumpspin720` | `break_jumpspin` | jumps, turns about 720 degrees in the air and comes to rest facing where it started | paid for the turn it lands and for its heading at rest two turns round |
| `jumper.power_backflip` | `break_backflip` | jumps and flips backwards through a whole turn | paid for the pitch turn it lands |

The patch also carries `jumper.power_spin` and `jumper.power_jumpspin`, the tasks the shipped spin
and jump spin are built on (the spin on its feet charges more for touching the floor off its feet,
and charges a non-foot part's hull reaching the floor, which the training simulator's force reading
missed; the 720 caps the turn at two turns and pays for coming to rest two turns round).

## Files

| file | size | contents |
|---|---|---|
| `crabcraft-tasks.patch` | 1137 KB | the tasks (`tasks/jumper/skill_*`, `break_*`, `power_*`, the reference clips in `media/`, the jumps' settling terms in `power_jumpspin/mdp/calm.py`, the 720's and the spin's targets decoded within the stops in `power_jumpspin/mdp/stops.py`, the 720's charge on leaning past 30 degrees and its terms for coming to rest two turns round in `power_jumpspin/mdp/rewards.py` and `commands.py`, the spin's charge on a non-foot part's hull reaching the floor in `power_spin_feet/mdp/`, the six-step's heading error in `break_sixstep/observations.py`); the controller building that heading error (`deploy/fsm/src/obs.rs`); `tools/widen_actor_input.py` and `tools/distill_rest.py`; `tools/cem_takeoff.py` and `tools/eval_takeoff_offset.py` (the 720's takeoff offset, searched and measured); `tools/author_skill_clips.py` and `tools/author_breaking_clips.py` (author the clips and run the feasibility checks); `tools/eval_skill.py`, `tools/eval_power.py` and `tools/eval_calm.py` (the acceptance checks, the last how still a jump stands after its landing) and `tools/cap_noise.py`; `deploy/crabcraft.manifests.json` and `deploy/crabcraft.controller.toml` (the example bundle plus the six skills and all seven breakdance moves); a mode's `target_margin` in the controller (`deploy/fsm/src/config.rs`, `control.rs`) and `scripts/deploy.py` carrying a manifest mode's `skip_tilt_check` and `target_margin` into its state (with `deploy/BUNDLE.md` and tests in `tests/test_deploy_hook.py` and the crate); the controller vocabulary for keys 5 to 0; `tests/test_power_handover.py`, `tests/test_power_settle.py`, `tests/test_spin_feet_clearance.py` and the test list entries; `docs/CRABCRAFT_SKILLS.md`, `docs/CRABCRAFT_BREAKING.md`, `docs/CRABCRAFT_POWER.md` |
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
them. Both patches applied to a fresh `78966f4` reproduce our branch file for file (1091 files,
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
laptop GPU) more to come to rest after their landing. Since then the six-step trained 2,000 more
seeing its heading (on an RTX 5080), the 720 3,800 more with its targets clamped at the joint stops
(the RTX 5090 laptop GPU, then the RTX 5080), and the flip about 2,000 more and a distillation
step to come to rest near `HOME`, level (the RTX 5090 laptop GPU). Last, the spin 2,800 more with
its targets clamped at the joint stops (the RTX 5090 laptop GPU), and the 720 a distillation step
and about 3,750 more to come to rest near `HOME`, level, and to lean less in the air (the RTX 5090
laptop GPU, then the RTX 5080). Then the spin 300 more charged for a non-foot part's hull on the
floor (the RTX 5080) and its last 50 on native MuJoCo on a CPU (1,024 environments), and the 720 a
searched and distilled takeoff, then 3,300 and 400 more to come to rest facing where it started
(the RTX 5080, then the RTX 5090 laptop GPU).

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
| six-step | 2.68 deg | 14.66 deg |
| claw stand | 1.01 deg | 23.79 deg |
| one claw | 1.58 deg | 32.84 deg |

The six-step's row is 20 rollouts over two seeds. It turns 357.7 of its 360 degrees without
randomisation and 355.5 to 359.4 with it, all 20 within 10 degrees of a full turn. Its policy sees
one input more than the other tracked moves, `ref_heading_error`: how far its heading has fallen
behind the recording's, which the controller builds from the IMU's yaw counted from the moment the
mode is entered and the recording's own `root_quat`. The export before it could not see its heading
and turned 345.9.

The power moves, measured by `tools/eval_power.py` in their own environment (native MuJoCo, 32
rollouts with the training's randomisation, the spin's and the 720's targets clamped at the joint
stops as the controller clamps them): the spin 2.24 turns a second on average over two seeds
(2.07 to 2.35), staying within 0.26 m of its spot, with a calf, a claw palm or the shell on the
floor in 9 and 15% of its steps, where the export before it touched in 32 and 38% (22% against 43%
without the randomisation). The two jumps are measured from the handover, the pose a controller
switching into their mode hands them (each joint up to 0.1 rad off `HOME`, held 0.05 to 1.0 s): the
720 turns 714 and 710 degrees in the air on average over two seeds (637 to 754) at 0.37 m of rise,
64 of 64 landing upright, leaning 43.3 degrees at the most in the air, and comes to rest 719 and
713 degrees round from where it started (658 to 780); the back flip turns 384
degrees nose-up in the air on average (360 to 395), 32 of 32 landing upright, touching down 27
degrees nose-up (median; 38.7 at most). Both then come to rest (`tools/eval_calm.py`, from 0.5 s
after the landing, 16 rollouts with the randomisation): the 720's joints move at 0.01 to 0.02
rad/s RMS and the flip's at 0.03, against 1.42 and 3.03 for the jumps shipped before the settling,
which shook after landing. The 720 rests within 1.6 degrees of level, its worst gait joint 0.17 rad
from `HOME` at most; the flip within 1.5 degrees, every gait joint within 0.23 rad of `HOME`; a switch
to another mode brings either to that mode's `HOME`.

Through the crabcraft bundle's own controller (`tools/motion/jumper_sim.py` in this game, the
mode switched into from standing and from walking), every mode's targets clamped at the joint
stops: the spin, 12 trials each, ran 2.27 and 2.28 turns a second (2.24 to 2.30) from 2 s to 6 s
with a calf, a claw palm or the shell on the floor in 23% and 21% of the ticks (the export before
it: 43% and 42%), every target it sent within the stops; the 720, 12 trials each that did not
choose it, took off and landed 24 of 24 times, turning 709 to 742 degrees in the air at 0.385 to
0.399 m of rise, leaning 34.1 degrees at most, was at rest 1.03 to 1.15 s after the handover within
1.3 degrees of level, 724.1 and 719.2 degrees round from where it started on average (704.8 to
733.9; the export before it 780 and 789), and walked again 0.43 s after its switch; the back flip landed 24 of
24 with the tilt fallback lifted for its mode (377 to 390 degrees in the air) and was at rest 0.82
to 0.925 s after it, and without the lift went to `safe` at the top of the flip 4 of 4 times; the
six-step turned 357.7 degrees in each of 12 trials and handed back to walking. On the game's
browser physics the 720 turns 707 to 749 degrees and comes to rest 720.5 and 722.7 degrees round on
average (694.9 to 748.4), the flip turns 375 to 383 (12 trials each from standing and walking), and
the six-step 357.7 (6 trials). The numbers are in `docs/CRABCRAFT_POWER.md`, "The bundle with the
three", "The bundle within the stops", "The spin on its feet", "The 720 sticks its landing" and
"The bundle that keeps its feet and sticks the 720", and `docs/CRABCRAFT_BREAKING.md`, "The
six-step's heading".

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

**Every mode keeps its targets within the joint stops.** The controller clamps every decoded
target at its joint's stops unless a mode sets `target_margin`, and no mode in the crabcraft bundle
does. The spin and the 720 first trained with nothing clamping their targets and shipped with
`target_margin = 1.7` (rad), which held a joint against its stop at up to 1.746 N m for as long as
its target pointed past it and could send a target of about 6.45 rad. Both were trained on with
their targets clamped at the stops as the controller clamps them. Through the bundle the spin now
sends 2.71 rad at most and the 720 3.44, no target past a stop; the 720 pushes a joint into its
stop in 0.8% of the joint-steps over the 1.5 s after the handover at a median 0.26 N m, against 6.2%
at 1.20 N m with the margin, and the spin in 0.01% or fewer at 0.1 to 0.3 N m. None of this has run
on a physical Jumper.

**The spin within the stops, then on its feet.** Clamped, the spin first spun 2.29 and 2.30 turns
a second through the bundle, against 2.33 and 2.34 with the margin and 2.03 to 2.05 for the old
policy merely clamped, and leaned on more of its body: a calf, a claw palm or the shell on the floor
in 43% of its steps, against 33 to 35% for the export before (without randomisation). Its task
charged that, but training on MuJoCo Warp hardly saw it: Warp collides a mesh with the floor at up
to four points where native MuJoCo, which the game and every measurement use, collides at one, so a
foot carried the load and a calf beside it pushed over the charge's 1 N in about a tenth of the
steps it touched. Charged also for a non-foot part's hull reaching the floor, the same on either
simulator, and trained its last 50 iterations on native MuJoCo, the spin that ships touches in 22%
of its steps (21 to 23% of the ticks through the bundle) and spins 2.27 and 2.28 turns a second.
With the calves, palms and shell gripping the floor and each other at 0.4 instead of the plane's
1.0 it spins 2.14 to 2.15, against 2.15 for the export before it: most of that is the legs
gripping each other, which the model leaves frictionless (the floor alone at 0.4 costs it 0.04).

**The 720 within the stops, and at rest.** Clamped, it first turned as far through the bundle (715
and 705 degrees on average from standing and walking, against 718 and 705 with the margin) but
rested about 10 degrees nose-up after landing and with the training's randomisation once leaned
49.3 degrees in the air, against the cascade's 50. Trained on to rest near `HOME`, level, with a
charge on leaning past 30 degrees, it turned 727 and 733 on average (719 to 744), rested within
0.9 degrees of level, walked again 0.44 s after the hand-back (0.775 before), leaned 35.0 degrees at
most through the bundle and 42.9 at the worst of 128 randomised flights. That 720 came to rest 780
and 789 degrees round from where it started, 60 to 69 degrees past facing front: it turned about
80 degrees on the floor before it took off and kept them. The one that ships, trained on from a
takeoff searched open-loop and distilled into the policy, to come to rest two turns round, turns 75
to 77 degrees before it takes off, about 700 in the air and 53 back on the floor once it has landed:
at rest 724.1 and 719.2 degrees round through the bundle (704.8 to 733.9), with 709 to 742 in the
air by the body's rate, 0.385 to 0.399 m of
rise, at rest within 1.3 degrees of level, walking again 0.43 s after the hand-back and leaning
34.1 degrees at most (43.3 at the worst of 64 randomised flights). In its own environment without
the randomisation it rests 12 to 14 degrees further round (734 and 736 at two seeds); the game runs
the bundle's controller. The back flip keeps the clamp: given the spin's old margin it turned no
further and bounced after 17 of 24 landings.

**The six-step reads the IMU's yaw.** Its turn closes on the heading error the controller builds
from the yaw in the IMU's quaternion, counted from the moment the mode is entered. The IMU is a
six-axis AHRS whose yaw is integrated from its gyro; whether it does follow the gyro on a physical
Jumper has not been checked. A yaw that held still would show the policy its turn falling further
behind with every degree it turned, and it would push to catch up. Turn the robot by hand and read
the IMU's yaw before running the move on one.

**The 720 and the back flip have no end of their own.** Like the spin they have no recording and no
clock: each jumps once and then stands still near `HOME`, within 1.3 degrees of level (the 720)
and a degree (the flip), until its switch is pressed again, or Menu (Ctrl) on its own. The game's
Robot Mode presses the switch for the person at a fixed time after the handover, 1.4 s for the 720
and 1.2 s for the flip, 0.25 s and 0.275 s after the latest moment either was at rest through this
bundle; it does not detect the landing.

## License

Apache-2.0, like Jumper. The patches change and add files in the Jumper repository, whose
copyright notice is KingKong Robotics; the additions are ours.
