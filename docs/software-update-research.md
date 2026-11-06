# 软件更新与数据持久化技术方案调研

> 调研日期：2026-11-06  
> 适用版本：LightTodo 0.6.10（Electron 45 / electron-builder 26，Windows + macOS）  
> 结论先行：**先修“数据根”，再谈“自动更新”。** 数据必须从 exe 所在目录迁到稳定的用户目录；更新优先选 **Windows NSIS + macOS DMG/ZIP + electron-updater**；如果 Windows 必须保留单文件便携 exe，再把现有 C# 启动器升级成“启动器内更新器”（macOS 没有等价“单文件免安装”形态，仍走 electron-updater）。  
> 说明：本文是基于当前代码与官方文档的方案调研，**未实际改造代码、未搭建更新服务器**；目录/清单/时序是建议实现，落地前需按第 10 节做端到端验证。

---

## 0. 五个问题的直接回答

| 问题 | 结论 |
| --- | --- |
| 安装包出来了放哪里？ | 放在**固定 HTTPS 地址的对象存储 + CDN** 上（国内首选阿里云 OSS / 腾讯云 COS），按“渠道 / 平台 / 架构”分目录：Windows 放 `latest.yml`，macOS 放 `latest-mac.yml`；客户端只读各自平台的稳定清单。GitHub Releases 只适合做海外镜像或备用源，不建议作为国内主源。 |
| 怎么通知用户可以更新？ | 不需要推送服务。客户端启动后延迟检查 + 每 6～24 小时轮询一次清单，发现新版本后在**应用内横幅 / 设置页“关于” / 托盘或 macOS 菜单栏**提示；下载完成后提示“重启并安装”。只有 App 正在运行才能弹系统通知，App 没启动时靠下次启动检查。 |
| 需要做更新界面吗？ | **需要，但只需要轻量 UI**：设置页“关于”里的版本/检查按钮 + 更新横幅 + 下载进度/重启提示 + 更新说明弹窗。不需要独立窗口或复杂页面。 |
| 用户点击更新后怎么安装、怎么重启？ | **Windows NSIS**：electron-updater 下载 Setup → 校验 → `quitAndInstall()` → NSIS 静默安装到同一 per-user 目录 → 自动启动新版本。**macOS**：electron-updater 下载签名/公证过的 ZIP → 替换 `/Applications/LightTodo.app` → 自动重启。**Windows 便携路线**：下载新版 payload → 写 `pending.json` → App 以约定退出码退出 → 启动器校验并解压到新的版本目录 → 原子切换 `state.json` → 重启；旧版本目录保留一份用于回滚。 |
| 数据还是用之前的吗？ | 是，但前提是**数据根不再跟着 exe 走**。Windows 默认改为 `%LOCALAPPDATA%\LightTodo\data`，macOS 默认 `~/Library/Application Support/LightTodo/data`；升级只替换程序目录，永不触碰数据目录；首次升级时从旧的 `LightTodoData` 做一次带校验的复制迁移，并在升级前自动备份数据库。 |

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

1. Windows 和 macOS 双平台都能更新，版本节奏一致；
2. 换版本、换目录、重装程序，都不丢用户数据；
3. Windows 不需要管理员权限；macOS 首次拖入 `/Applications` 后，后续更新不再要求用户手动操作；
4. 更新失败不能把旧版本弄坏，必须可回滚；
5. 更新包必须可校验（哈希/签名），不能被中间人替换；
6. 无网络时 App 仍可正常使用，更新检查失败要静默；
7. 国内网络可下载，更新服务器成本可控；
8. 兼容现有 Windows 便携版用户，不能要求他们手工找数据库。

**明确不做的：**

- 不做账号体系/云同步（本期只解决本机持久化）；
- 不做后台常驻更新服务（不装 Windows 服务、不写计划任务）；
- 不做强制自动安装（默认让用户确认重启）；
- 不做 Mac App Store 版本（本期按 DMG 直发设计；MAS 是另一条更新链路）。

---

## 3. 两条路线对比

| 维度 | 路线 A：Windows NSIS + macOS DMG/ZIP + electron-updater | 路线 B：Windows 单文件便携版 + 启动器自更新 |
| --- | --- | --- |
| 用户是否要安装 | Windows 装一次；macOS 把 App 拖进 `/Applications` | 仅 Windows，继续保持双击 exe |
| 更新实现 | 官方 `electron-updater`，Windows 用 NSIS，macOS 用 ZIP 载荷 | 自研：manifest + 下载 + 启动器解压切换 |
| 开发量 | 小（约 3～5 天，含双平台联调/签名） | 中（约 1～2 周，含回滚/自替换/测试），且只解决 Windows |
| 更新体积 | 支持 blockmap 差分（Windows）；macOS 用 ZIP，通常几十 MB | 默认全量 payload ~164 MB；可再做文件级差分 |
| 安装/更新权限 | Windows per-user 可免 UAC；macOS 要求 App 在可写位置（通常 `/Applications`） | 免安装，但要求 exe 所在目录可写 |
| 回滚 | electron-updater 无自动回滚，只能发更高版本；可保留旧安装包 | 可保留上一版目录，启动器可直接回退 |
| 代码签名 | Windows 需 Authenticode；macOS 必须 Developer ID + 公证（否则 Gatekeeper 拦截，且无法自动更新） | 同样需要 |
| macOS 是否适用 | **适用**，且是 macOS 唯一推荐路线 | **不适用**，macOS 没有等价“单文件免安装 exe” |
| 适用 | 大多数消费级 Windows/macOS 软件 | Windows“绿色软件/放 U 盘”是产品卖点时 |

**推荐决策树：**

```text
Windows 是否必须保持“双击 exe、不安装”？
├─ 否 → 路线 A：Windows NSIS + macOS DMG/ZIP + electron-updater（双平台首选）
└─ 是 → Windows 走路线 B；macOS 仍走路线 A（DMG/ZIP + electron-updater）
```

> 不管选 A 还是 B，**第 4 节的数据根方案都必须先做**。否则更新做得再好，用户换一个目录仍然“数据没了”。

**推荐组合（如果由我来落地）：**

1. 数据根先迁到 Windows `%LOCALAPPDATA%\LightTodo\data` / macOS `~/Library/Application Support/LightTodo/data`，旧数据一次性导入（P1，先发一个补丁版）；
2. 主分发改为 **Windows NSIS per-user + macOS DMG/ZIP + electron-updater**；Windows portable ZIP 只作为“绿色版”保留；
3. 更新文件放阿里云 OSS + CDN（海外可用 Cloudflare R2 镜像），`latest.yml` / `latest-mac.yml` 短缓存、版本文件不可变；
4. 应用内“检查更新”+ 下载进度 + “重启并安装”，灰度 5% → 25% → 100%；
5. 补代码签名：Windows OV/EV，macOS Developer ID + 公证；没有签名之前，至少做清单 Ed25519 + SHA-256 校验。

这样每次发版仍会产出新的 `LightTodo-Setup-x.y.z.exe` 和 `LightTodo-x.y.z.dmg`，但**用户不再需要自己找安装包、手动覆盖**；安装器只替换程序目录，数据目录始终不动。

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

**macOS 默认：**

```text
~/Library/Application Support/LightTodo/
  data\
    lighttodo.db
    backups\
    files\
  session\
  logs\
  updates\
  install.json
```

**便携模式（仅 Windows，显式开启，适合 U 盘）：**

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

首次运行 0.7.x 时，如果 `%LOCALAPPDATA%\LightTodo\data\lighttodo.db`（macOS 为 `~/Library/Application Support/LightTodo/data/lighttodo.db`）不存在，按以下顺序找旧数据：

1. 当前 exe 同目录的 `LightTodoData\lighttodo.db`（Windows 便携版）；
2. `%APPDATA%\LightTodo\lighttodo.db`（旧 Windows 安装版）；
3. macOS 旧 `~/Library/Application Support/LightTodo/lighttodo.db`；
4. 用户手动选择的目录（设置页“导入旧数据”）。

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

macOS 当前默认数据目录已经是 `~/Library/Application Support/LightTodo`，只是 DB 直接放在根目录、没有 `data/` 子目录；迁移时把旧库复制到 `data/lighttodo.db`，`Local Storage` 从旧 `Local Storage` 复制到新 `session/Local Storage`，然后保留旧文件一个版本周期。

### 4.4 数据分层

| 层 | 内容 | 丢失后果 | 升级策略 |
| --- | --- | --- | --- |
| 用户数据 | `lighttodo.db`、设置、模板、将来附件 | 不可恢复 | 保留、迁移、升级前备份 |
| 派生数据 | 搜索索引、统计缓存、缩略图 | 可重建 | 可删，启动时重建 |
| Chromium 数据 | `Local Storage`、`Cache`、`Code Cache`、`GPUCache` | 大多可重建；Local Storage 含 UI 偏好 | Local Storage 迁移；Cache 类可清 |
| 日志 | `startup.log`、`launcher.log` | 仅诊断 | 轮转，保留 14 天 |

**关键原则：用户数据不是缓存。** 不要把 `lighttodo.db` 放进 `Cache`、`GPUCache` 或临时目录；也不要把活动数据库放在 OneDrive/网络盘（SQLite WAL 明确不支持网络文件系统，同步客户端还可能锁文件/生成冲突副本）。

---

## 5. 路线 A：Windows NSIS + macOS DMG/ZIP + electron-updater（推荐）

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

release/mac-0.7.0/
  LightTodo-0.7.0-arm64.dmg        # macOS 首次安装
  LightTodo-0.7.0-arm64-mac.zip    # macOS 自动更新载荷
  latest-mac.yml
  LightTodo-0.7.0-x64.dmg          # Intel（如支持）
  LightTodo-0.7.0-x64-mac.zip
```

`latest.yml` 是 Windows electron-updater 的清单，`latest-mac.yml` 是 macOS 的清单；两者都包含版本、文件名、`sha512`、大小等。`.blockmap` 用于 Windows 差分下载；macOS 用 ZIP 载荷。把平台对应的清单和产物上传到同一个 HTTPS 域名的平台目录即可。

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

`quitAndInstall()` 在 Windows 上会关闭所有窗口、启动 NSIS 安装器（`--updated /S`），安装完成后按参数重启应用；在 macOS 上则替换 `/Applications/LightTodo.app` 并重启。数据目录不在安装目录里，所以安装器/替换过程不会碰它。

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
- Windows 代码签名必须做，否则 SmartScreen 会拦下载/运行；macOS 必须 Developer ID + 公证，否则 Gatekeeper 会拦，自动更新也无法工作；
- 企业环境（GPO/SCCM/Intune）应发 MSI 或 `msi-wrapped`，不要指望 electron-updater 管纯 MSI。macOS 企业分发可考虑 PKG/MDM，但这是另一条链路。

### 5.7 macOS：同一套 electron-updater 的配置

macOS 和 Windows 共用 `src/main/updater.ts` 的状态机与 UI，差异只在打包/签名：

```json
{
  "mac": {
    "target": [
      { "target": "dmg", "arch": ["arm64", "x64"] },
      { "target": "zip", "arch": ["arm64", "x64"] }
    ],
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist",
    "notarize": true,
    "artifactName": "LightTodo-${version}-${arch}.${ext}"
  }
}
```

要点：

- **DMG 用于首次安装，ZIP 用于自动更新**。electron-builder 默认的 macOS target 就是 `zip` + `dmg`，两个都要产出；只发 DMG 不会有 `latest-mac.yml`，electron-updater 无法更新。
- **必须用 Developer ID Application 证书签名，并完成 Apple 公证（notarization）**。macOS 10.15+ 上“只签名不公证”的 App 仍会被 Gatekeeper 拦截；未签名的 App 无法使用 Squirrel.Mac/electron-updater 自动更新。
- `hardenedRuntime: true`（默认）+ 正确的 entitlements（V8 需要 `com.apple.security.cs.allow-jit` 等）；`gatekeeperAssess: false` 是 electron-builder 的默认值。
- 当前 `scripts/package-mac.cjs` 只构建 **arm64**，并且 `identity: null` + ad-hoc 签名（`codesign --sign -`）。这只能本地预览，**不能作为对外分发/自动更新产物**；需要改成 Developer ID 签名 + 公证，并补 x64 或 universal。
- **安装位置**：用户应把 `LightTodo.app` 拖到 `/Applications`。从 DMG 挂载目录或 Downloads 直接运行会触发 App Translocation，更新器可能无法替换 App；首次启动时检测 `app.isInApplicationsFolder()`，不在就提示“请拖到 Applications 后再更新”。
- **架构**：Apple Silicon（arm64）和 Intel（x64）都建议出包。`universal` 包体积约翻倍；如果用户量允许，按架构分别出包更省更新流量。`latest-mac.yml` 会按构建产物生成；每个架构单独目录最清晰。
- **Mac App Store**：如果走 `mas` target，更新由 App Store 负责，不能用 electron-updater；这是另一条分发路线，不要和 DMG 直发混用。

macOS 用户点击更新后的流程与 Windows 类似，只是“安装器”变成替换 `.app`：

```text
checkForUpdates → update-available → downloadUpdate（ZIP）
→ 校验签名/哈希 → update-downloaded
→ quitAndInstall() → 关闭 App → 替换 /Applications/LightTodo.app → 重新启动
```

数据目录在 `~/Library/Application Support/LightTodo/data`，不在 `.app` 内，替换 App 不会影响数据。

### 5.8 双平台发布流水线

```text
GitHub Actions / CI matrix:
  windows-latest:
    - pnpm dist:setup        # NSIS + latest.yml
    - pnpm dist              # portable exe/zip（可选）
  macos-14:
    - pnpm dist:mac          # arm64 DMG + ZIP + latest-mac.yml
  macos-13:
    - pnpm dist:mac          # x64 DMG + ZIP（或 universal 一次构建）

上传:
  /updates/stable/win-x64/latest.yml
  /updates/stable/mac-arm64/latest-mac.yml
  /updates/stable/mac-x64/latest-mac.yml
  /updates/stable/<platform>/releases/<version>/...
```

注意：`latest.yml`（Windows）和 `latest-mac.yml`（macOS）由 electron-builder 生成，不要手写；每个平台用各自的 `publish.url`（CI 里按平台覆盖），避免客户端拿错清单。发布前在干净的 Win11 和 macOS（arm64 + Intel 各一台，或至少 arm64）上各跑一次“旧版 → 新版”升级演练。

---

## 6. 路线 B：Windows 单文件便携版 + 启动器自更新（保留绿色版）

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

### 6.8 为什么 macOS 没有“路线 B”

macOS 没有“单文件便携 exe”这个概念：

- App 是一个 `.app` bundle（目录），必须放在用户可写的位置（通常 `/Applications`）；
- DMG 只是首次安装的磁盘镜像，不能直接当“更新包”替换运行中的 App；
- 从 DMG/Downloads 直接运行会触发 App Translocation（随机只读路径），更新器无法原地替换；
- macOS 的自动更新要求 App 已用 Developer ID 签名并公证，Squirrel.Mac/electron-updater 才能替换 bundle。

所以 macOS 直接分发只有一条推荐路线：**DMG 首次安装 + ZIP 更新载荷 + electron-updater + Developer ID/公证**。如果不想维护这套签名/公证，就只能走 Mac App Store（更新由 Store 负责），但那就不是现在的 DMG 分发模式了。

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

**建议：** 主源用阿里云 OSS + CDN（`https://dl.lighttodo.cn`，需备案），GitHub Releases 做镜像；清单里配置 `mirrors`，客户端主源失败自动切换。macOS 用户如果主要在海外，建议加一个 Cloudflare R2 / 海外 CDN 镜像，或者用 Cloudflare Worker 按地区 302 到最近源；只靠国内 CDN 的海外节点，macOS 下载体验可能一般。

### 7.2 目录与缓存策略

> 下文的 `dl.lighttodo.cn`、`github.com/lighttodo/...` 都是示例，按实际域名/仓库替换。

```text
https://dl.lighttodo.cn/updates/
  stable/
    win-x64/
      latest.yml                          # Windows/electron-updater：短缓存，构建时生成
      latest.json                         # 仅 Windows 便携自定义更新器需要
      releases/
        0.7.0/
          LightTodo-Setup-0.7.0.exe
          LightTodo-Setup-0.7.0.exe.blockmap
          LightTodo-0.7.0-payload.zip     # 便携版更新载荷
          notes.md
          sha256sums.txt
        0.6.10/
          ...
    mac-arm64/
      latest-mac.yml                      # macOS/electron-updater：短缓存
      releases/
        0.7.0/
          LightTodo-0.7.0-arm64.dmg       # 首次安装
          LightTodo-0.7.0-arm64-mac.zip   # 自动更新载荷
          notes.md
          sha256sums.txt
    mac-x64/
      latest-mac.yml
      releases/
        0.7.0/
          LightTodo-0.7.0-x64.dmg
          LightTodo-0.7.0-x64-mac.zip
  beta/
    win-x64/
      latest.yml
    mac-arm64/
      latest-mac.yml
    mac-x64/
      latest-mac.yml
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
3. Windows：pnpm dist:setup（NSIS）；macOS：pnpm dist:mac（DMG + ZIP，签名 + 公证）
4. 生成/收集 latest.yml、latest-mac.yml，生成 Ed25519 签名（自定义更新器）
5. 上传版本文件（不可变路径）
6. 上传/刷新 latest.yml、latest-mac.yml（短缓存）
7. 冒烟：Windows 新机器安装/解压 → 启动 → 数据目录正确；macOS DMG 拖入 Applications → 启动 → 升级演练
8. 可选：5% → 25% → 100% 灰度
```

CI 里不要把 OSS AccessKey 写进仓库；用环境变量/密钥管理。构建产物 `release/` 已被 `.gitignore` 忽略，不要提交 164 MB 的 exe。**`release/<version>/` 只是本机构建目录，不是分发渠道**；对外分发要上传到对象存储/CDN，不要把 Git 仓库、聊天群文件或网盘当作自动更新源。

### 7.4 Windows 代码签名与 SmartScreen

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

### 7.5 成本速算

按 CDN 中国内地 0.24 元/GB、Windows 全量包 164 MB 估算：

- 1,000 次下载 ≈ 160 GB ≈ **¥38**（不含回源；含回源约 ¥40～62）；
- 10,000 次下载 ≈ 1.6 TB ≈ **¥384**（不含回源；含回源约 ¥624）；
- 存储保留 5 个版本 ≈ 1 GB，约 **¥0.1/月**，可忽略。

macOS ZIP 通常几十到一百多 MB，按同样公式单独估算。详细的按次成本表、回源费和“前期疯狂迭代”控费策略见 7.7。

### 7.6 macOS 的签名、公证与托管注意

- 需要 **Apple Developer Program**（$99/年）和 **Developer ID Application** 证书；`CSC_LINK` / `CSC_KEY_PASSWORD` 放 CI secret。
- 需要 **公证（notarization）**：electron-builder 可配置 `notarize: true`，使用 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；也可以用 `xcrun notarytool` + `xcrun stapler staple` 手动完成。只签名不公证，macOS 10.15+ 仍会被 Gatekeeper 拦截。公证完成后建议对 DMG 执行 `xcrun stapler staple LightTodo-<version>-<arch>.dmg`，离线首次安装也能通过 Gatekeeper。
- DMG 和 ZIP 都要签名/公证；**自动更新用的是 ZIP**，DMG 只负责首次安装。`latest-mac.yml` 由 electron-builder 在 zip target 下生成。
- 托管时确保 `.dmg` 的 `Content-Type` 是 `application/x-apple-diskimage`，`.zip` 是 `application/zip`；对象存储默认可能给 `application/octet-stream`，部分浏览器/下载器体验会差，但不影响 electron-updater。
- 如果同时出 arm64 和 x64，建议 `mac-arm64/` 与 `mac-x64/` 两套目录、两套 `latest-mac.yml`；不要把一个架构的清单给另一个架构用。universal 包可以只放 `mac-universal/`，但体积更大。
- Mac App Store 走 `mas` target，更新由 App Store 负责，不使用 electron-updater；不要和 DMG 直发混在同一套清单里。

### 7.7 按次更新成本测算与“前期疯狂迭代”控费

阿里云 OSS/CDN 默认都是**按量后付费**：OSS 收存储、请求、外网流出/CDN 回源流量；CDN 收下行流量（按流量计费时是阶梯价）和静态 HTTPS 请求数。用多少算多少，但要注意“单价 × 流量”之外还有回源和请求。

以下按 **2026-11 中国内地、按量付费、0～10TB 阶梯** 估算（实际以账单为准）：

| 计费项 | 单价 | 说明 |
| --- | --- | --- |
| CDN 下行流量 | **0.24 元/GB**（0～10TB） | 用户从 CDN 边缘节点下载的流量，主要成本 |
| CDN 静态 HTTPS 请求 | 每月前 500 万次免费，超出 **0.05 元/万次** | 更新检查/下载请求，通常可忽略 |
| OSS 标准存储（本地冗余） | **0.09～0.12 元/GB/月**（官网折扣价/目录价） | 保留历史版本才产生，量很小 |
| OSS CDN 回源流量 | **0.15 元/GB** | CDN 未命中时回源拉取；命中率高时远小于用户下载量 |
| OSS 外网流出（不经 CDN） | 闲时 0.25 元/GB / 忙时 0.50 元/GB | 仅当客户端直连 OSS；小流量内测可用，正式分发走 CDN 更便宜 |

**单次更新成本公式：**

```text
成本 ≈ 下载次数 × 包大小(GB) × 0.24
     + 回源流量(GB) × 0.15
     + 保留版本存储(GB) × (0.09～0.12) × 保留月数
     + HTTPS 请求费（通常 0）
```

**Windows 全量包 164 MB（≈0.16 GB）为例：**

| 实际下载次数 | 下行流量 | CDN 下行费 | OSS 回源费（最坏 100% 未命中） | 合计上限 |
| --- | --- | --- | --- | --- |
| 100 | 16 GB | ¥3.8 | ¥2.4 | **¥6.2** |
| 500 | 80 GB | ¥19.2 | ¥12.0 | **¥31.2** |
| 1,000 | 160 GB | ¥38.4 | ¥24.0 | **¥62.4** |
| 5,000 | 800 GB | ¥192 | ¥120 | **¥312** |
| 10,000 | 1,600 GB | ¥384 | ¥240 | **¥624** |

实际通常低于“最坏”列：CDN 边缘节点首次拉取后，后续用户命中缓存；1,000 次下载的回源往往只有几个 GB，实际约 **¥40～50**。

**macOS ZIP 假设 100 MB（≈0.1 GB）：**

| 下载次数 | CDN 下行费 | 说明 |
| --- | --- | --- |
| 100 | ¥2.4 | 加回源约 ¥1.5，合计约 ¥4 |
| 1,000 | ¥24 | 加回源约 ¥15，合计约 ¥39 |
| 5,000 | ¥120 | 加回源约 ¥75，合计约 ¥195 |

**“前期疯狂版本迭代”怎么避免过度消费：**

1. **开发/内测版本不要上传生产 CDN**：用 GitHub Actions artifacts、内网 HTTP 或本地更新服务器；只有 release candidate 才进 `stable`。
2. **beta 通道单独、低流量**：beta 用户少，可以走 OSS 直连或独立 CDN 域名；稳定后再合并到 stable。
3. **不要每次构建都同时上传 exe + zip + dmg + setup**：只上传客户端真正会下载的那一个平台产物；`release/` 本地保留即可。
4. **做文件级增量/差分**：164 MB → 十几 MB，是最大的省钱杠杆；Windows NSIS 的 blockmap 差分也是同理。
5. **灰度发布**：先 5% → 25% → 100%；坏版本不会让所有用户先下 164 MB。
6. **只保留最近 2～3 个稳定版本**：OSS 生命周期规则自动清理旧 `releases/*`；当前版本 + 上一版足够回滚。
7. **不要提前买大资源包**：前期用量不稳定，按量付费最灵活；等月流量稳定超过 10TB 或账单可预测时再考虑资源包。
8. **设预算告警**：费用中心设置月度预算（例如 ¥50/¥100），50%、80%、100% 告警；CDN 被刷时能及时发现。
9. **更新检查不要打 CDN 静态资源**：`latest.yml` 很小，可以放 OSS 直连或低配 CDN；真正的大文件才走 CDN。
10. **统计真实下载次数**：用 `installId` 去重，不要用“总用户数”估成本；更新 adoption 通常不是 100%。
11. **客户端默认 `autoDownload=false`**：让用户点“下载”再拉大包，避免后台自动下载把流量打满；`autoInstallOnAppQuit=true` 只影响已下载的包。

**一个直观对比：**

```text
10 次发布 × 1,000 次下载 × 164 MB 全量
= 1.6 TB × 0.24 ≈ ¥393（还不算回源）

同样 10 次发布，文件级增量 15 MB：
= 150 GB × 0.24 ≈ ¥36
```

所以前期最该做的不是“省 CDN 单价”，而是**减少每次更新的下载体积**和**不把每个内测包都推到生产 CDN**。

一个容易忽略的事实：如果只是 20 个内测用户、每天 3 个包，按 164 MB 全量算，一天流量约 `20 × 3 × 0.16 ≈ 9.6 GB`，CDN 成本约 **¥2.3/天**，一个月几十块——内测本身并不贵。真正贵的是“每个小版本都让全量用户下载 164 MB”。所以策略是：**内测随便发（走 CI/OSS 直连），稳定版才上 CDN；稳定版尽量做增量。**

### 7.8 自建服务器 vs OSS+CDN

如果已经有一台服务器，**内测/小规模阶段放自己服务器完全合理**，边际成本几乎为零。但要先看带宽，不要把“服务器已经付过钱”当成真的零成本：

| 服务器带宽 | 理论下载速度 | 164 MB 单个用户耗时 | 100 个用户顺序下载 | 适用 |
| --- | --- | --- | --- | --- |
| 5 Mbps | 0.625 MB/s | 约 4.4 分钟 | 约 7.3 小时 | 只适合几个内测用户 |
| 10 Mbps | 1.25 MB/s | 约 2.2 分钟 | 约 3.6 小时 | 小范围内测，发布日会堵 |
| 50 Mbps | 6.25 MB/s | 约 26 秒 | 约 44 分钟 | 小规模稳定版可用 |
| 100 Mbps | 12.5 MB/s | 约 13 秒 | 约 22 分钟 | 几百用户以内比较舒服 |
| 1 Gbps | 125 MB/s | 约 1.3 秒 | 约 2 分钟 | 自建很舒服 |

成本对比（示例，实际以账单为准）：

- 阿里云 ECS 固定带宽 10 Mbps：官方计费示例约 **¥525/月**；100 Mbps 会贵得多。
- 阿里云 ECS 按使用流量：示例单价 **0.8 元/GB**；1,000 次 164 MB 下载 = 160 GB ≈ **¥128**，比 CDN 的 ¥40～60 更贵。
- OSS + CDN：1,000 次 164 MB 下载 ≈ **¥40～60**（含回源），没有固定月费。

**结论：**

1. **自己服务器适合**：已有服务器、带宽 ≥50～100 Mbps、用户量不大、内测/ beta；或者服务器是海外大带宽 VPS，主要面向海外用户。
2. **OSS+CDN 适合**：发布日并发下载、用户分散、不想自己运维带宽/证书/限流；按量付费，1,000 次更新几十块。
3. **最省钱的做法是混合**：内测/beta 走自己服务器或 CI artifacts；stable 走 OSS+CDN。不要把每个内测包都推给全量用户。
4. 如果用自己的服务器做 stable 源，至少要做：HTTPS、`Range` 支持、`Cache-Control`、Nginx `limit_rate`/连接数限制、访问日志、磁盘和带宽监控；否则发布日容易被下载打满，影响服务器上的其他业务。
5. 自建服务器 + CDN 也可以：CDN 回源到你的服务器，但要注意 ECS 出网到 CDN 的流量也可能按 0.8 元/GB 计费，未必比 OSS 回源 0.15 元/GB 便宜。

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

### 8.5 双平台更新界面：需要，但不用做“大界面”

结论：**需要做，但只需要一个轻量的“更新中心”，不需要独立窗口。** 最小可用集合：

```text
设置 → 关于
┌──────────────────────────────────────┐
│ 轻单 LightTodo  0.7.0 (build 20261110) │
│ 更新通道：稳定版        [检查更新]      │
│ [✓] 自动检查更新    上次检查：2 分钟前  │
└──────────────────────────────────────┘

主窗口右下角（有新版本时）
┌──────────────────────────────────────┐
│ 新版本 0.7.0 可用 · 12.4 MB            │
│ • 数据固定保存，换版本不丢              │
│ • 支持应用内更新                       │
│ [查看更新内容]  [稍后]  [下载]          │
└──────────────────────────────────────┘
```

1. **设置 → 关于**：当前版本、构建号、渠道（stable/beta）、上次检查时间、`检查更新` 按钮、`自动检查更新` 开关；
2. **更新横幅**：有新版本时出现在主窗口右下角/顶部，不阻塞当前操作；文案包含版本号、大小、3 条更新要点；
3. **更新说明弹窗**：点击“查看更新内容”打开，展示 `notes.md` 的安全渲染结果，底部 [稍后] [下载]；
4. **下载进度**：横幅/设置页显示百分比、速度、剩余时间，可取消；
5. **重启提示**：下载完成后 [立即重启] [退出时安装]；macOS 文案可以是“重启 App 完成更新”；
6. **错误提示**：只在用户主动检查时弹出；后台检查失败静默写日志。

不需要：

- 独立“更新器窗口”或常驻更新服务；
- 复杂的版本历史页面（官网发布页即可）；
- 强制全屏广告式弹窗。

平台差异：

- **Windows**：托盘菜单加“检查更新…”；标题栏/右下角横幅；`Notification` 走 Windows Toast。
- **macOS**：App 菜单加“检查更新…”（符合 macOS 习惯），`app.setAboutPanelOptions` 里放版本/版权；横幅用同一个组件；`Notification` 走通知中心。
- 两端共用 `UpdateState` 和 React 组件，只在“安装动作”上分叉：Windows 调 `quitAndInstall()` 或启动器；macOS 调 `quitAndInstall()`。

如果完全不想做 UI，也可以只用 `checkForUpdatesAndNotify()` 弹系统通知、下载后退出时安装；但用户看不到进度/更新说明，出错也不知道，**不推荐**作为正式产品的唯一方案。

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

- **便携模式（仅 Windows）**：只有 exe 旁存在 `portable.flag` 才用 `<exeDir>\LightTodoData`；设置页明确提示“便携模式数据随目录走，换目录请手动迁移”；
- **多用户**：Windows `%LOCALAPPDATA%` / macOS `~/Library/Application Support` 都按用户隔离，天然支持多用户；共享旧目录由每个用户各自导入副本，不要搬走共享库；
- **OneDrive/iCloud Drive**：检测数据根在同步盘/网络路径时，提示“活动数据库不能放在同步盘”，建议改到本地；只把备份快照放同步盘；
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
9. 只读目录：数据仍在 LocalAppData，更新提示改用安装版；
10. 卸载：默认保留数据；重装后数据还在；
11. macOS：DMG 拖入 `/Applications` 后首次启动无 Gatekeeper 拦截；从 DMG 直接运行时提示先拖入；
12. macOS：更新只替换 `.app`，`~/Library/Application Support/LightTodo/data` 中的任务数不变。

---

## 10. 实施计划

### 10.1 分阶段

| 阶段 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| P0 | 定方案：是否接受 NSIS、是否买签名、主源域名 | 决策记录 | 0.5 天 |
| P1 | 数据根固定 + 旧数据迁移 + 设置页展示 | 0.6.11，先解决“换 exe 丢数据” | 2～3 天 |
| P2 | 更新清单 + 检查/通知 UI + 托管/上传脚本 | 能发现新版本（先不自动装） | 1～2 天 |
| P3-A | Windows NSIS + macOS DMG/ZIP + electron-updater 全链路 | 0.7.0 双平台自动更新 | 3～5 天 |
| P3-B | 仅 Windows 便携启动器自更新 + 回滚（若选 B） | 0.7.0 Windows 绿色版自动更新 | 1～2 周 |
| P4 | 文件级增量、灰度、更新统计 | 降低带宽/风险 | 2～3 天 |

**建议先发 P1**：只改数据根，不动更新。这样即使更新方案还在讨论，用户“换新 exe 数据没了”的痛点已经解决；P1 也是 P3 的基础。

### 10.2 代码改动清单（P1）

- `src/main/index.ts`：数据根解析（Windows `%LOCALAPPDATA%` / macOS `Application Support`）、`app.setPath('userData'/'sessionData')`、日志路径；
- `src/main/data.ts`：`VACUUM INTO` 备份、迁移前备份；
- `src/main/db.ts`：`application_id`、`user_version`、迁移 runner、降级保护；
- 新增 `src/main/data-root.ts`：解析/迁移/`install.json`；
- `src/main/ipc.ts` / `src/preload/index.ts`：暴露数据目录、迁移状态、选择目录；
- `src/renderer/src/components/SettingsModal.tsx`：数据目录、导入旧数据、打开目录；
- `scripts/test-*.ts`：迁移、备份、降级测试；
- `README.md` / `docs/`：更新数据目录说明。

### 10.3 代码改动清单（P3-A）

- `package.json`：`electron-updater` 进 `dependencies`，`publish` 配置，NSIS `oneClick/perMachine`；
- `package.json` 的 `mac.target` 改为 `dmg` + `zip`（arm64 + x64 或 universal），补 `entitlements.mac*.plist`、`hardenedRuntime: true`、`notarize: true`；CI 加 Apple 证书/公证 secret；
- 新增 `build/entitlements.mac.plist` / `build/entitlements.mac.inherit.plist`（V8 JIT 等）；
- `scripts/package-mac.cjs`：去掉 `identity: null`/ad-hoc，改为 Developer ID 签名 + 公证，并补 x64 或 universal；
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
- [ ] 版本号递增，Windows/macOS `checksums.json` 生成；
- [ ] Windows 清单/哈希、macOS `latest-mac.yml`/公证校验通过；
- [ ] 旧版本 → 新版本升级演练通过（Windows + macOS）；
- [ ] 回滚演练通过；
- [ ] `latest.yml`、`latest-mac.yml` CDN 缓存已刷新；
- [ ] 官网下载页读取的是同一套清单；
- [ ] 发布说明、隐私政策（如加统计）更新。

### 10.6 双平台验收清单

- [ ] Windows：NSIS per-user 安装不弹 UAC；`latest.yml` 可下载；旧版 → 新版升级后任务数不变；
- [ ] Windows：便携版更新只替换 `LightTodoApp-*`，`%LOCALAPPDATA%\LightTodo\data` 不变；
- [ ] macOS：DMG 拖入 `/Applications` 首次启动无 Gatekeeper 拦截；`spctl -a -vv` 通过；
- [ ] macOS：`latest-mac.yml` + ZIP 能被 electron-updater 识别；旧版 → 新版替换 `.app` 后数据仍在；
- [ ] macOS：从 DMG/Downloads 直接运行时提示“请拖到 Applications”，不尝试原地更新；
- [ ] 两端：无网络、哈希错误、下载中断、旧版本运行中，均有明确提示且不损坏旧版本；
- [ ] 两端：更新说明/版本号/渠道展示一致；中文文案不乱码。

---

## 11. 风险与待确认

1. **是否接受一次安装？** Windows 如果“绿色免安装”是核心卖点，选 B；macOS 没有等价形态，仍走 A（DMG + ZIP + electron-updater）。
2. **代码签名预算**：Windows 没签名 SmartScreen 会显著降低更新成功率；macOS 必须有 Apple Developer Program（$99/年）+ Developer ID + 公证，否则 Gatekeeper 直接拦截，自动更新也无法工作。
3. **域名与备案**：国内主源需要 ICP 备案；没有备案可先用 OSS 默认域名过渡，但长期建议自有域名。
4. **用户规模/带宽**：全量 164 MB（Windows）/ macOS ZIP 通常几十 MB，大规模下成本高；确定用户量后决定是否做文件级增量。
5. **旧版本兼容**：0.7.0 迁移 schema 时必须向前兼容一个版本；否则用户误开旧 exe 可能写坏数据。
6. **更新服务器可用性**：单源故障会让所有检查失败；用 CDN + 镜像 + 客户端静默重试，不要把更新检查做成启动阻塞。
7. **杀毒软件**：自解压/替换 exe 容易被误报；签名、固定发布者、少做“释放 exe 到临时目录”的动作。
8. **Windows 版本**：Electron 45 需要 Windows 10 及以上；更新清单可加 `minOS`，但不要假装支持 Win7。
9. **macOS 架构**：至少覆盖 Apple Silicon；Intel Mac 是否还要支持决定要不要出 x64/universal，直接影响构建时间和更新包体积。
10. **Mac App Store 与 DMG 直发是两条路线**：MAS 更新由 Store 负责，不能和 electron-updater 混用；先选定一条。

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
7. electron-builder v26 macOS（`zip` + `dmg` 默认 target、Hardened Runtime、entitlements、架构）  
   https://www.electron.build/v26/docs/mac
8. electron-builder v26 代码签名（macOS Developer ID + 公证要求、Windows OV/EV）  
   https://www.electron.build/v26/docs/features/code-signing
9. electron-builder v26 macOS 公证（notarization 流程）  
   https://www.electron.build/v26/docs/features/code-signing/notarization
10. electron-builder v26 Publish（generic / GitHub / S3 provider）  
    https://www.electron.build/v26/docs/publish
11. electron-builder Issue #5378：portable target 自动更新未实现  
    https://github.com/electron-userland/electron-builder/issues/5378
12. SQLite WAL（网络文件系统不支持；`-wal` 是数据库持久状态的一部分）  
    https://www.sqlite.org/wal.html
13. SQLite PRAGMA（`user_version` / `application_id` / `synchronous` / `wal_checkpoint`）  
    https://www.sqlite.org/pragma.html
14. SQLite `VACUUM INTO`（一致快照备份）  
    https://www.sqlite.org/lang_vacuum.html
15. SQLite Backup API  
    https://www.sqlite.org/backup.html
16. SQLite Over a Network（不要把活动库放网络盘）  
    https://www.sqlite.org/useovernet.html
17. Microsoft Known Folder（Roaming vs Local AppData）  
    https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid
18. Microsoft Artifact Signing Quickstart（Public Trust 地区限制）  
    https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
19. Microsoft SmartScreen（信誉判定）  
    https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
20. Microsoft `MoveFileEx`（`MOVEFILE_DELAY_UNTIL_REBOOT` 限制）  
    https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa
21. Microsoft “Moving and Replacing Files”（文件必须先关闭）  
    https://learn.microsoft.com/en-us/windows/win32/fileio/moving-and-replacing-files
22. Tauri v2 Updater（静态 JSON + minisign 签名，作为跨框架参考）  
    https://v2.tauri.app/plugin/updater/
23. Squirrel.Windows（`app-<version>` + `Update.exe`，已不推荐）  
    https://github.com/Squirrel/Squirrel.Windows
