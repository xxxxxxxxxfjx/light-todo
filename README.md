# 轻单 LightTodo

Windows 上最快的中文待办 —— 本地优先、键盘优先、开箱即用。

## 当前进度

已完成（v1 可用版）：

- Electron + React 19 + TypeScript + Vite 工程骨架
- 本地 SQLite（`node:sqlite`，免原生编译），表结构含任务/清单/文件夹/标签/设置
- 三栏主界面：侧边栏（智能视图 + 清单 + 标签）、任务列表、任务详情 / 今日概览
- 视图：收件箱、今天（逾期分组）、最近 7 天、日历、全部、也许、已完成、按清单、按标签
- 任务 CRUD：创建、编辑、完成、删除（软删除）、子任务、标签、优先级、计划日 / 截止日
- 全局快速添加：`Ctrl+Shift+Space` 唤起（含中文自然语言解析、预览 chips）
- 中文 NLP：今天/明天/下周三/3月5日/今晚8点/每周一三五/每月5号/每月第2个周二/每3天/工作日/!高/#清单/@标签
- 搜索：`Ctrl+K`，标题 / 备注 / 标签
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
pnpm dist         # 打便携版 exe（release/LightTodo-0.1.0-x64.exe）
pnpm dist:zip     # 打 win-unpacked，再自行压缩为 zip
pnpm dist:setup   # 打 NSIS 安装包（在部分受限/无桌面会话环境会失败，正常机器可用）
pnpm typecheck    # 类型检查
```

当前产物（已验证可运行）：`release/win-unpacked/LightTodo.exe` 与
`release/LightTodo-0.1.0-portable.zip`（解压后运行 `LightTodo.exe`）。

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
