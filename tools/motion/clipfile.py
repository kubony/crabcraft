"""Shared pieces of the clip pipeline: frame conversion and the on-disk clip format.

On disk (public/motions/):
    index.json        every clip: id, source, kind, fps, frameCount, duration, loop, speed, bytes
    <id>.json         header: MotionClip fields minus the arrays, plus quantisation and root data
    <id>.bin          little-endian Int16 blocks, in this order:
                        q      frameCount x joints   q = qOffset[j] + qScale[j] * v
                        base   frameCount x 7        same, baseOffset/baseScale (x y z qx qy qz qw)
                        local  frameCount x 7        only when header.local is true (in-place clips):
                                                     the body relative to the clip's ideal root path,
                                                     in the crab's local frame, game axes, metres

Game axes (src/crab/types.ts MJ_TO_GAME_AXES): game.x = mj.y, game.y = mj.z, game.z = mj.x.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

JOINT_NAMES = [
    "LF_J0_joint", "LF_J1_joint", "LF_J2_joint", "LF_J3_joint", "LF_J4_joint",
    "RF_J0_joint", "RF_J1_joint", "RF_J2_joint", "RF_J3_joint", "RF_J4_joint",
    "LM_J0_joint", "LM_J1_joint", "LM_J2_joint",
    "RM_J0_joint", "RM_J1_joint", "RM_J2_joint",
    "LR_J0_joint", "LR_J1_joint", "LR_J2_joint",
    "RR_J0_joint", "RR_J1_joint", "RR_J2_joint",
]


# ---------------------------------------------------------------- quaternions (w, x, y, z)
def qmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    aw, ax, ay, az = np.moveaxis(a, -1, 0)
    bw, bx, by, bz = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ], -1)


def qyaw(psi: np.ndarray) -> np.ndarray:
    """Rotation about the MuJoCo z axis (vertical)."""
    psi = np.asarray(psi)
    return np.stack([np.cos(psi / 2), np.zeros_like(psi), np.zeros_like(psi), np.sin(psi / 2)], -1)


def yaw_of(q: np.ndarray) -> np.ndarray:
    """Heading of the body x axis projected on the floor, MuJoCo frame."""
    w, x, y, z = np.moveaxis(q, -1, 0)
    return np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def qnormalize(q: np.ndarray) -> np.ndarray:
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def qcontinuous(q: np.ndarray) -> np.ndarray:
    """Flip signs so consecutive quaternions stay in one hemisphere (safe to lerp)."""
    q = q.copy()
    for i in range(1, len(q)):
        if np.dot(q[i], q[i - 1]) < 0:
            q[i] = -q[i]
    return q


def mj_to_game_pos(p: np.ndarray) -> np.ndarray:
    return np.stack([p[..., 1], p[..., 2], p[..., 0]], -1)


def mj_to_game_quat_xyzw(q: np.ndarray) -> np.ndarray:
    """MuJoCo (w, x, y, z) -> game (qx, qy, qz, qw) with the axis permutation applied."""
    return np.stack([q[..., 2], q[..., 3], q[..., 1], q[..., 0]], -1)


# ---------------------------------------------------------------- resampling
def resample(t_src: np.ndarray, values: np.ndarray, t_dst: np.ndarray) -> np.ndarray:
    out = np.empty((len(t_dst),) + values.shape[1:], dtype=np.float64)
    flat = values.reshape(len(values), -1)
    o = out.reshape(len(t_dst), -1)
    for k in range(flat.shape[1]):
        o[:, k] = np.interp(t_dst, t_src, flat[:, k])
    return out


# ---------------------------------------------------------------- writing
def quantise(block: np.ndarray, *, min_scale: float = 1e-9):
    lo = block.min(axis=0)
    hi = block.max(axis=0)
    mid = (lo + hi) / 2
    scale = np.maximum((hi - lo) / 65000.0, min_scale)
    v = np.round((block - mid) / scale)
    assert np.all(np.abs(v) <= 32767)
    return v.astype("<i2"), mid.astype(np.float64), scale.astype(np.float64)


def write_clip(out_dir: Path, clip_id: str, *, source: str, kind: str, fps: float, loop: bool,
               q: np.ndarray, base: np.ndarray, local: np.ndarray | None, speed: float,
               events: dict[str, list[float]], extra: dict) -> dict:
    """q: (n, 22) JOINT_NAMES order; base/local: (n, 7) game axes (x y z qx qy qz qw)."""
    n = len(q)
    assert q.shape == (n, len(JOINT_NAMES)) and base.shape == (n, 7)
    blocks = []
    header = {
        "id": clip_id,
        "source": source,
        "kind": kind,
        "fps": round(float(fps), 6),
        "frameCount": n,
        "duration": round(n / float(fps), 6),
        "loop": bool(loop),
        "joints": JOINT_NAMES,
        "speed": round(float(speed), 5),
        "events": {k: [round(float(x), 4) for x in v] for k, v in events.items() if len(v)},
        "encoding": "int16",
        "bin": f"{clip_id}.bin",
        "local": local is not None,
    }
    qi, qo, qs = quantise(q)
    blocks.append(qi)
    header["qOffset"] = [round(float(x), 7) for x in qo]
    header["qScale"] = [float(f"{x:.6g}") for x in qs]
    bi, bo, bs = quantise(base)
    blocks.append(bi)
    header["baseOffset"] = [round(float(x), 7) for x in bo]
    header["baseScale"] = [float(f"{x:.6g}") for x in bs]
    if local is not None:
        li, lo, ls = quantise(local)
        blocks.append(li)
        header["localOffset"] = [round(float(x), 7) for x in lo]
        header["localScale"] = [float(f"{x:.6g}") for x in ls]
    header.update(extra)
    data = b"".join(b.tobytes() for b in blocks)
    (out_dir / f"{clip_id}.bin").write_bytes(data)
    (out_dir / f"{clip_id}.json").write_text(json.dumps(header, separators=(",", ":")) + "\n")
    return {
        "id": clip_id, "source": source, "kind": kind, "fps": header["fps"], "frameCount": n,
        "duration": header["duration"], "loop": bool(loop), "speed": header["speed"],
        "bytes": len(data) + (out_dir / f"{clip_id}.json").stat().st_size,
    }


def decode_clip(out_dir: Path, clip_id: str):
    """Read a clip back exactly as the browser does (for checks)."""
    h = json.loads((out_dir / f"{clip_id}.json").read_text())
    raw = np.frombuffer((out_dir / h["bin"]).read_bytes(), dtype="<i2").astype(np.float64)
    n, j = h["frameCount"], len(h["joints"])
    q = raw[: n * j].reshape(n, j) * np.array(h["qScale"]) + np.array(h["qOffset"])
    base = raw[n * j: n * j + n * 7].reshape(n, 7) * np.array(h["baseScale"]) + np.array(h["baseOffset"])
    local = None
    if h.get("local"):
        local = raw[n * (j + 7): n * (j + 14)].reshape(n, 7) * np.array(h["localScale"]) + np.array(h["localOffset"])
    return h, q, base, local


def write_index(out_dir: Path) -> dict:
    """Rebuild index.json from every clip header in the directory."""
    clips = []
    for header_path in sorted(out_dir.glob("*.json")):
        if header_path.name == "index.json":
            continue
        h = json.loads(header_path.read_text())
        if "frameCount" not in h:
            continue
        size = header_path.stat().st_size + (out_dir / h["bin"]).stat().st_size
        clips.append({
            "id": h["id"], "source": h["source"], "kind": h["kind"], "fps": h["fps"],
            "frameCount": h["frameCount"], "duration": h["duration"], "loop": h["loop"],
            "speed": h.get("speed", 0.0), "bytes": size,
            **({"velocity": h["velocity"], "yawRate": h["yawRate"]} if "velocity" in h else {}),
        })
    index = {
        "schema": "crabcraft-motions/1",
        "note": "Every clip is a closed-loop rollout of a Jumper policy (KingKongRobotics/jumper, "
                "Apache-2.0) in MuJoCo: the example bundle's walking, jump, claw, gesture and dance "
                "policies, the six skills (jumper.skill_*, trained for this game) and five of the "
                "seven breakdance moves (jumper.break_* and the spin) through the crabcraft bundle, "
                "and the 720 jump spin and the back flip as rollouts in their own training "
                "environment, which the bundle's controller cannot start. tools/motion/ rebuilds "
                "everything.",
        "clips": clips,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    return index
