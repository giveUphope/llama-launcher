# 自动发版工作流

> 范围：Windows runner 远程打包 .exe + 自动创建 GitHub Release。
> 索引：[README.md](README.md) · 相关：[ci-cd.md](ci-cd.md) · [packaging.md](packaging.md)

release.yml 由 ci.yml 的 bump job 通过 `gh workflow run release.yml -f version="vX"` 触发，也可在 GitHub 上手动 workflow_dispatch 输入版本号。

---

## 1. 触发方式

- **自动触发**：push main → ci.yml verify 通过 → bump job 自动递增版本并 `gh workflow run release.yml -f version="vX"`
- **手动触发**：GitHub → Actions → release → Run workflow → 输入版本号（如 v0.0.05）

---

## 2. 工作流步骤

- **Runner**：windows-latest（Windows 打包必须，linux 无法生成 .exe）
- **步骤**：

| # | 步骤 | 说明 |
|---|------|------|
| 1 | actions/checkout@v4 (ref: vX) | 检出对应版本的 tag |
| 2 | pnpm/action-setup@v4 + actions/setup-node@v4 | 环境准备（Node 20, pnpm 10.12.1） |
| 3 | pnpm install --frozen-lockfile | 安装依赖 |
| 4 | pnpm build | 构建所有包 |
| 5 | pnpm dist | electron-builder portable 打包，输出到 release/ |
| 6 | Get-ChildItem -Recurse release/ | 诊断步骤，打印产物列表 |
| 7 | 读取 package.json 中的版本 | `V=$(node -p "...")` |
| 8 | softprops/action-gh-release@v2 | 创建 GitHub Release + 上传 .exe |

---

## 3. 打包输出

pnpm dist 通过 [scripts/dist-with-fallback.cjs](../scripts/dist-with-fallback.cjs) 调用 electron-builder，自动处理 release/ 目录文件锁定（Defender / 索引器 / 资源管理器占用时回退到 release-tmp-* 临时目录再回迁）。详见 [packaging.md](packaging.md)。

electron-builder 会规范化版本号（SemVer trailing zeros 剥离）：

| 应用版本 | electron-builder 输出文件名 |
|----------|---------------------------|
| 0.0.05 | llama Launcher 0.0.5.exe |
| 0.0.10 | llama Launcher 0.0.1.exe |

Release tag 保持完整版本号（如 v0.0.05），与 .exe 文件名不严格对应，这是 electron-builder 的预期行为。

---

## 4. Release 资产上传

softprops/action-gh-release@v2 的 files 字段使用通配符 `release/*.exe`，而非精确路径 `release/llama Launcher X.Y.Z.exe`。

原因：
1. .exe 文件名中的空格会导致 glob 匹配失败
2. 实际输出文件名受 electron-builder 版本规范化影响，与 tag 版本号位数不同

**正确配置**：

```yaml
- uses: softprops/action-gh-release@v2
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
