# Build public/audio/: trim, loop, layer, synthesise, loudness-normalise, encode OGG Vorbis + MP3, write index.json.
# Usage: python audio_build.py <download dir> <repo public/audio dir> [ids...]
# <download dir>/dl-kenney/x/<pack>/ holds the unzipped Kenney packs, <download dir>/dl-oga/ the OpenGameArt files
# (music/ and sfx/, zips unpacked under sfx/x/). Every source and licence is listed in NOTICE.md.
# Needs ffmpeg (libmp3lame) and Python packages numpy, scipy, soundfile, pyloudnorm.
import json, os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import fftconvolve, butter, sosfilt

SCR, OUT = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
SR = 44100
K = f'{SCR}/dl-kenney/x'
O = f'{SCR}/dl-oga'
X = f'{O}/sfx/x'
RNG = np.random.default_rng(7)
meter = pyln.Meter(SR)


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def db(x):
    return 10 ** (x / 20)


def trim(x, thresh_db=-48, pad_ms=4, end=True):
    a = np.abs(x).max(axis=1)
    idx = np.where(a > db(thresh_db))[0]
    if len(idx) == 0:
        return x
    s = max(0, idx[0] - int(pad_ms * SR / 1000))
    e = min(len(x), idx[-1] + int(30 * SR / 1000)) if end else len(x)
    return x[s:e]


def resample(x, factor):
    """Play back `factor` times faster (pitch and speed)."""
    n = int(len(x) / factor)
    t = np.linspace(0, len(x) - 1, n)
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1).astype(np.float32)


def fade(x, fin=0.0, fout=0.0):
    x = x.copy()
    if fin > 0:
        n = min(len(x), int(fin * SR))
        x[:n] *= np.linspace(0, 1, n)[:, None] ** 2
    if fout > 0:
        n = min(len(x), int(fout * SR))
        x[-n:] *= np.linspace(1, 0, n)[:, None] ** 2
    return x


def mix(layers, length=None):
    """layers: (signal, offset seconds, gain dB)."""
    end = max(int(o * SR) + len(s) for s, o, g in layers)
    out = np.zeros((length or end, 2), np.float32)
    for s, o, g in layers:
        i = int(o * SR)
        n = min(len(s), len(out) - i)
        out[i:i + n] += s[:n] * db(g)
    return out


def lowpass(x, hz, order=2):
    sos = butter(order, hz, 'low', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


def highpass(x, hz, order=2):
    sos = butter(order, hz, 'high', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


def reverb(x, decay=1.4, wet=0.28, pre=0.018, bright=6500):
    n = int(decay * SR * 1.5)
    t = np.arange(n) / SR
    ir = RNG.standard_normal((n, 2)).astype(np.float32) * np.exp(-6.9 * t / decay)[:, None]
    ir = lowpass(ir, bright)
    ir[: int(pre * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    tail = np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1).astype(np.float32)
    dry = np.zeros_like(tail)
    dry[: len(x)] = x
    return dry * (1 - wet) + tail * wet * 2.2


def bell(f, dur, amp=1.0, pan=0.0, decay=1.0):
    t = np.arange(int(dur * SR)) / SR
    parts = [(1, 1.0, 1.0), (2.0, 0.45, 1.6), (2.76, 0.32, 2.2), (5.4, 0.18, 3.4), (8.93, 0.08, 5.0)]
    s = np.zeros_like(t)
    for r, a, d in parts:
        if f * r < 16000:
            s += a * np.sin(2 * np.pi * f * r * t + RNG.uniform(0, 6.28)) * np.exp(-d * t / decay)
    s *= np.minimum(1, t / 0.002)
    s *= amp / 1.6
    l, r_ = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([s * l, s * r_], axis=1).astype(np.float32)


def pad(freqs, dur, attack=0.3, release=0.8, amp=0.25, cutoff=3200):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros((len(t), 2), np.float32)
    for i, f in enumerate(freqs):
        for det, ch in ((-0.004, 0), (0.004, 1), (0.0, 0), (0.0, 1)):
            ff = f * (1 + det)
            s = np.zeros_like(t)
            for h in range(1, 14):
                if ff * h > 9000:
                    break
                s += np.sin(2 * np.pi * ff * h * t + RNG.uniform(0, 6.28)) / h
            out[:, ch] += s.astype(np.float32)
    out = lowpass(out, cutoff)
    env = np.minimum(1, t / attack) * np.clip((dur - t) / release, 0, 1)
    out *= env[:, None]
    out /= np.abs(out).max() + 1e-9
    return out * amp


def sparkle(dur, n=14, lo=2400, hi=6000, amp=0.22, start=0.0):
    out = np.zeros((int(dur * SR), 2), np.float32)
    for _ in range(n):
        t0 = RNG.uniform(start, dur * 0.8)
        b = bell(RNG.uniform(lo, hi), 0.5, amp * RNG.uniform(0.4, 1), pan=RNG.uniform(-0.8, 0.8), decay=0.35)
        i = int(t0 * SR)
        k = min(len(b), len(out) - i)
        out[i:i + k] += b[:k]
    return out


def sine_thump(f0=70, dur=0.5, amp=0.9):
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (1 + 1.5 * np.exp(-t * 18))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * amp
    return np.stack([s, s], axis=1).astype(np.float32)


def noise_sweep(dur, f0, f1, amp=0.3):
    n = int(dur * SR)
    noise = RNG.standard_normal((n, 2)).astype(np.float32)
    out = np.zeros_like(noise)
    seg = 512
    for i in range(0, n, seg):
        fc = f0 + (f1 - f0) * (i / n)
        sos = butter(2, [max(40, fc * 0.7), min(SR / 2 - 100, fc * 1.4)], 'band', fs=SR, output='sos')
        out[i:i + seg] = sosfilt(sos, noise[i:i + seg], axis=0)
    t = np.arange(n) / SR
    env = np.sin(np.pi * t / dur) ** 1.5
    return out * env[:, None] * amp / (np.abs(out).max() + 1e-9)


def servo(dur=0.62):
    t = np.arange(int(dur * SR)) / SR
    prof = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.6
    f = 190 + 150 * prof + 6 * np.sin(2 * np.pi * 9 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.zeros_like(t)
    for h, a in ((1, 1.0), (2, 0.5), (3, 0.42), (4, 0.2), (5, 0.25), (7, 0.12), (9, 0.08), (12, 0.05)):
        s += a * np.sin(h * ph)
    teeth = 0.65 + 0.35 * np.sign(np.sin(ph * 0.25))
    s *= teeth
    whine = 0.18 * np.sin(4.02 * ph + 0.3)
    noise = RNG.standard_normal(len(t)) * 0.12
    sos = butter(2, [900, 3500], 'band', fs=SR, output='sos')
    noise = sosfilt(sos, noise)
    sig = (s + whine + noise * 3) * prof
    sig = np.stack([sig, np.roll(sig, 30)], axis=1).astype(np.float32)
    sig = lowpass(sig, 6000)
    return fade(sig / np.abs(sig).max() * 0.6, 0.01, 0.06)


def limiter(x, ceiling_db=-1.0, release=0.06):
    c = db(ceiling_db)
    a = np.abs(x).max(axis=1)
    g = np.minimum(1.0, c / np.maximum(a, 1e-9))
    w = int(0.004 * SR)
    # look-ahead: running minimum over the next w samples
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(g, size=2 * w + 1)
    coef = np.exp(-1 / (release * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else coef * cur + (1 - coef) * g[i]
        out[i] = cur
    return (x * out[:, None]).astype(np.float32)


def loudness_integrated(x):
    if len(x) < int(0.5 * SR):
        x = np.concatenate([x, np.zeros((int(0.5 * SR) - len(x), 2), np.float32)])
    return meter.integrated_loudness(x)


def loudness_max_momentary(x):
    w = int(0.4 * SR)
    if len(x) < w:
        x = np.concatenate([x, np.zeros((w - len(x), 2), np.float32)])
    best = -70
    for i in range(0, len(x) - w + 1, int(0.1 * SR)):
        seg = x[i:i + w]
        try:
            m = pyln.Meter(SR, block_size=0.4).integrated_loudness(seg)
        except Exception:
            continue
        if np.isfinite(m):
            best = max(best, m)
    return best


def normalise(x, target, kind):
    l = loudness_integrated(x) if kind == 'music' else loudness_max_momentary(x)
    y = x * db(target - l)
    y = limiter(y, -1.0)
    return y, l


def crossfade_loop(x, seconds):
    n = int(seconds * SR)
    body = x[:-n].copy()
    t = np.linspace(0, 1, n)[:, None]
    body[:n] = x[:n] * np.sin(t * np.pi / 2) + x[-n:] * np.cos(t * np.pi / 2)
    return body


def encode(x, id_):
    os.makedirs(OUT, exist_ok=True)
    ogg = f'{OUT}/{id_}.ogg'
    mp3 = f'{OUT}/{id_}.mp3'
    # libsndfile Vorbis: quality = 1 - compression_level, so 0.6 gives Vorbis q0.4 (oggenc -q 4).
    # libsndfile can crash on one huge Vorbis write, so stream it in one-second blocks.
    with sf.SoundFile(ogg, 'w', SR, 2, format='OGG', subtype='VORBIS', compression_level=0.6) as f:
        for i in range(0, len(x), SR):
            f.write(x[i:i + SR])
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    sf.write(tmp, x, SR, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-q:a', '5', mp3], check=True)
    os.unlink(tmp)
    return os.path.getsize(ogg), os.path.getsize(mp3)


# ---------------- Recipes ----------------
MUS = f'{O}/music'
OGA = 'https://opengameart.org/content/'
CC0 = 'CC0-1.0'


def music_title():
    x = trim(load(f'{MUS}/FantasyOrchestralTheme_1.mp3'))
    return crossfade_loop(fade(x, 0, 0.3), 4.0)


def music_town():
    x = trim(load(f'{MUS}/TownTheme.mp3'))
    return crossfade_loop(x, 3.0)


def music_combat():
    x = trim(load(f'{MUS}/battleThemeA.mp3'))
    return crossfade_loop(x, 2.5)


def music_boss():
    # Author-made seamless loop: no trimming, no crossfade.
    return load(f'{MUS}/Juhani%20Junkala%20-%20Epic%20Boss%20Battle%20%5BSeamlessly%20Looping%5D.wav')


def music_ending():
    return load(f'{MUS}/Loop_Rejoicing.wav')


def k_ui(name):
    return f'{K}/ui-audio/Audio/{name}'


def find(root, name):
    for d, _, fs in os.walk(root):
        if name in fs:
            return os.path.join(d, name)
    raise FileNotFoundError(name)


def sfx_click():
    return fade(trim(load(find(f'{K}/ui-audio', 'click2.ogg'))), 0, 0.02)


def sfx_hover():
    return fade(trim(load(find(f'{K}/ui-audio', 'rollover2.ogg'))), 0, 0.02)


def sfx_hit():
    clash = trim(load(find(X, 'sword_clash.2.ogg')), -40)[: int(0.45 * SR)]
    punch = trim(load(find(f'{K}/impact-sounds', 'impactPunch_medium_000.ogg')))
    return fade(mix([(punch, 0, 0), (highpass(clash, 1500), 0.004, -9)]), 0, 0.08)


def sfx_crit():
    punch = trim(load(find(f'{K}/impact-sounds', 'impactPunch_heavy_000.ogg')))
    metal = trim(load(find(f'{K}/impact-sounds', 'impactMetal_heavy_001.ogg')))
    clash = trim(load(find(X, 'sword_clash.1.ogg')), -40)[: int(0.7 * SR)]
    thump = sine_thump(58, 0.45, 0.8)
    return reverb(fade(mix([(punch, 0, 0), (metal, 0.0, -3), (highpass(clash, 1200), 0.006, -7), (thump, 0, -4)]), 0, 0.15), decay=0.6, wet=0.15)


def sfx_heal():
    cure = trim(load(find(f'{X}/curemagic', 'Cure2.wav')))
    notes = [659.3, 830.6, 987.8, 1318.5]  # E5 G#5 B5 E6, rising
    bells = mix([(bell(f, 1.6, 0.35, pan=-0.4 + 0.27 * i, decay=0.9), 0.05 + 0.09 * i, 0) for i, f in enumerate(notes)])
    sp = sparkle(1.8, 10, 3000, 7000, 0.12, 0.2)
    return reverb(fade(mix([(cure, 0, -4), (bells, 0, -2), (sp, 0, -6), (pad([329.6, 415.3, 493.9], 1.6, 0.25, 0.9, 0.18), 0, -6)]), 0, 0.3), 1.6, 0.3)


def sfx_cast():
    m = trim(load(find(X, 'magic1.wav')))
    sweep = noise_sweep(0.7, 600, 5200, 0.35)
    return reverb(fade(mix([(m, 0, 0), (sweep, 0, -8)]), 0, 0.12), 1.0, 0.22)


def sfx_levelup():
    arp = [523.3, 659.3, 784.0, 1046.5, 1318.5]
    bells = mix([(bell(f, 2.2, 0.5, pan=-0.5 + 0.25 * i, decay=1.3), 0.075 * i, 0) for i, f in enumerate(arp)])
    chord = pad([261.6, 329.6, 392.0, 523.3, 659.3], 2.6, 0.18, 1.2, 0.3, 4200)
    sp = sparkle(2.6, 22, 2500, 7500, 0.18, 0.25)
    thump = sine_thump(90, 0.35, 0.5)
    swell = noise_sweep(1.1, 400, 7000, 0.18)
    return reverb(fade(mix([(bells, 0.02, 0), (chord, 0.0, -1), (sp, 0, -4), (thump, 0, -8), (swell, 0, -10)]), 0, 0.5), 1.8, 0.32)


def sfx_quest_accept():
    b = mix([(bell(784.0, 1.3, 0.6, -0.2, 0.8), 0, 0), (bell(1046.5, 1.4, 0.65, 0.2, 0.9), 0.12, 0)])
    page = trim(load(find(f'{K}/rpg-audio', 'bookFlip2.ogg')))
    return reverb(fade(mix([(b, 0.03, 0), (page, 0, -10), (pad([392.0, 523.3], 1.2, 0.08, 0.7, 0.18), 0, -8)]), 0, 0.3), 1.3, 0.28)


def sfx_quest_complete():
    pizzi = trim(load(find(f'{K}/music-jingles', 'jingles_PIZZI02.ogg')))
    chord = mix([(bell(f, 1.8, 0.45, pan=p, decay=1.2), 0, 0) for f, p in ((1046.5, -0.4), (1318.5, 0.0), (1568.0, 0.4))])
    sp = sparkle(1.9, 14, 3000, 7000, 0.15, 0.0)
    pd = pad([523.3, 659.3, 784.0], 1.9, 0.12, 1.0, 0.25, 4000)
    L = len(pizzi) / SR
    return reverb(fade(mix([(pizzi, 0, 0), (chord, L - 0.12, -3), (sp, L - 0.12, -6), (pd, L - 0.2, -6)]), 0, 0.4), 1.6, 0.3)


def sfx_footstep(kind):
    s = trim(load(find(f'{X}/fantozzi', f'Fantozzi-{kind}L2.ogg')), -40)
    s = resample(s, 1.35)[: int(0.22 * SR)]
    tick = trim(load(find(f'{K}/rpg-audio', 'metalClick.ogg')), -40)[: int(0.06 * SR)]
    return fade(mix([(highpass(s, 180), 0, 0), (highpass(tick, 2500), 0, -16)]), 0, 0.06)


def sfx_servo():
    click = trim(load(find(f'{K}/rpg-audio', 'metalLatch.ogg')), -40)[: int(0.12 * SR)]
    return mix([(servo(0.62), 0.0, 0), (click, 0.0, -10), (click[::-1].copy() * 0.6, 0.55, -14)])


def sfx_beacon():
    fire = trim(load(find(f'{X}/80-CC0-RPG-SFX_0', 'spell_fire_06.ogg')), -50)
    ff = trim(load(find(f'{K}/sci-fi-sounds', 'forceField_000.ogg')))
    thump = sine_thump(55, 0.9, 1.0)
    chord_f = [261.6, 392.0, 523.3, 659.3, 784.0, 1046.5]
    chord = mix([(bell(f, 3.2, 0.42, pan=-0.6 + 0.24 * i, decay=2.2), 0.25 + 0.05 * i, 0) for i, f in enumerate(chord_f)])
    pd = pad([130.8, 196.0, 261.6, 329.6, 392.0], 3.4, 0.6, 1.6, 0.3, 3000)
    swell = noise_sweep(1.0, 300, 6000, 0.25)
    sp = sparkle(3.2, 26, 2500, 8000, 0.16, 0.3)
    return reverb(fade(mix([(swell, 0, -6), (fire, 0.55, -4), (ff, 0.55, -10), (thump, 0.6, -2), (chord, 0.4, 0), (pd, 0.3, -4), (sp, 0.5, -5)]), 0, 0.8), 2.4, 0.35)


def sfx_boss_roar():
    roar = trim(load(f'{O}/sfx/monster_roar.wav'))
    roar = resample(roar, 0.86)[: int(3.6 * SR)]
    eng = trim(load(find(f'{K}/sci-fi-sounds', 'spaceEngineLow_000.ogg')))[: int(3.6 * SR)]
    boom = trim(load(find(f'{K}/sci-fi-sounds', 'lowFrequency_explosion_000.ogg')))
    metal = trim(load(find(f'{K}/impact-sounds', 'impactMetal_heavy_001.ogg')))
    grind = noise_sweep(3.0, 900, 300, 0.3)
    out = mix([(roar, 0, 0), (fade(eng, 0.4, 1.2), 0, -14), (boom, 0, -6), (resample(metal, 0.6), 0, -6), (grind, 0.2, -16)])
    return reverb(fade(out, 0, 0.9), 1.6, 0.2)


def sfx_death():
    off = trim(load(f'{O}/sfx/MachinePowerOff.ogg'), -60)
    metal = trim(load(find(f'{K}/impact-sounds', 'impactMetal_heavy_000.ogg')))
    plate = trim(load(find(f'{K}/impact-sounds', 'impactPlate_heavy_000.ogg')))
    L = len(off) / SR
    return reverb(fade(mix([(off, 0, 0), (plate, max(0, L - 0.55), -6), (metal, max(0, L - 0.5), -8)]), 0, 0.2), 0.9, 0.18)


def sfx_error():
    return fade(trim(load(find(f'{K}/interface-sounds', 'error_006.ogg'))), 0, 0.05)


def sfx_loot():
    return fade(trim(load(find(f'{K}/rpg-audio', 'handleCoins.ogg')), -50), 0, 0.08)


KEN = 'https://kenney.nl/assets/'
ENTRIES = [
    # id, fn, kind, loop, volume, credit, license, source
    ('music-title', music_title, 'music', True, 0.9, '"Fantasy Orchestral Theme" by Joth', CC0, OGA + 'fantasy-orchestral-theme'),
    ('music-town', music_town, 'music', True, 0.8, '"Town Theme RPG" by cynicmusic', CC0, OGA + 'town-theme-rpg'),
    ('music-combat', music_combat, 'music', True, 0.85, '"Battle Theme A" by cynicmusic', CC0, OGA + 'battle-theme-a'),
    ('music-boss', music_boss, 'music', True, 0.9, '"Epic Boss Battle" by Juhani Junkala (SubspaceAudio)', CC0, OGA + 'boss-battle-music'),
    ('music-ending', music_ending, 'music', True, 0.9, '"Medieval: Rejoicing" by RandomMind', CC0, OGA + 'medieval-rejoicing'),
    ('sfx-click', sfx_click, 'sfx', False, 0.5, 'Kenney UI Audio', CC0, KEN + 'ui-audio'),
    ('sfx-hover', sfx_hover, 'sfx', False, 0.3, 'Kenney UI Audio', CC0, KEN + 'ui-audio'),
    ('sfx-hit', sfx_hit, 'sfx', False, 0.8, 'Kenney Impact Sounds + "20 Sword Sound Effects" by StarNinjas', CC0, KEN + 'impact-sounds ; ' + OGA + '20-sword-sound-effects-attacks-and-clashes'),
    ('sfx-crit', sfx_crit, 'sfx', False, 0.95, 'Kenney Impact Sounds + "20 Sword Sound Effects" by StarNinjas', CC0, KEN + 'impact-sounds ; ' + OGA + '20-sword-sound-effects-attacks-and-clashes'),
    ('sfx-heal', sfx_heal, 'sfx', False, 0.7, '"Cure Magic" by Someoneman + synthesised bells (World of Crabcraft)', CC0, OGA + 'cure-magic'),
    ('sfx-cast', sfx_cast, 'sfx', False, 0.7, '"RPG Sound Pack" by artisticdude + synthesised sweep', CC0, OGA + 'rpg-sound-pack'),
    ('sfx-levelup', sfx_levelup, 'sfx', False, 0.85, 'Synthesised for World of Crabcraft', 'Apache-2.0', 'tools/art/audio_build.py (procedural)'),
    ('sfx-quest-accept', sfx_quest_accept, 'sfx', False, 0.7, 'Synthesised bells + Kenney RPG Audio', CC0, KEN + 'rpg-audio'),
    ('sfx-quest-complete', sfx_quest_complete, 'sfx', False, 0.8, 'Kenney Music Jingles + synthesised bells', CC0, KEN + 'music-jingles'),
    ('sfx-footstep-sand', lambda: sfx_footstep('Sand'), 'sfx', False, 0.35, '"Fantozzi\'s Footsteps" by Fantozzi, sliced by qubodup + Kenney RPG Audio', CC0, OGA + 'fantozzis-footsteps-grasssand-stone'),
    ('sfx-footstep-stone', lambda: sfx_footstep('Stone'), 'sfx', False, 0.35, '"Fantozzi\'s Footsteps" by Fantozzi, sliced by qubodup + Kenney RPG Audio', CC0, OGA + 'fantozzis-footsteps-grasssand-stone'),
    ('sfx-servo-whir', sfx_servo, 'sfx', False, 0.4, 'Synthesised servo + Kenney RPG Audio latch', CC0, KEN + 'rpg-audio'),
    ('sfx-beacon', sfx_beacon, 'sfx', False, 0.9, '"80 CC0 RPG SFX" by rubberduck + Kenney Sci-fi Sounds + synthesised chord', CC0, OGA + '80-cc0-rpg-sfx ; ' + KEN + 'sci-fi-sounds'),
    ('sfx-boss-roar', sfx_boss_roar, 'sfx', False, 1.0, '"CC0 Deep Monster Roar" by trazzz123 + Kenney Sci-fi and Impact Sounds', CC0, OGA + 'cc0-deep-monster-roar ; ' + KEN + 'sci-fi-sounds'),
    ('sfx-death', sfx_death, 'sfx', False, 0.8, '"Machine shutting down" by Cough-E + Kenney Impact Sounds', CC0, OGA + 'machine-shutting-down ; ' + KEN + 'impact-sounds'),
    ('sfx-error', sfx_error, 'sfx', False, 0.6, 'Kenney Interface Sounds', CC0, KEN + 'interface-sounds'),
    ('sfx-loot', sfx_loot, 'sfx', False, 0.7, 'Kenney RPG Audio', CC0, KEN + 'rpg-audio'),
]

idx_path = f'{OUT}/index.json'
index = {e['id']: e for e in json.load(open(idx_path))} if os.path.exists(idx_path) else {}
for id_, fn, kind, loop, vol, credit, lic, source in ENTRIES:
    if ONLY and id_ not in ONLY:
        continue
    x = fn().astype(np.float32)
    x, before = normalise(x, -18.0 if kind == 'music' else -14.0, kind)
    if kind == 'sfx':
        # Drop the inaudible end of reverb tails, then a short fade so nothing clicks.
        a = np.abs(x).max(axis=1)
        last = np.where(a > db(-54))[0]
        if len(last):
            x = x[: min(len(x), last[-1] + int(0.05 * SR))]; x = fade(x, 0, min(0.04, 0.2 * len(x) / SR))
    after = loudness_integrated(x) if kind == 'music' else loudness_max_momentary(x)
    so, sm = encode(x, id_)
    print(f'{id_:20s} {len(x) / SR:6.2f}s  in {before:6.1f} -> {after:6.1f} LUFS  peak {20 * np.log10(np.abs(x).max()):5.1f} dBFS  ogg {so / 1024:7.1f} KB  mp3 {sm / 1024:7.1f} KB', flush=True)
    index[id_] = {'id': id_, 'files': [f'{id_}.ogg', f'{id_}.mp3'], 'loop': loop, 'volume': vol, 'credit': credit, 'license': lic, 'source': source}
order = [e[0] for e in ENTRIES]
json.dump([index[k] for k in order if k in index], open(idx_path, 'w'), indent=2)
print('wrote', idx_path)
