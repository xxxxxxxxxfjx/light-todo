# 0.6.6 周复盘完成热力图

日期：2026-11-05

参考 `docs/competitive-analysis-2026-11-05.md` 的 P1「周复盘 / 完成热力图」，把最近 7 天柱状图扩展为 13 周完成热力图。

## 1. 数据层

- `WeeklyReviewData` 新增 `heatmap: { date, completed }[]`；
- `getWeeklyReview` 一次查询覆盖 90 天完成记录，同时供 7 天节奏和 13 周热力图使用，避免重复扫描；
- 热力图从周一开始对齐，最后一天固定为今天，共 13 列 × 7 行（首列可能不足 7 天）。

## 2. 界面

- 周复盘底部新增「完成热力图」面板；
- 0 完成显示浅底，1 项 / 2–3 项 / 4+ 项四档颜色；
- 今天有描边标识，鼠标悬停/读屏标签显示日期与完成数；
- 空库仍显示空状态，不渲染无意义格子。

## 3. 回归

- `scripts/test-review.ts` 增加：长度 ≥91、最后一天为今天、首日为周一、最近 7 天热力图合计与周复盘完成数一致；
- `pnpm typecheck`、`pnpm test:unit`、`pnpm build` 通过；
- 手工 UI 截图验证热力图渲染。

## 4. 产物

- `pnpm dist:mac` 产出 `release/mac-0.6.6/LightTodo-0.6.6-arm64.zip`；
- Windows `pnpm dist` 仍需 Windows 环境（csc.exe / powershell.exe）。

## 5. 下一轮候选

- 完成任务模板：把常用任务组一键加入今天/收件箱；
- 任务岛到期提醒进岛；
- 日历热力图联动：点击热力图日期跳转日历。
