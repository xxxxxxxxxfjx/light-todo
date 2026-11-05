# LightTodo 性能基线与复现方法

> 状态：**工具链已落地，SQLite 基准已在当前环境实测；冷启动 / 内存 / 1 万条滚动 FPS 在当前 DSH 会话中未测。**
> 本文不把受限环境或冒烟测试的数字伪造成干净 Win11 发布基线。

对应路线图：`docs/competitive-analysis-2026-11-05.md` 第 5 节，第 1 阶段“可信的快”的通过标准为：

| 指标 | 目标 |
| --- | --- |
| 干净 Win11 冷启动 | P50 < 1s，P95 < 2s |
| 常驻内存 | < 150MB |
| 1 万条任务滚动 | 60fps |

## 1. 交付物

| 文件 | 用途 |
| --- | --- |
| `scripts/seed-bench-10k.ts` | 清空并重建隔离数据目录，生成可重复的 1 万条任务基准库 |
| `scripts/bench-perf.ts` | DB、冷启动、CDP 列表加载、滚动 FPS、进程内存的一体化基准 |
| `docs/perf-baseline.md` | 本方法、指标定义、环境限制与当前结果 |

两个脚本只使用 Node 内置模块和仓库已有依赖，不需要新增 npm 包，也不会修改 `src/`、`package.json` 或已有脚本。

## 2. 数据集

### 2.1 生成命令

在仓库根目录执行：

```powershell
# 正式数据集：10000 条，默认写入 .tmp/perf/bench
node --experimental-strip-types scripts/seed-bench-10k.ts --dir .tmp/perf/bench --count 10000

# 短冒烟：1000 条
node --experimental-strip-types scripts/seed-bench-10k.ts --dir .tmp/perf/bench-smoke --count 1000
```

`--dir` 必须是仓库内、非仓库根目录；脚本拒绝清理 `src/`、`scripts/`、`docs/`、`out/` 等受保护目录。目标目录每次运行会先被删除，再通过 `src/main/db.ts` 的 `initDb()` 建立当前 schema，最后用一个事务写入数据。

### 2.2 分布（默认 10000 条）

| 类别 | 数量 | 生成方式 |
| --- | ---: | --- |
| 逾期 | 1500 | 过去 1–30 天；部分使用 `scheduled_date`，部分使用 `due_at` |
| 今天 | 2000 | 当天计划；部分改用当天下午的 `due_at` |
| 未来 7 天 | 2500 | 未来 1–7 天；部分使用 `due_at` |
| 无日期 | 3000 | 活动任务，无计划/截止日期，归入 5 个清单之一 |
| 也许 | 800 | `someday=1`，无日期 |
| 已完成 | 100 | `status=1`，带 `completed_at` |
| 回收站 | 100 | `deleted_at` 非空 |
| **合计** | **10000** | 5 个清单、7 个标签 |

其他覆盖：

- 每个任务最多 2 个标签；默认数据集的 `task_tags` 共 12500 条。
- 约 4286 条带 Markdown 备注，包含中文“会议”和英文 `meeting`，用于中英文搜索基准。
- 每 50 条有一条长标题（最长约 180 个字符）。
- 优先级覆盖 0–3；`sort_order` 以 1024 递增；id 固定为 `bench-task-000001` 形式，便于重复运行和 diff。
- “全部”视图只包含 `status=0 AND deleted_at IS NULL` 的顶层任务，因此 10000 条中可见 **9800 条**（100 条已完成 + 100 条回收站不可见）。
- 如果测试需要 DOM 恰好 10000 行，可把 `--count` 调大；基准脚本会把 `--target-rows` 自动截断到当前“全部”视图实际可见数量，避免空转等待。

## 3. 基准命令

### 3.1 完整运行

```powershell
node --experimental-strip-types scripts/bench-perf.ts `
  --dir .tmp/perf/bench `
  --runs 5 `
  --app-runs 3 `
  --target-rows 10000 `
  --fps-duration 2000
```

默认输出：

```text
.tmp/perf/results/<timestamp>.json
.tmp/perf/results/<timestamp>.md
```

也可指定路径：

```powershell
node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --json .tmp/perf/results/my-run.json
node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --md .tmp/perf/results/my-run.md
```

### 3.2 只跑 DB

```powershell
node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --runs 5 --skip-app
```

### 3.3 只跑应用（用已有数据目录）

```powershell
node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --skip-db --app-runs 3
```

### 3.4 其他参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--runs` | `5` | DB 每项预热 1 次后的测量次数 |
| `--app-runs` | `3` | 独立 Electron 启动次数，用于冷启动 P50/P95 |
| `--target-rows` | `10000` | load-more 加载上限，自动按“全部”可见任务数截断 |
| `--fps-duration` | `2000` | 滚动采样窗口（ms） |
| `--port` | 自动 | 固定 CDP 端口；默认每次选择空闲 loopback 端口 |
| `--electron` | `node_modules/electron/dist/electron.exe` | 被测 Electron 可执行文件 |
| `--skip-db` / `--skip-app` | 无 | 跳过对应阶段 |

## 4. 指标定义

### 4.1 SQLite / DB

- 初始化一次 `initDb()`，先对每个查询预热 1 次，再连续测量 `--runs` 次。
- 计时使用 `performance.now()`，包含 JS 调用、SQL 执行、结果行映射为对象的时间，不包含进程启动。
- P50/P95 使用排序后线性插值：`rank=(n-1)*p`，相邻样本按小数部分插值。5 次样本的 P95 对极值敏感，只能作为方向性指标；正式验收建议至少 20 次并报告置信区间。
- 查询集：
  - `getSidebar()`
  - `listTasks({ view: 'today' })`
  - `listTasks({ view: 'all', limit: 1000 })`
  - `listTasks({ view: 'all', limit: 10000 })`
  - `listTasks({ view: 'upcoming' })`
  - `searchTasks('会议')`
  - `searchTasks('meeting')`
- `listTasks` 不传 `limit` 时，今天/最近 7 天默认上限是 1000。因此 3500 条今天任务的数据集里，返回行数仍是 1000；这是接口默认行为，不是数据缺失。
- 所有数字都是热连接、WAL 已建立、同一 Node 进程内的结果。它没有覆盖磁盘冷缓存、并发写、锁竞争或首次打开数据库的成本。

### 4.2 冷启动

- 启动命令等价于：

  ```text
  node_modules/electron/dist/electron.exe --no-sandbox --disable-gpu ^
    --enable-precise-memory-info --remote-debugging-port=<port> .
  ```

- 启动前删除 `ELECTRON_RUN_AS_NODE`，并设置 `LIGHTTODO_DATA_DIR` 为仓库内数据目录。
- `COLD_START_MS` 由 `src/main/index.ts` 在 `ready-to-show` 时写入 `LIGHTTODO_DATA_DIR/userdata/startup.log`，定义为 **主进程模块 T0 到首个窗口可显示** 的墙钟时间。
- 默认独立启动 3 次，取 P50/P95。没有重启系统、没有清空 Windows 文件缓存、没有切换电源计划；这不是“冷开机”指标。
- Electron 使用 `detached: true, stdio: 'ignore'` 启动（与 `scripts/app-cdp.mjs` 的启动形状一致）；每次启动前记录 `startup.log` 的字节偏移，只读取本次启动新增的 `COLD_START_MS` 行。本会话仍因 Chromium IPC 受限而失败，见 5.3。
- 另有一个端到端口径 `coldStartE2EMs`：父进程 `spawn` 起算，到 CDP `Runtime.evaluate` 首次观察到 `.task-row` 数量 > 0。它比 `COLD_START_MS` 多包含 CDP/页面就绪与首屏 React 渲染，适合观察用户真正看到任务列表的时间。

### 4.3 列表加载与滚动 FPS

1. 通过 CDP 连接页面 target。
2. 点击侧栏 `.nav-item` 中文本以“全部”开头的项。
3. 反复点击 `.load-more`，每次等待 loading 结束且 `.main-count` 的已加载任务数增长（虚拟列表下 `.task-row` DOM 行数可能保持不变），直到没有按钮或达到 `--target-rows`。
4. 统计 `.task-row` 的 **DOM 行数**、`.main-count` 的 **已加载任务数**、`.task-scroll` 的 `scrollHeight` / `clientHeight` / 可滚动距离。虚拟列表下这两个数量必须分开报告。
5. 在页面内用 `requestAnimationFrame` 把 `scrollTop` 从 0 线性推进到最大值，持续 `--fps-duration`（默认 2 秒）。
6. 返回：
   - `fps = 帧间隔数量 / 测量秒数`
   - `longestFrameMs`：最长单帧间隔
   - `p95FrameMs`：95 分位帧间隔
   - `fps60HitRate`：帧间隔 ≤ 17ms 的比例（“约 60fps 达成率”）
   - `fps50HitRate`：帧间隔 ≤ 20ms 的比例
   - `performance.memory.usedJSHeapSize`（若 Chromium 在 `--enable-precise-memory-info` 下暴露）

TaskList 已接入 `@tanstack/react-virtual`：可见任务 >150 时只挂载窗口内行（overscan 10），并使用 `measureElement` 支持任务元信息换行导致的可变行高；≤150 时保留原 DOM 结构。因此 9800 条任务在「全部」视图里真实 DOM 约 20–60 个 `.task-row`，而不是 9800 个。`scripts/e2e-virtual.mjs` 用 600 条任务做定向验收：断言 `data-virtualized="true"`、首屏 500 条加载、DOM 行数 <80、滚动到底仍 <80、加载更多后总数增长。该脚本需要可启动 Electron 的会话；本 DSH 会话无法启动，见 5.3。

### 4.4 进程内存

- 通过浏览器级 CDP `SystemInfo.getProcessInfo` 取得主进程、renderer、GPU、utility 等进程的 PID。
- 再用 PowerShell `Get-Process -Id <pid...>` 读取每个 PID 的 `WorkingSet64`。
- 在“启动后（未加载全量）”和“加载列表后”各采一次。
- 报告 `mainPlusRendererWorkingSetBytes`（主进程 + 渲染进程合计）、各自的 WorkingSet64、总进程数和主+渲染进程数。
- 汇总 WorkingSet64 会重复计算共享页，**不能**直接等同于任务管理器“内存”列或私有提交内存；它是同一时刻的进程工作集合计。
- 脚本使用 CDP 的精确 PID，避免把用户其他 Electron 应用算进来；如果 CDP 进程信息不可用，该阶段直接标为未测，不估算。

## 5. 当前实测结果

### 5.1 环境

| 项 | 值 |
| --- | --- |
| OS | Windows 10.0.19044（宿主报告；不是 Win11） |
| CPU | Intel Core i7-8700 @ 3.20GHz，12 逻辑核 |
| 内存 | 16GB |
| Node | v22.20.0 |
| Electron | 45.2.1 |
| 数据目录 | `E:\code\todo\.tmp/perf/bench` |
| 渲染 | 测试参数强制 `--disable-gpu`（软件渲染） |
| 会话 | DSH 受限 Windows 会话，`SESSIONNAME=Console` |

正式报告文件：

- `.tmp/perf/results/db-final-0.3.0.json`
- `.tmp/perf/results/db-final-0.3.0.md`

### 5.2 SQLite 基准（10000 条，实测）

测量 5 次，预热 1 次；单位 ms。数据来自上述正式报告（已完成 `getSidebar` 单次扫描、清单/标签聚合与收件箱计数）。

| 查询 | 返回行数 | P50 | P95 |
| --- | ---: | ---: | ---: |
| `getSidebar()` | — | 22.389 | 23.735 |
| `listTasks(today)` | 1000 | 17.928 | 18.842 |
| `listTasks(all, 1000)` | 1000 | 13.599 | 13.976 |
| `listTasks(all, 10000)` | 9800 | 129.409 | 133.910 |
| `listTasks(upcoming)` | 1000 | 14.876 | 16.742 |
| `searchTasks('会议')` | 60 | 30.658 | 33.943 |
| `searchTasks('meeting')` | 60 | 30.040 | 30.472 |

另一次 20 次扩展运行（`.tmp/perf/results/2026-11-05T05-47-37-605Z.json`）方向一致：`getSidebar` P50 20.8 / P95 28.9ms，`all(10000)` 120.4 / 135.6ms，搜索中英文约 31 / 30ms。

解释：

- `getSidebar` 从优化前的 66–88ms 降到约 21ms：原先 7 个独立 COUNT + 每条清单/标签的相关子查询，改为一次任务表扫描 + 一次清单聚合 + 一次标签聚合，并补了 `task_tags(tag_id)` 与 `tasks(status, deleted_at, parent_id)` 索引。每次任务变更都会刷新侧栏，这个优化直接改善点击勾选后的响应。
- `listTasks(all,10000)` 约 129ms：这是列表接口的上限场景，把 9800 个任务对象、标签 JSON 和子任务计数全部映射出来的成本。首屏只加载 500 条（约 14–20ms），之后每次「加载更多」500 条；虚拟滚动不改变 DB 查询成本，但把 DOM/React 成本压到窗口大小。
- 搜索仍是 LIKE + LIMIT 60，约 31–40ms；FTS5 属于第 3 阶段，尚未实现。
- 5 次样本太少，P95 近似于最大值，不能据此判断尾部稳定性；当前结果只适合作为本机方向性对照。

### 5.3 冷启动 / 内存 / FPS（未测）

| 指标 | 结果 | 原因 |
| --- | --- | --- |
| 冷启动 `COLD_START_MS` P50/P95 | **未测** | Electron 在 `ready-to-show` 前退出 |
| 冷启动 E2E 到首行 P50/P95 | **未测** | 同上，CDP 页面未进入可用状态 |
| 主进程+渲染进程内存 | **未测** | 同上 |
| 1 万条滚动 FPS | **未测** | 同上 |
| 60fps 达成率 | **未测** | 同上 |

已确认启动参数包含：

```text
--no-sandbox --disable-gpu --enable-precise-memory-info --remote-debugging-port=<free>
```

并已删除 `ELECTRON_RUN_AS_NODE`、把 `LIGHTTODO_DATA_DIR` 设到仓库内。先后测试了 `stdio: 'pipe'`、文件重定向和 `detached: true + stdio: 'ignore'` 三种方式；在当前 DSH 子代理会话中，Electron 都在 `ready-to-show` 之前以退出码 `2147483651` 结束。`startup.log` 只留下：

```text
Starting 0.2.13 E:\code\todo\node_modules\electron\dist\electron.exe
```

`stdio: 'pipe'` 时捕获到的底层错误是：

```text
FATAL:mojo\public\cpp\platform\platform_channel.cc:112
Check failed: . : 拒绝访问。 (0x5)
```

因此这不是“未加 `--no-sandbox`”的问题（参数已包含），也不是用 `stdio: 'ignore'` 就能在本会话消除的问题；这是**当前受限会话的 Chromium 子进程/IPC 运行限制**。没有在此环境强行把失败包装成基准数字。需要主会话或干净交互式 Windows 11 会话重跑应用阶段。

应用阶段三次启动的原始尝试报告：`.tmp/perf/results/2026-11-05T05-47-37-605Z.json` 与 `.md`。

要得到这三项的有效数据，必须在允许 GUI 子进程和 Chromium IPC 的干净交互式 Windows 11 会话中重跑 `scripts/bench-perf.ts`（不要用 DSH 的受限命令沙箱）。

## 6. 未覆盖项

- 干净 Windows 11、重启后的操作系统级冷启动；没有清空文件缓存、没有控制 Defender/索引器/后台更新。
- 硬件 GPU 合成、真实显示器刷新率、Mica/透明效果；当前测试强制软件渲染。
- 打包后的 portable exe（`release/<version>/...`）冷启动；不要在没有重新 `pnpm build` 的情况下把旧 `out/` 数字当发布数字。
- 长时间常驻后的内存增长、GC 峰值、重复打开/关闭窗口。
- SQLite 首次建库、磁盘冷缓存、并发写入、锁等待、导入 1 万条数据的耗时。
- 1 万条任务搜索的发布门槛（本次搜索约 31–40ms 只是热库方向值，不是完整验收）。
- 任务详情打开、编辑、批量操作、回收站恢复等交互延迟。
- 跨机器/跨 Electron 版本的稳定性；不同 CPU、内存、杀毒软件和电源计划都会改变结果。

## 7. 结果判读与后续建议

1. **`getSidebar` 已优化**：一次任务表扫描 + 清单/标签聚合，10k 热库约 21ms（原 66–88ms）。后续若还要压缩，可把侧栏与任务列表合并成一次 IPC bootstrap。
2. **列表虚拟化已落地**：`@tanstack/react-virtual` 阈值 150，可变行高用 `measureElement`；首屏 500 条，加载更多每页 500 条。10k 场景的 DOM 行数应从 9800 降到约 20–60，需在可启动 Electron 的会话里用 `scripts/e2e-virtual.mjs` 和本脚本复测 FPS。
3. **冷启动必须用干净 Win11**：在 DSH 或已运行过多次的热缓存机器上得到的 `<1s` 不能作为路线图通过证据。应用阶段目前在 DSH 会话中被 Chromium IPC 限制阻断（见 5.3）。
4. **内存要区分空载和满载**：本脚本分别采样启动后、加载 9800 条任务后（虚拟列表 DOM 行数仍很少）的 WorkingSet64；发布门槛“常驻 <150MB”应明确是空载还是满载，否则不可比较。
5. **保存原始 JSON**：Markdown 只是展示层；`--json` 的原始样本、环境、错误和参数应随基线一起归档。

## 8. 清理

基准进程由脚本在 `finally` 中通过 `taskkill /PID <root> /T /F` 结束，并等待 CDP 端口关闭。手动清理数据目录时：

```powershell
Remove-Item -Recurse -Force .tmp/perf/bench, .tmp/perf/bench-smoke
```

`.tmp/perf/results/` 中的 JSON/Markdown 是结果证据，按需保留；`.tmp/perf/results/.tmp/` 只用于 PowerShell 进程内存采样的临时文件，脚本会自动删除。
