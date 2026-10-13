"""Prove that public/models/crab/jumper.glb is kinematically identical to MuJoCo's jumper.xml.

For HOME and N random poses inside the joint limits it compares every body's world position from
MuJoCo (data.xpos after mj_forward, mapped to game axes: game.x = mj.y, game.y = mj.z,
game.z = mj.x) with forward kinematics over the GLB node tree, where each link node is rotated
about its extras.axis by the joint angle (exactly what src/crab/rig.ts does).

It also writes dev/fixtures/crab-fk.json so dev/crab-fk.html can repeat the check on the real
three.js rig in the browser.

    /path/to/python tools/check_crab_fk.py --jumper /path/to/jumper --glb public/models/crab/jumper.glb
Needs mujoco and numpy.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import mujoco
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--jumper", required=True)
ap.add_argument("--glb", default="public/models/crab/jumper.glb")
ap.add_argument("--poses", type=int, default=12)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--fixture", default="dev/fixtures/crab-fk.json")
args = ap.parse_args()

JOINT_NAMES = [
    "LF_J0_joint", "LF_J1_joint", "LF_J2_joint", "LF_J3_joint", "LF_J4_joint",
    "RF_J0_joint", "RF_J1_joint", "RF_J2_joint", "RF_J3_joint", "RF_J4_joint",
    "LM_J0_joint", "LM_J1_joint", "LM_J2_joint",
    "RM_J0_joint", "RM_J1_joint", "RM_J2_joint",
    "LR_J0_joint", "LR_J1_joint", "LR_J2_joint",
    "RR_J0_joint", "RR_J1_joint", "RR_J2_joint",
]


def read_glb(path: Path) -> dict:
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == 0x4E4F534A
    return json.loads(data[20 : 20 + clen])


def quat_to_mat(q):  # glTF xyzw
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def axis_angle(axis, a):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


gltf = read_glb(Path(args.glb))
nodes = gltf["nodes"]
parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []):
        parent[c] = i
links = {n["name"]: i for i, n in enumerate(nodes) if n.get("extras", {}).get("link")}


def glb_fk(q: dict[str, float]) -> dict[str, np.ndarray]:
    cache: dict[int, tuple[np.ndarray, np.ndarray]] = {}

    def world(i: int):
        if i in cache:
            return cache[i]
        n = nodes[i]
        t = np.array(n.get("translation", [0, 0, 0]), float)
        R = quat_to_mat(n.get("rotation", [0, 0, 0, 1]))
        s = np.array(n.get("scale", [1, 1, 1]), float)
        ex = n.get("extras", {})
        if ex.get("joint"):
            R = R @ axis_angle(ex["axis"], q[ex["joint"]])
        if i in parent:
            pR, pt = world(parent[i])
            Rw, tw = pR @ (R * s), pR @ t + pt
        else:
            Rw, tw = R * s, t
        cache[i] = (Rw, tw)
        return cache[i]

    return {name: world(i)[1] for name, i in links.items()}


model = mujoco.MjModel.from_xml_path(str(Path(args.jumper) / "assets/jumper/jumper.xml"))
data = mujoco.MjData(model)
bundle = json.loads((Path(args.jumper) / "out/bundle_example/jumper/locomotion.json").read_text())
home = bundle["default_joint_pos"]
rng = np.random.default_rng(args.seed)
poses = [dict(home)]
for _ in range(args.poses):
    q = {}
    for jn in JOINT_NAMES:
        lo, hi = model.jnt_range[model.joint(jn).id]
        q[jn] = float(rng.uniform(lo, hi))
    poses.append(q)

M = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], float)  # game = M @ mj
fixture = {"joints": JOINT_NAMES, "bodies": sorted(links), "poses": []}
worst = 0.0
worst_at = ""
for pi, q in enumerate(poses):
    data.qpos[:] = 0
    data.qpos[3] = 1  # base at the origin, identity orientation
    for jn, v in q.items():
        data.qpos[model.jnt_qposadr[model.joint(jn).id]] = v
    mujoco.mj_forward(model, data)
    ours = glb_fk(q)
    expected = {}
    for name in links:
        mj = M @ data.xpos[model.body(name).id]
        expected[name] = [round(float(x), 7) for x in mj]
        err = float(np.linalg.norm(ours[name] - mj))
        if err > worst:
            worst, worst_at = err, f"pose {pi} {name}"
    fixture["poses"].append({"q": [q[j] for j in JOINT_NAMES], "xpos": expected})

print(f"bodies compared: {len(links)} x {len(poses)} poses (HOME + {args.poses} random)")
print(f"max position error: {worst * 1000:.6f} mm ({worst_at})")
Path(args.fixture).parent.mkdir(parents=True, exist_ok=True)
Path(args.fixture).write_text(json.dumps(fixture))
print(f"wrote {args.fixture}")
raise SystemExit(0 if worst < 1e-3 else 1)
