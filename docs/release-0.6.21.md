# 0.6.21 — OCR 换成 OnnxOCR（PP-OCRv5 mobile）

## 0. 本次重点：OCR 模型替换

截图识别的主引擎从 PaddleOCR PP-OCRv6 Small 换成 [OnnxOCR](https://gitee.com/jingsongliujing/OnnxOCR) 的 **PP-OCRv5 mobile** 模型（OnnxOCR 就是 PaddleOCR 的 ONNX 工程，仓库 `onnxocr/models/ppocrv5` 下默认就是这两支模型）。

| 项目 | 0.6.20（PP-OCRv6 Small） | 0.6.21（OnnxOCR PP-OCRv5 mobile） |
|---|---|---|
| 检测模型 | 9.9 MB | 4.8 MB（`4d97c44a…`） |
| 识别模型 | 21.2 MB | 16.6 MB（`5825fc7e…`） |
| 词表 | 18709 + 空格 | 18383 + 空格（`ppocrv5_dict.txt`） |
| 运行时 | `@arcships/light-ocr` + 模型 npm 包 | `@arcships/light-ocr-runtime` + 自备模型包 |
| 模型来源 | npm 包内置 | 随包 `resources/ocr-model` |

模型文件与 OnnxOCR 仓库里的 LFS 对象逐字节一致（SHA-256 相同），没有做任何再训练或量化。

## 1. 为什么能直接换

`@arcships/light-ocr-runtime` 本身是「无模型」运行时，`createEngine({ bundlePath })` 接受任意符合 bundle 契约的目录。我们把 OnnxOCR 的 `det.onnx` / `rec.onnx` / `ppocrv5_dict.txt` 组织成同样的目录结构：

```text
build/ocr-model/
├── manifest.json          # bundle 清单（文件大小 + SHA-256）
├── normalized-config.json # 预处理 / DB 后处理 / CTC 解码参数
├── SHA256SUMS             # 逐文件校验（含 manifest.json）
├── det/inference.onnx     # PP-OCRv5 mobile det
├── det/inference.yml
├── rec/inference.onnx     # PP-OCRv5 mobile rec
├── rec/inference.yml
├── rec/dictionary.json    # 18383 字 + 追加一个 ASCII 空格
└── LICENSES/              # Apache-2.0 + 模型说明
```

打包时 `build/ocr-model` 作为 `extraResources` 复制到 `resources/ocr-model`；开发态从 `build/ocr-model` 读取。native 侧仍然是同一套 ONNX Runtime + OpenCV（DB 后处理、透视裁剪、CTC 解码都在原生层），所以识别流程、坐标、置信度接口都没变。

> bundle 的 `family` / `model id` 仍写 PP-OCRv6 small tier，这是 light-ocr 核心的校验白名单要求；实际权重是 PP-OCRv5，已在 `LICENSES/MODEL-NOTICE.md` 里写明。

## 2. 实测对比

同一台机器、同一批截图、CPU 推理，预热后取两次平均：

| 样例 | PP-OCRv6 Small | OnnxOCR v5 mobile |
|---|---|---|
| 三行中文任务（900×260） | 495 ms | 587 ms |
| 小截图（420×120） | 136 ms | 167 ms |
| 深色主题（900×260） | 483 ms | 593 ms |
| 小字卡片（640×180，14px） | 365 ms | 551 ms |
| 低分辨率灰字（300×96，11px） | 148 ms | 207 ms |
| 整窗截图（93 行） | 4.3 s | 6.0 s |

文本质量：

- 干净的中文任务文本两者都能全对；v5 的输出更「紧凑」，`90分钟`、`10:00-11:30` 不再被插入空格，`parseCaptureText` 的时间 / 估时解析更稳。
- 极小号 UI 图标字（`<`、`√`、`过滤器`）v5 略弱于 v6 Small，这是 v5 mobile 模型的已知短板；截图任务卡的主要场景（一行行任务文字）不受影响。
- OnnxOCR 仓库还提供 PP-OCRv5 **server** 模型（det 88MB + rec 84MB）：小字更准，但单张 3 行图要 2.5s、整窗要 16s，交互场景不划算，没有采用。

## 3. 识别流程（未变）

1. `desktopCapturer` 截取光标所在显示器，按截图像素比例裁剪；
2. 全屏透明窗口框选，`nativeImage.crop` 裁剪；
3. 第 1 层：OnnxOCR 模型直接识别原图；
4. 第 2 层：小图放大到长边 960 后重试；
5. 第 3 层：Windows 自带 `Windows.Media.Ocr` 兜底（PowerShell + stdin，不落盘）；
6. `normalizeCaptureText` 归一化（全角冒号、数字间空格、`·` 误识别、常见错字）；
7. `parseCaptureText` 拆成标题 / 计划日 / 时间 / 估时，原文放备注。

## 4. 依赖与打包

- `package.json`：移除 `@arcships/light-ocr`、`@arcships/light-ocr-tiny`，新增 `@arcships/light-ocr-runtime@0.1.9`。
- `build.extraResources` 增加 `build/ocr-model → ocr-model`。
- 模型包从 npm 依赖（含 Apple CoreML / WebGPU 两份额外权重，约 62MB）换成随包 21.5MB：单文件 exe 从 252.7MB 降到 212.8MB（约 -40MB），便携 ZIP 从 252.7MB 降到 212.8MB。
- 模型包总文件数 10，远低于 core 的 64 文件 / 512MB 上限。

## 5. 验证

- `pnpm typecheck` 通过。
- 新增 `scripts/test-ocr.ts` 并接入 `pnpm test:unit`：
  - 校验 `SHA256SUMS` 覆盖模型包每个文件（含 `manifest.json`）且哈希一致；
  - 校验字典条目数与 `normalized-config.json` 一致、结尾恰好一个 ASCII 空格；
  - 用 `scripts/fixtures/ocr-sample.png` 真实识别，断言 `前端重构` / `TaskCard` / `0.6.20`。
- `pnpm test:unit`、`pnpm test:launcher` 通过。
- `pnpm dist`（`LIGHTTODO_SKIP_E2E=1`）单文件 exe / ZIP 启动门槛通过，`resources/ocr-model` 随包存在。

## 6. 已知限制

- bundle 的身份字段（family / model id / sourceRevision）为适配 light-ocr 核心校验沿用 PP-OCRv6 small 的取值，升级 `@arcships/light-ocr-runtime` 时需要重新确认这些字段仍被接受（`scripts/test-ocr.ts` 会第一时间发现）。
- PP-OCRv5 mobile 对极小号符号（`<`、`√`）识别弱于 v6 Small；如果后续更在意 UI 图标字，可以把 `build/ocr-model` 换成 PP-OCRv5 server，或在 bundle 里保留 v6 Small 作为二次识别。
