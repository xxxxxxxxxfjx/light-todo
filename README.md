# 轻单 LightTodo

Windows 上最快的中文待办 —— 本地优先、键盘优先、开箱即用。

## 当前进度

已完成（v1 可用版）：

- Electron + React 19 + TypeScript + Vite 工程骨架
- 本地 SQLite（`node:sqlite`，免原生编译），表结构含任务/清单/文件夹/标签/设置
- 三栏主界面：侧边栏（智能视图 + 清单 + 标签）、任务列表、任务详情 / 今日概览
- 视图：今天（逾期分组）、最近 7 天、日历、全部、也许、已完成、按清单、按标签
- 也许：暂不安排日期的想法独立收集，不会进入今天
- 任务 CRUD：创建、编辑、完成、删除（软删除）、子任务、标签、优先级、计划日 / 截止日
- 全局快速添加：`Ctrl+Shift+Space` 唤起（含中文自然语言解析、预览 chips）
- 中文 NLP：今天/明天/下周三/3月5日/今晚8点/每周一三五/每月5号/每月第2个周二/每3天/工作日/!高/#清单/@标签
- 搜索：`Ctrl+F`，标题 / 备注 / 标签
- 托盘常驻、全局快捷键、开机自启、Jump List、URL Scheme
- 重复任务：RRULE 引擎，完成后自动生成下一次，支持按计划 / 按完成两种语义
- 提醒：任务级提醒（准时 / 提前 5 分钟 / 15 分钟 / 1 小时 / 1 天），30 秒轮询 + 系统 Toast
- 日历视图：月历、任务落格、今天高亮、双击完成
- 设置页：数据目录、JSON / Markdown 导出、JSON / CSV 导入（TickTick/Todoist）、立即备份、开机自启
- 数据：启动 / 退出自动备份（保留 14 份）、SQLite WAL checkpoint
- 打包：win-unpacked + 便携版 exe + zip（NSIS 安装包在受限环境无法生成，正常机器可用）

待完成 / 后续：

- 性能验收：本机 DSH 环境 Electron 启动约 4s（Chromium 软件渲染开销），应用自身开销 <1s；正常 GPU 机器预期冷启动 <1s
- 代码签名、自动更新（可选）
- 看板 / 四象限 / 习惯 / 番茄钟 / 附件（v1.1 候选）

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
pnpm dist         # 打便携版 exe + ZIP（release/0.2.9/）
pnpm dist:zip     # 打 win-unpacked，再自行压缩为 zip
pnpm dist:setup   # 打 NSIS 安装包（在部分受限/无桌面会话环境会失败，正常机器可用）
pnpm typecheck    # 类型检查
```

当前产物：`release/0.2.9/LightTodo-0.2.9-x64.exe`（直接双击）与
`release/0.2.9/LightTodo-0.2.9-portable.zip`（完整解压后双击 `LightTodo.exe`）。
单文件版首次会在同目录释放 `LightTodoApp-0.2.9-<构建标识>`，日常数据保存到同目录 `LightTodoData`。
启动器先按正常模式运行；仅在观察到当前受限 Windows 环境的 Chromium 初始化退出码 `0x80000003` 时，自动以兼容模式重试，并在 `launcher.log` 留下记录。
构建使用本地 Electron 分发目录及 Windows 自带 .NET Framework C# 编译器。

开发数据默认放在项目下 `.data/`，安装版放在 `%APPDATA%/LightTodo/`，便携版放在 exe 同目录 `LightTodoData/`。

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
