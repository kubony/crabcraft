"""Build public/models/crab/jumper.glb from the Jumper URDF and its visual STLs (Blender headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_crab.py -- \
        --jumper /path/to/jumper --out /tmp/jumper.raw.glb
    npx @gltf-transform/cli meshopt /tmp/jumper.raw.glb public/models/crab/jumper.glb

What it does, in order:

1. Parses the URDF (links, joints, origins, axes) and takes joint limits from the MJCF.
2. Imports every visual STL, welds it, and converts it to the game frame
   (game.x = mj.y, game.y = mj.z, game.z = mj.x; see src/crab/types.ts).
3. Gives every face a material class. The class comes from the link (shell, metal, rubber, dark,
   visor) with one per-component override: the servo output cylinders at each joint origin are
   brushed aluminium caps. Classes were identified by rendering the separated components, not by
   name alone (tools/build_crab.py --ident renders them).
4. Deletes faces nobody can see: a face whose hemisphere rays all hit the same rigid group (one
   moving link, or the static body = base + shell + display + sensors) is enclosed by geometry that
   never moves relative to it, so it is hidden in every pose.
5. Decimates each link to a triangle budget, sets sharp edges by angle and weighted normals so the
   glossy shell keeps clean reflections.
6. Writes one empty node per URDF link (node tree = kinematic tree, local translation = joint
   origin in game axes, rest rotation identity) with the joint name, axis and limits in extras, and
   the link's mesh as a child node "<link>_mesh". Rotating a link node about extras.axis by q gives
   MuJoCo qpos q (tools/check_crab_fk.py proves it).
7. Adds "face_screen", a UV-mapped copy of the display window's front faces, for the LED face.
8. Measures the standing pose (HOME, base at STAND_Z) and stores shell-top height and foot data in
   base_link extras.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--jumper", required=True, help="Jumper repo root (read only)")
ap.add_argument("--out", required=True, help="Output .glb (uncompressed; compress with gltf-transform)")
ap.add_argument("--blend", default=None, help="Optionally save the .blend for inspection")
ap.add_argument("--scale-budget", type=float, default=1.0, help="Multiply every triangle budget")
args = ap.parse_args(argv)

JUMPER = Path(args.jumper)
URDF = JUMPER / "assets/jumper/urdf/jumper/urdf/jumper.urdf"
MESHES = URDF.parent.parent / "meshes/visual"
BUNDLE = JUMPER / "out/bundle_example/jumper/locomotion.json"

# MuJoCo/URDF (Z-up, forward +X, left +Y) -> game (Y-up, forward +Z, left +X).
G3 = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))
G4 = G3.to_4x4()


def to_game(v) -> Vector:
    return G3 @ Vector(v)


# ---------------------------------------------------------------------------------------------
# URDF
# ---------------------------------------------------------------------------------------------
root = ET.parse(URDF).getroot()
links: dict[str, str] = {}
for l in root.findall("link"):
    mesh = l.find("visual/geometry/mesh")
    links[l.get("name")] = Path(mesh.get("filename")).name if mesh is not None else ""
joints: dict[str, dict] = {}  # keyed by child link
for j in root.findall("joint"):
    o = j.find("origin")
    xyz = [float(x) for x in (o.get("xyz") if o is not None else "0 0 0").split()]
    rpy = [float(x) for x in (o.get("rpy") if o is not None else "0 0 0").split()]
    ax = j.find("axis")
    lim = j.find("limit")
    joints[j.find("child").get("link")] = {
        "name": j.get("name"),
        "type": j.get("type"),
        "parent": j.find("parent").get("link"),
        "xyz": xyz,
        "rpy": rpy,
        "axis": [float(x) for x in ax.get("xyz").split()] if ax is not None else [0, 0, 0],
        "lower": float(lim.get("lower")) if lim is not None else 0.0,
        "upper": float(lim.get("upper")) if lim is not None else 0.0,
    }
    if any(abs(a) > 1e-9 for a in rpy):
        raise SystemExit(f"joint {j.get('name')} has rpy {rpy}; this builder assumes identity rest rotations")
# Joint limits come from the MJCF the policies were trained on: the URDF has stale/typo limits
# (e.g. LM_J0_joint lower=0.75 instead of -0.75, RF_J4_joint lower=0.1 instead of -0.1).
MJCF = JUMPER / "assets/jumper/jumper.xml"
mj_range = {j.get("name"): [float(v) for v in j.get("range").split()] for j in ET.parse(MJCF).getroot().iter("joint") if j.get("range")}
for j in joints.values():
    if j["name"] in mj_range:
        j["lower"], j["upper"] = mj_range[j["name"]]
ROOT_LINK = next(n for n in links if n not in joints)
order: list[str] = []


def walk(n: str) -> None:
    order.append(n)
    for c, j in joints.items():
        if j["parent"] == n:
            walk(c)


walk(ROOT_LINK)
bundle = json.loads(BUNDLE.read_text())
HOME = bundle["default_joint_pos"]
STAND_Z = float(bundle["base_height"])

# ---------------------------------------------------------------------------------------------
# Material classes and budgets
# ---------------------------------------------------------------------------------------------
STATIC_BODY = {"base_link", "upper_shell_link", "display_module_link", "tof_sensor_link", "camera_link"}


def link_class(n: str) -> str:
    if n == "upper_shell_link":
        return "shell"
    if n == "display_module_link":
        return "visor"
    if n in ("base_link", "tof_sensor_link", "camera_link"):
        return "dark"
    if n.endswith(("forearm_link", "thigh_link")):
        return "metal"
    if "pad" in n or "tip" in n or "insert" in n:
        return "rubber"
    return "shell"


def budget(n: str) -> int:
    table = [
        ("upper_shell_link", 9000), ("base_link", 7000), ("display_module_link", 900),
        ("tof_sensor_link", 200), ("camera_link", 300),
        ("shoulder_link", 2200), ("upper_arm_link", 2200), ("forearm_link", 1300),
        ("palm_link", 3600), ("palm_pad", 700), ("finger_link", 2000), ("finger_tip", 700),
        ("grip_insert", 900), ("hip_link", 2400), ("thigh_link", 1100), ("calf_link", 3000),
        ("foot_tip", 450),
    ]
    for k, v in table:
        if k in n:
            return int(v * args.scale_budget)
    return 1500


MAT_DEFS = {
    # name: (base colour linear-ish, metallic, roughness). The runtime replaces these by name.
    "shell": ((0.65, 0.016, 0.03), 0.0, 0.25),
    "dark": ((0.02, 0.02, 0.022), 0.0, 0.45),
    "visor": ((0.004, 0.004, 0.005), 0.0, 0.08),
    "metal": ((0.62, 0.64, 0.66), 1.0, 0.32),
    "joint": ((0.75, 0.76, 0.78), 1.0, 0.28),
    "rubber": ((0.5, 0.5, 0.48), 0.0, 0.7),
    "face": ((0.0, 0.0, 0.0), 0.0, 1.0),
}
CLASS_ORDER = list(MAT_DEFS)


def get_mat(name: str) -> bpy.types.Material:
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col, met, rough = MAT_DEFS[name]
    bsdf.inputs["Base Color"].default_value = (*col, 1)
    bsdf.inputs["Metallic"].default_value = met
    bsdf.inputs["Roughness"].default_value = rough
    return m


# ---------------------------------------------------------------------------------------------
# Import, classify, cull, decimate
# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Rest-pose (q = 0) link origins in game frame, for the occlusion test of the static body.
rest_pos: dict[str, Vector] = {ROOT_LINK: Vector((0, 0, 0))}
for n in order[1:]:
    j = joints[n]
    rest_pos[n] = rest_pos[j["parent"]] + to_game(j["xyz"])

stats: dict[str, dict] = {}
meshes: dict[str, bpy.types.Object] = {}


def import_link(n: str) -> bpy.types.Object | None:
    fn = links[n]
    if not fn:
        return None
    bpy.ops.wm.stl_import(filepath=str(MESHES / fn))
    o = bpy.context.selected_objects[0]
    o.name = n + "_mesh"
    o.data.name = n
    o.data.transform(G4)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bm.faces.ensure_lookup_table()
    # Connected components.
    comp = [-1] * len(bm.faces)
    comps: list[list] = []
    for f in bm.faces:
        if comp[f.index] >= 0:
            continue
        cid = len(comps)
        stack = [f]
        comp[f.index] = cid
        members = []
        while stack:
            g = stack.pop()
            members.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if comp[h.index] < 0:
                        comp[h.index] = cid
                        stack.append(h)
        comps.append(members)
    cls = link_class(n)
    kill = []
    for members in comps:
        vs = {v for f in members for v in f.verts}
        lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
        hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
        ext = sorted((hi - lo) * 1000)
        ctr = (lo + hi) / 2
        mat = cls
        if len(members) <= 16 and ext[2] < 1.0:
            kill.extend(members)  # degenerate CAD slivers
            continue
        if n not in STATIC_BODY and ctr.length < 0.006 and 34 < ext[2] < 39 and ext[0] > 18:
            mat = "joint"  # servo output cylinder at the joint origin
        for f in members:
            f.material_index = CLASS_ORDER.index(mat)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    for name in CLASS_ORDER:
        o.data.materials.append(get_mat(name))
    stats[n] = {"faces_in": len(o.data.polygons), "components": len(comps)}
    return o


for n in order:
    o = import_link(n)
    if o is not None:
        meshes[n] = o

# Fibonacci hemisphere directions (local, +Z up), cosine-ish spread.
DIRS = []
K = 24
for i in range(K):
    z = 1 - (i + 0.5) / K  # 1 .. 0
    r = math.sqrt(max(0.0, 1 - z * z))
    phi = i * math.pi * (3 - math.sqrt(5))
    DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), max(z, 0.05))).normalized())


def cull(group: list[str]) -> None:
    """Delete faces of the group whose every hemisphere ray hits the group (enclosed)."""
    verts, polys, owners = [], [], []
    for n in group:
        o = meshes.get(n)
        if not o:
            continue
        off = rest_pos[n] if len(group) > 1 else Vector()
        base = len(verts)
        verts.extend(v.co + off for v in o.data.vertices)
        polys.extend([base + i for i in p.vertices] for p in o.data.polygons)
    if not polys:
        return
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    for n in group:
        o = meshes.get(n)
        if not o:
            continue
        off = rest_pos[n] if len(group) > 1 else Vector()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        dead = []
        for f in bm.faces:
            nrm = f.normal
            if nrm.length < 0.5:
                continue
            c = f.calc_center_median() + off
            basis = nrm.to_track_quat("Z", "Y").to_matrix()
            org = c + nrm * 2e-4
            hidden = True
            for d in DIRS:
                hit = tree.ray_cast(org, basis @ d, 1.0)
                if hit[0] is None:
                    hidden = False
                    break
            if hidden:
                dead.append(f)
        bmesh.ops.delete(bm, geom=dead, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        stats[n]["faces_visible"] = len(o.data.polygons)


cull([n for n in order if n in STATIC_BODY])
for n in order:
    if n not in STATIC_BODY:
        cull([n])

SHARP = math.radians(38)


def finish_mesh(n: str, o: bpy.types.Object) -> None:
    scene.collection.objects.link(o) if o.name not in scene.collection.objects else None
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    target = budget(n)
    nf = len(o.data.polygons)
    # Triangulate first so the face count is a triangle count.
    tri = o.modifiers.new("tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri.name)
    nf = len(o.data.polygons)
    if nf > target:
        dec = o.modifiers.new("dec", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = target / nf
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
            continue
        a = e.calc_face_angle(math.pi)
        mats = {f.material_index for f in e.link_faces}
        e.smooth = a < SHARP and len(mats) == 1
    bm.to_mesh(o.data)
    bm.free()
    wn = o.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.keep_sharp = True
    wn.weight = 50
    wn.mode = "FACE_AREA"
    bpy.ops.object.modifier_apply(modifier=wn.name)
    stats[n]["tris_out"] = len(o.data.polygons)


for n, o in meshes.items():
    finish_mesh(n, o)

# ---------------------------------------------------------------------------------------------
# LED face screen: the display window's forward-facing faces, UV mapped across the window.
# ---------------------------------------------------------------------------------------------
disp = meshes["display_module_link"]
bm = bmesh.new()
bm.from_mesh(disp.data)
front = [f for f in bm.faces if f.normal.z > 0.55]
zmax = max(v.co.z for f in front for v in f.verts)
front = [f for f in front if f.calc_center_median().z > zmax - 0.012]
fbm = bmesh.new()
vmap = {}
for f in front:
    vs = []
    for v in f.verts:
        if v not in vmap:
            vmap[v] = fbm.verts.new(v.co + v.normal * 0.0003)
        vs.append(vmap[v])
    try:
        fbm.faces.new(vs)
    except ValueError:
        pass
bm.free()
xs = [v.co.x for v in fbm.verts]
ys = [v.co.y for v in fbm.verts]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
uv = fbm.loops.layers.uv.new("UVMap")
for f in fbm.faces:
    f.smooth = True
    for lp in f.loops:
        # Seen from the front the crab's left (+X) is on the viewer's right, so u grows with x.
        lp[uv].uv = ((lp.vert.co.x - x0) / (x1 - x0), (lp.vert.co.y - y0) / (y1 - y0))
face_me = bpy.data.meshes.new("face_screen")
fbm.to_mesh(face_me)
fbm.free()
face_me.materials.append(get_mat("face"))
face_obj = bpy.data.objects.new("face_screen", face_me)
scene.collection.objects.link(face_obj)
FACE_RECT = {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "z": zmax}

# ---------------------------------------------------------------------------------------------
# Node tree
# ---------------------------------------------------------------------------------------------
empties: dict[str, bpy.types.Object] = {}
for n in order:
    e = bpy.data.objects.new(n, None)
    e.empty_display_size = 0.01
    scene.collection.objects.link(e)
    empties[n] = e
    if n in joints:
        j = joints[n]
        e.parent = empties[j["parent"]]
        e.location = to_game(j["xyz"])
        e["joint"] = j["name"] if j["type"] != "fixed" else ""
        ax = to_game(j["axis"])
        e["axis"] = [round(ax.x, 9), round(ax.y, 9), round(ax.z, 9)]
        e["lower"] = j["lower"]
        e["upper"] = j["upper"]
    e["link"] = n
    e["material_class"] = link_class(n)
    if n in meshes:
        m = meshes[n]
        m.parent = e
        m.location = (0, 0, 0)
face_obj.parent = empties["display_module_link"]

# HOME measurement: pose the empties and evaluate shell top and feet.
bpy.context.view_layer.update()
for n, j in joints.items():
    if j["type"] == "fixed":
        continue
    q = HOME[j["name"]]
    empties[n].rotation_mode = "QUATERNION"
    empties[n].rotation_quaternion = Matrix.Rotation(q, 4, to_game(j["axis"])).to_quaternion()
empties[ROOT_LINK].location = (0, STAND_Z, 0)
bpy.context.view_layer.update()


def world_extent(n: str, axis: int) -> tuple[float, float]:
    o = meshes[n]
    mw = o.matrix_world
    vals = [(mw @ v.co)[axis] for v in o.data.vertices]
    return min(vals), max(vals)


shell_top = world_extent("upper_shell_link", 1)[1]
ground = min(world_extent(n, 1)[0] for n in meshes)
feet = {}
for n in meshes:
    if n.endswith(("foot_tip_link", "palm_pad_b_link")):
        o = meshes[n]
        mw = o.matrix_world
        lo = min((mw @ v.co for v in o.data.vertices), key=lambda p: p.y)
        feet[n] = [round(lo.x, 6), round(lo.y, 6), round(lo.z, 6)]
info = {
    "standZ": STAND_Z,
    "shellTopHome": round(shell_top, 6),
    "lowestPointHome": round(ground, 6),
    "feetHome": feet,
    "faceRect": {k: round(v, 6) for k, v in FACE_RECT.items()},
    "home": HOME,
    "source": "KingKongRobotics/jumper assets/jumper/urdf (Apache-2.0)",
}
for k, v in info.items():
    empties[ROOT_LINK][k] = json.dumps(v) if isinstance(v, dict) else v

# Back to rest for export.
for n, j in joints.items():
    empties[n].rotation_quaternion = (1, 0, 0, 0)
    empties[n].rotation_mode = "XYZ"
empties[ROOT_LINK].location = (0, 0, 0)
bpy.context.view_layer.update()

# Drop unused material slots so each mesh exports only the primitives it has.
for o in list(meshes.values()):
    used = {p.material_index for p in o.data.polygons}
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    for i in reversed(range(len(o.data.materials))):
        if i not in used:
            o.active_material_index = i
            bpy.ops.object.material_slot_remove()

if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)

bpy.ops.export_scene.gltf(
    filepath=args.out,
    export_format="GLB",
    export_yup=False,
    export_apply=True,
    export_extras=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_vertex_color="NONE",
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
total = sum(s.get("tris_out", 0) for s in stats.values())
print("BUILD_STATS", json.dumps({"links": stats, "tris_total": total, "info": info}, indent=1))
