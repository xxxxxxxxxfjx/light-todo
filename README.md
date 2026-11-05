# 轻单 LightTodo

Windows 上最快的中文待办 —— 本地优先、键盘优先、开箱即用。

## 当前进度

已完成（v1 可用版）：

- Electron + React 19 + TypeScript + Vite 工程骨架
- 本地 SQLite（`node:sqlite`，免原生编译），表结构含任务/清单/文件夹/标签/设置
- 三栏主界面：侧边栏（智能视图 + 清单 + 标签）、任务列表、任务详情 / 今日概览
- 视图：收件箱、今天（逾期分组）、最近 7 天、日历、全部、也许、已完成、按清单、按标签
- 收件箱：未分类、未排期任务独立收集，不污染今天；支持 `T` 今天 / `M` 明天 / `S` 也许键盘 triage
- 也许：暂不安排日期的想法独立收集，不会进入今天
- 任务 CRUD：创建、编辑、完成、删除（软删除）、子任务、标签、优先级、计划日 / 截止日
- 全局快速添加：`Ctrl+Shift+Space` 唤起（含中文自然语言解析、预览 chips）；全局捕获默认进收件箱
- 中文 NLP：今天/明天/下周三/3月5日/今晚8点/每周一三五/每月5号/每月第2个周二/每3天/工作日/!高/#清单/@标签
- 搜索：`Ctrl+F`，标题 / 备注 / 标签
- 列表：超过 150 条自动虚拟滚动（`@tanstack/react-virtual`，支持可变行高），加载更多每页 500 条
- 托盘常驻、全局快捷键、开机自启、Jump List、URL Scheme
- 重复任务：RRULE 引擎，完成后自动生成下一次，支持按计划 / 按完成两种语义
- 提醒：任务级提醒（准时 / 提前 5 分钟 / 15 分钟 / 1 小时 / 1 天），30 秒轮询 + 系统 Toast
- 日历视图：月历、任务落格、今天高亮、双击完成
- 设置页：数据目录、JSON / Markdown 导出、JSON / CSV 导入（TickTick/Todoist）、立即备份、开机自启
- 数据：启动 / 退出自动备份（保留 14 份）、SQLite WAL checkpoint
- 打包：win-unpacked + 便携版 exe + zip（NSIS 安装包在受限环境无法生成，正常机器可用）
- 性能基准：`scripts/seed-bench-10k.ts` + `scripts/bench-perf.ts` + `docs/perf-baseline.md`；10k SQLite 热库数据已实测，干净 Win11 冷启动/内存/FPS 待实测

待完成 / 后续：

- 性能验收：干净 Win11 打包版冷启动 P50 <1s / P95 <2s、常驻 <150MB、1 万条滚动 60fps 仍需在可启动 Electron 的交互式会话实测
- 第 2 阶段后续：通知“完成/稍后”、撤销、拖拽排序、行内标题编辑
- 第 3 阶段：Markdown 预览/checklist、FTS5 搜索、命令面板、CSV/MS To Do/ICS
- 代码签名、自动更新（可选）

## 技术栈

- Electron 45 + electron-vite 6 + Vite 8
- React 19 + TypeScript 5.9
- SQLite：`node:sqlite`（Electron 内置 Node 24）
- 状态：Zustand
- 日期：date-fns + rrule

## 目录

```
src/
  main/        Electron 主进程（窗口、托盘、快捷键、SQLite、IPC）
  preload/     contextBridge API
  renderer/    React 界面
  shared/      类型与中文 NLP 解析
docs/          PRD 与竞品调研
scripts/       图标生成、下载、测试脚本
```

## 开发

```bash
pnpm install
pnpm dev          # 开发模式（需要能启动 Electron 的桌面环境）
pnpm build        # 构建到 out/
pnpm start        # 运行已构建版本（electron .）
pnpm dist         # 打便携版 exe + ZIP（release/<version>/）
pnpm dist:zip     # 打 win-unpacked，再自行压缩为 zip
pnpm dist:setup   # 打 NSIS 安装包（在部分受限/无桌面会话环境会失败，正常机器可用）
pnpm typecheck    # 类型检查
```

> 打包约定：每次完成代码/界面/文档改动后都要执行 `pnpm dist`，不能只交源码；版本号在 `package.json` 中递增，产物在 `release/<version>/`。

当前产物：`release/0.3.1/LightTodo-0.3.1-x64.exe`（直接双击）与
`release/0.3.1/LightTodo-0.3.1-portable.zip`（完整解压后双击 `LightTodo.exe`）。
单文件版首次会在同目录释放 `LightTodoApp-0.3.1-<构建标识>`，日常数据保存到同目录 `LightTodoData`。
启动器先按正常模式运行，并把运行时退出码记录到 `LightTodoData/launcher.log`；受限环境如出现 Chromium 初始化退出码 `0x80000003`，需从命令行加 `--no-sandbox --disable-gpu` 启动。
构建使用本地 Electron 分发目录及 Windows 自带 .NET Framework C# 编译器。

开发数据默认放在项目下 `.tmp/data/`，安装版放在 `%APPDATA%/LightTodo/`，便携版放在 exe 同目录 `LightTodoData/`。

## 临时文件

仓库根目录只保留 `.git/` 与 `.tmp/` 两个点开头目录；所有测试、构建、QA 和截图产物统一放在 `.tmp/`：

| 目录 | 用途 |
| --- | --- |
| `.tmp/data` | 开发模式运行数据 |
| `.tmp/qa` | 单元/QA 回归临时数据库 |
| `.tmp/e2e` | Electron E2E 与 CDP 测试数据 |
| `.tmp/perf` | 性能基准数据与报告 |
| `.tmp/shots` | 截图 |
| `.tmp/logs` | 历史日志 |
| `.tmp/cache` | npm/pnpm 缓存 |
| `.tmp/archive` | 旧临时目录归档 |
| `.tmp/scratch` | 临时脚本草稿 |

测试脚本会自动创建对应子目录；不要再往仓库根目录新建 `.qa-*` / `.e2e-*` / `.perf-*` 等目录。

## 测试脚本

```bash
node --experimental-strip-types scripts/test-nlp.ts
node --experimental-strip-types scripts/test-db.ts
```

## 说明

- 本机（DSH 受限环境）启动 Electron 需要 `--no-sandbox --disable-gpu`，并且 Electron 的
  `userData` 必须放在工作区内，否则 Chromium 的命名管道会被拒绝。正常桌面环境不需要这些参数。
- 图标由 `scripts/gen-icons.mjs` 纯 Node 生成，产物在 `build/`。

## 0.2.0 日历和QA修复

日历支持月/周/日视图、日期跳转、单击查看当天安排、双击日期新建、拖动修改计划日和显示已完成。

修复记录见 `docs/qa-fixes-0.2.0.md`。新增回归：

```bash
node --experimental-strip-types scripts/test-qa-regressions.ts
node scripts/qa-store-review.mjs
node scripts/e2e-calendar.mjs release/0.2.9/LightTodo-0.2.9-x64.exe
```

## 0.2.1 周视图、窗口适配和主题

周视图使用七天时间轴，区分全天/定时任务，重叠任务并排显示；双击时间格带入时间新建，支持跨周导航和记住视图。
窗口缩小时折叠侧栏，详情使用抽屉，周时间表保持内部滚动。
原生窗口控制按钮背景和图标随应用/系统主题同步。

```bash
node scripts/e2e-layout-theme.mjs
node scripts/e2e-layout-theme.mjs release/0.2.9/LightTodo-0.2.9-x64.exe
```

## 0.2.2

修复默认启动强制创建LocalAppData日志目录导致的权限错误。单文件/目录版均沿用便携根目录的LightTodoData，日志失败不阻断启动。日历各内容区滚动条改为细圆角、悬停加深并跟随主题。

回归：`node scripts/test-launcher.cjs`；默认路径成品验证：`node scripts/test-default-launch.mjs release/0.2.9/LightTodo-0.2.9-x64.exe`。

## 0.2.3

日历月/周视图改为按格高动态展示多项，溢出统一显示“还有 N 项…”，并支持在日历与当天任务之间拖动调整高度。
已完成、回收站支持多选批量删除/恢复；清理收件箱遗留逻辑，未分类任务统一归入今天/全部；设置窗口改为居中展示。

回归：`node scripts/e2e.mjs batch-completed-trash`、`node scripts/e2e.mjs add-unfiled`、`node scripts/e2e.mjs nav-views`、`node scripts/e2e-flows.mjs flow-list-lifecycle`。

## 0.2.4

任务详情面板支持点击无关区域自动关闭：点击任务列表空白、筛选项或其他非任务区域时收起详情；点击另一条任务、搜索结果或日历任务仍会直接切换详情。新增 `detail-click-outside` 回归。

回归：`node scripts/e2e.mjs detail-click-outside`。

## 0.2.5

月视图改为纵向连续月历，滚动到顶部/底部时自动加载上一个月/下一个月，方便规划未来任务；顶部月份标题随滚动同步更新，「今天」和日期跳转会定位到对应月份。新增 `month-scroll` 回归。

回归：`node scripts/e2e.mjs month-scroll`、`node scripts/e2e-calendar.mjs`。

## 0.2.6

搜索快捷键改为 `Ctrl+F`。重新定义「也许」：它是暂时不安排日期的想法，新增任务不会进入今天；详情面板支持「移到也许 / 安排到今天」。
新增任务按当前视图归属：全部/清单/标签默认今天，最近 7 天默认明天，也许保持无日期；筛选栏按视图只展示有效筛选，并在新增后自动回到「全部」筛选，避免新任务从当前视图消失。标签视图新增会自动带上当前标签。

回归：`node scripts/e2e.mjs maybe-add`、`upcoming-add`、`nav-views`、`shortcut-search`。

## 0.2.7

周视图的定时任务改为单行展示：左侧时间、右侧任务标题，超出宽度自动省略；重叠任务仍按泳道并排，多任务时不再出现时间/标题上下错位。

回归：`node scripts/e2e-layout-theme.mjs`。

## 0.2.8

周视图定时任务不再使用左右泳道分栏，改为像全天任务一样逐行全宽排列：每行左侧时间、右侧标题；同一时段的任务纵向堆叠，避免窄列文字挤压。

回归：`node scripts/e2e-layout-theme.mjs`。

## 0.2.9

周视图定时任务按开始时间分组：同一时间的任务显示在同一个时间条下纵向堆叠，时间条高度随任务数量自动撑开；不同时间的任务各自占一行，避免横向窄列和文字挤压。

回归：`node scripts/e2e-layout-theme.mjs`。

## 0.3.0

第 1 阶段「可信的快」+ 收件箱。详见 `docs/release-0.3.0.md` 与 `docs/perf-baseline.md`。

- 超过 150 条任务自动虚拟滚动，首屏 500 条、每页 500 条；修复加载更多与刷新竞态。
- 收件箱：全局捕获/未分类未排期任务不再进入今天；T/M/S 键盘 triage。
- 桌宠新装默认关闭，开启后延迟约 8 秒创建；老用户保持原默认。
- 侧栏计数一次扫描 + 清单/标签聚合，10k 热库 66–88ms → 约 22ms。
- 备注列表回填修复，避免打开详情后误清空备注。
- 新增 `scripts/seed-bench-10k.ts`、`scripts/bench-perf.ts`、`scripts/e2e-virtual.mjs` 与性能基线文档。
- 回归：pnpm typecheck、pnpm test:unit 全部通过；Electron E2E/冷启动/内存/FPS 因本会话 Chromium IPC 限制未测，需干净 Win11 复跑。

## 0.3.1

临时目录整理：仓库根目录只保留 `.git/` 与 `.tmp/`，所有测试/QA/E2E/性能/截图/缓存统一放到 `.tmp/` 下；脚本路径已同步。详见 `docs/release-0.3.1.md`。

- `.tmp/data` 开发数据、`.tmp/qa` 单元/QA、`.tmp/e2e` E2E、`.tmp/perf` 基准、`.tmp/shots` 截图、`.tmp/logs` 日志、`.tmp/cache` 缓存、`.tmp/archive` 旧目录归档。
- `scripts/app-cdp.mjs`、`e2e*.mjs`、`test-*.ts`、`bench-perf.ts` 等已改为写入 `.tmp/`，后续测试不会再污染根目录。
