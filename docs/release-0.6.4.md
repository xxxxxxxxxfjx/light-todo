# 0.6.4 数据恢复安全 + 订阅日历展示

日期：2026-11-05

在 0.6.3 的基础上，按 `docs/review-2026-11-05.md` 的遗留问题继续迭代，并把已同步但此前从未显示的 ICS 日程接进日历视图。

## 1. 备份恢复：坏备份不再覆盖正式库（P1）

`src/main/data.ts` 原逻辑只检查备份非空，然后用 `copyFileSync` 覆盖正式库；非空但损坏的文件会先把当前库破坏，`catch` 也不会自动回滚。

现在：
- 源备份和 staged 副本各做一次 `PRAGMA integrity_check`、必要表（tasks/lists/folders/tags/settings）与 tasks 关键字段校验；
- 恢复前强制生成 `pre-restore` 备份，失败则取消恢复；
- 关闭数据库后清理 WAL/SHM，用同文件系统 `rename` 原子替换正式库；
- `initDb` / 迁移失败则自动回滚到恢复前的库并重新打开；
- 恢复成功后重启应用；开发模式会带上原始 Electron 参数（`--no-sandbox`、应用目录等），避免重启后空进程退出。

回归：`scripts/test-restore.ts`（空文件 / 随机内容 / 缺少业务表 / 原子替换 / 回滚）。

## 2. 日历订阅：拉取成功后再事务内切换（P2）

旧逻辑在发起网络请求前就把订阅地址写入数据库；新地址请求失败后，地址已经变了，事件却仍是旧订阅的快照。

现在：
- 拉取、HTTP 状态、VCALENDAR 检查、解析全部成功后，才在一个事务中同时更新地址、名称、事件快照和 `last_synced_at`；
- 新地址失败时保留旧地址、旧名称和旧事件；
- 同一地址重试失败只记录 `last_error`；首次订阅失败保留用户输入的地址和错误，便于直接重试。

回归：`scripts/test-calendar-sync.ts`（新地址失败 / 同地址失败 / 成功事务提交 / 首次失败）。

## 3. 订阅日程终于可见（此前只入库不展示）

- 日历视图按月 / 周 / 日可见范围拉取 `calendar.getEvents`；
- 月视图格子显示只读日程（紫色日历图标 + 时间），与任务一起计入「还有 N 项」；
- 周视图：全天日程进「全天」行，定时日程按时间块显示；
- 下方当天议程显示「N 个日程」和只读日程行；
- 跨天日程在覆盖的每一天显示；全天日程按本地日期只标一天；设置里同步/清除后自动刷新。

回归：`scripts/test-calendar-events.ts`（全天、跨天、跨月、坏日期）。

## 4. 周复盘统一顶层任务口径（P2）

`getWeeklyReview` 的完成数、新增数、待办数、逾期数、清单分布和未分类分布全部加上 `parent_id IS NULL`，与侧栏/列表口径一致，子任务不再让复盘数字翻倍。`scripts/test-review.ts` 增加子任务反例。

## 5. 农历闰月不再匹配固定节日（P2）

`getLunarInfo` 在 `isLeap` 时不再查询 `LUNAR_FESTIVALS`：闰二月初二不再显示「龙抬头」，闰月初一显示「闰二月」。`scripts/test-lunar.ts` 增加 2023 闰二月用例。

## 6. 任务岛今日完成走索引（P2）

`islandState` 不再扫描全部完成历史再在 JS 里按本地日期过滤：
- 新增 `listCompletedBetween(fromIso, toIso, limit, offset)`，按 `completed_at` 范围查询；
- 新增 `idx_tasks_completed (status, completed_at)` 索引；
- 仍按 500 条分页，避免大历史库一次性推送。

回归：`scripts/test-island-completed.ts`（本地边界、排除子任务/删除/跨天、分页、索引存在）。

## 7. 开发环境与测试

- `scripts/app-cdp.mjs`、`scripts/e2e.mjs` 增加 macOS 的 Electron 路径；E2E 的 Windows 开机自启用例在非 Windows 跳过；
- 新增 `scripts/test-restore.ts`、`scripts/test-calendar-sync.ts`、`scripts/test-calendar-events.ts`、`scripts/test-island-completed.ts`，全部并入 `pnpm test:unit`。

验证结果（macOS 开发机）：
- `pnpm typecheck`：通过
- `pnpm test:unit`：通过（含新增 4 个回归）
- `pnpm build`：通过
- `pnpm test:e2e`：33/33 通过（autostart-read 为 Windows 专用，macOS 跳过）
- 手工 UI 走查：任务岛新增/删除、日历月视图日程、周视图全天/定时日程、坏备份恢复被拒且数据不丢、有效备份恢复后自动重启且新增标记任务消失、ICS 新地址 404 后旧订阅不变

## 8. 产物与平台限制

本次在 macOS 上完成，`pnpm dist` 依赖 Windows 的 `csc.exe`（.NET Framework）与 `powershell.exe`，当前环境无法生成 Windows 便携版。

- 已产出开发构建：`out/`（`pnpm build`）
- 未产出：`release/0.6.4/LightTodo-0.6.4-x64.exe`、`LightTodo-0.6.4-portable.zip`、`checksums.json`
- 需在 Windows 环境执行 `pnpm dist` 补齐；按约定，发布前必须先通过类型、单测、启动器与真实成品启动门槛。

## 9. 仍未处理

- `docs/review-2026-11-05.md` 中与 Windows 启动器 Job 对象、便携数据目录迁移相关的 P1，需要 Windows 实机验证；
- ICS 订阅仍不展开 RRULE、不做 TZID 时区换算、不处理 EXDATE；
- 任务岛多显示器 / 全屏自动隐藏尚未实现。
