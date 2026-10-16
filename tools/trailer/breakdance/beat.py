#!/usr/bin/env python3
"""The breakdance video's music: an original boom-bap beat at the toprock's own tempo, synthesised.

Every sound is made here from sine waves, noise and filters (no samples, no third-party audio), so
the track is ours. The tempo is the toprock's: its reference steps land every 0.56 s
(src/motion/breakClips.ts, break_toprock beat1 to beat8), 107.14 beats a minute.

The arrangement comes from the edit (tools/trailer/breakdance/edit.mjs) as JSON, so the music follows
the cut: sections in bars, impacts on the landings, a riser into each drop.

  {"sections": [{"style": "hook", "bars": 1}, {"style": "drop", "bars": 1}, ...],
   "hits": [{"t": 2.24, "kind": "impact"}, ...], "tail": 2.4}

Styles: hook (slow, muffled, rising), drop (impact, then a drum break with scratches), grooveA,
grooveB (busier, horns, scratch fills), half (half-time for slow motion), finale (everything),
outro (one bar of groove, a final stab that rings out over `tail` seconds), rest (nothing but the
crackle: another track plays there, the live routine's own music in the showcase reel).

Hits: impact, crash, riser and rcym (with `d`, seconds), scratch, and sad (four falling horn notes,
the making-of's blooper punchline), each at `t` seconds.

Usage: uv run --with numpy --with scipy python tools/trailer/breakdance/beat.py <arrangement.json> <out.wav>
Writes 48 kHz stereo 32-bit float WAV (not loudness-normalised: the edit does that).
"""
import json
import struct
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BEAT = 0.56  # seconds, the toprock's step
STEP = BEAT / 4  # a sixteenth
BAR = BEAT * 4
SWING = 0.12  # late off-sixteenths, fraction of a sixteenth
RNG = np.random.default_rng(107)


# ------------------------------------------------------------------------------------ helpers

def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def note(name):
    """'E2', 'C#3', 'Bb2' -> Hz (A4 = 440)."""
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    n = names[name[0]]
    rest = name[1:]
    if rest[0] == '#':
        n += 1
        rest = rest[1:]
    elif rest[0] == 'b':
        n -= 1
        rest = rest[1:]
    midi = 12 * (int(rest) + 1) + n
    return 440.0 * 2 ** ((midi - 69) / 12)


def sos(kind, f, order=2):
    if kind == 'band':
        return butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype='band', output='sos')
    return butter(order, f / (SR / 2), btype=kind, output='sos')


def filt(x, kind, f, order=2):
    return sosfilt(sos(kind, f, order), x, axis=0)


def env_exp(t, tau, attack=0.002):
    a = np.clip(t / attack, 0, 1) if attack > 0 else 1.0
    return a * np.exp(-t / tau)


def noise(n):
    return RNG.standard_normal(n)


def stereo(x, pan=0.0):
    """Mono to stereo, constant-power pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


# ------------------------------------------------------------------------------------ instruments

def kick(vel=1.0):
    t = t_axis(0.5)
    f = 46 + 120 * np.exp(-t / 0.028)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env_exp(t, 0.30, 0.001)
    click = filt(noise(len(t)), 'high', 2500) * env_exp(t, 0.004, 0.0005) * 0.35
    x = np.tanh(1.8 * (body + click)) * 0.78
    return x * vel


def snare(vel=1.0):
    t = t_axis(0.45)
    tone = (np.sin(2 * np.pi * 186 * t) + 0.5 * np.sin(2 * np.pi * 331 * t)) * env_exp(t, 0.055, 0.001)
    n = filt(noise(len(t)), 'band', (1400, 9000)) * env_exp(t, 0.15, 0.001)
    crack = filt(noise(len(t)), 'high', 4000) * env_exp(t, 0.012, 0.0005)
    x = np.tanh(1.4 * (0.55 * tone + 0.9 * n + 0.5 * crack))
    return x * vel * 1.0


def clap(vel=1.0):
    t = t_axis(0.35)
    x = np.zeros(len(t))
    src = filt(noise(len(t)), 'band', (900, 5000))
    for k, d in enumerate([0.0, 0.011, 0.022]):
        tt = np.clip(t - d, 0, None)
        x += src * (t >= d) * env_exp(tt, 0.008 if k < 2 else 0.12, 0.0005)
    return x * vel * 0.6


def hat(vel=1.0, open_=False):
    t = t_axis(0.5 if open_ else 0.12)
    # Six detuned squares (the classic metal) plus noise, high-passed.
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    x = filt(0.25 * metal + noise(len(t)), 'high', 7200, 3)
    x *= env_exp(t, 0.16 if open_ else 0.022, 0.0005)
    return x * vel * (0.32 if open_ else 0.28)


def shaker(vel=1.0):
    t = t_axis(0.09)
    x = filt(noise(len(t)), 'band', (5000, 12000)) * env_exp(t, 0.03, 0.008)
    return x * vel * 0.18


def crash(vel=1.0):
    t = t_axis(2.6)
    metal = sum(np.sign(np.sin(2 * np.pi * f * t + RNG.uniform(0, 6))) for f in (310, 427, 563, 711, 893, 1187))
    x = filt(0.2 * metal + noise(len(t)), 'high', 4500, 2) * env_exp(t, 0.75, 0.001)
    return x * vel * 0.32


def bass(f, dur, vel=1.0, glide_from=None):
    t = t_axis(dur + 0.08)
    ff = np.full(len(t), f)
    if glide_from:
        ff = f + (glide_from - f) * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(ff) / SR
    x = np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    e = np.clip(t / 0.006, 0, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.02)) * (0.75 + 0.25 * np.exp(-t / 0.15))
    return np.tanh(1.5 * x * e) * vel * 0.44


def epiano(freqs, dur, vel=1.0, bright=1.0):
    """FM electric piano chord: per note a 1:1 operator pair with a decaying index, plus a tine."""
    t = t_axis(dur + 1.2)
    out = np.zeros((len(t), 2))
    for i, f in enumerate(freqs):
        idx = bright * (1.8 * np.exp(-t / 0.22) + 0.35)
        y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
        tine = 0.12 * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t / 0.05)
        e = np.clip(t / 0.003, 0, 1) * np.exp(-t / 1.6) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.12))
        v = (y + tine) * e / len(freqs)
        # Tremolo panning, a little apart per note.
        trem = 0.35 * np.sin(2 * np.pi * 4.2 * t + i * 1.3)
        out += stereo(v, 0) * np.stack([1 + trem, 1 - trem], axis=1)
    return out * vel * 1.15


def brass(freqs, dur, vel=1.0, fall=False):
    """Horn stab: additive, the upper harmonics open on the attack; three detuned voices per note."""
    t = t_axis(dur + 0.35)
    bright = 0.42 + 0.42 * np.exp(-((t - 0.04) / 0.07) ** 2) + 0.12 * np.clip(t / 0.02, 0, 1)
    e = np.clip(t / 0.018, 0, 1) * np.where(t < dur, 1.0 - 0.25 * np.clip(t / dur, 0, 1), np.exp(-(t - dur) / 0.07))
    out = np.zeros((len(t), 2))
    for f in freqs:
        for det, pan in ((-7, -0.5), (0, 0.0), (7, 0.5)):
            fd = np.full(len(t), f * 2 ** (det / 1200))
            if fall:
                fd *= 1 - 0.06 * np.clip((t - dur * 0.6) / (dur * 0.5), 0, 1) ** 2
            ph = 2 * np.pi * np.cumsum(fd) / SR
            y = np.zeros(len(t))
            for h in range(1, 18):
                if f * h > 12000:
                    break
                y += bright ** (h - 1) / h ** 0.7 * np.sin(h * ph)
            out += stereo(y * e, pan)
    return out * vel * 0.14 / len(freqs)


def vowel(dur=0.7, f0=150.0):
    """A sung 'ah' (harmonics under three formants): the record the scratches are cut from."""
    t = t_axis(dur)
    ph = 2 * np.pi * np.cumsum(f0 * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * t))) / SR
    y = np.zeros(len(t))
    for h in range(1, 60):
        fh = f0 * h
        if fh > 9000:
            break
        g = sum(a / (1 + ((fh - F) / B) ** 2) for F, B, a in ((730, 90, 1.0), (1090, 110, 0.5), (2440, 170, 0.25)))
        y += g * np.sin(h * ph)
    y += 0.15 * filt(noise(len(t)), 'band', (2000, 6000))
    return y / np.max(np.abs(y))


VOWEL = vowel()


def scratch(pattern, beats=1.0):
    """Turntable scratches over the vowel record: `pattern` is a list of (start, length, direction)
    in beats; the record moves forward (+1) or back (-1) with a soft start and stop."""
    n = int(beats * BEAT * SR) + SR // 10
    out = np.zeros(n)
    pos = 0.12 * SR
    for s, length, d in pattern:
        i0 = int(s * BEAT * SR)
        m = int(length * BEAT * SR)
        u = np.arange(m) / m
        speed = np.sin(np.pi * u) ** 1.5 * 2.2  # times normal speed at the peak
        p = pos + d * np.cumsum(speed)
        p = np.clip(p, 0, len(VOWEL) - 2)
        k = p.astype(int)
        fr = p - k
        y = VOWEL[k] * (1 - fr) + VOWEL[k + 1] * fr
        y *= np.sin(np.pi * u) ** 0.5
        out[i0:i0 + m] += y[: max(0, min(m, n - i0))]
        pos = p[-1]
    out = filt(out, 'band', (300, 7000))
    return np.tanh(1.6 * out) * 0.38


def sad_horn(vel=1.0):
    """Four falling horn notes, the last held and wobbling under a plunger: 'wah wah wah wahhh',
    the making-of's punchline for a jump that does not jump."""
    seq = [('D4', 0.30), ('C#4', 0.30), ('C4', 0.30), ('B3', 1.15)]
    parts = []
    for i, (name, d) in enumerate(seq):
        f = note(name)
        t = t_axis(d + 0.06)
        last = i == len(seq) - 1
        wob = np.clip((t - 0.15) / 0.2, 0, 1) * np.sin(2 * np.pi * 5.5 * t) if last else np.zeros(len(t))
        ph = 2 * np.pi * np.cumsum(f * (1 + 0.012 * wob)) / SR
        # The plunger: the tone opens after the attack and closes towards the note's end.
        open_ = np.clip(t / 0.08, 0, 1) * (1 - 0.6 * np.clip((t - 0.5 * d) / (0.5 * d), 0, 1)) * (1 + 0.3 * wob)
        y = sum((0.25 + 0.7 * np.clip(open_, 0, 1)) ** (h - 1) / h ** 0.6 * np.sin(h * ph) for h in range(1, 14))
        e = np.clip(t / 0.03, 0, 1) * np.where(t < d, 1.0, np.exp(-(t - d) / 0.05))
        parts.append((y * e)[: int(d * SR)] if not last else y * e)
    x = np.concatenate(parts)
    return np.tanh(1.2 * x / np.max(np.abs(x))) * vel * 0.4


def impact(vel=1.0):
    t = t_axis(2.2)
    f = 34 + 60 * np.exp(-t / 0.09)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(t, 0.7, 0.002)
    burst = filt(noise(len(t)), 'low', 2500) * env_exp(t, 0.18, 0.001)
    x = np.tanh(1.6 * (sub + 0.6 * burst))
    return x * vel * 0.85


def riser(dur, vel=1.0):
    """Noise whose colour sweeps up: octave bands of noise, each swelling as the sweep passes it."""
    t = t_axis(dur)
    k = t / dur
    centre = np.log2(300) + k * (np.log2(9000) - np.log2(300))
    y = np.zeros(len(t))
    for c in np.arange(np.log2(250), np.log2(12000), 0.5):
        band = filt(noise(len(t)), 'band', (2 ** (c - 0.25), min(2 ** (c + 0.25), 20000)))
        y += band * np.exp(-((centre - c) / 0.7) ** 2)
    return y * (k ** 2) * vel * 0.9


def reverse_cymbal(dur, vel=1.0):
    c = crash(1.0)[: int(dur * SR)]
    return c[::-1] * np.linspace(0.3, 1, len(c)) * vel


def crackle(seconds):
    n = int(seconds * SR)
    x = 0.003 * filt(noise(n), 'band', (800, 6000))
    pops = RNG.random(n) < 7 / SR
    x[pops] += RNG.uniform(-0.06, 0.06, pops.sum())
    return filt(x, 'band', (300, 9000))


# ------------------------------------------------------------------------------------ music

# Two-chord E dorian vamp, voiced for the electric piano and the horns.
CHORDS = {
    'Em9': ['E3', 'G3', 'B3', 'D4', 'F#4'],
    'A9': ['A2', 'C#4', 'E4', 'G4', 'B4'],
    'Cmaj7': ['C3', 'E3', 'G3', 'B3', 'D4'],
    'B7#9': ['B2', 'D#4', 'A4', 'D5'],
}
HORN = {'Em9': ['E4', 'G4', 'B4'], 'A9': ['E4', 'G4', 'C#5'], 'Cmaj7': ['E4', 'G4', 'B4'], 'B7#9': ['D#4', 'A4', 'D5']}
PROG = ['Em9', 'A9', 'Em9', 'A9', 'Cmaj7', 'A9', 'Em9', 'B7#9']
ROOT = {'Em9': 'E2', 'A9': 'A1', 'Cmaj7': 'C2', 'B7#9': 'B1'}
# Funk bass, per bar: (sixteenth, chord degree, length in sixteenths, velocity); the degrees are
# spelled per chord so the walk down never rubs against the chord's own third or seventh.
BASS = [(0, 'R', 3, 1.0), (3, 'R', 1, 0.55), (6, '8', 1, 0.8), (7, '7', 1, 0.7), (10, '5', 2, 0.9), (12, '4', 2, 0.85), (14, '3', 1, 0.7), (15, '2', 1, 0.6)]
DEGREES = {
    'Em9': {'R': 0, '8': 12, '7': 10, '5': 7, '4': 5, '3': 3, '2': 2},
    'A9': {'R': 0, '8': 12, '7': 10, '5': 7, '4': 5, '3': 4, '2': 2},
    'Cmaj7': {'R': 0, '8': 12, '7': 11, '5': 7, '4': 5, '3': 4, '2': 2},
    'B7#9': {'R': 0, '8': 12, '7': 10, '5': 7, '4': 5, '3': 3, '2': 2},
}


def semis(f, n):
    return f * 2 ** (n / 12)


class Song:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR
        self.drums = np.zeros((self.n, 2))
        self.music = np.zeros((self.n, 2))
        self.verb = np.zeros((self.n, 2))  # reverb send
        self.duck = np.zeros(self.n)  # kick envelope for sidechain

    def put(self, bus, x, t, gain=1.0, pan=0.0, send=0.0):
        if x.ndim == 1:
            x = stereo(x, pan)
        i = int(round(t * SR))
        if i >= self.n or i + len(x) <= 0:
            return
        if i < 0:
            x = x[-i:]
            i = 0
        m = min(len(x), self.n - i)
        getattr(self, bus)[i:i + m] += x[:m] * gain
        if send:
            self.verb[i:i + m] += x[:m] * gain * send

    def kick(self, t, vel=1.0):
        self.put('drums', kick(vel), t)
        e = env_exp(t_axis(0.3), 0.12, 0.001) * vel
        i = int(t * SR)
        m = min(len(e), self.n - i)
        if m > 0:
            self.duck[i:i + m] = np.maximum(self.duck[i:i + m], e[:m])


def at(bar0, step):
    """Time of a sixteenth in a bar (swung)."""
    return bar0 + step * STEP + (SWING * STEP if step % 2 == 1 else 0.0)


def drums(S, b0, style, bar_index, last_bar):
    if style in ('grooveA', 'outro'):
        kicks = [(0, 1.0), (7, 0.75), (10, 0.95)]
        hats = [(s, 0.9 if s % 4 == 0 else 0.6) for s in range(0, 16, 2)]
    else:
        kicks = [(0, 1.0), (3, 0.6), (7, 0.8), (10, 0.95), (13, 0.55)]
        hats = [(s, 0.85 if s % 4 == 0 else (0.55 if s % 2 == 0 else 0.35)) for s in range(16)]
    for s, v in kicks:
        S.kick(at(b0, s), v)
    for s in (4, 12):
        S.put('drums', snare(1.0), at(b0, s), send=0.16)
        if style in ('finale', 'drop', 'grooveB'):
            S.put('drums', clap(0.8), at(b0, s) + 0.004, pan=0.15, send=0.2)
    for s, v in ((11, 0.25), (15, 0.3)):
        S.put('drums', snare(v), at(b0, s), send=0.1)
    for s, v in hats:
        if s == 14:
            S.put('drums', hat(0.8, open_=True), at(b0, s), pan=0.3)
        else:
            S.put('drums', hat(v), at(b0, s), pan=0.3)
    if style in ('grooveB', 'finale'):
        for s in range(16):
            S.put('drums', shaker(0.9 if s % 2 else 0.5), at(b0, s), pan=-0.35)
    # A snare run into every second bar line.
    if bar_index % 2 == 1 and not last_bar and style != 'outro':
        for k, s in enumerate((13, 14, 15)):
            S.put('drums', snare(0.35 + 0.15 * k), at(b0, s), send=0.12)


def harmony(S, b0, chord, style, vel=1.0):
    root = note(ROOT[chord])
    for s, d, length, v in BASS:
        prev = semis(root, -2) if s == 0 else None
        S.put('music', bass(semis(root, DEGREES[chord][d]), length * STEP * 0.92, v * vel, glide_from=prev), at(b0, s))
    fs = [note(x) for x in CHORDS[chord]]
    # Electric piano: a held chord on the one, stabs on the 'and' of two and on the 'a' of three.
    S.put('music', epiano(fs, BEAT * 1.4, 0.75 * vel), at(b0, 0), send=0.25)
    S.put('music', epiano(fs, STEP * 1.6, 0.55 * vel, 1.3), at(b0, 6), send=0.25)
    S.put('music', epiano(fs, STEP * 1.6, 0.5 * vel, 1.3), at(b0, 11), send=0.25)


def horns(S, b0, chord, pattern='hit'):
    fs = [note(x) for x in HORN[chord]]
    if pattern == 'hit':
        S.put('music', brass(fs, STEP * 2.5, 1.0), at(b0, 0), send=0.3)
    elif pattern == 'riff':
        for s, d, v in ((0, 2, 1.0), (3, 1, 0.8), (6, 3, 0.95), (10, 1, 0.8), (11, 4, 1.0, )):
            S.put('music', brass(fs, STEP * d * 0.9, v, fall=(s == 11)), at(b0, s), send=0.3)


def render(arr):
    secs = arr['sections']
    total = sum(s['bars'] for s in secs) * BAR + arr.get('tail', 2.4)
    S = Song(total)
    hits = arr.get('hits', [])
    bar = 0
    for si, sec in enumerate(secs):
        style = sec['style']
        for k in range(sec['bars']):
            b0 = bar * BAR
            chord = PROG[bar % len(PROG)]
            last = k == sec['bars'] - 1
            nxt = secs[si + 1]['style'] if si + 1 < len(secs) else None
            if style == 'hook':
                # Slow motion: a muffled chord, a heartbeat kick, the riser and a reverse cymbal into the drop.
                pad = epiano([note(x) for x in CHORDS['Em9']], BAR * 0.98, 0.9, 0.5)
                S.put('music', filt(pad, 'low', 900), b0, send=0.5)
                S.put('music', bass(note('E1') * 2, BAR * 0.9, 0.7), b0)
                for s in (0, 6, 8):
                    S.kick(at(b0, s), 0.55)
                S.put('drums', reverse_cymbal(BAR * 0.6, 1.0), b0 + BAR - BAR * 0.6)
                S.put('music', riser(BAR, 0.8), b0)
            elif style == 'drop':
                S.put('drums', crash(1.0), b0, send=0.2)
                S.put('music', brass([note(x) for x in HORN['Em9']], BEAT * 0.9, 1.1), b0, send=0.35)
                S.put('music', epiano([note(x) for x in CHORDS['Em9']], BEAT * 1.5, 0.8), b0, send=0.3)
                S.put('music', bass(note('E2'), BEAT * 1.4, 1.0, glide_from=note('E2') * 1.5), b0)
                # The break: drums alone after the hit, and a scratch on beats three and four.
                for s, v in ((0, 1.0), (7, 0.7), (10, 0.95)):
                    S.kick(at(b0, s), v)
                for s in (4, 12):
                    S.put('drums', snare(1.0), at(b0, s), send=0.16)
                    S.put('drums', clap(0.8), at(b0, s) + 0.004, send=0.2)
                for s in range(2, 16, 2):
                    S.put('drums', hat(0.6), at(b0, s), pan=0.3)
                S.put('music', scratch([(0, 0.25, 1), (0.25, 0.25, -1), (0.5, 0.125, 1), (0.625, 0.125, -1), (0.75, 0.25, 1), (1.0, 0.25, -1), (1.25, 0.5, 1)], 2), at(b0, 8), pan=-0.1)
            elif style in ('grooveA', 'grooveB', 'finale'):
                drums(S, b0, style, k, last)
                harmony(S, b0, chord, style)
                if style == 'grooveB' and k % 2 == 0:
                    horns(S, b0, chord, 'hit')
                if style == 'finale':
                    horns(S, b0, chord, 'riff' if k % 2 == 1 else 'hit')
                if k == 0 and style in ('finale', 'grooveB'):
                    S.put('drums', crash(0.8), b0, send=0.2)
                if style == 'grooveB' and k % 2 == 1 and not last:
                    S.put('music', scratch([(0, 0.25, 1), (0.25, 0.25, -1), (0.5, 0.25, 1), (0.75, 0.25, -1)], 1), at(b0, 12), pan=0.1)
            elif style == 'half':
                # Half time under slow motion: kick on one, snare on three, long notes, a lot of room.
                S.kick(at(b0, 0), 1.0)
                S.kick(at(b0, 10), 0.6)
                S.put('drums', snare(1.0), at(b0, 8), send=0.6)
                S.put('drums', clap(0.7), at(b0, 8), send=0.6)
                for s in range(0, 16, 4):
                    S.put('drums', hat(0.5), at(b0, s + 2), pan=0.3)
                S.put('music', bass(note(ROOT[chord]), BAR * 0.95, 0.9), b0)
                pad = epiano([note(x) for x in CHORDS[chord]], BAR * 0.95, 0.8, 0.7)
                S.put('music', filt(pad, 'low', 1800), b0, send=0.5)
            elif style == 'rest':
                pass
            elif style == 'outro':
                if k == 0:
                    drums(S, b0, 'grooveA', 0, True)
                    harmony(S, b0, 'Em9', 'grooveA')
                    S.put('music', scratch([(0, 0.25, 1), (0.25, 0.25, -1), (0.5, 0.5, 1)], 1), at(b0, 12), pan=0.1)
                elif k == 1:
                    # The final stab, ringing out.
                    S.kick(b0, 1.0)
                    S.put('drums', crash(1.0), b0, send=0.4)
                    S.put('music', brass([note(x) for x in HORN['Em9']], BEAT * 1.2, 1.1, fall=True), b0, send=0.5)
                    S.put('music', epiano([note(x) for x in CHORDS['Em9']], BAR * 1.5, 0.9), b0, send=0.6)
                    S.put('music', bass(note('E2'), BAR * 1.1, 0.9), b0)
                    S.put('music', filt(epiano([note(x) for x in CHORDS['Em9']], BAR * 1.8, 0.5, 0.4), 'low', 1500), b0 + BEAT * 2, send=0.6)
            # A riser into the next section's first bar when it is a drop or the finale.
            if last and nxt in ('drop', 'finale', 'grooveB') and style not in ('hook', 'rest'):
                S.put('music', riser(BEAT * 2, 0.5), b0 + BAR - BEAT * 2)
            bar += 1
    for h in hits:
        if h['kind'] == 'impact':
            S.put('drums', impact(h.get('vel', 1.0)), h['t'], send=0.25)
        elif h['kind'] == 'crash':
            S.put('drums', crash(h.get('vel', 1.0)), h['t'], send=0.2)
        elif h['kind'] == 'riser':
            S.put('music', riser(h['d'], h.get('vel', 0.6)), h['t'] - h['d'])
        elif h['kind'] == 'rcym':
            S.put('drums', reverse_cymbal(h['d'], h.get('vel', 0.9)), h['t'] - h['d'])
        elif h['kind'] == 'scratch':
            S.put('music', scratch([(0, 0.25, 1), (0.25, 0.25, -1), (0.5, 0.25, 1), (0.75, 0.25, -1)], 1), h['t'])
        elif h['kind'] == 'sad':
            S.put('music', sad_horn(h.get('vel', 1.0)), h['t'], send=0.3)

    # Mix: sidechain the music under the kick, a stereo room on the send, gentle glue.
    duck = 1 - 0.3 * np.clip(S.duck, 0, 1)
    music = S.music * duck[:, None]
    ir_t = t_axis(1.6)
    ir = np.stack([filt(noise(len(ir_t)), 'band', (250, 7000)) * np.exp(-ir_t / 0.38) for _ in range(2)], axis=1)
    ir[: int(0.012 * SR)] = 0
    verb = np.stack([fftconvolve(S.verb[:, c], ir[:, c])[: S.n] for c in range(2)], axis=1) * 0.06
    mix = 0.95 * S.drums + 0.8 * music + verb
    mix += stereo(crackle(S.n / SR), 0)[: S.n]
    mix = filt(mix, 'high', 28)
    peak = np.max(np.abs(mix))
    mix = np.tanh(1.2 * mix / peak) / np.tanh(1.2) * 0.89
    n = int(total * SR)
    return mix[:n].astype(np.float32)


def write_wav(path, x):
    # 32-bit float WAV by hand (the wave module writes PCM only): RIFF header with format 3.
    data = x.astype('<f4').tobytes()
    ch = x.shape[1]
    hdr = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVE'
    hdr += b'fmt ' + struct.pack('<IHHIIHH', 16, 3, ch, SR, SR * ch * 4, ch * 4, 32)
    hdr += b'data' + struct.pack('<I', len(data))
    with open(path, 'wb') as f:
        f.write(hdr + data)


def main():
    arr = json.load(open(sys.argv[1]))
    x = render(arr)
    write_wav(sys.argv[2], x)
    print(f'wrote {sys.argv[2]}: {len(x) / SR:.2f} s, peak {np.max(np.abs(x)):.3f}')


if __name__ == '__main__':
    main()
