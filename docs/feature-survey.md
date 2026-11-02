# Windows Todo 应用：竞品功能调研 + 功能选型清单

> 调研日期：2026-11-02 ｜ 覆盖 19 款产品 ｜ 用途：从 0 开发 Windows 桌面 Todo 前的功能取舍
> 口径：价格与功能以调研当日官方页面为准（已标注来源）；社区抱怨类信息标 ⚠️，未逐条复核。

---

## 0. 一页结论

1. **纯"清单"已经没有机会**。任务、子任务、标签、重复、提醒、看板、日历，已是 2026 年的及格线。
2. **三座标杆各有各的瘸腿**：
   - Todoist = 捕获与生态最强，但 Windows 桌面端常年被吐槽卡顿；
   - TickTick（滴答清单）= 功能密度最高，但 Windows 端 CPU 占用/掉帧、AI 功能明确不支持 Windows；
   - Things 3 = 手感与键盘流的天花板，**根本没有 Windows 版**。
   → **"Windows 上最快、最像原生、最省电的 Todo"** 是一个真实存在的空位。
3. **AI 已从"助手"走向"Agent"**：Todoist / TickTick / Superlist / Akiflow / Sunsama / Reclaim 都出了 MCP Server 或 Agent 连接器。但大多锁在付费墙后、且云端优先。**本地优先 + 可选 AI** 是差异化点。
4. **国内用户的刚需与海外不同**：农历/调休、四象限、习惯打卡、倒数日、微信/短信/电话多通道催办、桌面壁纸级挂件。小黄条、时光序、敬业签验证了这些需求，但三家的 Windows 稳定性都不算好。
5. **推荐基线**：以「方案 B 全能工作台」为骨架（对标 TickTick 的功能面），砍掉 70% 的重功能，用「方案 A 的极简体验」交付，把「K 组 Windows 差异化」做成卖点。

---

## 1. 竞品地图

### 1.1 五种流派

| 流派 | 代表 | 核心逻辑 | 用户为什么选它 | 软肋 |
|---|---|---|---|---|
| 全能清单派 | Todoist、TickTick、MS To Do、Any.do | 任务为中心，视图+集成取胜 | 一个 app 管所有事 | 功能膨胀后变慢 |
| 设计/手感派 | Things 3、小黄条 | 交互即产品 | 用起来爽、愿意天天开 | 平台封闭/功能窄 |
| 日程/时间块派 | Motion、Akiflow、Sunsama、Reclaim | 任务必须落到日历 | 治"知道要做但排不进日程" | 贵、依赖日历、无免费 |
| 知识库派 | Notion、Obsidian Tasks、Logseq、Superlist | 任务即文档/块 | 任务与资料不分家 | 重、慢、提醒弱 |
| 系统内置派 | Apple Reminders、Google Tasks | 零成本、系统级入口 | 不装新 app | 模型极简、跨平台差 |

### 1.2 横向对比（重点 12 款）

| 产品 | 流派 | Windows | 价格（调研时点） | 杀手锏 | 硬伤 |
|---|---|---|---|---|---|
| **Todoist** | 全能清单 | ✅ 桌面端 | 免费 5 项目/3 过滤器；Pro $5/月（年付） | 最强 NLP 快速添加 + 80+ 集成 + 官方 MCP | Windows 端启动/输入卡顿 ⚠️；免费版很紧 |
| **TickTick / 滴答清单** | 全能工作台 | ✅ 桌面端 | 免费 9 清单/99 任务；Premium $49.99/年（国内 ¥139） | 任务+日历+看板+时间线+四象限+习惯+番茄，一个 app 全包 | Windows 端 CPU/掉帧 ⚠️；AI 助手不支持 Windows |
| **Things 3** | 设计流 | ❌ 仅 Apple | Mac $49.99 买断 | 手感、Type Travel、Magic Plus | 无 Windows、无协作、按平台分别收费 |
| **Microsoft To Do** | 系统内置 | ✅ 商店应用 | 全免费 | My Day + Outlook 旗标邮件转任务 | 无标签/过滤器/日历；同步与重复规则差 ⚠️ |
| **Motion** | AI 排程 | ✅ | $19–29/席/月，无免费 | 自动排期 + 长任务分块 + 持续重排 | 贵；手机端只是"伴侣"；模型强绑定"必须有截止日" |
| **Akiflow** | 日程聚合 | ✅ | $19/月（年付），无免费 | 3000+ 工具聚合收件箱 + 命令栏 + 双向同步 | 贵；项目管理弱（无看板/甘特） |
| **Sunsama** | 每日仪式 | ✅ | $17/月（年付），无免费 | 日计划/关机仪式 + 计划 vs 实际用时 | 无项目层级；手机端非独立 |
| **Notion** | 知识库 | ✅ | 免费 / Plus $10/人/月 | 数据库任意视图 + 关系/汇总 | 重、启动慢、不是专用 Todo |
| **Obsidian Tasks** | 本地文本 | ✅（插件） | 免费开源 | Markdown 即数据 + 查询引擎 | 无独立提醒；大库卡顿 ⚠️；任务只能单行 |
| **小黄条** | 桌面挂件 | ✅ 原生 | ¥88/年（7 天试用） | 壁纸级透明清单/日历/便签，多日历聚合 | 功能窄；官方承认 WIN+D 会破坏嵌入、脏数据会启动崩溃 |
| **时光序** | 大杂烩 | ✅ | 免费 + VIP（终身 ¥118–158） | 18 个生活模块 + 5 种提醒通道 | 臃肿、学习成本高 |
| **敬业签** | 提醒 | ✅ | ¥7.5/月起（30 天试用） | 短信/电话/微信/钉钉多通道持续催办 + 永久时间轴 | 界面老旧；官方文档有多起 Windows 崩溃记录 |

其余 7 款（Reclaim、Superlist、Amazing Marvin、Logseq、Apple Reminders、Google Tasks、Any.do）见附录 A。

---

## 2. 功能全景（可直接勾选）

> ★ = 我建议放进第一个可用版本（P0）；☆ = 第二批（P1）；其余为第三批或备选。

### A. 任务模型

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| A1 ★ | 任务基础字段 | 标题、备注、日期、优先级、清单归属 | 全部 |
| A2 ★ | 子任务（多层） | 任务树，至少 3 层 | Todoist、TickTick |
| A3 ☆ | 检查项 checklist | 任务内部的勾选步骤（≠子任务） | TickTick、MS To Do |
| A4 ★ | 清单/项目 | 任务的一级容器 | 全部 |
| A5 ★ | 文件夹/分组 | 清单再分组 | TickTick、MS To Do |
| A6 ☆ | 分区/标题 | 清单内的分段（Things 的 headings） | Things、Todoist |
| A7 ☆ | 标签（多标签+颜色） | 跨清单的横向维度 | Todoist、TickTick |
| A8 ★ | 优先级（4 级） | P1–P4 / 高·中·低·无 | Todoist、TickTick |
| A9 ☆ | 状态机 | 待办/进行中/等待/已完成/已取消 | Motion、Notion |
| A10 ★ | 计划日 vs 截止日 | "哪天做"与"最晚哪天交"分离 | Things、Motion、Sunsama |
| A11 ☆ | 预计时长/实际用时 | 排程与复盘的基础 | Motion、Sunsama |
| A12 ☆ | 附件 | 图片/文件，本地存 | Todoist、TickTick |
| A13 ★ | 备注（Markdown） | 富文本/代码块/链接 | Things、Obsidian |
| A14 ☆ | 任务模板 | 重复性工作流一键生成 | Todoist、TickTick |
| A15 | 任务依赖 | 前置/后置、阻塞关系 | Motion、Notion |
| A16 | 自定义字段 | 文本/数字/单选/日期 | Notion、Motion |

### B. 捕获（决定日常使用频率）

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| B1 ★ | 全局快捷键快速添加 | 任意界面唤起输入框，回车入库 | TickTick、Todoist |
| B2 ★ | 中文自然语言解析 | "明天下午3点 交周报 #工作 !高 @张三 每周一" | Todoist、TickTick |
| B3 ☆ | 悬浮输入条/迷你窗口 | 不打开主窗口即可录入 | 小黄条、TickTick |
| B4 ★ | 托盘菜单快速添加 | 右键托盘直接加 | TickTick |
| B5 ☆ | 选中文本/剪贴板转任务 | 选中即右键"加入 Todo" | Things、Superlist |
| B6 ☆ | 邮件转任务 | Outlook 旗标/转发到专属地址 | MS To Do、Todoist |
| B7 ☆ | 浏览器扩展/网页剪藏 | 标题+URL+选中文字 | Todoist、TickTick |
| B8 | 语音输入 | 说一句话生成任务 | Todoist Ramble、滴答 |
| B9 | 截图 OCR | 图片里的待办转任务 | —（少见，机会点） |

### C. 时间与重复（最容易做出差异的模块）

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| C1 ★ | 单次提醒 | 绝对时间/相对时间 | 全部 |
| C2 ★ | 稍后提醒 snooze | 5 分钟/1 小时/明天 | 全部 |
| C3 ★ | 基础重复 | 每天/每周/每月/每年/每 N 天 | 全部 |
| C4 ☆ | 高级重复 | 工作日、每月第 N 个周X、农历、调休 | TickTick、敬业签 |
| C5 ★ | 重复语义 | "按完成时间" vs "按原定时间" 两种 | Things（做得最清楚） |
| C6 ★ | 全天 vs 定时 | 全天事项不占时间轴 | 全部 |
| C7 ☆ | 提前提醒 | 提前 N 分钟/小时/天，可多档 | Todoist、TickTick |
| C8 ☆ | 错过补偿 | 关机/休眠错过的提醒，开机补推 | 敬业签、小黄条 |
| C9 ☆ | 日历视图 | 日/周/月/年/议程 | TickTick、Notion |
| C10 ☆ | 拖拽时间块 | 任务拖到日历上排期 | Motion、Akiflow、小黄条 |
| C11 | ICS 订阅/导入导出 | 与系统日历/Outlook 互通 | TickTick、小黄条 |
| C12 | 番茄钟/专注计时 | 25 分钟专注 + 统计 | TickTick、Marvin |
| C13 | 倒数日/纪念日 | 生日、还款日、考试倒计时 | 时光序、TickTick |
| C14 | 时区处理 | 跨时区提醒不跑偏 | MS To Do 的著名 bug |

### D. 视图

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| D1 ★ | 收件箱 Inbox | 未分类任务的落脚点 | 全部 |
| D2 ★ | 今天 Today | 今日聚焦（含"今晚"分区更佳） | Things、Todoist |
| D3 ★ | 最近 7 天/即将到来 | 未来一周 | Todoist、TickTick |
| D4 ★ | 全部/任意时间 | 无日期的任务池 | Things（Anytime） |
| D5 ★ | Someday/也许 | 长期想法，不污染今天 | Things |
| D6 ★ | 已完成/日志 | 完成记录与复盘 | Things（Logbook） |
| D7 ★ | 列表视图 | 分组、排序、拖拽、行内编辑 | 全部 |
| D8 ☆ | 看板 Kanban | 按状态/标签/优先级分列 | TickTick、Todoist |
| D9 ☆ | 日历视图 | 见 C9 | — |
| D10 | 时间线/甘特 | 项目排期 | TickTick、Motion |
| D11 ☆ | 四象限 | 重要/紧急矩阵 | TickTick、时光序 |
| D12 | 习惯打卡 | 每日习惯 + 连续天数 | TickTick、时光序 |
| D13 | 统计/热力图 | 完成量、专注时长、趋势 | TickTick、Todoist Karma |
| D14 ☆ | 自定义过滤器 | 查询语法/条件组合，存为智能列表 | Todoist、Obsidian Tasks |
| D15 | 多窗口/分屏 | 同时看两个清单 | Todoist、Things |
| D16 | 专注视图 | 全屏只显示当前任务 | Marvin（Spotlight） |

### E. 提醒与通知（Windows 体验的关键）

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| E1 ★ | Windows 原生 Toast | 通知中心可回看 | 全部桌面端 |
| E2 ★ | 通知操作按钮 | 通知上直接"完成/稍后" | TickTick |
| E3 ★ | 托盘常驻 + 未读角标 | 关闭窗口不退出 | TickTick、小黄条 |
| E4 ★ | 开机自启/最小化到托盘 | 常驻型工具的默认期待 | TickTick |
| E5 ☆ | 免打扰/专注模式 | 专注期间静音非关键提醒 | Sunsama |
| E6 | 多通道提醒 | 邮件/微信/短信/电话 | 敬业签、时光序（国内特色） |
| E7 ☆ | 持续提醒 | 不处理就一直催 | 敬业签、TickTick 恒定提醒 |
| E8 ☆ | 桌面置顶悬浮清单 | always-on-top 的小窗 | 小黄条、TickTick 便签 |

### F. 组织与检索

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| F1 ★ | 全局搜索 | 标题/备注/标签，即时结果 | 全部 |
| F2 ☆ | 命令面板 Ctrl+K | 键盘流的一切入口 | Things、Akiflow |
| F3 ★ | 快捷筛选 | 今天/逾期/无日期/高优/已加星 | Todoist |
| F4 ☆ | 保存的搜索 | 见 D14 | Todoist |
| F5 ★ | 收藏/置顶 | 常用清单置顶 | TickTick |
| F6 ★ | 归档/回收站 | 删除可恢复（30 天） | 全部 |

### G. 协作与同步

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| G1 ☆ | 多端同步 | 至少 Windows↔手机/Web | 全部云产品 |
| G2 | 共享清单 | 邀请他人共同编辑 | Todoist、TickTick |
| G3 | 指派任务 | 分配给成员 | Todoist、MS To Do |
| G4 | 评论/@提及 | 任务内讨论 | Todoist、TickTick |
| G5 | 权限控制 | 只读/可编辑/管理员 | Todoist Business |
| G6 | 团队空间 | 多项目/成员管理 | Todoist Business |
| G7 | 活动日志 | 谁在什么时候改了什么 | TickTick Premium |
| G8 | 离线编辑/冲突合并 | 断网可用，恢复后合并 | Todoist（有限） |

### H. 平台与集成

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| H1 ★ | 任务栏 Jump List | 右键任务栏图标直达"新建/今天" | Windows 原生应用 |
| H2 ★ | URL Scheme / 命令行 | `todo://add?text=...`，可被其他工具调用 | Things、TickTick |
| H3 ☆ | Outlook/Teams 集成 | 旗标邮件、Teams 消息转任务 | MS To Do |
| H4 ☆ | 系统日历双向同步 | Windows 日历/Google/Outlook | TickTick、小黄条 |
| H5 ☆ | 浏览器扩展 | Chrome/Edge | Todoist、TickTick |
| H6 | 公开 API/Webhook | 自动化与二次开发 | Todoist |
| H7 | MCP Server | 让 Claude/ChatGPT 读写任务 | Todoist、TickTick、Superlist |
| H8 | 移动端 | iOS/Android | 全部 |
| H9 | Markdown 文件同步 | 任务即 .md，与 Obsidian 共存 | Obsidian Tasks |
| H10 | 第三方自动化 | Zapier/Make/快捷指令 | Todoist、Akiflow |

### I. AI 能力

| 编号 | 功能 | 说明 | 谁做得好 |
|---|---|---|---|
| I1 ★ | 自然语言→结构化 | 规则解析即可，不必上大模型 | Todoist、TickTick |
| I2 ☆ | AI 拆解任务 | "准备面试" → 6 个子任务 | Todoist Task Assist |
| I3 | AI 今日排程 | 按时长/精力/截止日排今天的顺序 | Motion、Sunsama |
| I4 | AI 周报/复盘 | 本周完成了什么、卡在哪 | Sunsama Sunny |
| I5 | 语音转任务 | 一段话拆成多条任务 | TickTick AI Voice |
| I6 | 会议纪要→行动项 | 录音/转写 → 任务 | Superlist、Motion |
| I7 | 邮件→任务 | 提取行动项与日期 | Todoist Email Assist |
| I8 | 对话式管理 | Agent 直接增删改查 | Todoist MCP、Akiflow |
| I9 | 智能估时 | 根据历史估算任务时长 | Sunsama、Motion |
| I10 | 智能归类 | 自动推荐清单/标签 | Akiflow |

### J. 数据与开放

| 编号 | 功能 | 说明 | 为什么重要 |
|---|---|---|---|
| J1 ★ | 本地 SQLite、离线优先 | 断网可用，数据在自己机器上 | 隐私 + 速度 |
| J2 ★ | 自动备份/版本历史 | 每日快照，可回滚 | 防丢数据 |
| J3 ★ | 导出 JSON/MD/CSV | 数据可带走 | 建立信任 |
| J4 ☆ | 从竞品导入 | Todoist/TickTick/MS To Do/Things | 降低迁移成本 |
| J5 ☆ | 全文索引（FTS5） | 万级任务毫秒级搜索 | 体验 |
| J6 | 加密 | 清单级/数据库级 | 隐私 |
| J7 | 插件系统 | 用户自写脚本 | 生态 |
| J8 | 可选同步后端 | 自建 WebDAV/S3/官方云 | 隐私与多端 |

### K. Windows 差异化（我们的机会点）

| 编号 | 功能 | 说明 | 对标痛点 |
|---|---|---|---|
| K1 ★ | 冷启动 < 1s、常驻内存 < 150MB | 实测指标写进验收标准 | Todoist/TickTick 卡顿 ⚠️ |
| K2 ★ | Win11 原生视觉 | Mica 云母、圆角、深浅色跟随系统、高 DPI | 多数 Electron 应用"网页感" |
| K3 ☆ | 全局捕获条 | 类 PowerToys Run 的悬浮输入 | 现有产品都要先开窗 |
| K4 ☆ | 桌面悬浮清单 | 置顶/贴壁纸的迷你清单 | 小黄条验证了需求 |
| K5 ☆ | 任务栏进度/角标 | 今日完成度显示在图标上 | Windows 独有 |
| K6 ☆ | 电池友好 | 定时器对齐系统 tick，休眠不空转 | TickTick 1ms 定时器耗电 ⚠️ |
| K7 | 便携版/绿色版 | 解压即用，数据可放 U 盘 | 企业环境 |
| K8 | 本地优先 + 可选自建同步 | 默认不上云 | 隐私敏感用户 |
| K9 ★ | 键盘优先 | 全操作可纯键盘完成，快捷键可改 | Things 的核心优势 |
| K10 | 中文细节 | 农历、节气、法定调休、中文分词搜索 | 海外产品普遍缺失 |

---

## 3. 关键横评矩阵

✅ 支持 ｜ 💰 付费档才有 ｜ — 不支持

| 能力 | Todoist | TickTick | Things | MS To Do | Motion | Notion |
|---|---|---|---|---|---|---|
| 多层子任务 | ✅ | ✅ | —（仅检查项） | —（steps） | ✅ | ✅ |
| 标签 | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| 看板 | ✅ | ✅ | — | — | ✅ | ✅ |
| 日历视图 | 💰 | ✅ | 仅显示日程 | — | ✅ | ✅ |
| 时间线/甘特 | — | 💰 | — | — | ✅ | ✅ |
| 中文 NLP | ✅ | ✅ | — | — | — | — |
| 高级重复（工作日/农历） | 部分 | ✅ | 部分 | — | 部分 | 模板 |
| 习惯打卡 | — | ✅ | — | — | — | — |
| 番茄钟 | — | ✅ | — | — | — | — |
| 共享协作 | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| 公开 API | ✅ | ✅ | URL Scheme | Graph | — | ✅ |
| MCP / Agent | ✅ | ✅ | — | — | — | ✅ |
| Windows 原生客户端 | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| 完全离线可用 | 部分 | ✅ | ✅ | 部分 | — | — |
| 免费版可长期用 | 紧 | 紧 | 无 | ✅ | 无 | ✅ |

---

## 4. 用户抱怨 → 我们的设计约束

| 真实抱怨（来源） | 我们的对策 |
|---|---|
| Todoist Windows 端启动慢、输入卡顿（官方 troubleshooting 文档 + r/todoist） | 主进程不做重活；列表虚拟滚动；首屏 < 300ms；输入零延迟（本地乐观更新） |
| TickTick Windows 端请求 1ms 定时器、全天唤醒（r/ticktick，2026-05） | 统一用系统级调度（单次 setTimeout 链 + 休眠唤醒补偿），禁止忙等 |
| TickTick AI 助手"暂不支持 Windows"（官方帮助页） | AI 能力全平台一致，本地可配置 API Key |
| MS To Do 重复规则浅、跨时区提醒漂移（r/MicrosoftToDo） | 自研 RRULE 引擎 + 本地时区存 UTC + 显示层转换；单测覆盖 DST |
| Motion 单次重复任务不能改名/改标签（官方文档） | 重复实例允许"仅本次修改"与"修改所有未来"两种语义 |
| Amazing Marvin Windows 端不能最小化到托盘（官方论坛） | 托盘是最基本要求，默认关闭窗口即最小化 |
| 小黄条：脏数据导致启动崩溃、WIN+D 破坏壁纸嵌入（官方 FAQ） | 数据库迁移带事务 + 自动备份 + 崩溃自愈；壁纸嵌入用分层窗口而非 SetParent |
| 敬业签：右键删除/完成时崩溃（官方帮助文档） | 所有右键操作走命令总线，禁止在 UI 线程做 IO |
| 免费版限制过紧（Todoist 5 项目 / TickTick 9 清单） | 本地版不设项目数上限，只对云同步/AI 收费（如商业化） |
| Superlist 无 Windows 客户端、Web 版加载慢 | 桌面优先，Windows 是一等公民 |

---

## 5. 三种产品形态（选一个基线）

### 方案 A：极简高效型（对标 Things 3 + Microsoft To Do）
- **一句话**：打开就写，今天做什么一目了然。
- **功能**：A1–A10、A13；B1/B2/B4；C1–C3/C5/C6；D1–D7；E1–E4；F1/F3/F6；H1/H2；J1–J3；K1/K2/K9。
- **工作量**：约 2–3 周可到可用版本。
- **适合**：个人自用、追求速度、不想被功能淹没。

### 方案 B：全能工作台（对标 TickTick，推荐）
- **一句话**：任务、日历、看板、四象限、习惯，一个窗口全搞定，但比 TickTick 快。
- **功能**：A 全部（除 A16）；B1–B7；C1–C11；D1–D14；E1–E8；F 全部；G1；H1–H5；I1/I2；J1–J5；K1–K5/K9/K10。
- **工作量**：约 6–8 周（含打磨）。
- **适合**：想要一个能长期替代 TickTick/Todoist 的主力工具。

### 方案 C：AI 日程管家（对标 Motion/Akiflow/Sunsama）
- **一句话**：你只管加任务，AI 负责排进日历并动态重排。
- **功能**：B 全部；C1–C14；D1–D14；E1–E8；I1–I9；+ 双向日历同步（H4）、任务依赖（A15）、预计时长（A11）。
- **工作量**：约 10–14 周，且强依赖日历 API 与模型能力。
- **适合**：日程极满的知识工作者；商业化故事最好，但工程风险最高。

> 我的建议：**按 B 的功能面设计数据模型，按 A 的体验做第一个版本**，C 的 AI 排程放到 v1.5。

---

## 6. 建议的 MVP 与迭代节奏

| 阶段 | 周期 | 交付 | 验收标准 |
|---|---|---|---|
| P0 骨架 | 第 1 周 | 数据层（SQLite）、任务 CRUD、收件箱/今天/最近 7 天、快速添加（含 NLP）、托盘+全局快捷键 | 冷启动 < 1s；1000 条任务滚动 60fps |
| P1 日常可用 | 第 2 周 | 重复任务、提醒（Toast + snooze）、标签/优先级、搜索、回收站、深色模式 | 关机重开不丢提醒；重复规则单测全绿 |
| P2 差异化 | 第 3–4 周 | 日历视图、看板、四象限、桌面悬浮清单、导入/导出、自动备份 | 导入 Todoist/TickTick 1000 条无错 |
| P3 增强 | 第 5–8 周 | 习惯打卡、番茄钟、统计、AI 拆解/排程、MCP | AI 调用可关闭、可换 Key、失败可降级 |

---

## 7. 技术选型建议

当前机器：Node v22.20.0、pnpm 10.30.3、git 2.53；**没有 .NET / Rust / Python**。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Electron + React + TS** | 生态最全；托盘/全局快捷键/Toast/Jump List 都有成熟 API；Node 现成 | 包体 ~100MB、内存 ~150–250MB | ✅ 推荐 v1 |
| Tauri v2 + React | 包体 ~10MB、内存低、更"轻" | 需装 Rust + MSVC 构建工具（数 GB）；生态坑多 | 若把"轻量"当卖点再考虑 |
| WinUI 3 / WPF | 真正原生、启动最快 | 需装 .NET SDK；UI 开发效率低；难以快速迭代 | 不推荐首版 |

**推荐栈**：
- 壳：Electron + electron-vite + electron-builder（NSIS 安装包 + 便携版）
- UI：React 19 + TypeScript + Tailwind CSS v4 + Radix/shadcn（自建设计令牌，做 Win11 风格）
- 状态：Zustand + 仓储层（Repository），UI 不直接碰 SQL
- 数据：`node:sqlite`（Electron 内置，免编译）；若不可用退回 better-sqlite3
- 日期/重复：date-fns + rrule.js（自研中文 NLP 解析层，chrono-node 兜底）
- 搜索：SQLite FTS5
- 测试：Vitest（纯逻辑）+ Playwright（Electron E2E）
- 打包产物：`TodoSetup-x.y.z.exe` + `Todo-portable.zip`

---

## 8. 下一步 & 逆向计划

1. 你从第 2 节勾选功能（回编号即可，如 `A1-A10, B1/B2, C1-C3, K1/K2/K3`）。
2. 我出：PRD（页面/交互/数据模型/验收标准）→ 可点击原型 → 开发。
3. **按需逆向**（你点名才做，避免浪费时间）：
   - TickTick 桌面端（Electron）：提取 `app.asar` 的 i18n 文案与功能开关，反推完整功能清单、快捷键表、快速添加语法；
   - Todoist Windows：看它的离线队列与本地缓存结构；
   - 小黄条（WPF）：看壁纸嵌入与 WIN+D 处理方式，我们做更稳的实现；
   - 敬业签：看它的多通道提醒调度与时间轴数据结构。
   - 合规：仅分析本机安装包/公开下载包，用于学习交互与数据结构，不复制代码、不绕过授权。

---

## 附录 A：各产品详细笔记

### A1. Todoist（Doist）
- 平台：Windows/macOS/Linux/Web/iOS/Android/Watch；Windows 为桌面客户端。
- 价格：免费 5 项目、3 过滤器、1 周历史、5MB 附件；Pro $5/月（年付 $60）；Business $8/人/月。
- 核心：项目→分区→任务→子任务；列表/看板/日历；四级优先级；标签；评论；模板；80+ 集成（Gmail/Outlook/Slack/Teams）。
- 进阶：官方 MCP Server + Claude/ChatGPT 连接器；REST API + Webhook + `td` CLI；多窗口。
- AI：Task Assist（目标→行动计划/任务拆子任务）、Filter Assist（自然语言生成过滤器）、Email Assist、Ramble 语音、图片/PDF→任务。
- 短板：Windows 端性能问题有官方 troubleshooting 文档；免费档很紧；官方 Known Issues 记录过"移动含大量子任务的任务可能丢数据"。
- 来源：todoist.com/features、/pricing、/ai-tools、help/troubleshooting、techradar 评测。

### A2. Things 3（Cultured Code）
- 平台：仅 Apple（macOS/iOS/iPadOS/watchOS/visionOS）。
- 价格：Mac $49.99、iPhone $9.99、iPad $19.99，买断；无免费版（Mac 15 天试用）。
- 核心：Inbox→Areas→Projects→Headings→To-dos；Today（含 This Evening）/Upcoming/Anytime/Someday/Logbook；开始日与截止日分离；重复任务（固定/完成后）；标签；Markdown 备注；模板。
- 进阶：Magic Plus 拖拽插入、Type Travel 键盘跳转、Quick Entry with Autofill、项目进度饼图、Shortcuts/URL Scheme。
- AI：仅依赖 Apple Siri AI（英文优先，能力有限）。
- 短板：无 Windows/Android/Web；无协作；按平台分别收费。
- 来源：culturedcode.com/things/features、/pricing、support 文章。

### A3. TickTick / 滴答清单（Appest）
- 平台：Windows/macOS/Linux/Web/iOS/Android；Windows 为一等公民桌面端。
- 价格：免费 9 清单/99 任务/2 提醒/5 习惯；Premium $49.99/年（国内 ¥139/年）。
- 核心：清单+文件夹、子任务+检查项、Markdown 备注、优先级、标签、2/5 条提醒、列表/看板/日历/时间线/四象限、习惯、番茄钟、倒数日、统计、共享清单。
- 进阶：自定义看板分组、日历多年视图/ICS/双向 Google·Outlook 同步、桌面便签、全局快捷键、CLI、MCP。
- AI：AI Assistant（对话式建任务/排计划，**官方注明暂不支持 Windows**）、AI Voice Add、录音转写总结。
- 短板：Windows 端卡顿/CPU 占用 ⚠️；免费档紧；AI 平台缺失。
- 来源：ticktick.com/features、/upgrade、help.ticktick.com、r/ticktick。

### A4. Microsoft To Do
- 平台：Windows（Store）/iOS/Android/Web。
- 价格：完全免费，无内购。
- 核心：列表+列表组、steps 子任务、备注、25MB 附件、到期日/提醒、重复、My Day、Suggestions、重要/已计划视图、共享清单+指派、Outlook 旗标邮件。
- 进阶：My Day 每日重置仪式、Outlook/Exchange 双向同步、Planner/Teams 任务聚合。
- AI：无。
- 短板：无标签/过滤器/日历/看板；重复规则浅；同步与登录问题多 ⚠️；维护停滞。
- 来源：microsoft.com/microsoft-365/microsoft-to-do-list-app、apps.microsoft.com、r/MicrosoftToDo。

### A5. Motion（usemotion.com）
- 平台：Web + Windows/macOS 桌面 + iOS/Android（手机为伴侣）。
- 价格：无免费；Pro AI $19/月（年付）/$29（月付）；Business AI $29/$49；AI 按 credits 计费。
- 核心：项目/阶段/依赖/子任务、时长+截止、分块任务（min chunk）、列表/看板/甘特/日历/议程、自动排期、双向日历、多入口捕获。
- AI：AI 排程引擎、AI Chat、AI Notetaker、AI Docs、AI Workflows、AI 项目计划。
- 短板：贵且 AI 计量；手机端弱；重复任务实例不能改名；模型强依赖"有截止日+时长"。
- 来源：usemotion.com/pricing、/help。

### A6. Akiflow
- 平台：macOS/Windows/Web/iOS/Android + Apple Watch。
- 价格：无免费；Pro $19/月（年付）/$34（月付）；AI 会议助手 +$19/月。
- 核心：任务+子任务、计划时间/时长/重复/优先级/状态/截止、项目+文件夹+标签、日历与列表并列拖拽排期、双向 Google/Outlook 日历、统一收件箱聚合大量工具、命令栏 NLP、日计划/关机仪式。
- 进阶：与外部任务工具双向同步（完成/改期写回）、任务锁定到指定日历、Rituals、Apple Watch。
- AI：Aki 助手（Beta）、AI Workflows（Beta）、AI 会议助手、自动归类、MCP。
- 短板：贵；无看板/甘特；日历同步边界 bug 多；AI 多为 Beta。
- 来源：akiflow.com/pricing、/features。

### A7. Sunsama
- 平台：Web/macOS/Windows/Linux/iOS/Android（手机为伴侣）。
- 价格：无免费；$17/月（年付）/$22（月付）；14 天试用。
- 核心：每日计划（拉取各工具任务→估时→排序）、时间块拖到 Google/Outlook/Apple 日历、计划 vs 实际、重复任务、频道/上下文、Backlog、看板/日历/周目标、每日计划/周计划/周复盘/关机仪式、双向日历、大量任务源集成。
- 进阶：rollover 计数与归档、Weekly Objectives、团队频道、MCP、SOC2/SSO。
- AI：Sunny（全权限 AI：增删改任务、起停计时、重排一天、总结完成情况）、AI 估时。
- 短板：贵且明确不做免费；无项目层级；手机端非独立。
- 来源：sunsama.com/pricing、help.sunsama.com。

### A8. Reclaim.ai（Dropbox）
- 平台：仅 Web + Google Calendar 插件；无原生桌面/手机 app。
- 价格：Lite 免费（5 agents/1 日历/1 周范围）；Starter $10/席/月；Business $15；Enterprise $22。
- 核心：任务（开始/截止/时长/优先级/备注）、自动把专注时间/习惯/缓冲块排进日历、Focus Time/Habit/Buffer/Smart Meetings agents、任务同步（Asana/Jira/Linear/ClickUp/Todoist/Google Tasks）、Planner、时间追踪、周报。
- 进阶：Defend Meeting Overload、Preview Mode（改动先预览）、AI Memories、团队 OOO、MCP。
- AI：Reclaim Chat、各类 agents、AI 任务建议、AI 会议议程。
- 短板：不是任务管理器（无项目/子任务）；2.0 改了核心模型；无原生客户端。
- 来源：reclaim.ai/pricing、help.reclaim.ai。

### A9. Notion（任务数据库）
- 平台：Windows/macOS/iOS/Android/Web。
- 价格：免费（单人无限块；多人免费版 1000 块上限）/Plus $10/人/月/Business $20。
- 核心：任务=页面；项目数据库+relation/rollup；子项+依赖；自定义属性（状态/日期/人员/公式/汇总/按钮）；表格/看板/时间线/日历/列表/画廊/图表视图；视图级过滤排序分组；日期提醒；模板重复；评论协作；数据库自动化。
- AI：Notion Agent、Custom Agents、AI Meeting Notes、Enterprise Search、数据库 AI 生成。
- 短板：重、慢；不是专用 Todo；提醒能力弱；免费多人空间受限。
- 来源：notion.com/pricing、help。

### A10. Obsidian Tasks
- 平台：Obsidian 全平台（Win/mac/Linux/移动）。
- 价格：插件免费开源；Obsidian 个人免费，Sync $4/月起。
- 核心：Markdown checkbox 任务、due/scheduled/start/created/done/cancelled 多日期、重复、优先级、自定义状态、全库 ```tasks``` 查询块、创建/编辑弹窗、分组排序。
- 进阶：布尔/正则/JS 表达式、全局查询+文件默认+块级三层组合、看板视图、反链回源、Tasks API。
- 短板：任务只能单行；Canvas 内任务读不到；提醒要另装插件；大库卡顿 ⚠️。
- 来源：publish.obsidian.md/tasks、GitHub issues。

### A11. Logseq
- 平台：Win/mac/Linux/Android/iOS/Web。
- 价格：个人免费开源；Sync Beta。
- 核心：大纲块、TODO/DOING/DONE、优先级、SCHEDULED/DEADLINE、三种重复语义（.+ / ++ / +）、任务计时、简单查询+Datalog 高级查询、日记页捕获、模板、插件。
- 短板：Windows 大库启动慢/卡死 ⚠️；学习曲线陡；同步 Beta。
- 来源：logseq.com、docs、discuss.logseq.com。

### A12. Superlist
- 平台：macOS/Web/iOS/Android（**无 Windows 客户端**）。
- 价格：免费；Basic $5/人/月；Super $21/人/月（年付）。
- 核心：清单+子清单、任务里混排笔记/图片/附件、子任务、指派/共享、截止/优先级/标签/重复、会议笔记转行动项、语音建任务。
- 进阶：官方 MCP、Agent 工作流（从聊天/PRD 生成任务、每日简报、自动分诊）、任务即文档。
- 短板：无 Windows 客户端；Web 慢；同步 bug；AI 档涨价引不满。
- 来源：superlist.com/pricing、/mcp、r/superlist。

### A13. Amazing Marvin
- 平台：Web/Win/mac/Linux/iOS/Android。
- 价格：$8/月（年付）/$12（月付）；14 天试用，无免费。
- 核心：任务/项目/习惯/目标、列表/看板/日历、日计划容量、重复、估时+计时、番茄钟、自定义分区/分组/排序、100+ 可选功能、300+ 设置、从竞品导入。
- 进阶：Accountability Pledge（押钱）、Procrastination Wizard、Task Jar、Spotlight、游戏化奖励。
- 短板：Windows 端不能最小化到托盘（官方确认）；UI 复杂。
- 来源：amazingmarvin.com、help、r/amazingmarvin。

### A14. Apple Reminders
- 平台：iPhone/iPad/Mac/iCloud.com（无 Windows 原生）。
- 价格：免费。
- 核心：清单/标签/智能列表、子任务、日期+地点提醒、备注/URL/优先级/附件、共享清单+指派、模板、杂货清单自动分类、Siri。
- 进阶：地理围栏、紧急提醒（静音也响）、Siri/小组件/控制中心/Action Button 深度集成。
- 短板：Windows 只能用功能残缺的网页版；无过滤器/开始日期/批量编辑。
- 来源：support.apple.com。

### A15. Google Tasks
- 平台：Web/Gmail/Calendar/Chat/Drive 侧栏、Android/iOS（无 Windows 原生）。
- 价格：免费。
- 核心：任务+备注、子任务、多列表、到期日/时间、重复、通知、星标、Gmail 建任务、日历时间块。
- 进阶：Workspace 内任务指派与共享、日历容量（10 万任务）。
- 短板：模型极薄；无 Windows 客户端；消费级共享弱。
- 来源：support.google.com/tasks。

### A16. Any.do
- 平台：Windows/macOS/Web/扩展/iOS/Android/Watch。
- 价格：免费；Premium $4.99/月（年付）；Family $8.33；Teams $4.99/人。
- 核心：任务/清单/子任务/备注、一次性提醒（重复需付费）、日历+My Day、颜色标签（付费）、地点提醒（付费）、共享清单/家庭空间、团队看板。
- 进阶：WhatsApp 建任务/提醒、团队自动化、杂货清单。
- AI：ChatGPT 集成、官方 MCP。
- 短板：重复/标签/地点提醒都在付费墙；列表管理笨拙；无 Outlook 日历。
- 来源：any.do/pricing、support.any.do。

### A17. 时光序
- 平台：Windows/macOS/iOS/Android/Web。
- 价格：免费 + VIP（终身 ¥118–158，月付 ¥15–22）。
- 核心：待办+日程、四象限、清单、日/周/月日历、倒数日、习惯打卡、目标、日记、18 个生活模块（番茄钟/记账/经期/喝水/课程表/阅读/睡眠/饮食/还款/排班）、语音+NLP 快速添加、5 种提醒通道（应用/系统/微信/电话/短信）、云同步、桌面小组件。
- AI：小序助手（深度思考/联网）、AI 语音转写纠错。
- 短板：模块太多、学习成本高；界面细节粗糙；Windows 稳定性证据不足。
- 来源：shiguangxu.com、App Store CN。

### A18. 小黄条
- 平台：Windows/iOS/Android/HarmonyOS。
- 价格：¥30/季、¥88/年、¥188/3 年、¥288/5 年；7 天试用。
- 核心：多个透明桌面待办板（标签/过滤/拖拽/置顶/提醒/倒数/归档）、便签板、日历（月/周/日/议程/节假日/天气/拖拽排期）、第三方日历聚合（企微/钉钉/飞书/QQ邮箱/Exchange/CalDAV/微软）、重复任务（含农历）、多端同步、自动备份、Excel 导出、可调尺寸贴壁纸的小组件、隐私模式（热键隐藏/贴边隐藏）。
- 短板：官方承认脏数据会导致启动崩溃（需删 Documents\YYNote）、WIN+D 会暂时破坏嵌入、依赖 WebView2。
- 来源：yynote.cn、官方常见问题、Microsoft Store。

### A19. 敬业签
- 平台：Windows/macOS/Web/iOS/iPadOS/Android/HarmonyOS + 微信/QQ 小程序。
- 价格：30 天试用，VIP ¥7.5/月起；短信/语音按条计费。
- 核心：云笔记（文字/图片/视频/音频/文档，单文件 1GB）、待办清单+提醒、多端实时同步、分类+分类加密、日历（月/周/日/农历/甘特式月视图）、永久操作时间轴（可筛选/打印/导出）、公历农历重复、AI 时间识别、6 种提醒通道、快捷工具（记账/计算器/翻译/快捷方式/桌面停靠）。
- 进阶：持续提醒直到处理、跨设备提醒一致、分类锁、永久时间轴。
- 短板：界面老旧；官方文档记录多起 Windows 崩溃/启动失败/依赖 .NET 4.6.1。
- 来源：jingyeqian.com、官方帮助。

---

## 附录 B：勾选清单（直接复制回复）

```
A 任务模型：A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16
B 捕获：    B1 B2 B3 B4 B5 B6 B7 B8 B9
C 时间：    C1 C2 C3 C4 C5 C6 C7 C8 C9 C10 C11 C12 C13 C14
D 视图：    D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15 D16
E 提醒：    E1 E2 E3 E4 E5 E6 E7 E8
F 检索：    F1 F2 F3 F4 F5 F6
G 协作：    G1 G2 G3 G4 G5 G6 G7 G8
H 集成：    H1 H2 H3 H4 H5 H6 H7 H8 H9 H10
I AI：      I1 I2 I3 I4 I5 I6 I7 I8 I9 I10
J 数据：    J1 J2 J3 J4 J5 J6 J7 J8
K Windows： K1 K2 K3 K4 K5 K6 K7 K8 K9 K10
```

回复示例：
> 基线 B。要 A1-A14、B1-B7、C1-C11、D1-D14、E1-E8、F 全部、H1/H2/H4、I1/I2、J1-J5、K1/K2/K3/K4/K9。另外加：任务支持"番茄钟自动开始"、清单可分享给家人。
