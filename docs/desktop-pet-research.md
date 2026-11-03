# 桌宠 / 桌面悬浮任务助手 · 技术预研

> 目标：常驻桌面最上层、展示未完成任务、可直接勾选完成；支持多宠物、可选皮肤、可自定义。
> 结论：**技术上可行，且不需要引入原生模块**。推荐在现有 Electron 架构里加一个独立的透明置顶窗口，**一个窗口承载多只宠物**，MVP 约 2–3 天，完整版 1–2 周。

---

## 1. 同类产品是怎么做的

| 产品/项目 | 形态 | 实现方式（公开资料/可见行为） | 可借鉴点 |
|---|---|---|---|
| **Shijima-Qt**（开源，C++/Qt） | 经典 Shimeji 桌宠，精灵动画、拖拽、多显示器 | 每只宠物一个透明无边框置顶窗口，逐像素透明 + 命中测试；精灵表状态机 | 皮肤包结构、动画状态机、拖拽与边缘行为 |
| **Shimeji-ee / Shimeji-Desktop**（开源，Java/Swing） | 桌面小人，可在窗口边缘爬行 | Swing 透明窗口 + `setAlwaysOnTop` + 每像素透明；鼠标事件按 alpha 命中 | 皮肤即资源目录；行为脚本与动画分离 |
| **Desktop Goose**（闭源） | 透明图层上的鹅，会拖拽窗口/叼走鼠标 | 原生透明置顶覆盖层 + 精灵动画 + 系统输入模拟 | 强互动演出，但侵入性强，不适合任务工具 |
| **豆包桌面版悬浮球** | 桌面边缘小球，点开展开面板 | 无边框置顶小窗 + 展开面板（内部实现未公开，按可见行为推断） | 收起态极小、展开态承载主功能；不抢焦点 |
| **搜狗输入法状态栏** | 输入法悬浮条，可换肤 | 输入法进程自带的原生分层窗口（Layered Window），随输入法启停 | 皮肤系统、贴边吸附、透明度 |
| **DSH 大肥鱼插件** | 桌面宠物插件 | 宿主为 Electron，推断为独立透明置顶渲染层 + 插件资源包 | 插件化皮肤、与宿主解耦 |
| **滴答清单/TickTick 迷你窗** | 置顶任务小窗 | 普通无边框置顶窗口，列表 + 勾选 | 任务 HUD 的信息密度与操作路径 |

**共性套路**（不管什么语言）：

1. **无边框 + 透明 + 置顶** 的独立窗口，和主窗口分离；
2. **逐像素透明/命中测试**：透明区域鼠标穿透，只有宠物/气泡可点；
3. **精灵动画状态机**：idle / walk / drag / happy / sleep；
4. **托盘控制显隐**，避免任务栏出现第二个图标；
5. **位置/大小/透明度持久化**，多显示器要恢复到最后一块屏。

Windows 原生层面，这类窗口就是 `WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`，用 `UpdateLayeredWindow` 做逐像素 alpha；微软文档明确：alpha 为 0 的区域鼠标消息会穿透到下层窗口（见文末来源）。

---

## 2. 四条技术路线对比

| 路线 | 置顶/透明 | 点击穿透 | 开发成本 | 内存/包体 | 与现有栈契合 | 结论 |
|---|---|---|---|---|---|---|
| **Electron 第二窗口**（推荐） | 原生支持，`setAlwaysOnTop('screen-saver')` | `setIgnoreMouseEvents(true,{forward:true})` 可按区域切换 | 低，复用 React/CSS | 多一个渲染进程，约 +60–100MB | 100%（现有 Electron 45 + React） | ✅ 首选 |
| Tauri 第二窗口 | 支持，配置 `alwaysOnTop/transparent/decorations:false` | 支持 | 中，需 Rust 工具链 | 包体小、内存低 | 需要重写壳 | 备选，不建议现在换 |
| 原生 Win32 / WPF 独立进程 | 最强，性能最好 | 原生命中测试 | 高，C#/C++ 另建工程 | 最小 | 与现有栈割裂，IPC 复杂 | 只适合追求极致性能 |
| 主窗口内浮层 | 不能跨应用置顶 | — | 最低 | 0 | 高 | ❌ 不满足"桌面最上层" |

> 结论：**Electron 第二窗口**是投入产出比最高的方案；真到了性能瓶颈，再把宠物层换成原生进程，IPC 协议不变即可。

---

## 3. Electron 关键实现点（含坑）

### 3.1 窗口参数

```ts
const pet = new BrowserWindow({
  width: 320,
  height: 220,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  resizable: false,
  movable: true,
  skipTaskbar: true,
  alwaysOnTop: true,
  hasShadow: false,
  show: false,
  focusable: false,          // 不抢键盘焦点；需要输入时再临时开
  webPreferences: {
    preload: join(__dirname, '../preload/pet.js'),
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false
  }
})
pet.setAlwaysOnTop(true, 'screen-saver')   // 高于普通窗口，覆盖全屏应用
pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
pet.showInactive()                          // 显示但不抢焦点
```

- **层级**：`setAlwaysOnTop` 的 level 有 `normal / floating / torn-off-menu / modal-panel / main-menu / status / pop-up-menu / screen-saver`；桌宠一般用 `screen-saver`，但要提供"游戏/全屏时自动隐藏"开关，否则会盖住游戏。
- **点击穿透**：整窗 `setIgnoreMouseEvents(true, { forward: true })` 后，鼠标事件穿透到桌面；在渲染层监听 `pointermove`，当指针进入宠物/气泡区域时 IPC 通知主进程关闭穿透，离开再打开。这是 Shimeji 类产品的标准做法。
- **不抢焦点**：`focusable:false` + `showInactive()`；右键菜单用原生 `Menu.popup()`，不要用 HTML 模态。
- **拖拽**：两种方式——CSS `-webkit-app-region: drag`（简单，但和点击事件冲突）或渲染层 `pointerdown/move` 通过 IPC 调 `win.setPosition()`（可控、可吸附边缘）。推荐后者。
- **多显示器/DPI**：用 `screen.getAllDisplays()` 取工作区，保存位置时记录 displayId；恢复时若屏幕不存在则回落到主屏。Electron 坐标是 DIP，125%/150% 缩放下要实测。
- **Windows 透明窗口**：必须 `transparent:true` + `backgroundColor:'#00000000'`；不要开 `thickFrame`/阴影，否则边缘会出现黑边；Win11 的圆角由 DWM 处理，自绘气泡用 CSS `border-radius`。

### 3.2 性能

- **一个窗口承载多只宠物**，不要"一只宠物一个 BrowserWindow"——每多一个渲染进程就是几十 MB。
- 动画优先 CSS transform/opacity（合成层，GPU 友好）；精灵表用 `background-position` 或 `<canvas>`；避免每帧改布局。
- 空闲时降帧（比如 30fps 呼吸动画），鼠标交互时 60fps；窗口隐藏时暂停 `requestAnimationFrame`。
- `backgroundThrottling:false` 只给宠物窗口，主窗口保持默认。

### 3.3 打包

现有 electron-vite 是多入口：在 `electron.vite.config.ts` 的 renderer `rollupOptions.input` 增加 `pet: resolve('src/pet/index.html')`，构建后 `out/renderer/pet.html`；主进程 `loadFile` 指向它即可。preload 单独一个 `pet.ts`，只暴露宠物需要的 API。

---

## 4. 推荐架构（落在 LightTodo 里）

```
┌──────────────┐     IPC      ┌──────────────┐     IPC      ┌──────────────┐
│  主窗口 UI    │ ◄──────────► │  主进程       │ ◄──────────► │  宠物窗口     │
│  React/Zustand│              │  pet manager │              │  React 轻页面 │
└──────────────┘              │  DB / 任务服务 │              └──────────────┘
                               └──────────────┘
```

- **主进程** `src/main/pet.ts`：创建/销毁宠物窗口、位置记忆、置顶层级、点击穿透开关、全屏检测（可选）。
- **宠物渲染层** `src/pet/`：只做展示与点击，不直接读数据库；通过 `petApi` 拿数据、发完成指令。
- **数据**：复用现有 `tasks` 表，查询"今天 + 逾期 + 未安排"的前 N 条；完成走现有 `toggleTask` 同一套逻辑，主窗口/日历/计数自动同步。
- **设置**（`settings` 表）：`pet_enabled`、`pet_skin`、`pet_scale`、`pet_opacity`、`pet_position`、`pet_click_through`、`pet_max_tasks`、`pet_multi`。
- **IPC 通道**：
  - `pet:getState` → `{ tasks, skin, settings }`
  - `pet:complete(taskId)`
  - `pet:openTask(taskId)` / `pet:openMain()`
  - `pet:move(dx,dy)` / `pet:savePosition`
  - `pet:contextMenu()` → 原生菜单（换宠物/隐藏/设置/退出）
  - 主进程在任务变更后 `pet:stateChanged` 推送，保证两边一致。

---

## 5. 交互设计（建议）

### 收起态
- 64×64 的宠物头像 + 右上角红色计数徽标（逾期+今天）。
- 鼠标悬停：轻微放大 + 气泡淡入。
- 拖拽：整只宠物可拖，靠近屏幕边缘自动吸附，松手保存位置。

### 展开态（任务气泡）
- 280–320px 宽，最多 5 条：逾期（红点）→ 今天 → 待安排。
- 每行：圆形勾选 + 标题 + 清单色点；点勾选立即完成（宠物播放 0.6s 庆祝动画，行收起）。
- 点标题：打开主窗口并定位到该任务。
- 底部："查看全部" / "＋ 快速添加"。
- 空白处：显示"今天清空了 🎉"。

### 右键菜单
换宠物 / 大小（80%/100%/120%）/ 透明度 / 点击穿透模式 / 开机启动 / 隐藏 / 退出。

### 多宠物
- 一个透明窗口内绝对定位 1–3 只；各自有位置、皮肤、缩放。
- 共享一个任务气泡（点哪只都展开同一个），避免多份数据源。
- 宠物之间可以有简单互动（相遇挥手），作为 v2 彩蛋。

---

## 6. 皮肤与自定义

**皮肤包结构**（建议）：

```
skins/cat/
  manifest.json      # 名称、作者、尺寸、状态帧、锚点
  idle.webp / idle@2x.webp
  happy.webp
  drag.webp
  sleep.webp
```

- 第一阶段：内置 3 套（猫/柴犬/水獭），支持 **缩放、透明度、镜像、位置**；
- 第二阶段：支持导入 `.zip` 皮肤包（只读资源，不执行代码），校验 manifest 与文件白名单；
- 第三阶段：皮肤市场/分享码（可选）。

> 不建议第一版就做"用户上传任意 GIF"：尺寸、帧率、透明边缘不可控，很容易把桌面弄得很难看。

---

## 7. 方案选项（给你拍板）

| 方案 | 内容 | 工作量 | 适合 |
|---|---|---|---|
| **A. 悬浮任务卡** | 一个小圆角卡片，顶部一只静态/微动宠物头，下面 3–5 条任务，可勾选；可拖动、置顶、贴边 | **2–3 天** | 想先验证"桌面直接完成任务"的价值 |
| **B. 桌宠 + 任务气泡**（推荐） | 完整宠物形象 + idle/开心/拖拽/睡觉状态；悬停展开任务气泡；右键菜单；3 套内置皮肤 | **5–7 天** | 想要"好看、有生命感"的桌宠 |
| **C. 多宠物 + 皮肤导入** | B 的基础上支持 1–3 只同屏、皮肤包导入、宠物互动 | **2–3 周** | 把它当长期差异化功能 |

我的建议：**先做 B 的骨架（A 的交互 + 1 套宠物动画），跑通置顶/穿透/完成同步，再按反馈加皮肤和多宠物。** 这样 3 天内能看到实物，不会一上来陷进动画资源。

---

## 8. 风险与规避

| 风险 | 说明 | 规避 |
|---|---|---|
| 盖住全屏游戏/视频 | `screen-saver` 层级会覆盖全屏 | 提供"全屏时自动隐藏"或快捷键一键隐藏；默认开启游戏模式检测（可选） |
| 点击穿透失效/误触 | 透明区域挡住桌面图标 | 默认整窗可交互，提供"穿透模式"；用 pointermove 动态切换 |
| 内存 | 多一个 Chromium 渲染进程 | 单窗口多宠物；空闲降帧；不需要时彻底销毁窗口 |
| 多显示器/DPI | 位置恢复错位 | 保存 displayId + DIP 坐标，恢复时校验 |
| 抢焦点 | 弹窗/输入打断用户 | `showInactive`、`focusable:false`、原生菜单 |
| 杀软/SmartScreen | 未签名 exe + 置顶行为 | 代码签名（后续）；不写启动项之外的敏感位置 |
| 皮肤包安全 | 恶意资源/路径穿越 | zip 白名单校验、只读资源、不执行脚本 |

---

## 9. 验收标准（做的时候按这个测）

1. 开启后宠物出现在桌面，**始终在其他普通窗口之上**；关闭主窗口仍在。
2. 透明区域鼠标可点到桌面图标；宠物和气泡可点。
3. 勾选任务 → 主窗口、日历、计数 1 秒内同步；重启后状态一致。
4. 拖动后位置持久化；换分辨率/多显示器后不跑出屏幕。
5. 展开气泡最多 5 条，按"逾期→今天→待安排"排序；空状态正确。
6. 右键菜单可切换皮肤/大小/透明度/隐藏。
7. 全屏视频/游戏时可一键隐藏（或自动隐藏）。
8. 内存增量 < 100MB，空闲 CPU < 2%。

---

## 10. 待你确认的 6 个问题

1. **形态**：A 悬浮任务卡 / B 桌宠+气泡（推荐）/ C 多宠物完整版？
2. **展示范围**：只显示"逾期+今天" / 全部未完成 / 指定清单？
3. **宠物数量**：先 1 只，还是第一版就要 2–3 只？
4. **自定义程度**：内置皮肤 + 大小/透明度即可，还是要支持导入皮肤包？
5. **点击穿透**：默认可交互（推荐），还是默认穿透、按住某键才交互？
6. **完成反馈**：只要勾选动画，还是要宠物庆祝 + 音效？

---

## 11. 参考来源

- Electron BrowserWindow API（透明窗口、alwaysOnTop、setIgnoreMouseEvents、showInactive）：https://www.electronjs.org/docs/latest/api/browser-window
- Microsoft Win32 Layered Windows（逐像素 alpha 与命中测试）：https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features
- Shijima-Qt（C++/Qt 桌宠引擎）：https://github.com/pixelomer/Shijima-Qt
- Shimeji-ee（Java 桌宠）：https://github.com/gil/shimeji-ee
- Shimeji-Desktop（JDK 25 移植）：https://github.com/DalekCraft2/Shimeji-Desktop
- vibebud（TypeScript 桌面 AI 宠物）：https://github.com/Shellishack/vibebud
- Tauri Window 配置（alwaysOnTop / transparent / decorations）：https://v2.tauri.app/reference/config/

> 豆包、搜狗输入法、DSH 大肥鱼插件为闭源产品，以上仅根据公开可见行为与技术形态推断，不代表其内部实现。
