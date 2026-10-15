"""Turn raw rollouts (record_clips.py) into game clips under public/motions/.

    python -I tools/motion/export_clips.py [--raw scratch/motion-raw] [--out public/motions]

Locomotion: the steady-state gait is cut into a seamless loop where the joint state repeats
(whole gait cycles), and the seam is crossfaded. Everything else is kept whole, from the
moment the bundle's button is pressed until the robot is standing again.

The six skills (record_clips.py SKILLS, the `jumper.skill_*` policies) are kept whole the same
way and carry, besides, their reference's moments moved to where the policy played them, the
game's window of the move in clip seconds, and for death and sit the moment the game holds. The
windows and moments are also written to src/motion/skillClips.ts, which gameplay reads.

The seven breakdance clips (record_clips.py BREAKS and record_rollouts.py ROLLOUTS) are kept whole
too. The four tracked moves carry their reference's moments moved by the policy's lag, as the
skills do; the spin its own start and let-go; the two jumps (direct rollouts in their training
environment, not the bundle) their take-off, apex and landing read off the rollout. Each carries
the window the routine plays, and src/motion/breakClips.ts lists them for gameplay.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import mujoco
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clipfile import (  # noqa: E402
    JOINT_NAMES, mj_to_game_pos, mj_to_game_quat_xyzw, qcontinuous, qmul, qnormalize, qyaw,
    resample, write_clip, write_index, yaw_of,
)
from jumper_sim import JUMPER, LEGS, load_model  # noqa: E402

# The six skills: game clip id -> the jumper.skill_* move, the window the game plays in the
# reference's own seconds ("The game's windows", docs/CRABCRAFT_SKILLS.md in the jumper checkout),
# the stretch the policy's lag is fitted over (the move, holds included), the reference moment
# the game's `hit` is, and for the two that hold, the moment the game holds.
SKILLS = {
    "attack_swipe": {"move": "swipe", "window": (0.00, 0.94), "fit": (0.00, 0.94), "hit": "hit"},
    "attack_slam": {"move": "slam", "window": (0.40, 1.50), "fit": (0.40, 1.50), "hit": "hit"},
    "cast": {"move": "cast", "window": (0.40, 3.10), "fit": (0.40, 3.10), "hit": "release"},
    "hit_react": {"move": "flinch", "window": (0.00, 0.46), "fit": (0.00, 0.46), "hit": "hit"},
    # the power-down settles at 2.05 and stays down to 3.20: the game holds 0.25 s into that
    "death": {"move": "powerdown", "window": (0.00, 2.30), "fit": (0.00, 3.20), "hit": None,
              "hold": 2.30, "settled": "settled_from"},
    # seated 1.70 to 2.90 (one breath): the game holds 0.25 s into it
    "sit": {"move": "sit", "window": (0.80, 1.95), "fit": (0.80, 2.90), "hit": None,
            "hold": 1.95, "settled": "seated_from"},
}
SKILL_TABLE = Path(__file__).resolve().parents[2] / "src" / "motion" / "skillClips.ts"

# The breakdance: game clip id -> how its routine window is found. A tracked move ("move") is cut
# in its reference's seconds as the skills are: from the policy's first tick (the reference's 0,
# the robot at HOME) to the end of the move, before the lead-out and the hold
# (docs/CRABCRAFT_BREAKING.md in the jumper checkout, "The game's windows"); `hit` names the
# reference moment the game reacts to. The spin runs from its policy's start until the
# controller's ramp after the let-go has stood it up; the jumps from the episode's start until the
# landing has settled.
BREAKS = {
    "break_toprock": {"move": "toprock", "window": (0.00, 5.32), "fit": (0.00, 5.32), "hit": "beat8"},
    "break_sixstep": {"move": "sixstep", "window": (0.00, 4.40), "fit": (0.00, 4.40), "hit": "turn_to"},
    "break_clawstand": {"move": "clawstand", "window": (0.00, 5.60), "fit": (0.00, 5.60), "hit": "hit"},
    "break_oneclaw": {"move": "oneclaw", "window": (0.00, 5.60), "fit": (0.00, 5.60), "hit": "hit"},
    "break_spin": {"spin": True},
    "break_jumpspin": {"jump": True},
    "break_backflip": {"jump": True},
}
BREAK_TABLE = Path(__file__).resolve().parents[2] / "src" / "motion" / "breakClips.ts"

ROOT = Path(__file__).resolve().parents[2]
DT = 0.005
LOCO_FPS = 50.0
ACTION_FPS = {"jump": 50.0, "claw": 50.0, "motion": 30.0, "skill": 50.0, "break": 50.0}
LOOP_TARGET_S = {"idle": 2.5}
LOOP_MIN_S = 0.9


def gravity_body(quat: np.ndarray) -> np.ndarray:
    w, x, y, z = np.moveaxis(quat, -1, 0)
    # third row of R (world z expressed in the body frame), negated: gravity direction
    return -np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)


def onsets(contact: np.ndarray, t: np.ndarray, *, off_min: int = 3, on_min: int = 2) -> list[float]:
    """Contact onsets after the foot has been off for a while (footfalls)."""
    out, off_run, i = [], 0, 0
    n = len(contact)
    while i < n:
        if not contact[i]:
            off_run += 1
            i += 1
            continue
        if off_run >= off_min and i + on_min <= n and contact[i:i + on_min].all():
            out.append(float(t[i]))
        off_run = 0
        i += 1
    return out


def moving_average(x: np.ndarray, win: int) -> np.ndarray:
    """Centered moving average over `win` samples; edges use the nearest full window."""
    k = np.ones(win) / win
    if x.ndim == 1:
        x = x[:, None]
    out = np.stack([np.convolve(x[:, j], k, mode="same") for j in range(x.shape[1])], -1)
    h = win // 2
    out[:h] = out[h]
    out[-h:] = out[-h - 1]
    return out.squeeze()


class Raw:
    def __init__(self, path: Path, model: mujoco.MjModel):
        z = np.load(path)
        self.id = path.stem
        self.t = z["t"]
        self.qpos = z["qpos"]
        self.contacts = z["contacts"]
        self.running = z["running"]
        names = list(z["mode_names"])
        self.modes = [names[i] for i in z["mode"]]
        self.meta = json.loads(str(z["meta"]))
        self.marks = self.meta["marks"]
        adr = [model.jnt_qposadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in JOINT_NAMES]
        self.q = self.qpos[:, adr]
        self.pos = self.qpos[:, :3]
        self.quat = qcontinuous(qnormalize(self.qpos[:, 3:7]))
        self.yaw = np.unwrap(yaw_of(self.quat))


def to_game_block(pos_mj: np.ndarray, quat_mj: np.ndarray) -> np.ndarray:
    return np.concatenate([mj_to_game_pos(pos_mj), mj_to_game_quat_xyzw(qcontinuous(quat_mj))], -1)


def relative_to_first(pos: np.ndarray, quat: np.ndarray, yaw0: float, p0: np.ndarray):
    c, s = np.cos(-yaw0), np.sin(-yaw0)
    d = pos - np.array([p0[0], p0[1], 0.0])
    rel = np.stack([c * d[:, 0] - s * d[:, 1], s * d[:, 0] + c * d[:, 1], pos[:, 2]], -1)
    rq = qmul(qyaw(np.full(len(quat), -yaw0)), quat)
    return rel, rq


def footfall_events(raw: Raw, t0: float, t1: float, *, period: float | None = None) -> dict[str, list[float]]:
    ev: dict[str, list[float]] = {}
    allf: list[float] = []
    for k, leg in enumerate(LEGS):
        times = [x - t0 for x in onsets(raw.contacts[:, k], raw.t) if t0 <= x < t1]
        if period:
            times = sorted({round((x % period + period) % period, 4) for x in times})
        ev[f"foot_{leg}"] = times
        allf += times
    ev["footstep"] = sorted(allf)
    return ev


# ---------------------------------------------------------------- locomotion loops
def find_loop(raw: Raw, start: float) -> tuple[int, int]:
    """(start index, loop length in ticks) where the steady gait repeats best."""
    i0 = int(np.searchsorted(raw.t, start))
    feat = np.concatenate([raw.q, raw.pos[:, 2:3] * 20.0, gravity_body(raw.quat) * 3.0], -1)[i0:]
    n = len(feat)
    W = 200
    if raw.id in LOOP_TARGET_S:
        L = int(round(LOOP_TARGET_S[raw.id] / DT))
    else:
        lags = np.arange(40, 420)
        D = np.array([np.mean(np.sum((feat[:W] - feat[l:l + W]) ** 2, -1)) for l in lags])
        best = int(lags[np.argmin(D)])
        period = best
        for k in (5, 4, 3, 2):
            cand = best / k
            lo, hi = int(cand) - 3, int(cand) + 4
            sub = [(D[l - 40], l) for l in range(max(lo, 40), min(hi, 420))]
            if sub:
                dv, l = min(sub)
                if dv < 1.5 * D.min() + 1e-4:
                    period = l
                    break
        cycles = max(1, int(np.ceil(LOOP_MIN_S / (period * DT) - 1e-6)))
        approx = period * cycles
        lags2 = np.arange(approx - 4, approx + 5)
        D2 = [np.mean(np.sum((feat[:W] - feat[l:l + W]) ** 2, -1)) for l in lags2]
        L = int(lags2[int(np.argmin(D2))])
        print(f"    period {period * DT:.3f}s x{cycles} -> loop {L * DT:.3f}s (match {min(D2):.2e}, "
              f"half-period {D[max(0, period // 2 - 40)]:.2e})")
    # best seam start: match state and velocity around the cut; one loop of context either side
    total = len(raw.t)
    cands = [s for s in range(max(i0 + 1, L + 1), total - 2 * L - 2)]
    if not cands:
        raise SystemExit(f"{raw.id}: recording too short for a {L * DT:.2f}s loop with context")
    cost = [np.sum((feat[s - i0 - 1:s - i0 + 2] - feat[s - i0 + L - 1:s - i0 + L + 2]) ** 2) for s in cands]
    return cands[int(np.argmin(cost))], L


def export_loop(raw: Raw, out: Path) -> dict:
    tc = raw.marks["command"][0]
    s, L = find_loop(raw, tc + (0.5 if raw.id == "idle" else 4.0))
    idx = np.arange(s - L, s + 2 * L + 1)  # one loop of context either side
    t = raw.t[idx]
    q = raw.q[idx].copy()
    pos = raw.pos[idx].copy()
    quat = raw.quat[idx].copy()
    yaw = raw.yaw[idx].copy()

    # ideal root path: the body pose averaged over one loop (centred), heading included
    pavg = moving_average(pos[:, :2], L)
    yavg = moving_average(yaw, L)
    c, sn = np.cos(-yavg), np.sin(-yavg)
    d = pos[:, :2] - pavg
    lpos = np.stack([c * d[:, 0] - sn * d[:, 1], sn * d[:, 0] + c * d[:, 1], pos[:, 2]], -1)
    lquat = qcontinuous(qmul(qyaw(-yavg), quat))

    a, b = L, 2 * L  # the loop inside the context window
    # crossfade the seam on the source rate: the last M ticks blend toward the frame one loop earlier
    M = max(4, min(int(0.25 * L), 40))
    w = np.zeros(len(idx))
    ramp = np.linspace(0, 1, M + 1)[1:]
    w[b - M + 1:b + 1] = ramp * ramp * (3 - 2 * ramp)
    blend = lambda arr: arr + w.reshape(-1, *([1] * (arr.ndim - 1))) * (np.roll(arr, L, axis=0) - arr)
    q = blend(q)
    lpos = blend(lpos)
    lquat = qnormalize(blend(lquat))
    loop_s = L * DT
    # at least ~24 samples per gait cycle: the fast trot cycles at 4.3 Hz
    steps = max(1, len(footfall_events(raw, t[a], t[b])["foot_LM"]))
    fps_target = max(LOCO_FPS, 24.0 * steps / loop_s)
    frames = max(2, int(round(loop_s * fps_target)))
    fps = frames / loop_s
    T = t[a] + np.arange(frames) / fps
    rq = resample(t, q, T)
    rl = np.concatenate([resample(t, lpos, T), qnormalize(resample(t, lquat, T))], -1)
    # Phase-align every gait loop: frame 0 is the middle-left foot touching down, so loops of
    # different directions blend with the same tripod in stance. The loop is seamless, so the
    # joint and local blocks roll circularly; the base block is re-read from the rollout.
    lm = footfall_events(raw, T[0], T[0] + loop_s)["foot_LM"]
    shift = 0
    cycles = max(1, len(lm))
    if raw.id != "idle" and lm:
        shift = int(round(lm[0] * fps)) % frames
        rq = np.roll(rq, -shift, axis=0)
        rl = np.roll(rl, -shift, axis=0)
        rl[:, 3:] = qcontinuous(rl[:, 3:])
        T = T + shift / fps
    tt = raw.t
    base_pos = resample(tt, raw.pos, T)
    base_quat = qnormalize(resample(tt, raw.quat, T))
    y0 = float(np.interp(T[0], tt, raw.yaw))
    rel, rq0 = relative_to_first(base_pos, base_quat, y0, base_pos[0])
    a_t, b_t = T[0], T[0] + loop_s

    # mean velocity in the local frame, game axes (x = crab left, z = forward)
    # mean of the root path's velocity expressed in its own heading (right for arcs too)
    dp = np.diff(pavg[a:b + 1], axis=0) / DT
    cy, sy = np.cos(-yavg[a:b]), np.sin(-yavg[a:b])
    v_local = np.array([np.mean(cy * dp[:, 0] - sy * dp[:, 1]), np.mean(sy * dp[:, 0] + cy * dp[:, 1])])
    yaw_rate = float(yavg[b] - yavg[a]) / loop_s
    speed = float(np.hypot(*v_local))
    events = footfall_events(raw, a_t, b_t, period=loop_s)
    # gait cycles in the loop, from the middle-left foot's step period over the steady window
    lm_all = [x for x in onsets(raw.contacts[:, 2], raw.t) if x >= tc + 3.0]
    step_period = float(np.median(np.diff(lm_all))) if len(lm_all) > 2 else loop_s
    cycles = max(1, int(round(loop_s / step_period)))
    cmd = raw.meta["command"]
    print(f"    speed {speed:.3f} m/s (cmd {cmd}), yawRate {yaw_rate:+.3f}, v_local {np.round(v_local, 3)}, "
          f"{frames} frames @ {fps:.2f} fps, footfalls {len(events['footstep'])}")
    return write_clip(
        out, raw.id, source="locomotion", kind="locomotion", fps=fps, loop=True,
        q=rq, base=to_game_block(rel, rq0), local=to_game_block(rl[:, :3], rl[:, 3:]),
        speed=speed, events=events,
        extra={
            "velocity": [round(float(v_local[1]), 5), round(float(v_local[0]), 5)],
            "yawRate": round(yaw_rate, 5),
            "cycles": cycles if raw.id != "idle" else 0,
            "root": "inplace",
            "provenance": provenance(raw, {"command_mps_mps_radps": cmd, "loop_start_s": round(float(T[0]), 4)}),
        },
    )


# ---------------------------------------------------------------- whole motions
def settle_end(raw: Raw, after: float, *, thresh: float = 0.08, pad: float = 0.35) -> float:
    i0 = int(np.searchsorted(raw.t, after))
    qd = np.abs(np.diff(raw.q, axis=0)).max(axis=1) / DT
    active = np.nonzero(qd[i0:] > thresh)[0]
    last = raw.t[i0 + active[-1]] if len(active) else after
    return float(min(raw.t[-1], last + pad))


def export_motion(raw: Raw, out: Path) -> dict:
    kind = raw.meta["kind"]
    fps_target = ACTION_FPS[kind]
    t_start = raw.marks["trigger"][0]
    t_end = settle_end(raw, raw.marks["locomotion"][0])
    i0 = int(np.searchsorted(raw.t, t_start))
    i1 = int(np.searchsorted(raw.t, t_end))
    t = raw.t[i0:i1 + 1]
    dur = float(t[-1] - t[0])
    frames = int(round(dur * fps_target)) + 1
    T = t[0] + np.arange(frames) / fps_target
    T = T[T <= t[-1] + 1e-9]
    q = resample(t, raw.q[i0:i1 + 1], T)
    pos = resample(t, raw.pos[i0:i1 + 1], T)
    quat = qnormalize(resample(t, raw.quat[i0:i1 + 1], T))
    y0 = float(np.interp(T[0], raw.t, raw.yaw))
    rel, rq = relative_to_first(pos, quat, y0, pos[0])
    events = footfall_events(raw, T[0], T[-1])
    # the policy's own start (after the controller's switch-in ramp) and end
    run_mode = raw.meta["source"]
    running = np.array([m == run_mode for m in raw.modes]) & raw.running
    on = np.nonzero(running)[0]
    if len(on):
        events["policy_start"] = [float(raw.t[on[0]] - T[0])]
        events["policy_end"] = [float(raw.t[on[-1]] - T[0])]
    extra_events(raw, events, T)
    skill = skill_events(raw, events, T) if kind == "skill" else None
    brk = break_events(raw, events, T) if kind == "break" else None
    drift = rel[-1]
    yaw_drift = float(np.interp(T[-1], raw.t, raw.yaw) - y0)
    speed = float(np.hypot(drift[0], drift[1]) / max(1e-6, T[-1] - T[0]))
    print(f"    {len(T)} frames @ {fps_target:g} fps = {T[-1] - T[0]:.2f}s, drift {np.round(drift[:2], 3)} m, "
          f"yaw drift {np.degrees(yaw_drift):+.1f} deg, max tilt "
          f"{np.degrees(np.arccos(np.clip(1 - 2 * (quat[:, 1] ** 2 + quat[:, 2] ** 2), -1, 1))).max():.1f} deg, "
          f"events { {k: len(v) for k, v in events.items()} }")
    extra = {"root": "full", "provenance": provenance(raw, {"trigger_s": round(t_start, 4)})}
    if brk is not None:
        extra["break"] = brk
    if skill is not None:
        extra["skill"] = skill
        if "hold" in skill:
            extra["hold"] = True
            extra["holdAt"] = skill["hold"]
    return write_clip(
        out, raw.id, source=raw.meta["source"], kind=kind if kind != "motion" else
        ("dance" if raw.id.startswith("dance") else "gesture"),
        fps=fps_target, loop=False, q=q, base=to_game_block(rel, rq), local=None, speed=speed,
        events=events, extra=extra,
    )


def skill_events(raw: Raw, events: dict, T: np.ndarray, spec: dict | None = None) -> dict:
    """The reference's moments, moved to where this rollout played them, and the game's window.

    The controller starts the recording on the policy's first tick (`starts_on_entry`), so a
    reference moment x is at that tick + x in an ideal rollout. A policy lags its reference a
    little; the lag is the time shift that fits the rollout's joints best to the reference's
    over the move, and every moment is moved by it. The slam's impact is also read off the
    rollout itself: the first claw pad touching the floor after the wind-up.
    """
    spec = spec or SKILLS[raw.id]
    bundle = Path(raw.meta["bundle"])
    mode = raw.meta["source"]
    manifest = json.loads((bundle / "bundle.json").read_text("utf-8"))
    contract = json.loads((bundle / manifest["modes"][mode]["contract"]).read_text("utf-8"))
    traj = json.loads((bundle / manifest["modes"][mode]["trajectory"]).read_text("utf-8"))
    order = traj["joint_order"]
    ref = np.asarray(traj["q"], dtype=np.float64)[:, [order.index(n) for n in JOINT_NAMES]]
    rec_hz = float(contract["reference"]["rec_hz"])
    tref = np.arange(len(ref)) / rec_hz
    move = spec["move"]
    media = JUMPER / "tasks" / "jumper" / mode / "media" / f"{move}.npz"
    moments = json.loads(str(np.load(media)["events"]))
    run = np.nonzero(np.array([m == mode for m in raw.modes]) & raw.running)[0]
    t_on = float(raw.t[run[0]])
    a, b = spec["fit"]
    fit = (tref >= a - 1e-9) & (tref <= b + 1e-9)

    def rms(lag: float) -> float:
        got = np.stack([np.interp(t_on + tref[fit] + lag, raw.t, raw.q[:, j]) for j in range(22)], -1)
        return float(np.sqrt(np.mean((got - ref[fit]) ** 2)))

    lags = np.round(np.arange(-0.04, 0.3001, 0.005), 3)
    errs = [rms(x) for x in lags]
    lag = float(lags[int(np.argmin(errs))])
    at = lambda x: round(t_on + lag + x - float(T[0]), 4)  # noqa: E731
    for name, x in moments.items():
        events[name] = [at(x)]
    if spec["hit"]:
        events["hit"] = [at(moments[spec["hit"]])]
    measured = {}
    if move == "slam":
        # LEGS order: LF, RF first; the pads lift with the claws and come down on the impact
        t_wind = t_on + lag + moments["windup"]
        downs = [x for k in (0, 1) for x in onsets(raw.contacts[:, k], raw.t) if x >= t_wind - 0.1]
        if downs:
            impact = min(downs)
            measured["impact"] = round(impact - float(T[0]), 4)
            if abs(impact - (t_on + lag + moments["hit"])) <= 0.15:
                events["hit"] = [measured["impact"]]
            events["impact"] = [measured["impact"]]
    if "settled" in spec:
        events["settled"] = [at(moments[spec["settled"]])]
    window = [at(spec["window"][0]), at(spec["window"][1])]
    out = {
        "task": f"jumper.{mode}",
        "policyStart": round(t_on - float(T[0]), 4),
        "lag": lag,
        "fitRmsDeg": round(float(np.degrees(min(errs))), 2),
        "window": window,
        "refWindow": list(spec["window"]),
        **({"hold": window[1]} if "hold" in spec else {}),
        "refEvents": moments,
        **({"measured": measured} if measured else {}),
    }
    print(f"    skill {mode}: policy from {out['policyStart']:.3f}s, lag {lag:+.3f}s (fit {out['fitRmsDeg']} deg), "
          f"window {window}, hit {events.get('hit')}, measured {measured}")
    return out


def break_events(raw: Raw, events: dict, T: np.ndarray) -> dict:
    """The routine's window of a breakdance clip and the moments in it, in clip seconds."""
    spec = BREAKS[raw.id]
    t0 = float(T[0])
    rel = lambda x: round(float(x) - t0, 4)  # noqa: E731
    if "move" in spec:
        out = skill_events(raw, events, T, spec)
        out["method"] = "bundle"
        return out
    mode = raw.meta["source"]
    yaw = lambda a, b: float(np.degrees(np.interp(b, raw.t, raw.yaw) - np.interp(a, raw.t, raw.yaw)))  # noqa: E731
    if spec.get("spin"):
        run = np.nonzero(np.array([m == mode for m in raw.modes]) & raw.running)[0]
        t_on, t_go = float(raw.t[run[0]]), float(raw.marks["let_go"][0])
        t_back = float(raw.marks["locomotion"][0])
        events["spin_from"] = [rel(t_on)]
        events["spin_to"] = [rel(t_go)]
        events["hit"] = [rel(t_go)]
        window = [rel(t_on), rel(t_back + 0.2)]
        turned = yaw(t_on, t_back)
        held = yaw(t_go - 2.0, t_go) / 360.0 / 2.0
        print(f"    spin: policy {window[0]:.3f}s, let go {events['spin_to'][0]:.3f}s, walking again "
              f"{rel(t_back):.3f}s; turned {turned:.0f} deg, {held:.2f} rev/s over the last 2 s held")
        return {"task": raw.meta.get("task", "jumper.power_spin_feet"), "method": "bundle",
                "window": window, "turnedDeg": round(turned, 1), "revPerS": round(held, 3)}
    # A jump: one episode of the task's own environment from HOME (record_rollouts.py).
    i0, i1 = np.searchsorted(raw.t, [T[0], T[-1]])
    z = raw.pos[i0:i1, 2]
    air = ~raw.contacts[i0:i1].any(axis=1)
    k = int(np.argmax(z))
    before = np.nonzero(~air[:k])[0]
    after = np.nonzero(~air[k:])[0]
    takeoff = float(raw.t[i0 + before[-1] + 1]) if len(before) else float(raw.t[i0])
    land = float(raw.t[i0 + k + after[0]]) if len(after) else float(raw.t[i1 - 1])
    events["takeoff"] = [rel(takeoff)]
    events["apex"] = [rel(raw.t[i0 + k])]
    events["land"] = [rel(land)]
    events["hit"] = [rel(land)]
    # Settled: the first moment after the landing from which, for 0.2 s, the body stands within
    # 12 mm of its starting height, tilts less than 6 degrees and turns slower than 30 deg/s, and
    # the joints' fastest speed, averaged over 0.1 s, stays under 6 rad/s. The 720 goes on turning
    # on its feet for a while after it lands. Both policies keep their legs busy at HOME (they run
    # at 200 Hz with no clock), so "still" is not a threshold they ever cross; this is.
    qd = moving_average(np.abs(np.gradient(raw.q, raw.t, axis=0)).max(axis=1), int(round(0.1 / DT)))
    wz = moving_average(np.abs(np.gradient(raw.yaw, raw.t)), int(round(0.1 / DT)))
    x_, y_ = raw.quat[:, 1], raw.quat[:, 2]
    tilt = np.degrees(np.arccos(np.clip(1 - 2 * (x_ * x_ + y_ * y_), -1, 1)))
    quiet = (qd < 6.0) & (wz < np.radians(30)) & (tilt < 6) & (np.abs(raw.pos[:, 2] - raw.pos[0, 2]) < 0.012)
    n = int(round(0.2 / DT))
    settled = float(raw.t[i1 - 1])
    for i in range(int(np.searchsorted(raw.t, land)), len(raw.t) - n):
        if quiet[i:i + n].all():
            settled = float(raw.t[i])
            break
    events["settled"] = [rel(settled)]
    window = [0.0, rel(min(float(T[-1]), settled + 0.25))]
    # The heading is read off the body's x axis, which a back flip turns upside down: for the
    # flip the yaw is not a turn, so the turn about its pitch axis is reported instead.
    print(f"    jump: take-off {events['takeoff'][0]:.3f}s, apex {events['apex'][0]:.3f}s "
          f"({z.max() - z[0]:.3f} m), landing {events['land'][0]:.3f}s, settled "
          f"{events['settled'][0]:.3f}s, window {window}")
    return {"task": raw.meta["task"], "method": "direct rollout", "window": window,
            "apexRise": round(float(z.max() - z[0]), 4)}


def write_break_table(out_dir: Path, path: Path) -> None:
    """src/motion/breakClips.ts: each breakdance clip's routine window and moments."""
    rows = []
    for header_path in sorted(out_dir.glob("*.json")):
        if header_path.name == "index.json":
            continue
        h = json.loads(header_path.read_text())
        bk = h.get("break")
        if h.get("kind") != "break" or not bk:
            continue
        ev = {k: v[0] for k, v in sorted(h["events"].items())
              if not k.startswith("foot") and k != "footstep" and len(v) == 1}
        evs = ", ".join(f"{k}: {v}" for k, v in ev.items())
        rows.append(f"  {h['id']}: {{\n    task: '{bk['task']}',\n    method: '{bk['method']}',\n"
                    f"    from: {bk['window'][0]},\n    to: {bk['window'][1]},\n"
                    f"    events: {{ {evs} }},\n  }},")
    text = (
        "// Generated by tools/motion/export_clips.py from the recorded breakdance clips in public/motions/.\n"
        "// Do not edit: re-run the export. Clip seconds: `from`/`to` is the window the routine plays (a\n"
        "// tracked move from its policy's first tick to the end of the move, moved by the policy's lag; the\n"
        "// spin from its policy's start until it is walking again; a jump from the episode's start until the\n"
        "// landing has settled). `method` is 'bundle' for a rollout through the crabcraft bundle's\n"
        "// controller and 'direct rollout' for one episode of the policy's own training environment.\n"
        "export const BREAK_CLIPS = {\n" + "\n".join(rows) + "\n} as const;\n"
    )
    path.write_text(text)
    print(f"break table: {path} ({len(rows)} clips)")


def write_skill_table(out_dir: Path, path: Path) -> None:
    """src/motion/skillClips.ts: each skill clip's window and moments, from the clip headers."""
    rows = []
    for header_path in sorted(out_dir.glob("*.json")):
        if header_path.name == "index.json":
            continue
        h = json.loads(header_path.read_text())
        sk = h.get("skill")
        if h.get("kind") != "skill" or not sk:
            continue
        ev = {k: v[0] for k, v in sorted(h["events"].items())
              if not k.startswith("foot") and k != "footstep" and len(v) == 1}
        evs = ", ".join(f"{k}: {v}" for k, v in ev.items())
        rows.append(f"  {h['id']}: {{\n    task: '{sk['task']}',\n    from: {sk['window'][0]},\n"
                    f"    to: {sk['window'][1]},\n    hold: {'true' if h.get('hold') else 'false'},\n"
                    f"    events: {{ {evs} }},\n  }},")
    text = (
        "// Generated by tools/motion/export_clips.py from the recorded skill clips in public/motions/.\n"
        "// Do not edit: re-run the export. Clip seconds: `from`/`to` is the move as\n"
        "// docs/CRABCRAFT_SKILLS.md (jumper) cuts it, moved to where the policy played it in the\n"
        "// rollout; `events` are the reference's moments moved the same way (the slam's `hit` is the\n"
        "// claw pads' measured impact), `hold` says the game holds the clip at `to`.\n"
        "export const SKILL_CLIPS = {\n" + "\n".join(rows) + "\n} as const;\n"
    )
    path.write_text(text)
    print(f"skill table: {path} ({len(rows)} clips)")


def extra_events(raw: Raw, events: dict, T: np.ndarray) -> None:
    t0 = T[0]
    if raw.id == "jump":
        i0, i1 = np.searchsorted(raw.t, [T[0], T[-1]])
        z = raw.pos[i0:i1, 2]
        air = ~raw.contacts[i0:i1].any(axis=1)
        k = int(np.argmax(z))
        events["apex"] = [float(raw.t[i0 + k] - t0)]
        before = np.nonzero(~air[:k])[0]
        after = np.nonzero(~air[k:])[0]
        if len(before):
            events["takeoff"] = [float(raw.t[i0 + before[-1] + 1] - t0)]
        if len(after):
            events["land"] = [float(raw.t[i0 + k + after[0]] - t0)]
        print(f"    jump apex {z.max() - raw.pos[i0, 2]:.3f} m above stance at {events['apex'][0]:.2f}s, "
              f"air {events.get('takeoff')} -> {events.get('land')}")
    if raw.meta["kind"] == "claw":
        side = 0 if raw.id.endswith("left") else 5
        j4 = raw.q[:, side + 4]
        tc = raw.marks["close"][0]
        i = int(np.searchsorted(raw.t, tc))
        seg = j4[i:i + 200]
        travel = seg[-1] - seg[0]
        hit = int(np.argmax(np.abs(seg - seg[0]) >= 0.85 * abs(travel)))
        events["grab"] = [float(raw.t[i + hit] - t0)]
        events["hit"] = list(events["grab"])
        events["reach"] = [float(raw.marks["reach"][0] - t0)]
        events["release"] = [float(raw.marks["open"][0] - t0)]
    if raw.id == "dance_crab":
        beats = beat_times_crab()
        run = np.nonzero(np.array([m == "dance_crab" for m in raw.modes]) & raw.running)[0]
        start = raw.t[run[0]]
        events["beat"] = [float(start + b - t0) for b in beats if start + b <= T[-1]]


def beat_times_crab() -> np.ndarray:
    path = JUMPER / "tasks" / "jumper" / "dance" / "media" / "demo.npz"
    return np.load(path)["beat_times_sim"]


def provenance(raw: Raw, more: dict) -> dict:
    if raw.meta.get("method") == "direct rollout":
        return {
            "method": "closed-loop rollout of the policy in its own training environment, not the bundle "
                      "(tools/motion/record_rollouts.py: the bundle's controller cannot start this jump)",
            "task": raw.meta["task"],
            "actor": raw.meta["actor"],
            "policy": raw.meta["source"],
            "inferences": raw.meta.get("inferences"),
            "physics": raw.meta["physics"],
            **{k: v for k, v in more.items() if k != "trigger_s"},
        }
    return {
        "method": "closed-loop rollout",
        **bundle_provenance(raw),
        "policy": raw.meta["source"],
        "inferences": raw.meta.get("inferences"),
        "physics": "MuJoCo, training contact/solver setup, per-mode timestep (tools/motion/jumper_sim.py)",
        **more,
    }


def bundle_provenance(raw: Raw) -> dict:
    if "bundle" not in raw.meta:
        return {"bundle": "out/bundle_example/jumper (KingKongRobotics/jumper)",
                "controller": "runtime/mjlab/macosx-universal2/controller.so"}
    bundle = Path(raw.meta["bundle"])
    manifest = json.loads((bundle / "bundle.json").read_text("utf-8"))
    mjlab = manifest["runtimes"]["mjlab"]
    built = (manifest.get("built_from") or {}).get(raw.meta["source"], {})
    # The skills were recorded through the bundle as feat/crabcraft-skills built it; the breakdance
    # through the one feat/crabcraft-dance built, which adds its modes. Same controller source.
    branch = "feat/crabcraft-dance" if raw.meta["kind"] == "break" else "feat/crabcraft-skills"
    return {
        "bundle": f"crabcraft bundle, scripts/deploy.py --manifests deploy/crabcraft.manifests.json "
                  f"(jumper branch {branch}, controller source {mjlab['commit'][:7]})",
        "controller": next(iter(mjlab["extensions"].values()))["file"],
        **({"checkpoint": built["from"]} if built.get("from") else {}),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=ROOT / "scratch" / "motion-raw")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "motions")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    model = load_model(render=False)
    for path in sorted(args.raw.glob("*.npz")):
        if only and path.stem not in only:
            continue
        raw = Raw(path, model)
        print(f"{raw.id}:")
        if raw.meta["kind"] == "locomotion":
            info = export_loop(raw, args.out)
        else:
            info = export_motion(raw, args.out)
        print(f"    -> {info['frameCount']} frames, {info['duration']:.2f}s, {info['bytes']} bytes")
    idx = write_index(args.out)
    print(f"index: {len(idx['clips'])} clips")
    if args.out.resolve() == (ROOT / "public" / "motions").resolve():
        write_skill_table(args.out, SKILL_TABLE)
        write_break_table(args.out, BREAK_TABLE)


if __name__ == "__main__":
    main()
