# 打包配置 (electron-builder.config.cjs)

> 范围：electron-builder 打包配置：钩子机制、输出目录锁定回退、图标注入、常见故障、版本一致性检查清单。
> 索引：[README.md](../README.md) · 相关：[workflow.md](workflow.md) · [core-modules.md](core-modules.md)

- **appId**：`com.llama-launcher.app`
- **productName**：`llama Launcher`
- **输出目录**：`../../release`（临时改到 `release-fixed` 等目录绕过文件锁后，必须恢复并清理）
- **asar**：启用，仅打包应用本身，不打包 llama.cpp 二进制

### 11.1 beforePack / afterPack 钩子

pnpm workspace 在 Windows 上默认使用 **junction（目录联接）** 链接 `node_modules/@llama-launcher/{core,shared}` 到 `packages/{core,shared}`。electron-builder 打包时若直接跟随 junction，会把 `src/`、`tests/`、`.turbo/`、`tsconfig` 等开发资源一并打入 asar，导致运行时加载到**过时的 `shared/dist`**，进而出现 `Attempted to register a second handler for 'undefined'` 等 IPC 注册错误，应用启动后窗口无法显示。

此外，当使用 `shamefully-hoist=true` 或打包失败后未正确恢复时，`apps/desktop/node_modules/@llama-launcher/{core,shared}` 可能出现**损坏/循环符号链接**（`fs.existsSync` 返回 `false`，`realpath` 抛 `ELOOP`）。beforePack 同样需要检测并移除这类链接。

修复方案在 [`scripts/before-pack.cjs`](../scripts/before-pack.cjs) 与 [`scripts/after-pack.cjs`](../scripts/after-pack.cjs)：

1. **检测链接与损坏链接**：`fs.lstat().isSymbolicLink()` 在 Windows 上对 junction 返回 `false`，因此结合 `fs.realpathSync(pkgPath)`（结果不同则判定为有效链接）与 `fs.lstatSync` + `fs.existsSync`（存在 symlink 但 `existsSync` 为 false 则判定为损坏/循环链接）。
2. **确定来源**：若 `apps/desktop/node_modules` 中的包无效，回退到 `node_modules/@llama-launcher/<pkg>`（root），再回退到 `packages/<pkg>`，确保始终能拿到最新的 `dist/` 与 `package.json`。
3. **替换为 dist-only 真实目录**：删除原链接/目录，新建真实目录，仅放入 `package.json` 与 `dist/*.js`（排除 `.map` / `.d.ts` / `.d.ts.map`）。如果原路径已是真实目录，同样清空 `dist/` 并重新同步，确保使用最新构建产物。
4. **记录映射**：`.pack-link-map.json` 记录每个包原本是否为链接及用于恢复的目标路径。
5. **afterPack 恢复**：打包完成后读取映射，删除临时真实目录，恢复 junction（Windows）或 symlink（其他平台）。若原目标已无效，回退到 root `node_modules/@llama-launcher/<pkg>`，避免破坏 pnpm 开发环境。

### 11.2 打包前清理

[`scripts/clean-before-pack.cjs`](../scripts/clean-before-pack.cjs) 负责：

- 关闭指向 `release/` 的文件资源管理器窗口（通过 COM `Shell.Application` 检测并 `Quit()`），防止 Explorer 将目录作为工作目录持有句柄。
- 尝试删除 `release/` 目录。当目录被 Defender/索引器的文件系统过滤驱动锁定时，程序化重试无法突破，脚本采用 **2 次重试 × 3 秒间隔**（不浪费用户时间），并在 `fs.rmSync` 失败时通过 **重命名 + `cmd rd /s /q`** 绕过 `mmap` 句柄。
- **终极容错**：若删除失败则尝试将 `release/` 重命名为 `release_stuck_<timestamp>` 并新建空目录。若重命名也失败（系统进程锁定），不报错而是以 info 日志提示将走 fallback，交由 `dist-with-fallback.cjs` 的临时目录机制处理。
- 清理历史遗留的临时输出目录（`release2`、`release3`、`release-fixed`、`release-1.3.0-backup`）以及 `dist-with-fallback.cjs` 产生的 `release-tmp-*`。

`pnpm dist` 通过 [`scripts/dist-with-fallback.cjs`](../scripts/dist-with-fallback.cjs) 在打包前自动调用本脚本，无需手动执行。

### 11.3 输出目录锁定回退 (dist-with-fallback.cjs)

即使经过 `clean-before-pack`，在 electron-builder 实际写入时 `release/` 仍可能被 Defender、IDE、文件资源管理器或残留句柄锁定，导致 `The process cannot access the file because it is being used by another process` 错误。

[`scripts/dist-with-fallback.cjs`](../scripts/dist-with-fallback.cjs) 包装 electron-builder，提供自动回退：

1. **预清理**：调用 `clean-before-pack.cjs` 处理进程终止、Explorer 窗口关闭与目录清理。
2. **锁定检测**：在启动 electron-builder 前通过尝试**重命名 `release/` 目录**探测是否被锁（目录内可写不代表整体可替换，例如 `app.asar` 被占用时仍可创建 probe 子目录）；重命名成功后再恢复原名，不会破坏 `clean-before-pack` 已准备好的空目录。若重命名失败，说明目录整体被锁（通常是 Defender/索引器的文件系统过滤驱动），自动生成 `release-tmp-<timestamp>` 作为替代输出目录。
3. **临时配置**：生成临时的 `electron-builder.tmp-<timestamp>.yml`，仅修改 `directories.output`，其他配置保持不变；打包完成后立即删除临时配置。
4. **产物回迁**：打包成功后尝试将临时目录中的产物移回 `release/`。普通 `fs.renameSync` 在目标目录被锁时会失败，Windows 下会按目标类型分别回退：
   - **目录**：使用 `robocopy /MIR` 直接覆盖目标目录内的文件（无需先删除目录），绕过 Defender/索引器持有的句柄；覆盖成功后删除源目录。
5. **最终摘要**：无论使用主目录还是 fallback，成功时打印 `BUILD SUCCEEDED` 摘要（含输出路径与 portable exe 路径），失败时打印 `BUILD FAILED`。

### 11.4 图标注入与版本信息

`signAndEditExecutable: false` 跳过 electron-builder 自带的签名/资源编辑，避免本机 app-builder 工具链解包符号链接失败。但这也导致主程序 exe 的 **VS_VERSION_INFO 版本资源保持 Electron 默认值**（ProductName/FileDescription=Electron、OriginalFilename=electron.exe、版本号为 Electron 版本），任务管理器"应用名称"列与 exe 属性会显示 Electron。`scripts/after-pack.cjs` 在 afterPack 阶段补齐：

1. **版本资源（resedit）**：用 `resedit`（纯 JS，root devDependency）重写 `VS_VERSION_INFO`——`FileVersion`/`ProductVersion` 写入应用版本（取自打包 appInfo，即 package.json 版本，与 `APP_VERSION` 同步），`FileDescription`/`ProductName`/`OriginalFilename` 写入应用名与主程序名。
2. **图标**：调用 [`scripts/inject-icon.cjs`](../scripts/inject-icon.cjs)，以**同字节长度原地覆写**方式把 `apps/desktop/resources/icon.ico` 注入主程序 exe 的 `RT_ICON` 资源。

顺序固定：先 resedit 重写版本资源（重建 PE），再 inject-icon 原地覆写图标（字节级解析，对 resedit 产出的标准 PE 同样适用）。

### 11.5 常见打包故障

| 现象 | 根因 | 处理 |
|------|------|------|
| 启动后无窗口，stderr 出现 `Attempted to register a second handler for 'undefined'` | asar 中的 `shared/dist` 过旧，缺少新增 IPC 通道 | 确保 beforePack 正确替换 junction，且 `pnpm build` 已重新生成 `shared/dist` |
| `The process cannot access the file because it is being used by another process` | 旧进程或 Defender 占用 `release/` | `pnpm dist` 会自动调用 `dist-with-fallback.cjs`，在锁定时切换到 `release-tmp-<timestamp>` 并在打包后尝试回迁；仍失败时关闭占用 `release/` 的程序 |
| `release/` 无法删除/重命名 | 外部句柄锁定（常见于已运行的 `llama Launcher*.exe` 或 Defender/索引器） | clean-before-pack 会通过 PowerShell 终止所有 `llama Launcher*.exe` 进程、关闭指向 release/ 的 Explorer 窗口，然后尝试删除；若仍失败则尝试重命名为 `release_stuck_*` 并新建 `release/`；若重命名也失败则 dist-with-fallback.cjs 自动切换到 `release-tmp-*` 临时目录并在打包后通过 robocopy/copyFile 回迁。这是预期行为，打包仍能成功完成。 |
| `open ...\node_modules\@llama-launcher\core\package.json: The name of the file cannot be resolved by the system` | `apps/desktop/node_modules/@llama-launcher/{core,shared}` 为损坏/循环符号链接 | 运行 `pnpm install` 重建链接；before-pack 现在会自动检测并移除损坏链接，回退到 root `node_modules` 作为来源 |
| 根目录 `package.json` 被覆盖成 desktop 的 package.json | workspace root 配置丢失，导致 `pnpm lint` 等命令失效 | 从 desktop package.json 区分：root 应包含 `scripts.dev/build/lint/test`、`packageManager` 与 `turbo` |

### 11.7 版本一致性（自动化）

版本号同步由 [`scripts/bump-version.cjs`](../scripts/bump-version.cjs) 自动处理：`node scripts/bump-version.cjs [patch|minor|major]` 会同时更新 `package.json`（root + desktop）、`APP_VERSION`（`definitions.ts`）、`CHANGELOG.md` 版本节，以及 `docs/packaging.md` / `README.md`（仓库根唯一 README）/ `AGENTS.md` 中提到的输出文件名与版本号。

每次 `push` 到 `main`（含 PR 合并事件）由 GitHub Actions `ci.yml` 的 `bump` job 自动执行 patch 递增 + 打 tag + 触发 `release.yml` 打包 `.exe` 并创建 GitHub Release（详见 [ci-cd.md](ci-cd.md) / [auto-release.md](auto-release.md)）。

**需人工维护的项**：

- `CHANGELOG.md [Unreleased]` 下的具体变更条目（脚本只生成版本标题）
- `docs/params/` 下的基线文件与参数对照表（二进制升级后按 §5.5 流程重走）
- 本地手动 bump 时确认版本号符合 SemVer 语义

**electron-builder 输出文件名注意**：electron-builder 会规范化版本号，剥离 SemVer trailing zeros（如 `0.0.21` → `0.0.5`）。Release tag 保持完整版本号（`v0.0.21`），`.exe` 文件名（`llama Launcher 0.0.5.exe`）与 tag 不严格对应，这是预期行为。

### 11.6 版本一致性检查清单

升级版本时，至少同步以下位置：

- `apps/desktop/package.json` 的 `version`
- `package.json`（workspace root）的 `version`
- `packages/shared/src/params/definitions.ts` 中的 `APP_VERSION`（侧边栏版本显示来源）
- `packaging.md`（本节）、`AGENTS.md`、`README.md` 中提到的输出文件名 / 版本
- `CHANGELOG.md` 新增版本节
