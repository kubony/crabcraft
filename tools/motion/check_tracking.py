"""How closely each recorded gesture/dance rollout tracks the bundle's reference recording.

The policy plays the reference from the moment the controller's switch-in ramp hands over
(`starts_on_entry`), so the rollout is aligned at its first policy tick. Reports joint RMS and
worst-joint RMS in degrees, over the whole reference.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_clips import Raw  # noqa: E402
from jumper_sim import BUNDLE, load_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main(raw_dir: Path = ROOT / "scratch" / "motion-raw") -> None:
    model = load_model(render=False)
    manifest = json.loads((BUNDLE / "bundle.json").read_text())
    for cid in ["gesture_hello", "gesture_bow", "gesture_paw", "gesture_salute",
                "dance_crab", "dance_brazilian", "dance_dream_wings", "dance_maze"]:
        raw = Raw(raw_dir / f"{cid}.npz", model)
        traj = json.loads((BUNDLE / manifest["modes"][cid]["trajectory"]).read_text())
        ref = np.asarray(traj["q"])  # 50 Hz, wire order
        run = np.nonzero(np.array([m == cid for m in raw.modes]) & raw.running)[0]
        t0 = raw.t[run[0]]
        tr = t0 + np.arange(len(ref)) / 50.0
        tr = tr[tr <= raw.t[run[-1]]]
        got = np.stack([np.interp(tr, raw.t, raw.q[:, j]) for j in range(22)], -1)
        err = got - ref[: len(tr)]
        rms = np.degrees(np.sqrt(np.mean(err ** 2)))
        per = np.degrees(np.sqrt(np.mean(err ** 2, axis=0)))
        # the rollout's own pacing: best time shift (policy lag)
        print(f"{cid:18s} {len(tr) / 50:7.2f}s of {len(ref) / 50:7.2f}s  joint RMS {rms:5.2f} deg  "
              f"worst joint {traj['joint_order'][int(np.argmax(per))]} {per.max():5.2f} deg")


if __name__ == "__main__":
    main()
