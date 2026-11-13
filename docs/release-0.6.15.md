# 0.6.15 — 截图识别、周报与托盘修复

## 1. 周复盘里的周报

- 周复盘顶部新增「本周周报」，按最近 7 天完成时间汇总。
- 格式：`2026/11/06 - 2026/11/12：` + 编号列表，可一键复制。
- 日报 / 周报统一排序：**短的标题在前**；相似标题（如「写周报」「写完周报」）自动挨在一起。
- 排序是纯本地 bigram 相似度，不联网、不依赖分词库。

## 2. 全局快捷键统一设置

设置新增独立「快捷键」页，三组都可录制修改、恢复默认：

| 功能 | 默认 |
|---|---|
| 全局快速添加 | `Ctrl + Alt + Space` |
| 剪贴板捕获 | `Ctrl + Alt + C` |
| 截图识别 | `Ctrl + Alt + Shift + O` |

- 点击按键后直接按组合键；被系统/微信/其他程序占用会提示，并恢复上一个可用值。
- 旧的 `Ctrl+Shift+Space` 在本机可能被输入法占用，因此改为 `Ctrl+Alt+Space`。
- 托盘「新建任务」不再显示固定快捷键文案，避免自定义后文案过期。

## 3. 添加任务的按钮位置

- 快速添加底栏改为左右两组：左侧是 Enter / Ctrl+Enter / 存模板，右侧是语法提示 + 「添加」按钮。
- 「添加」固定在右下角，不再被长语法提示挤到换行或左侧。

## 4. 旧版本数据自动恢复

升级后如果当前数据目录为空，启动时会自动查找（安装版和便携版都会）：

- `%APPDATA%/LightTodo/lighttodo.db`、`%APPDATA%/lighttodo/...`
- 便携版 exe 同级的 `LightTodoData/lighttodo.db`
- `%LOCALAPPDATA%/LightTodo`、`%LOCALAPPDATA%/Programs/LightTodo`
- 新旧版本目录的兄弟文件夹（如 `release/0.6.15` 找 `release/0.6.14/LightTodoData`）
- `%APPDATA%` 下其他一级目录里的 `lighttodo.db`
- `Downloads`、`Desktop`、`Documents`、`OneDrive/Desktop`、`OneDrive/Documents` 下的 `LightTodoData/lighttodo.db`

如果旧数据在移动硬盘、U 盘或其他自定义目录，用「设置 → 数据与备份 → 选择旧 lighttodo.db」手动选择。

找到最新、可读、且有任务的旧库后，自动复制到当前数据目录，并在界面提示「已从旧数据目录恢复 N 条任务」。

设置 → 数据与备份 → 「选择旧 lighttodo.db」可以手动恢复：先自动备份当前库，再替换并重启，失败会回滚。

## 5. OCR 方法说明

截图识别现在优先使用 **PaddleOCR PP-OCRv6 Tiny（本地 ONNX 运行时，模型约 6.3 MB）**，不联网、不需要 Python：

1. `desktopCapturer` 截取光标所在显示器，按截图像素与实际显示区域的比例裁剪（修复多屏/DPI 下裁剪偏移）；
2. 全屏透明窗口拖拽框选；
3. `nativeImage.crop` 裁剪；
4. 图片交给 `@arcships/light-ocr-tiny`（PP-OCRv6 Tiny）识别，中文效果明显好于系统 OCR；
5. 如果本地运行时加载失败，自动回退到 Windows 自带 `Windows.Media.Ocr`（PowerShell + stdin，不落盘）；
6. OCR 文本做归一化（全角冒号、数字间空格、`·` 误识别、常见错字）；
7. `parseCaptureText` 拆成标题 / 计划日 / 时间 / 估时，完整原文放备注。

Tiny 模型约 6.3 MB，但运行时（ONNX/OpenCV 原生库）约 60 MB，所以安装包会比上版大一些；换来的是中文和小组件截图的识别准确率提升。没有 GPU 也能跑。

## 6. 托盘与任务栏图标

- 窗口显式设置 `icon.ico`，打包后的任务栏按钮使用轻单蓝色勾选图标，不再是默认白纸图标。
- 托盘改用专用的 `tray.png`（32×32 源图，缩放到 20px），不再拿 256px 应用图标硬缩。
- Windows 11 新托盘图标默认收进任务栏的 `^` 溢出区；首次启动会弹一次气泡提示「轻单还在运行」。
- 如果托盘图标仍看不到，点任务栏右下角的 `^`，把轻单拖到常驻区域即可。

## 验证

- `pnpm typecheck`、`pnpm test:unit`、`pnpm test:e2e` 全部通过。
- 新增 `scripts/test-report.ts`：长度优先 + 相似度聚类。
- 旧数据迁移用真实数据库副本验证：`migrated: true`，任务数一致。
- `pnpm dist` 单文件 exe / ZIP 启动门槛通过。
