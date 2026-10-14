# Contest entry: World of Crabcraft

Ready-to-paste text for the Crab Robot Open-source Challenge 2026 (BE UNLIMITED) entry, in English and
in Simplified Chinese.

## English

**Title**

World of Crabcraft

**Tagline**

A browser fantasy RPG where every hero, villager and boss is a Jumper crab robot moving on the robot's
own trained policies.

**Description**

World of Crabcraft turns the Jumper crab robot into a whole fantasy world. Create a crab from six races
and three classes, scuttle sideways through the harbour town of Clawhaven, follow a four-quest chain
along the Brine Shore and up Saltmere Lighthouse, and defeat Corrodius, the Rust Tyrant, on the deck of
the Iron Wreck. At the end the whole town gathers in the square and dances.

Every crab is built from Jumper's own URDF and visual meshes, and 31 of the game's 37 motion clips are
closed-loop rollouts of the Jumper bundle's ONNX policies in MuJoCo, so the walking, waving and dancing
you see is what the robot's policies actually do. Robot Mode goes further: it runs MuJoCo WebAssembly,
the bundle's own controller.wasm and all 11 policies live in the browser, checks itself against the
bundle's reference recording and SHA-256 digests before the robot wakes, and lets you switch between
the bare robot and your geared crab on the same live simulation. The whole project is open source under
Apache-2.0 and runs as a static web page.

**Technical highlights**

- Real motion: 31 of 37 clips are closed-loop rollouts of the Jumper example bundle's ONNX policies
  through its own controller extension in MuJoCo 3.11 (walking in 8 directions, turns, fast gait, jump,
  2 claw modes, 4 gestures, 4 dances, `dance_crab` at its full 238.6 s). The 6 combat clips the robot
  has no policy for are keyframed on the same model.
- Bundle parity (`tools/motion/check_bundle.py`): controller replay observation diff 0, target diff 0;
  ONNX outputs vs recorded actions max diff 9.5e-07.
- Real body: the crab model is built from Jumper's URDF and meshes; forward kinematics vs MuJoCo over
  41 bodies x 13 poses, max position error 0.000534 mm. 6 races x 4 crests, 3 class weapons, NPC
  extras, 3 enemies and an 11-expression LED face.
- Robot Mode: official MuJoCo 3.11.0 WASM, onnxruntime-web 1.30.0, the bundle's controller.wasm and
  11 ONNX policies (12 modes) live in the browser, 199 Hz control rate measured while walking.
  On load it replays `reference.json` (24 frames, diff 0), compares policy outputs with recorded
  actions (4.8e-7) and checks 35 bundle files by SHA-256.
- Headless check (`node tools/robot-sim-check.ts`): 21.65 m in 30 s of walking without a fall, max tilt
  1.88 deg, jump apex 0.228 m.
- Same policy, any appearance: the player's geared crab is posed from the live simulation, its links
  within 0.0013 mm of the physics bodies.
- A complete game: 4 quests, 3 classes x 4 abilities, Scraplings, Rustclaw Scavengers, a 3-phase boss
  and a dance-party ending. The automated playtest (`tools/playtest.mjs`) finishes the game as Warrior,
  Mage and Priest with 0 console errors.
- Open assets: Quaternius CC0 kits, CC0 music and sound effects, OFL fonts and 2D art generated for
  the project, every file listed in `NOTICE.md`.

**How to try it**

```bash
pnpm install
pnpm dev        # open http://localhost:5173
```

Choose Enter World to create a crab and play, or Robot Mode to drive the live robot (`/?screen=robot`).
Needs Node.js, pnpm and a desktop browser with WebGL2 (tested in Chrome on an Apple M4 Pro Mac).
`pnpm build` produces a static site in `dist/` that any static host can serve.

Source: https://github.com/kubony/crabcraft (Apache-2.0)

## 简体中文

**作品名称**

World of Crabcraft

**一句话介绍**

一款在浏览器里运行的奇幻 RPG：英雄、村民和 Boss 全都是 Jumper 螃蟹机器人，动作来自机器人自己训练出的策略。

**作品简介**

World of Crabcraft 把 Jumper 螃蟹机器人变成了一个完整的奇幻世界。玩家从六个种族和三个职业中创建自己的螃蟹，横着穿过港口小镇 Clawhaven，沿着海滩、登上灯塔完成四个连续任务，最后在铁船残骸的甲板上击败锈蚀暴君 Corrodius。通关后，全镇的螃蟹聚到广场上一起跳舞。

每只螃蟹都由 Jumper 自己的 URDF 和外观网格生成，游戏里 37 段动作中有 31 段是 Jumper bundle 的 ONNX 策略在 MuJoCo 中闭环运行录制下来的，所以你看到的行走、挥手和舞蹈，就是机器人策略真实做出的动作。Robot Mode 更进一步：在浏览器里实时运行 MuJoCo WebAssembly、bundle 自带的 controller.wasm 和全部 11 个策略，机器人启动前先用 bundle 的参考录制和 SHA-256 摘要自检，还可以在同一个实时仿真上，在裸机器人和你装备好的螃蟹之间切换。整个项目以 Apache-2.0 开源，作为静态网页即可运行。

**技术亮点**

- 真实动作：37 段动作中有 31 段，是 Jumper 示例 bundle 的 ONNX 策略通过其自带的控制器扩展在 MuJoCo 3.11 中闭环运行的录制（8 个方向的行走、转身、快速步态、跳跃、2 种钳子模式、4 个手势、4 支舞蹈，`dance_crab` 保留完整的 238.6 秒）。机器人没有对应策略的 6 段战斗动作在同一模型上用关键帧制作。
- bundle 一致性（`tools/motion/check_bundle.py`）：控制器回放观测差 0、目标差 0；ONNX 输出与录制动作最大差 9.5e-07。
- 真实身体：螃蟹模型由 Jumper 的 URDF 和网格生成；与 MuJoCo 的正向运动学对比 41 个刚体 x 13 个姿态，最大位置误差 0.000534 mm。6 个种族 x 4 种头饰、3 种职业武器、NPC 配件、3 种敌人和 11 种表情的 LED 面部。
- Robot Mode：官方 MuJoCo 3.11.0 WASM、onnxruntime-web 1.30.0、bundle 自带的 controller.wasm 和 11 个 ONNX 策略（12 种模式）在浏览器中实时运行，行走时实测控制频率 199 Hz。加载时回放 `reference.json`（24 帧，差值 0），比较策略输出与录制动作（4.8e-7），并用 SHA-256 校验 35 个 bundle 文件。
- 无头检查（`node tools/robot-sim-check.ts`）：行走 30 秒前进 21.65 m 不摔倒，最大倾角 1.88 度，跳跃最高 0.228 m。
- 同一个策略，任意外观：玩家装备好的螃蟹按实时仿真逐帧摆姿，各连杆与物理刚体的偏差在 0.0013 mm 以内。
- 完整的游戏：4 个任务、3 个职业 x 4 个技能、Scrapling 和 Rustclaw Scavenger 两种敌人、三阶段 Boss 和跳舞结局。自动试玩脚本（`tools/playtest.mjs`）用 Warrior、Mage、Priest 分别通关，控制台错误为 0。
- 开放素材：Quaternius CC0 场景素材、CC0 音乐和音效、OFL 字体，以及为本项目生成的 2D 美术，所有文件都列在 `NOTICE.md` 中。

**体验方式**

```bash
pnpm install
pnpm dev        # 打开 http://localhost:5173
```

选择 Enter World 创建螃蟹开始游戏，或选择 Robot Mode 操控实时运行的机器人（`/?screen=robot`）。需要 Node.js、pnpm 和支持 WebGL2 的桌面浏览器（在 Apple M4 Pro Mac 的 Chrome 上测试）。`pnpm build` 会在 `dist/` 生成静态站点，可以部署到任意静态托管服务。

源代码：https://github.com/kubony/crabcraft（Apache-2.0）
