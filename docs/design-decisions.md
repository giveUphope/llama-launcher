# 关键设计决策

> 范围：关键设计决策与取舍记录。
> 索引：[README.md](../README.md) · 相关：[architecture.md](architecture.md)

1. **参数发射规则（2026-08-29 重构，取代旧 `_enabled` 启用机制）**：参数无独立启用/禁用状态——值 ≠ 默认值才发射 flag（checkbox 勾选发 `flag`、取消发 `invert_flag`（无常开标志的开关取消时不发射）、空串跳过、依赖门控），命令行只含用户实际调整过的参数。旧版 `_enabled` JSON 编码显式记录启用状态的方案已移除：独立启用态造成"值 / 启用位 / 默认值"三份事实源，且与"预设 = 纯值快照"的双轨模型冲突（`buildCommand` 读到 legacy `_enabled` 直接忽略）。
2. **GGUF 智能建议**：流式读取（64KB 块）+ LRU 缓存（上限 32），内存恒定且避免重复解析。
3. **安全 IPC**：`contextBridge` + `contextIsolation` + `clonePlain` 序列化，渲染进程无 Node 访问。
4. **跨版本兼容**：通用 listening 检测（匹配 "listening" + "http"/"server"）+ 用户选择目录内联检测 llama-server。
5. **断点续传下载**：Range header + append 写入，支持大模型中断后续传。
6. **窗口几何持久化**：`x,y,width,height` 新格式 + `WxH` 旧格式兼容，500ms 防抖保存。
7. **生产热重载**：`LLAMA_DEV_SERVER_URL` 逃生口，生产构建也可连接本地 Vite dev server。
8. **进程树清理**：Windows `taskkill /F /T /PID` 杀整个进程树，防止子进程残留。
9. **IPC 四层同步**：`ipc.ts` → preload → handlers → `env.d.ts`，由 `verify-ipc-sync.cjs` 校验一致性。
10. **打包防泄漏**：beforePack/afterPack 钩子处理 pnpm 符号链接，确保 asar 中仅含 `dist/*.js` 运行时文件，排除源码、测试、配置等开发资源。
11. **动态预设目录**：预设文件存储在模型目录下 `presets/` 子目录，与模型文件集中管理，避免文件分散。
12. **打包健壮性**：Windows junction 通过 `realpathSync` 检测、重试 + `rename+rd` 清理锁文件、afterPack 恢复 junction，保证开发环境与生产包都不被污染。
13. **可注入网络传输**：`DownloadTransport` / `HfHttpTransport` 接口允许 Electron 主进程注入基于 `net` 模块（Chromium 网络栈）的传输，规避 Electron 内置 Node 的 BoringSSL TLS 指纹被 hf-mirror.com 拒绝的问题。仅 `hf-mirror.com` 走注入传输，其余源（ModelScope 等）继续走 `node:https`，保持单测 mock 兼容。
14. **在线性能实测（2026-09-04 已随「性能测试」功能整体移除，本条留存备查）**：`llama-bench` 等 CLI 不支持 DFlash/推测解码评测，故性能测试采用运行中 llama-server 的 `--metrics` 端点 + completion `timings`（与日志 `draft acceptance` 同源），通过主进程 `net` 模块发 HTTP（无 CORS 限制）读取真实吞吐与 DFlash 接受率。
15. **服务重启竞态规避**：统一走 `Launcher.restart()`（等旧进程 exit 后启动新进程），避免手动 stop→start 的 `already running` 竞态。（原 UI 侧 `waitRunning` 两阶段等待已随性能测试功能移除，2026-09-04；重启竞态防护现由 `Launcher.restart()` 单点承担。）
16. **依赖联动清理**：`syncDependencies` 按 `dependsOn` 声明自动清理依赖不满足的下游参数（防止残留 `-md`/`--mirostat-lr` 等无效 flag 发射），并区分外部草稿类型（draft-simple/eagle3/dflash/dspark）与 MTP/ngram 的依赖范围。
17. **DFlash 自动检测**：模型切换时检测同目录 dflash 草稿模型，自动配置 `draft-dflash` + `-fa on` + n_max 15（对齐 Muse-Glimmer DFlash 每 block 16 位置语义），切回外部草稿类型时自动重新检测填入路径。
18. **内存参数基线（实测驱动）**：`cache_type_k/v`（q8_0）、`load_mode`（none）、`fit`（off）、`kv_unified`（off，经 `invert_flag` 恒发射 `--no-kv-unified`）作为**基线推荐默认值**内建——在"值 ≠ 默认值才发射"规则下天然下发。依据 `docs/archive/experiments/plan-kv-split-cli-test.md`（AMD 7900 XTX 24GB + b10429 Vulkan 实测）：f16 KV + mmap + fit on 的长上下文组合会吃满 32GB 系统内存冻结；q8 KV 使 27B@262K 显存需求从 ~35GB 降至 ~25.7GB，`--load-mode none` 加载后释放权重宿主缓冲，`--fit off` 规避显式 ctx/ngl 时 fit 中止的劣化（25.7 vs 36.6 tok/s）。
19. **KV 分层机制不暴露（`-cram`/`-kvu`/`--cache-idle-slots`）**：实测 AMD 驱动 GTT 透明换页先于 llama.cpp 的 KV 内存分层接管显存溢出（`-cram 0` 与 `8192` 行为完全一致），故暂不加入 UI；未来若支持 NVIDIA 卡（分配失败不换页）再按需暴露。
20. **负面参数清单（实测不建议）**：`-nkvo`（KV 全内存：混合架构模型实测慢 2.7x 且输出乱码）、密集模型部分 `-ngl` 分层（实测慢 4.7x，应全量或 MoE 用 `-ncmoe`）、大 `-ub`（峰值内存 4.4x + 解码 -46%，保持默认 512）。
21. **双轨参数逻辑（2026-08-29，经用户确认）**：参数编辑分两轨——**临时轨道**自动持久化到 `settings.session_values` + `session_baseline`（800ms 节流，跨重启恢复，不碰预设文件，免"改完忘存"）；**预设轨道**仅显式保存写入 `<models_dir>/presets/*.json`。`hasChanges`（改动行橙描边 / 侧栏橙点）相对会话基线 `SessionBaseline { preset_name, values }` 逐键计算，不再依赖"对比出厂默认"的粗粒度判断。
22. **切模型防丢确认 + 基线可视化（2026-08-29，经用户确认）**：切换模型 / 应用 GGUF 建议参数前检测未保存修改，`confirmDiscardDirty` 确认后重建临时基线（防静默丢失）；基线状态原由 `BaselineBadge` 双入口展示（参数页顶部 + 服务页状态卡；2026-09 状态卡自服务页迁入概览 `ServiceStatusCard`，徽章随迁；2026-09-03 徽章作为冗余提示整体移除，「恢复基线」入口保留在参数页状态条），支持就地「恢复基线」与「清除会话」，用户不必进入参数页即可感知"当前参数偏离了哪个基线"。
