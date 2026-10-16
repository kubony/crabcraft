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
the Iron Wreck. At the end the whole town gathers in the square and dances, and your crab breaks:
toprock, six-step, spin, a 720 jump spin, a back flip and a one-claw freeze, while the town cheers.
Press B to break anywhere in the world.

Every crab is built from Jumper's own URDF and visual meshes, and every one of the game's 44 motion
clips is a closed-loop rollout of a trained Jumper policy in MuJoCo, so the walking, waving, dancing,
fighting and breaking you see is what the robot's policies actually do. The six combat moves and the
breakdance had no policy, so we wrote thirteen new Jumper tasks for them, published with this project
in its `jumper/` folder, and trained them. The breakdance is a result in simulation: none of its
policies has run on a physical robot, and the back flip's mode lifts the robot controller's
50-degree tilt guard while it runs. Robot Mode goes
further: it runs MuJoCo WebAssembly, the bundle's own controller.wasm and all 24 policies live in the
browser, the six skills and all seven breakdance moves included, checks itself against the
bundle's reference recording and SHA-256 digests before the robot wakes, lets you switch between
the bare robot and your geared crab on the same live simulation, and on P performs the whole
breakdance live, each move started on the downbeat of an original beat. The whole project is open source under
Apache-2.0 and runs as a static web page.

**Technical highlights**

- Real motion: all 44 clips are closed-loop rollouts of trained Jumper policies in MuJoCo 3.11, every
  one through a bundle's own controller extension. 31 come from the example bundle (walking in 8 directions,
  turns, fast gait, jump, 2 claw modes, 4 gestures, 4 dances, `dance_crab` at its full 238.6 s).
- Our open-source motion contribution: six new Jumper tasks, published with this project in its `jumper/` folder,
  `jumper.skill_swipe`, `skill_slam`, `skill_cast`, `skill_flinch`, `skill_powerdown` and `skill_sit`,
  for the 6 combat moves the robot had no policy for. Each is a reference clip authored on the robot's
  model inside its joint and balance limits, trained with motion-imitation reinforcement learning for 2,000 to 3,000 PPO iterations on
  one H100, exported with Jumper's `scripts/export.py` and bundled with its `scripts/deploy.py` beside
  the example bundle's 11 policies. From the standing pose in each task's own environment: 0 falls in
  84 rollouts (10 per move with the training's domain randomisation, 4 without), joint RMS over the
  move 0.26 to 1.54 deg without randomisation and 0.42 to 1.68 deg with it, against 11.2 to 39.4 deg
  for standing still. The game clips are recorded through that bundle's controller exactly as the
  gestures were, and gameplay is timed by the clips' own moments (the swipe's hit, the slam's measured
  impact, the cast's release, the power-down's settle).
- A breakdance from seven more new Jumper tasks, also in `jumper/`: four tracked moves,
  `jumper.break_toprock`, `break_sixstep`, `break_clawstand` and `break_oneclaw` (0 falls in 70
  rollouts, joint RMS over the move 0.65 to 2.68 deg with randomisation against 10.1 to 32.8 deg for
  standing still), and three reward-driven power moves, `jumper.power_spin_feet` (2.32 turns/s on
  its feet), `power_jumpspin720` (679 deg in the air on average, upright 32 of 32 times with
  randomisation, trained with its joint targets clamped at the stops) and `power_backflip` (384 deg
  in the air, upright 32 of 32 times, at rest level near the standing pose), both jumping from the
  pose the controller hands a new mode and standing still after the landing. All simulation; none
  has run on a physical Jumper. The six-step turns 357.7 of 360 degrees: its policy sees how far its
  heading has fallen behind the recording's, which the controller builds from the IMU's yaw since
  the move began (whether a physical Jumper's AHRS yaw follows its gyro, which that needs, is
  unchecked). The routine (B, and the ending's finale) plays six of them in a
  row and carries each move's travel and turn over to the crab, so one move starts where the last
  left it. The back flip turns upside down (177 deg of tilt), so its mode lifts the controller's
  50-degree tilt guard for that mode only; on a physical robot nothing would catch a fall while it
  runs.
- Bundle parity (`tools/motion/check_bundle.py`): controller replay observation diff 0, target diff 0
  (example bundle and crabcraft bundle); ONNX outputs vs recorded actions max diff 9.5e-07 (example bundle) and 0 (crabcraft bundle).
- Real body: the crab model is built from Jumper's URDF and meshes; forward kinematics vs MuJoCo over
  41 bodies x 13 poses, max position error 0.000534 mm. 6 races x 4 crests, 3 class weapons, NPC
  extras, 3 enemies and an 11-expression LED face.
- Robot Mode: official MuJoCo 3.11.0 WASM, onnxruntime-web 1.30.0, the bundle's controller.wasm and
  24 ONNX policies (25 modes) live in the browser, 199 Hz control rate measured while walking; keys
  5 to 0 run the six skills live, Shift + 1 to 4 the four tracked breaking moves, Shift + 5 the
  spin, Shift + 6 the 720 and Shift + 7 the back flip. The two jumps have no end of their own, so the
  page presses their switch again once they are at rest. The spin sends its joint targets up to 1.7
  rad past the joint stops, as it trained; on a robot a joint at its stop would be held against it at
  up to 1.746 N m, and the target sent can reach about 6.45 rad (untested on a physical Jumper). The
  720, trained again with its targets clamped at the stops, sends none past them; it rests about 10
  deg nose-up after landing, and with randomisation one landing in 32 tilted 49.1 deg, near the
  controller's 50-deg guard. On load it replays `reference.json` (24 frames, observation diff 0, target diff
  0), compares policy outputs with recorded actions
  (8.3e-7) and checks 71 bundle files by SHA-256.
- The whole breakdance live, on the beat: P in Robot Mode has the robot perform toprock, six-step,
  spin, 720, back flip and the one-claw freeze as one set, every move its policy running live under
  the bundle's controller, to an original beat at 107.14 bpm. The page only presses the bundle's own
  switches (each press shown in the log), timed in simulated time so every policy starts on the
  downbeat of its bar, and waits for each move to hand back to walking. 10 of 10 headless runs
  complete without a Safe Hold and end walking upright, the power moves starting within 15 ms of
  their downbeats and the tracked moves within 60 ms; in Chrome the music stays within 30 ms of the
  simulation. Simulation only, like the rest of the breakdance.
- Headless check (`node tools/robot-sim-check.ts`): 21.65 m in 30 s of walking without a fall, max tilt
  1.88 deg, jump apex 0.228 m; each of the six skills and the five breaking modes entered on its key,
  played out (the spin held 4 s at 2.36 turns/s, then let go; the six-step turning 357.7 deg) and
  handed back to walking; the 720 (680 and 686 deg in the air) and the back flip (384 and 374 deg),
  from standing and from walking, take off, land upright (0.3 s after touchdown the 720 at 10 deg,
  the nose-up pose it rests in, the flip within 3 deg of level) and are handed back by the page; the live
  routine from five different starts completes every time, every move on its downbeat.
- Same policy, any appearance: the player's geared crab is posed from the live simulation, its links
  within 0.0013 mm of the physics bodies.
- A complete game: 4 quests, 3 classes x 4 abilities, Scraplings, Rustclaw Scavengers, a 3-phase boss
  and a dance-party ending with the hero's breakdance. The automated playtest (`tools/playtest.mjs`) finishes the game as Warrior,
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

World of Crabcraft 把 Jumper 螃蟹机器人变成了一个完整的奇幻世界。玩家从六个种族和三个职业中创建自己的螃蟹，横着穿过港口小镇 Clawhaven，沿着海滩、登上灯塔完成四个连续任务，最后在铁船残骸的甲板上击败锈蚀暴君 Corrodius。通关后，全镇的螃蟹聚到广场上一起跳舞，你的螃蟹在全镇的欢呼声中跳一段霹雳舞：toprock、six-step、原地旋转、720 度跳转、后空翻和单钳定格。在世界任何地方按 B 也能跳。

每只螃蟹都由 Jumper 自己的 URDF 和外观网格生成，游戏里全部 44 段动作都是训练好的 Jumper 策略在 MuJoCo 中闭环运行录制下来的，所以你看到的行走、挥手、跳舞、战斗和霹雳舞，就是机器人策略真实做出的动作。6 段战斗动作和霹雳舞原本没有策略，我们为它们写了 13 个新的 Jumper 任务并完成训练，随本项目一同发布在 `jumper/` 目录中。霹雳舞是仿真结果：这些策略都没有在实体机器人上运行过，后空翻的模式在运行期间解除了机器人控制器 50 度的倾角保护。Robot Mode 更进一步：在浏览器里实时运行 MuJoCo WebAssembly、bundle 自带的 controller.wasm 和全部 24 个策略（包括 6 个新技能和全部 7 个霹雳舞动作），机器人启动前先用 bundle 的参考录制和 SHA-256 摘要自检，可以在同一个实时仿真上，在裸机器人和你装备好的螃蟹之间切换，按 P 还能让它踩着原创节拍的强拍实时跳完整套霹雳舞。整个项目以 Apache-2.0 开源，作为静态网页即可运行。

**技术亮点**

- 真实动作：全部 44 段动作都是训练好的 Jumper 策略在 MuJoCo 3.11 中闭环运行的录制，全部通过 bundle 自带的控制器扩展运行。31 段来自示例 bundle（8 个方向的行走、转身、快速步态、跳跃、2 种钳子模式、4 个手势、4 支舞蹈，`dance_crab` 保留完整的 238.6 秒）。
- 我们的开源动作贡献：随本项目一同发布在 `jumper/` 目录中的 6 个新 Jumper 任务 `jumper.skill_swipe`、`skill_slam`、`skill_cast`、`skill_flinch`、`skill_powerdown`、`skill_sit`，对应机器人原本没有策略的 6 段战斗动作。每个任务的参考动作都在机器人模型上、在关节和平衡限制以内制作，用动作模仿强化学习在一张 H100 上训练 2000 到 3000 次 PPO 迭代，用 Jumper 的 `scripts/export.py` 导出，再用 `scripts/deploy.py` 与示例 bundle 的 11 个策略打包在一起。在任务自己的环境中从站立姿态出发：84 次运行（每个动作 10 次带训练时的域随机化，4 次不带）没有摔倒；动作区间内的关节 RMS 误差不带随机化为 0.26 到 1.54 度，带随机化为 0.42 到 1.68 度，原地不动则是 11.2 到 39.4 度。游戏动作和手势一样，通过这个 bundle 的控制器录制；游戏逻辑按动作自身的时刻触发（挥砍的命中、重砸实测的落地、施法的释放、断电倒地的落定）。
- 霹雳舞来自另外 7 个新 Jumper 任务（同样在 `jumper/` 中）：4 个跟踪参考动作的任务 `jumper.break_toprock`、`break_sixstep`、`break_clawstand`、`break_oneclaw`（70 次运行没有摔倒，带随机化时动作区间内的关节 RMS 误差 0.65 到 2.68 度，原地不动为 10.1 到 32.8 度），以及 3 个靠奖励学出来的大招 `jumper.power_spin_feet`（只用脚旋转，每秒 2.32 圈）、`power_jumpspin720`（空中平均转 679 度，带随机化 32 次全部站稳落地，训练时关节目标就截断在限位处）和 `power_backflip`（空中转 384 度，32 次全部站稳，落地后在站立姿态附近水平站稳），两个跳跃都从控制器切换模式时交给策略的姿态起跳，落地后站稳不动。全部是仿真结果，没有在实体 Jumper 上运行过。six-step 转了 360 度中的 357.7 度：它的策略能看到自己的朝向比参考动作落后了多少，这个量由控制器根据动作开始以来 IMU 的偏航角算出（实体 Jumper 的 AHRS 偏航角是否跟随陀螺仪还没有验证）。套路（按 B，以及结局的压轴）连续播放其中 6 个，并把每个动作的位移和转向交给螃蟹，下一个动作从上一个停下的地方开始。后空翻会整个翻过来（倾角 177 度），所以它的模式只在自己运行期间解除控制器 50 度的倾角保护；在实体机器人上，后空翻运行时摔倒不会被保护接住。
- bundle 一致性（`tools/motion/check_bundle.py`）：控制器回放观测差 0，目标差 0（示例 bundle 和 crabcraft bundle）；ONNX 输出与录制动作最大差 9.5e-07（示例 bundle）和 0（crabcraft bundle）。
- 真实身体：螃蟹模型由 Jumper 的 URDF 和网格生成；与 MuJoCo 的正向运动学对比 41 个刚体 x 13 个姿态，最大位置误差 0.000534 mm。6 个种族 x 4 种头饰、3 种职业武器、NPC 配件、3 种敌人和 11 种表情的 LED 面部。
- 整套霹雳舞实时运行、踩在节拍上：在 Robot Mode 里按 P，机器人把 toprock、six-step、原地旋转、720、后空翻和单钳定格连成一整套，每个动作都是它的策略在 bundle 控制器下实时运行，配 107.14 bpm 的原创节拍。页面只按 bundle 自己的模式按键（每次都写进日志），按仿真时间安排，让每个策略都在它那一小节的强拍上开始，并等每个动作交回行走后再按下一个。无头运行 10 次全部完整跳完，没有 Safe Hold，最后站稳行走；大招在强拍前后 15 毫秒内开始，跟踪动作在 60 毫秒内；在 Chrome 中音乐与仿真的误差在 30 毫秒以内。和其余霹雳舞一样，只是仿真结果。
- Robot Mode：官方 MuJoCo 3.11.0 WASM、onnxruntime-web 1.30.0、bundle 自带的 controller.wasm 和 24 个 ONNX 策略（25 种模式）在浏览器中实时运行，行走时实测控制频率 199 Hz；按 5 到 0 可以实时运行 6 个技能，Shift + 1 到 4 运行 4 个霹雳舞跟踪动作，Shift + 5 原地旋转，Shift + 6 是 720，Shift + 7 是后空翻。两个跳跃自己不会结束，站稳后由页面再按一次按键。旋转的关节目标最多可以超出关节限位 1.7 rad，和训练时一样；在实体机器人上，顶到限位的关节会以最高 1.746 N m 的力矩一直顶着，发送的目标最远可达约 6.45 rad（没有在实体 Jumper 上试过）。720 重新训练时关节目标就截断在限位处，发送的目标都不超出限位；它落地后机头朝上约 10 度站着，带随机化时 32 次落地中有一次倾角达到 49.1 度，接近控制器 50 度的倾角保护。加载时回放 `reference.json`（24 帧，观测差 0，目标差 0），比较策略输出与录制动作（8.3e-7），并用 SHA-256 校验 71 个 bundle 文件。
- 无头检查（`node tools/robot-sim-check.ts`）：行走 30 秒前进 21.65 m 不摔倒，最大倾角 1.88 度，跳跃最高 0.228 m；6 个技能和 5 个霹雳舞模式都能按键进入、播放完毕（旋转保持 4 秒，每秒 2.36 圈，然后松开；six-step 转 357.7 度）并交回行走；720（空中转 680 和 686 度）和后空翻（384 和 374 度）从站立和行走中进入，都能起跳并站稳落地（落地 0.3 秒后 720 倾角为 10 度，即它机头朝上站稳的姿态，后空翻在 3 度以内），并由页面交回行走；整套实时霹雳舞从 5 种起点运行，每次都完整跳完，每个动作都踩在强拍上。
- 同一个策略，任意外观：玩家装备好的螃蟹按实时仿真逐帧摆姿，各连杆与物理刚体的偏差在 0.0013 mm 以内。
- 完整的游戏：4 个任务、3 个职业 x 4 个技能、Scrapling 和 Rustclaw Scavenger 两种敌人、三阶段 Boss 和以主角霹雳舞收尾的跳舞结局。自动试玩脚本（`tools/playtest.mjs`）用 Warrior、Mage、Priest 分别通关，控制台错误为 0。
- 开放素材：Quaternius CC0 场景素材、CC0 音乐和音效、OFL 字体，以及为本项目生成的 2D 美术，所有文件都列在 `NOTICE.md` 中。

**体验方式**

```bash
pnpm install
pnpm dev        # 打开 http://localhost:5173
```

选择 Enter World 创建螃蟹开始游戏，或选择 Robot Mode 操控实时运行的机器人（`/?screen=robot`）。需要 Node.js、pnpm 和支持 WebGL2 的桌面浏览器（在 Apple M4 Pro Mac 的 Chrome 上测试）。`pnpm build` 会在 `dist/` 生成静态站点，可以部署到任意静态托管服务。

源代码：https://github.com/kubony/crabcraft（Apache-2.0）
