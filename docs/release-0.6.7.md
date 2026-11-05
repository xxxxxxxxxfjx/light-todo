# 0.6.7 快速添加模板

日期：2026-11-05

参考调研文档里 Todoist / TickTick 的「任务模板」：把重复性工作流从每次重新输入，变成快速添加里的一键入口。

## 实现

- 快速添加面板新增「模板」行：保存常用输入文本，点击即回填；
- 支持 `下午3点 交周报 #工作 @汇报 !高` 这类完整 NLP 语法，应用模板后仍走同一条解析链路；
- 同名模板覆盖，最多 20 个，可单个删除；
- 「存模板」在输入非空时可用，保存在本地 SQLite settings（`quick_add_templates`），不联网；
- 模板名称取首行前 20 个字符，超长自动省略。

## 回归

- `scripts/test-templates.ts`：解析非法数据、同名覆盖、20 个上限、删除、名称截断；
- `scripts/e2e.mjs` 新增 `quick-add-template`：保存模板 → 清空输入 → 点模板回填 → SQLite settings 断言；
- `pnpm typecheck` / `pnpm test:unit` / `pnpm build`：通过；`pnpm test:e2e` 34/34 通过。

## 产物

- `pnpm dist:mac` → `release/mac-0.6.7/LightTodo-0.6.7-arm64.zip`；
- Windows `pnpm dist` 仍需要在 Windows 环境执行。

## 下一轮候选

- 模板管理页（重命名/排序/从任务保存）；
- 任务岛提醒态；
- 热力图点击跳转日历日期。
