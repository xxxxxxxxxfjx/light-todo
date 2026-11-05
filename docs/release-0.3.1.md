# 0.3.1 · 临时目录整理

日期：2026-11-05

本版本不改变应用功能，只整理仓库临时文件与开发数据路径。

## 1. 根目录规则

仓库根目录现在只保留两个点开头目录：

- `.git/`：版本库
- `.tmp/`：全部临时、测试、缓存、截图与归档

不再在根目录创建 `.qa-*`、`.e2e-*`、`.perf-*`、`.electron-*`、`.data`、`.shots`、`.pkg*`、`.zip-*` 等临时目录。

## 2. `.tmp` 结构

| 目录 | 内容 |
| --- | --- |
| `.tmp/data` | 开发模式运行数据（原 `.data`） |
| `.tmp/qa` | 单元/QA 回归临时数据库（原 `.qa-*`） |
| `.tmp/e2e` | Electron E2E、CDP、虚拟滚动验收数据（原 `.e2e-*`） |
| `.tmp/perf` | 性能基准数据与报告（原 `.perf-bench` / `.perf-results`） |
| `.tmp/shots` | 截图（原 `.shots`） |
| `.tmp/logs` | 历史点开头日志 |
| `.tmp/cache` | npm/pnpm 缓存 |
| `.tmp/electron` | Electron 测试缓存/userdata |
| `.tmp/archive` | 旧的一次性测试/打包数据归档 |
| `.tmp/scratch` | 临时脚本草稿 |

`.tmp/` 已在 `.gitignore` 中忽略，不进入版本库。

## 3. 脚本路径同步

以下入口已改为 `.tmp/...`，测试后不会再把根目录弄乱：

- `scripts/app-cdp.mjs` → `.tmp/e2e/playwright`
- `scripts/e2e*.mjs` → `.tmp/e2e/...`
- `scripts/test-*.ts` / `scripts/test-*.mjs` / `scripts/test-*.cjs` → `.tmp/qa/...`
- `scripts/seed-bench-10k.ts` / `scripts/bench-perf.ts` → `.tmp/perf/bench`、`.tmp/perf/results`
- `scripts/qa-store-review.mjs` / `scripts/qa-review.ts` → `.tmp/qa/review`
- `src/main/index.ts` 开发数据目录 → `.tmp/data`

`AGENTS.md`、`README.md`、`docs/testing-playwright.md`、`docs/perf-baseline.md` 已同步更新。

## 4. 验证

- `pnpm typecheck`：通过
- `pnpm test:unit`：全部通过；运行后根目录仍只有 `.git` 与 `.tmp`
- 性能基准短冒烟（50 条，`--skip-app`）：通过，输出写入 `.tmp/perf/results`
- `pnpm build` / `pnpm dist`：见交付产物

## 5. 产物

`release/0.3.1/`：

- `LightTodo-0.3.1-x64.exe`
- `LightTodo-0.3.1-portable.zip`
- `checksums.json`

## 6. 清理建议

`.tmp/qa` 与 `.tmp/archive` 保留了历史测试数据（约数 GB）。确认不再需要后可直接删除：

```powershell
Remove-Item -Recurse -Force .tmp\qa, .tmp\archive
```

`.tmp/data` 是开发数据，删除前请先确认没有需要保留的任务。
