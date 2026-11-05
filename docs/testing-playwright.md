# Playwright 测试指南

本仓库的 UI/E2E 测试统一走 **Playwright MCP**（取代脚本内注入 JS 的旧方式）。

## 已安装的两套实例

| MCP 实例 | 工具前缀 | 用途 |
|---|---|---|
| `playwright`（插件 `dsh-playwright`） | `mcp__playwright__browser_*` | 启动独立 Chrome，测网页/外部链接 |
| `playwright_app`（profile 用户层补丁） | `mcp__playwright_app__browser_*` | 通过 CDP `127.0.0.1:9222` 接管真实 LightTodo 窗口 |

插件来源：`github:akash-digitavision/dsh-playwright` → 内部就是 `npx -y @playwright/mcp@latest`。
Electron 实例配置在 `~/.dsh/profiles/web/cordis.patch.yml`，同源同上，只是多了 `--cdp-endpoint http://127.0.0.1:9222`。

> 新增/修改 MCP 配置后需要重启 DeepSeek Harness（或在会话里重新加载插件），工具才会注册成 `mcp__playwright__*` / `mcp__playwright_app__*`。

## 测 Electron 应用（本仓库主用法）

```bash
# 1. 先关掉用户自己打开的 LightTodo（应用有单实例锁）
node scripts/app-cdp.mjs --kill

# 2. 启动带调试端口的应用（数据落在 .e2e-playwright/，--fresh 先清空）
node scripts/app-cdp.mjs --fresh
#   → 打印 pid / CDP 地址 / 窗口标题 / 数据目录
```

3. 用 `mcp__playwright_app__browser_snapshot` 读无障碍树，拿到 `[ref=eN]`，再 `browser_click` / `browser_type`。
4. `browser_take_screenshot` 存图（输出目录 `.shots/playwright/`）。
5. 收尾：`node scripts/app-cdp.mjs --kill`。

### 常用动作对照

| 目的 | 工具 | 参数要点 |
|---|---|---|
| 看页面结构 | `browser_snapshot` | 返回 YAML 无障碍树，元素带 `[ref=eN]` |
| 点击 | `browser_click` | `{ element: "新建任务", target: "e18" }` |
| 输入 | `browser_type` | `{ element: "任务标题", target: "e12", text: "…" }` |
| 批量填表 | `browser_fill_form` | `fields: [{ target, name, type, value }]` |
| 页面内取数 | `browser_evaluate` | 传 function 字符串 |
| 截图 | `browser_take_screenshot` | `{ filename: "xxx.png" }` 或指定 `target` |
| 等待 | `browser_wait_for` | 文本出现/消失或固定毫秒 |

注意：当前 Playwright MCP 版本的 `browser_click`/`browser_type` 用 **`target`** 传 ref（不是 `ref`），只传 `ref` 会报 `Invalid input: expected string, received undefined → at target`。

## 断言

- **UI 断言**：以 `browser_snapshot` 文本 / 截图为证据（不要只看 HTTP 状态码）。
- **数据断言**：直接读 SQLite（数据目录即 `.e2e-playwright/`）：

```js
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('.e2e-playwright/lighttodo.db')
const rows = db.prepare('SELECT title FROM tasks').all()
```

## 与旧脚本的关系

`scripts/e2e.mjs`、`e2e-flows.mjs`、`e2e-stress.mjs` 仍可运行（`pnpm test:e2e` 等），作为回归兜底。
**新增用例优先用 Playwright MCP 写**；旧脚本在等价覆盖完成后逐步下线。

## 常见问题

- **应用启动后立刻退出**：DSH 注入了 `ELECTRON_RUN_AS_NODE=1`，必须在子进程环境里删掉；`scripts/app-cdp.mjs` 已处理。
- **启动即退出（无日志）**：已有 LightTodo 实例占用单实例锁，先 `--kill` 或手动关闭。
- **`browser_snapshot` 报 `connect ECONNREFUSED 127.0.0.1:9222`**：应用没起来或端口不是 9222，重新执行 `node scripts/app-cdp.mjs`。
- **首次调用慢**：`npx` 首次下载 `@playwright/mcp` 约 30–60s，之后走缓存约 1s。
- **受限环境**：启动参数需 `--no-sandbox --disable-gpu`，userData 必须在工作区内（脚本已内置）。
