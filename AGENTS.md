# AGENTS.md — LightTodo

## 测试约定（重要）

- **UI / E2E 测试统一使用 Playwright MCP**，不再往应用里注入 JS 跑脚本。
  - Electron 真实窗口：`mcp__playwright_app__browser_*`（CDP `127.0.0.1:9222`）
  - 独立网页：`mcp__playwright__browser_*`
- 启动被测应用：`node scripts/app-cdp.mjs --fresh`；结束：`node scripts/app-cdp.mjs --kill`。
- 详细流程、工具参数（`target` 传 ref）与断言方式见 `docs/testing-playwright.md`。
- 断言 = 无障碍快照/截图 + SQLite 查询（数据目录 `.tmp/e2e/playwright/lighttodo.db`），不能只看接口状态码。
- 旧脚本 `scripts/e2e*.mjs` 保留为回归兜底，新用例优先用 Playwright MCP。
- **临时文件统一放 `.tmp/`**：`.tmp/data`（开发数据）、`.tmp/qa`（单元/QA）、`.tmp/e2e`（E2E）、`.tmp/perf`（基准）、`.tmp/shots`（截图）、`.tmp/logs`（日志）、`.tmp/cache`（缓存）、`.tmp/archive`（旧目录归档）。不要再往仓库根目录创建点开头临时目录。

## 按量测试（重要）

- 小改动（文案/样式/单组件/参数）：`pnpm typecheck` + 相关单测 + 针对性手动验证，不跑全量 E2E、不完整打包。
- 中等改动（主进程/依赖或模型替换/打包相关）：上述 + 针对性端到端验证 + `LIGHTTODO_SKIP_E2E=1 pnpm dist`（跳过全量 E2E，保留打包和成品启动门槛）。
- 大改动（数据库/跨模块/启动器/发布流程）：完整 `pnpm dist`（含 36 项 E2E）。
- 原则：测试量与影响范围匹配；小改动不必完整部署，大改动不能省门槛。

## 提交约定（重要）

- **每次调整结束都必须提交代码，不能只留在工作区。**
- 默认流程：`git add -A` → `git commit -m "<说明>"` → `git push origin main`；提交后确认 `git status -sb` 干净且 `main...origin/main` 已同步。
- 每次提交后在回复中报告 commit hash；用户明确说“先不提交/不推送”时，以用户当次指令为准。
- 打包产物在 `release/`（已被 `.gitignore` 忽略）不进入 Git，但交付时仍要报告路径、大小与 `checksums.json`。

## 构建 / 校验

```bash
pnpm typecheck   # 类型检查
pnpm build       # 构建到 out/
pnpm test:unit   # 纯逻辑回归（NLP / DB / 导入 / 重复规则）
```

## 打包约定（重要）

- **每次完成代码、界面或文档改动后都要打包，不能只交源码。**
- 打包前至少通过 `pnpm typecheck` 和 `pnpm test:unit`；涉及 UI 时再跑 `pnpm test:e2e`。
- 打包命令：`pnpm dist`，产物在 `release/<version>/`：
  - `LightTodo-<version>-x64.exe`（单文件便携版）
  - `LightTodo-<version>-portable.zip`（完整目录版）
- 每次发布递增 `package.json` 的 patch 版本，避免覆盖上一版产物。
- 交付时必须报告产物路径、文件大小和 `checksums.json`；打包失败则报告失败原因，不能静默跳过。
- `pnpm dist` 内置类型、逻辑、启动器、旧 E2E 及真实单文件/ZIP 成品启动门槛；任何门槛失败都不能交付。`checksums.json` 只在全部成功后生成，已有校验清单的版本拒绝覆盖。大改动不得跳过门槛；中等改动可按「按量测试」用 `LIGHTTODO_SKIP_E2E=1` 跳过全量 E2E，但 typecheck/unit/launcher/成品启动门槛不可跳过。
- 修改启动器必须通过 `pnpm test:launcher`（含嵌入 ZIP 首次/并发启动、解压中断和缺失运行时恢复）。不能只测试 `win-unpacked` 或开发 Electron 后宣称单文件 exe 可用。

## 环境注意

- DSH 会注入 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 前必须清空（`scripts/app-cdp.mjs` 已处理）。
- 受限环境启动需 `--no-sandbox --disable-gpu`，且 `LIGHTTODO_DATA_DIR` 必须在工作区内。
- 应用有单实例锁：跑测试前先关闭用户自己打开的实例。
