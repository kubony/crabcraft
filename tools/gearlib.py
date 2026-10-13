"""Small Blender modelling kit for the crab gear (tools/build_gear.py imports it).

Everything is built in a link's local frame in game axes (Y up, crab faces +Z, crab left +X),
robot metres. Pieces are stylised: chunky shapes, bevelled edges, smooth-by-angle normals, and a
baked vertex-colour pass (height gradient + underside shading + a little hue noise) that gives the
hand-painted look when three.js multiplies it into the material colour.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

G3 = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))  # MuJoCo -> game

# --------------------------------------------------------------------------------------------
# Materials: one shared palette. Names are the contract with src/crab/gear.ts (tintable ones end
# in "-tint"; emissive ones start with "glow").
# --------------------------------------------------------------------------------------------
PALETTE: dict[str, dict] = {
    "cloth-tint": dict(color="#2747a8", rough=0.85),
    "cloth-red": dict(color="#a3242a", rough=0.85),
    "cloth-dark": dict(color="#2c2a30", rough=0.9),
    "cloth-violet": dict(color="#3a2a5e", rough=0.85),
    "cloth-navy": dict(color="#1d2a4a", rough=0.8),
    "cloth-white": dict(color="#ece6da", rough=0.85),
    "gold": dict(color="#e0b04a", metal=1.0, rough=0.3),
    "brass": dict(color="#b88a3e", metal=1.0, rough=0.4),
    "steel": dict(color="#cfd5dc", metal=1.0, rough=0.22),
    "iron": dict(color="#4a4d52", metal=0.9, rough=0.5),
    "rust": dict(color="#8a4a26", metal=0.4, rough=0.85),
    "copper": dict(color="#c8743a", metal=1.0, rough=0.35),
    "silver": dict(color="#dfe6f0", metal=1.0, rough=0.18),
    "leather": dict(color="#6b4226", rough=0.7),
    "leather-dark": dict(color="#3e2616", rough=0.7),
    "bone": dict(color="#e8dcc0", rough=0.55),
    "horn": dict(color="#d9c7a2", rough=0.45),
    "fur": dict(color="#7a5233", rough=0.95),
    "hair-black": dict(color="#1c1714", rough=0.8),
    "wood": dict(color="#8a6a46", rough=0.75),
    "driftwood": dict(color="#a89a84", rough=0.85),
    "leaf": dict(color="#5f9e4f", rough=0.6),
    "leaf-silver": dict(color="#a9c7b4", metal=0.6, rough=0.3),
    "elf-ear": dict(color="#cfc3ea", metal=0.15, rough=0.35),
    "feather-red": dict(color="#c0282e", rough=0.8),
    "feather-white": dict(color="#f2eee6", rough=0.8),
    "feather-blue": dict(color="#3d7bc4", rough=0.8),
    "paint-war": dict(color="#b81c12", rough=0.85),
    "paint-black": dict(color="#151110", rough=0.8),
    "paint-moon": dict(color="#d9e4ff", rough=0.35, emit="#9fbcff", strength=0.35),
    "crack": dict(color="#0c0b0a", rough=0.95),
    "wire-red": dict(color="#c4231e", rough=0.5),
    "wire-yellow": dict(color="#e6b31e", rough=0.5),
    "wire-blue": dict(color="#2e6fd0", rough=0.5),
    "servo": dict(color="#1d1e22", rough=0.45),
    "barnacle": dict(color="#cfc8b8", rough=0.9),
    "bead-teal": dict(color="#2aa39a", rough=0.35),
    "bead-red": dict(color="#b8342a", rough=0.35),
    "book": dict(color="#6a1e22", rough=0.6),
    "paper": dict(color="#efe4c8", rough=0.9),
    "glow-warm": dict(color="#ffd27a", emit="#ffbe5c", strength=6.0),
    "glow-holy": dict(color="#fff2c8", emit="#ffe39a", strength=8.0),
    "glow-green": dict(color="#9dff7a", emit="#8dff6a", strength=6.0),
    "glow-cyan": dict(color="#7ff7ec", emit="#53f2e4", strength=5.0),
    "glow-seaglass": dict(color="#6fe0d0", emit="#3fd8c8", strength=3.0, rough=0.1),
    "glow-moon": dict(color="#cfe2ff", emit="#9fc4ff", strength=6.0),
    "glow-gem": dict(color="#5aa0ff", emit="#3a7cff", strength=4.0),
    "glow-furnace": dict(color="#ff6a1a", emit="#ff4a10", strength=9.0),
    "glow-red": dict(color="#ff3a20", emit="#ff2a1a", strength=7.0),
}


def srgb(hexstr: str) -> tuple[float, float, float]:
    h = hexstr.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # type: ignore


def mat(name: str) -> bpy.types.Material:
    m = bpy.data.materials.get(name)
    if m:
        return m
    p = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(p["color"]), 1)
    bsdf.inputs["Metallic"].default_value = p.get("metal", 0.0)
    bsdf.inputs["Roughness"].default_value = p.get("rough", 0.5)
    if "emit" in p:
        bsdf.inputs["Emission Color"].default_value = (*srgb(p["emit"]), 1)
        bsdf.inputs["Emission Strength"].default_value = p["strength"]
    # Vertex colours (glTF COLOR_0) multiply the base colour in three.js.
    return m


# --------------------------------------------------------------------------------------------
# Object helpers
# --------------------------------------------------------------------------------------------
def new_obj(name: str, bm: bmesh.types.BMesh, material: str) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(material))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def place(o: bpy.types.Object, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)) -> bpy.types.Object:
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    return o


def box(name, size, material, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0015, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = new_obj(name, bm, material)
    place(o, loc, rot)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        b.limit_method = "ANGLE"
    return o


def cone(name, r1, r2, depth, material, loc=(0, 0, 0), rot=(0, 0, 0), seg=16, bevel=0.0):
    """Cylinder/cone along local +Y from y=0 to y=depth."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, depth / 2, 0))
    o = new_obj(name, bm, material)
    place(o, loc, rot)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
    return o


def sphere(name, r, material, loc=(0, 0, 0), scale=(1, 1, 1), seg=16, rings=10, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    o = new_obj(name, bm, material)
    return place(o, loc, rot, scale)


def torus(name, R, r, material, loc=(0, 0, 0), rot=(0, 0, 0), seg=24, rseg=8, scale=(1, 1, 1)):
    """Torus in the local XZ plane (axis +Y)."""
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            x = (R + r * math.cos(b)) * math.cos(a)
            z = (R + r * math.cos(b)) * math.sin(a)
            y = r * math.sin(b)
            ring.append(bm.verts.new((x, y, z)))
        verts.append(ring)
    for i in range(seg):
        for j in range(rseg):
            a, b = verts[i][j], verts[(i + 1) % seg][j]
            c, d = verts[(i + 1) % seg][(j + 1) % rseg], verts[i][(j + 1) % rseg]
            bm.faces.new((a, d, c, b))
    o = new_obj(name, bm, material)
    return place(o, loc, rot, scale)


def lathe(name, profile, material, seg=24, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), cap_top=True, cap_bottom=True):
    """Revolve [(radius, y), ...] (bottom to top) around +Y."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(seg):
            a, b = rings[k][i], rings[k][(i + 1) % seg]
            c, d = rings[k + 1][(i + 1) % seg], rings[k + 1][i]
            bm.faces.new((a, d, c, b))
    if cap_bottom and profile[0][0] > 1e-6:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-6:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = new_obj(name, bm, material)
    return place(o, loc, rot, scale)


def extrude2d(name, poly, depth, material, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0008, scale=(1, 1, 1)):
    """Polygon [(x, y), ...] in the XY plane, extruded along +Z by depth (centred)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in poly]
    bm.faces.new(vs)  # concave n-gon; Blender tessellates it correctly (triangulate() here did not)
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    top = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = new_obj(name, bm, material)
    place(o, loc, rot, scale)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
    return o


def tube(name, pts, radius, material, taper=None, res=3, bevel_res=4, closed=False, flat=1.0):
    """Smooth tube through pts. radius is a number or a per-point list; taper multiplies end radius."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = res
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    n = len(pts)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        if isinstance(radius, (list, tuple)):
            rr = radius[i]
        else:
            t = i / max(1, n - 1)
            rr = radius * (1 + ((taper if taper is not None else 1) - 1) * t)
        sp.points[i].radius = rr
    sp.use_endpoint_u = True
    sp.order_u = min(4, n)
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new(name + "_curve", cu)
    bpy.context.scene.collection.objects.link(o)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    me.name = name
    me.materials.clear()
    me.materials.append(mat(material))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if flat != 1.0:
        ob.scale = (1, flat, 1)
    return ob


def grid(name, nx, nz, x0, x1, z0, z1, y, material):
    bm = bmesh.new()
    vs = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y, z0 + (z1 - z0) * j / nz)) for j in range(nz + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(nz):
            bm.faces.new((vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j]))
    return new_obj(name, bm, material)


def apply_all(o: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    # bake loc/rot/scale into the mesh so the object frame = link frame
    o.data.transform(o.matrix_basis)
    o.matrix_basis = Matrix.Identity(4)


def solidify(o, t, offset=-1.0):
    s = o.modifiers.new("solid", "SOLIDIFY")
    s.thickness = t
    s.offset = offset
    return o


def shrinkwrap(o, target, offset=0.002, method="PROJECT", axis="Y"):
    sw = o.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = target
    sw.offset = offset
    sw.wrap_method = method
    if method == "PROJECT":
        sw.use_project_y = axis == "Y"
        sw.use_project_z = axis == "Z"
        sw.use_project_x = axis == "X"
        sw.use_negative_direction = True
        sw.use_positive_direction = True
    return o


def subdivide(o, levels=2, simple=False):
    s = o.modifiers.new("subd", "SUBSURF")
    s.levels = levels
    s.render_levels = levels
    if simple:
        s.subdivision_type = "SIMPLE"
    return o


def finish(o: bpy.types.Object, smooth_angle=40.0, seed=0, shade=True) -> bpy.types.Object:
    """Apply modifiers, smooth-by-angle normals and the painted vertex-colour pass."""
    apply_all(o)
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # Mirrored/scaled builds can flip winding; every piece is closed, so point normals outward.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = (len(e.link_faces) == 2) and e.calc_face_angle(math.pi) < math.radians(smooth_angle)
    bm.to_mesh(me)
    bm.free()
    rng = random.Random(seed or hash(o.name) & 0xFFFF)
    ys = [v.co.y for v in me.vertices] or [0]
    y0, y1 = min(ys), max(ys)
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    jitter = 1 + (rng.random() - 0.5) * 0.06
    for v in me.vertices:
        h = (v.co.y - y0) / (y1 - y0) if y1 > y0 else 1
        n = v.normal
        c = (0.78 + 0.22 * h) * (0.8 + 0.2 * (n.y * 0.5 + 0.5)) * jitter if shade else 1.0
        c = max(0.0, min(1.0, c * (1 + (rng.random() - 0.5) * 0.05)))
        attr.data[v.index].color = (c, c, c * 0.98, 1)
    me.color_attributes.active_color = attr
    return o


def join(name: str, objs: list[bpy.types.Object]) -> bpy.types.Object:
    """Join finished objects into one (keeps materials as primitives)."""
    for o in objs:
        if o.modifiers:
            apply_all(o)
    bpy.context.view_layer.objects.active = objs[0]
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def mirror_x(o: bpy.types.Object, name: str) -> bpy.types.Object:
    apply_all(o)
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    c.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    c.data.flip_normals()
    bpy.data.objects.remove(o)
    return c


# --------------------------------------------------------------------------------------------
# Reference robot geometry (to model against)
# --------------------------------------------------------------------------------------------
class Robot:
    """Imports the shell + lower hull (base_link frame) and a few links in their own frames."""

    def __init__(self, jumper: Path):
        import xml.etree.ElementTree as ET

        self.urdf = jumper / "assets/jumper/urdf/jumper/urdf/jumper.urdf"
        self.meshes = self.urdf.parent.parent / "meshes/visual"
        root = ET.parse(self.urdf).getroot()
        self.offsets = {}
        for j in root.findall("joint"):
            child = j.find("child").get("link")
            xyz = [float(v) for v in j.find("origin").get("xyz").split()]
            self.offsets[child] = (j.find("parent").get("link"), G3 @ Vector(xyz))
        self.shell = self._import("upper_shell_link", in_base=True)
        self.hull = self._import("base_link", in_base=True)
        me = self.shell.data
        self.shell_bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])
        both = [self.shell, self.hull]
        verts, polys = [], []
        for o in both:
            base = len(verts)
            verts += [v.co.copy() for v in o.data.vertices]
            polys += [[base + i for i in p.vertices] for p in o.data.polygons]
        self.body_bvh = BVHTree.FromPolygons(verts, polys)

    def link_offset_in_base(self, link: str) -> Vector:
        off = Vector()
        n = link
        while n in self.offsets:
            parent, o = self.offsets[n]
            off += o
            n = parent
        return off

    def _import(self, link: str, in_base: bool) -> bpy.types.Object:
        bpy.ops.wm.stl_import(filepath=str(self.meshes / f"{link}.stl"))
        o = bpy.context.selected_objects[0]
        o.name = f"ref_{link}"
        o.data.transform(G3.to_4x4())
        if in_base and link != "base_link":
            o.data.transform(Matrix.Translation(self.link_offset_in_base(link)))
        o.hide_render = True
        return o

    def link_ref(self, link: str) -> bpy.types.Object:
        """Reference mesh of a link in its own frame."""
        return self._import(link, in_base=False)

    def top(self, x: float, z: float, default: float | None = None) -> float:
        """Shell surface height under (x, z); off the shell, the nearest point inward toward the centre."""
        for k in range(40):
            s = 1 - k * 0.025
            hit = self.shell_bvh.ray_cast(Vector((x * s, 0.3, -0.009 + (z + 0.009) * s)), Vector((0, -1, 0)), 1.0)
            if hit[0] is not None:
                if k == 0 or default is None:
                    return hit[0].y
                return default
        return default if default is not None else 0.07

    def surface(self, origin, direction):
        hit = self.body_bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 1.0)
        return (hit[0], hit[1]) if hit[0] is not None else (None, None)

    def cleanup(self):
        for o in list(bpy.data.objects):
            if o.name.startswith("ref_"):
                bpy.data.objects.remove(o)


# --------------------------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------------------------
def piece(name: str, objs: list[bpy.types.Object], attach: str, kind: str, extras: dict | None = None):
    """Group finished objects under an empty that becomes one glTF node with extras."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e["attach"] = attach
    e["kind"] = kind
    top = -1.0
    if len(objs) > 1:
        objs = [join(name + "_mesh", objs)]
        # merge same-material slots so each material is one primitive (one draw call)
        o = objs[0]
        bpy.context.view_layer.objects.active = o
        first: dict[str, int] = {}
        for i, slot in enumerate(o.material_slots):
            first.setdefault(slot.material.name if slot.material else "", i)
        for poly in o.data.polygons:
            slot = o.material_slots[poly.material_index]
            poly.material_index = first[slot.material.name if slot.material else ""]
        for x in bpy.context.selected_objects:
            x.select_set(False)
        o.select_set(True)
        bpy.ops.object.material_slot_remove_unused()
    for o in objs:
        o.parent = e
        if o.type == "MESH":
            top = max(top, max((v.co.y for v in o.data.vertices), default=-1))
    e["top"] = round(top, 5)
    for k, v in (extras or {}).items():
        e[k] = v
    return e


def export(path: Path, roots: list[bpy.types.Object]) -> None:
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for r in roots:
        r.select_set(True)
        for c in r.children_recursive:
            c.select_set(True)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=False,
        export_apply=True,
        export_extras=True,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )


def clear_pieces() -> None:
    for o in list(bpy.data.objects):
        if not o.name.startswith("ref_"):
            bpy.data.objects.remove(o)
