"""Record every policy-backed game clip as a closed-loop rollout of the bundle's own policies.

    python -I tools/motion/record_clips.py [--out scratch/motion-raw] [--only walk_fwd,jump]
    python -I tools/motion/record_clips.py --bundle <jumper>/out/bundle_<ts>/crabcraft --only skills
    python -I tools/motion/record_clips.py --bundle <jumper>/out/bundle_<ts>/crabcraft --only breaks

Each clip is a fresh robot standing on the floor at the calibrated home pose, driven through the
bundle's controller exactly like `play --app` drives it: velocity commands for locomotion, the
bundle's own pad bindings to enter jump / gestures / dances / claws / skills. Writes one raw
`<id>.npz` per clip (200 Hz control-tick samples); `export_clips.py` turns those into game clips.

The six skills (attack_swipe, attack_slam, cast, hit_react, death, sit) are the `jumper.skill_*`
policies, which only the crabcraft bundle carries: record them with `--bundle` pointing at it. So are
the seven breakdance clips, on the bundle's Home chords: the four `jumper.break_*` moves, the spin
(`jumper.power_spin_feet`), the 720 jump spin (`jumper.power_jumpspin720`) and the back flip
(`jumper.power_backflip`). The last three have no recording and no clock, so nothing ends them: each is
let go with its own chord after a fixed time, as a person would, the same time Robot Mode's host waits
before it presses the switch for them (src/robot/sim/core.ts, AUTO_LEAVE_S).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jumper_sim import BUNDLE, Host  # noqa: E402

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
    # not MotionIds: the runtime blends them in for fast sideways scuttling (A/D held while running)
    "strafe_left_fast": (0.0, 0.62, 0.0),
    "strafe_right_fast": (0.0, -0.62, 0.0),
    # diagonals and arcs, so 8-way movement and steering while running are real rollouts too
    "walk_fl": (0.2, 0.2, 0.0),
    "walk_fr": (0.2, -0.2, 0.0),
    "walk_bl": (-0.18, 0.18, 0.0),
    "walk_br": (-0.18, -0.18, 0.0),
    "walk_fast_fl": (0.44, 0.44, 0.0),
    "walk_fast_fr": (0.44, -0.44, 0.0),
    "walk_arc_left": (0.28, 0.0, 0.9),
    "walk_arc_right": (0.28, 0.0, -0.9),
    "walk_fast_arc_left": (0.6, 0.0, 1.3),
    "walk_fast_arc_right": (0.6, 0.0, -1.3),
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

# The crabcraft bundle's six skills (deploy/manifests.json, bundle "crabcraft"): Menu + a pad
# button, from locomotion. Game clip id -> (pad button held with Menu, bundle mode).
SKILLS = {
    "attack_swipe": ("A", "skill_swipe"),
    "attack_slam": ("X", "skill_slam"),
    "cast": ("Y", "skill_cast"),
    "hit_react": ("LB", "skill_flinch"),
    "death": ("RB", "skill_powerdown"),
    "sit": ("L3", "skill_sit"),
}

# The crabcraft bundle's breakdance modes (deploy/crabcraft.manifests.json): Home + a pad button
# (or the d-pad's up), from locomotion. Game clip id -> (pad control held with Home, bundle mode,
# seconds the policy is left running before its switch is pressed again, or None for a recording
# that ends by itself).
BREAKS = {
    "break_toprock": ("A", "break_toprock", None),
    "break_sixstep": ("X", "break_sixstep", None),
    "break_clawstand": ("Y", "break_clawstand", None),
    "break_oneclaw": ("L3", "break_oneclaw", None),
    # No recording and no clock: it spins until let go. 3.5 s is the spin-up and about six turns.
    "break_spin": ("LB", "power_spin", 3.5),
    # No recording and no clock either: each jumps once and stands. Let go after the landing has
    # settled, at Robot Mode's own times (src/robot/sim/core.ts, AUTO_LEAVE_S).
    "break_jumpspin": ("RB", "power_jumpspin", 1.4),
    "break_backflip": ("dpad_up", "power_backflip", 1.2),
}

# The d-pad is a pad axis pair, not a button: control name -> (x, y).
DPAD = {"dpad_up": (0, 1), "dpad_down": (0, -1), "dpad_left": (-1, 0), "dpad_right": (1, 0)}

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


BUNDLE_ARG: Path | None = None


def new_host(*, operators: bool = False) -> Host:
    return Host(operators=operators, render=False, bundle=BUNDLE_ARG)


def record_locomotion(cid: str, cmd) -> Host:
    h = new_host()
    h.run(STAND)
    h.rec.mark("command", h.t)
    h.command(*cmd)
    h.run(9.0)
    return h


def record_motion(cid: str) -> Host:
    dpad, chord, mode = GESTURES[cid]
    h = new_host()
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


def record_skill(cid: str) -> Host:
    """Menu held, the skill's button pressed and let go, Menu let go: the bundle's own chord.

    Then until the recording has played out, the controller has handed back to locomotion and
    the walking policy is running again, and 1.2 s of standing after, as for the gestures."""
    button, mode = SKILLS[cid]
    h = new_host()
    if mode not in h.contracts:
        raise SystemExit(f"{cid}: the bundle {h.bundle} has no mode {mode}; record skills with "
                         "--bundle <the crabcraft bundle>")
    h.run(STAND)
    h.rec.mark("trigger", h.t)
    h.button("menu", True)
    h.run(0.04)
    h.button(button, True)
    h.run(0.04)
    h.button(button, False)
    h.run(0.04)
    h.button("menu", False)
    entered = False
    limit = 60.0
    while h.t < limit:
        h.step()
        if h.mode == mode:
            entered = True
        elif entered and h.mode == "locomotion":
            h.rec.mark("left", h.t)
            break
    if not entered:
        raise SystemExit(f"{cid}: the controller never entered {mode}")
    while not h.fsm.running_policy and h.t < limit:
        h.step()
    h.rec.mark("locomotion", h.t)
    h.run(1.2)
    return h


def record_break(cid: str) -> Host:
    """Home held, the move's button pressed and let go, Home let go: the bundle's own chord.

    A recording plays out and hands back by itself; the spin and the two jumps, which have no end of
    their own, are left running for their seconds from the handover and then let go with the same
    chord, as a person would. Then until the walking policy is running again, and 1.2 s of standing
    after, as for the skills."""
    button, mode, hold = BREAKS[cid]
    h = new_host()
    if mode not in h.contracts:
        raise SystemExit(f"{cid}: the bundle {h.bundle} has no mode {mode}; record the breakdance "
                         "with --bundle <the crabcraft bundle>")

    def control(down: bool) -> None:
        if button in DPAD:
            h.pad(dpad=DPAD[button] if down else (0, 0))
        else:
            h.button(button, down)

    def chord() -> None:
        h.button("home", True)
        h.run(0.04)
        control(True)
        h.run(0.04)
        control(False)
        h.run(0.04)
        h.button("home", False)

    h.run(STAND)
    h.rec.mark("trigger", h.t)
    chord()
    entered = False
    started = None
    limit = 60.0
    while h.t < limit:
        h.step()
        if h.mode == mode:
            entered = True
            if started is None and h.fsm.running_policy:
                started = h.t
            if hold is not None and started is not None and h.t - started >= hold:
                h.rec.mark("let_go", h.t)
                chord()
                hold = None
        elif entered and h.mode == "locomotion":
            h.rec.mark("left", h.t)
            break
    if not entered:
        raise SystemExit(f"{cid}: the controller never entered {mode}")
    while not h.fsm.running_policy and h.t < limit:
        h.step()
    h.rec.mark("locomotion", h.t)
    h.run(1.2)
    return h


def record_jump() -> Host:
    h = new_host()
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
    h = new_host(operators=True)
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
    ap.add_argument("--only", default="",
                    help="clip ids, comma-separated; `skills` for the six skills, `breaks` for the "
                         "seven breakdance clips")
    ap.add_argument("--bundle", type=Path, default=None,
                    help="the bundle to drive (default: the jumper checkout's example bundle)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    global BUNDLE_ARG
    BUNDLE_ARG = args.bundle
    only = set(filter(None, args.only.split(",")))
    if "skills" in only:
        only = (only - {"skills"}) | set(SKILLS)
    if "breaks" in only:
        only = (only - {"breaks"}) | set(BREAKS)
    jobs = [(cid, "locomotion", cmd) for cid, cmd in LOCOMOTION.items()]
    jobs += [("jump", "jump", None), ("claw_left", "claw", "left"), ("claw_right", "claw", "right")]
    jobs += [(cid, "motion", None) for cid in GESTURES]
    bundle = args.bundle or BUNDLE
    modes = json.loads((bundle / "bundle.json").read_text("utf-8"))["modes"]
    carried = [cid for cid, (_, mode) in SKILLS.items() if mode in modes]
    jobs += [(cid, "skill", None) for cid in carried]
    carried_breaks = [cid for cid, (_, mode, _) in BREAKS.items() if mode in modes]
    jobs += [(cid, "break", None) for cid in carried_breaks]
    missing_breaks = sorted(set(BREAKS) - set(carried_breaks))
    if only & set(missing_breaks):
        raise SystemExit(f"{bundle} has no mode for {sorted(only & set(missing_breaks))}; record the "
                         "breakdance with --bundle <the crabcraft bundle>")
    missing = sorted(set(SKILLS) - set(carried))
    if only & set(missing):
        raise SystemExit(f"{bundle} has no mode for {sorted(only & set(missing))}; record the skills "
                         "with --bundle <the crabcraft bundle>")
    if missing and not only:
        print(f"skipped {missing}: {bundle} does not carry their modes (record them with --bundle "
              "<the crabcraft bundle>)")
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
        elif kind == "skill":
            h = record_skill(cid)
            meta = {"kind": kind, "source": SKILLS[cid][1], "bundle": str(h.bundle)}
        elif kind == "break":
            h = record_break(cid)
            meta = {"kind": kind, "source": BREAKS[cid][1], "bundle": str(h.bundle),
                    "method": "bundle"}
        else:
            h = record_motion(cid)
            meta = {"kind": kind, "source": GESTURES[cid][2]}
        save(args.out, cid, h, meta)
        print(f"{cid:18s} {h.t:7.2f}s sim  {time.time() - t0:6.1f}s wall  inferences={h.inferences:6d}  "
              f"end mode={h.mode} tilt={h.tilt_deg():.1f} deg  marks={ {k: [round(x, 2) for x in v] for k, v in h.rec.marks.items()} }")


if __name__ == "__main__":
    main()
