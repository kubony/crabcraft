# Notices

World of Crabcraft is licensed under the Apache License 2.0 (see `LICENSE`).

## Third-party material

| Material | Source | License | Used for |
|---|---|---|---|
| Jumper robot model, meshes, policies, bundle runtime | https://github.com/KingKongRobotics/jumper | Apache-2.0, Copyright 2026 KingKong Robotics | Every crab body, recorded motions, Robot Mode |
| Jumper policy bundle, web half (`public/robot/bundle/`: `bundle.json`, `controller.toml`, contracts, `models/*.onnx`, trajectories, `reference.json`, `manual.en.json`, `README.md`, `runtime/web/controller.{js,wasm}` built from commit ce71f79) and the physics model exported from `assets/jumper/jumper.xml` (`public/robot/jumper/`) | https://github.com/KingKongRobotics/jumper (`out/bundle_example/jumper`, `assets/jumper/`) | Apache-2.0, Copyright 2026 KingKong Robotics | Robot Mode: the controller, policies, contact model and visual meshes the robot runs |
| MuJoCo JavaScript/WASM bindings `@mujoco/mujoco` 3.11.0 | https://github.com/google-deepmind/mujoco (npm `@mujoco/mujoco`) | Apache-2.0, Copyright Google DeepMind | Robot Mode physics |
| ONNX Runtime Web `onnxruntime-web` 1.30.0 (and its `onnxruntime-common`) | https://github.com/microsoft/onnxruntime (npm `onnxruntime-web`) | MIT, Copyright Microsoft Corporation | Robot Mode policy inference |

Every asset added to this repository must get a row here (source URL, author, license).
