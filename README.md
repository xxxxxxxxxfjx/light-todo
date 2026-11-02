# 轻单 LightTodo

Windows 上最快的中文待办 —— 本地优先、键盘优先、开箱即用。

## 当前进度

已完成（M1–M3 大部分）：

- Electron + React 19 + TypeScript + Vite 工程骨架
- 本地 SQLite（`node:sqlite`，免原生编译），表结构含任务/清单/文件夹/标签/设置
- 三栏主界面：侧边栏（智能视图 + 清单 + 标签）、任务列表、任务详情 / 今日概览
- 视图：收件箱、今天（逾期分组）、最近 7 天、全部、也许、已完成、按清单、按标签
- 任务 CRUD：创建、编辑、完成、删除（软删除）、子任务、标签、优先级、计划日 / 截止日
- 全局快速添加：`Ctrl+Shift+Space` 唤起（含中文自然语言解析、预览 chips）
- 中文 NLP：今天/明天/下周三/3月5日/今晚8点/每周一三五/每月5号/每月第2个周二/每3天/工作日/!高/#清单/@标签
- 搜索：`Ctrl+K`，标题 / 备注 / 标签
- 托盘常驻、全局快捷键、开机自启、Jump List、URL Scheme（脚手架已接）
- 每日备份、导入导出（待 M5）

待完成：

- 重复任务引擎（RRULE 计算下一次、按完成/按计划两种语义）
- 提醒调度（Toast、稍后提醒、休眠补偿）
- 日历视图（月/周）
- 数据导入导出、备份恢复、设置页
- 打包（NSIS 安装包 + 便携版）、性能验收

## 技术栈

- Electron 45 + electron-vite 6 + Vite 8
- React 19 + TypeScript 5.9
- SQLite：`node:sqlite`（Electron 内置 Node 24）
- 状态：Zustand
- 日期：date-fns + rrule（后者待接入）

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
pnpm dist         # 打 Windows 安装包 + 便携版
pnpm typecheck    # 类型检查
```

开发数据默认放在项目下 `.data/`，打包后放在 `%APPDATA%/轻单/`。

## 测试脚本

```bash
node --experimental-strip-types scripts/test-nlp.ts
node --experimental-strip-types scripts/test-db.ts
```

## 说明

- 本机（DSH 受限环境）启动 Electron 需要 `--no-sandbox --disable-gpu`，并且 Electron 的
  `userData` 必须放在工作区内，否则 Chromium 的命名管道会被拒绝。正常桌面环境不需要这些参数。
- 图标由 `scripts/gen-icons.mjs` 纯 Node 生成，产物在 `build/`。
