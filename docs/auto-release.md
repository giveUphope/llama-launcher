# 自动发版工作流

> 范围：Windows runner 远程打包 .exe + 自动创建 GitHub Release。
> 索引：[README.md](../README.md) · 相关：[ci-cd.md](ci-cd.md) · [packaging.md](packaging.md)

release.yml 由 ci.yml 的 bump job 通过 `gh workflow run release.yml -f version="vX"` 触发，也可在 GitHub 上手动 workflow_dispatch 输入版本号。

---

## 1. 触发方式

- **自动触发**：push main → ci.yml verify 通过 → bump job 自动递增版本并 `gh workflow run release.yml -f version="vX"`
- **手动触发**：GitHub → Actions → release → Run workflow → 输入版本号（如 v0.0.19）

---

## 2. 工作流步骤

- **Runner**：windows-latest（Windows 打包必须，linux 无法生成 .exe）
- **步骤**：

| # | 步骤 | 说明 |
|---|------|------|
| 1 | actions/checkout@v7 (ref: vX) | 检出对应版本的 tag |
| 2 | pnpm/action-setup@v5 + actions/setup-node@v7 | 环境准备（Node 24, pnpm 11.21.0） |
| 3 | pnpm install --frozen-lockfile | 安装依赖 |
| 4 | pnpm build | 构建所有包 |
| 5 | pnpm dist | electron-builder portable 打包，输出到 release/ |
| 6 | Get-ChildItem -Recurse release/ | 诊断步骤，打印产物列表 |
| 7 | 读取 package.json 中的版本 | `V=$(node -p "...")` |
| 8 | softprops/action-gh-release@v3 | 创建 GitHub Release + 上传 .exe |

> Windows runner 上 turbo daemon 与 vite 8（rolldown）的 stdout 管道存在挂死竞态（构建产物已生成但进程不退出），`pnpm build` / `pnpm dist` 均设置 `TURBO_DAEMON: "false"` 并加 20 分钟超时兜底，挂死时快速失败而非空耗。

---

## 3. 打包输出

pnpm dist 通过 [scripts/dist-with-fallback.cjs](../scripts/dist-with-fallback.cjs) 调用 electron-builder，自动处理 release/ 目录文件锁定（Defender / 索引器 / 资源管理器占用时回退到 release-tmp-* 临时目录再回迁）。详见 [packaging.md](packaging.md)。

electron-builder 产物文件名 = `llama.Launcher.{version}.exe`（productName「llama Launcher」中的空格在文件名中为点号；**版本号完整保留，不做 trailing-zero 剥离**——实证：远端 v0.0.8/v0.0.9/v0.0.10 产物名分别为 `llama.Launcher.0.0.8.exe` / `0.0.9.exe` / `0.0.10.exe`）。

Release tag 保持完整版本号（如 v0.0.19，非零填充），与产物文件名一致（均保留完整版本号）。

---

## 4. Release 资产上传

softprops/action-gh-release@v3 的 files 字段使用通配符 `release/*.exe`，而非精确路径 `release/llama.Launcher.0.0.19.exe`。

原因：产物文件名 = `llama.Launcher.{version}.exe`（版本号随 bump 递增，精确路径需每次改 workflow），通配符免维护且兼容未来版本。

**正确配置**：

```yaml
- uses: softprops/action-gh-release@v3
  with:
    tag_name: v${{ steps.ver.outputs.v }}
    generate_release_notes: true
    files: release/*.exe
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

---

## 5. 远端打包可行性总结

| 环节 | 本地 | 远端 (GitHub Actions) |
|------|------|----------------------|
| pnpm install | ✅ | ✅ |
| pnpm build | ✅ | ✅ |
| pnpm dist（.exe） | ✅ | ✅（需 windows-latest runner） |
| GitHub Release | ❌ | ✅ |
| 签名（signAndEditExecutable: false） | 跳过 | 跳过（无需签名） |

Windows .exe 打包可在远端 windows-latest runner 上完整完成，无需本地 Windows 机器。
