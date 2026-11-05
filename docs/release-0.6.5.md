# 0.6.5 macOS 适配 + 日历选中日新建修复

日期：2026-11-05

## 1. 日历里新建任务跟随选中日期

问题：在日历月/周/日视图点选或切换到某一天后，点侧栏「新建任务」、按 `Ctrl/⌘+N` 或从命令面板新建，任务仍然落到今天；只有日历内部的「添加任务」按钮使用选中日期。

修复：
- Store 新增 `calendarDate`，日历视图随选中日同步；
- `openQuickAdd` 统一解析默认日期：日历视图优先使用选中日，显式传入日期优先，全局捕获（托盘/系统快捷键/URL Scheme）仍进收件箱；
- 时间表达式（如「下午 3 点」）以选中日为锚点，不再被 NLP 拉到今天/明天；
- 覆盖侧栏新建、`⌘/Ctrl+N`、命令面板和日历内按钮四个入口。

回归：`scripts/test-quick-add-date.ts`；手工实测 2026-11-10 选中后用侧栏新建，SQLite 中 `scheduledDate = 2026-11-10`。

## 2. macOS 平台适配

- **标题栏**：macOS 交通灯在左侧，按平台给标题栏增加 78px 左留白并设置 `trafficLightPosition`；右侧不再保留 Windows 窗口控件留白；
- **快捷键文案**：`Ctrl+F/N` 在 macOS 显示为 `⌘F/⌘N`，`Ctrl+Shift+Space` 显示为 `⌘⇧Space`；覆盖标题栏、侧栏、命令面板、快速添加、详情、设置和任务岛；
- **应用菜单**：macOS 安装标准 App/File/Edit/Window 菜单，恢复 `⌘C/⌘V/⌘Q` 等系统快捷键；
- **托盘**：新增 `build/trayTemplate.png` 单色 template 图标；macOS 单击菜单栏图标展开菜单，不再额外抢焦点打开窗口；
- **Dock**：开发模式也使用应用图标；今日角标继续走 `app.setBadgeCount`；
- **任务岛**：macOS 上设置 `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`，切换 Space / 全屏应用时不再消失；
- **开机自启**：macOS/Linux 使用 Electron 登录项，不再调用 Windows `reg`；Windows 保留 HKCU Run 双保险；
- **备份恢复重启**：macOS 用 `app.relaunch()` 重启 bundle，开发模式保留原始启动参数；
- **Jump List**：仅 Windows 调用 `setJumpList`，避免 macOS 上的无害报错；
- **字体栈**：补充 `-apple-system` / `PingFang SC`；
- **协议注册**：`electron-builder` 增加 `lighttodo://` 的 `protocols` 声明，macOS App 可注册 URL Scheme。

## 3. 开发与打包

- `scripts/app-cdp.mjs`：macOS 路径、SIGTERM，并按项目 Electron 可执行文件路径清理 `app.relaunch` 产生的游离实例；
- `scripts/e2e.mjs`：macOS Electron 路径；Windows 专用开机自启用例在非 Windows 跳过；
- 新增 `pnpm dist:mac`：类型检查 + 逻辑回归 + `electron-vite build` + `electron-builder --mac dir` + ad-hoc 签名 + ZIP + `checksums.json`；
- 新增 `build/icon-mac.png`（512px），`electron-builder` macOS 图标要求 ≥512px。

验证（macOS arm64）：
- `pnpm typecheck`、`pnpm test:unit`、`pnpm build`：通过
- `pnpm test:e2e`：33/33 通过
- `pnpm dist:mac`：通过，产物 `release/mac-0.6.5/LightTodo-0.6.5-arm64.zip`
- 实机启动打包后的 `LightTodo.app`：主窗口、任务岛、Dock 图标、菜单和快捷键文案正常

## 4. 仍未完成

- Windows 成品仍需在 Windows 环境执行 `pnpm dist`；本次 macOS 环境无法调用 `csc.exe` / `powershell.exe`。
- macOS 分发签名/公证（Developer ID + notarization）未配置，当前只有 ad-hoc 签名，适合本机验证。
