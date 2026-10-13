"""Keyframed game-only clips: attack_swipe, attack_slam, cast, hit_react, death, sit.

    python -I tools/motion/keyframes.py [--out public/motions] [--sheet <dir>]

Authored in joint space on the same MuJoCo model the policy clips were recorded on, inside
jumper.xml's joint limits, starting from and returning to the calibrated standing pose.
Each key gives the body pose (height, lean, twist, offset) and the claw joints; the four
walking legs are solved by inverse kinematics every baked frame so their feet stay planted
where they stood (no sliding while the body lunges or recoils), unless a key curls them
explicitly (death, sit). Grounded poses are checked against the floor with the collision hulls.
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import mujoco
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clipfile import JOINT_NAMES, qmul, write_clip, write_index  # noqa: E402
from jumper_sim import HOME, STAND_Z, load_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FPS = 50.0
WALK_LEGS = ("LM", "RM", "LR", "RR")
FOOT_BODY = {"LM": "LM_foot_tip_link", "RM": "RM_foot_tip_link", "LR": "LR_foot_tip_link", "RR": "RR_foot_tip_link",
             "LF": "LF_palm_pad_b_link", "RF": "RF_palm_pad_b_link"}


# ---------------------------------------------------------------- authoring helpers
def claw(side: str, j0=None, j1=None, j2=None, j3=None, grip=None, *, rel: bool = False) -> dict:
    """Claw joints in the LEFT claw's convention; the right claw is mirrored (J1 keeps its sign).

    grip: 0 = closed (home), 1 = wide open.
    """
    p = "LF" if side == "L" else "RF"
    s = 1.0 if side == "L" else -1.0
    out = {}
    for k, v in ((0, j0), (1, j1), (2, j2), (3, j3)):
        if v is None:
            continue
        name = f"{p}_J{k}_joint"
        val = v if k == 1 else s * v
        out[name] = (HOME[name] + val) if rel else val
    if grip is not None:
        out[f"{p}_J4_joint"] = -1.5 * grip * s
    return out


def both(**kw) -> dict:
    return {**claw("L", **kw), **claw("R", **kw)}


def leg(name: str, j0=None, j1=None, j2=None) -> dict:
    """Walking-leg joints in the left legs' convention; right legs mirrored (all signs flip)."""
    s = 1.0 if name[0] == "L" else -1.0
    return {f"{name}_J{k}_joint": s * v for k, v in ((0, j0), (1, j1), (2, j2)) if v is not None}


def home_claws(side: str = "LR") -> dict:
    names = [n for n in JOINT_NAMES if n[:2] in ({"L": ["LF"], "R": ["RF"], "LR": ["LF", "RF"]}[side])]
    return {n: HOME[n] for n in names}


@dataclass
class Key:
    t: float
    claws: dict = field(default_factory=dict)  # absolute claw joint targets (missing = previous key's)
    legs: dict | None = None  # absolute leg joints; None = planted by IK
    body: tuple | None = None  # dx fwd, dy left, dz up (m), roll, pitch(+nose down), yaw; None = previous key's
    ease: str = "inout"  # how the segment arriving at this key is eased
    plant: dict = field(default_factory=dict)  # per-leg foot target offsets (m, robot frame) when planted


@dataclass
class ClipSpec:
    id: str
    keys: list[Key]
    events: dict[str, list[float]]
    hold: bool = False
    clamp: str = "body"  # floor check on body+legs hulls ("body") or every hull ("all")


def ease(kind: str, u: float) -> float:
    u = min(1.0, max(0.0, u))
    if kind == "linear":
        return u
    if kind == "in":  # accelerate into the key: strikes
        return u * u * u
    if kind == "out":  # decelerate into the key: recoils, settles
        return 1 - (1 - u) ** 3
    if kind == "snap":  # very fast arrival
        return 1 - (1 - u) ** 5
    if kind == "back":  # overshoot then settle
        c1, c3 = 1.70158, 2.70158
        return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2
    return u * u * (3 - 2 * u)  # inout


# ---------------------------------------------------------------- the clips
def specs() -> list[ClipSpec]:
    """Claw values are absolute, in the left claw's convention (claw() mirrors the right one).

    Measured on the model (tools/motion sweeps): J0 + swings the claw out to its side, - across the
    front; J1 - raises the arm (-3.5 points straight up), + lowers it under; J2 + opens the elbow out
    and up; J3 + turns the pincer out, - in; grip 0 closed, 1 wide open.
    Home: J0 -0.55, J1 -1.07, J2 -0.44, J3 -1.37.
    """
    stand = Key(0.0, claws=home_claws(), body=(0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
    out: list[ClipSpec] = []

    # Pincer swipe with the right claw (the warrior's sword hand): wind up out to the side and
    # high with the pincer open, the shell twisting away; snap across the front, the pincer
    # slamming shut on the hit; follow through past the centre, settle.
    out.append(ClipSpec("attack_swipe", [
        stand,
        Key(0.17, claws={**claw("R", j0=0.3, j1=-2.75, j2=0.25, j3=-0.6, grip=1.0),
                         **claw("L", j0=-1.0, j1=-1.55, j2=-0.6, j3=-1.45, grip=0.25)},
            body=(-0.006, 0.004, 0.006, 0.07, -0.06, -0.22), ease="out"),
        Key(0.23, claws={**claw("R", j0=0.38, j1=-2.85, j2=0.3, j3=-0.55, grip=1.0)},
            body=(-0.007, 0.005, 0.007, 0.08, -0.07, -0.26), ease="inout"),
        Key(0.31, claws={**claw("R", j0=-1.25, j1=-1.6, j2=-0.15, j3=-1.0, grip=0.0),
                         **claw("L", j0=-0.75, j1=-1.3, j2=-0.5, j3=-1.4, grip=0.0)},
            body=(0.012, -0.004, -0.004, -0.05, 0.06, 0.20), ease="in"),
        Key(0.38, claws={**claw("R", j0=-1.6, j1=-1.45, j2=-0.3, j3=-1.1, grip=0.05)},
            body=(0.014, -0.005, -0.006, -0.06, 0.07, 0.27), ease="out"),
        Key(0.60, claws={**claw("R", j0=-0.75, j1=-1.2, j2=-0.4, j3=-1.3, grip=0.0), **home_claws("L")},
            body=(0.002, 0.0, 0.001, 0.0, -0.01, -0.02), ease="inout"),
        Key(0.80, claws=home_claws(), body=(0, 0, 0, 0, 0, 0), ease="inout"),
    ], events={"windup": [0.17], "hit": [0.31]}))

    # Two-claw slam: dip, then rear up with both claws straight up and wide open, crash them
    # down in front of the body onto the floor on the hit, shell nosing down with the impact.
    out.append(ClipSpec("attack_slam", [
        stand,
        Key(0.12, claws=both(j0=-0.7, j1=-1.35, j2=-0.5, j3=-1.5, grip=0.3), body=(0.004, 0, -0.010, 0, 0.06, 0), ease="out"),
        Key(0.42, claws=both(j0=-1.15, j1=-3.3, j2=-0.75, j3=-0.3, grip=1.0), body=(-0.012, 0, 0.016, 0, -0.22, 0), ease="out"),
        Key(0.50, claws=both(j0=-1.2, j1=-3.45, j2=-0.8, j3=-0.25, grip=1.0), body=(-0.013, 0, 0.018, 0, -0.24, 0), ease="inout"),
        Key(0.60, claws=both(j0=-0.75, j1=-0.62, j2=-0.35, j3=-1.25, grip=0.0), body=(0.014, 0, -0.020, 0, 0.18, 0), ease="in"),
        Key(0.68, claws=both(j0=-0.75, j1=-0.58, j2=-0.35, j3=-1.25, grip=0.05), body=(0.012, 0, -0.024, 0, 0.16, 0), ease="out"),
        Key(0.82, body=(0.008, 0, -0.014, 0, 0.10, 0), ease="out"),
        Key(1.10, claws=both(j0=-0.6, j1=-1.2, j2=-0.45, j3=-1.4, grip=0.1), body=(0.001, 0, 0.002, 0, -0.01, 0), ease="inout"),
        Key(1.30, claws=home_claws(), body=(0, 0, 0, 0, 0, 0), ease="inout"),
    ], events={"windup": [0.42], "hit": [0.60]}))

    # Cast: gather both claws close under the visor, lift them, then fling them up and out wide
    # open (the spell leaves on "release"), hold, snap shut, settle.
    out.append(ClipSpec("cast", [
        stand,
        Key(0.22, claws=both(j0=-1.25, j1=-1.75, j2=-0.9, j3=-1.65, grip=0.0), body=(-0.003, 0, -0.006, 0, 0.05, 0), ease="out"),
        Key(0.46, claws=both(j0=-1.0, j1=-2.55, j2=-0.5, j3=-1.2, grip=0.3), body=(-0.002, 0, 0.002, 0, -0.03, 0), ease="inout"),
        Key(0.60, claws=both(j0=-1.2, j1=-3.25, j2=-0.3, j3=-0.3, grip=1.0), body=(0.008, 0, 0.012, 0, -0.13, 0), ease="snap"),
        Key(0.82, claws=both(j0=-1.15, j1=-3.3, j2=-0.2, j3=-0.25, grip=1.0), body=(0.009, 0, 0.013, 0, -0.14, 0), ease="out"),
        Key(0.90, claws=both(j0=-1.15, j1=-3.25, j2=-0.25, j3=-0.3, grip=0.0), ease="snap"),
        Key(1.22, claws=home_claws(), body=(0, 0, 0, 0, 0, 0), ease="inout"),
    ], events={"channel": [0.22], "release": [0.60], "hit": [0.60]}))

    # Hit reaction: knocked back, nose up and rolled, claws flinching in to guard the visor,
    # then a small rebound past rest.
    guard = both(j0=-1.15, j1=-2.0, j2=-0.75, j3=-1.6, grip=0.6)
    out.append(ClipSpec("hit_react", [
        stand,
        Key(0.07, claws=guard, body=(-0.010, 0.003, 0.008, 0.10, -0.17, 0.07), ease="snap"),
        Key(0.18, claws=both(j0=-1.0, j1=-1.8, j2=-0.65, j3=-1.55, grip=0.4), body=(-0.007, 0.002, 0.004, 0.05, -0.10, 0.04), ease="out"),
        Key(0.32, claws=home_claws(), body=(0.002, -0.001, -0.003, -0.02, 0.03, -0.01), ease="inout"),
        Key(0.48, claws=home_claws(), body=(0, 0, 0, 0, 0, 0), ease="inout"),
    ], events={"hit": [0.0]}))

    # Death: struck, stagger to one side, the legs give out and the shell drops onto the floor;
    # legs fold up under it, claws flop in front; one last leg twitch, then still. Holds.
    curl_legs = {**leg("LM", 0.1, 1.45, -2.0), **leg("RM", 0.05, 1.4, -2.05),
                 **leg("LR", 0.85, 1.45, -2.0), **leg("RR", 0.8, 1.4, -2.1)}
    twitch = {**curl_legs, **leg("LR", 0.95, 1.45, -1.2)}
    flop = {**claw("L", j0=0.4, j1=-1.6, j2=0.9, j3=0.2, grip=0.5),
            **claw("R", j0=0.25, j1=-1.75, j2=0.6, j3=0.0, grip=0.3)}
    out.append(ClipSpec("death", [
        stand,
        Key(0.12, claws=guard, body=(-0.009, 0.004, 0.006, 0.09, -0.14, 0.08), ease="snap"),
        Key(0.42, claws=both(j0=-0.3, j1=-1.45, j2=-0.2, j3=-1.3, grip=0.45), body=(0.002, -0.006, -0.012, -0.12, 0.05, -0.06), ease="inout"),
        Key(0.64, claws=both(j0=-0.35, j1=-1.1, j2=-0.3, j3=-1.4, grip=0.3),
            body=(0.004, -0.006, -0.030, -0.10, 0.07, -0.07), ease="in"),
        Key(0.80, claws=flop, legs=curl_legs, body=(0.004, -0.006, -0.15, -0.05, 0.05, -0.07), ease="in"),
        Key(0.90, legs=curl_legs, body=(0.004, -0.006, -0.15, -0.07, 0.06, -0.07), ease="out"),
        Key(1.04, legs=curl_legs, body=(0.004, -0.006, -0.15, -0.05, 0.05, -0.07), ease="inout"),
        Key(1.24, legs=twitch, ease="snap"),
        Key(1.46, legs=curl_legs, ease="out"),
        Key(1.70, legs=curl_legs, ease="inout"),
    ], events={"collapse": [0.80], "twitch": [1.24]}, hold=True, clamp="all"))

    # Sit: a resting crouch. Feet slide out a little, the shell settles low between them, the
    # claws fold in and rest on the floor in front. Holds; stop() stands back up.
    spread = {"LM": (0.0, 0.025, 0.0), "RM": (0.0, -0.025, 0.0), "LR": (-0.012, 0.02, 0.0), "RR": (-0.012, -0.02, 0.0)}
    rest = both(j0=-0.75, j1=-1.6, j2=-0.4, j3=-1.4, grip=0.0)
    out.append(ClipSpec("sit", [
        stand,
        Key(0.25, claws=both(j0=-0.8, j1=-1.35, j2=-0.6, j3=-1.6, grip=0.0), body=(0.0, 0, -0.012, 0, 0.03, 0), ease="inout",
            plant={k: tuple(0.5 * np.array(v)) for k, v in spread.items()}),
        Key(0.80, claws=rest, body=(-0.004, 0, -0.046, 0, -0.03, 0), ease="out", plant=spread),
        Key(1.00, claws=rest, body=(-0.004, 0, -0.043, 0, -0.04, 0), ease="inout", plant=spread),
        Key(1.20, claws=rest, body=(-0.004, 0, -0.045, 0, -0.03, 0), ease="inout", plant=spread),
    ], events={"settle": [0.80]}, hold=True, clamp="all"))
    return out


# ---------------------------------------------------------------- baking
class Rig:
    def __init__(self):
        self.m = load_model(render=False)
        self.d = mujoco.MjData(self.m)
        m = self.m
        self.qadr = {n: m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in JOINT_NAMES}
        self.dadr = {n: m.jnt_dofadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in JOINT_NAMES}
        self.lo = {n: m.jnt_range[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)][0] for n in JOINT_NAMES}
        self.hi = {n: m.jnt_range[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)][1] for n in JOINT_NAMES}
        self.foot = {k: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, v) for k, v in FOOT_BODY.items()}
        self.set(HOME, (0, 0, 0, 0, 0, 0))
        self.home_feet = {k: self.d.xpos[b].copy() for k, b in self.foot.items()}
        self.col = [g for g in range(m.ngeom) if m.geom_contype[g] and m.geom_bodyid[g] > 0]
        name = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or ""
        self.col_body = [g for g in self.col if name(g)[:2] not in ("LF", "RF")]
        self.col_claw = [g for g in self.col if name(g)[:2] in ("LF", "RF")]

    def set(self, q: dict, body: tuple) -> None:
        dx, dy, dz, roll, pitch, yaw = body
        d = self.d
        d.qpos[:3] = (dx, dy, STAND_Z + dz)
        d.qpos[3:7] = rpy_quat(roll, pitch, yaw)
        for n, v in q.items():
            d.qpos[self.qadr[n]] = v
        mujoco.mj_kinematics(self.m, d)
        mujoco.mj_comPos(self.m, d)  # cdof for the Jacobians

    def solve_legs(self, q: dict, body: tuple, plant: dict) -> dict:
        q = dict(q)
        for _ in range(30):
            self.set(q, body)
            worst = 0.0
            for legname in WALK_LEGS:
                target = self.home_feet[legname] + np.asarray(plant.get(legname, (0, 0, 0)))
                b = self.foot[legname]
                err = target - self.d.xpos[b]
                worst = max(worst, float(np.linalg.norm(err)))
                jacp = np.zeros((3, self.m.nv))
                mujoco.mj_jacBody(self.m, self.d, jacp, None, b)
                names = [f"{legname}_J{k}_joint" for k in range(3)]
                J = jacp[:, [self.dadr[n] for n in names]]
                dq = J.T @ np.linalg.solve(J @ J.T + 1e-6 * np.eye(3), err)
                for n, v in zip(names, dq):
                    q[n] = float(np.clip(q[n] + v, self.lo[n] + 0.02, self.hi[n] - 0.02))
            if worst < 2e-5:
                break
        return q

    def lowest(self, geoms=None) -> float:
        z = np.inf
        for g in (self.col if geoms is None else geoms):
            mid = self.m.geom_dataid[g]
            if mid < 0:
                continue
            va, vn = self.m.mesh_vertadr[mid], self.m.mesh_vertnum[mid]
            v = self.m.mesh_vert[va:va + vn]
            R = self.d.geom_xmat[g].reshape(3, 3)
            z = min(z, float((v @ R.T)[:, 2].min() + self.d.geom_xpos[g][2]))
        return z


def rpy_quat(roll: float, pitch: float, yaw: float) -> np.ndarray:
    """Body rotation from yaw (z), pitch (+ = nose down, about +y), roll (+ = right side down, about +x)."""
    cz, sz = math.cos(yaw / 2), math.sin(yaw / 2)
    cy, sy = math.cos(pitch / 2), math.sin(pitch / 2)
    cx, sx = math.cos(roll / 2), math.sin(roll / 2)
    qz = np.array([cz, 0, 0, sz])
    qy = np.array([cy, 0, sy, 0])
    qx = np.array([cx, sx, 0, 0])
    return qmul(qmul(qz, qy), qx)


def bake(rig: Rig, spec: ClipSpec):
    keys = spec.keys
    # resolve every key fully: claws carried forward, legs explicit or planted
    full: list[tuple[dict, dict | None, np.ndarray, dict]] = []
    claws = {n: HOME[n] for n in JOINT_NAMES if n[:2] in ("LF", "RF")}
    body = (0.0,) * 6
    for k in keys:
        claws = {**claws, **k.claws}
        body = k.body if k.body is not None else body
        full.append((dict(claws), k.legs, np.array(body, dtype=float), k.plant))
    T = keys[-1].t
    n = int(round(T * FPS)) + 1
    qs, bases = [], []
    prev_legs = {n_: HOME[n_] for n_ in JOINT_NAMES if n_[:2] not in ("LF", "RF")}
    claw_low = np.inf
    for i in range(n):
        t = min(T, i / FPS)
        j = next(k for k in range(1, len(keys)) if t <= keys[k].t + 1e-9)
        a, b = keys[j - 1], keys[j]
        u = ease(b.ease, (t - a.t) / max(1e-9, b.t - a.t))
        ca, la, ba, pa = full[j - 1]
        cb, lb, bb, pb = full[j]
        claws_t = {n_: ca[n_] + (cb[n_] - ca[n_]) * u for n_ in ca}
        body_t = tuple(ba + (bb - ba) * u)
        plant_t = {l: tuple(np.asarray(pa.get(l, (0, 0, 0))) + (np.asarray(pb.get(l, (0, 0, 0))) -
                                                                 np.asarray(pa.get(l, (0, 0, 0)))) * u)
                   for l in WALK_LEGS}
        if la is None and lb is None:
            legs_t = rig.solve_legs({**prev_legs}, body_t, plant_t)
            legs_t = {n_: v for n_, v in legs_t.items() if n_[:2] in WALK_LEGS}
        else:
            # blend from planted (or explicit) legs into explicit ones
            if la is None:
                la = rig.solve_legs({**prev_legs}, tuple(ba), pa)
                la = {n_: v for n_, v in la.items() if n_[:2] in WALK_LEGS}
            if lb is None:
                lb = rig.solve_legs({**prev_legs}, tuple(bb), pb)
                lb = {n_: v for n_, v in lb.items() if n_[:2] in WALK_LEGS}
            la_full = {**{n_: HOME[n_] for n_ in prev_legs}, **la}
            lb_full = {**la_full, **lb}
            legs_t = {n_: la_full[n_] + (lb_full[n_] - la_full[n_]) * u for n_ in prev_legs}
        prev_legs = legs_t
        q = {**claws_t, **legs_t}
        for n_ in q:
            q[n_] = float(np.clip(q[n_], rig.lo[n_], rig.hi[n_]))
        # claws stop on the floor: a claw driven into it is lifted at the shoulder (J1) until it
        # rests on the surface, so a slam lands instead of passing through
        if spec.clamp != "all":
            for side in ("LF", "RF"):
                geoms = [g for g in rig.col_claw
                         if (mujoco.mj_id2name(rig.m, mujoco.mjtObj.mjOBJ_GEOM, g) or "").startswith(side)]
                for _ in range(80):
                    rig.set(q, body_t)
                    if rig.lowest(geoms) >= -0.0005:
                        break
                    q[f"{side}_J1_joint"] = max(rig.lo[f"{side}_J1_joint"], q[f"{side}_J1_joint"] - 0.01)
        # ground: the hulls never sink into the floor. A key that drops the body further than the
        # floor allows lands it there, so a collapse falls until the shell meets the ground.
        rig.set(q, body_t)
        low = rig.lowest(rig.col if spec.clamp == "all" else rig.col_body)
        dz = max(body_t[2], body_t[2] - low)
        claw_low = min(claw_low, rig.lowest(rig.col_claw) + (dz - body_t[2]))
        body_t = (body_t[0], body_t[1], dz, body_t[3], body_t[4], body_t[5])
        qs.append([q[n_] for n_ in JOINT_NAMES])
        bases.append((body_t[0], body_t[1], STAND_Z + body_t[2], *rpy_quat(*body_t[3:6])))
    spec.claw_low = claw_low
    return np.array(qs), np.array(bases)


def to_game(bases: np.ndarray) -> np.ndarray:
    pos = bases[:, :3]
    quat = bases[:, 3:7]
    return np.concatenate([np.stack([pos[:, 1], pos[:, 2], pos[:, 0]], -1),
                           np.stack([quat[:, 2], quat[:, 3], quat[:, 1], quat[:, 0]], -1)], -1)


def sheet(rig: Rig, spec: ClipSpec, q: np.ndarray, bases: np.ndarray, out: Path) -> None:
    from PIL import Image, ImageDraw

    from jumper_sim import Shooter
    m = load_model(render=True)
    d = mujoco.MjData(m)
    sh = Shooter(m, 400, 300)
    sh.cam.distance = 0.62
    imgs = []
    times = [k.t for k in spec.keys]
    for t in times:
        i = min(len(q) - 1, int(round(t * FPS)))
        d.qpos[:3] = bases[i, :3]
        d.qpos[3:7] = bases[i, 3:7]
        for k, n in enumerate(JOINT_NAMES):
            d.qpos[m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)]] = q[i, k]
        mujoco.mj_forward(m, d)
        row = []
        for az in (180, 120):
            sh.cam.azimuth = az
            sh._look = None
            img = Image.fromarray(sh.frame(d))
            ImageDraw.Draw(img).text((6, 4), f"{spec.id} t={t:.2f}", fill=(0, 0, 0))
            row.append(np.asarray(img))
        imgs.append(np.concatenate(row, 0))
    Image.fromarray(np.concatenate(imgs, 1)).save(out / f"key_{spec.id}.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "motions")
    ap.add_argument("--sheet", type=Path, default=None)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    rig = Rig()
    for spec in specs():
        if only and spec.id not in only:
            continue
        q, bases = bake(rig, spec)
        g = to_game(bases)
        base_rel = g.copy()
        base_rel[:, 0] -= g[0, 0]
        base_rel[:, 2] -= g[0, 2]
        info = write_clip(args.out, spec.id, source="keyframe", kind="keyframe", fps=FPS, loop=False,
                          q=q, base=base_rel, local=None, speed=0.0, events=spec.events,
                          extra={"root": "full", "hold": spec.hold,
                                 "provenance": {"method": "keyframed (tools/motion/keyframes.py)",
                                                "legs": "IK-planted on the MuJoCo model unless curled"}})
        lim = max(max(rig.lo[n] - q[:, k].min(), q[:, k].max() - rig.hi[n]) for k, n in enumerate(JOINT_NAMES))
        print(f"{spec.id:14s} {info['frameCount']:4d} frames {info['duration']:.2f}s {info['bytes']} bytes, "
              f"limit excess {max(0.0, lim):.3f} rad, min height {bases[:, 2].min():.3f} m, "
              f"lowest claw point {spec.claw_low * 1000:+.1f} mm")
        if args.sheet:
            args.sheet.mkdir(parents=True, exist_ok=True)
            sheet(rig, spec, q, bases, args.sheet)
    write_index(args.out)


if __name__ == "__main__":
    main()
