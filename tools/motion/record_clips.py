"""Record every policy-backed game clip as a closed-loop rollout of the bundle's own policies.

    python -I tools/motion/record_clips.py [--out scratch/motion-raw] [--only walk_fwd,jump]

Each clip is a fresh robot standing on the floor at the calibrated home pose, driven through the
bundle's controller exactly like `play --app` drives it: velocity commands for locomotion, the
bundle's own pad bindings to enter jump / gestures / dances / claws. Writes one raw `<id>.npz`
per clip (200 Hz control-tick samples); `export_clips.py` turns those into game clips.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jumper_sim import Host  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# Locomotion commands in the robot frame (m/s forward, m/s left, rad/s CCW). The crab faces the
# robot's display side, so "forward" in the game is the robot's +X.
LOCOMOTION = {
    "idle": (0.0, 0.0, 0.0),
    "walk_fwd": (0.28, 0.0, 0.0),
    "walk_fast": (0.62, 0.0, 0.0),
    "walk_back": (-0.25, 0.0, 0.0),
    "strafe_left": (0.0, 0.3, 0.0),
    "strafe_right": (0.0, -0.3, 0.0),
    "turn_left": (0.0, 0.0, 1.6),
    "turn_right": (0.0, 0.0, -1.6),
}

# Pad chords from the bundle's controller.toml: d-pad alone = gestures, Menu + d-pad = dances.
GESTURES = {
    "gesture_hello": ((0, 1), False, "gesture_hello"),
    "gesture_bow": ((0, -1), False, "gesture_bow"),
    "gesture_paw": ((-1, 0), False, "gesture_paw"),
    "gesture_salute": ((1, 0), False, "gesture_salute"),
    "dance_crab": ((0, 1), True, "dance_crab"),
    "dance_brazilian": ((0, -1), True, "dance_brazilian"),
    "dance_maze": ((-1, 0), True, "dance_maze"),
    "dance_dream_wings": ((1, 0), True, "dance_dream_wings"),
}

STAND = 1.5  # seconds standing before anything is asked


def save(out: Path, cid: str, host: Host, meta: dict) -> None:
    t, qpos, contacts, modes, running, target = host.rec.arrays()
    names = sorted(set(modes))
    np.savez_compressed(
        out / f"{cid}.npz",
        t=t, qpos=qpos, contacts=contacts, running=running, target=target,
        mode=np.array([names.index(m) for m in modes], dtype=np.int8),
        mode_names=np.array(names),
        meta=np.array(json.dumps({**meta, "marks": host.rec.marks, "inferences": host.inferences,
                                   "log": [list(map(str, e)) for e in host.log]})),
    )


def record_locomotion(cid: str, cmd) -> Host:
    h = Host(operators=False, render=False)
    h.run(STAND)
    h.rec.mark("command", h.t)
    h.command(*cmd)
    h.run(9.0)
    return h


def record_motion(cid: str) -> Host:
    dpad, chord, mode = GESTURES[cid]
    h = Host(operators=False, render=False)
    h.run(STAND)
    h.rec.mark("trigger", h.t)
    if chord:
        h.button("menu", True)
        h.run(0.04)
    h.pad(dpad=dpad)
    h.run(0.04)
    h.pad(dpad=(0, 0))
    h.run(0.04)
    if chord:
        h.button("menu", False)
    entered = False
    limit = 400.0
    while h.t < limit:
        h.step()
        if h.mode == mode:
            entered = True
        elif entered and h.mode == "locomotion":
            h.rec.mark("left", h.t)
            break
    if not entered:
        raise SystemExit(f"{cid}: the controller never entered {mode}")
    # until the switch-back ramp has handed over and the robot has settled
    while not h.fsm.running_policy and h.t < limit:
        h.step()
    h.rec.mark("locomotion", h.t)
    h.run(1.2)
    return h


def record_jump() -> Host:
    h = Host(operators=False, render=False)
    h.run(STAND)
    h.rec.mark("trigger", h.t)
    h.press("A", 0.04)
    entered = False
    while h.t < 30:
        h.step()
        if h.mode == "jump":
            entered = True
        elif entered and h.mode == "locomotion":
            h.rec.mark("left", h.t)
            break
    while not h.fsm.running_policy and h.t < 30:
        h.step()
    h.rec.mark("locomotion", h.t)
    h.run(1.0)
    return h


def record_claw(side: str) -> Host:
    """Raise the claw, reach it straight out thumb up, snap it shut, let go, stow, walk again.

    The claw modes read the person through their own controls (operators=True): LB/RB toggles the
    mode, d-pad up holds the carried arm straight out, LT/RT closes the claw by how far it is held.
    """
    toggle, trigger = ("LB", "LT") if side == "left" else ("RB", "RT")
    mode = f"claw_{side}"
    h = Host(operators=True, render=False)
    h.run(STAND)
    h.rec.mark("trigger", h.t)
    h.press(toggle, 0.04)
    while not (h.mode == mode and h.fsm.running_policy) and h.t < 20:
        h.step()
    h.rec.mark("running", h.t)
    h.run(0.25)
    h.rec.mark("reach", h.t)
    h.pad(dpad=(0, 1))
    h.run(0.75)
    h.rec.mark("close", h.t)
    # a quick squeeze: the trigger travels in 80 ms, as a thumb would
    for k in range(1, 17):
        h.pad(axes={trigger: k / 16})
        h.step()
    h.run(0.45)
    h.rec.mark("open", h.t)
    h.pad(axes={trigger: 0.0})
    h.run(0.3)
    h.rec.mark("retract", h.t)
    h.pad(dpad=(0, 0))
    h.run(0.6)
    h.rec.mark("exit", h.t)
    h.press(toggle, 0.04)
    while not (h.mode == "locomotion" and h.fsm.running_policy) and h.t < 30:
        h.step()
    h.rec.mark("locomotion", h.t)
    h.run(0.8)
    return h


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "scratch" / "motion-raw")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    jobs = [(cid, "locomotion", cmd) for cid, cmd in LOCOMOTION.items()]
    jobs += [("jump", "jump", None), ("claw_left", "claw", "left"), ("claw_right", "claw", "right")]
    jobs += [(cid, "motion", None) for cid in GESTURES]
    for cid, kind, arg in jobs:
        if only and cid not in only:
            continue
        t0 = time.time()
        if kind == "locomotion":
            h = record_locomotion(cid, arg)
            meta = {"kind": kind, "command": arg, "source": "locomotion"}
        elif kind == "jump":
            h = record_jump()
            meta = {"kind": kind, "source": "jump"}
        elif kind == "claw":
            h = record_claw(arg)
            meta = {"kind": kind, "source": f"claw_{arg}"}
        else:
            h = record_motion(cid)
            meta = {"kind": kind, "source": GESTURES[cid][2]}
        save(args.out, cid, h, meta)
        print(f"{cid:18s} {h.t:7.2f}s sim  {time.time() - t0:6.1f}s wall  inferences={h.inferences:6d}  "
              f"end mode={h.mode} tilt={h.tilt_deg():.1f} deg  marks={ {k: [round(x, 2) for x in v] for k, v in h.rec.marks.items()} }")


if __name__ == "__main__":
    main()
