"""Check this host against the bundle's own reference.json (BUNDLE_README.md, "measure that you agree").

1. The controller extension replays the recorded frames: observation and target differences must be 0.
2. onnxruntime runs each recorded observation through the bundle's .onnx and is compared with the
   recorded action (~1e-6 expected).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jumper_sim import BUNDLE, Host  # noqa: E402


def main() -> None:
    import onnxruntime as ort

    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", type=Path, default=BUNDLE, help="the bundle directory (default: the example)")
    bundle = ap.parse_args().bundle
    ref_text = (bundle / "reference.json").read_text("utf-8")
    host = Host(operators=False, render=False, bundle=bundle)
    report = host.fsm.check_reference(ref_text)
    print(f"controller replay: frames={report.frames} inferences={report.inferences} "
          f"observation={report.observation:.3g} target={report.target:.3g} "
          f"divergent={report.divergent} modeMismatches={report.mode_mismatches}")
    ref = json.loads(ref_text)
    frames = ref.get("frames") or []
    manifest = json.loads((bundle / "bundle.json").read_text("utf-8"))
    sessions = {m: ort.InferenceSession(str(bundle / e["models"]["onnx"]), providers=["CPUExecutionProvider"])
                for m, e in manifest["modes"].items()}
    worst: dict[str, float] = {}
    n = 0
    for f in frames:
        obs, act, mode = f.get("obs"), f.get("act"), f.get("mode")
        if not obs or not act or mode not in sessions:
            continue
        s = sessions[mode]
        out = s.run(None, {s.get_inputs()[0].name: np.asarray([obs], dtype=np.float32)})[0][0]
        worst[mode] = max(worst.get(mode, 0.0), float(np.max(np.abs(out - np.asarray(act)))))
        n += 1
    print(f"onnxruntime vs recorded act over {n} inferences: " +
          ", ".join(f"{m} {w:.2g}" for m, w in sorted(worst.items())))


if __name__ == "__main__":
    main()
