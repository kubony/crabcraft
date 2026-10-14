#!/usr/bin/env python3
"""Contact sheet of a video: one frame every N seconds, labelled with its timecode.

Usage: python3 tools/trailer/contact_sheet.py <video.mp4> <out.png> [--every 3] [--cols 6] [--width 480]
Needs ffmpeg and Pillow.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--every", type=float, default=3.0)
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--width", type=int, default=480)
    a = ap.parse_args()

    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", a.video],
        capture_output=True, check=True, text=True).stdout)
    duration = float(probe["format"]["duration"])
    times = []
    t = 0.0
    while t < duration - 0.05:
        times.append(t)
        t += a.every

    with tempfile.TemporaryDirectory() as tmp:
        tiles = []
        for i, t in enumerate(times):
            f = Path(tmp) / f"{i:03d}.png"
            # A frame a little after the mark, so the very first one is not the fade from black.
            at = max(t, 0.25) if i == 0 else t
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.3f}", "-i", a.video, "-frames:v", "1",
                            "-vf", f"scale={a.width}:-2:flags=lanczos", str(f)], check=True)
            tiles.append((t, Image.open(f).convert("RGB")))

    tw, th = tiles[0][1].size
    pad = 8
    label_h = 26
    rows = (len(tiles) + a.cols - 1) // a.cols
    sheet = Image.new("RGB", (a.cols * (tw + pad) + pad, rows * (th + label_h + pad) + pad), (16, 17, 20))
    draw = ImageDraw.Draw(sheet)
    font = None
    for cand in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try:
            font = ImageFont.truetype(cand, 18)
            break
        except OSError:
            continue
    font = font or ImageFont.load_default()
    for i, (t, im) in enumerate(tiles):
        r, c = divmod(i, a.cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + label_h + pad)
        sheet.paste(im, (x, y + label_h))
        draw.text((x + 2, y + 3), f"{int(t // 60):02d}:{t % 60:05.2f}", fill=(235, 215, 160), font=font)
    sheet.save(a.out, optimize=True)
    print(f"wrote {a.out}: {len(tiles)} frames, {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
