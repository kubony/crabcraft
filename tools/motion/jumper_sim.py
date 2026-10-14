"""Headless closed-loop host for the Jumper example bundle: MuJoCo + onnxruntime + the
bundle's own controller extension (runtime/mjlab/<platform>/controller.so).

The controller builds every observation and decodes every action exactly as the robot does
(deploy/fsm, the `play --app` host). This module only supplies what a host must supply:
the robot state in wire order, the operator's input, one ONNX inference when asked, and a
simulated servo that tracks the controller's joint targets with its own gains.

Physics is reproduced from the upstream training configuration rather than copied from
`jumper.xml`, which is tuned for its own 1 ms timestep (see export_web_robot.py upstream):

* contact parameters of `tasks/jumper/common/constants.py::HYBRID_COLLISION` (per-leg
  collision bitmasks, foot condim 3 / friction 1.2 / priority 1, solref (0.02, 1),
  solimp (0.8, 0.9, 0.002, 0.5, 2));
* mjlab's solver settings for the velocity family (Newton, 10 iterations, 20 line-search
  iterations, ccd_iterations 50, implicitfast, pyramidal cone);
* each mode's own physics timestep from its contract (`control.sim_dt`: locomotion 1 ms,
  jump 2.5 ms, claws/gestures/dances 5 ms), switched at control-tick boundaries. The host
  ticks the controller at 200 Hz, the fastest mode's rate, as `play --app` does;
* the servo: PD with the controller's kp/kd, torque clamped by the measured torque-speed
  curve (exp decay with cutoff) and the 300 ms thermal peak budget
  (`tasks/jumper/common/actuator.py`), armature/damping/frictionloss from the MJCF.

Run with a Python that has mujoco 3.11 + onnxruntime, pointing JUMPER_ROOT at a checkout of
https://github.com/KingKongRobotics/jumper:
    JUMPER_ROOT=/path/to/jumper python -I tools/motion/<script>.py

The bundle defaults to the jumper checkout's example bundle (`out/bundle_example/jumper`), which
recorded the walking, jump, claw, gesture and dance clips. `Host(bundle=...)` runs another one: the
six skill clips were recorded through the crabcraft bundle (`scripts/deploy.py --manifests
deploy/crabcraft.manifests.json` on the jumper branch that carries `jumper.skill_*`), which is the
example bundle's modes plus the six skills.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import mujoco
import numpy as np

JUMPER = Path(os.environ.get("JUMPER_ROOT", "jumper"))
BUNDLE = JUMPER / "out" / "bundle_example" / "jumper"
ASSETS = JUMPER / "assets" / "jumper"
JUMPER_XML = ASSETS / "jumper.xml"

# --- hardware facts, upstream tasks/jumper/common/{constants,actuator}.py + motor_config.yaml
STAND_Z = 0.10647
HOME = {
    "LF_J0_joint": -0.5507, "LF_J1_joint": -1.0658, "LF_J2_joint": -0.4408, "LF_J3_joint": -1.374,
    "LF_J4_joint": 0.0,
    "RF_J0_joint": 0.5524, "RF_J1_joint": -1.066, "RF_J2_joint": 0.4414, "RF_J3_joint": 1.4173,
    "RF_J4_joint": 0.0,
    "LM_J0_joint": 0.0012, "LM_J1_joint": 0.5356, "LM_J2_joint": -1.8271,
    "RM_J0_joint": -0.0012, "RM_J1_joint": -0.5376, "RM_J2_joint": 1.8313,
    "LR_J0_joint": 0.6313, "LR_J1_joint": 0.5534, "LR_J2_joint": -1.8648,
    "RR_J0_joint": -0.6326, "RR_J1_joint": -0.5548, "RR_J2_joint": 1.8678,
}
LEGS = ("LF", "RF", "LM", "RM", "LR", "RR")
FEET = ("LF_palm_pad_b_link", "RF_palm_pad_b_link", "LM_foot_tip_link", "RM_foot_tip_link",
        "LR_foot_tip_link", "RR_foot_tip_link")
RPM = 2.0 * math.pi / 60.0
PLATEAU = 1.7464
CORNER = 293.5 * RPM
DECAY = 240.5 * RPM
CUTOFF = 611.0 * RPM
CONTINUOUS = 1.2
PEAK_DURATION = 0.3
THERMAL_TAU = PEAK_DURATION / math.log(1.0 / (1.0 - (CONTINUOUS / PLATEAU) ** 2))

FOOT_FRICTION = "1.2 0.01 0.01"
SOLREF = "0.02 1"
SOLIMP = "0.8 0.9 0.002 0.5 2"
GROUND_BIT = 1
LEG_BIT = {leg: 1 << (i + 1) for i, leg in enumerate(LEGS)}
ALL_LEG_BITS = sum(LEG_BIT.values())

CONTROL_DT = 0.005  # the host ticks the controller at 200 Hz, the bundle's fastest mode


def _strip_comments(text: str) -> str:
    out, i = [], 0
    while True:
        s = text.find("<!--", i)
        if s < 0:
            out.append(text[i:])
            return "".join(out)
        out.append(text[i:s])
        e = text.find("-->", s)
        if e < 0:
            return "".join(out)
        i = e + 3


def build_mjcf(*, timestep: float = 0.005, render: bool = True, floor_size: float = 20.0) -> str:
    """The training model as MJCF text: jumper.xml + the training contact/solver setup,
    one <motor> per joint (the host computes the servo torque), a floor and a keyframe."""
    root = ET.fromstring(_strip_comments(JUMPER_XML.read_text("utf-8")))
    model = ET.Element("mujoco", model="jumper_crabcraft")
    ET.SubElement(model, "compiler", angle="radian", meshdir=str(ASSETS), autolimits="true")
    ET.SubElement(model, "option", timestep=f"{timestep:g}", integrator="implicitfast",
                  solver="Newton", iterations="10", ls_iterations="20", tolerance="1e-8",
                  ls_tolerance="0.01", cone="pyramidal", impratio="1", gravity="0 0 -9.81")
    ET.SubElement(model, "size", memory="64M")
    vis = ET.SubElement(model, "visual")
    ET.SubElement(vis, "global", offwidth="1920", offheight="1080", azimuth="150", elevation="-18")
    ET.SubElement(vis, "quality", shadowsize="4096", offsamples="8")
    ET.SubElement(vis, "headlight", ambient="0.35 0.35 0.38", diffuse="0.45 0.45 0.45", specular="0.1 0.1 0.1")
    model.append(root.find("default"))
    asset = root.find("asset")
    ET.SubElement(asset, "texture", name="grid", type="2d", builtin="checker", width="512", height="512",
                  rgb1="0.80 0.74 0.62", rgb2="0.72 0.66 0.55", mark="edge", markrgb="0.6 0.55 0.46")
    ET.SubElement(asset, "material", name="floor", texture="grid", texrepeat="40 40", reflectance="0.08")
    ET.SubElement(asset, "texture", name="sky", type="skybox", builtin="gradient", rgb1="0.55 0.7 0.9",
                  rgb2="0.95 0.92 0.85", width="256", height="256")
    model.append(asset)

    body = root.find("worldbody/body")
    for parent in body.iter():
        for geom in list(parent.findall("geom")):
            cls = geom.get("class")
            if cls not in {"visual", "collision"}:
                parent.remove(geom)  # CAD reference markers
                continue
            if cls == "visual":
                if not render:
                    parent.remove(geom)
                continue
            name = geom.get("name", "")
            leg = name[:2] if name[:2] in LEG_BIT else None
            is_foot = name in {f"{f}_meshcol" for f in FEET}
            if leg:
                geom.set("contype", str(GROUND_BIT | LEG_BIT[leg]))
                geom.set("conaffinity", str(ALL_LEG_BITS & ~LEG_BIT[leg]))
            else:
                geom.set("contype", str(GROUND_BIT))
                geom.set("conaffinity", "0")
            geom.set("condim", "3" if is_foot else "1")
            geom.set("priority", "1" if is_foot else "0")
            if is_foot:
                geom.set("friction", FOOT_FRICTION)
            geom.set("solref", SOLREF)
            geom.set("solimp", SOLIMP)
            if render:
                geom.set("group", "3")  # hide collision hulls in renders
    world = ET.SubElement(model, "worldbody")
    ET.SubElement(world, "light", name="sun", pos="0.6 -0.8 2.0", dir="-0.3 0.4 -1", directional="true",
                  diffuse="0.75 0.72 0.66", specular="0.25 0.25 0.25", castshadow="true")
    ET.SubElement(world, "geom", name="floor", type="plane", size=f"{floor_size} {floor_size} 0.05",
                  material="floor", contype="1", conaffinity="1", condim="3", friction="1 0.005 0.0001")
    world.append(body)
    joints = [j for j in body.iter("joint") if j.get("type") != "free"]
    act = ET.SubElement(model, "actuator")
    for j in joints:
        ET.SubElement(act, "motor", name=j.get("name"), joint=j.get("name"), gear="1",
                      ctrlrange=f"{-PLATEAU} {PLATEAU}", forcerange=f"{-PLATEAU} {PLATEAU}")
    sens = root.find("sensor")
    if sens is not None:
        model.append(sens)
    kf = ET.SubElement(model, "keyframe")
    qpos = [0.0, 0.0, STAND_Z, 1.0, 0.0, 0.0, 0.0] + [HOME[j.get("name")] for j in joints]
    ET.SubElement(kf, "key", name="init_state", qpos=" ".join(f"{v:g}" for v in qpos))
    return ET.tostring(model, encoding="unicode")


def load_model(**kw) -> mujoco.MjModel:
    return mujoco.MjModel.from_xml_string(build_mjcf(**kw))


def servo_limit(speed: np.ndarray) -> np.ndarray:
    w = np.abs(speed)
    lim = PLATEAU * np.exp(-np.clip(w - CORNER, 0.0, None) / DECAY)
    return np.where(w >= CUTOFF, 0.0, lim)


def extension_path(bundle: Path) -> Path:
    """This machine's controller extension inside `bundle`, as its bundle.json lists it.

    macOS: the cross-built universal2 file when the bundle has one, else the build machine's
    (`macosx-<version>-arm64`, keyed by `sysconfig.get_platform()` where it was built)."""
    manifest = json.loads((bundle / "bundle.json").read_text("utf-8"))
    extensions = (manifest["runtimes"].get("mjlab") or {}).get("extensions", {})
    prefix = "macosx" if sys.platform == "darwin" else "linux" if sys.platform.startswith("linux") else "win"
    keys = sorted(k for k in extensions if k.startswith(prefix))
    keys.sort(key=lambda k: "universal2" not in k)
    if not keys:
        raise SystemExit(f"{bundle}: no controller extension for {sys.platform} in bundle.json "
                         f"(it has {sorted(extensions)})")
    return bundle / extensions[keys[0]]["file"]


_CONTROLLERS: dict[str, object] = {}


def _load_controller(bundle: Path = BUNDLE):
    path = extension_path(bundle).resolve()
    if str(path) in _CONTROLLERS:
        return _CONTROLLERS[str(path)]
    if _CONTROLLERS:
        # One extension module per process: a second `mjrl_fsm` would shadow the first.
        raise SystemExit(f"this process already loaded {next(iter(_CONTROLLERS))}; run {path} in another")
    loader = importlib.machinery.ExtensionFileLoader("mjrl_fsm", str(path))
    spec = importlib.util.spec_from_file_location("mjrl_fsm", path, loader=loader)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _CONTROLLERS[str(path)] = module
    return module


@dataclass
class Frame:
    t: float
    qpos: np.ndarray
    mode: str
    running: bool
    contacts: np.ndarray  # 6 bools, LEGS order
    target: np.ndarray


@dataclass
class Recording:
    frames: list[Frame] = field(default_factory=list)
    marks: dict[str, list[float]] = field(default_factory=dict)

    def mark(self, name: str, t: float) -> None:
        self.marks.setdefault(name, []).append(t)

    def arrays(self):
        t = np.array([f.t for f in self.frames])
        qpos = np.stack([f.qpos for f in self.frames])
        contacts = np.stack([f.contacts for f in self.frames])
        modes = [f.mode for f in self.frames]
        running = np.array([f.running for f in self.frames])
        target = np.stack([f.target for f in self.frames])
        return t, qpos, contacts, modes, running, target


class Host:
    """One robot, one controller, one floor. `step()` advances one 5 ms control tick."""

    def __init__(self, *, operators: bool = False, render: bool = True, bundle: Path | None = None):
        import onnxruntime as ort

        bundle = Path(bundle) if bundle is not None else BUNDLE
        self.bundle = bundle
        self.mjrl_fsm = _load_controller(bundle)
        manifest = json.loads((bundle / "bundle.json").read_text("utf-8"))
        self.contracts_text = {m: (bundle / e["contract"]).read_text("utf-8") for m, e in manifest["modes"].items()}
        self.contracts = {m: json.loads(t) for m, t in self.contracts_text.items()}
        trajectories = {m: (bundle / e["trajectory"]).read_text("utf-8")
                        for m, e in manifest["modes"].items() if e.get("trajectory")}
        self.wire: list[str] = next(iter(self.contracts.values()))["wire_joint_order"]
        limits = self.contracts["locomotion"]["joint_limits"]
        gait = next((t.get("params") or {} for c in self.contracts.values()
                     for t in c["observation"]["terms"] if t["name"] == "gait_phase"), {})
        self.fsm = self.mjrl_fsm.Fsm(
            (bundle / "controller.toml").read_text("utf-8"),
            self.contracts_text,
            {
                "joint_names": self.wire,
                "joint_pos_lo": [limits[n][0] for n in self.wire],
                "joint_pos_hi": [limits[n][1] for n in self.wire],
                "output_rate_hz": 1.0 / CONTROL_DT,
                "gait_period": gait.get("period"),
                "gait_gate_threshold": gait.get("command_threshold"),
            },
            0,
            trajectories,
            operators,
        )
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        self.sessions = {m: ort.InferenceSession(str(bundle / e["models"]["onnx"]), so,
                                                 providers=["CPUExecutionProvider"])
                         for m, e in manifest["modes"].items()}
        self.inputs = {m: s.get_inputs()[0].name for m, s in self.sessions.items()}
        self.sim_dt = {m: float(c["control"]["sim_dt"]) for m, c in self.contracts.items()}

        self.model = load_model(render=render)
        self.data = mujoco.MjData(self.model)
        m = self.model
        jid = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n) for n in self.wire]
        self.qadr = np.array([m.jnt_qposadr[j] for j in jid])
        self.dadr = np.array([m.jnt_dofadr[j] for j in jid])
        self.act = np.array([mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, n) for n in self.wire])
        self.floor = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, "floor")
        self.foot_geoms = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, f"{f}_meshcol") for f in FEET]
        mujoco.mj_resetDataKeyframe(m, self.data, 0)
        mujoco.mj_forward(m, self.data)
        self.tau = np.zeros(len(self.wire))
        self.thermal = np.zeros(len(self.wire))
        self.target = np.array([HOME[n] for n in self.wire])
        self.kp = np.full(len(self.wire), 10.0)
        self.kd = np.full(len(self.wire), 0.5)
        self.tick = 0
        self.mode = "locomotion"
        self.rec = Recording()
        self.inferences = 0
        self.log: list[tuple] = []

    # ------------------------------------------------------------------ inputs
    @property
    def t(self) -> float:
        return self.tick * CONTROL_DT

    @property
    def now_us(self) -> int:
        return self.tick * int(CONTROL_DT * 1e6)

    def command(self, vx: float, vy: float, wz: float) -> None:
        self._cmd = (vx, vy, wz)

    _cmd = (0.0, 0.0, 0.0)
    _pad_buttons: tuple[str, ...] = ()
    _pad_axes: dict = {}
    _pad_dpad = (0, 0)

    def pad(self, buttons=None, axes=None, dpad=None) -> None:
        """Set what the pad reports from the next tick on (pad service names; d-pad up = +1)."""
        if buttons is not None:
            self._pad_buttons = tuple(buttons)
        if axes is not None:
            self._pad_axes = dict(axes)
        if dpad is not None:
            self._pad_dpad = dpad

    def button(self, name: str, down: bool) -> None:
        b = set(self._pad_buttons)
        (b.add if down else b.discard)(name)
        self._pad_buttons = tuple(b)

    def key(self, name: str, down: bool) -> None:
        self.fsm.set_key(name, down, self.now_us)

    def press(self, name: str, hold: float = 0.05, *, pad: bool = True) -> None:
        """Press and release one pad button (or key) across real ticks, so `toggle`/`rise`/`fall` see it."""
        (self.button if pad else self.key)(name, True)
        self.run(hold)
        (self.button if pad else self.key)(name, False)
        self.step()

    # ------------------------------------------------------------------ loop
    def contacts(self) -> np.ndarray:
        d = self.data
        on = np.zeros(6, dtype=bool)
        for i in range(d.ncon):
            c = d.contact[i]
            g1, g2 = c.geom1, c.geom2
            if g1 == self.floor or g2 == self.floor:
                other = g2 if g1 == self.floor else g1
                if other in self.foot_geoms and c.dist < 1e-3:
                    on[self.foot_geoms.index(other)] = True
        return on

    def step(self) -> None:
        d, m = self.data, self.model
        now = self.now_us
        q = d.qpos[self.qadr]
        qd = d.qvel[self.dadr]
        quat = d.qpos[3:7]
        gyro = d.qvel[3:6]  # free joint angular velocity is already in the body frame
        self.fsm.set_state([float(v) for v in q], [float(v) for v in qd], [float(v) for v in self.tau],
                           [float(v) for v in quat], [float(v) for v in gyro], now)
        # Every tick, pad or not: a frame is also what says the operator is present.
        self.fsm.set_pad_frame(sorted(self._pad_buttons), self._pad_axes, self._pad_dpad[0], self._pad_dpad[1],
                               True, now)
        self.fsm.set_command(*self._cmd, now)
        mode = self.fsm.tick(now)
        if mode is not None:
            obs = np.asarray([self.fsm.observation()], dtype=np.float32)
            act = self.sessions[mode].run(None, {self.inputs[mode]: obs})[0][0]
            self.fsm.resume([float(v) for v in act])
            self.inferences += 1
        for entry in self.fsm.take_log():
            self.log.append(entry)
        self.mode = self.fsm.mode
        self.target = np.asarray(self.fsm.positions(), dtype=np.float64)
        self.kp = np.asarray(self.fsm.kp(), dtype=np.float64)
        self.kd = np.asarray(self.fsm.kd(), dtype=np.float64)
        dt = self.sim_dt.get(self.mode, 0.005)
        n = max(1, round(CONTROL_DT / dt))
        m.opt.timestep = CONTROL_DT / n
        for _ in range(n):
            q = d.qpos[self.qadr]
            qd = d.qvel[self.dadr]
            tau = self.kp * (self.target - q) - self.kd * qd
            lim = servo_limit(qd)
            lim = np.where(self.thermal >= 1.0, np.minimum(lim, CONTINUOUS), lim)
            tau = np.clip(tau, -lim, lim)
            self.thermal += ((tau / CONTINUOUS) ** 2 - self.thermal) * (m.opt.timestep / THERMAL_TAU)
            np.clip(self.thermal, 0.0, None, out=self.thermal)
            d.ctrl[self.act] = tau
            mujoco.mj_step(m, d)
        self.tau = tau
        self.tick += 1
        self.rec.frames.append(Frame(self.t, d.qpos.copy(), self.mode, bool(self.fsm.running_policy),
                                     self.contacts(), self.target.copy()))

    def run(self, seconds: float) -> None:
        for _ in range(int(round(seconds / CONTROL_DT))):
            self.step()

    def tilt_deg(self) -> float:
        w, x, y, z = self.data.qpos[3:7]
        upz = 1 - 2 * (x * x + y * y)
        return math.degrees(math.acos(max(-1.0, min(1.0, upz))))


class Shooter:
    """Offscreen MuJoCo renders that follow the robot, for checking rollouts by eye and for MP4s."""

    def __init__(self, model: mujoco.MjModel, width: int = 960, height: int = 540):
        self.model = model
        self.renderer = mujoco.Renderer(model, height=height, width=width)
        self.cam = mujoco.MjvCamera()
        self.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        self.cam.distance = 0.75
        self.cam.azimuth = 140
        self.cam.elevation = -18
        self.opt = mujoco.MjvOption()
        self.opt.geomgroup[:] = [1, 0, 1, 0, 0, 0]
        self._look = None

    def frame(self, data: mujoco.MjData, *, smooth: float = 0.15) -> np.ndarray:
        target = data.qpos[:3].copy()
        target[2] = 0.07
        self._look = target if self._look is None else self._look + (target - self._look) * smooth
        self.cam.lookat[:] = self._look
        self.renderer.update_scene(data, self.cam, self.opt)
        return self.renderer.render()

    def save(self, data: mujoco.MjData, path: str) -> None:
        from PIL import Image

        Image.fromarray(self.frame(data, smooth=1.0)).save(path)
