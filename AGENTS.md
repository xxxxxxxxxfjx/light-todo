# AGENTS.md — LightTodo

## 测试约定（重要）

- **UI / E2E 测试统一使用 Playwright MCP**，不再往应用里注入 JS 跑脚本。
  - Electron 真实窗口：`mcp__playwright_app__browser_*`（CDP `127.0.0.1:9222`）
  - 独立网页：`mcp__playwright__browser_*`
- 启动被测应用：`node scripts/app-cdp.mjs --fresh`；结束：`node scripts/app-cdp.mjs --kill`。
- 详细流程、工具参数（`target` 传 ref）与断言方式见 `docs/testing-playwright.md`。
- 断言 = 无障碍快照/截图 + SQLite 查询（数据目录 `.e2e-playwright/lighttodo.db`），不能只看接口状态码。
- 旧脚本 `scripts/e2e*.mjs` 保留为回归兜底，新用例优先用 Playwright MCP。

## 构建 / 校验

```bash
pnpm typecheck   # 类型检查
pnpm build       # 构建到 out/
pnpm test:unit   # 纯逻辑回归（NLP / DB / 导入 / 重复规则）
```

## 环境注意

- DSH 会注入 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 前必须清空（`scripts/app-cdp.mjs` 已处理）。
- 受限环境启动需 `--no-sandbox --disable-gpu`，且 `LIGHTTODO_DATA_DIR` 必须在工作区内。
- 应用有单实例锁：跑测试前先关闭用户自己打开的实例。
