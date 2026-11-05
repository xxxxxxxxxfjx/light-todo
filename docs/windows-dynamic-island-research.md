# Windows「灵动岛」技术调研 与 LightTodo 功能对标

> 调研日期：2026-11-05　｜　调研对象：用户提供的 3 个仓库 + GitHub 同类项目 + Windows/Electron 官方文档
> 结论面向：轻单 LightTodo（Electron 45 + React 19 + TS，本地 SQLite）

---

## 0. 结论先行

1. **技术上完全可行，而且 LightTodo 已经写好了约 80% 的底座**：`src/main/pet.ts` 里的桌宠窗口就是一个「透明 + 无边框 + 置顶 + 点击穿透 + 多显示器 + 拖动」的浮层，岛的窗口需求与它同构。真正要新写的只有「胶囊三态 UI + 状态机 + 几个系统集成点」，**P0/P1 不需要换技术栈、也不需要任何原生模块**。
2. **三种主流实现路径**：WPF/C#（WinIsland、WinFinger）、Tauri/Rust（win-dynamic-island）、Electron（eIsland、以及本项目的桌宠）。Electron 是其中「最快出活、但系统能力最弱」的一条，恰好匹配 LightTodo 当前阶段。
3. **产品上不要做「全能岛」**。竞品普遍在堆媒体、音量、剪贴板、系统监控、AI 用量，同质化严重；「待办/日程」虽然七八家都有，但全部做得很浅（一个列表 + 勾选，没有 NLP 捕获、没有收件箱、没有重复任务）。**这正好是 LightTodo 的空位** —— 把岛做成「任务 HUD（今日进度 / 下一件事 / 一键完成 / 快速捕获）」，而不是系统控制中心。
4. **架构上不建议新开一个常驻窗口**：桌面伙伴（pet）与任务岛都是「屏幕角落/顶部的常驻置顶浮层」，同时开会互相抢位置、翻倍占内存（Electron 每窗口约 +60–100MB，而 LightTodo 的内存预算是常驻 <150MB）。建议做成**同一窗口的两种形态（宠物 / 胶囊），二选一**。
5. 建议节奏：**P0 三个功能 2–3 天可出可演示版本**（今日进度、悬停展开勾选、到期提醒进岛），P1 再做快速添加与专注计时。

---

## 1. 你给的三个仓库：事实核对

| # | 仓库 | Stars | 语言 | 最近 push | License | 结论 |
|---|---|---|---|---|---|---|
| 1 | [lb-li/WinIsland](https://github.com/lb-li/WinIsland) | 198 | C# (WPF/.NET 8) | 2026-03-05 | **无** | 功能最像产品，工程化最虚 |
| 2 | [649472774/win-dynamic-island](https://github.com/649472774/win-dynamic-island) | 0 | Rust (Tauri v2) + TS | 2026-07-15 | **无** | 技术最硬核，产品完成度最低 |
| 3 | [ypyik0669/winfinger-windows-island](https://github.com/ypyik0669/winfinger-windows-island) | 7 | C# (WPF/.NET 8) | 2026-09-04 | **无** | 功能+工程双高，社区为零 |

> 你消息里的第 4 项是空的（只写了「4.」），如果有第 4 个仓库发我，我再补一节。
>
> ⚠️ **三个仓库都没有 LICENSE 文件**。可以读思路、抄参数、抄 API 组合，但**不能直接复制代码**到 LightTodo（MIT 发布）里。

---

## 2. 三个仓库的实现拆解（只讲能借鉴的）

### 2.1 WinIsland —— 最值得抄的是「手感」

- **窗口套路**：一个 800×200 的透明 WPF 舞台窗口（`WindowStyle=None`、`AllowsTransparency=True`、`Topmost`、`ShowInTaskbar=False`），里面只动画一个 `Border`（初始 120×35、`CornerRadius=17.5`）。**窗口尺寸永远不变，变的是内层胶囊**——这是三个仓库的共同选择，也是最重要的工程结论。
- **弹簧动画**：`Utilities/Spring.cs` 手写二阶弹簧，`Stiffness=360 / Damping=28 / Mass=1`，半隐式欧拉积分，`dt` 钳制 0.064s 防爆炸，0.5px 阈值静止吸附（避免每帧空转）。
- **`CornerRadius = Height / 2`** 随高度联动，保证形变中间帧仍是标准胶囊。
- 系统集成：SMTC 取媒体、`UserNotificationListener` 抓 Toast、`WasapiLoopbackCapture` 做音频可视化、`DeviceWatcher` 做 USB/蓝牙插拔提示。
- **反面教材**：整个窗口打 `WS_EX_TRANSPARENT` 做穿透 → 一旦开启，连胶囊本体也点不了，只能整窗切换。
- 工程问题：CI 的 4 条 workflow 全部指向一个**不存在的 Avalonia 工程**；安装脚本里还留着 `yourusername` 占位符；版本号 tag 与 Release 名不一致。

**可借鉴**：弹簧参数、`CornerRadius=Height/2`、`WS_EX_TOOLWINDOW` 隐藏 Alt+Tab。
**不要学**：整窗穿透、只按主屏定位（`SystemParameters.PrimaryScreenWidth`）。

### 2.2 win-dynamic-island —— 技术含量最高，值得逐条抄「配方」

虽然 0 star，但它把 Windows 上做岛的所有硬点都踩了一遍，README 本身是一份技术设计文档：

| 问题 | 它的解法 |
|---|---|
| 胶囊形状 | `CreateRoundRectRgn(dia = radius*2)` + `SetWindowRgn`（注意 API 收的是**直径**） |
| 不抢焦点但能点 | `WS_EX_NOACTIVATE｜WS_EX_TOOLWINDOW` + 子类化拦 `WM_MOUSEACTIVATE` 返回 **`MA_NOACTIVATE`**（只加 style 会被系统吞掉点击） |
| 置顶被抢 | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`，每次前台切换就 `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)` 重顶一次（事件驱动、空闲零开销） |
| 扩张时闪白块 | 只 `invalidate` 新露出的像素，不整窗重绘 |
| Win11 真毛玻璃 | 独立 `DI_GlassUnderlay` 窗口 + `DWMWA_USE_HOSTBACKDROPBRUSH` + `CreateHostBackdropBrush` + D2D GaussianBlur，并检测高对比度/省电模式降级 |
| 拖文件进小胶囊 | 自建 OLE `IDropTarget` + 同形「隐形 catcher」窗口放大命中区（wry 内建 drop 在分层窗口上不触发） |

**可借鉴**：`MA_NOACTIVATE`、前台事件自愈置顶、区域裁剪、扩张只重绘新增区域。
**它的代价**：区域裁剪是 GDI 硬边、无抗锯齿；毛玻璃链路极重。

### 2.3 WinFinger —— 最完整的产品，最值得抄「材质降级」

- 代码量约 **17.8k 行 C# + 2.6k 行 XAML**，171 个单测；剪贴板（文本/文件/图片、规则引擎、9 类内容识别）、OCR、二维码、截图、媒体+歌词、AI 对话、便利贴、番茄钟、快捷键管理，全都做完了。
- **自制「实时磨砂」**：`GetDC(0)` 抓屏 → `StretchBlt` 降到 128×84（降采样本身就是预模糊）→ 两趟盒式模糊 → 饱和度 ×1.6 → 写回 `WriteableBitmap` 当 `ImageBrush`。跨 Win10/11 表现一致，代价是约 12.5fps。
- **`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`**：岛身不出现在截图/录屏里——既防泄露，也避免抓屏模糊「拍到自己」的递归。
- 幽灵模式：鼠标远离 160px 进入穿透、靠近 100px 退出（滞回避免抖动）。
- 多屏：manifest 声明 PerMonitorV2，展开宽度按当前显示器 `min(920, width-64)` 计算。
- **自我披露的硬限制**：系统 Toast 监听（`UserNotificationListener`）需要 MSIX package identity，**非打包 exe 用不了**。这条对 LightTodo 同样成立，别在这上面做规划。

---

## 3. 市场全景与功能矩阵

### 3.1 同类项目（GitHub，按 stars）

| 项目 | Stars | 技术栈 | 一句话定位 | License |
|---|---|---|---|---|
| [FlorianButz/DynamicWin](https://github.com/FlorianButz/DynamicWin) | 648 | C#/WPF (Fluent)，**仓库只发 Release 不发源码** | 老牌岛：媒体 + Google 日历 + 文件托盘 | CC-BY-SA-4.0 |
| [flyl1u/fly-island](https://github.com/flyl1u/fly-island) | 467 | Tauri 2 + React 19 + Rust | 轻量 PC 岛：QQ/微信/邮件通知、剪贴板、翻译、Agent 状态灯、**每日待办** | MIT |
| [MoFeng2223/BrimDeck](https://github.com/MoFeng2223/BrimDeck) | 437 | C#/WPF .NET | AI 编程额度 + 媒体 + 系统监控 | Apache-2.0 |
| [JNTMTMTM/eIsland](https://github.com/JNTMTMTM/eIsland) | 331 | **Electron + React/TS** | 功能最杂：歌词、待办、壁纸、小游戏、插件 | GPL-3.0 |
| [GEORGEWWWU/NetSpeed-Dynamic](https://github.com/GEORGEWWWU/NetSpeed-Dynamic) | 313 | Tauri 2 + Vue 3 | 网速为主，叠系统监控/通知/歌词 | MIT |
| [rajsriv/dynamic-island-for-windows](https://github.com/rajsriv/dynamic-island-for-windows) | 60 | Python/PyQt6 | 极简可定制：天气/日历/任务 | MIT |
| [maximilian467/Developer-Island](https://github.com/maximilian467/Developer-Island) | 57 | C# (.NET/WPF) | 开发者状态条：AI 用量、专注、日历 | MIT |
| [devcode90/Dynamic-Island-for-Windows](https://github.com/devcode90/Dynamic-Island-for-Windows) | 51 | C++/Direct2D（Windhawk mod） | **免安装 mod 形态**，媒体+监控+剪贴板 | MIT |
| [techreyy/ReyLand](https://github.com/techreyy/ReyLand) | 53 | 闭源 | Win10/11：歌词、WhatsApp、祈祷时间、**日历+to-do** | 自定义 |
| [Duoasa/QuotaView](https://github.com/Duoasa/QuotaView) | 54 | Swift（macOS）+ Windows 精简版 | 多 Agent 额度监控 | MIT |

### 3.2 功能矩阵（✅ 有 / — 无 / ? 未证实）

| 功能 | DynamicWin | fly-island | BrimDeck | eIsland | NetSpeed | Dev-Island | ReyLand |
|---|---|---|---|---|---|---|---|
| 媒体控制 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 通知聚合 | ? | ✅ | — | ? | ✅ | ? | ✅ |
| 剪贴板 | ? | ✅ | — | ? | — | — | ? |
| **待办/日程** | ✅(Google 日历) | ✅(每日待办) | — | ✅ | — | ✅(日历) | ✅(to-do) |
| 系统监控 | ✅ | ? | ✅ | ? | ✅ | ✅ | ✅(?) |
| AI 用量 | — | ✅ | ✅ | ? | — | ✅ | — |
| 文件暂存 | ✅ | — | — | ? | — | ✅ | — |
| 翻译 | — | ✅ | — | ? | — | — | — |
| 番茄钟/专注 | ? | — | — | ✅ | — | ✅ | — |
| 歌词 | — | ? | ✅ | ✅ | ✅ | ? | ✅ |
| 多显示器 | ? | ? | ? | ? | ? | ✅ | ? |
| 主题/皮肤 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 插件 | — | — | — | ✅ | — | — | — |
| 开机自启 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 自动隐藏/全屏 | ? | ? | ✅ | ? | ✅ | ✅ | ? |

> 数据来自各仓库 About / README / Release 页（2026-11-05 快照）；`?` 为公开文档未确认。star 数与 issue 数不代表质量：BrimDeck 34 个 open issue、DynamicWin 27 个。

### 3.3 竞品怎么做「待办」——最关键的一节

| 项目 | 待办形态 | 深度 |
|---|---|---|
| fly-island | 以「今天」为单位的每日待办：勾选完成、设为当前任务、每日笔记、未完成自动结转次日，任务与笔记存 Markdown | **最接近 LightTodo**，但没有月历、没有 NLP 输入、没有重复任务 |
| ReyLand | 「今天」tab = 月历 + 按日期事件 + 岛内直接输入 to-do，可接 Google Calendar 到点提醒 | 日历为主、任务是附属 |
| DynamicWin | Google Calendar 只读视图，与媒体/文件托盘并列滚动 | 无本地任务模型 |
| eIsland / rajsriv | 有一个简单的 to-do 列表 | 未做数据模型与提醒 |

**结论**：待办/日历在竞品里**覆盖广、但都很浅**——没有一家做到「自然语言一句话入库 + 收件箱 triage + 重复任务 + 提醒」这四件事。而这恰好是 LightTodo 已有的能力（`src/shared/nlp.ts`、收件箱、RRULE、提醒）。**岛只是把这些能力搬到屏幕顶部的一个新入口**。

### 3.4 品类规律（比功能表更重要）

1. **形态高度同质化**：顶部居中、500–700px 宽的胶囊，三态（收起 / 悬停 / 展开），深色底 + 大圆角。差异化几乎全在「展开后放什么」。
2. **能力集中在四类**：媒体、通知、系统状态、效率小工具。谁都能做，所以谁都不构成壁垒。
3. **2026 年的新战场是「AI 编程工具用量」**：BrimDeck、Developer-Island、fly-island、QuotaView 都在做 Claude Code / Codex 的额度与状态灯。**这印证了岛的真正价值：替某一类人常驻一个他们真正在意的数字。**
4. **演示型 vs 留存型**：歌词、频谱、壁纸、小游戏、天气属于「截图好看、三天后关掉」；留存型是**待办+日历、剪贴板历史、AI 配额、通知聚合、系统监控**。LightTodo 应该只做留存型里的第一项。
5. **同质化的代价**：star 最高的几个项目 open issue 都在 20–35 之间，几乎全是「多屏错位、全屏游戏被挡、点击穿透失灵、更新后不启动」——**这些都是窗口层的坑，不是功能坑**。谁把窗口层做稳，谁就有体验优势。

---

## 4. Windows 实现技术地图

### 4.1 窗口层级：四个 extended style 的真实语义（已核对 MS Learn）

| Style | 官方语义 | 用途 |
|---|---|---|
| `WS_EX_TOOLWINDOW` | 浮动工具栏窗口；**不进任务栏、不进 Alt+Tab** | 岛必须加，否则 Alt+Tab 里多一项 |
| `WS_EX_NOACTIVATE` | 点击**不会**变成前台窗口；默认不进任务栏 | 不抢游戏/输入法焦点 |
| `WS_EX_LAYERED` | 分层窗口，可做 per-pixel alpha | 真透明/异形的基础 |
| `WS_EX_TRANSPARENT` | 官方定义是**绘制顺序**（等同线程兄弟窗口先画），不是通用点击穿透 | 只在「临时整窗穿透」时用，别常开 |
| `WS_EX_TOPMOST` | 位于所有非 topmost 窗口之上，失活后仍保持 | 置顶；但**不是绝对最高** |

> 官方文档甚至直接提示：要不受这些限制地做透明，用 `SetWindowRgn`。

### 4.2 透明与材质：三条路线，别混着用

| 路线 | 能力 | 代价 |
|---|---|---|
| 分层窗口 + 自绘（`UpdateLayeredWindow` / WPF `AllowsTransparency` / Electron `transparent`） | 任意形状、逐像素 alpha | 整窗位图提交，窗口越大越贵；与 DWM 材质是两套合成路径 |
| 普通窗口 + DWM 材质（`DWMWA_SYSTEMBACKDROP_TYPE` / Mica / Acrylic） | 系统级毛玻璃 | **只能矩形/圆角矩形**，做不了「胶囊外全透明」 |
| 普通窗口 + `DWMWA_REDIRECTIONBITMAP_ALPHA`（Win11 26100+） | 不用 layered 也能带 alpha | 太新，需 PoC，无官方组合保证 |

**关键判断**：iOS 灵动岛本体**本来就不是毛玻璃，而是接近不透明的黑色**。所以「没有真 Acrylic」不是缺陷——用一个 `#0A0A0C` 底 + 内高光 + 外阴影 + `backdrop-filter: blur()`（只模糊自己内容）就足够像。真要桌面模糊，只能学 WinFinger 抓屏，Electron 里成本更高，**不建议**。

### 4.3 点击穿透与「不抢焦点」的三档方案

1. **整窗穿透**（最简单）：`SetIgnoreMouseEvents(true, {forward:true})` / `WS_EX_TRANSPARENT`。缺点：胶囊自己也点不了。
2. **区域判定**（Electron 推荐）：整窗默认穿透并 `forward` 鼠标移动 → 渲染层用 `elementFromPoint` 判断指针是否在胶囊/按钮上 → IPC 切换 `setIgnoreMouseEvents(false)`。LightTodo 的 `pet.ts` 已经这么做了。
3. **原生命中测试**（最精确）：`WM_NCHITTEST` 返回 `HTTRANSPARENT` 或 `SetWindowRgn` 裁形状，透明像素天然放行。需要原生代码。

> 注意 Electron 官方限制：`transparent: true` 的窗口**透明区域本身不能点击穿透**（issue #1335），必须靠 `setIgnoreMouseEvents`；而且透明窗口**不可 resize**、**开 DevTools 时变不透明**。所以「固定窗口 + 内层动画」不是风格选择，是硬约束。

### 4.4 定位、多屏与 DPI

- 用**工作区**而不是屏幕：`MONITORINFO.rcWork`（Electron 是 `display.workArea`），任务栏在顶部时 `workArea.top` 已经让开。
- 多屏坐标可为负；恢复位置要记 `displayId`，屏幕没了回落到光标所在屏。
- Per-Monitor V2 DPI；Electron 的 `screen` API 返回 **DIP**，与原生 helper 交换坐标要 `screenToDipRect`。
- 监听 `display-added / display-removed / display-metrics-changed`，debounce 200–500ms。

### 4.5 动画

- **窗口尺寸固定，只动画内容层**（三个仓库一致）。每帧 `SetWindowPos` 会触发 DWM 重排，透明窗口尤其容易闪。
- 弹簧参数可抄 WinIsland：`k=360, c=28, m=1`，半隐式欧拉，`dt` 上限 64ms，位移/速度双阈值静止。
- 形变时长 220–320ms；`border-radius` 始终 `= height/2`。

### 4.6 系统集成能力对照（LightTodo 是否需要）

| 能力 | Windows API | 岛上的用途 | LightTodo 是否需要 |
|---|---|---|---|
| 正在播放 | SMTC `GlobalSystemMediaTransportControlsSessionManager` | 媒体胶囊 | ❌ 与定位无关 |
| 音量 | `IAudioEndpointVolume` | 音量 HUD | ❌ |
| 电池 | `GetSystemPowerStatus` | 电量 | ❌ |
| 系统通知 | `UserNotificationListener`（**需 MSIX 身份**） | 通知聚合 | ❌ 且不可行 |
| 剪贴板 | `WM_CLIPBOARDUPDATE` | 剪贴板历史 | ❌ |
| 全局热键 | `RegisterHotKey` / Electron `globalShortcut` | 唤起 | ✅ 已有 `Ctrl+Shift+Space` |
| 开机自启 | `HKCU\...\Run` / 计划任务 | 常驻 | ✅ 已有 |
| 全屏检测 | `SHQueryUserNotificationState` | 游戏时隐藏 | ⚠️ 需要原生 helper，P2 |
| 勿扰/专注 | `SHQueryUserNotificationState` 的 `QUNS_RUNNING_D3D_FULL_SCREEN` 等 | 抑制打扰 | ⚠️ 同上 |

---

## 5. Electron 落地（LightTodo 视角）

**先回答「要不要换 Tauri / 原生」**：不值得。岛的性能瓶颈在「窗口形变 + 点击穿透 + 置顶」，不在业务逻辑；Electron 用固定窗口 + CSS 动画可以做到 60fps（eIsland 就是纯 Electron 实现）。换成 Tauri 要重写整个壳（SQLite、IPC、托盘、打包、自动化测试全部重来），换原生更是另一个工程。**只有当「必须桌面真模糊」或「必须 <20MB 内存」时才需要换**，而这两条都不在 LightTodo 的需求里。

### 5.1 你已经有的资产（`src/main/pet.ts`）

| 能力 | 位置 | 岛的复用方式 |
|---|---|---|
| 透明无边框置顶窗口 | `pet.ts:162-168` | 直接复用，改尺寸/位置 |
| `screen-saver` 级置顶 | `pet.ts:172` | 复用；游戏场景另做开关 |
| 点击穿透 + 按区域恢复 | `pet.ts:173, 237-240` | 复用同一套 IPC |
| 拖动 + 边界钳制 + 多屏 | `pet.ts:213-236` | 复用（岛可只允许左右/顶部吸附） |
| 位置持久化 + 显示器热插拔 | `pet.ts:84-112, 255-257` | 复用 |
| 任务数据推送 + 完成动作 | `pet.ts:72-75, 206-212` | 复用 `pet:changed` / `pet:complete` |
| 设置项 + 延迟创建 | `pet.ts:19-57`、`SettingsModal` 的「桌面伙伴」 | 扩展成「桌面形态：关闭 / 伙伴 / 任务岛」 |

**结论：岛不是一个新项目，是 `pet.ts` 的第二种渲染形态。**

### 5.2 Electron 的五个硬限制（官方文档）

1. 透明窗口**不可 resize**，`resizable:true` 可能让透明失效 → 固定窗口。
2. 透明区域**不能点击穿透**（#1335）→ 必须 `setIgnoreMouseEvents`。
3. 透明窗口**开 DevTools 会变不透明** → 调试时用非透明皮肤。
4. 窗口内**无法模糊桌面**（`blur()` 只作用于自身内容）→ 别承诺「毛玻璃」。
5. Windows 上透明窗口**不能最大化**（对岛无影响）。

### 5.3 推荐架构

```
BrowserWindow（island）  640×420，transparent，frame:false，focusable:false
   └─ 渲染层：<div class="stage"> 里居中放 <div class="capsule">
       状态机：collapsed(≈180×36) → hover(≈360×64) → expanded(≈560×360)
       默认 setIgnoreMouseEvents(true,{forward:true})
       pointermove + elementFromPoint → 命中胶囊则 IPC 关闭穿透
```

- **单窗口、单 renderer**，与 main 进程通过 preload 暴露的最小 API 通信。
- 与桌宠**互斥**：`desktopMode: 'off' | 'pet' | 'island'`，同一时刻只创建一种，避免两个置顶窗抢位置、翻倍内存。
- 默认关闭（与现有 `DEFAULT_PET_SETTINGS.enabled = false` 一致），开启后延迟 8s 懒创建（复用 `schedulePetCreation`）。

### 5.4 关键代码骨架（示意，非最终实现）

```ts
// src/main/island.ts —— 与 pet.ts 同构，仅列关键差异
const STAGE = { width: 640, height: 420 }

function createIsland(): void {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: STAGE.width, height: STAGE.height,
    x: area.x + Math.round((area.width - STAGE.width) / 2),
    y: area.y,                        // 贴工作区顶部；任务栏在上时自动让开
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, focusable: false, thickFrame: false,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/island.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: 'desktop-island' }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
}

ipcMain.on('island:interactive', (e, on: boolean) => {
  if (e.sender !== island?.webContents) return
  island?.setIgnoreMouseEvents(!on, { forward: true })
})
```

```tsx
// 渲染层：命中检测（节流 16ms，带 2px 滞回）
const onMove = (e: PointerEvent) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const hit = !!el?.closest('.capsule')
  if (hit !== interactive) { interactive = hit; api.setInteractive(hit) }
}
```

### 5.5 性能预算

- 新增一个 renderer 进程约 **+60–100MB**（桌宠预研结论）。LightTodo 目标常驻 <150MB，**两个浮层同时开会爆预算** → 必须互斥，或让岛复用桌宠的 `webContents`（同一窗口切换页面，代价是切换时一次重载）。
- 空闲时不要跑 `requestAnimationFrame` 循环；弹簧动画只在状态切换时启动，静止即停（WinIsland 的「静止吸附」就是为这个）。

---

## 6. 功能对标：竞品功能 → LightTodo 该做什么

| 竞品功能 | 品类覆盖度 | 对 LightTodo 的价值 | 成本 | 结论 |
|---|---|---|---|---|
| 今日进度胶囊（3/7 完成） | 仅 fly-island 近似 | ★★★★★ 一眼知道「还剩几件」，直接对应产品核心 | 低 | **P0** |
| 悬停展开今日列表 + 勾选 | 少数 | ★★★★★ 不打开主窗就能推进任务 | 低（复用 `TaskRow`/`pet:complete`） | **P0** |
| 到期/超期提醒进岛（带「完成/稍后」） | 少数 | ★★★★☆ 比系统 Toast 更轻、可操作 | 中 | **P0.5** |
| 快速添加（点击岛 → 输入 → NLP → 回车） | 无 | ★★★★★ 把 `Ctrl+Shift+Space` 的能力可视化，捕获成本最低 | 中（复用 `QuickAdd` + `nlp.ts`） | **P1** |
| 专注/番茄计时（绑定当前任务） | 2 家 | ★★★★☆ 与「今天做完」强相关，留存好 | 中 | **P1** |
| 下一件事倒计时 / 日历事件预览 | 2 家 | ★★★☆☆ | 低 | **P2** |
| 多显示器 / 位置 / 皮肤 / 透明度 | 普遍 | ★★★☆☆ 基础体验 | 低（pet 已有） | **P2** |
| 全屏应用自动隐藏 | 普遍 | ★★★☆☆ 不做会被游戏玩家骂 | 中（需原生 helper） | **P2** |
| 媒体控制 / 音量 / 歌词 | 几乎全部 | ★☆☆☆☆ 与「中文待办」定位无关，且要引入 WinRT/原生 | 高 | **不做** |
| 系统监控 / 网速 / 电量 | 多数 | ★☆☆☆☆ | 中 | **不做** |
| 剪贴板 / 文件暂存 / 翻译 | 3 家 | ★☆☆☆☆ 会把产品做成「瑞士军刀」 | 高 | **不做** |
| 通知聚合（接管系统 Toast） | 3 家 | ☆ 需要 MSIX 身份，LightTodo 是绿色版 | 极高 | **不做** |
| AI 用量（Codex/Claude Code） | 5 家 | ☆ 用户群不重叠 | 高 | **不做** |

---

## 7. 推荐路线

### P0：任务岛（2–3 天）

- 形态：顶部居中，收起态 `180×36`，显示 `○ 3/7`（环形进度 + 数字）；无今日任务时**不出现**。
- 悬停：展开到 `360×64`，显示「接下来：写周报 · 18:00」，右侧一个 ✓ 直接完成。
- 点击：展开 `560×360` 列表（今日 + 逾期），底部「打开轻单」。
- 完成动效：勾选后胶囊横向收缩 + 数字滚动 + 轻微回弹（弹簧参数抄 360/28）。
- 设置：`桌面形态`：关闭 / 桌面伙伴 / 任务岛（三选一，默认关闭）。

### P0.5：提醒进岛（+2 天）

- 到期前 N 分钟，胶囊自动展开为提醒态（`#1C1C1E` 底 + 标题 + 「完成 / 10 分钟后」）。
- 与现有 `Notification` 并存：岛可见时用岛，主窗最小化/岛关闭时退回系统 Toast。

### P1：快速捕获（+3 天）

- 点胶囊 → 原地展开输入框（`focusable` 临时 `true`），复用 `QuickAdd` 的 NLP 解析与预览 chips。
- `Ctrl+Shift+Space` 唤起时，主窗口不弹，岛展开并聚焦输入框（比现在的独立小窗更轻）。
- 提交后胶囊闪一下「已加入收件箱」，2s 后收起。

### P2：专注计时 + 多屏 + 全屏隐藏

- 番茄钟绑定当前任务，胶囊右侧显示环形倒计时，结束时岛展开 + 提示音。
- 位置可选「主屏 / 光标所在屏」，记住显示器。
- 全屏检测：优先用 `koffi` 调 `SHQueryUserNotificationState`（免编译、预编译二进制），失败则降级为「手动游戏模式」开关。

---

## 8. 风险与验收

| 风险 | 说明 | 对策 |
|---|---|---|
| 常驻打扰 | 顶部居中比右下角更「碍眼」，尤其全屏/阅读时 | 默认关闭；无今日任务不显示；允许拖到任意边缘；一键隐藏热键 |
| 内存 | Electron 多一个窗口 +60–100MB | 与桌宠互斥；懒创建；空闲不跑动画循环 |
| 全屏游戏遮挡 | `screen-saver` 级置顶会盖住游戏 | P0 提供「全屏时隐藏」开关；P2 上 `SHQueryUserNotificationState` |
| 多屏/DPI | 副屏负坐标、混合缩放 | 复用 pet 的 `place()` + `display-metrics-changed`；DIP 坐标统一 |
| 点击穿透抖动 | 指针在胶囊边缘来回 | 2px 滞回 + `pointermove` 节流 16ms |
| 输入法 | 岛内输入需要焦点，与 `focusable:false` 冲突 | 展开输入时临时 `setFocusable(true)`+`focus()`，收起还原 |
| 调试 | 透明窗口开 DevTools 变不透明 | 调试皮肤开关（`?debug=1` 用实底） |

**PoC 验收清单（可测）**

1. 1080p / 4K / 125% / 150% 缩放下，胶囊水平居中且不被任务栏遮挡。
2. 任务栏置顶/置左时，胶囊仍贴工作区顶部。
3. 主屏 + 副屏（副屏在左侧，负坐标）切换后位置正确。
4. 指针移过胶囊：能展开；移开：2s 后收起且恢复穿透；连续快速划过多 20 次无抖动。
5. 勾选任务：主窗列表同步（`tasks:changed`），胶囊数字立即变化。
6. 空闲 10 分钟 CPU < 1%（任务管理器采样），内存增量 < 80MB。
7. 全屏视频/游戏时，岛按设置隐藏或置顶行为符合预期。
8. 关闭「任务岛」后进程内无残留窗口、无定时器（复用 `stopPet` 的清理顺序）。

---

## 9. 参考来源

- 仓库：[lb-li/WinIsland](https://github.com/lb-li/WinIsland)｜[649472774/win-dynamic-island](https://github.com/649472774/win-dynamic-island)｜[ypyik0669/winfinger-windows-island](https://github.com/ypyik0669/winfinger-windows-island)｜[FlorianButz/DynamicWin](https://github.com/FlorianButz/DynamicWin)｜[flyl1u/fly-island](https://github.com/flyl1u/fly-island)｜[JNTMTMTM/eIsland](https://github.com/JNTMTMTM/eIsland)｜[MoFeng2223/BrimDeck](https://github.com/MoFeng2223/BrimDeck)｜[maximilian467/Developer-Island](https://github.com/maximilian467/Developer-Island)
- [Extended Window Styles (MS Learn)](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)
- [WM_MOUSEACTIVATE (MS Learn)](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mouseactivate)
- [Layered Windows (MS Learn)](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)
- [DWMWINDOWATTRIBUTE (MS Learn)](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)
- [Mica material (MS Learn)](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
- [MONITORINFO / GetMonitorInfo (MS Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-monitorinfo)
- [Electron: Transparent windows 限制](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
- [Electron: Click-through / setIgnoreMouseEvents](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)
- 本项目：`docs/desktop-pet-research.md`、`src/main/pet.ts`
