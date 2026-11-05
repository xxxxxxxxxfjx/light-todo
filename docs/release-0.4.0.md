# 0.4.0 · 日常闭环与知识工作

日期：2026-11-05

本版本完成 90 天路线第 2 阶段（日常闭环）与第 3 阶段（知识工作）的主要交付，并提前落下第 4 阶段的任务栏角标。

## 1. 日常闭环

### 提醒可完成 / 稍后

- Windows 提醒 toast 增加「完成」「稍后 10 分钟」两个动作（ToastGeneric + 协议激活）。
- 点击 toast 主体打开对应任务；完成/稍后不抢主窗口焦点。
- 提醒分「已错过」与「刚到期」：错过合并为一条摘要，刚到期最多 3 条逐条弹出，超出部分汇总。
- 新增 `snoozeReminder`：将 `reminder_at` 推后并清空 `notified_at`，已完成/已删除任务忽略。
- 兼容非 Windows：使用 Electron `actions` 按钮；通知不可用时仍标记已发送，避免每 30 秒重复轰炸。

### 撤销

- `Ctrl+Z` 撤销最近一次完成、删除、移动（日期/清单/也许）、拖动排序。
- toast 上提供「撤销」按钮；撤销栈最多 30 条。
- 输入框内 `Ctrl+Z` 保留原生文本撤销，不抢应用级撤销。

### 拖拽排序与行内编辑

- 任务行支持 HTML5 拖拽，按行中点显示前/后插入指示线；同一可视窗口内可直接排序，虚拟列表同样可用。
- 双击标题行内编辑；Enter/失焦保存，Esc 取消，空白标题不落库；输入法组合输入中的 Enter 不误提交。
- 多选模式与已完成视图禁用拖拽，避免与选择/完成时间排序冲突。

## 2. 知识工作

### Markdown 与 checklist

- 详情备注支持「编辑 / 预览」切换。
- 支持标题、粗体、斜体、行内代码、链接、引用、有序/无序列表、代码块。
- `- [ ]` / `- [x]` 渲染为可点击 checklist，点击直接写回原备注行。
- 使用 React 节点渲染，不使用 `dangerouslySetInnerHTML`；链接只允许 http(s)，通过主进程 `shell.openExternal` 打开。

### FTS5 搜索

- 新增独立 FTS5 trigram 索引 `tasks_fts`，覆盖标题、备注、标签；任务/标签增删改触发器同步，旧库启动时幂等回填。
- 3 个及以上 Unicode 码点走 FTS5，少于 3 个字符或 FTS 无结果自动回退 LIKE。
- 10k 数据集实测：`searchTasks(会议)` P50 41.2ms / P95 46.6ms；`searchTasks(meeting)` P50 32.2ms / P95 36.4ms；1500 条库 FTS P50 约 5ms。
- 搜索面板上限从 60 提到 200，超过时提示细化关键词。

### 命令面板

- `Ctrl+K` 打开命令面板，可切换收件箱/今天/最近 7 天/全部/也许/已完成/回收站、打开清单、新建、搜索、设置、导出 JSON/Markdown。
- 键盘 ↑/↓/Enter/Esc 操作，输入过滤。

### CSV / Microsoft To Do / ICS

- 设置 → 数据新增「导出 CSV」「导出 ICS」。
- CSV：UTF-8 BOM + RFC4180 转义，列含标题/清单/标签/优先级/计划日/截止时间/完成状态/备注。
- ICS：VCALENDAR/VEVENT，全天 `VALUE=DATE`、定时浮动本地时间、UID/DTSTAMP/RRULE，文本按 RFC5545 转义。
- Microsoft To Do CSV 导入：识别 Subject/Status/Completed/Importance/Due Date/Start Date/List Name，复用现有清单与完成状态逻辑。

## 3. 任务栏角标

- Windows：主窗口 taskbar overlay 红点，tooltip 显示「今天 N 项待办」；无待办时清除。
- macOS/Linux：使用 `app.setBadgeCount` 数字角标。
- IPC 任务变更后自动刷新；启动后 1.2 秒补一次。

## 4. 验证

- `pnpm typecheck`：通过。
- `pnpm test:unit`：全量通过，新增 `test-reminder`、`test-markdown`、`test-export`、`test-search` 与 `qa-store-review` 撤销回归。
- `pnpm build`：通过。
- 10k 性能短跑：见 `.tmp/perf/results/stage3-fts.json` / `.md`。
- 未执行 Electron 真实窗口 E2E / Playwright：本会话 Chromium Mojo IPC 仍被环境拦截；拖拽/行内编辑另用临时 Vite DOM harness 验证，不等同于 Electron 实机结论。

## 5. 产物

`release/0.4.0/`：

- `LightTodo-0.4.0-x64.exe`
- `LightTodo-0.4.0-portable.zip`
- `checksums.json`

## 6. 已知限制

- Windows toast 的 AUMID/协议激活/应用未运行时的 second-instance 链路未实机验证。
- ICS 未做 RFC5545 75 字节折行、未输出 DTEND；ICS 导入未实现。
- 自有 CSV 回读仍只覆盖 TickTick/Todoist/MS To Do，不完整支持本应用导出的中文列名。
- 2 字中文搜索走 LIKE 全表扫描，10k 约 30–45ms；接近 50ms 目标。
- 拖拽仅支持同屏已挂载行，无跨屏自动滚动/触摸拖拽。
