"""Decimate Jumper's visual STLs into one GLB for Robot Mode's renderer.

One node per MuJoCo body, named after the body, holding that body's visual mesh in the body's
own frame (MuJoCo axes, metres): the renderer places each node at the body pose the physics
reports, so nothing here is posed. Colours are not stored; the renderer picks a material from
the MJCF rgba recorded in public/robot/jumper/robot-package.json (`visualRgba`).

Needs trimesh and fast-simplification (MIT), which the read-only interpreter lacks:
    uv venv .venv && uv pip install --python .venv/bin/python trimesh fast-simplification numpy
    .venv/bin/python tools/build_robot_visual.py --jumper <jumper repo> --out public/robot/jumper/visual.glb
"""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import trimesh


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jumper", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ratio", type=float, default=0.32, help="kept fraction of triangles")
    ap.add_argument("--min-faces", type=int, default=600)
    ap.add_argument("--max-faces", type=int, default=14000)
    args = ap.parse_args()

    src = args.jumper / "assets/jumper/jumper.xml"
    root = ET.fromstring(re.sub(r"<!--.*?-->", "", src.read_text("utf-8"), flags=re.S))
    mesh_file = {m.get("name"): m.get("file") for m in root.iter("mesh")}

    scene = trimesh.Scene()
    total_in = total_out = 0
    for body in root.iter("body"):
        geom = next((g for g in body.findall("geom") if g.get("class") == "visual"), None)
        if geom is None:
            continue
        if geom.get("pos") or geom.get("quat"):
            raise SystemExit(f"{body.get('name')}: visual geom is offset; this tool assumes the body frame")
        mesh = trimesh.load(src.parent / mesh_file[geom.get("mesh")], force="mesh")
        mesh.merge_vertices()
        n_in = len(mesh.faces)
        target = int(np.clip(n_in * args.ratio, args.min_faces, args.max_faces))
        if target < n_in:
            mesh = mesh.simplify_quadric_decimation(face_count=target)
        mesh.remove_unreferenced_vertices()
        total_in += n_in
        total_out += len(mesh.faces)
        name = body.get("name")
        # No normals: the renderer computes creased normals.
        mesh = trimesh.Trimesh(vertices=mesh.vertices.astype(np.float32), faces=mesh.faces, process=False)
        scene.add_geometry(mesh, node_name=name, geom_name=name)
        print(f"{name:32s} {n_in:7d} -> {len(mesh.faces):6d}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    data = scene.export(file_type="glb", include_normals=False)
    args.out.write_bytes(data)
    print(f"{total_in} -> {total_out} triangles, {len(data) / 1e6:.2f} MB -> {args.out}")


if __name__ == "__main__":
    main()
