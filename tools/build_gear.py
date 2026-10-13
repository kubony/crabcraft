"""Procedural race gear, crests, class weapons, NPC extras and enemy armour for the crabs.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_gear.py -- \
        --jumper /path/to/jumper --out /tmp/gear
    (then tools/build_gear.sh compresses into public/models/gear/ and public/models/weapons/)

Every piece is modelled in the local frame of the URDF link it rides on (game axes, robot metres)
against the real shell geometry, and exported as one glTF node with extras:
    attach: link name     kind: always | crest | weapon | extra | enemy
    id: crest/weapon/extra id     top: highest point (for the nameplate)
Weapons are modelled in the claw socket frame instead: +Y along the jaw hinge (up at HOME), +Z out
of the jaw, origin in the middle of the grip.
"""
from __future__ import annotations

import argparse
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import gearlib as gl  # noqa: E402
from gearlib import box, cone, extrude2d, finish, lathe, piece, sphere, torus, tube  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--jumper", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--only", default="", help="comma list of files to build (human,orc,...,weapons,extras,enemies)")
args = ap.parse_args(argv)
OUT = Path(args.out)

bpy.ops.wm.read_factory_settings(use_empty=True)
R = gl.Robot(Path(args.jumper))
PI = math.pi
TOP = R.top(0, -0.01)  # shell top height at the centre (~0.072)
_palm = None


def palm_top(x, y):
    """Height (+Z, the top at HOME) of the LF palm's outer surface at (x, y) in the palm frame."""
    global _palm
    if _palm is None:
        o = R.link_ref("LF_palm_link")
        me = o.data
        _palm = gl.BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])
    hit = _palm.ray_cast(Vector((x, y, 0.2)), Vector((0, 0, -1)), 1.0)
    return hit[0].z if hit[0] is not None else 0.02


def palm_plate(name, x0, x1, y0, y1, material, lift=0.0015, thick=0.004, n=8):
    g = gl.grid(name, n, n, x0, x1, y0, y1, 0.0, material)
    for v in g.data.vertices:  # grid lies in XZ; remap to the palm's XY and drop onto its top
        x, y = v.co.x, v.co.z
        v.co = Vector((x, y, palm_top(x, y) + lift))
    gl.solidify(g, thick, offset=-1.0)
    return g


def on_top(x, z, lift=0.0):
    return R.top(x, z) + lift


def wrap_grid(name, x0, x1, z0, z1, material, lift=0.0025, nx=16, nz=12, thick=0.0018):
    """A cloth/plate patch lying on the shell top (vertices dropped onto the surface)."""
    g = gl.grid(name, nx, nz, x0, x1, z0, z1, 0.0, material)
    for v in g.data.vertices:
        v.co.y = R.top(v.co.x, v.co.z) + lift
    gl.solidify(g, thick, offset=1.0)
    return g


def conform(o, lift=0.0025):
    """Drape a flat decal onto the shell top: keep its thickness, follow the surface."""
    gl.apply_all(o)
    ys = [v.co.y for v in o.data.vertices]
    mid = (min(ys) + max(ys)) / 2
    for v in o.data.vertices:
        v.co.y = R.top(v.co.x, v.co.z) + lift + (v.co.y - mid)
    return o


def emblem_claw(name, size, material, depth=0.003):
    """Heraldic pincer in the XY plane: two crescent jaws curling up toward each other on a wrist."""
    objs = []
    base = crescent(1.0)  # a "C": opening toward +x
    rot = 0.55
    left = [(x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot)) for x, y in base]
    left = [(-0.36 * size + x * 0.58 * size, 0.22 * size + y * 0.58 * size) for x, y in left]
    right = [(-x, y) for x, y in reversed(left)]
    objs.append(extrude2d(f"{name}_jawl", left, depth, material))
    objs.append(extrude2d(f"{name}_jawr", right, depth, material))
    objs.append(extrude2d(f"{name}_wrist", [(-0.16 * size, -0.85 * size), (0.16 * size, -0.85 * size), (0.24 * size, -0.3 * size), (-0.24 * size, -0.3 * size)], depth, material))
    return objs


def horn(name, base, dirs, length, r0, material, curl=0.6, up=0.8, seg=7, flat=1.0):
    """Curved tapering horn from base, heading along dirs (x out, y up, z fwd)."""
    pts = []
    d = Vector(dirs).normalized()
    p = Vector(base)
    for i in range(seg):
        t = i / (seg - 1)
        pts.append(p.copy())
        step = length / (seg - 1)
        bend = Vector((0, up * t, -curl * t * 0.5))
        p = p + (d + bend).normalized() * step
    radii = [r0 * (1 - 0.88 * (i / (seg - 1)) ** 0.9) for i in range(seg)]
    return tube(name, [tuple(q) for q in pts], radii, material, flat=flat)


def leaf_shape(length, width, n=10):
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((math.sin(PI * t) * width * (1 - 0.3 * t), t * length))
    for i in range(n - 1, 0, -1):
        t = i / n
        pts.append((-math.sin(PI * t) * width * (1 - 0.3 * t), t * length))
    return pts


def crescent(r, thick=0.0, n=18):
    """Crescent moon opening to +x: outer circle r minus an inner circle 0.93r shifted by 0.32r."""
    r2, d = 0.93, 0.32
    xi = (1 - r2 * r2 + d * d) / (2 * d)
    yi = math.sqrt(max(0.0, 1 - xi * xi))
    a0 = math.atan2(yi, xi)
    b0 = math.atan2(yi, xi - d)
    outer = [(math.cos(a) * r, math.sin(a) * r) for a in [a0 + (2 * PI - 2 * a0) * i / n for i in range(n + 1)]]
    inner = [((d + math.cos(b) * r2) * r, math.sin(b) * r2 * r) for b in [(2 * PI - b0) - (2 * PI - 2 * b0) * i / n for i in range(1, n)]]
    return outer + inner


def ring_on_shell(name, rx, rz, cz, lift, r, material, seg=48):
    """Rounded-rectangle hoop lying on the shell top, `lift` above the surface."""
    pts = []
    for i in range(seg):
        a = 2 * PI * i / seg
        c, s = math.cos(a), math.sin(a)
        # superellipse for a rounded-rect footprint
        x = rx * math.copysign(abs(c) ** 0.6, c)
        z = cz + rz * math.copysign(abs(s) ** 0.6, s)
        pts.append((x, R.top(x, z) + lift, z))
    return tube(name, pts, r, material, closed=True, res=2)


def dome(name, rx, rz, h, y0, material, cz=0.0, seg=28):
    prof = [(1.0, 0.0), (0.98, 0.25), (0.9, 0.5), (0.72, 0.75), (0.45, 0.92), (0.0, 1.0)]
    o = lathe(name, [(r, y * h) for r, y in prof], material, seg=seg)
    o.scale = (rx, 1, rz)
    o.location = (0, y0, cz)
    return o


def rivets(name, pts, r, material):
    objs = []
    for i, p in enumerate(pts):
        objs.append(sphere(f"{name}{i}", r, material, loc=p, scale=(1, 0.6, 1), seg=10, rings=6))
    return objs


def shell_edge_points(n, inset=0.012, lift=0.001, zmin=-0.1, zmax=0.06):
    """Points along the shell's top edge (where the top flattens out), for rivets/chains."""
    pts = []
    for i in range(n):
        a = 2 * PI * i / n
        c, s = math.cos(a), math.sin(a)
        x = (0.088 - inset) * math.copysign(abs(c) ** 0.55, c)
        z = -0.009 + (0.097 - inset) * math.copysign(abs(s) ** 0.55, s)
        if zmin <= z <= zmax:
            pts.append((x, R.top(x, z) + lift, z))
    return pts


built: dict[str, list] = {}


def done(objs, **kw):
    return [finish(o, **kw) for o in objs]


# ============================================================================================
# HUMAN
# ============================================================================================
def human():
    roots = []
    # Tabard: saddle cloth on the rear of the shell + a hanging back flap with gold trim and claw.
    saddle = wrap_grid("tabard_saddle", -0.074, 0.074, -0.104, -0.02, "cloth-tint", lift=0.002)
    zr = -0.104
    yt = R.top(0, zr) + 0.002
    flap = gl.grid("tabard_flap", 10, 8, -0.052, 0.052, 0, 1, 0, "cloth-tint")
    for v in flap.data.vertices:
        t = v.co.z  # 0 top .. 1 bottom
        x = v.co.x * (1 - 0.15 * t)
        point = 0.018 * (1 - abs(x) / 0.052) * (t > 0.99)
        v.co = Vector((x, yt - t * 0.072 - point, zr - 0.012 - 0.01 * t + 0.002 * math.sin(x * 120)))
    gl.solidify(flap, 0.0018, offset=1.0)
    trim_pts = [(-0.052, yt, zr - 0.013), (-0.044, yt - 0.072, zr - 0.022), (0.0, yt - 0.09, zr - 0.023), (0.044, yt - 0.072, zr - 0.022), (0.052, yt, zr - 0.013)]
    trim = tube("tabard_trim", trim_pts, 0.0016, "gold", res=6)
    crest = emblem_claw("tabard_crest", 0.022, "gold")
    for o in crest:
        o.rotation_euler = (0, PI, 0)
        o.location = (0, yt - 0.04, zr - 0.026)
    hem = tube("tabard_hem", [(-0.074, R.top(-0.074, -0.03) + 0.003, -0.03), (0, R.top(0, -0.03) + 0.004, -0.03), (0.074, R.top(0.074, -0.03) + 0.003, -0.03)], 0.0018, "gold")
    roots.append(piece("human_tabard", done([saddle, flap, trim, hem] + crest), "base_link", "always"))

    # knight-helm: steel dome, crest ridge, cheek guards, tall red plume.
    helm = dome("helm_dome", 0.05, 0.055, 0.032, TOP - 0.004, "steel", cz=-0.01)
    gl.subdivide(helm, 1)
    ridge = tube("helm_ridge", [(0, TOP + 0.024, 0.04), (0, TOP + 0.031, 0.0), (0, TOP + 0.028, -0.045)], 0.004, "gold")
    band = ring_on_shell("helm_band", 0.05, 0.055, -0.01, -0.001, 0.0035, "gold")
    # Brush crest running front to back along the helm ridge (reads as a knight from any side).
    plume = tube("helm_plume", [(0, TOP + 0.03, 0.04), (0, TOP + 0.06, 0.008), (0, TOP + 0.072, -0.04), (0, TOP + 0.064, -0.088), (0, TOP + 0.042, -0.125)], [0.012, 0.024, 0.026, 0.019, 0.006], "feather-red")
    plume.scale = (0.32, 1, 1)
    plume2 = sphere("helm_plume_socket", 0.008, "gold", loc=(0, TOP + 0.03, 0.036))
    roots.append(piece("crest_knight-helm", done([helm, ridge, band, plume, plume2]), "base_link", "crest", {"id": "knight-helm", "race": "human"}))

    # cape: red cloak from the shoulders over the back, gold clasps.
    cape = gl.grid("cape_cloth", 14, 16, -1, 1, 0, 1, 0, "cloth-red")
    for v in cape.data.vertices:
        u, t = v.co.x, v.co.z  # u across, t along (0 shoulders .. 1 hem)
        if t < 0.5:
            z = -0.03 - 0.075 * (t / 0.5)
            x = u * 0.078
            y = R.top(max(-0.074, min(0.074, x)), z) + 0.007
        else:
            k = (t - 0.5) / 0.5
            z = -0.108 - 0.03 * k
            x = u * (0.078 + 0.02 * k)
            y = R.top(max(-0.074, min(0.074, x)), -0.105) + 0.007 - 0.085 * k
            z += 0.004 * math.sin(u * 7 + k * 2)
        v.co = Vector((x, y, z))
    gl.solidify(cape, 0.002, offset=1.0)
    clasps = [sphere("cape_clasp_l", 0.008, "gold", loc=(0.07, R.top(0.07, -0.032) + 0.01, -0.032)), sphere("cape_clasp_r", 0.008, "gold", loc=(-0.07, R.top(-0.07, -0.032) + 0.01, -0.032))]
    clasps.append(tube("cape_chain", [(-0.07, R.top(-0.07, -0.03) + 0.01, -0.03), (0, R.top(0, -0.02) + 0.012, -0.02), (0.07, R.top(0.07, -0.03) + 0.01, -0.03)], 0.002, "gold"))
    roots.append(piece("crest_cape", done([cape] + clasps), "base_link", "crest", {"id": "cape", "race": "human"}))

    # circlet: gold hoop around the top with small points and a front sapphire.
    hoop = ring_on_shell("circlet_hoop", 0.068, 0.078, -0.01, 0.003, 0.0032, "gold")
    points = []
    for i, x in enumerate([-0.05, -0.025, 0.025, 0.05]):
        points.append(cone(f"circlet_pt{i}", 0.006, 0.0, 0.016, "gold", loc=(x, R.top(x, 0.06) + 0.002, 0.062), seg=4))
    gem = sphere("circlet_gem", 0.009, "glow-gem", loc=(0, R.top(0, 0.068) + 0.01, 0.068), scale=(1, 1.3, 0.7))
    setting = cone("circlet_setting", 0.012, 0.004, 0.022, "gold", loc=(0, R.top(0, 0.066) - 0.002, 0.066), seg=6)
    roots.append(piece("crest_circlet", done([hoop, setting, gem] + points), "base_link", "crest", {"id": "circlet", "race": "human"}))

    # leather-cap: soft brown cap with stitched seam and a short brim.
    cap = gl.grid("cap_dome", 18, 18, -0.064, 0.064, -0.085, 0.06, 0.0, "leather")
    keep = []
    import bmesh as _bm
    for v in cap.data.vertices:
        ex = (v.co.x / 0.064) ** 2 + ((v.co.z + 0.012) / 0.073) ** 2
        bulge = max(0.0, 1 - ex) ** 0.6
        v.co.y = R.top(v.co.x, v.co.z) + 0.003 + 0.012 * bulge
    bm = _bm.new()
    bm.from_mesh(cap.data)
    dead = [f for f in bm.faces if ((f.calc_center_median().x / 0.064) ** 2 + ((f.calc_center_median().z + 0.012) / 0.073) ** 2) > 1.0]
    _bm.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(cap.data)
    bm.free()
    gl.solidify(cap, 0.002, offset=1.0)
    rim = []
    pts = []
    for i in range(40):
        a_ = 2 * PI * i / 40
        x, z = 0.062 * math.cos(a_), -0.012 + 0.071 * math.sin(a_)
        pts.append((x, R.top(x, z) + 0.004, z))
    rim.append(tube("cap_rim", pts, 0.004, "leather-dark", closed=True, res=2))
    seam = tube("cap_seam", [(0, R.top(0, 0.055) + 0.008, 0.055), (0, TOP + 0.016, -0.01), (0, R.top(0, -0.078) + 0.008, -0.078)], 0.0016, "leather-dark")
    button = sphere("cap_button", 0.006, "leather-dark", loc=(0, TOP + 0.016, -0.012), scale=(1, 0.6, 1))
    brim = box("cap_brim", (0.08, 0.004, 0.028), "leather", loc=(0, R.top(0, 0.065) + 0.004, 0.075), rot=(0.25, 0, 0), bevel=0.0015)
    cap_objs = [cap, seam, button, brim] + rim
    roots.append(piece("crest_leather-cap", done(cap_objs), "base_link", "crest", {"id": "leather-cap", "race": "human"}))
    return roots


# ============================================================================================
# ORC
# ============================================================================================
def orc():
    roots = []
    # Tusk guards on both pincers (palm link frames; LF built, RF mirrored).
    def tusks(side):
        objs = []
        t1 = tube(f"tusk_{side}_a", [(0.03, 0.0, 0.024), (0.08, 0.004, 0.032), (0.125, 0.012, 0.05), (0.15, 0.03, 0.075)], [0.0085, 0.007, 0.0045, 0.0012], "bone")
        t2 = tube(f"tusk_{side}_b", [(0.035, 0.016, 0.018), (0.075, 0.03, 0.024), (0.105, 0.048, 0.036), (0.118, 0.066, 0.05)], [0.0065, 0.0055, 0.0035, 0.001], "bone")
        strap = torus(f"tusk_{side}_strap", 0.027, 0.0035, "leather-dark", loc=(0.04, -0.002, 0.0), rot=(0, 0, PI / 2), scale=(1, 1, 0.95))
        studs = [sphere(f"tusk_{side}_stud{i}", 0.0035, "iron", loc=(0.04, -0.002 + 0.027 * math.cos(a), 0.027 * math.sin(a))) for i, a in enumerate([0.6, 1.57, 2.5])]
        objs += [t1, t2, strap] + studs
        return objs

    lf = done(tusks("l"))
    roots.append(piece("orc_tusks_l", lf, "LF_palm_link", "always"))
    rf = done([gl.mirror_x(o, o.name.replace("_l", "_r")) for o in tusks("rr")])
    roots.append(piece("orc_tusks_r", rf, "RF_palm_link", "always"))

    # Spiked leather pauldrons on the front shoulders of the shell.
    paul = []
    for sx in (1, -1):
        x = 0.08 * sx
        zc = 0.012
        y = R.top(0.074 * sx, zc)
        plate = dome(f"paul_{sx}", 0.04, 0.04, 0.02, 0.0, "leather", cz=0.0)
        plate.location = (x, y - 0.014, zc)
        plate.rotation_euler = (0.0, 0, -0.85 * sx)
        trim = torus(f"paul_trim_{sx}", 0.039, 0.0035, "iron", loc=(x, y - 0.013, zc), rot=(0, 0, -0.85 * sx))
        spikes = []
        for i, (dx, dz) in enumerate([(0.006, 0.0), (0.016, 0.017), (0.016, -0.017)]):
            px = x + dx * sx
            spikes.append(cone(f"paul_spike_{sx}{i}", 0.0075, 0.0, 0.034 - 0.008 * (i > 0), "iron", loc=(px, y + 0.002, zc + dz), rot=(0, 0, -1.0 * sx), seg=8))
        paul += [plate, trim] + spikes
    # War paint: three stripes on each side of the shell top.
    paint = []
    for sx in (1, -1):
        for k in range(3):
            z0 = 0.05 - k * 0.026
            g = gl.grid(f"war_{sx}_{k}", 10, 1, 0, 1, 0, 1, 0, "paint-war" if k == 1 else "paint-black")
            for v in g.data.vertices:
                t = v.co.x
                w = 0.011 * (1 - 0.55 * t) * (1 if v.co.z > 0.5 else -1)
                x = sx * (0.022 + 0.06 * t)
                z = z0 - 0.022 * t + w
                v.co = Vector((x, R.top(x, z) + 0.0016, z))
            gl.solidify(g, 0.0014, offset=1.0)
            paint.append(g)
    roots.append(piece("orc_gear", done(paul + paint), "base_link", "always"))

    # Crests.
    knot_base = cone("topknot_base", 0.016, 0.012, 0.012, "hair-black", loc=(0, TOP - 0.002, -0.03), seg=12)
    knot = tube("topknot_spike", [(0, TOP + 0.008, -0.03), (0, TOP + 0.045, -0.038), (0, TOP + 0.085, -0.06), (0, TOP + 0.1, -0.1)], [0.012, 0.009, 0.005, 0.001], "hair-black")
    knot_band = torus("topknot_band", 0.0105, 0.003, "gold", loc=(0, TOP + 0.022, -0.033))
    roots.append(piece("crest_topknot", done([knot_base, knot, knot_band]), "base_link", "crest", {"id": "topknot", "race": "orc"}))

    skull = dome("skullcap_dome", 0.045, 0.05, 0.026, TOP - 0.004, "bone", cz=0.0)
    gl.subdivide(skull, 1)
    horns = [horn(f"skullcap_horn{sx}", (0.035 * sx, TOP + 0.01, 0.01), (sx, 0.5, 0.35), 0.075, 0.0085, "horn", curl=-0.8, up=1.0) for sx in (1, -1)]
    sockets = [sphere(f"skullcap_eye{sx}", 0.008, "crack", loc=(0.016 * sx, TOP + 0.012, 0.042), scale=(1, 0.8, 0.5)) for sx in (1, -1)]
    roots.append(piece("crest_skull-cap", done([skull] + horns + sockets), "base_link", "crest", {"id": "skull-cap", "race": "orc"}))

    mohawk = []
    for i in range(6):
        z = 0.05 - i * 0.026
        h = 0.04 - abs(i - 2) * 0.006
        mohawk.append(cone(f"mohawk_{i}", 0.008, 0.0, h, "bone", loc=(0, R.top(0, z) - 0.002, z), rot=(-0.35, 0, 0), seg=6))
    strip = tube("mohawk_strap", [(0, R.top(0, z) + 0.002, z) for z in (0.065, 0.02, -0.03, -0.09)], 0.0035, "leather-dark")
    roots.append(piece("crest_bone-mohawk", done(mohawk + [strip]), "base_link", "crest", {"id": "bone-mohawk", "race": "orc"}))

    band = ring_on_shell("ironband_ring", 0.07, 0.08, -0.01, -0.002, 0.006, "iron")
    plate = box("ironband_plate", (0.04, 0.022, 0.006), "iron", loc=(0, TOP + 0.002, 0.072), rot=(-0.2, 0, 0), bevel=0.002)
    rv = rivets("ironband_rivet", [(x, TOP + 0.006, 0.0765) for x in (-0.013, 0.0, 0.013)], 0.003, "brass")
    roots.append(piece("crest_iron-band", done([band, plate] + rv), "base_link", "crest", {"id": "iron-band", "race": "orc"}))
    return roots


# ============================================================================================
# DWARF
# ============================================================================================
def braid(name, start, length, r, material, sway=0.0, fwd=0.012, n=9):
    objs = []
    p = Vector(start)
    for i in range(n):
        t = i / (n - 1)
        rr = r * (1 - 0.35 * t)
        q = p + Vector((sway * math.sin(t * PI), -length * t, fwd * math.sin(t * PI * 0.8)))
        objs.append(sphere(f"{name}_{i}", rr, material, loc=tuple(q), scale=(1, 1.35, 0.85), rot=(0, 0, 0.35 * (1 if i % 2 else -1)), seg=10, rings=7))
    end = p + Vector((sway * 0, -length - r * 0.9, fwd * math.sin(PI * 0.8)))
    objs.append(cone(f"{name}_clasp", r * 0.75, r * 0.55, r * 1.6, "gold", loc=tuple(end), seg=8))
    return objs


def dwarf():
    roots = []
    beard = []
    yb = 0.03
    zb = 0.094
    must = tube("beard_moustache", [(-0.058, yb - 0.012, zb - 0.004), (-0.03, yb + 0.002, zb + 0.006), (0, yb, zb + 0.008), (0.03, yb + 0.002, zb + 0.006), (0.058, yb - 0.012, zb - 0.004)], [0.005, 0.012, 0.011, 0.012, 0.005], "copper")
    beard.append(must)
    beard += braid("beard_c", (0, yb - 0.004, zb + 0.008), 0.066, 0.0125, "copper", fwd=0.018)
    beard += braid("beard_l", (0.022, yb - 0.002, zb + 0.005), 0.056, 0.011, "copper", sway=0.005, fwd=0.012)
    beard += braid("beard_r", (-0.022, yb - 0.002, zb + 0.005), 0.056, 0.011, "copper", sway=-0.005, fwd=0.012)
    beard += braid("beard_ll", (0.042, yb - 0.001, zb), 0.04, 0.009, "copper", sway=0.008, fwd=0.006)
    beard += braid("beard_rr", (-0.042, yb - 0.001, zb), 0.04, 0.009, "copper", sway=-0.008, fwd=0.006)
    pts = shell_edge_points(40, inset=0.008, lift=0.0, zmin=-0.11, zmax=0.07)
    rv = rivets("rivet", pts, 0.0032, "brass")
    roots.append(piece("dwarf_gear", done(beard + rv), "base_link", "always"))

    def helm_base(prefix, mat="iron"):
        d = dome(f"{prefix}_dome", 0.055, 0.06, 0.03, TOP - 0.004, mat, cz=-0.008)
        gl.subdivide(d, 1)
        rim = ring_on_shell(f"{prefix}_rim", 0.055, 0.06, -0.008, -0.001, 0.0045, "brass")
        crest = tube(f"{prefix}_ridge", [(0, TOP + 0.02, 0.05), (0, TOP + 0.03, 0.0), (0, TOP + 0.022, -0.06)], 0.004, "brass")
        rvs = rivets(f"{prefix}_rv", [(0.05 * math.cos(a), TOP + 0.004, -0.008 + 0.055 * math.sin(a)) for a in [i * PI / 4 for i in range(8)]], 0.0028, "brass")
        return [d, rim, crest] + rvs

    hh = helm_base("hornhelm")
    hh += [horn(f"hornhelm_h{sx}", (0.045 * sx, TOP + 0.012, -0.005), (sx, 0.1, 0.05), 0.085, 0.011, "horn", curl=-0.4, up=1.6) for sx in (1, -1)]
    roots.append(piece("crest_horned-helm", done(hh), "base_link", "crest", {"id": "horned-helm", "race": "dwarf"}))

    wh = helm_base("winghelm", "steel")
    for sx in (1, -1):
        feathers = []
        for k in range(4):
            pts = [(0.0, 0.0), (0.006, 0.0), (0.012 + k * 0.004, 0.05 - k * 0.008), (0.002 + k * 0.004, 0.05 - k * 0.008)]
            f = extrude2d(f"wing{sx}_{k}", pts, 0.003, "silver")
            f.rotation_euler = (0, 0, -0.25 * sx - k * 0.22 * sx)
            f.location = (0.052 * sx, TOP + 0.01, -0.01 - k * 0.006)
            f.scale = (sx, 1, 1)
            feathers.append(f)
        wh += feathers
    roots.append(piece("crest_winged-helm", done(wh), "base_link", "crest", {"id": "winged-helm", "race": "dwarf"}))

    mh = helm_base("minerhelm", "brass")
    lamp = cone("miner_lamp", 0.014, 0.016, 0.02, "iron", loc=(0, TOP + 0.014, 0.05), rot=(PI / 2 - 0.15, 0, 0), seg=16)
    lens = sphere("miner_lens", 0.012, "glow-warm", loc=(0, TOP + 0.0175, 0.07), scale=(1, 1, 0.45))
    strap = ring_on_shell("miner_strap", 0.062, 0.07, -0.008, -0.002, 0.004, "leather-dark")
    mh += [lamp, lens, strap]
    roots.append(piece("crest_miner-lamp", done(mh), "base_link", "crest", {"id": "miner-lamp", "race": "dwarf", "light": "0,0.088,0.075"}))

    br = []
    for sx in (1, -1):
        root = (0.06 * sx, R.top(0.06 * sx, 0.0) + 0.002, 0.0)
        br += braid(f"sidebraid{sx}", root, 0.07, 0.0085, "copper", sway=0.035 * sx, fwd=-0.01, n=10)
        br.append(sphere(f"sidebraid_knot{sx}", 0.011, "copper", loc=root, scale=(1, 0.7, 1)))
    top_knot = tube("braids_top", [(0.06, TOP + 0.002, 0.0), (0.0, TOP + 0.008, 0.01), (-0.06, TOP + 0.002, 0.0)], 0.006, "copper")
    roots.append(piece("crest_braids", done(br + [top_knot]), "base_link", "crest", {"id": "braids", "race": "dwarf"}))
    return roots


# ============================================================================================
# UNDEAD
# ============================================================================================
def crack_strip(name, pts, width):
    g = gl.grid(name, len(pts) - 1, 1, 0, 1, 0, 1, 0, "crack")
    for v in g.data.vertices:
        i = round(v.co.x * (len(pts) - 1))
        x, z = pts[i]
        w = width * (1 - 0.7 * abs(i / (len(pts) - 1) - 0.4)) * (1 if v.co.z > 0.5 else -1)
        v.co = Vector((x + w * 0.7, R.top(x, z) + 0.0014, z + w))
    gl.solidify(g, 0.0014, offset=1.0)
    return g


def undead():
    roots = []
    rng = random.Random(4)
    cracks = []
    for k, (x0, z0, dx, dz) in enumerate([(0.02, 0.04, 0.012, -0.012), (-0.03, -0.02, -0.01, -0.013), (0.05, -0.06, 0.009, 0.01)]):
        pts = [(x0, z0)]
        for i in range(6):
            x, z = pts[-1]
            pts.append((x + dx + rng.uniform(-0.008, 0.008), z + dz + rng.uniform(-0.008, 0.008)))
        cracks.append(crack_strip(f"crack{k}", pts, 0.006))
        glow_pts = [(x, R.top(x, z) + 0.0028, z) for x, z in pts[1:5]]
        cracks.append(tube(f"crackglow{k}", glow_pts, 0.0012, "glow-green"))
    # exposed wiring loops from a hole on the left rear
    hole = sphere("wire_hole", 0.016, "crack", loc=(0.06, R.top(0.06, -0.06) - 0.004, -0.06), scale=(1, 0.35, 1.2))
    wires = []
    for i, (m, off) in enumerate([("wire-red", 0.0), ("wire-yellow", 0.006), ("wire-blue", -0.006)]):
        y0 = R.top(0.06, -0.06)
        wires.append(tube(f"wire{i}", [(0.055 + off, y0, -0.055), (0.075 + off, y0 + 0.02, -0.06 + off), (0.095, y0 + 0.004, -0.07 + off), (0.093, y0 - 0.025, -0.075)], 0.0018, m))
    servo = box("servo_box", (0.022, 0.016, 0.03), "servo", loc=(-0.045, R.top(-0.045, -0.075) + 0.004, -0.075), rot=(0.2, 0.3, 0.1), bevel=0.002)
    horn_ = cone("servo_horn", 0.006, 0.006, 0.006, "steel", loc=(-0.045, R.top(-0.045, -0.075) + 0.012, -0.068), seg=10)
    roots.append(piece("undead_gear", done(cracks + [hole, servo, horn_] + wires), "base_link", "always"))

    # The stripped rear-left leg: bare brackets, servo cans and wires (hip and calf frames).
    hip = []
    hip.append(cone("lr_hip_servo", 0.0105, 0.0105, 0.034, "servo", loc=(0, -0.016, 0), seg=16))
    for sz in (1, -1):
        hip.append(box(f"lr_hip_plate{sz}", (0.06, 0.012, 0.003), "metal" if False else "steel", loc=(0.03, -0.016, 0.011 * sz), rot=(0, 0, -0.42), bevel=0.0008))
    hip.append(tube("lr_hip_wire", [(0.0, -0.005, 0.006), (0.03, -0.004, 0.016), (0.05, -0.02, 0.012)], 0.0015, "wire-red"))
    roots.append(piece("undead_leg_hip", done(hip), "LR_hip_link", "always"))
    calf = [cone("lr_calf_servo", 0.0115, 0.0115, 0.036, "servo", loc=(0, 0, -0.018), rot=(PI / 2, 0, 0), seg=16)]
    for sz in (1, -1):
        calf.append(tube(f"lr_calf_rod{sz}", [(0.008, 0.0, 0.008 * sz), (0.06, 0.004, 0.006 * sz), (0.114, 0.006, 0.003 * sz)], 0.0025, "steel"))
    for k, x in enumerate((0.04, 0.08)):
        calf.append(box(f"lr_calf_brace{k}", (0.004, 0.006, 0.018), "steel", loc=(x, 0.003, 0), bevel=0.0006))
    calf.append(tube("lr_calf_wire", [(0.01, 0.01, 0.0), (0.05, 0.016, 0.004), (0.09, 0.012, -0.002), (0.112, 0.008, 0.0)], 0.0014, "wire-yellow"))
    roots.append(piece("undead_leg_calf", done(calf), "LR_calf_link", "always"))

    # Crests.
    hood = wrap_grid("hood_cloth", -0.088, 0.088, -0.1, 0.05, "cloth-dark", lift=0.004, nx=18, nz=14, thick=0.0022)
    for v in hood.data.vertices:
        if v.co.z > 0.045:
            v.co.y += 0.006
            v.co.z += 0.022 * (1 - (abs(v.co.x) / 0.088) ** 2)
        # peak at the back, ragged edges
        pz = (0.05 - v.co.z) / 0.15
        v.co.y += 0.016 * math.exp(-((v.co.x) ** 2) / 0.0012) * pz
        edge = max(abs(v.co.x) / 0.088, 0)
        rag = 0.5 + 0.5 * math.sin(v.co.z * 173 + v.co.x * 61) * math.sin(v.co.z * 97 + 1.3)
        if edge > 0.97:
            v.co.y -= 0.016 + 0.014 * rag
            v.co.x *= 1.04
        if v.co.z < -0.097:
            rag = 0.5 + 0.5 * math.sin(v.co.x * 211 + 0.7) * math.sin(v.co.x * 83)
            v.co.y -= 0.026 + 0.016 * rag
            v.co.z -= 0.008
    # Floppy cowl point drooping backwards (a hood, not a fin).
    tip = tube("hood_tip", [(0, TOP + 0.006, -0.01), (0, TOP + 0.036, -0.045), (0, TOP + 0.052, -0.085), (0.004, TOP + 0.04, -0.12), (0.01, TOP + 0.012, -0.14)], [0.04, 0.03, 0.018, 0.009, 0.002], "cloth-dark")
    tip.scale = (1.0, 0.85, 1)
    roots.append(piece("crest_hood", done([hood, tip], smooth_angle=60), "base_link", "crest", {"id": "hood", "race": "undead"}))

    ch = dome("crackedhelm_dome", 0.055, 0.06, 0.03, TOP - 0.004, "rust", cz=-0.008)
    gl.subdivide(ch, 1)
    cpts = [(0.01, TOP + 0.03, 0.03), (0.018, TOP + 0.028, 0.015), (0.008, TOP + 0.03, 0.0), (0.022, TOP + 0.026, -0.02), (0.03, TOP + 0.02, -0.04)]
    hcrack = tube("crackedhelm_crack", cpts, 0.0025, "crack")
    spike = cone("crackedhelm_spike", 0.008, 0.0, 0.025, "rust", loc=(0, TOP + 0.022, -0.01), seg=6)
    roots.append(piece("crest_cracked-helm", done([ch, hcrack, spike]), "base_link", "crest", {"id": "cracked-helm", "race": "undead"}))

    sp = dome("skullplate_dome", 0.042, 0.05, 0.028, TOP - 0.003, "bone", cz=0.0)
    gl.subdivide(sp, 1)
    eyes = [sphere(f"skullplate_eye{sx}", 0.009, "crack", loc=(0.016 * sx, TOP + 0.014, 0.036), scale=(1, 0.9, 0.5)) for sx in (1, -1)]
    glow = [sphere(f"skullplate_glow{sx}", 0.003, "glow-green", loc=(0.016 * sx, TOP + 0.014, 0.04)) for sx in (1, -1)]
    nose = cone("skullplate_nose", 0.005, 0.0, 0.008, "crack", loc=(0, TOP + 0.004, 0.045), rot=(PI, 0, 0), seg=3)
    srv = rivets("skullplate_rv", [(0.038 * math.cos(a), TOP + 0.002, 0.046 * math.sin(a)) for a in [i * PI / 3 + 0.5 for i in range(6)]], 0.003, "rust")
    roots.append(piece("crest_skull-plate", done([sp, nose] + eyes + glow + srv), "base_link", "crest", {"id": "skull-plate", "race": "undead"}))

    pole = tube("lantern_pole", [(0.0, TOP - 0.004, -0.085), (0.0, TOP + 0.06, -0.095), (0.0, TOP + 0.1, -0.085), (0.0, TOP + 0.108, -0.06)], 0.003, "iron")
    chain = tube("lantern_chain", [(0.0, TOP + 0.106, -0.058), (0.0, TOP + 0.09, -0.058)], 0.0012, "iron")
    cage = lathe("lantern_cage", [(0.004, 0.0), (0.012, 0.004), (0.013, 0.02), (0.008, 0.026), (0.002, 0.03)], "iron", seg=6, loc=(0, TOP + 0.06, -0.058))
    flame = sphere("lantern_flame", 0.008, "glow-green", loc=(0, TOP + 0.072, -0.058), scale=(1, 1.3, 1))
    roots.append(piece("crest_lantern", done([pole, chain, cage, flame]), "base_link", "crest", {"id": "lantern", "race": "undead", "light": "0,0.145,-0.058"}))
    return roots


# ============================================================================================
# NIGHT ELF
# ============================================================================================
def nightelf():
    roots = []
    ears = []
    for sx in (1, -1):
        pts = [(0.056 * sx, 0.052, 0.082), (0.09 * sx, 0.07, 0.05), (0.13 * sx, 0.1, -0.01), (0.16 * sx, 0.135, -0.08), (0.172 * sx, 0.158, -0.13)]
        e = tube(f"ear{sx}", [(x, y / 0.45, z) for x, y, z in pts], [0.012, 0.014, 0.011, 0.006, 0.0012], "elf-ear")
        e.scale = (1, 0.45, 1)
        ears.append(e)
        ears.append(torus(f"ear_ring{sx}", 0.008, 0.0022, "silver", loc=(0.1 * sx, 0.072, 0.04), rot=(0, 0.6 * sx, PI / 2)))
    moons = []
    for sx in (1, -1):
        c = extrude2d(f"moon{sx}", crescent(0.019, 0.0), 0.0014, "paint-moon")
        c.rotation_euler = (-PI / 2, 0, -0.5 * sx)
        c.rotation_mode = "ZXY"
        x, z = 0.042 * sx, -0.06
        c.location = (x, R.top(x, z) + 0.003, z)
        c.scale = (sx, 1, 1)
        moons.append(conform(c, 0.0022))
    pauld = []
    for sx in (1, -1):
        for k in range(3):
            lf = extrude2d(f"leafp{sx}{k}", leaf_shape(0.05, 0.016), 0.003, "leaf-silver" if k == 1 else "leaf")
            lf.rotation_euler = (-1.1, 0.3 * sx, (-1.35 - 0.3 * k) * sx)
            lf.location = (0.07 * sx, R.top(0.07 * sx, 0.035) + 0.002, 0.04 - k * 0.012)
            pauld.append(lf)
    roots.append(piece("nightelf_gear", done(ears + moons + pauld), "base_link", "always"))

    leaves = []
    n = 12
    for i in range(n):
        a = 2 * PI * i / n
        x = 0.06 * math.cos(a)
        z = -0.01 + 0.07 * math.sin(a)
        lf = extrude2d(f"circlet_leaf{i}", leaf_shape(0.03, 0.009), 0.0025, "leaf")
        lf.location = (x, R.top(x, z) + 0.002, z)
        lf.rotation_euler = (0.0, -a + PI / 2, 0)
        lf.rotation_mode = "YXZ"
        lf.rotation_euler = (-0.5 * math.sin(a), -a + PI / 2, 0.5 * math.cos(a))
        leaves.append(lf)
    vine = ring_on_shell("circlet_vine", 0.062, 0.072, -0.01, 0.002, 0.0025, "wood")
    roots.append(piece("crest_leaf-circlet", done(leaves + [vine]), "base_link", "crest", {"id": "leaf-circlet", "race": "nightelf"}))

    ant = []
    for sx in (1, -1):
        pts = [(0.02 * sx, TOP + 0.0, 0.05), (0.035 * sx, TOP + 0.07, 0.03), (0.06 * sx, TOP + 0.13, -0.03), (0.09 * sx, TOP + 0.15, -0.1)]
        ant.append(tube(f"antenna{sx}", pts, [0.004, 0.0028, 0.0018, 0.0012], "silver"))
        ant.append(sphere(f"antenna_tip{sx}", 0.006, "glow-moon", loc=(0.09 * sx, TOP + 0.15, -0.1)))
        ant.append(sphere(f"antenna_base{sx}", 0.008, "silver", loc=(0.02 * sx, TOP + 0.0, 0.05)))
    roots.append(piece("crest_long-antennae", done(ant), "base_link", "crest", {"id": "long-antennae", "race": "nightelf"}))

    moon = extrude2d("diadem_moon", crescent(0.03, 0.0), 0.004, "silver")
    moon.rotation_euler = (0, 0, PI / 2)
    moon.location = (0, TOP + 0.036, 0.04)
    gem = sphere("diadem_gem", 0.008, "glow-moon", loc=(0, TOP + 0.02, 0.052))
    band = ring_on_shell("diadem_band", 0.064, 0.075, -0.01, 0.002, 0.0028, "silver")
    roots.append(piece("crest_moon-diadem", done([moon, gem, band]), "base_link", "crest", {"id": "moon-diadem", "race": "nightelf"}))

    hood = wrap_grid("elfhood_cloth", -0.09, 0.09, -0.105, 0.055, "cloth-violet", lift=0.004, nx=18, nz=14, thick=0.0022)
    for v in hood.data.vertices:
        if abs(v.co.x) > 0.085:
            v.co.y -= 0.022
        if v.co.z < -0.1:
            v.co.y -= 0.03
    point = tube("elfhood_point", [(0, TOP + 0.004, -0.02), (0, TOP + 0.03, -0.07), (0, TOP + 0.05, -0.12), (0, TOP + 0.04, -0.16)], [0.03, 0.018, 0.008, 0.001], "cloth-violet", flat=0.5)
    point.scale = (1, 0.5, 1)
    roots.append(piece("crest_elf-hood", done([hood, point], smooth_angle=60), "base_link", "crest", {"id": "elf-hood", "race": "nightelf"}))
    return roots


# ============================================================================================
# TAUREN
# ============================================================================================
def tauren():
    roots = []
    ring = torus("nose_ring", 0.013, 0.0028, "gold", loc=(0, 0.008, 0.099), rot=(PI / 2, 0, 0))
    beads = []
    bead_mats = ["bead-teal", "bead-red", "bone", "bead-teal", "gold"]
    for sx in (1, -1):
        x0 = 0.084 * sx
        y0 = R.top(0.08 * sx, 0.04) - 0.004
        beads.append(tube(f"bead_cord{sx}", [(x0, y0, 0.04), (x0 + 0.006 * sx, y0 - 0.025, 0.044), (x0 + 0.008 * sx, y0 - 0.05, 0.046)], 0.0012, "leather-dark"))
        for k in range(5):
            beads.append(sphere(f"bead{sx}{k}", 0.0042, bead_mats[k], loc=(x0 + 0.002 * sx * k / 2, y0 - 0.008 - k * 0.009, 0.042 + k * 0.0012)))
        fea = extrude2d(f"bead_feather{sx}", leaf_shape(0.035, 0.007), 0.0015, "feather-white")
        fea.rotation_euler = (0, PI / 2, PI)
        fea.location = (x0 + 0.008 * sx, y0 - 0.052, 0.047)
        beads.append(fea)
    mantle = wrap_grid("mantle_hide", -0.092, 0.092, -0.11, -0.005, "fur", lift=0.004, nx=18, nz=12, thick=0.004)
    for v in mantle.data.vertices:
        if abs(v.co.x) > 0.087:
            v.co.y -= 0.018 + 0.008 * (math.sin(v.co.z * 210) > 0)
            v.co.x *= 1.05
        if v.co.z < -0.105:
            v.co.y -= 0.026 + 0.01 * (math.sin(v.co.x * 230) > 0)
            v.co.z -= 0.01
        v.co.y += 0.0015 * math.sin(v.co.x * 400) * math.sin(v.co.z * 300)
    spots = [sphere(f"mantle_spot{i}", 0.012, "cloth-white", loc=(x, R.top(x, z) + 0.0045, z), scale=(1, 0.12, 0.8)) for i, (x, z) in enumerate([(0.03, -0.05), (-0.045, -0.08), (-0.01, -0.03), (0.055, -0.09)])]
    roots.append(piece("tauren_gear", done([ring, mantle] + beads + spots, smooth_angle=55), "base_link", "always"))

    def horns(prefix, scale):
        out = []
        for sx in (1, -1):
            base = (0.062 * sx, TOP - 0.006, 0.03)
            out.append(sphere(f"{prefix}_boss{sx}", 0.016 * scale ** 0.5, "leather-dark", loc=base, scale=(1, 0.7, 1)))
            out.append(horn(f"{prefix}_h{sx}", base, (sx, 0.15, 0.25), 0.13 * scale, 0.017 * scale ** 0.6, "horn", curl=-1.2, up=2.2, seg=8))
        return out

    roots.append(piece("crest_great-horns", done(horns("greathorns", 1.15)), "base_link", "crest", {"id": "great-horns", "race": "tauren"}))
    # Worn with a hat (which replaces the crest) so a tauren never loses its horns.
    roots.append(piece("tauren_hat_horns", done(horns("hathorns", 0.75)), "base_link", "under-hat", {"race": "tauren"}))
    hf = horns("shorthorns", 0.6)
    for k, (dx, m) in enumerate([(-0.012, "feather-red"), (0.0, "feather-white"), (0.012, "feather-blue")]):
        f = extrude2d(f"hf_feather{k}", leaf_shape(0.06, 0.01), 0.002, m)
        f.rotation_euler = (-0.5, 0, -dx * 18)
        f.location = (dx, R.top(dx, -0.07), -0.07)
        hf.append(f)
    hf.append(sphere("hf_knot", 0.01, "leather-dark", loc=(0, R.top(0, -0.07), -0.07)))
    roots.append(piece("crest_horns-feathers", done(hf), "base_link", "crest", {"id": "horns-feathers", "race": "tauren"}))
    th = horns("totemhorns", 0.6)
    totem = lathe("totem_pole", [(0.013, 0.0), (0.013, 0.02), (0.016, 0.022), (0.016, 0.03), (0.011, 0.032), (0.011, 0.05), (0.017, 0.053), (0.006, 0.065), (0.0, 0.066)], "wood", seg=8, loc=(0, TOP - 0.004, -0.02))
    th.append(totem)
    for k in range(5):
        a = -0.7 + k * 0.35
        f = extrude2d(f"totem_feather{k}", leaf_shape(0.045, 0.008), 0.002, "feather-white" if k % 2 else "feather-red")
        f.rotation_euler = (-0.3, 0, a)
        f.location = (0, TOP + 0.045, -0.025)
        th.append(f)
    th.append(torus("totem_band", 0.014, 0.0025, "bead-teal", loc=(0, TOP + 0.012, -0.02)))
    roots.append(piece("crest_totem-headdress", done(th), "base_link", "crest", {"id": "totem-headdress", "race": "tauren"}))
    mn = horns("manehorns", 0.6)
    for i in range(6):
        z = 0.05 - i * 0.028
        mn.append(sphere(f"mane_tuft{i}", 0.014, "fur", loc=(0, R.top(0, z) + 0.006, z), scale=(0.8, 1.2, 1.2)))
    for sx in (1, -1):
        mn += braid(f"mane_braid{sx}", (0.03 * sx, R.top(0.03 * sx, -0.1), -0.105), 0.05, 0.007, "fur", sway=0.0, fwd=-0.01, n=7)
    roots.append(piece("crest_mane", done(mn), "base_link", "crest", {"id": "mane", "race": "tauren"}))
    return roots


# ============================================================================================
# WEAPONS (claw socket frame: +Y along the hinge, +Z out of the jaw)
# ============================================================================================
def weapons():
    roots = []
    grip = cone("sword_grip", 0.0055, 0.0055, 0.05, "leather-dark", loc=(0, -0.025, 0), seg=10)
    pommel = sphere("sword_pommel", 0.009, "gold", loc=(0, -0.03, 0))
    guard = box("sword_guard", (0.052, 0.008, 0.012), "gold", loc=(0, 0.028, 0), bevel=0.002)
    gems = [sphere(f"sword_guard_end{sx}", 0.0055, "gold", loc=(0.027 * sx, 0.028, 0)) for sx in (1, -1)]
    blade_pts = [(-0.011, 0.0), (0.011, 0.0), (0.0105, 0.13), (0.0, 0.152), (-0.0105, 0.13)]
    blade = extrude2d("sword_blade", blade_pts, 0.005, "steel", loc=(0, 0.032, 0), bevel=0.0018)
    fuller = extrude2d("sword_fuller", [(-0.0025, 0.0), (0.0025, 0.0), (0.0018, 0.1), (-0.0018, 0.1)], 0.0058, "gold", loc=(0, 0.036, 0), bevel=0.0)
    roots.append(piece("weapon_sword", done([grip, pommel, guard, blade, fuller] + gems), "clawR", "weapon", {"id": "sword", "socket": "clawR"}))

    disc = lathe("shield_disc", [(0.0, 0.0), (0.05, 0.0), (0.055, 0.005), (0.053, 0.01), (0.034, 0.016), (0.0, 0.019)], "cloth-tint", seg=32)
    disc.rotation_euler = (PI / 2, 0, 0)
    rim = torus("shield_rim", 0.0535, 0.0042, "gold", rot=(PI / 2, 0, 0), seg=40)
    emb = emblem_claw("shield_emblem", 0.027, "gold", depth=0.003)
    for o in emb:
        o.location = (0, 0.003, 0.019)
    handle = box("shield_handle", (0.008, 0.04, 0.01), "leather-dark", loc=(0, 0, -0.008), bevel=0.002)
    sh = [disc, rim, handle] + emb
    for o in sh:
        o.location.z += 0.03
    roots.append(piece("weapon_shield", done(sh), "clawL", "weapon", {"id": "shield", "socket": "clawL"}))

    shaft = tube("staff_shaft", [(0, -0.08, 0), (0.002, 0.0, 0.001), (-0.002, 0.1, 0.0), (0.0, 0.2, 0.002)], [0.0055, 0.006, 0.0055, 0.006], "driftwood")
    knots = [torus(f"staff_wrap{i}", 0.0065, 0.0018, "leather-dark", loc=(0, y, 0)) for i, y in enumerate((-0.01, 0.0, 0.01))]
    prongs = []
    for k in range(3):
        a = k * 2 * PI / 3
        prongs.append(tube(f"staff_prong{k}", [(0, 0.195, 0), (0.016 * math.cos(a), 0.21, 0.016 * math.sin(a)), (0.017 * math.cos(a), 0.235, 0.017 * math.sin(a)), (0.006 * math.cos(a), 0.252, 0.006 * math.sin(a))], [0.004, 0.003, 0.0025, 0.0012], "driftwood"))
    orb = sphere("staff_orb", 0.016, "glow-seaglass", loc=(0, 0.228, 0), seg=20, rings=14)
    roots.append(piece("weapon_staff", done([shaft, orb] + knots + prongs), "clawR", "weapon", {"id": "staff", "socket": "clawR", "light": "0,0.228,0"}))

    # Holy lantern hanging from a short gilded crook held upright in the claw.
    crook = tube("lantern_crook", [(0, -0.035, 0), (0, 0.06, 0.0), (0, 0.13, 0.0), (0, 0.15, 0.012), (0, 0.145, 0.03), (0, 0.13, 0.036)], [0.0045, 0.0045, 0.0042, 0.004, 0.0036, 0.003], "wood")
    ferrules = [torus(f"lantern_ferrule{i}", 0.0052, 0.0016, "gold", loc=(0, y, 0)) for i, y in enumerate((-0.03, 0.03, 0.125))]
    knob = sphere("lantern_knob", 0.006, "gold", loc=(0, -0.037, 0))
    hx, hy, hz = 0.0, 0.122, 0.036
    chain = tube("lantern_chain", [(hx, hy + 0.008, hz), (hx, hy - 0.008, hz)], 0.0012, "gold")
    hoop = torus("lantern_hoop", 0.006, 0.0016, "gold", rot=(0, 0, PI / 2), loc=(hx, hy - 0.012, hz))
    body_y = hy - 0.058
    cap = cone("lantern_cap", 0.02, 0.005, 0.014, "gold", loc=(hx, body_y + 0.034, hz), seg=6)
    bars = []
    for k in range(6):
        a = k * PI / 3
        bars.append(cone(f"lantern_bar{k}", 0.0016, 0.0016, 0.034, "gold", loc=(hx + 0.017 * math.cos(a), body_y, hz + 0.017 * math.sin(a)), seg=5))
    base = cone("lantern_base", 0.021, 0.018, 0.006, "gold", loc=(hx, body_y - 0.005, hz), seg=6)
    core = sphere("lantern_core", 0.011, "glow-holy", loc=(hx, body_y + 0.017, hz), scale=(1, 1.3, 1))
    glass = cone("lantern_glass", 0.016, 0.016, 0.033, "glow-warm", loc=(hx, body_y, hz), seg=6)
    lant = [crook, knob, chain, hoop, cap, base, core, glass] + bars + ferrules
    roots.append(piece("weapon_lantern", done(lant), "clawR", "weapon", {"id": "lantern", "socket": "clawR", "light": "0,0.08,0.036"}))

    cover = box("hymnal_cover", (0.052, 0.068, 0.016), "book", loc=(0, 0.0, 0.03), bevel=0.0025)
    pages = box("hymnal_pages", (0.048, 0.064, 0.0125), "paper", loc=(0.003, 0.0, 0.03), bevel=0.0008)
    sun = cone("hymnal_sun", 0.01, 0.01, 0.002, "gold", loc=(0, 0.0, 0.039), rot=(PI / 2, 0, 0), seg=12)
    rays = [box(f"hymnal_ray{k}", (0.003, 0.012, 0.0015), "gold", loc=(0.013 * math.sin(k * PI / 4), 0.013 * math.cos(k * PI / 4), 0.0388), rot=(0, 0, -k * PI / 4), bevel=0.0) for k in range(8)]
    clasp = box("hymnal_clasp", (0.008, 0.012, 0.018), "gold", loc=(0.026, 0.0, 0.03), bevel=0.001)
    roots.append(piece("weapon_hymnal", done([cover, pages, sun, clasp] + rays), "clawL", "weapon", {"id": "hymnal", "socket": "clawL"}))
    return roots


# ============================================================================================
# NPC EXTRAS
# ============================================================================================
def extras():
    roots = []
    crown = lathe("captain_crown", [(0.05, 0.0), (0.052, 0.018), (0.068, 0.03), (0.07, 0.036), (0.05, 0.04), (0.0, 0.041)], "cloth-navy", seg=32, loc=(0, TOP - 0.004, -0.01))
    crown.scale = (1, 1, 1.05)
    band = torus("captain_band", 0.051, 0.004, "leather-dark", loc=(0, TOP + 0.004, -0.01), scale=(1, 1.6, 1.05))
    brim = lathe("captain_brim", [(0.0, 0.0), (0.04, 0.0), (0.045, -0.004)], "leather-dark", seg=24, loc=(0, TOP - 0.004, 0.035), scale=(1.1, 1, 0.7))
    brim.rotation_euler = (0.35, 0, 0)
    badge_ring = torus("captain_badge", 0.009, 0.002, "gold", loc=(0, TOP + 0.02, 0.046), rot=(PI / 2 - 0.25, 0, 0))
    anchor = [cone("captain_anchor_shank", 0.0015, 0.0015, 0.014, "gold", loc=(0, TOP + 0.012, 0.048), rot=(-0.25, 0, 0), seg=6),
              torus("captain_anchor_arm", 0.006, 0.0014, "gold", loc=(0, TOP + 0.016, 0.0475), rot=(PI / 2 - 0.25, 0, 0), scale=(1, 1, 0.6))]
    cord = tube("captain_cord", [(-0.045, TOP + 0.006, 0.03), (0, TOP + 0.002, 0.047), (0.045, TOP + 0.006, 0.03)], 0.0018, "gold")
    roots.append(piece("extra_captain-hat", done([crown, band, brim, badge_ring, cord] + anchor), "base_link", "extra", {"id": "captain-hat"}))

    chef = lathe("chef_puff", [(0.035, 0.0), (0.036, 0.03), (0.05, 0.045), (0.052, 0.062), (0.035, 0.075), (0.0, 0.078)], "cloth-white", seg=24, loc=(0, TOP - 0.004, -0.01))
    gl.subdivide(chef, 1)
    chef_band = torus("chef_band", 0.036, 0.004, "cloth-white", loc=(0, TOP + 0.002, -0.01), scale=(1, 2.2, 1))
    roots.append(piece("extra_chef-hat", done([chef, chef_band]), "base_link", "extra", {"id": "chef-hat"}))

    goggles = []
    for sx in (1, -1):
        goggles.append(torus(f"goggle_rim{sx}", 0.012, 0.004, "brass", loc=(0.022 * sx, TOP + 0.006, 0.05), rot=(PI / 2 - 0.5, 0, 0)))
        goggles.append(sphere(f"goggle_lens{sx}", 0.011, "glow-gem", loc=(0.022 * sx, TOP + 0.006, 0.05), scale=(1, 1, 0.3), rot=(-0.5, 0, 0)))
    goggles.append(ring_on_shell("goggle_strap", 0.07, 0.078, -0.01, 0.001, 0.003, "leather-dark"))
    roots.append(piece("extra_smith-goggles", done(goggles), "base_link", "extra", {"id": "smith-goggles"}))
    return roots


# ============================================================================================
# ENEMIES
# ============================================================================================
def enemies():
    roots = []
    rng = random.Random(11)
    plates = []
    for i, (x, z, a) in enumerate([(0.03, 0.02, 0.2), (-0.035, -0.03, -0.3), (0.025, -0.07, 0.5), (-0.04, 0.045, 0.1)]):
        p = box(f"scrap_plate{i}", (0.05, 0.004, 0.04), "rust", loc=(x, R.top(x, z) + 0.004, z), rot=(rng.uniform(-0.12, 0.12), a, rng.uniform(-0.12, 0.12)), bevel=0.001)
        plates.append(p)
        plates += rivets(f"scrap_rv{i}", [(x + 0.018 * math.cos(a), R.top(x, z) + 0.007, z - 0.014 * math.sin(a)), (x - 0.018 * math.cos(a), R.top(x, z) + 0.007, z + 0.014 * math.sin(a))], 0.003, "iron")
    antenna = tube("scrap_antenna", [(-0.03, TOP, -0.06), (-0.035, TOP + 0.04, -0.07), (-0.02, TOP + 0.06, -0.075), (-0.005, TOP + 0.055, -0.07)], 0.0018, "iron")
    tip = sphere("scrap_antenna_tip", 0.005, "glow-red", loc=(-0.005, TOP + 0.055, -0.07))
    roots.append(piece("enemy_scrapling", done(plates + [antenna, tip]), "base_link", "enemy", {"id": "scrapling"}))

    barn = []
    for i in range(14):
        x = rng.uniform(-0.075, 0.075)
        z = rng.uniform(-0.1, 0.04)
        s = rng.uniform(0.6, 1.2)
        barn.append(lathe(f"barnacle{i}", [(0.011 * s, 0.0), (0.009 * s, 0.008 * s), (0.005 * s, 0.013 * s), (0.003 * s, 0.011 * s), (0.0, 0.009 * s)], "barnacle", seg=7, loc=(x, R.top(x, z) - 0.001, z), rot=(rng.uniform(-0.3, 0.3), 0, rng.uniform(-0.3, 0.3))))
    roots.append(piece("enemy_scavenger", done(barn), "base_link", "enemy", {"id": "scavenger"}))
    # Claw pieces are modelled in the LF palm frame (+X along the claw, +Z = top at HOME) and
    # mirrored into the RF palm frame, which is the one they ride on.
    claw = []
    for i in range(6):
        x, y = 0.03 + i * 0.016, 0.01 * ((i % 3) - 1)
        claw.append(lathe(f"clawbarn{i}", [(0.008, 0.0), (0.0065, 0.006), (0.003, 0.011), (0.0, 0.009)], "barnacle", seg=7, loc=(x, y, palm_top(x, y) - 0.001), rot=(PI / 2, 0, 0)))
    claw.append(palm_plate("clawplate", 0.06, 0.13, -0.014, 0.014, "rust"))
    for i in range(3):
        x = 0.075 + i * 0.022
        claw.append(cone(f"clawspike{i}", 0.0055, 0.0, 0.02, "iron", loc=(x, 0.0, palm_top(x, 0.0) + 0.003), rot=(PI / 2 - 0.3, 0, 0), seg=6))
    claw = [gl.mirror_x(o, o.name + "_r") for o in claw]
    roots.append(piece("enemy_scavenger_claw", done(claw), "RF_palm_link", "enemy", {"id": "scavenger"}))

    # Corrodius: iron hull plates, anchor-chain mantle, cracked crown, furnace grate.
    hull = []
    for i, (x0, x1, z0, z1) in enumerate([(-0.08, -0.005, -0.1, -0.01), (0.005, 0.08, -0.1, -0.01), (-0.08, 0.08, -0.005, 0.06)]):
        p = wrap_grid(f"hullplate{i}", x0, x1, z0, z1, "iron", lift=0.003, nx=8, nz=8, thick=0.004)
        hull.append(p)
        rv = []
        for x in (x0 + 0.006, x1 - 0.006):
            for z in (z0 + 0.006, z1 - 0.006):
                rv.append((x, R.top(x, z) + 0.008, z))
        hull += rivets(f"hullrv{i}", rv, 0.0035, "rust")
    links = []
    pts = shell_edge_points(26, inset=0.004, lift=0.004, zmin=-0.12, zmax=0.09)
    for i, p in enumerate(pts):
        links.append(torus(f"chain{i}", 0.0085, 0.0025, "iron", loc=p, rot=(PI / 2 * (i % 2), math.atan2(p[0], p[2]) + PI / 2, 0), scale=(1.4, 1, 1)))
    anchor = [cone("anchor_shank", 0.004, 0.004, 0.06, "iron", loc=(0.09, R.top(0.085, 0.0) - 0.07, 0.0), seg=8),
              torus("anchor_ring", 0.008, 0.0025, "iron", loc=(0.09, R.top(0.085, 0.0) - 0.005, 0.0), rot=(0, 0, PI / 2)),
              torus("anchor_arms", 0.022, 0.0045, "iron", loc=(0.09, R.top(0.085, 0.0) - 0.07, 0.0), rot=(0, 0, PI / 2), scale=(1, 1, 1))]
    crown_ring = lathe("crown_ring", [(0.04, 0.0), (0.041, 0.016), (0.036, 0.016), (0.035, 0.0)], "iron", seg=24, loc=(0, TOP - 0.003, -0.01))
    spikes = []
    for k in range(7):
        a = 2 * PI * k / 7
        h = 0.035 if k != 2 else 0.014
        spikes.append(cone(f"crown_spike{k}", 0.009, 0.0, h, "rust" if k % 2 else "iron", loc=(0.038 * math.cos(a), TOP + 0.01, -0.01 + 0.038 * math.sin(a)), rot=(0.25 * math.sin(a), 0, -0.25 * math.cos(a)), seg=4))
    crown_crack = tube("crown_crack", [(0.04, TOP + 0.014, -0.0), (0.042, TOP + 0.006, 0.006), (0.041, TOP - 0.001, 0.002)], 0.0016, "glow-furnace")
    grate = []
    for k in range(5):
        y = 0.036 + k * 0.0068
        grate.append(cone(f"grate_bar{k}", 0.0016, 0.0016, 0.1, "iron", loc=(-0.05, y, 0.093), rot=(0, 0, -PI / 2), seg=6))
    roots.append(piece("enemy_corrodius", done(hull + links + anchor + spikes + [crown_ring, crown_crack] + grate), "base_link", "enemy", {"id": "corrodius", "light": "0,0.05,0.12"}))
    gclaw = []
    for i in range(4):
        x0 = 0.012 + i * 0.022
        gclaw.append(palm_plate(f"gclaw_plate{i}", x0, x0 + 0.02, -0.013, 0.013, "iron", lift=0.002 + 0.0012 * i, n=6))
        gclaw += rivets(f"gclaw_rv{i}", [(x0 + 0.01, dy, palm_top(x0 + 0.01, dy) + 0.0045 + 0.0012 * i) for dy in (-0.009, 0.009)], 0.0022, "rust")
    gclaw.append(cone("gclaw_spike", 0.008, 0.0, 0.03, "rust", loc=(0.06, 0.0, palm_top(0.06, 0.0) + 0.004), rot=(PI / 2 - 0.4, 0, 0), seg=6))
    gclaw = [gl.mirror_x(o, o.name + "_r") for o in gclaw]
    roots.append(piece("enemy_corrodius_claw", done(gclaw), "RF_palm_link", "enemy", {"id": "corrodius"}))
    return roots


FILES = {
    "human": ("gear/human-gear.glb", human),
    "orc": ("gear/orc-gear.glb", orc),
    "dwarf": ("gear/dwarf-gear.glb", dwarf),
    "undead": ("gear/undead-gear.glb", undead),
    "nightelf": ("gear/nightelf-gear.glb", nightelf),
    "tauren": ("gear/tauren-gear.glb", tauren),
    "weapons": ("weapons/class-weapons.glb", weapons),
    "extras": ("gear/npc-extras.glb", extras),
    "enemies": ("gear/enemy-gear.glb", enemies),
}
only = [s for s in args.only.split(",") if s]
for key, (rel, fn) in FILES.items():
    if only and key not in only:
        continue
    gl.clear_pieces()
    roots = fn()
    gl.export(OUT / rel, roots)
    tris = sum(len(c.data.polygons) for r in roots for c in r.children if c.type == "MESH")
    print(f"GEAR {rel} pieces={len(roots)} faces={tris}")
