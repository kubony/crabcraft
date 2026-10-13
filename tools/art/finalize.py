# Turn the chosen generations into the optimised files under public/art/.
# Usage: python finalize.py <generation dir> <repo public/art dir> [only-prefix ...]
# <generation dir>/gen/codex/ holds the GPT image outputs (<id>-<take>.png), gen/up/ the Gemini 2x detail passes.
# The file names below record which take was kept for each asset. Needs Pillow and numpy.
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageChops

S, OUT = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3:]
G = os.path.join(S, 'gen')
Q = 82


def src(path):
    return os.path.join(G, path)


def save(im, rel, quality=Q, alpha=False):
    if ONLY and not any(rel.startswith(o) for o in ONLY):
        return
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if alpha:
        im = im.convert('RGBA')
        im.save(p, 'WEBP', quality=quality, alpha_quality=90, method=6, exact=False)
    else:
        im = im.convert('RGB')
        im.save(p, 'WEBP', quality=quality, method=6)
    print(f'{rel:40s} {im.size[0]}x{im.size[1]} {os.path.getsize(p) / 1024:7.1f} KB')


def cover(im, w, h):
    """Scale to cover w x h and centre-crop."""
    r = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def trim_alpha(im, pad=0, thresh=8):
    a = np.array(im.getchannel('A'))
    ys, xs = np.where(a > thresh)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad))
    return im.crop(box)


def fit_canvas(im, w, h):
    """Scale RGBA to fit inside w x h, centred on a transparent canvas."""
    r = min(w / im.width, h / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    c.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2))
    return c


def sharpen(im, amount=60):
    return im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=amount, threshold=2))


# ---------- Wide paintings (2560x1440) ----------
WIDE = {
    'title-bg': ('up/title-bg-up-g.png', 'codex/title-bg-g.png'),
    'create-bg': ('up/create-bg-up2.png', 'codex/create-bg-c.png'),
    'loading-1': ('up/loading-1-up1.png', 'codex/loading-1-b.png'),
    'loading-2': ('up/loading-2-up1.png', 'codex/loading-2-b.png'),
    'ending': ('up/ending-up1.png', 'codex/ending-b.png'),
}
for k, (up, fallback) in WIDE.items():
    p = src(up) if os.path.exists(src(up)) else src(fallback)
    im = Image.open(p).convert('RGB')
    out = cover(im, 2560, 1440)
    if p.endswith(fallback):
        out = sharpen(out, 40)
    save(out, f'{k}.webp', quality=84)

# ---------- Logo (1600x700, transparent) ----------
logo = trim_alpha(Image.open(src('codex/logo-face-d.png')).convert('RGBA'), pad=4)
save(fit_canvas(logo, 1600, 700), 'logo.webp', quality=88, alpha=True)

# ---------- Portraits and NPCs (512) ----------
for race in ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren']:
    for sex in ['male', 'female']:
        tag = 'b' if race == 'orc' else 'a'
        im = Image.open(src(f'codex/portraits__{race}-{sex}-{tag}.png')).convert('RGB')
        save(sharpen(cover(im, 512, 512), 40), f'portraits/{race}-{sex}.webp')
for npc in ['brinebeard', 'silvermoon', 'coralline', 'grukk', 'hoofclaw', 'rattlebolt', 'pip']:
    im = Image.open(src(f'codex/npc__{npc}-b.png')).convert('RGB')
    save(sharpen(cover(im, 512, 512), 40), f'npc/{npc}.webp')


# ---------- Class emblems (256, round alpha) ----------
def medallion(path, size=256):
    im = Image.open(path).convert('RGB')
    a = np.array(im).astype(np.int32).sum(axis=2)
    ys, xs = np.where(a > 60)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) / 2
    box = (int(cx - r), int(cy - r), int(cx + r), int(cy + r))
    im = im.crop(box)
    ss = 4
    m = Image.new('L', (im.width * ss, im.height * ss), 0)
    ImageDraw.Draw(m).ellipse((ss * 2, ss * 2, im.width * ss - ss * 2, im.height * ss - ss * 2), fill=255)
    m = m.resize(im.size, Image.LANCZOS)
    im = im.convert('RGBA')
    im.putalpha(m)
    return sharpen(im.resize((size, size), Image.LANCZOS), 50)


for c in ['warrior', 'mage', 'priest']:
    save(medallion(src(f'codex/icons__class-{c}-a.png')), f'icons/class-{c}.webp', quality=86, alpha=True)

# ---------- Ability, item and quest icons (128) ----------
for c in ['warrior', 'mage', 'priest']:
    for s in range(1, 5):
        im = Image.open(src(f'codex/icons__ability-{c}-{s}-a.png')).convert('RGB')
        save(sharpen(cover(im, 128, 128), 70), f'icons/ability-{c}-{s}.webp', quality=86)
for k in ['item-rusted-cog', 'quest-moonwater', 'quest-scroll', 'quest-beacon', 'quest-boss']:
    im = Image.open(src(f'codex/icons__{k}-a.png')).convert('RGB')
    save(sharpen(cover(im, 128, 128), 70), f'icons/{k}.webp', quality=86)

# ---------- UI ----------
fs = Image.open(src('codex/ui__frame-stone-a.png')).convert('RGBA')
save(fs.resize((512, 512), Image.LANCZOS), 'ui/frame-stone.webp', quality=84, alpha=True)

# Plain slate from the inside of the frame, for panels that want a cover background without the border.
inner = fs.crop((int(fs.width * 0.16), int(fs.height * 0.16), int(fs.width * 0.84), int(fs.height * 0.84))).convert('RGB')
save(inner.resize((768, 768), Image.LANCZOS), 'ui/stone-fill.webp', quality=80)

cc = trim_alpha(Image.open(src('codex/ui__corner-claw-a.png')).convert('RGBA'), pad=2)
side = max(cc.size)
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.alpha_composite(cc, (0, 0))  # keep the ornament hugging the top-left corner
save(canvas.resize((256, 256), Image.LANCZOS), 'ui/corner-claw.webp', quality=88, alpha=True)

save(cover(Image.open(src('codex/ui__parchment-a.png')).convert('RGB'), 1024, 1024), 'ui/parchment.webp', quality=78)
save(cover(Image.open(src('codex/ui__tooltip-bg-a.png')).convert('RGB'), 512, 342), 'ui/tooltip-bg.webp', quality=82)
save(cover(Image.open(src('codex/ui__action-slot-a.png')).convert('RGB'), 128, 128), 'ui/action-slot.webp', quality=86)
save(fit_canvas(trim_alpha(Image.open(src('codex/ui__portrait-ring-a.png')).convert('RGBA')), 512, 512), 'ui/portrait-ring.webp', quality=86, alpha=True)

uf = trim_alpha(Image.open(src('codex/ui__unit-frame-a.png')).convert('RGBA'), pad=2)
save(uf.resize((768, round(uf.height * 768 / uf.width)), Image.LANCZOS), 'ui/unit-frame.webp', quality=86, alpha=True)

dv = trim_alpha(Image.open(src('codex/ui__divider-gold-a.png')).convert('RGBA'), pad=2)
save(dv.resize((1024, max(16, round(dv.height * 1024 / dv.width))), Image.LANCZOS), 'ui/divider-gold.webp', quality=88, alpha=True)


# Button: cut the lacquer plate out of its dark backdrop, then derive hover and pressed states.
def button_cut(path):
    im = Image.open(path).convert('RGB')
    a = np.array(im).astype(np.float32)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    fg = (lum > 70) | (sat > 45)
    ys, xs = np.where(fg)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    im = im.crop(box)
    a = np.array(im).astype(np.float32)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    # Soft key: fully opaque where clearly button, fading to transparent over the dark backdrop.
    alpha = np.clip(np.maximum((lum - 35) / 40, (sat - 25) / 35), 0, 1)
    # Fill interior holes: everything inside the horizontal span of each row is button.
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    rgba = im.convert('RGBA')
    rgba.putalpha(m.filter(ImageFilter.GaussianBlur(0.8)))
    return rgba


btn = button_cut(src('codex/ui__button-red-a.png'))
w = 512
btn = btn.resize((w, round(btn.height * w / btn.width)), Image.LANCZOS)
save(btn, 'ui/button-red.webp', quality=86, alpha=True)
hov = ImageEnhance.Color(ImageEnhance.Brightness(btn).enhance(1.18)).enhance(1.12)
hov.putalpha(btn.getchannel('A'))
save(hov, 'ui/button-red-hover.webp', quality=86, alpha=True)
pr = ImageEnhance.Brightness(btn).enhance(0.78)
pr = pr.transform(pr.size, Image.AFFINE, (1, 0, 0, 0, 1, -2), resample=Image.BICUBIC)
pr.putalpha(ImageChops.offset(btn.getchannel('A'), 0, 2))
save(pr, 'ui/button-red-pressed.webp', quality=86, alpha=True)


# ---------- Manifest for the gallery and preloaders ----------
files = []
for d, _, fs in os.walk(OUT):
    for f in sorted(fs):
        if not f.endswith('.webp'):
            continue
        p = os.path.join(d, f)
        im = Image.open(p)
        files.append({'file': os.path.relpath(p, OUT), 'width': im.width, 'height': im.height, 'bytes': os.path.getsize(p), 'alpha': im.mode == 'RGBA'})
files.sort(key=lambda e: e['file'])
json.dump(files, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print('manifest', len(files), 'files', round(sum(e['bytes'] for e in files) / 1048576, 2), 'MB')
