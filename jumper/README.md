# Six new Jumper tasks: `jumper.skill_*`

The six combat moves in World of Crabcraft (`attack_swipe`, `attack_slam`, `cast`, `hit_react`,
`death`, `sit`) had no Jumper policy, so we wrote six new tasks for the
[Jumper repository](https://github.com/KingKongRobotics/jumper) (Apache-2.0) and trained them.
They are published here as patches against upstream commit `78966f4`.

| task | game move | the move |
|---|---|---|
| `jumper.skill_swipe` | `attack_swipe` | the right claw winds up high and sweeps across the front |
| `jumper.skill_slam` | `attack_slam` | rock back, both claws up and open, down onto the floor in front |
| `jumper.skill_cast` | `cast` | claws gathered, raised and held through a flourish, flung wide on the release |
| `jumper.skill_flinch` | `hit_react` | the shell jolts back while the left claw snaps up across the visor |
| `jumper.skill_powerdown` | `death` | the legs give way one at a time and the shell settles on the floor, then it stands up |
| `jumper.skill_sit` | `sit` | the feet step out, the rear sits down with the front up on the claws, then it stands up |

## Files

| file | size | contents |
|---|---|---|
| `crabcraft-skills.patch` | 326 KB | the six tasks (`tasks/jumper/skill_*`, reference clips in `media/`), `tools/author_skill_clips.py` (authors the clips and runs the feasibility checks), `tools/eval_skill.py` (the acceptance check below), `deploy/crabcraft.manifests.json` and `deploy/crabcraft.controller.toml` (the example bundle plus the six skills), the controller vocabulary for keys 5 to 0, a test list entry, and `docs/CRABCRAFT_SKILLS.md` |
| `crabcraft-skills-exports.patch` | 8.6 MB | the trained policies as exported by `scripts/export.py`: `tasks/jumper/skill_*/out/crabcraft/` (`actor.onnx`, `layout.json`, trajectory, README), without the checkpoints |

The same six ONNX policies ship in this game at `public/robot/bundle/models/skill_*.onnx`.

## Apply

```bash
git clone https://github.com/KingKongRobotics/jumper.git && cd jumper
git checkout -b crabcraft-skills 78966f4
git apply /path/to/crabcraft/jumper/crabcraft-skills.patch
git apply /path/to/crabcraft/jumper/crabcraft-skills-exports.patch   # optional, the trained policies
```

The exports live under `out/`, which Jumper's `.gitignore` ignores; use `git add -f` if you commit
them. Both patches together reproduce our branch file for file.

## Train, check, bundle

`docs/CRABCRAFT_SKILLS.md` (in the patch) has the details. In short, on a CUDA machine:

```bash
python scripts/train.py --task jumper.skill_slam --backend warp --device cuda:0 --num_envs 4096 --headless --max-iterations 3000
python tools/eval_skill.py --move slam --checkpoint <model_N.pt> --dr on --envs 10 --out <dir>
python scripts/export.py ...   # see Jumper's docs/USAGE.md
python scripts/deploy.py --manifests deploy/crabcraft.manifests.json --allow-incomplete
```

We trained each task on one H100 for 2,000 iterations (swipe, flinch, cast) or 3,000 (slam,
power-down, sit), about 1 s per iteration.

## The acceptance check

These clips are mostly the lead-in from `HOME`, the lead-out back to it and the hold there. A
robot that never moves already earns part of the tracking reward on them, so a rising reward
alone does not show that a policy learned the move. `tools/eval_skill.py` plays a checkpoint from
`HOME` through one pass of its clip and reports the joint RMS against the reference over the move
window next to what standing still would score. Our six policies, 10 rollouts each with the
training's domain randomisation:

| move | joint RMS over the move | standing still | falls |
|---|---|---|---|
| swipe | 1.12 deg | 21.07 deg | 0 of 10 |
| slam | 1.44 deg | 27.65 deg | 0 of 10 |
| cast | 1.68 deg | 39.35 deg | 0 of 10 |
| flinch | 0.75 deg | 11.15 deg | 0 of 10 |
| powerdown | 0.83 deg | 17.73 deg | 0 of 10 |
| sit | 0.42 deg | 16.26 deg | 0 of 10 |

## Not done

The bundle was built with `--allow-incomplete`: it has the browser and MuJoCo hosts but no board
controller and no `.rknn` models, so these six moves have not been run on a physical Jumper.

## License

Apache-2.0, like Jumper. The patches change and add files in the Jumper repository, whose
copyright notice is KingKong Robotics; the additions are ours.
