#!/usr/bin/env python3
"""Renders a beat.py arrangement to the game's own audio files: OGG Vorbis and MP3 at -18 LUFS
integrated with a -1 dBFS ceiling, the loudness tools/art/audio_build.py gives every music track.

beat.py makes every sound itself (sine waves, noise and filters, no samples), so the files are
original work. Used by tools/robot-routine-music.mjs for Robot Mode's live routine.

Usage: uv run --with numpy --with scipy --with soundfile --with pyloudnorm \
         python tools/trailer/breakdance/music_file.py <arrangement.json> <out dir> <id> [<entry.json>]
Writes <out dir>/<id>.ogg and <id>.mp3 (ffmpeg with libmp3lame) and prints the loudness and length.
With <entry.json> (the track's index fields: loop, volume, credit, license, source) it also adds or
replaces the track's entry in <out dir>/index.json, written the way audio_build.py writes it.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.ndimage import minimum_filter1d

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beat  # noqa: E402

SR = beat.SR
TARGET_LUFS = -18.0
CEILING_DB = -1.0


def limiter(x, ceiling_db=CEILING_DB, release=0.06):
    """Look-ahead peak limiter (tools/art/audio_build.py's)."""
    c = 10 ** (ceiling_db / 20)
    a = np.abs(x).max(axis=1)
    g = np.minimum(1.0, c / np.maximum(a, 1e-9))
    g = minimum_filter1d(g, size=2 * int(0.004 * SR) + 1)
    coef = np.exp(-1 / (release * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else coef * cur + (1 - coef) * g[i]
        out[i] = cur
    return (x * out[:, None]).astype(np.float32)


def main():
    arr = json.load(open(sys.argv[1]))
    out_dir, id_ = sys.argv[2], sys.argv[3]
    x = beat.render(arr).astype(np.float64)
    meter = pyln.Meter(SR)
    before = meter.integrated_loudness(x)
    x = limiter((x * 10 ** ((TARGET_LUFS - before) / 20)).astype(np.float32))
    after = meter.integrated_loudness(x.astype(np.float64))
    os.makedirs(out_dir, exist_ok=True)
    ogg = os.path.join(out_dir, f'{id_}.ogg')
    mp3 = os.path.join(out_dir, f'{id_}.mp3')
    # libsndfile Vorbis, quality 0.4 as the other tracks; streamed in one-second blocks.
    with sf.SoundFile(ogg, 'w', SR, 2, format='OGG', subtype='VORBIS', compression_level=0.6) as f:
        for i in range(0, len(x), SR):
            f.write(x[i:i + SR])
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    try:
        sf.write(tmp, x, SR, subtype='PCM_16')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-q:a', '5', mp3], check=True)
    finally:
        os.unlink(tmp)
    if len(sys.argv) > 4:
        entry = {'id': id_, 'files': [f'{id_}.ogg', f'{id_}.mp3'], **json.load(open(sys.argv[4]))}
        idx = os.path.join(out_dir, 'index.json')
        index = json.load(open(idx)) if os.path.exists(idx) else []
        at = next((i for i, e in enumerate(index) if e.get('id') == id_), None)
        if at is None:
            index.append(entry)
        else:
            index[at] = entry
        with open(idx, 'w') as f:
            json.dump(index, f, indent=2)
    print(json.dumps({
        'seconds': round(len(x) / SR, 3),
        'lufs_in': round(float(before), 1),
        'lufs': round(float(after), 1),
        'peak_db': round(float(20 * np.log10(np.abs(x).max())), 2),
        'ogg_bytes': os.path.getsize(ogg),
        'mp3_bytes': os.path.getsize(mp3),
    }))


if __name__ == '__main__':
    main()
