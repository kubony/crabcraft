"""Expected body positions for the browser FK check (dev/motion.html?fk=1).

For a few frames of several clips, poses the MuJoCo model from the *raw rollout* at the
clip frame's instant and writes the world positions of a few bodies, expressed like the clip's
base block (relative to frame 0, heading zeroed, game axes, metres). The harness poses its own
three.js rig from the *exported clip* and compares, which covers resampling, quantisation, the
axis mapping and the rig's joint tree in one number.

    python -I tools/motion/fk_check.py   ->  scratch/fk_expected.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import mujoco
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clipfile import qnormalize, resample  # noqa: E402
from export_clips import Raw  # noqa: E402
from jumper_sim import load_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BODIES = ["upper_shell_link", "LM_foot_tip_link", "RR_foot_tip_link", "LF_palm_pad_b_link", "RF_finger_link",
          "LF_finger_tip_link"]
CLIPS = ["walk_fwd", "strafe_left", "turn_left", "jump", "claw_left", "gesture_hello", "dance_maze", "dance_crab"]


def main() -> None:
    m = load_model(render=False)
    d = mujoco.MjData(m)
    bid = {n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n) for n in BODIES}
    out = {"clips": []}
    for cid in CLIPS:
        h = json.loads((ROOT / "public" / "motions" / f"{cid}.json").read_text())
        raw = Raw(ROOT / "scratch" / "motion-raw" / f"{cid}.npz", m)
        prov = h["provenance"]
        start = prov.get("loop_start_s", prov.get("trigger_s"))
        n = h["frameCount"]
        ks = sorted(set(np.linspace(0, n - 1, 7).astype(int).tolist()))
        T = start + np.array(ks) / h["fps"]
        qpos = resample(raw.t, raw.qpos, T)
        qpos[:, 3:7] = qnormalize(resample(raw.t, raw.quat, T))
        T0 = np.array([start])
        p0 = resample(raw.t, raw.pos, T0)[0]
        yaw0 = float(np.interp(start, raw.t, raw.yaw))
        c, s = np.cos(-yaw0), np.sin(-yaw0)
        frames = []
        for k, qp in zip(ks, qpos):
            d.qpos[:] = qp
            mujoco.mj_kinematics(m, d)
            bodies = {}
            for name, b in bid.items():
                x, y, z = d.xpos[b]
                dx, dy = x - p0[0], y - p0[1]
                rx, ry = c * dx - s * dy, s * dx + c * dy
                bodies[name] = [float(ry), float(z), float(rx)]  # game axes
            frames.append({"k": k, "bodies": bodies})
        out["clips"].append({"id": cid, "frames": frames})
    path = ROOT / "scratch" / "fk_expected.json"
    path.write_text(json.dumps(out))
    print(path, sum(len(c["frames"]) for c in out["clips"]), "frames")


if __name__ == "__main__":
    main()
