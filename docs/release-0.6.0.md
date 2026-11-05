# 0.6.0 任务岛（灵动岛）首个可用版

日期：2026-11-05

## 1. 新增：任务岛

顶部居中的常驻胶囊，只做「看今天 / 勾掉 / 打开轻单」三件事：

- **收起态** 180×36：进度环 + `已完成/总数`，有逾期时右侧红点；
- **悬停态** 360×64：显示「接下来：任务名 · 时间」，右侧 ✓ 可直接完成；
- **展开态** 560×360：今日待办列表（逾期标红、已完成置灰划线）、逐条勾选、打开轻单；
- 默认开启；没有今日任务时不出现；全部完成时显示「今天都完成啦」，不会突然消失。

### 交互与命中

- 窗口固定 640×420 的透明舞台，胶囊只在内部形变；
- **命中判定在主进程用系统光标坐标做**：光标进入胶囊矩形才关掉 `setIgnoreMouseEvents`，
  离开立即恢复穿透——避免「点击穿透到岛下面」的问题；
- 悬停 220ms 展开 peek，移开 520ms 收起；面板移开 1.6s 收起，再次点击胶囊也可收起；
- 右键菜单：打开轻单 / 隐藏任务岛 / 退出。

## 2. 变更：桌宠暂停

- `registerPet` / `schedulePetCreation` / `stopPet` 调用全部注释，设置里的「桌面伙伴」入口隐藏；
- 代码保留在 `src/main/pet.ts` 与 `src/renderer/src/pet/*`，后续需要时取消注释即可；
- 托盘菜单由「显示 / 隐藏桌面伙伴」改为「显示 / 隐藏任务岛」。

## 3. 技术要点

- 新增 `src/main/island.ts`、`src/preload/island.ts`、`src/renderer/island.html`、
  `src/renderer/src/island/{main.tsx,island.css}`、`src/shared/island.ts`；
- Electron 多入口：`electron.vite.config.ts` 增加 island preload + renderer 入口；
- 透明窗口**禁止调用 `setOpacity`**（会把 per-pixel alpha 切到 LWA_ALPHA，整窗不可见）；
- 主进程 60ms 轮询光标做命中，渲染层只负责状态与动画。

## 4. 验证

- `pnpm typecheck`：通过
- `pnpm build`：通过
- dev 实机：rest → peek → panel → 勾选完成 → 4/4 全完成态，均已截图确认；
- 命中实测：光标离开胶囊时窗口带 `WS_EX_TRANSPARENT`（点击穿透），进入胶囊后移除。

## 5. 产物

`release/0.6.0/`
- `LightTodo-0.6.0-x64.exe`
- `LightTodo-0.6.0-portable.zip`
- `run-with-flags.cmd`（受限会话启动用）
- `checksums.json`

## 6. 已知限制

- 未做「全屏应用自动隐藏」（需要 `SHQueryUserNotificationState`，P2）；
- 提醒 toast 尚未接入（当前只有到期系统通知）；
- 多显示器只使用主屏顶部居中。
