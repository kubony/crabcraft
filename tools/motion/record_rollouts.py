"""Record the 720 jump spin and the back flip as rollouts of their policies in their own environment.

    JUMPER_ROOT=<jumper checkout> PYTHONPATH=<jumper checkout>:<jumper checkout>/rl \
        <jumper venv>/bin/python tools/motion/record_rollouts.py [--out scratch/motion-raw]

No game clip comes from here any more. The game's break_jumpspin and break_backflip were once
recorded this way, because the policies then shipped took off only from their training
environment's reset; the ones shipped now (`pw-jspin720-ho`, `pw-flip-brc`) take off from the
controller's handover, so record_clips.py records both through the crabcraft bundle like every
other move. This stays as a way to compare a jump in its own environment with the same jump
through the bundle.

Each rollout is one episode of the task's own environment: mjlab on native MuJoCo, play mode
(from HOME, no observation noise, no pushes) with the startup randomisation removed, at 200 Hz,
the exported actor (`tasks/jumper/<task>/out/crabcraft/actor.onnx`) choosing every action. It is
written in record_clips.py's raw format, the robot's state mapped onto jumper_sim's model by joint
name, so export_clips.py reads it like any other recording; its metadata says it is a direct
rollout and not the bundle.

Needs the jumper checkout's training environment (mjlab, rsl_rl) importable, hence PYTHONPATH and
no `-I`.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import mujoco
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jumper_sim import FEET, JUMPER, load_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# Game clip id -> (the task the policy trained on, the bundle-style mode name the game calls it).
ROLLOUTS = {
    "break_jumpspin": ("jumper.power_jumpspin720", "power_jumpspin"),
    "break_backflip": ("jumper.power_backflip", "power_backflip"),
}


def rollout(task: str):
    import mjrl.backend.select as sel
    from mjrl.backend import resolve

    sel.use_backend(resolve(backend="native", device="cpu", num_envs=1, training=False))
    import onnxruntime as ort
    import tasks
    import torch
    from mjlab.envs import ManagerBasedRlEnv
    from mjlab.rl import RslRlVecEnvWrapper

    here = Path(tasks.__file__).resolve().parent
    if here.parent.resolve() != JUMPER.resolve():
        raise SystemExit(f"`tasks` imports from {here}, not from JUMPER_ROOT={JUMPER}; put the "
                         "checkout first on PYTHONPATH")
    cfg = tasks.load_env_cfg(task, play=True)
    for name in ("base_com", "encoder_bias", "foot_friction", "push_robot"):
        cfg.events.pop(name, None)
    cfg.scene.num_envs = 1
    agent_cfg = tasks.load_agent_cfg(task)
    env = ManagerBasedRlEnv(cfg=cfg, device="cpu")
    wrapped = RslRlVecEnvWrapper(env, clip_actions=agent_cfg.clip_actions)
    onnx = JUMPER / "tasks" / Path(*task.split(".")) / "out" / "crabcraft" / "actor.onnx"
    sess = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name
    robot = env.scene["robot"]
    origin = env.scene.env_origins[0].cpu().numpy()
    dt = float(env.step_dt)
    n = round(cfg.episode_length_s / dt)

    def state():
        pos = robot.data.root_link_pos_w[0].cpu().numpy() - origin
        quat = robot.data.root_link_quat_w[0].cpu().numpy()
        q = robot.data.joint_pos[0].cpu().numpy()
        return pos, quat, q

    obs, _ = wrapped.reset()
    frames = [state()]
    with torch.inference_mode():
        for _ in range(n - 1):
            x = obs["actor"].cpu().numpy().astype(np.float32)
            act = torch.from_numpy(sess.run(None, {iname: x})[0])
            obs, _, dones, _ = wrapped.step(act)
            if bool(dones[0]):
                break  # the episode's own end; a reset frame would follow
            frames.append(state())
    meta = {"task": task, "actor": str(onnx.relative_to(JUMPER)), "control_dt": dt,
            "episode_s": float(cfg.episode_length_s), "agent": asdict(agent_cfg)["experiment_name"]}
    return frames, list(robot.joint_names), dt, meta


def to_model(frames, names, model: mujoco.MjModel):
    adr = {}
    for jn in names:
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, jn)
        if jid < 0:
            raise SystemExit(f"joint {jn} of the environment is not in jumper_sim's model")
        adr[jn] = model.jnt_qposadr[jid]
    qpos = np.zeros((len(frames), model.nq))
    for k, (pos, quat, q) in enumerate(frames):
        qpos[k, :3] = pos
        qpos[k, 3:7] = quat
        for jn, v in zip(names, q):
            qpos[k, adr[jn]] = v
    return qpos


def contacts(model: mujoco.MjModel, qpos: np.ndarray) -> np.ndarray:
    """Which of the six feet touch the floor in each frame, as jumper_sim.Host.contacts reads it."""
    data = mujoco.MjData(model)
    floor = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, "floor")
    feet = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, f"{f}_meshcol") for f in FEET]
    out = np.zeros((len(qpos), 6), dtype=bool)
    for k, q in enumerate(qpos):
        data.qpos[:] = q
        mujoco.mj_forward(model, data)
        for i in range(data.ncon):
            c = data.contact[i]
            if floor in (c.geom1, c.geom2):
                other = c.geom2 if c.geom1 == floor else c.geom1
                if other in feet and c.dist < 1e-3:
                    out[k, feet.index(other)] = True
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "scratch" / "motion-raw")
    ap.add_argument("--only", default="", help="clip ids, comma-separated")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    model = load_model(render=False)
    for cid, (task, mode) in ROLLOUTS.items():
        if only and cid not in only:
            continue
        frames, names, dt, meta = rollout(task)
        qpos = to_model(frames, names, model)
        t = np.arange(len(qpos)) * dt
        feet = contacts(model, qpos)
        air = ~feet.any(axis=1)
        z = qpos[:, 2]
        k = int(np.argmax(z))
        marks = {"trigger": [0.0], "locomotion": [float(t[k])]}
        meta = {**meta, "kind": "break", "source": mode, "method": "direct rollout",
                "marks": marks, "inferences": len(qpos) - 1,
                "log": [], "physics": "the task's training environment: mjlab, native MuJoCo, play mode, "
                                      "startup randomisation removed"}
        np.savez_compressed(
            args.out / f"{cid}.npz",
            t=t, qpos=qpos, contacts=feet, running=np.ones(len(qpos), dtype=bool),
            target=np.zeros((len(qpos), 22)), mode=np.zeros(len(qpos), dtype=np.int8),
            mode_names=np.array([mode]), meta=np.array(json.dumps(meta)),
        )
        print(f"{cid:16s} {task}: {len(qpos)} frames ({t[-1]:.2f} s), apex {z.max() - z[0]:.3f} m above stance "
              f"at {t[k]:.2f} s, airborne {air.sum() * dt:.2f} s")


if __name__ == "__main__":
    main()
