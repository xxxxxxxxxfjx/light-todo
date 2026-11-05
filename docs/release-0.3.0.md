# 0.3.0 · 第 1 阶段「可信的快」+ 收件箱

日期：2026-11-05

对应 `docs/competitive-analysis-2026-11-05.md` 90 天路线：

- **第 1 阶段（第 1–2 周）**：TaskList 虚拟滚动、桌宠延迟加载/默认关闭、初始加载与侧栏查询优化、可复现性能基准。
- **第 2 阶段开始（第 3 周）**：收件箱 / 未分类与键盘 triage。

## 1. 用户可见变化

### 收件箱（新）

- 侧栏新增「收件箱」。未分类、无计划日、无截止时间的未完成任务进入收件箱，不再污染「今天」。
- 全局快捷键 `Ctrl+Shift+Space`、托盘新建、`lighttodo://add` 默认进收件箱；显式 `#清单` / 日期仍然优先。
- 收件箱内选中任务后按 `T` 安排到今天、`M` 安排到明天、`S` 移到也许。
- 「今天」现在只显示有计划日或截止时间的任务；旧库中无日期未分类任务会在升级后自动出现在收件箱。
- 当前清单视图新建任务不再自动补今天日期，任务留在清单内，稍后可排期。

### 性能与启动

- 任务列表超过 150 条时启用 `@tanstack/react-virtual` 虚拟滚动，只挂载窗口内行；元信息换行导致的可变行高通过 `measureElement` 自适应。≤150 条保持原 DOM 结构。
- 首屏任务加载从固定 1000 条改为按视图 200–500 条，加载更多每页 500 条；「加载更多」后并发刷新不会把列表缩回上一页。
- 桌宠新安装默认关闭；开启后主窗口就绪约 8 秒再创建，托盘/设置中显式开启会立即创建。升级前已有安装（有 seeded / 清单 / 桌宠位置）保持原有默认开启。
- 侧栏计数从 7 个独立 COUNT + 每条清单/标签相关子查询，改为一次任务扫描 + 清单/标签聚合；10k 热库 `getSidebar` 从 66–88ms 降到约 22ms。
- 新增 `task_tags(tag_id)` 与 `tasks(status, deleted_at, parent_id)` 索引。
- 回收站清理从启动路径移到首屏之后；`COLD_START_MS` 现在同时写入 `userdata/startup.log`。
- 今日概览不再重复请求整个今天列表，改用侧栏计数。

### 其他修复

- 恢复 list 查询返回备注，修复“打开有备注的任务 → 点备注框 → 失焦后备注被清空”的数据丢失风险（新增 DB 回归断言）。
- 跨 150 条阈值时虚拟/非虚拟分支的左右缩进保持一致。
- 已完成/回收站等分页视图的标题计数在还有未加载数据时显示 `500+`，不再把“已加载数”伪装成总数。
- 筛选无结果且还有未加载数据时，提示“已加载范围内没有匹配”，并提供“加载更多”，不再误报“没有任务”。

## 2. 性能基准

新增：

- `scripts/seed-bench-10k.ts`：可重复生成 10,000 条任务基准库（5 清单、7 标签、逾期/今天/未来/无日期/也许/完成/回收站）。
- `scripts/bench-perf.ts`：SQLite 7 项查询、Electron 冷启动、CDP 首行、列表加载、2 秒 rAF 滚动 FPS、进程 WorkingSet 内存；支持 `--skip-db` / `--skip-app` / `--json` / `--md`。
- `docs/perf-baseline.md`：指标定义、运行方法、结果与环境限制。
- `scripts/e2e-virtual.mjs`：600 条任务的虚拟滚动定向验收（真实 Electron 环境下运行）。

本机 10k SQLite 实测（5 次，P50/P95，详见 `docs/perf-baseline.md` 5.2）：

| 查询 | P50 | P95 |
| --- | ---: | ---: |
| `getSidebar()` | 22.4ms | 23.7ms |
| `listTasks(today)` | 17.9ms | 18.8ms |
| `listTasks(all, 1000)` | 13.6ms | 14.0ms |
| `listTasks(all, 10000)` | 129.4ms | 133.9ms |
| `listTasks(upcoming)` | 14.9ms | 16.7ms |
| `searchTasks('会议')` | 30.7ms | 33.9ms |
| `searchTasks('meeting')` | 30.0ms | 30.5ms |

**未测**：冷启动、常驻内存、10,000 条滚动 FPS、打包版数字。当前 DSH Windows 会话中 Electron 在 `ready-to-show` 前被 Chromium IPC/沙箱限制终止（`platform_channel.cc:112`，退出码 2147483651），不是应用源码错误，也不能用该环境数字冒充干净 Win11 发布基线。需在允许 GUI 子进程和 Chromium IPC 的交互式 Windows 11 会话中重跑：

```powershell
node --experimental-strip-types scripts/seed-bench-10k.ts --dir .tmp/perf/bench --count 10000
node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --runs 20 --app-runs 5 --target-rows 10000
```

## 3. 测试

已在本机执行：

- `pnpm typecheck`：通过（node + web 两套 tsconfig）。
- `pnpm test:unit`：全部通过（NLP 24、DB、导入 8、重复/提醒、QA 回归、Bugfix 回归、store review、周历、日历范围 8009 条）。
- `node --experimental-strip-types scripts/test-db.ts`：新增备注不丢、收件箱/今天隔离、清单无日期、someday 排除、inbox 计数生命周期断言。
- `node --experimental-strip-types scripts/test-qa-regressions.ts`：新增「收件箱生命周期与今天隔离」。
- `node scripts/qa-store-review.mjs`：新增「加载更多与并发刷新不会回退列表」竞态回归。
- `pnpm build`：通过。
- DB 基准确认通过（`--skip-app`）。

未执行：

- Electron 真实窗口 E2E / Playwright / `scripts/e2e-virtual.mjs`：本会话 Electron 无法启动（同上）。
- 10k 滚动 FPS / 冷启动 / 内存实测：同上。
- 任务详情、拖拽、通知操作、撤销等仍属后续阶段，未在本版本改动。

## 4. 升级与回滚说明

- 数据库 schema 通过 `CREATE INDEX IF NOT EXISTS` / `ensureColumn` 增量升级，不需要手动迁移；旧库首次启动会补索引与 `pet_settings`。
- 收件箱是一次用户可见的语义变化：旧库中无清单、无日期的任务会从「今天」移到「收件箱」；任务本身不移动、不丢失。
- 桌宠默认值只影响“从未保存过桌宠设置”的安装；已有显式设置（包括关闭）不会被覆盖。
- 如需回滚，直接替换回 0.2.13 可执行文件即可；新增索引与设置键对旧版无害。

## 5. 产物

打包后见 `release/0.3.0/`：

- `LightTodo-0.3.0-x64.exe`（单文件便携版）
- `LightTodo-0.3.0-portable.zip`（完整目录版）
- `checksums.json`（包含文件大小与 SHA-256）
