"""Export Jumper's physics model for Robot Mode (public/robot/jumper/).

Reproduces what the upstream exporter
`jumper/assets/jumper/tools/export_web_robot.py` writes, without its editable
install (it imports `mjlab` and the task configs, which pull in torch and warp).
Every number below is read from, or copied with a pointer to, the upstream file
that owns it, so a drift can be checked by eye:

  * collision: `tasks/jumper/common/constants.py::HYBRID_COLLISION`, resolved the
    way `mjlab/utils/spec_config.py::CollisionCfg.edit_spec` resolves it
    (matched geoms get the per-leg masks, condim, priority, friction, solref and
    solimp; everything else gets contype = conaffinity = 0);
  * solver: `mjlab/tasks/velocity/velocity_env_cfg.py` (timestep 0.005,
    iterations 10, ls_iterations 20) over `mjlab/sim/sim.py::MujocoCfg`'s
    defaults, plus `ccd_iterations = 50` from `common/velocity_env.py`;
  * the standing keyframe `init_state` from `constants.HOME` and `STAND_Z`;
  * the actuator facts (PD gains, armature, servo torque-speed curve and its
    thermal budget) from `constants.py` and `assets/jumper/motor/motor_config.yaml`.

Two deliberate differences from the upstream package, both size-only:

  * visual geoms are dropped. They are `density="0"` and `contype=0`, so they
    carry no mass and take part in no contact; the renderer draws its own
    decimated copies (tools/build_robot_visual.py);
  * only the collision meshes are copied.

`scene.xml` wraps the robot in the Robot Mode arena: the ground plane mjlab's
flat terrain uses (`terrain_entity.py::_import_ground_plane`) plus a few toys
as free bodies.

Usage (read-only interpreter with mujoco and PyYAML):
    python tools/export_robot.py --jumper <jumper repo> --out public/robot/jumper
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import mujoco
import numpy as np
import yaml

SCHEMA = "kk-robot-package/1"

# constants.py
HOME = {
    "LF_J0_joint": -0.5507, "LF_J1_joint": -1.0658,
    "LF_J2_joint": -0.4408, "LF_J3_joint": -1.374, "LF_J4_joint": 0.0,
    "RF_J0_joint": 0.5524, "RF_J1_joint": -1.066,
    "RF_J2_joint": 0.4414, "RF_J3_joint": 1.4173, "RF_J4_joint": 0.0,
    "LM_J0_joint": 0.0012, "LM_J1_joint": 0.5356, "LM_J2_joint": -1.8271,
    "RM_J0_joint": -0.0012, "RM_J1_joint": -0.5376, "RM_J2_joint": 1.8313,
    "LR_J0_joint": 0.6313, "LR_J1_joint": 0.5534, "LR_J2_joint": -1.8648,
    "RR_J0_joint": -0.6326, "RR_J1_joint": -0.5548, "RR_J2_joint": 1.8678,
}
STAND_Z = 0.10647
LEGS = ("LF", "RF", "LM", "RM", "LR", "RR")
FEET = (
    "LF_palm_pad_b_link", "RF_palm_pad_b_link",
    "LM_foot_tip_link", "RM_foot_tip_link",
    "LR_foot_tip_link", "RR_foot_tip_link",
)
LIMB_LINKS = (
    "LF_shoulder_link", "LF_upper_arm_link", "LF_forearm_link",
    "RF_shoulder_link", "RF_upper_arm_link", "RF_forearm_link",
    "LM_hip_link", "LM_thigh_link", "RM_hip_link", "RM_thigh_link",
    "LR_hip_link", "LR_thigh_link", "RR_hip_link", "RR_thigh_link",
)
TIP_LINKS = (
    "LF_palm_link", "LF_finger_link", "LF_finger_tip_link", "LF_palm_pad_f_link",
    "LF_finger_grip_insert_link", "LF_palm_grip_insert_link",
    "RF_palm_link", "RF_finger_link", "RF_finger_tip_link", "RF_palm_pad_f_link",
    "RF_finger_grip_insert_link", "RF_palm_grip_insert_link",
    "LM_calf_link", "RM_calf_link", "LR_calf_link", "RR_calf_link",
)
CHASSIS_LINKS = ("base_link", "upper_shell_link", "camera_link", "tof_sensor_link", "display_module_link")
FOOT_FRICTION = (1.2, 0.01, 0.01)
CONTACT_SOLREF = (0.02, 1.0)
CONTACT_SOLIMP = (0.8, 0.90, 0.002, 0.5, 2.0)
STIFFNESS, DAMPING, ARMATURE = 10.0, 0.5, 0.0015
GROUND_BIT = 1
LEG_BIT = {leg: 1 << (i + 1) for i, leg in enumerate(LEGS)}
ALL_LEG_BITS = sum(LEG_BIT.values())

# mjlab MujocoCfg defaults overridden by velocity_env_cfg, and ccd from velocity_env.py
SIM_OPTIONS = {
    "timestep": "0.005",
    "integrator": "implicitfast",
    "solver": "Newton",
    "iterations": "10",
    "ls_iterations": "20",
    "ccd_iterations": "50",
    "gravity": "0 0 -9.81",
    "cone": "pyramidal",
    "impratio": "1",
    "tolerance": "1e-08",
    "ls_tolerance": "0.01",
}

_RPM = 2.0 * math.pi / 60.0


def resolved_collision(geom_name: str) -> dict[str, str] | None:
    """CollisionCfg.edit_spec for HYBRID_COLLISION, for one geom name."""
    foot_names = tuple(f"{f}_meshcol" for f in FEET)
    link_names = tuple(f"{l}_meshcol" for l in CHASSIS_LINKS + LIMB_LINKS + TIP_LINKS)
    if geom_name not in foot_names + link_names:
        return None
    leg = next((l for l in LEGS if geom_name.startswith(f"{l}_")), None)
    contype = GROUND_BIT | LEG_BIT[leg] if leg else GROUND_BIT
    conaffinity = ALL_LEG_BITS & ~LEG_BIT[leg] if leg else 0
    foot = geom_name in foot_names
    out = {
        "contype": str(contype),
        "conaffinity": str(conaffinity),
        "condim": "3" if foot else "1",
        "priority": "1" if foot else "0",
        "solref": " ".join(f"{v:g}" for v in CONTACT_SOLREF),
        "solimp": " ".join(f"{v:g}" for v in CONTACT_SOLIMP),
    }
    if foot:
        out["friction"] = " ".join(f"{v:g}" for v in FOOT_FRICTION)
    return out


def strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def build_robot(source_xml: Path) -> tuple[ET.Element, list[ET.Element], dict[str, list[float]]]:
    supplied = ET.fromstring(strip_comments(source_xml.read_text("utf-8")))
    model = ET.Element("mujoco", model=supplied.get("model", "robot"))
    ET.SubElement(model, "compiler", angle="radian", meshdir="meshes/", autolimits="true")
    ET.SubElement(model, "option", **SIM_OPTIONS)
    model.append(supplied.find("default"))
    asset = supplied.find("asset")
    model.append(asset)

    body = supplied.find("worldbody/body")
    visual_rgba: dict[str, list[float]] = {}
    used_meshes: set[str] = set()
    for parent in body.iter():
        for geom in list(parent.findall("geom")):
            cls = geom.get("class")
            name = geom.get("name")
            if cls == "visual":
                visual_rgba[parent.get("name")] = [float(v) for v in geom.get("rgba", "1 1 1 1").split()]
                parent.remove(geom)
                continue
            if cls != "collision":
                parent.remove(geom)
                continue
            attrs = resolved_collision(name)
            if attrs is None:
                raise SystemExit(f"collision geom {name!r} is not in HYBRID_COLLISION")
            for k, v in attrs.items():
                geom.set(k, v)
            used_meshes.add(geom.get("mesh"))
    for mesh in list(asset.findall("mesh")):
        if mesh.get("name") not in used_meshes:
            asset.remove(mesh)
    world = ET.SubElement(model, "worldbody")
    world.append(body)
    joints = [j for j in body.iter("joint") if j.get("type") != "free"]
    return model, joints, visual_rgba


def robot_keyframe_qpos(joints: list[ET.Element]) -> list[float]:
    return [0.0, 0.0, STAND_Z, 1.0, 0.0, 0.0, 0.0] + [HOME[j.get("name")] for j in joints]


# Toys for the tabletop arena: (name, kind, size, pos, rgba, mass)
TOYS = [
    ("ball", "sphere", (0.045,), (-0.44, 0.13, 0.045), (0.95, 0.95, 0.95, 1), 0.045),
    ("block_red", "box", (0.022, 0.022, 0.022), (-0.18, -0.52, 0.022), (0.85, 0.15, 0.12, 1), 0.03),
    ("block_blue", "box", (0.022, 0.022, 0.022), (-0.13, -0.58, 0.022), (0.15, 0.35, 0.85, 1), 0.03),
    ("block_yellow", "box", (0.022, 0.022, 0.022), (-0.155, -0.55, 0.066), (0.95, 0.75, 0.15, 1), 0.03),
    ("block_green", "box", (0.022, 0.022, 0.022), (0.62, 0.48, 0.022), (0.25, 0.7, 0.3, 1), 0.03),
    ("block_purple", "box", (0.016, 0.016, 0.016), (-0.30, 0.42, 0.016), (0.6, 0.3, 0.75, 1), 0.015),
]


# Static desk props, collidable so the robot bumps into them rather than through them:
# (name, kind, half-size, pos, z-rotation deg, rgba). Rendered by the page from this list.
PROPS = [
    ("book_1", "box", (0.105, 0.150, 0.016), (-0.46, -0.95, 0.016), 8.0, (0.16, 0.29, 0.45, 1)),
    ("book_2", "box", (0.095, 0.135, 0.014), (-0.45, -0.94, 0.046), -6.0, (0.62, 0.20, 0.16, 1)),
    ("book_3", "box", (0.085, 0.120, 0.012), (-0.47, -0.96, 0.072), 15.0, (0.85, 0.72, 0.45, 1)),
    ("mug", "cylinder", (0.042, 0.048), (-1.2, -0.12, 0.048), 0.0, (0.93, 0.92, 0.88, 1)),
]


def build_scene(robot_xml: ET.Element, joints: list[ET.Element]) -> ET.Element:
    scene = ET.fromstring(ET.tostring(robot_xml))
    scene.set("model", "jumper_tabletop")
    for old in scene.findall("keyframe"):
        scene.remove(old)
    world = scene.find("worldbody")
    # mjlab's flat terrain: a default plane geom (contype 1, conaffinity 1, condim 3).
    floor = ET.Element("geom", name="terrain", type="plane", size="0 0 0.01")
    world.insert(0, floor)
    for name, kind, size, pos, yaw, rgba in PROPS:
        half = math.radians(yaw) / 2
        ET.SubElement(
            world, "geom", name=f"prop_{name}", type=kind, size=" ".join(f"{v:g}" for v in size),
            pos=" ".join(f"{v:g}" for v in pos), quat=f"{math.cos(half):g} 0 0 {math.sin(half):g}",
            rgba=" ".join(f"{v:g}" for v in rgba), contype="1", conaffinity="1", condim="3", friction="0.6 0.005 0.0001",
        )
    for name, kind, size, pos, rgba, mass in TOYS:
        b = ET.SubElement(world, "body", name=f"toy_{name}", pos=" ".join(f"{v:g}" for v in pos))
        ET.SubElement(b, "freejoint", name=f"toy_{name}_free")
        g = ET.SubElement(
            b, "geom", name=f"toy_{name}", type=kind, size=" ".join(f"{v:g}" for v in size),
            mass=f"{mass:g}", rgba=" ".join(f"{v:g}" for v in rgba),
            contype="1", conaffinity="1",
        )
        if kind == "sphere":
            # A rubber ball that rolls and settles instead of rolling forever.
            g.set("condim", "6")
            g.set("friction", "0.9 0.01 0.003")
        else:
            g.set("condim", "3")
            g.set("friction", "0.7 0.005 0.0001")
    qpos = robot_keyframe_qpos(joints)
    for _, _, _, pos, _, _ in TOYS:
        qpos += [*pos, 1.0, 0.0, 0.0, 0.0]
    kf = ET.SubElement(scene, "keyframe")
    ET.SubElement(kf, "key", name="init_state", qpos=" ".join(f"{v:g}" for v in qpos))
    ET.indent(scene)
    return scene


def servo_curve(motor_yaml: Path) -> dict:
    spec = yaml.safe_load(motor_yaml.read_text("utf-8"))["motors"]["joint_servo"]["torque_speed"]
    assert spec["model"] == "exp_decay_with_cutoff", spec["model"]
    plateau = float(spec["plateau_torque_nm"])
    continuous = float(spec["thermal_continuous_torque_nm"])
    peak = float(spec["peak_duration_s"])
    return {
        "model": "exp_decay_with_cutoff",
        "plateauTorque": plateau,
        "cornerSpeed": float(spec["corner_speed_rpm"]) * _RPM,
        "decaySpeed": float(spec["decay_speed_rpm"]) * _RPM,
        "cutoffSpeed": float(spec["cutoff_speed_rpm"]) * _RPM,
        "continuousTorque": continuous,
        "peakDuration": peak,
        "thermalTimeConstant": peak / math.log(1.0 / (1.0 - (continuous / plateau) ** 2)),
    }


def verify(path: Path) -> tuple[dict[str, int], float]:
    model = mujoco.MjModel.from_xml_path(str(path))
    need = 2 * model.opt.timestep
    bad = sorted({float(v) for v in model.geom_solref[:, 0] if 0 < v < need})
    if bad:
        raise SystemExit(f"contact solref {bad} below 2*timestep={need:g}")
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0)
    mujoco.mj_forward(model, data)
    lows = []
    for foot in FEET:
        bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, foot)
        best = np.inf
        for g in range(model.ngeom):
            if model.geom_bodyid[g] != bid or model.geom_dataid[g] < 0:
                continue
            mid = model.geom_dataid[g]
            adr, num = model.mesh_vertadr[mid], model.mesh_vertnum[mid]
            verts = model.mesh_vert[adr: adr + num]
            rot = data.geom_xmat[g].reshape(3, 3)
            best = min(best, float((rot @ verts.T).T[:, 2].min()) + float(data.geom_xpos[g][2]))
        lows.append(best)
    lowest, spread = min(lows), (max(lows) - min(lows)) * 1000
    if not -1e-3 < lowest < 5e-3 or spread > 1.0:
        raise SystemExit(f"the keyframe does not stand: lowest foot {lowest*1000:.3f} mm, spread {spread:.3f} mm")
    counts = {k: int(getattr(model, k)) for k in ("nq", "nv", "nu", "njnt", "nbody", "ngeom", "nmesh")}
    return counts, lowest


def hash_tree(out: Path) -> dict[str, dict]:
    files = {}
    for p in sorted(out.rglob("*")):
        if p.is_file() and p.name != "robot-package.json":
            data = p.read_bytes()
            files[p.relative_to(out).as_posix()] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--jumper", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    jumper = args.jumper.resolve()
    out = args.out.resolve()
    source_xml = jumper / "assets/jumper/jumper.xml"

    robot, joints, visual_rgba = build_robot(source_xml)
    kf = ET.SubElement(robot, "keyframe")
    ET.SubElement(kf, "key", name="init_state", qpos=" ".join(f"{v:g}" for v in robot_keyframe_qpos(joints)))
    ET.indent(robot)

    out.mkdir(parents=True, exist_ok=True)
    meshes = out / "meshes"
    if meshes.exists():
        shutil.rmtree(meshes)
    meshes.mkdir()
    src_dir = source_xml.parent
    for tree in (robot,):
        for mesh in tree.findall("asset/mesh"):
            src = (src_dir / mesh.get("file")).resolve()
            flat = Path(mesh.get("file")).name
            shutil.copy2(src, meshes / flat)
            mesh.set("file", flat)
    ET.ElementTree(robot).write(out / "model.xml", encoding="utf-8", xml_declaration=True)
    scene = build_scene(robot, joints)
    ET.ElementTree(scene).write(out / "scene.xml", encoding="utf-8", xml_declaration=True)

    counts, feet = verify(out / "model.xml")
    scene_counts, _ = verify(out / "scene.xml")

    manifest = {
        "schema": SCHEMA,
        "robot": {
            "id": "jumper",
            "sourceXmlUpstreamName": "assets/jumper/jumper.xml",
            "coordinateSystem": "Z_UP_X_FORWARD",
            "units": "metres",
            "rootBody": "base_link",
            "standHeight": STAND_Z,
            "keyframe": "init_state",
        },
        "exportedBy": {
            "repository": "KingKongRobotics/jumper",
            "tool": "crabcraft tools/export_robot.py (reproduces assets/jumper/tools/export_web_robot.py)",
            "mujoco": mujoco.__version__,
            "differences": [
                "visual geoms removed (density 0, contype 0: no mass, no contact)",
                "only collision meshes copied",
            ],
        },
        "model": {"file": "model.xml", "counts": counts, "option": SIM_OPTIONS, "lowestFootAtKeyframe_m": feet},
        "scene": {
            "file": "scene.xml",
            "counts": scene_counts,
            "toys": [
                {"body": f"toy_{n}", "kind": k, "size": list(sz), "rgba": list(c)} for n, k, sz, _, c, _ in TOYS
            ],
            "props": [
                {"name": f"prop_{n}", "kind": k, "size": list(sz), "pos": list(p), "yawDeg": y, "rgba": list(c)}
                for n, k, sz, p, y, c in PROPS
            ],
        },
        "joints": [
            {
                "name": j.get("name"),
                "range": [float(v) for v in j.get("range").split()],
                "axis": [float(v) for v in j.get("axis").split()],
                "home": HOME[j.get("name")],
            }
            for j in joints
        ],
        "visualRgba": visual_rgba,
        "actuator": {
            "law": "pd_position",
            "stiffness": STIFFNESS,
            "damping": DAMPING,
            "armature": ARMATURE,
            "torqueSpeedCurve": servo_curve(jumper / "assets/jumper/motor/motor_config.yaml"),
        },
    }
    manifest["files"] = hash_tree(out)
    (out / "robot-package.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")
    total = sum(f["bytes"] for f in manifest["files"].values())
    print(f"exported {out}: {counts}, scene {scene_counts}, {total/1e6:.2f} MB, lowest foot {feet*1e6:.1f} um")


if __name__ == "__main__":
    main()
