# 软件更新与数据持久化技术方案调研

> 调研日期：2026-11-06  
> 适用版本：LightTodo 0.6.10（Electron 45 / electron-builder 26）  
> 结论先行：**先修“数据根”，再谈“自动更新”。** 数据必须从 exe 所在目录迁到稳定的用户目录；更新优先选 NSIS + electron-updater，若必须保留单文件便携 exe，则把现有 C# 启动器升级成“启动器内更新器”。  
> 说明：本文是基于当前代码与官方文档的方案调研，**未实际改造代码、未搭建更新服务器**；目录/清单/时序是建议实现，落地前需按第 10 节做端到端验证。

---

## 0. 四个问题的直接回答

| 问题 | 结论 |
| --- | --- |
| 安装包出来了放哪里？ | 放在**固定 HTTPS 地址的对象存储 + CDN** 上（国内首选阿里云 OSS / 腾讯云 COS），按“渠道 / 平台 / 版本”分目录；客户端只读一个稳定的 `latest.json`（或 `latest.yml`）。GitHub Releases 只适合做海外镜像或备用源，不建议作为国内主源。 |
| 怎么通知用户可以更新？ | 不需要推送服务。客户端启动后延迟检查 + 每 6～24 小时轮询一次清单，发现新版本后在**应用内横幅 / 设置页“关于” / 托盘菜单**提示；下载完成后提示“重启并安装”。只有 App 正在运行才能弹 Windows 通知，App 没启动时靠下次启动检查。 |
| 用户点击更新后怎么安装、怎么重启？ | **NSIS 路线**：electron-updater 下载 Setup → 校验 → `quitAndInstall()` → NSIS 静默安装到同一 per-user 目录 → 自动启动新版本。**便携路线**：下载新版 payload → 写 `pending.json` → App 以约定退出码退出 → 启动器校验并解压到新的版本目录 → 原子切换 `state.json` → 重启；旧版本目录保留一份用于回滚。 |
| 数据还是用之前的吗？ | 是，但前提是**数据根不再跟着 exe 走**。默认改为 `%LOCALAPPDATA%\LightTodo\data`，升级只替换程序目录，永不触碰数据目录；首次升级时从旧的 `LightTodoData` 做一次带校验的复制迁移，并在升级前自动备份数据库。 |

---

## 1. 现状诊断：为什么“换一个新 exe，数据就像没缓存”

### 1.1 当前发布链路

`scripts/package-windows.cjs` 做的事情是：

1. `electron-builder --win dir` 生成 `release/<version>/win-unpacked`；
2. 把 `win-unpacked` 压成 `LightTodo-<version>-portable.zip`；
3. 把这个 ZIP 作为资源嵌进 C# 启动器，编译出 `LightTodo-<version>-x64.exe`；
4. 启动器首次运行把内嵌 ZIP 解压到 exe 同目录的 `LightTodoApp-<version>-<payloadHash>`，再启动里面的 `LightTodoRuntime.exe`。

所以现在的“安装包”本质上是**一个自解压的便携程序**，不是安装器；每次发版就是发一份新的、完整的程序副本。

### 1.2 数据根为什么跟着版本走

`src/main/index.ts` 第 34～44 行：

```ts
// 便携版把数据放在 exe 同目录；开发环境放工作区；也可用环境变量显式指定。
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'LightTodoData')
  : null
const dataRootOverride =
  process.env.LIGHTTODO_DATA_DIR ??
  portableRoot ??
  (isDev ? join(app.getAppPath(), '.tmp', 'data') : null)
if (dataRootOverride) {
  mkdirSync(join(dataRootOverride, 'userdata'), { recursive: true })
  app.setPath('userData', join(dataRootOverride, 'userdata'))
}
```

`PORTABLE_EXECUTABLE_DIR` 是**启动器所在目录**。因此：

- 用户在 `D:\下载\LightTodo\` 运行 0.6.10，数据在 `D:\下载\LightTodo\LightTodoData`；
- 用户把 0.6.11 下载到 `D:\下载\LightTodo-0.6.11\`，数据根变成 `D:\下载\LightTodo-0.6.11\LightTodoData`；
- 新目录里当然没有旧库，看起来就是“数据没缓存”。

仓库里的实际产物也验证了这一点：`release/0.6.10/LightTodoData/lighttodo.db`、`release/0.6.3/LightTodoData/lighttodo.db`、`release/data/lighttodo.db` 是三份互不相干的数据库。

### 1.3 顺带发现的问题

1. **每个版本留一份 ~250 MB 的解压目录**  
   `release/0.6.10/LightTodoApp-0.6.10-75f82a50b48e` 是完整运行时；目前没有任何清理逻辑，升级几次就会白占几百 MB 到 1 GB。
2. **用户数据与 Chromium 缓存混在一起**  
   `app.setPath('userData', <dataRoot>\userdata)` 让 `Local Storage`、`GPUCache`、`Code Cache` 和 `lighttodo.db` 混在同一棵树里；排障和清理都不方便。
3. **没有任何更新检查 / 版本清单**  
   只能靠用户自己发现新版本、自己下载、自己覆盖；没有“新版本可用”的提示。
4. **没有代码签名**  
   Windows SmartScreen 会把新 exe 标成“未知发布者”；更新器下载的包也无法验证发布者身份，只能靠哈希。
5. **没有版本清单和下载统计**  
   无法做灰度、无法判断某个版本是否出问题、无法强制安全更新。

### 1.4 已有的可复用基础

- 启动器已经负责“解压 → 启动 → 等待子进程 → 记录退出码”，很适合扩展成“更新器”；
- 单实例锁、`before-quit` 备份、`closeDb()` 都已存在；
- 已有 14 份自动备份和带校验/回滚的恢复逻辑（`src/main/data.ts`）；
- SQLite 已使用 WAL，且已有 `ensureColumn` 式增量迁移；
- `checksums.json` 已经记录构建产物的 SHA-256，可扩展到更新清单。

---

## 2. 目标与约束

**必须做到：**

1. 换版本、换目录、重装程序，都不丢用户数据；
2. 用户不点“下一步”、不需要管理员权限也能更新；
3. 更新失败不能把旧版本弄坏，必须可回滚；
4. 更新包必须可校验（哈希/签名），不能被中间人替换；
5. 无网络时 App 仍可正常使用，更新检查失败要静默；
6. 国内网络可下载，更新服务器成本可控；
7. 兼容现有便携版用户，不能要求他们手工找数据库。

**明确不做的：**

- 不做账号体系/云同步（本期只解决本机持久化）；
- 不做后台常驻更新服务（不装 Windows 服务、不写计划任务）；
- 不做强制自动安装（默认让用户确认重启）。

---

## 3. 两条路线对比

| 维度 | 路线 A：NSIS 安装版 + electron-updater | 路线 B：单文件便携版 + 启动器自更新 |
| --- | --- | --- |
| 用户是否要安装 | 要，装一次；之后自动更新 | 不要，继续保持双击 exe |
| 更新实现 | 官方 `electron-updater`，Windows 只支持 NSIS | 自研：manifest + 下载 + 启动器解压切换 |
| 开发量 | 小（约 2～4 天，含联调） | 中（约 1～2 周，含回滚/自替换/测试） |
| 更新体积 | 支持 blockmap 差分，通常几 MB～几十 MB | 默认全量 payload ~164 MB；可再做文件级差分 |
| 安装/更新权限 | per-user 安装可免 UAC；per-machine 需要 UAC | 免安装，但要求 exe 所在目录可写 |
| 回滚 | electron-updater 无自动回滚，只能发更高版本；可保留旧安装包 | 可保留上一版目录，启动器可直接回退 |
| 代码签名 | 需要（否则 SmartScreen 拦截） | 同样需要 |
| 适用 | 大多数消费级 Windows 软件 | “绿色软件/放 U 盘”是产品卖点时 |

**推荐决策树：**

```text
能接受用户安装一次？
├─ 是 → 路线 A：NSIS per-user + electron-updater（首选，最稳、最省开发）
└─ 否 → 路线 B：保留单文件 exe，启动器自更新（次选，工作量大但体验不变）
```

> 不管选 A 还是 B，**第 4 节的数据根方案都必须先做**。否则更新做得再好，用户换一个目录仍然“数据没了”。

**推荐组合（如果由我来落地）：**

1. 数据根先迁到 `%LOCALAPPDATA%\LightTodo\data`，旧数据一次性导入（P1，先发一个补丁版）；
2. 主分发改为 **NSIS per-user 安装包 + electron-updater**，保留 portable ZIP 作为“绿色版”；
3. 更新文件放阿里云 OSS + CDN，`latest.yml` 短缓存、版本文件不可变；
4. 应用内“检查更新”+ 下载进度 + “重启并安装”，灰度 5% → 25% → 100%；
5. 补代码签名；没有签名之前，至少做清单 Ed25519 + SHA-256 校验。

这样每次发版仍然会产出一个新的 `LightTodo-Setup-x.y.z.exe`，但**用户不再需要自己找安装包、手动覆盖**；安装器只替换程序目录，数据目录始终不动。

---

## 4. 通用基础：先把数据根固定下来

### 4.1 推荐目录结构

**Windows 默认（安装版默认；便携版未开启 `portable.flag` 时也用它）：**

```text
%LOCALAPPDATA%\LightTodo\
  data\
    lighttodo.db            # 主库（运行时还有 -wal / -shm）
    backups\                # 自动备份、升级前备份
    files\                  # 预留：附件/导入原文件
  session\                  # Electron userData：Local Storage、GPUCache 等
  logs\
    startup.log
    launcher.log
  updates\                  # 下载中的 payload / pending.json
  install.json              # 安装标识、数据根、schema 版本
```

**便携模式（显式开启，适合 U 盘）：**

```text
<exeDir>\
  LightTodo.exe
  portable.flag             # 空文件，存在即便携模式
  LightTodoData\
    data\lighttodo.db
    session\
    logs\
```

**开发环境：** 继续用 `<repo>\.tmp\data`，通过 `LIGHTTODO_DATA_DIR` 指定。

### 4.2 数据根解析优先级

在 `app.whenReady()` 之前按以下顺序决定（高 → 低）：

1. 命令行 `--data-dir=<path>`（测试/高级用户）；
2. 环境变量 `LIGHTTODO_DATA_DIR`（现有 E2E/QA 已用，保留）；
3. exe 同目录存在 `portable.flag` → `<exeDir>\LightTodoData`；
4. Windows 默认 → `%LOCALAPPDATA%\LightTodo`；
5. macOS → `~/Library/Application Support/LightTodo`；Linux → `$XDG_DATA_HOME/lighttodo` 或 `~/.local/share/lighttodo`。

注意：Electron 的 `userData` 默认是 `%APPDATA%`（Roaming），不适合放 SQLite 和 Chromium 缓存。应显式：

```ts
const root = resolveDataRoot()
mkdirSync(join(root, 'data'), { recursive: true })
mkdirSync(join(root, 'session'), { recursive: true })
app.setPath('userData', join(root, 'session'))
app.setPath('sessionData', join(root, 'session'))
```

`app.setPath` 必须在 `ready` 之前调用，且目录要先创建。

### 4.3 老用户迁移（一次性）

首次运行 0.7.x 时，如果 `%LOCALAPPDATA%\LightTodo\data\lighttodo.db` 不存在，按以下顺序找旧数据：

1. 当前 exe 同目录的 `LightTodoData\lighttodo.db`；
2. `%APPDATA%\LightTodo\lighttodo.db`（旧安装版）；
3. 用户手动选择的目录（设置页“导入旧数据”）。

找到后弹窗，明确展示：

> 检测到旧版本数据：`D:\下载\LightTodo\LightTodoData`  
> 共 128 个任务、6 个清单，最后修改 2026-11-05 18:20  
> 新版本会把数据保存到 `C:\Users\你\AppData\Local\LightTodo\data`，是否导入？  
> [导入并继续] [使用全新数据] [选择其他目录]

迁移步骤（**复制，不移动**）：

1. 先检查旧库没有正在被旧版 App 写入；如果 `-wal` 有锁，提示“请先关闭旧版本”；
2. 用 SQLite `VACUUM INTO '<新目录>\lighttodo.db.tmp'` 生成一致快照（不要直接复制 `lighttodo.db`，WAL 模式下可能丢事务）；
3. 对新库执行 `PRAGMA integrity_check`，并对比 `tasks` / `lists` / `settings` 行数；
4. 校验通过后原子改名到 `data\lighttodo.db`；
5. 复制旧 `userdata\Local Storage` 到新 `session\Local Storage`（主题、默认视图、日历模式存在 localStorage，不迁会“恢复默认”）；
6. 写 `install.json`，记录 `migratedFrom`、`migratedAt`；
7. 旧目录保留至少一个版本周期，改名为 `LightTodoData.migrated-<日期>` 或原样保留，绝不自动删除。

失败处理：删除临时文件，保留旧库与旧目录，弹窗给出日志路径；下次启动可重试。

### 4.4 数据分层

| 层 | 内容 | 丢失后果 | 升级策略 |
| --- | --- | --- | --- |
| 用户数据 | `lighttodo.db`、设置、模板、将来附件 | 不可恢复 | 保留、迁移、升级前备份 |
| 派生数据 | 搜索索引、统计缓存、缩略图 | 可重建 | 可删，启动时重建 |
| Chromium 数据 | `Local Storage`、`Cache`、`Code Cache`、`GPUCache` | 大多可重建；Local Storage 含 UI 偏好 | Local Storage 迁移；Cache 类可清 |
| 日志 | `startup.log`、`launcher.log` | 仅诊断 | 轮转，保留 14 天 |

**关键原则：用户数据不是缓存。** 不要把 `lighttodo.db` 放进 `Cache`、`GPUCache` 或临时目录；也不要把活动数据库放在 OneDrive/网络盘（SQLite WAL 明确不支持网络文件系统，同步客户端还可能锁文件/生成冲突副本）。

---

## 5. 路线 A：NSIS 安装版 + electron-updater（推荐）

### 5.1 官方支持边界

electron-builder v26 的 Target 表明确写着：

- Windows `nsis` / `nsis-web`：Auto-Update = `electron-updater`；
- Windows `portable`：Auto-Update = **Manual**（“Auto-updates require manual implementation”）；
- `appx`：Store only；`msi`：不支持 electron-updater。

electron-builder 的 Auto Update 文档也写明，Windows 可自动更新的 target 只有 NSIS；Squirrel.Windows 明确不支持。Electron 内置 `autoUpdater` 在 Windows 上只识别 MSIX 和 Squirrel.Windows，不认识 NSIS/portable。

**所以：如果目标是“官方、最少代码、可持续”，选 NSIS。** 继续用 portable，就必须自己写更新器（路线 B）。

### 5.2 打包配置建议

保留现有 `portable` 产物作为“绿色版”，新增一个 **per-user NSIS** 通道：

```json
{
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] },
      { "target": "portable", "arch": ["x64"] }
    ]
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowToChangeInstallationDirectory": false,
    "createDesktopShortcut": true,
    "deleteAppDataOnUninstall": false,
    "differentialPackage": "store-asar",
    "artifactName": "LightTodo-Setup-${version}.${ext}"
  },
  "publish": [
    {
      "provider": "generic",
      "url": "https://dl.lighttodo.cn/updates/stable/win-x64"
    }
  ]
}
```

说明：

- `oneClick: true` + `perMachine: false` → 默认装到 `%LOCALAPPDATA%\Programs\LightTodo`，**不需要管理员权限**，更新也不需要 UAC；
- 当前 `oneClick: false` 会出现安装模式选择页，用户可能选 per-machine，之后每次更新都要 UAC；
- `deleteAppDataOnUninstall: false` → 卸载不删数据（默认就是 false，显式写出来）；
- `differentialPackage: "store-asar"` 让 `app.asar` 在安装包内保持未压缩，差分更新只下载变化块；代价是安装包会变大一些。若当前 electron-builder 版本不支持该值，先用默认值，不要为了差分卡住发布；
- `publish` 配置后，构建会生成 `resources/app-update.yml`，客户端不需要 `setFeedURL`；
- 不要把 `electron-updater` 只放在 `devDependencies`：它必须进安装包。当前主进程用 `externalizeDepsPlugin()`，依赖会被外置，需要把它放进 `dependencies`，或配置 `externalizeDepsPlugin({ exclude: ['electron-updater'] })` 让它打进 `out/main`。构建后要检查 `app.asar` 里确实有它。

### 5.3 发布产物

一次发布至少产生：

```text
release/0.7.0/
  LightTodo-Setup-0.7.0.exe
  LightTodo-Setup-0.7.0.exe.blockmap
  latest.yml
  LightTodo-0.7.0-x64.exe          # 便携版，可选
  LightTodo-0.7.0-portable.zip     # 绿色版，可选
  checksums.json
```

`latest.yml` 是 electron-updater 的清单，包含版本、文件名、`sha512`、大小、`stagingPercentage` 等；`.blockmap` 用于差分下载。把这三个文件上传到同一个 HTTPS 目录即可。

### 5.4 客户端更新逻辑（主进程）

新增 `src/main/updater.ts`，核心状态机：

```ts
import { autoUpdater } from 'electron-updater'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes?: string }
  | { phase: 'downloading'; percent: number; transferred: number; total: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

autoUpdater.autoDownload = false          // 用户点“下载”再下，避免偷跑流量
autoUpdater.autoInstallOnAppQuit = true   // 用户选“退出时安装”
autoUpdater.allowPrerelease = false       // beta 通道单独开

autoUpdater.on('update-available', info => {
  // 推给渲染进程：显示“新版本 0.7.0 可用”
})
autoUpdater.on('download-progress', p => {
  // 推给渲染进程：进度条
})
autoUpdater.on('update-downloaded', info => {
  // 显示“重启并安装”
})
autoUpdater.on('error', err => {
  // 静默记录；用户主动点检查时才弹错误
})

async function checkForUpdates(manual = false) {
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    if (manual) showError('检查更新失败，请稍后重试')
  }
}
```

用户点“立即重启安装”：

```ts
// 先把数据库收尾，再交给 electron-updater
backupNow('update')
closeDb()
autoUpdater.quitAndInstall(false, true)
```

`quitAndInstall()` 会关闭所有窗口、启动 NSIS 安装器（`--updated /S`），安装完成后按参数重启应用。数据目录不在安装目录里，所以安装器不会碰它。

### 5.5 通知与 UI

- **启动后 15 秒**检查一次（不要阻塞首屏）；
- 之后每 **6 小时**检查一次；失败静默；
- 设置页“关于”提供“检查更新”按钮、当前版本、上次检查时间；
- 托盘菜单加“检查更新…”；
- 发现新版本：右下角非阻塞横幅 / 设置页红点，文案示例：
  - “发现新版本 0.7.0 · 12.4 MB”
  - [查看更新内容] [稍后] [下载]
- 下载完成：“更新已准备好，重启后生效” [立即重启] [退出时安装]
- 同一版本用户点“稍后”后，7 天内不再弹；`mandatory: true` 的安全更新除外。

### 5.6 路线 A 的边界

- electron-updater **没有自动回滚**：坏版本只能发更高版本修复；staged rollout（`stagingPercentage`）可以降低命中率，但不能撤回已安装用户；
- per-machine 安装需要 UAC；如果用户坚持装到 `Program Files`，更新会弹权限框；
- 代码签名必须做，否则 SmartScreen 会拦下载/运行；
- 企业环境（GPO/SCCM/Intune）应发 MSI 或 `msi-wrapped`，不要指望 electron-updater 管纯 MSI。

---

## 6. 路线 B：单文件便携版 + 启动器自更新（保留绿色版）

### 6.1 为什么不能“直接覆盖正在运行的 exe”

Windows 上正在运行的 exe 是 image section，**不能删除、不能原地覆盖**；同卷重命名通常可行，但不是 API 契约（杀软、OneDrive、只读目录都可能让 rename 失败）。`MoveFileEx(..., MOVEFILE_DELAY_UNTIL_REBOOT)` 需要管理员，而且只是“登记重启后重命名”，不适合便携应用。

现有启动器还有一个关键约束：它用 **kill-on-close Job Object** 包住 Electron 子进程。也就是说，App 自己 spawn 的“替换脚本/helper”也会在这个 Job 里，启动器一退出就会被一起杀掉。**因此替换动作必须由启动器在子进程退出后自己做，不能再起一个外部 helper。**

### 6.2 目录与状态

```text
<exeDir>\
  LightTodo.exe                         # 薄启动器，尽量稳定
  state.json                            # { current, previous, healthy, updatedAt }
  LightTodoApp-0.7.0-<hash>\            # 当前 payload
  LightTodoApp-0.6.10-<hash>\           # 上一版，保留用于回滚
  %LOCALAPPDATA%\LightTodo\updates\
    pending.json                        # 已下载、待应用
    LightTodo-0.7.0-payload.zip         # 校验通过后保留到应用完成
```

`state.json` 示例：

```json
{
  "schema": 1,
  "current": "0.7.0-75f82a50b48e",
  "previous": "0.6.10-1a2b3c4d5e6f",
  "healthy": true,
  "updatedAt": "2026-11-10T10:00:00+08:00"
}
```

`pending.json` 示例：

```json
{
  "schema": 1,
  "version": "0.7.0",
  "payload": "C:\\Users\\你\\AppData\\Local\\LightTodo\\updates\\LightTodo-0.7.0-payload.zip",
  "size": 164095794,
  "sha256": "…",
  "signature": "…",
  "installOnExit": false,
  "downloadedAt": "2026-11-10T10:00:00+08:00"
}
```

### 6.3 更新清单 `latest.json`

```json
{
  "schema": 1,
  "channel": "stable",
  "version": "0.7.0",
  "minVersion": "0.6.0",
  "minLauncherVersion": "0.6.10",
  "publishedAt": "2026-11-10T10:00:00+08:00",
  "mandatory": false,
  "notes": {
    "title": "0.7.0：数据不再跟着 exe 跑",
    "highlights": [
      "数据固定保存在用户目录，换版本/换目录不丢",
      "支持应用内检查、下载、重启更新",
      "新增启动失败自动回退上一版"
    ],
    "url": "https://dl.lighttodo.cn/updates/stable/win-x64/releases/0.7.0/notes.md"
  },
  "payload": {
    "url": "https://dl.lighttodo.cn/updates/stable/win-x64/releases/0.7.0/LightTodo-0.7.0-payload.zip",
    "mirrors": [
      "https://github.com/lighttodo/lighttodo/releases/download/v0.7.0/LightTodo-0.7.0-payload.zip"
    ],
    "size": 164095794,
    "sha256": "…",
    "format": "zip"
  },
  "launcher": {
    "url": "https://dl.lighttodo.cn/updates/stable/win-x64/releases/0.7.0/LightTodo-0.7.0-x64.exe",
    "size": 164111872,
    "sha256": "…",
    "required": false
  },
  "signature": "base64(Ed25519(去掉 signature 字段后的规范化 JSON))"
}
```

要点：

- `minVersion`：低于它的客户端必须先升到桥接版，不能直接跳最新（用于未来不兼容升级）；
- `minLauncherVersion`：payload 格式不兼容时，要求先换启动器；
- `mandatory`：安全更新/数据格式升级时可强制；
- `mirrors`：主源失败时按顺序回退；
- `signature`：用 Ed25519 对清单签名，公钥内置在启动器和 App 中；只靠 HTTPS 不够，必须防清单被替换；
- `sha256` + `size`：下载后先校验再解压；
- `notes`：更新说明的来源，客户端只渲染纯文本/白名单 Markdown，防 XSS。

### 6.4 点击“重启更新”的完整时序

```text
[渲染进程] 用户点击“立即重启并安装”
      │
      ▼
[主进程] backupNow('update')  →  data/backups/lighttodo-...-update.db
         closeDb()             →  WAL checkpoint + 关闭 SQLite
         app.exit(20)          →  约定退出码 20 = 请求应用更新
      │
      ▼
[启动器] Run(runtime) 返回 20
         ApplyPendingUpdate()
           1. 读 pending.json，校验 version > current
           2. 校验文件 size + SHA-256
           3. 解压到 LightTodoApp-<new>-<hash>.tmp
              - 逐条目检查路径逃逸（现有逻辑已有）
              - 限制条目数/解压总大小，防 zip bomb
           4. 写 .complete，Directory.Move(tmp, final)
           5. state.previous = state.current
              state.current  = new
              原子写 state.json
           6. 删除 pending.json 和已安装的 zip
           7. 清理旧版本目录（保留 current + previous）
           8. Process.Start(LightTodo.exe) 重新启动
      │
      ▼
[新版本] 启动 → 解析同一个 data root → initDb → 迁移（如有）→ 显示窗口
```

如果用户选的是“退出时安装”：

- 下载完成时把 `pending.json.installOnExit = true`；
- 用户正常退出（退出码 0）后，启动器**只应用更新、不重启**；
- 下次启动自然进入新版本。

如果用户直接关窗口/任务管理器强杀：

- 只要 `pending.json` 完整，下次启动时启动器可以先应用再启动；
- 如果下载没完成（只有 `.part`），忽略并清理。

### 6.5 回滚与健康检查

启动器在启动新版本前写 `launch.json`：

```json
{ "version": "0.7.0", "startedAt": "...", "healthy": false }
```

新版本在 `ready-to-show` 后写 `ready.ok`（或调用启动器提供的命名事件）。启动器逻辑：

1. 启动后等待 `ready.ok`，最多 30 秒；
2. 超时或子进程在 30 秒内非零退出 → 标记 `healthy=false`；
3. 下一次启动如果 `healthy=false`，自动切到 `previous`，并提示“上次启动失败，已回退到 0.6.10”；
4. 如果 `previous` 也不可用，停留在当前版本并给出日志路径，不要无限循环。

> MVP 可以先做“下次启动回退”，不急着做“启动 30 秒内自动杀进程回退”；后者需要启动器增加等待/杀进程逻辑，测试面更大。

### 6.6 启动器自身更新

启动器应保持极简、长期不变；只有 payload 格式不兼容时才更新启动器。更新方式：

1. App 下载新的 `LightTodo-<ver>-x64.exe` 到 `updates\LightTodo.exe.new`，校验；
2. 退出时启动器把自身复制成临时 `LightTodoUpdater.exe`，由它等待父进程退出；
3. `MoveFile(旧 LightTodo.exe → LightTodo.exe.old-<ts>)`，`MoveFile(new → LightTodo.exe)`；
4. 启动新启动器；失败则把 `.old` 改回来，保留两份并提示用户手动替换。

如果 rename 失败（杀软/权限），**绝不删除旧文件**，提示“请手动下载完整包替换”。这是低频操作，不值得为它做复杂自替换。

### 6.7 更新体积优化

当前 payload zip 约 **164 MB**（0.6.10 实测），每次全量下载对用户和带宽都不友好。三个层次：

1. **MVP：全量 payload**，实现简单、可靠；先解决“有没有更新”而不是“更新多小”。
2. **文件级增量**（推荐第二步）：清单里列每个文件的 `path/size/sha256`；客户端对比当前版本，只下载变化的文件（通常只有 `resources/app.asar`，压缩后约十几 MB），未变化文件从当前版本目录硬链接/复制到新目录。
3. **二进制差分**：对 `app.asar` 做 bsdiff/zstd patch；效果最好，但版本绑定严格，失败必须回退全量，维护成本高。

对 LightTodo 这种“Electron 运行时不变、主要改 app.asar”的应用，**文件级增量的性价比最高**。

---

## 7. 安装包/更新文件放哪里

### 7.1 托管选项

| 方案 | 国内访问 | 成本 | 备案/资质 | 适用 |
| --- | --- | --- | --- | --- |
| 阿里云 OSS + CDN | 好 | 存储 ~¥0.12/GB/月，CDN ~¥0.2/GB | 自定义域名需 ICP 备案 | **国内主源首选** |
| 腾讯云 COS + CDN | 好 | 与 OSS 接近 | 自定义域名需备案 | 国内主源备选 |
| 七牛云 Kodo + CDN | 好 | 便宜 | 需备案 | 预算敏感 |
| Cloudflare R2 | 一般/不稳定 | 无出站流量费 | 自定义域名通常需备案/合作伙伴 | 海外用户/备用 |
| GitHub Releases | 慢/时常不可达 | 免费 | 无 | 海外镜像、开发者下载 |
| 百度网盘/蓝奏云 | 好 | 免费 | 无 | **只能做手动备用，不能做自动更新源** |

**建议：** 主源用阿里云 OSS + CDN（`https://dl.lighttodo.cn`，需备案），GitHub Releases 做镜像；清单里配置 `mirrors`，客户端主源失败自动切换。

### 7.2 目录与缓存策略

> 下文的 `dl.lighttodo.cn`、`github.com/lighttodo/...` 都是示例，按实际域名/仓库替换。

```text
https://dl.lighttodo.cn/updates/
  stable/
    win-x64/
      latest.json                         # 自定义更新器：短缓存 no-cache / max-age=60，带 ETag
      latest.yml                          # NSIS/electron-updater：短缓存，构建时生成
      releases/
        0.7.0/
          LightTodo-0.7.0-payload.zip     # 不可变：max-age=31536000, immutable
          LightTodo-0.7.0-x64.exe         # 完整包（启动器更新时用）
          notes.md
          sha256sums.txt
        0.6.10/
          ...
  beta/
    win-x64/
      latest.json
```

规则：

- **清单短缓存**，发布后 CDN 刷新 `latest.json`；
- **版本文件长缓存/不可变**，文件名带版本，绝不覆盖；
- 只保留最近 3～5 个版本 + 当前 `minVersion` 所需的桥接版；删除前确认没有客户端还依赖；
- 对象存储桶只开公共读，关闭 list；CI 用 RAM 子账号/临时凭证上传；
- 必须支持 `Range`（断点续传）和 `Content-Length`；OSS/COS 默认支持；
- 有条件的可以加 `Content-MD5`/`x-oss-hash-crc64ecma`，客户端仍以清单 SHA-256 为准。

### 7.3 发布流水线

```text
1. 改 package.json version（patch/minor）
2. pnpm typecheck && pnpm test:unit && pnpm test:launcher
3. pnpm dist / pnpm dist:setup
4. 生成 latest.json / latest.yml + Ed25519 签名
5. 上传版本文件（不可变路径）
6. 上传/刷新 latest.json（短缓存）
7. 冒烟：新机器下载 → 安装/解压 → 启动 → 数据目录正确
8. 可选：5% → 25% → 100% 灰度
```

CI 里不要把 OSS AccessKey 写进仓库；用环境变量/密钥管理。构建产物 `release/` 已被 `.gitignore` 忽略，不要提交 164 MB 的 exe。**`release/<version>/` 只是本机构建目录，不是分发渠道**；对外分发要上传到对象存储/CDN，不要把 Git 仓库、聊天群文件或网盘当作自动更新源。

### 7.4 代码签名与 SmartScreen

这是更新方案能不能“看起来正规”的关键：

- 未签名 exe：Windows 会显示“未知发布者”，SmartScreen 可能直接拦截；用户不敢点。
- **Azure Artifact Signing（原 Trusted Signing）Public Trust 目前只对特定国家/地区的组织开放**（美/加/欧盟/英/澳/新/日/韩/新/瑞士/挪威/以色列；个人开发者仅美/加），中国大陆主体用不了 Public Trust；Private Trust 只能内网。
- 国内主体现实选择：**OV/EV 代码签名证书**（DigiCert、Sectigo、GlobalSign 等），私钥必须放硬件令牌/云 HSM；EV 通常能更快建立 SmartScreen 信誉，但价格更高。
- 更新器校验：下载后做 SHA-256；如果做 Authenticode，校验证书链并 **pin 公钥/指纹**，不要只比对 Common Name。
- 清单签名（Ed25519）与 Authenticode 互补：前者防“包被换”，后者防“发布者身份被冒”。

如果短期没有预算买证书，至少：

1. 清单 Ed25519 签名 + SHA-256；
2. 官网提供 `sha256sums.txt`；
3. 首次安装提示“未知发布者”时给出说明；
4. 尽快补签名——否则更新率会被 SmartScreen 显著拉低。

### 7.5 成本估算

以 164 MB/次全量更新为例：

- 1,000 次下载 ≈ 164 GB；CDN 按 ¥0.2/GB ≈ **¥33/次发布**；
- 10,000 次下载 ≈ 1.6 TB ≈ **¥330/次发布**；
- 存储保留 5 个版本 ≈ 1 GB，可忽略。

如果做文件级增量（大多只有十几 MB），成本会降一个数量级。

---

## 8. 怎么通知用户可以更新

### 8.1 采用“客户端拉取”，不要自建推送

桌面端没有可靠的免费推送通道；为待办应用养一个推送服务不值得。正确模型是：

```text
App 启动 → 延迟 15s → GET latest.json（If-None-Match）
         → 版本比较 → 有新版本 → 应用内提示
         → 之后每 6h 检查一次（应用运行期间）
```

用户没开 App 就收不到通知——这可以接受；下次启动会检查。若用户开了“开机自启”，登录后就会检查。

### 8.2 提示位置与文案

| 位置 | 内容 | 交互 |
| --- | --- | --- |
| 主窗口右下角横幅 | “发现新版本 0.7.0 · 12.4 MB” | [查看] [稍后] [下载] |
| 设置 → 关于 | 当前版本、上次检查时间、检查按钮 | 手动检查 |
| 托盘菜单 | “检查更新…” | 手动检查 |
| 下载完成 | “更新已准备好，重启后生效” | [立即重启] [退出时安装] |
| 强制更新 | “此版本包含重要修复，需更新后继续使用” | [立即更新]（可导出数据） |

细节：

- 同一版本点“稍后”后 7 天内不再弹；`mandatory` 除外；
- 检查失败静默，不打扰用户；用户手动点检查时才提示错误；
- 更新说明只显示 3～5 条重点，完整内容打开 `notes.md`；
- 下载中显示进度、速度、剩余时间；支持取消；
- 不要每次启动都弹窗；不要强制重启；不要在用户编辑任务时突然退出。

### 8.3 灰度与强制更新

- `latest.json` 增加 `stagingPercentage: 5`；客户端用 `installId` 的哈希做稳定分桶，5% 用户先收到；
- 观察 24～48 小时（崩溃日志/更新成功率），再调到 25%、100%；
- 发现严重问题：把 `latest.json` 指回旧版本（`rollback: true`，仅允许回退到 `previous`），或发更高版本的热修复；
- `minVersion` 用于强制升级：低于它的客户端只提示“必须更新”，不提供“稍后”。

### 8.4 可选的更新统计

如果想知道“多少人更新成功”，加一个轻量 endpoints：

```text
POST https://dl.lighttodo.cn/updates/events
{ "event": "check|download|apply|error", "from": "0.6.10", "to": "0.7.0", "os": "win11", "installId": "随机UUID" }
```

不要采集任务内容、文件名、账号等隐私数据；在隐私政策里说明；失败静默，不能影响更新。

---

## 9. 数据缓存/持久化详细策略

### 9.1 先区分“用户数据”和“缓存”

用户说“数据没缓存”，本质是**持久化目录不稳定**。方案里要明确：

- `data\lighttodo.db`：用户数据，**永不自动删除**；
- `session\`：Chromium 缓存/本地存储，可重建，但 `Local Storage` 含主题/视图偏好，升级时保留；
- `updates\`：下载缓存，安装完成/失败后清理，`.part` 最多保留 7 天；
- `logs\`：诊断日志，轮转 14 天。

### 9.2 SQLite 可靠性

现有配置是合理的：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

补充：

- `synchronous=NORMAL` 在 WAL 下不会损坏数据库，但断电可能丢最后几条事务；待办应用可接受，需在文档里说明；
- 退出时 `closeDb()` 会做最后一次 checkpoint 并删除 `-wal`；但 Windows 关机/注销**不会触发** `before-quit`，所以不能只靠退出备份；
- 不要把活动库放 OneDrive/网络盘；WAL 需要同机共享内存，网络文件系统不支持；
- 备份不要直接 `copyFileSync(lighttodo.db)`；当前 `checkpoint()+copy` 在单连接下可用，但更稳的是 `VACUUM INTO`：

```ts
db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
```

`VACUUM INTO` 会生成一致快照，目标文件必须不存在；小库（几十 MB）耗时很短。

### 9.3 Schema 迁移与降级保护

现状是 `ensureColumn()` 逐列补齐，没有统一的 `user_version`。建议：

1. 建库时写 `PRAGMA application_id = 0x4C54444F`（“LTDO”），标识这是 LightTodo 的库；
2. 用 `PRAGMA user_version` 记录 schema 版本；
3. 迁移流程：

```text
读 user_version
├─ > 当前 App 支持的最大版本 → 拒绝写入，提示“数据由更高版本创建，请升级”
├─ == 当前版本 → 正常打开
└─ < 当前版本 → 升级前备份 → BEGIN IMMEDIATE
                 → 依次执行 migration
                 → PRAGMA user_version = N
                 → COMMIT
                 → integrity_check
                 → 失败：ROLLBACK + 用备份恢复
```

4. 迁移必须**向前兼容一个版本**：新增列给默认值，不删除/重命名旧列；这样用户误开旧 exe 时至少能读；
5. 旧版本无法 retrofit 检查 `user_version`，所以升级后要在 UI 明确提示“请使用 0.7.0 及以上版本打开此数据”；
6. 迁移前备份命名为 `lighttodo-<时间>-pre-migrate-v<old>.db`，不参与 14 份轮转（单独保留）。

### 9.4 备份与恢复

已有能力可以复用：

- 启动/退出自动备份，保留 14 份；
- 手动备份；
- 恢复时校验源文件、预恢复备份、staging 校验、失败回滚。

补充：

- 升级前额外备份 `reason='update'`；
- 迁移前额外备份 `reason='pre-migrate'`；
- 恢复前额外备份 `reason='pre-restore'`；
- 备份目录单独设上限（如 2 GB），超限从最旧删；
- 支持“导出完整备份”单文件（`VACUUM INTO`），方便用户换机。

### 9.5 便携模式 / 多用户 / OneDrive

- **便携模式**：只有 exe 旁存在 `portable.flag` 才用 `<exeDir>\LightTodoData`；设置页明确提示“便携模式数据随目录走，换目录请手动迁移”；
- **多用户**：`%LOCALAPPDATA%` 按 Windows 用户隔离，天然支持多用户；共享旧目录由每个用户各自导入副本，不要搬走共享库；
- **OneDrive**：检测数据根在 OneDrive/网络路径时，提示“活动数据库不能放在同步盘”，建议改到本地；只把备份快照放 OneDrive；
- **只读目录**：exe 在 `Program Files`/只读 U 盘时，数据仍写 `%LOCALAPPDATA%`；但便携更新需要 exe 目录可写，不可写就提示改用安装版或搬到用户目录。

### 9.6 更新时数据安全的顺序

```text
用户点“重启更新”
  → backupNow('update')       # 先备份
  → closeDb()                 # 关库，checkpoint
  → 退出码 20
  → 启动器只动程序目录
  → 新版本启动
  → initDb(dataRoot)
  → 读 user_version
  → 需要迁移：先 pre-migrate 备份，再事务迁移
  → integrity_check
  → 打开窗口
```

**任何时候，更新器都不删除、不覆盖 `data\` 下的文件。**

### 9.7 验收清单

1. 全新安装：数据在 `%LOCALAPPDATA%\LightTodo\data`，exe 旁没有 `LightTodoData`；
2. 旧便携版首次升级：弹窗识别旧数据，导入后任务数/清单数/设置一致，旧目录保留；
3. 把 exe 从 `D:\A` 移到 `D:\B`：数据仍能打开；
4. 0.6.10 → 0.7.0 更新：版本号变化，任务数不变，`backups` 多一份 `-update`；
5. 下载中断/断网：旧版本正常启动，`.part` 可续传或清理；
6. 哈希/签名错误：拒绝安装，旧版本不受影响；
7. 解压中途断电：`.tmp` 目录下次启动清理，`state.json` 仍指向旧版本；
8. 新版本启动失败：回退上一版，提示日志路径；
9. 只读 exe 目录：数据仍在 LocalAppData，更新提示改用安装版；
10. 卸载：默认保留数据；重装后数据还在。

---

## 10. 实施计划

### 10.1 分阶段

| 阶段 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| P0 | 定方案：是否接受 NSIS、是否买签名、主源域名 | 决策记录 | 0.5 天 |
| P1 | 数据根固定 + 旧数据迁移 + 设置页展示 | 0.6.11，先解决“换 exe 丢数据” | 2～3 天 |
| P2 | 更新清单 + 检查/通知 UI + 托管/上传脚本 | 能发现新版本（先不自动装） | 1～2 天 |
| P3-A | NSIS per-user + electron-updater 全链路 | 0.7.0 自动更新 | 2～4 天 |
| P3-B | 便携启动器自更新 + 回滚（若选 B） | 0.7.0 绿色版自动更新 | 1～2 周 |
| P4 | 文件级增量、灰度、更新统计 | 降低带宽/风险 | 2～3 天 |

**建议先发 P1**：只改数据根，不动更新。这样即使更新方案还在讨论，用户“换新 exe 数据没了”的痛点已经解决；P1 也是 P3 的基础。

### 10.2 代码改动清单（P1）

- `src/main/index.ts`：数据根解析、`app.setPath('userData'/'sessionData')`、日志路径；
- `src/main/data.ts`：`VACUUM INTO` 备份、迁移前备份；
- `src/main/db.ts`：`application_id`、`user_version`、迁移 runner、降级保护；
- 新增 `src/main/data-root.ts`：解析/迁移/`install.json`；
- `src/main/ipc.ts` / `src/preload/index.ts`：暴露数据目录、迁移状态、选择目录；
- `src/renderer/src/components/SettingsModal.tsx`：数据目录、导入旧数据、打开目录；
- `scripts/test-*.ts`：迁移、备份、降级测试；
- `README.md` / `docs/`：更新数据目录说明。

### 10.3 代码改动清单（P3-A）

- `package.json`：`electron-updater` 进 `dependencies`，`publish` 配置，NSIS `oneClick/perMachine`；
- 新增 `src/main/updater.ts`：状态机、IPC、`quitAndInstall`；
- `src/preload/index.ts`：`updater` API；
- `src/renderer/src/components/SettingsModal.tsx`：关于/检查更新；
- 托盘菜单：检查更新；
- `scripts/package-windows.cjs`：生成 `latest.yml` / 校验文件；
- CI：上传 OSS/COS、刷新 CDN、冒烟测试。

### 10.4 测试

- 单元：版本比较、清单校验、签名校验、数据根解析、迁移校验；
- 启动器：伪造 payload，测试正常应用、哈希错误、路径逃逸、断电残留、回滚；
- E2E：旧库 → 新版本启动 → 任务数一致；更新 UI 流程；
- 手工：干净 Win10/Win11 虚拟机、无网络、只读目录、OneDrive 目录、旧版运行中。

### 10.5 发布检查清单

- [ ] `pnpm typecheck` / `pnpm test:unit` / `pnpm test:launcher` 通过；
- [ ] 版本号递增，`checksums.json` 生成；
- [ ] 清单签名、哈希校验通过；
- [ ] 旧版本 → 新版本升级演练通过；
- [ ] 回滚演练通过；
- [ ] `latest.json` CDN 缓存已刷新；
- [ ] 官网下载页读取的是同一个清单；
- [ ] 发布说明、隐私政策（如加统计）更新。

---

## 11. 风险与待确认

1. **是否接受一次安装？** 这是 A/B 路线的分水岭；如果“绿色免安装”是核心卖点，选 B，但要接受 1～2 周开发量和后续维护。
2. **代码签名预算**：没有签名，SmartScreen 会显著降低更新成功率；国内主体买 OV/EV 证书需要时间（材料审核、硬件令牌/云 HSM）。
3. **域名与备案**：国内主源需要 ICP 备案；没有备案可先用 OSS 默认域名过渡，但长期建议自有域名。
4. **用户规模/带宽**：全量 164 MB 在大规模下成本高；确定用户量后决定是否做文件级增量。
5. **旧版本兼容**：0.7.0 迁移 schema 时必须向前兼容一个版本；否则用户误开旧 exe 可能写坏数据。
6. **更新服务器可用性**：单源故障会让所有检查失败；用 CDN + 镜像 + 客户端静默重试，不要把更新检查做成启动阻塞。
7. **杀毒软件**：自解压/替换 exe 容易被误报；签名、固定发布者、少做“释放 exe 到临时目录”的动作。
8. **Windows 版本**：Electron 45 需要 Windows 10 及以上；更新清单可加 `minOS`，但不要假装支持 Win7。

---

## 12. 参考链接

> 访问日期：2026-11-06。官方文档优先；社区做法已标注。

1. Electron `autoUpdater`（Windows 仅 MSIX / Squirrel.Windows；macOS Squirrel.Mac；sha256/size/delta）  
   https://www.electronjs.org/docs/latest/api/auto-updater
2. Electron `app` API（`getPath`/`setPath`/`userData`/`sessionData`；Windows 关机不触发 `before-quit`）  
   https://www.electronjs.org/docs/latest/api/app
3. electron-builder v26 Target Selection Guide（`portable` Auto-Update = Manual；NSIS = electron-updater）  
   https://www.electron.build/v26/docs/targets
4. electron-builder v26 Auto Update（Windows 可自动更新 target 只有 NSIS；staged rollout；`latest.yml`）  
   https://www.electron.build/v26/docs/features/auto-update
5. electron-builder v26 NSIS（`PORTABLE_EXECUTABLE_DIR` 等便携变量；`oneClick`/`perMachine`/`deleteAppDataOnUninstall`）  
   https://www.electron.build/v26/docs/nsis
6. electron-builder v26 Windows（代码签名、`verifyUpdateCodeSignature`）  
   https://www.electron.build/v26/docs/win
7. electron-builder v26 Publish（generic / GitHub / S3 provider）  
   https://www.electron.build/v26/docs/publish
8. electron-builder Issue #5378：portable target 自动更新未实现  
   https://github.com/electron-userland/electron-builder/issues/5378
9. SQLite WAL（网络文件系统不支持；`-wal` 是数据库持久状态的一部分）  
   https://www.sqlite.org/wal.html
10. SQLite PRAGMA（`user_version` / `application_id` / `synchronous` / `wal_checkpoint`）  
    https://www.sqlite.org/pragma.html
11. SQLite `VACUUM INTO`（一致快照备份）  
    https://www.sqlite.org/lang_vacuum.html
12. SQLite Backup API  
    https://www.sqlite.org/backup.html
13. SQLite Over a Network（不要把活动库放网络盘）  
    https://www.sqlite.org/useovernet.html
14. Microsoft Known Folder（Roaming vs Local AppData）  
    https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid
15. Microsoft Artifact Signing Quickstart（Public Trust 地区限制）  
    https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
16. Microsoft SmartScreen（信誉判定）  
    https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
17. Microsoft `MoveFileEx`（`MOVEFILE_DELAY_UNTIL_REBOOT` 限制）  
    https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa
18. Microsoft “Moving and Replacing Files”（文件必须先关闭）  
    https://learn.microsoft.com/en-us/windows/win32/fileio/moving-and-replacing-files
19. Tauri v2 Updater（静态 JSON + minisign 签名，作为跨框架参考）  
    https://v2.tauri.app/plugin/updater/
20. Squirrel.Windows（`app-<version>` + `Update.exe`，已不推荐）  
    https://github.com/Squirrel/Squirrel.Windows
