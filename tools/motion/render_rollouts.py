"""Render recorded rollouts with MuJoCo's own renderer: contact sheets (PNG) and MP4s.

    python -I tools/motion/render_rollouts.py --sheet walk_fwd,jump --out <dir>
    python -I tools/motion/render_rollouts.py --reel <dir>/rollouts.mp4

The reel is what the credits and the write-up use: real policy rollouts, labelled, in the
physics the clips were recorded in. Needs ffmpeg on PATH.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import mujoco
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jumper_sim import Shooter, load_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "scratch" / "motion-raw"

REEL = [
    ("walk_fwd", "locomotion policy - walk forward 0.25 m/s", 2.5, 5.5, 130),
    ("strafe_left", "locomotion policy - sideways 0.25 m/s", 3.0, 6.0, 60),
    ("walk_fast", "locomotion policy - trot 0.57 m/s", 3.0, 5.5, 140),
    ("turn_left", "locomotion policy - turn 1.4 rad/s", 3.0, 5.0, 150),
    ("jump", "jump policy (reference residual, 200 Hz)", 1.4, 5.0, 120),
    ("claw_left", "five_foot policy - claw reach and grab", 1.5, 6.6, 200),
    ("gesture_hello", "gesture_hello policy", 1.5, 10.5, 160),
    ("gesture_bow", "gesture_bow policy", 1.5, 11.5, 150),
    ("dance_maze", "dance_maze policy", 1.5, 14.0, 140),
    ("dance_crab", "dance_crab policy (first 30 s of 236 s)", 1.5, 31.5, 150),
]


def font(size: int):
    for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


class Player:
    def __init__(self, width: int, height: int):
        self.model = load_model(render=True)
        self.data = mujoco.MjData(self.model)
        self.shooter = Shooter(self.model, width, height)

    def frames(self, clip: str, t0: float, t1: float, fps: float, azimuth: float, distance: float = 0.7):
        z = np.load(RAW / f"{clip}.npz")
        t, qpos = z["t"], z["qpos"]
        self.shooter.cam.azimuth = azimuth
        self.shooter.cam.distance = distance
        self.shooter._look = None
        for tt in np.arange(t0, min(t1, t[-1]), 1.0 / fps):
            i = int(np.searchsorted(t, tt))
            self.data.qpos[:] = qpos[min(i, len(t) - 1)]
            mujoco.mj_forward(self.model, self.data)
            yield tt, self.shooter.frame(self.data, smooth=0.12)


def sheet(clips: list[str], out: Path, n: int = 6) -> None:
    p = Player(480, 300)
    for clip in clips:
        z = np.load(RAW / f"{clip}.npz")
        t = z["t"]
        t0, t1 = 1.5, float(t[-1])
        times = np.linspace(t0, t1, n + 2)[1:-1]
        imgs = []
        for tt in times:
            i = int(np.searchsorted(t, tt))
            p.data.qpos[:] = z["qpos"][i]
            mujoco.mj_forward(p.model, p.data)
            p.shooter._look = None
            p.shooter.cam.azimuth = 150
            img = Image.fromarray(p.shooter.frame(p.data))
            ImageDraw.Draw(img).text((8, 6), f"{clip} t={tt:.2f}s", fill=(20, 20, 20), font=font(18))
            imgs.append(np.asarray(img))
        rows = [np.concatenate(imgs[k:k + 3], 1) for k in range(0, len(imgs), 3)]
        Image.fromarray(np.concatenate(rows, 0)).save(out / f"sheet_{clip}.png")
        print(out / f"sheet_{clip}.png")


def reel(path: Path, width: int = 1280, height: int = 720, fps: int = 30) -> None:
    p = Player(width, height)
    big, small = font(34), font(22)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
           "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for clip, label, t0, t1, az in REEL:
        for tt, frame in p.frames(clip, t0, t1, fps, az):
            img = Image.fromarray(frame)
            d = ImageDraw.Draw(img)
            d.rectangle([0, height - 86, width, height], fill=(16, 16, 20))
            d.text((24, height - 78), label, fill=(240, 236, 228), font=big)
            d.text((24, height - 36), "Jumper (KingKongRobotics, Apache-2.0) - closed-loop rollout in MuJoCo, "
                   "bundle controller + ONNX policy", fill=(170, 170, 176), font=small)
            proc.stdin.write(np.asarray(img).tobytes())
    proc.stdin.close()
    proc.wait()
    print(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    ap.add_argument("--out", type=Path, default=ROOT / "scratch")
    ap.add_argument("--reel", type=Path, default=None)
    args = ap.parse_args()
    if args.sheet:
        args.out.mkdir(parents=True, exist_ok=True)
        sheet(args.sheet.split(","), args.out)
    if args.reel:
        reel(args.reel)


if __name__ == "__main__":
    main()
