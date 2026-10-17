<p align="center">
  <img src="docs/media/hero.webp" alt="任务结束后，Clawhaven 全镇的螃蟹一起跳录制下来的 Jumper 舞蹈策略" width="100%">
</p>

<h1 align="center">World of Crabcraft</h1>

<p align="center">
  <b>一款在浏览器里运行的奇幻 RPG：每个角色都是 Jumper 螃蟹机器人，<br>
  每一次行走、挥手、舞蹈和霹雳舞动作都来自机器人自己训练出的策略。</b>
</p>

<p align="center">
  螃蟹机器人开源动作大赛 2026（BE UNLIMITED）参赛作品 |
  <a href="LICENSE">Apache-2.0</a> |
  <a href="README.md">English</a> |
  <a href="docs/SUBMISSION.md">参赛介绍</a>
</p>

六个种族、三个职业、一座港口小镇、由四个任务组成的主线、一个三阶段 Boss，最后全镇一起跳舞，你的螃蟹还会跳一段霹雳舞：toprock、six-step、原地旋转、720 度跳转、后空翻和单钳定格。玩家、NPC 和 Boss 全都是 KingKong Robotics 的 [Jumper](https://github.com/KingKongRobotics/jumper) 机器人，只是涂装和装备不同。打开 **Robot Mode（机器人模式）**，你创建的螃蟹就会在同一个标签页里，用 Jumper 真实的控制器和策略在 MuJoCo 中实时运行。

## 真实策略，而不是手工动画

- 游戏里全部 44 段动作，都是训练好的 Jumper 策略在 MuJoCo 3.11 中闭环运行后录制下来的，全部通过 bundle 自带的控制器扩展运行。31 段来自 Jumper 示例 bundle：8 个方向的行走、转身、快速步态、跳跃、左右钳子模式、4 个手势和 4 支舞蹈，`dance_crab` 保留了完整的 238.6 秒。
- 机器人原本没有策略的 6 段战斗动作（`attack_swipe`、`attack_slam`、`cast`、`hit_react`、`death`、`sit`），来自随本项目一同发布在 `jumper/` 目录中的 **6 个新 Jumper 任务**：`jumper.skill_swipe`、`skill_slam`、`skill_cast`、`skill_flinch`、`skill_powerdown`、`skill_sit`。参考动作在机器人自己的模型上制作，再用动作模仿强化学习训练成策略（每个在一张 H100 上训练 2000 到 3000 次 PPO 迭代）。在任务自己的环境中从站立姿态出发，84 次运行（每个动作 10 次带训练时的域随机化，4 次不带）没有一次摔倒；动作区间内的关节 RMS 误差为 0.26 到 1.54 度，而原地不动会差 11 到 39 度。死亡现在就是 power-down 策略：腿一条条软下去，外壳落到地上，尸体一直保持这个姿态。
- **霹雳舞，每个动作都是训练出的策略。** 按 <kbd>B</kbd> 螃蟹就会开始跳；在结局里它是压轴表演，全镇一起欢呼。为此我们又写了 7 个新 Jumper 任务（同样在 `jumper/` 中）：4 个跟踪参考动作的任务 `jumper.break_toprock`（107 bpm 的 8 拍）、`break_sixstep`（绕着两只钳子转一圈的地面步法）、`break_clawstand` 和 `break_oneclaw`（头朝下撑在钳子上的定格），以及 3 个靠奖励学出来的大招 `jumper.power_spin_feet`（只用脚原地旋转，每秒 2.3 圈；小腿、钳掌或机壳触地的步数占 22%，被它取代的旋转是 43%）、`power_jumpspin720`（两个随机种子下空中平均转 714 和 710 度，带域随机化 64 次落地全部站稳，站稳时面朝动作开始时的方向，转过 719 和 713 度）和 `power_backflip`（完整的后空翻，32 次全部用脚落地）。两个跳跃都从控制器切换模式时交给策略的站立姿态起跳，落地后在站立姿态附近水平站稳不动。这三个大招和其他所有模式一样，关节目标都不超出关节限位：旋转和 720 训练时关节目标就截断在限位处，和控制器的截断一致。套路按策略自己的节奏连续播放其中 6 个（claw stand 在 Robot Mode 里），并把每个动作的位移和转向交给螃蟹本身，所以差 2 度没转满一圈的 six-step、到落地时已经转了 773 度又回到 718 度的 720，都会让螃蟹停在策略让机器人停下的朝向，下一个动作从那里接着开始。这些都是仿真结果，7 个策略都没有在实体 Jumper 上运行过。six-step 能转满一圈（360 度中的 357.7 度），因为它的策略能看到自己的朝向比参考动作落后了多少；这个量由控制器根据动作开始以来 IMU 的偏航角算出。实体 Jumper 的 AHRS 偏航角是否跟随陀螺仪（这一点是前提）还没有验证过。后空翻在空中会整个翻过来（倾角 177 度），所以它的模式只在自己运行期间解除控制器 50 度的倾角保护；在实体机器人上，这意味着后空翻运行时摔倒不会被保护接住，需要格外小心（软地面，手放在释放键上）。
- 一致性检查 `tools/motion/check_bundle.py`：控制器回放 `reference.json`，观测差 0，目标差 0（示例 bundle 和 crabcraft bundle）；ONNX 输出与录制动作的最大差为 9.5e-07（示例 bundle）和 0（crabcraft bundle）。
- 螃蟹模型由 Jumper 的 URDF 和外观网格生成（`tools/build_crab.py`）。与 MuJoCo 对比 41 个刚体 x 13 个姿态，最大位置误差 0.000534 mm。
- 游戏中的螃蟹播放的是录制好的策略轨迹，并不做物理仿真；实时运行物理和策略的是 Robot Mode。

## Robot Mode：真实的控制栈，在浏览器里实时运行

官方 MuJoCo 3.11.0 WebAssembly 版本（`@mujoco/mujoco`）、onnxruntime-web 1.30.0 和 bundle 自带的 `controller.wasm`，加载 24 个 ONNX 策略（25 种模式）：示例 bundle 的 11 个、6 个新技能和全部 7 个霹雳舞动作，由 Jumper 自己的 `scripts/deploy.py` 打包成一个 bundle，按机器人的控制频率运行（行走时实测 199 Hz）。按 5 6 7 8 9 0 可以实时做出挥砍、重砸、施法、受击、断电倒地和坐下，按 <kbd>Shift</kbd> + 1 2 3 4 实时做出 toprock、six-step、claw stand 和单钳定格，结束后自动交回行走策略；<kbd>Shift</kbd> + 5 开始旋转，再按一次停止（浏览器物理下每秒 2.3 圈）。<kbd>Shift</kbd> + 6 是 720，<kbd>Shift</kbd> + 7 是后空翻：在浏览器物理下从站立和行走中各做 12 次，720 在空中转 707 到 749 度，站稳时面朝动作开始时的方向，平均转过 721.6 度（694.9 到 748.4 度），倾角在 1.6 度以内；后空翻向后翻 375 到 383 度，站稳时倾角在 1 度以内；两者都在站立姿态附近站稳不动。这两个动作自己不会结束，所以站稳后页面会替你再按一次它们的按键（控制器交接后 1.4 秒和 1.2 秒，比最晚的站稳时刻至少晚 0.24 秒），并在日志里写明。所有模式的关节目标都不超出关节限位：bundle 没有设置任何 `target_margin`，旋转和 720 都在关节目标截断于限位的条件下重新训练过（见“已知限制”）。机器人启动前，页面先做自检：用控制器回放 `reference.json`（24 帧，观测差 0，目标差 0），比较策略输出与录制动作（最大差 8.3e-7），并用 SHA-256 校验 71 个 bundle 文件。

**整套霹雳舞，实时运行，踩在节拍上。** 在 Robot Mode 里按 <kbd>P</kbd>（或点 dock 里的 Routine），机器人会把整套霹雳舞连起来跳完：toprock、six-step、原地旋转、720、后空翻和单钳定格，每个动作都是它自己的策略在 bundle 控制器下实时运行，配一段原创的、与 toprock 相同的 107.14 bpm 节拍音乐。没有任何录制片段被拼接进来。页面只按 bundle 自己的模式按键（<kbd>Shift</kbd> + 1、2、5、6、7、4），每按一次都写进日志，并按仿真时间安排按键时刻，让每个策略都在它那一小节的强拍上开始：控制器要先把关节滑到该动作的初始姿态（0.59 到 0.83 秒），所以按键必须提前这么久，页面根据关节离初始姿态有多远来预测这段时间。每个动作都先交回行走，再按下一个；旋转在一拍上由它自己的按键结束，720 和后空翻落地后由页面再按一次，定格正好落在最后一个重音的强拍上。从站立、行走、转身、横移和刚做完一个动作这几种起点无头运行 10 次，10 次都完整跳完，没有进入 Safe Hold，最后都站稳回到行走；大招在强拍前后 15 毫秒内开始，跟踪动作在 60 毫秒内。按任何机器人操作键、动手柄或再按一次 <kbd>P</kbd> 都会停下并交回行走。音乐是霹雳舞视频那段合成节拍按这套动作的 17 个小节重新编排的，页面让它跟着仿真走（Chrome 中误差在 30 毫秒以内）。这同样是仿真结果，这套动作没有在实体 Jumper 上运行过。

按 <kbd>T</kbd> 可以在裸机器人和你创建的螃蟹之间切换。装备、武器和 LED 面部都会跟随同一个实时仿真逐帧摆姿，螃蟹的各个连杆与物理刚体的偏差在 0.0013 mm 以内。同一个策略，任意外观。

<p align="center">
  <img src="docs/media/robot-switch.webp" alt="Robot Mode：同一次 dance_crab 策略运行，先显示为玩家的螃蟹，再切换成裸 Jumper 机器人，再切换回来" width="100%">
</p>

无头检查 `node tools/robot-sim-check.ts`：行走 30 秒前进 21.65 m，没有摔倒，最大倾角 1.88 度，跳跃最高 0.228 m；6 个技能和 5 个霹雳舞模式都能按键进入、播放完毕（旋转保持 4 秒，每秒 2.31 圈，然后松开）并交回行走（最大倾角 35.0 度，单钳定格）；720 和后空翻从站立和行走中各跳一次，空中分别转 724、709 度和 385、383 度（检查要求至少 700 和 330 度），720 站稳时相对起始朝向转过 714 和 706 度（检查要求在 720 ± 25 度以内）；bundle 中没有任何模式设置 `target_margin`（检查遇到就失败）。整套实时霹雳舞默认从 5 种起点各跑一次（`--routine 10` 跑 10 次）：每次都完整跳完，每个动作都进入并交回行走，没有 Safe Hold，最后站稳行走，大招在强拍前后 15 毫秒内开始，跟踪动作在 60 毫秒内。

## 功能一览

<img src="docs/media/create.jpg" alt="角色创建界面" width="100%">

- **角色创建**：6 个种族（Human、Orc、Dwarf、Undead、Night Elf、Tauren）、2 种性别、3 个职业（Warrior、Mage、Priest）；每个种族有 4 种外壳涂装、4 种头饰和 3 种 LED 颜色，也可以随机生成。

<img src="docs/media/races.jpg" alt="六个种族" width="100%">

- **同一个机器人身体，六个种族**：种族的区别来自涂装、姿态、LED 表现，以及贴合真实外壳建模的装备。LED 面部有 11 种表情。
- **Clawhaven 小镇**：喷泉广场、铁匠铺、礼拜堂、酒馆、月池林地、海滩、灯塔和铁船残骸。7 位有名字的 NPC 覆盖全部六个种族，镇上的居民用录制的行走动作在街上散步。

<img src="docs/media/combat.jpg" alt="Mage 螃蟹在海滩上释放 Tidal Nova" width="100%">

- **战斗**：每个职业 4 个技能，有施法条、冷却、1 秒公共冷却、目标框、姓名板、任务追踪和小地图。敌人是从沉船里爬出来的锈蚀螃蟹无人机 Scrapling 和 Rustclaw Scavenger。
- **Boss**：锈蚀暴君 Corrodius（Corrodius, the Rust Tyrant），在铁船残骸的甲板上分三个阶段作战。

<img src="docs/media/ending.jpg" alt="结局：全镇螃蟹在广场上跳舞" width="100%">

- **结局**：全镇围成一圈，跳录制下来的舞蹈策略（`dance_crab`、`dance_brazilian`、`dance_dream_wings`、`dance_maze`），烟花升起。接着人群让出场地，你的螃蟹跳完整套霹雳舞，每个动作都有字幕：人群跟着 toprock 挥手，为旋转喝彩，720 和后空翻落地时跳起来举钳，定格时烟花齐放。然后大家再一起跳舞，最后滚动字幕。

<img src="docs/media/robot.jpg" alt="Robot Mode：上方是带 HUD 的行走画面，下方是同一支舞蹈的螃蟹外观与裸机器人外观" width="100%">

- **Robot Mode**：仿照 Jumper 宣传片的阳光桌面场景。可以用键盘、屏幕按钮或手柄操作，全部走 bundle 自己的按键绑定。HUD 显示当前模式和控制频率、推理与物理耗时、22 个关节的角度、目标和力矩，以及启动自检结果。

## 运行

需要 Node.js 和 pnpm（在 Node 26.7、pnpm 11.22 上测试），以及支持 WebGL2 和 WebAssembly 的桌面浏览器（在 Apple M4 Pro Mac 的 Chrome 上测试）。

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # 类型检查后在 dist/ 生成静态站点
pnpm preview    # 本地预览 dist/
```

所有构建好的资源都已提交在 `public/` 中，不需要运行任何离线管线。构建使用相对路径，`dist/` 可以部署在任意路径下。Robot Mode 以单线程运行 onnxruntime-web，不需要跨域隔离（COOP 和 COEP）响应头，用 `python3 -m http.server` 托管构建结果也能正常运行。

| URL | 打开 |
|---|---|
| `/` | 标题画面 |
| `/?screen=create` | 角色创建 |
| `/?screen=game` | 用已保存的螃蟹进入 Clawhaven（没有存档时使用默认的 Human Warrior） |
| `/?screen=robot` | Robot Mode |
| `&debug=1`（与 `screen=game` 一起使用） | 调试键：F8 无敌，F9 完成当前目标，F10 传送到下一个目标 |

**操作**

- 游戏：<kbd>W</kbd> <kbd>S</kbd> 前进后退，<kbd>A</kbd> <kbd>D</kbd> 横着走，<kbd>Q</kbd> <kbd>E</kbd> 转身，<kbd>Space</kbd> 跳跃，<kbd>B</kbd> 霹雳舞（移动、转身、跳跃、技能或受击都会打断），<kbd>Tab</kbd> 选择目标，<kbd>1</kbd> 到 <kbd>4</kbd> 技能，<kbd>F</kbd> 对话和交互，<kbd>Esc</kbd> 菜单（画质设置），连按两次 <kbd>R</kbd> 进入 Robot Mode。
- Robot Mode：<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> 行走，<kbd>Q</kbd> <kbd>E</kbd> 转身，<kbd>Space</kbd> 跳跃，<kbd>1</kbd> 到 <kbd>4</kbd> 手势，<kbd>Ctrl</kbd> + <kbd>1</kbd> 到 <kbd>4</kbd> 舞蹈，<kbd>5</kbd> 到 <kbd>0</kbd> 技能，<kbd>Shift</kbd> + <kbd>1</kbd> 到 <kbd>7</kbd> 霹雳舞动作（6 和 7 的 720 与后空翻落地后自动回到行走），<kbd>V</kbd> <kbd>B</kbd> 左右钳子，<kbd>P</kbd> 整套霹雳舞（踩着节拍实时运行，带音乐；再按一次或按任何操作键停止），<kbd>T</kbd> 切换外观，<kbd>R</kbd> 重置。

完整的按键表、架构图和验证表见 [English README](README.md)。

## 已知限制

- 只有一个区域，单人游戏，面向桌面键鼠；只有 Robot Mode 支持手柄。
- 60 fps 只在 Apple M4 Pro Mac 的 Chrome 上测得，其他硬件没有测量。
- 霹雳舞只在仿真中验证过：为它训练的 7 个策略都没有在实体 Jumper 上运行过。后空翻的模式在运行期间解除了控制器 50 度的倾角保护，在实体机器人上，翻失败时不会被它接住。
- 720 和后空翻自己不会结束。Robot Mode 在控制器交接后的固定时间（1.4 秒、1.2 秒，比在浏览器物理中测得的最晚站稳时刻晚 0.245 秒和 0.26 秒）替你再按一次按键，并不检测落地。
- 所有模式的关节目标都不超出关节限位，bundle 没有设置任何 `target_margin`。旋转和 720 最初训练时关节目标不受截断，发布时允许超出限位 1.7 rad；后来两者都在关节目标截断于限位的条件下重新训练，和控制器的截断一致。经 bundle 控制器，旋转发送的目标最大 2.71 rad，720 最大 3.44 rad，没有一个超出限位。这些都没有在实体 Jumper 上试过。
- 旋转只用脚：经控制器从站立和行走中每秒转 2.27 和 2.28 圈，小腿、钳掌或机壳触地的控制周期占 23% 和 21%；它之前的旋转是每秒 2.29 和 2.30 圈，触地占 43% 和 42%（各 12 次，不带随机化的仿真），再之前允许超出限位的那个是 33% 到 35%。训练用的 MuJoCo Warp 让网格与地面最多有 4 个接触点，而游戏和所有测量用的原生 MuJoCo 只有 1 个，所以之前的旋转几乎没有因为这些触地被扣分；发布的这个最后一段在原生 MuJoCo 上训练。腿与腿之间的摩擦在模型里不存在（腿互相滑过）：小腿、钳掌和机壳与地面、彼此之间的摩擦都降到 0.4 时，每秒 2.14 到 2.15 圈。
- 720 落地后面朝动作开始时的方向：经控制器从站立和行走中站稳时相对起始朝向转过 724 和 719 度（24 次在 705 到 734 度之间），之前的 720 是 780 和 789 度，多转了 60 到 69 度。空中转 709 到 742 度，起跳高度 0.385 到 0.399 米，落地后在站立姿态附近站稳，倾角在 1.3 度以内，按键后 0.43 秒恢复行走。在它自己的训练环境中（不带随机化）站稳时多转 12 到 14 度（两个随机种子下 734 和 736 度）；游戏用的是 bundle 控制器。旋转时机身仍会倾斜：经控制器最大 34 度，带训练时的随机化 64 次飞行中最大 43.3 度，低于控制器 50 度的倾角保护。
- six-step 靠 IMU 的偏航角（从动作开始时算起）把一圈转满。实体 Jumper 的 AHRS 偏航角是否跟随陀螺仪还没有验证；如果它不动，策略会以为自己越转越落后，并用力追赶。
- 整套实时霹雳舞的按键时刻来自在本仿真上拟合的控制器滑动时间模型（`src/robot/sim/routine.ts`）；跟踪动作的滑动时间有模型解释不了的波动，所以它们会偏离强拍最多约 60 毫秒。整套动作会让机器人移动约 0.4 米，桌面上有玩具和书，紧挨着它们开始的话，某个动作可能落在上面。轮到某个动作时如果机器人不在行走状态，会等一个小节（并写进日志），连续等四个小节就停止。
- 音乐和音效没有经过人工试听（包括实时霹雳舞用 `tools/trailer/breakdance/beat.py` 合成的节拍）。

## 致谢与许可

Jumper 机器人模型、网格、策略和 bundle 运行时来自 KingKong Robotics（Apache-2.0）。本项目还使用了 MuJoCo WASM（Google DeepMind，Apache-2.0）、onnxruntime-web（Microsoft，MIT）、Quaternius 的 CC0 场景素材、CC0 音乐和音效以及 OFL 字体；2D 美术是为本项目生成的。所有第三方素材的来源、作者和许可见 [NOTICE.md](NOTICE.md)。

本项目以 [Apache License 2.0](LICENSE) 发布。
