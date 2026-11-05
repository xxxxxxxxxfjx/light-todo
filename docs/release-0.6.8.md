# 0.6.8 热力图联动日历

日期：2026-11-05

## 改动

- 周复盘「完成热力图」的每个格子变为可点击入口；
- 点击后打开日历并定位到该日期，直接查看/添加当天任务；
- Store 新增 `calendarJumpDate`，仅用于跨视图跳转，日历挂载后消费并清空，避免下次打开跳到旧日期；
- 热力图格子增加悬停放大与「点击查看当天」提示。

## 验证

- 手工实测：点击 2026-08-21 热力格后，日历标题为 2026年8月、日期输入为 2026-08-21；
- `pnpm typecheck` / `pnpm test:unit` / `pnpm build` 通过；`pnpm test:e2e` 34/34 通过。

## 产物

- `pnpm dist:mac` → `release/mac-0.6.8/LightTodo-0.6.8-arm64.zip`；
- Windows 成品仍需 Windows 环境执行 `pnpm dist`。
