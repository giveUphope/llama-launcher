# 更新日志

本项目所有显著变更都记录在此文件。版本遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [Unreleased]

## [0.0.06] - 2026-08-20


## [0.0.05] - 2026-08-20

### 修复

- **顶部模型快捷选择下拉栏聚焦样式异常**：打开下拉栏后点击「管理模型…」条目，其焦点描边环呈现"上半圆弧、下半平直"的非对称形状，与下方分割线叠加后下半部分风格不统一。双重根因：①全局 `:focus-visible` 规则设置了 `border-radius: var(--radius-control)`，会覆盖元素自身圆角（且鼠标点击也会命中）；②`.manage` 条目自身是「上圆角、下方角」的非对称圆角 `pill/0/0`，焦点环跟随该形状渲染即暴露不对称。修复：①焦点环只负责 `box-shadow` 描边、不再改 `border-radius`，由各元素自身样式决定形状；②`.manage` 改为统一 `--radius-control` 圆角，焦点环各边一致，仍靠斜体/次级色/分割线维持头部语义。
- **下载重复任务：同文件被多次加入下载队列**：已存在下载任务时，用户切换到其他页面再回到下载页、重新解析 URL 并点击其他文件后，「下载选中」会把推荐文件与用户点击的文件一并提交，导致同一文件被创建第二个下载任务。修复：①`onDownloadSelected` 新增三层校验——
  1. Store 去重：检查 `modelId + filePath` 是否已有任务，`completed`/`queued`/`downloading`/`paused` 均跳过并自动取消勾选，`canceled`/`error` 允许重新下载；
  2. 本地文件检测：通过 `system:fileExists` 检查目标路径是否存在同名文件，存在则跳过并自动取消勾选；
  3. 后端 `startDownload` 按 `localPath` 去重，命中时返回已有任务 ID，UI 侧移除重复本地任务。
  跳过文件时汇总提示用户原因（已在队列中/已完成/本地已存在）。
- **取消下载后 jsonl 日志残留与任务列表残留**：用户点击取消后，磁盘上仍残留 `.llama_dl.jsonl`，且被取消的任务仍显示在任务列表中。三重根因：①`cancelDownload` 拦截 `error` 状态提前返回，未清理文件；②`downloadWorker` 在段下载完成后无条件调用 `logSegmentDone` 写 `.jsonl`，该写入可能发生在取消逻辑之后，**覆盖取消时已删除的日志**；③`executeDownload` 在 `task.status !== 'downloading'` 时未区分取消/暂停路径，未清理残留；④UI store 对 `canceled` 状态仅更新任务状态、不从列表移除。修复：
  1. `cancelDownload` 允许 `error` 任务进入清理；`activeCount` 用 `prevStatus` 精确判断，仅 `downloading` 递减；
  2. `downloadWorker` 在 `logSegmentDone` 前检查 `status === 'downloading'`，取消/暂停后不写入；
  3. `executeDownload` 中断时仅在取消路径删除 `.jsonl` 与 `.part`（暂停保留以支持续传）；
  4. UI store 取消时**立即从列表移除**（不依赖异步 onProgress），后端 `onProgress` 事件作为兜底移除
- **下载未完成文件被模型管理提前检出**：下载过程改为写入 `<file>.part` 临时文件（`DownloadTask.partPath`），完整性校验通过后同目录改名成最终 `.gguf`。未完整下载的文件不再以 `.gguf` 出现，模型列表不会出现无法运行的损坏模型，模型目录监听也不会在下载期间反复触发；旧版本残留的未完成 `.gguf` 在续传时自动迁移为 `.part`。暂停/取消/续传语义不变（暂停保留 `.part` 与日志，取消清理 `.part` 与日志）。

### 增强

- **模型删除按目录内容智能取舍**：`models:remove` 由「递归删除整个模型目录」改为「按模型文件删除」。删除前判断模型所在目录：存在其他量化版本、用户创建的非 gguf 文件或子目录时**仅删除选中的量化版本**，保留其他内容；目录无其他内容时才连同相关伴随 GGUF（mmproj/mtp/dflash 草稿）与空目录一并删除。预设清理相应分支：整目录移除时按目录前缀匹配（覆盖该目录所有模型/伴随文件引用的预设），仅删文件时按文件路径匹配（不误删引用其他量化版本的预设）。

## [0.0.01] - 2026-08-21

### 变更

- **版本号重置**：版本从 1.4.5 重置为 0.0.01，重新开始计数。

### 新增

- **`--reasoning-effort` 推理力度参数**：thinking 子分组新增"推理力度"下拉，给聊天模板指定推理力度等级（`default`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`，空=不发送）；依赖思考模式非 `off`。
- **`--kv-unified` 统一 KV 缓存开关**：kv_cache 子分组新增"统一 KV 缓存"复选框（`--kv-unified` / `--no-kv-unified`）；默认关闭并纳入基线启用参数（初始化即下发 `--no-kv-unified`，应对槽位数 auto 时后端默认开启的整块共享缓存占用），需要时勾选启用。

### 变更

- **参数基线更新至 llama.cpp b10502**：重新固定 `docs/params/llama-server-help-out.txt`（flag 集合 414→415，新增 `--reasoning-effort`，无移除）；`--load-mode` 后端默认 `mmap`→`auto`（新增 auto 模式），应用默认保持实测推荐的 `none` 不动；应用 55 个 flag 全部存在于新 help，无缺失。

### 增强

- **性能测试单并发 + 多并发一体执行**：一次「运行测试」依次执行单并发（1 个请求）与多并发（并发数跟随 `-np`/parallel 值，>1 时取该值否则默认 4，上限 8）两个场景，历史表每次追加两条记录（多并发行带 `×N` 后缀，部分请求失败时标注失败数）；多并发场景聚合各成功请求的 tok/s 求和（多槽聚合吞吐）与 token 总数，部分失败时聚合其余成功请求、全部失败则整次测试报错。不新增任何测试按钮或控件。

## [1.4.4] - 2026-08-16

### 新增

- **关闭窗口应用内弹窗**：`close_behavior=ask` 的首次询问与"模型服务运行中退出"二次确认改用应用内自定义弹窗（毛玻璃风格，替代 Electron 原生 dialog）。主进程窗口 close 拦截后经 IPC 请求渲染进程弹窗（`CloseDialog.vue`），用户选择回传主进程执行退出/托盘；渲染进程不可用时 10s 超时兜底（ask 默认托盘、退出确认默认取消）。
- **llama.cpp 引擎获取引导**：设置页引擎卡片更名"llama.cpp 引擎"，卡片标题行新增帮助图标（悬浮显示按步骤引导：打开发布页 → 按显卡选 zip → 解压 → 设置引擎目录），面板底部提供发布页跳转按钮（`openExternal`）；引导文案基于 llama.cpp releases 实际资产命名（cuda/rocm/vulkan/cpu、x64/arm64）梳理。
- **模型下载 URL 会话历史**：URL 输入框在本次运行内临时保存用户提交解析的 URL（去重、最多 10 条、最新在前），点击空白输入框时在下方弹出历史列表，点击即回填并重新解析；应用退出（进程结束）自动清空。
- **窗口启动默认最大化**：每次启动固定以最大化窗口呈现（不再受 `window_maximized` 保存值影响；字段仍保存以兼容旧数据）。
- **推测解码草稿数联动**：选择投机采样类型（`spec_type`）时自动应用该类型的推荐最大草稿数（`--spec-draft-n-max`：draft-simple/eagle3/dspark=8、dflash=15、mtp=5、ngram-=5）并启用；保持 `n_min ≤ n_max`（切换类型或手动调小 `n_max` 时钳制 `n_min`）；关闭推测解码时清空草稿数。
- **删除模型同步清理关联预设**：`models:remove` 删除模型子目录/文件后，自动删除 model 路径以被删路径开头的预设文件（`<models_dir>/presets/*.json`，分隔符兼容）。

### 修复

- **托盘右键菜单位置**：菜单底缘精确对齐托盘图标上缘（按菜单项数估算高度，替代固定 57px 估算——原估算远小于实际高度导致菜单压住图标/任务栏）；按图标所在显示器工作区钳制，上方放不下时回退到图标下方。
- **dev 退出显示 Failed**：托盘退出后 vite/tsc 被 `concurrently -k` 强杀以非 0 码退出导致 turbo 报 Failed；改为 `concurrently --success first`（以 Electron 退出码 0 为准）+ 根 `dev` 只跑 desktop 包（消除 turbo 双重 vite 与挂起）。
- **打包 exe 进程名显示 Electron**：`signAndEditExecutable: false` 跳过 rcedit 导致 exe 的 `VS_VERSION_INFO` 保持 Electron 默认（ProductName/FileDescription=Electron、版本号 33.x）；`after-pack.cjs` 用 resedit（纯 JS）重写版本资源为 llama Launcher + 应用版本，图标注入保持原有策略。
- **参数项悬浮提示不显示**：① `ParamRow :deep(.tooltip-host)` 与 6 个参数控件 `.label-col` 的 `overflow: hidden` 裁切向上弹出的 tooltip（已移除，省略号由 `.label-text` 承担）；② Electron 窗口默认 `backgroundThrottling` 在窗口被遮挡/最小化时冻结定时器与 rAF，ToolTip 500ms 延迟与进入动画卡住（已设 `webPreferences.backgroundThrottling: false`）。
- **dev 热重载启动即重启**：dev-watch 在 `dist/main/index.js` 出现即启动 Electron，但 tsc 初始构建尚未写完其余产物，启动后立即触发一次多余重启；现改为先注册监视、等待 dist/main 构建产物静止（1s 无写入）再启动 Electron。
- **设置页重复按钮**：llama 引擎/模型目录卡片移除"打开目录"按钮（与"更改"逻辑重复），仅保留更改入口。

### 变更

- **打包命令优化**：根目录新增 `pnpm dist` 一条命令打包（委托 `@llama-launcher/desktop dist`，无需 `cd apps/desktop`）；`dist-with-fallback.cjs` 调用 electron-builder 由 `npx` 改为 `pnpm exec`（避免 npx 在线下载、统一 pnpm 包管理），子脚本启动用 `process.execPath`；portable 文件名提示由硬编码 1.4.0 改为从 package.json 动态读取。
- **依赖管理优化**：root `package.json` 声明 `engines.node >= 20`（resedit 3 要求）；`.npmrc` 补 `registry=npmmirror`（与 electron 镜像一致）；`tsconfig.node.json` 产物输出到 `node_modules/.vite-config-dist`（消除 vite.config.js/.d.ts 污染与 Vite 加载旧产物的隐患）；resedit 纳入 root devDependencies 管理。
- **参数悬浮内容**：参数项悬浮由长帮助文案改为显示参数名称（`paramLabel`）；帮助文案保留在 i18n API 中。
- **移除 GGUF rope 元数据**：`GgufModelInfo` 删除 6 个 rope 字段及解析、模型卡 RoPE 显示行、相关 i18n/labels 死键（rope 参数已不支持）；字段数 62 → 59。
- **引擎帮助信息入口**：设置页引擎卡片移除常驻帮助信息框，统一收敛到标题行帮助图标（悬浮步骤引导 + 发布页跳转按钮）。

### 增强

- **模型管理**：删除模型时同步清理关联预设并记录到主进程日志（不阻塞删除主流程）。

## [1.4.3] - 2026-08-15

### 新增

- **退出行为设置 + 托盘保活**：设置页「外观与语言」新增「关闭窗口时」选项（询问我 / 直接退出 / 最小化到托盘，默认询问）。首次关闭窗口弹出选择框（可勾选"记住我的选择"写入 `close_behavior`）；选择托盘或设置为托盘后，窗口关闭即隐藏并驻留系统托盘（托盘菜单：显示主窗口 / 退出，单击图标唤起窗口）；**模型服务（llama-server）运行中退出应用会二次确认**，确认后经 `before-quit` 清理并停止服务。托盘图标复用 `resources/icon.ico`（打包配置已纳入随包文件）。单实例二次启动会从托盘唤起窗口。

### 修复

- **托盘图标不显示**：根因是路径**少一层**——tsconfig `outDir=dist/rootDir=src` 使产物在 `dist/main/`，`../resources` 解析到不存在的 `dist/resources`。已改为 `../../resources`（dev 正确指向 `apps/desktop/resources`）+ `process.resourcesPath`（打包版经 electron-builder `extraResources` 复制，规避 asar 内路径 nativeImage 无法读取的问题）；图标改为 32px PNG 优先、16px/ico 兜底，加载成功/失败均有日志。
- **托盘右键菜单位置**：改为**手动定位到图标上方**——`popUpContextMenu` 的 position 是菜单左上角，按估算菜单高度（2 文本项 + 分隔线 + 边框 ≈ 57 DIP）把**菜单底缘对齐图标上缘、右缘对齐图标右缘**，菜单显示在托盘图标右上方（原生 `setContextMenu` 在托盘区不保证向上翻转，故手动定位）。
- **托盘图标不显示（初版）**：托盘图标由 icon.ico 改为优先加载 32px PNG（Windows 托盘各 DPI 渲染可靠），失败逐级兜底 16px PNG / icon.ico，加载失败时打印告警便于诊断。
- **托盘右键菜单位置**：不再 `setContextMenu`（默认固定在托盘图标处弹出），改为 `right-click` 时按鼠标当前位置 `popUpContextMenu`（菜单出现在鼠标处）。
- **模型列表删除模型报错（IPC 漏绑）**：`MODELS_REMOVE` 通道与主进程处理器均存在，但 preload `models` API 漏写 `remove` 包装 → `window.api.models.remove is not a function`，二次确认后报错。已补绑定；`verify-ipc-sync.cjs` 新增"通道 → preload API 包装覆盖"检查，此类漂移今后被 `pnpm lint` 拦截。


### 变更

- **参数表精简（56 → 47）**：移除采样卡片的 `repeat_last_n`/`typical_p`/`mirostat`/`mirostat_lr`/`mirostat_ent`（保留温度、top-p、top-k、min-p、重复惩罚、存在惩罚、随机种子）；移除 advanced 的 rope 参数（`rope_scaling`/`rope_freq_base`/`rope_freq_scale`/`swa_full`）。GGUF 建议同步移除对应条目（元数据仍解析进 info）；参数文档重新生成（Supported 47），README/params-system 计数同步。

### 修复

- **i18n 缺失修复**：`PARAM_GROUPS` 的 `param_advanced`/`param_server` 键缺失——`ParamsPanel` 用 `group.labelKey` 作为卡片标题（`<Card :title-key>`），高级/服务参数面板标题直接显示原始键。已补 zh/en 两键（en 与 zh 键集由 Dict 类型保证一致）。全量审计确认：47 参数 × labels/help、13 个子分组 `subcat_*`、201 个字面量 `t()` 键、24 个 `labelKey/titleKey`、12 个 `gguf_*`、4 个 `cat_*` 均无缺失。
- **界面切换性能优化**：① LaunchPage 命令预览 deep watch 加 **150ms 防抖**——拖滑块/应用预设时 params 高频变更曾每次触发 IPC + 整页重渲染（keep-alive 下后台也消耗主进程）；② 控制台行分类 `lineClass` 加 **WeakMap 缓存**（输出条目不可变，避免每次输出批次/切页激活对全部渲染行重跑 3 条正则），渲染上限 1500 → 1000（完整缓冲仍在 server.outputs）；③ 页面过渡 `mode="out-in"` 由 120ms×2 串行改为 **leave 0ms + enter 90ms**——新页立即挂载，不再等待旧页淡出（原串行等待是切换明显迟缓的主因之一）。
- **dev 会话随应用退出结束**（热重载修复）**：此前用户关闭窗口后 Electron 退出但 dev-watch/vite/tsc 仍占终端。现在 Electron 退出码 0（用户正常关闭或单实例锁冲突）时，dev-watch 打印提示并退出自身——`concurrently -k` 连带终止 vite/tsc，整个 dev 会话随之结束，终端不再残留进程。
- **dev-watch 用户主动退出不再自动重启**：退出处理按退出码区分——`code=0`（用户关闭窗口/应用自退，含单实例锁冲突 `app.quit()`）停止自动重启并打印原因（锁冲突时提示"可能为上次 dev 残留实例"）；仅 `code!=0`/信号终止（崩溃）才自动重启（保留快速退出拦截 + 熔断）。同时**移除启动时按路径清扫 Electron 的逻辑**（实测会导致并发 dev 实例互相误杀：B 清扫杀 A、A 重启后清扫再杀 B，退出码 -1 循环）。
- **`swa_full` 残留支持清除**：参数本已于参数表精简时移除，但 `gguf-meta.ts` 仍为含 `full_attention_interval` 的混合 SSM 模型生成 `swa_full` 建议（会写入不存在的参数）；已删除该建议块与 i18n 死键（`PARAM_LABELS`/`PARAM_HELP`）。元数据字段 `full_attention_interval` 保留解析与模型卡展示（属模型信息，非参数）。
- **顶栏图标加载错误**：`app-icon.svg` 注释体内含 ASCII `--`（`--rainbow-grad`）——`<img>` 加载 SVG 走严格 XML 解析，注释内含 `--` 属致命错误导致整图加载失败。已改写注释（严格校验：3 处注释体内均无 `--`，标签配对 OK）。
- **卡片 hover 闪烁**：Card 去掉 `transform: translateY` 上浮（鼠标扫过成排卡片时合成层提升导致文字重栅格闪烁/"整体浮动"），改为边框 accent 高亮过渡。
- **应用图标异常**：像素级解码发现 `gen-icon` 采样判定中**外耳三角完全包含内耳**，内耳分支永不执行（旧版窗口图标实际无内耳，而 SVG 因画家算法会显示，两处图标不一致；20px 下内耳成白色剪影上的脏点）。修复：统一为**白色羊驼剪影 + 彩虹底**（两处均去掉内耳），窗口图标已重新生成（icon.ico/png），顶栏 SVG 同步。
- **dev-watch 单实例锁健壮性**：① 启动前清扫残留 dev Electron（路径精确匹配，不误伤打包应用）；② 启动 <1.5s 即退出（崩溃/锁冲突）不再自动重启并打印提示；③ 退出时尝试清理 Electron 子进程。
- **重构后体验异常修复**：命令预览多行文本框禁用胶囊圆角；三处粘性表头改不透明 `--bg-card`；`.btn-restart` warn 黄底 hover 文字改深色。

### 增强

- **CJK 字体栈强化**：`--font-family` 增加 `Microsoft YaHei`（防精简系统缺 YaHei UI 时中文落到宋体）、`HarmonyOS Sans SC`/`MiSans`（现代黑体，若安装）；`--font-mono` 末尾补 CJK 回退（日志含中文时）。字号体系已于前一轮整体上调 1px。
- **侧边栏参数设置入口移除"已调整"小黄点**。
- **彩虹一致性**：下载推荐竖条改用 `--rainbow-grad`（与进度条/启动 CTA 呼应）。
- **界面切换性能**：页面过渡去掉 transform（避免重型页面合成层开销）+ 时长减半（out-in 各 120ms，原 0.22s 串行明显迟缓）。
- **焦点/悬停闪烁优化**：`:focus-visible` 由瞬时 outline 改为可动画的 box-shadow 焦点环；`--dur-fast` 0.12s→0.16s（玻璃表面背景切换更顺滑）；reset 增加交互元素基础过渡（含 box-shadow），输入/下拉/参数行 scoped 过渡补 box-shadow。

- **全局字号上调 + 字体栈优化**：`--fs-*` 语义字号整体上调 1px（xs 10→11 / sm 11→12 / base 12→13 / md 13→14 / lg 14→15 / appname 15→16 / xl 18→20），改善桌面端小字号可读性（原 10/11px 层级在徽章、状态栏、summary chip 偏小）；`--font-family` 加入 `Segoe UI Variable`（Win11 默认 UI 字体）与 `--font-mono` 的 `Cascadia Mono` 回退。规范同步 frontend.md §7.5.1。
- **dev 模式默认关闭 DevTools**：`window.ts` 仅在 `LLAMA_DEV_CONSOLE=1`（新命令 `pnpm dev:console`，根目录与 desktop 均可用）或生产热重载逃生口 `LLAMA_DEV_SERVER_URL` 时打开浏览器控制台；`pnpm dev` 默认不再弹出。
- **彩虹按钮边框化**：启动 CTA 由彩虹实底改为**仅边框彩虹 + 玻璃内部**（`padding-box`/`border-box` 双层背景技巧，内部无高亮底色），文字色跟随主题。
- **动效补齐**：页面切换淡入+上浮（PageHost）、参数分区展开/收起过渡（CollapsibleSection）、**侧边栏折叠**（底部折叠按钮 + 图标模式，宽度过渡为单次用户触发例外，持久化 `sidebar_collapsed`）。
- **配色进阶**：浅色主题玻璃不透明度 0.55→0.72（深色文字对比度）；滚动条 thumb accent 着色；状态栏主色→accent 微妙渐变；应用图标改彩虹渐变底。
- **清理**：移除未引用组件 `PageNav`/`PageHeader` 与未使用的 `.glass`/`.glass-strong` 工具类。

### 重构

- **UI 全面重构（胶囊 + 单层毛玻璃 + 果冻动画 + 点缀式彩虹）**：① 交互元素胶囊化（新增 `--radius-pill/card/modal/row/control` token，替换散值圆角）；② 全局半透明毛玻璃采用**单玻璃层**架构（`styles/surface.scss` 全视口 1 层 `backdrop-filter` + 表面半透明，性能核算：blur 层数 18→1，稳态开销 ≈0-3% 帧时间，滚动容器/列表行不 blur）；③ 果冻动效（`--ease-jelly`，只动 transform/opacity，`prefers-reduced-motion` 关闭）；④ 彩虹点缀（启动按钮 `--rainbow-grad`、下载进度条、分区 `--hue` 循环装饰条）；⑤ 新增 `data-fx='glass|off'` 视觉效果开关（Settings「外观与语言」可切，off = 实底性能模式，回退 = 一个属性）。样式契约同步更新至 `docs/frontend.md §7.5`（圆角体系/玻璃规则/动效规则/检查清单）与 `docs/style/STYLE_TODO.md`（新增 backdrop-filter 预算与动画审计命令）。验证：`pnpm lint`（含 check-docs-links）+ `pnpm test` 全绿。

### 修复

- **dev 构建无限重启循环（自持触发）**：`dev-watch` 监视整个 `apps/desktop/dist`，而每次重启都会经 `copy-preload`/`generate-preload` 无条件重写 `dist/preload/*.cjs` 与 `src/preload/ipc-constants.cjs`（均在被监视目录内）→ 形成"重启→写入→触发重启→再写入"的无限循环（实测任意主进程/共享源码变更即触发，123 次/90s）。修复：`generate-preload` 与 `copy-preload` 幂等化（内容相同跳过写入），`dev-watch` 只监视 tsc 主进程产物 `dist/main`（不再监视自身写入的 `dist/preload`）。修复后源码变更仅触发 1 次重启并收敛，preload 内容变更仍会正确复制。

### 增强

- **dev-watch 重启熔断**：滑动窗口（8 次/30s）内重启次数超限即停止自动重启并输出明确告警（防止崩溃循环/未来任何自持循环烧 CPU）；Electron 非热重载退出（崩溃/手动关闭）现在会自动重启（同样受熔断约束）。
- **`load_mode` 选项对齐 b10429**：llama-server 实际二进制（b10429）为 `--load-mode` 新增 `auto` 模式（默认 mmap，设备不支持时回退），应用下拉补入 `auto` 选项；默认仍为实测推荐的 `none`。
- **参数 re-pin 流程固化**：新增 `scripts/verify-help-drift.cjs`（二进制升级后对比新 help 与固定基线的 flag 增删 / 默认值变化 / 应用参数缺失，flag 级漂移非零退出码可接入 CI），完整流程写入 `docs/params-system.md` §5.5（替换基线 help → 更新版本标注 → 漂移审计 → 更新 definitions → 重建 shared → 重新生成文档 → 校验 → 回归）。
- **docs 引用修复**：`AGENTS.md` 失效的 `CODE_WIKI.md` 链接改为 `docs/packaging.md#打包配置-electron-builderyml`；`packaging.md` 图标路径明确为 `apps/desktop/resources/icon.ico`；`OPTIMIZATION_TODO.md` 中已重构删除的 `ipc-handlers.ts` 引用更新为 `apps/desktop/src/main/ipc/models.ts`。docs 全量链接审计（17 个 md、80 个相对链接）全部有效。
- **docs 链接检查纳入常规维护**：新增 `scripts/check-docs-links.cjs`（扫描 `docs/**/*.md` 与根 `AGENTS.md`/`README.md` 的相对链接与 GitHub 锚点，断链/失效锚点非零退出码），已接入 `pnpm lint`（`turbo run lint` → `verify-ipc-sync.cjs` → `check-docs-links.cjs`），亦可单独运行 `pnpm docs:check`。

### 变更

- **内存参数基线启用（实测结论落地）**：`cache_type_k`/`cache_type_v`（KV 量化 q8_0）、`load_mode`（`--load-mode none`）、`fit`（`--fit off`）四个推荐内存参数由"定义了但未启用"改为**初始化与重置时即启用并下发到命令行**，且不计入参数分组"已修改"蓝点。依据 `docs/plan-kv-split-cli-test.md`（2026-08-15 实测）：f16 KV + mmap + fit on 的长上下文组合在 32GB 内存机器上可冻结系统；q8 KV 使 27B@262K 显存需求从 ~35GB 降至 ~25.7GB，`--load-mode none` 防权重页常驻内存，`--fit off` 规避显式 ctx/ngl 时 fit 中止导致的劣化（262K 下 25.7 vs 36.6 tok/s）。新装用户不再默认跑在 OOM 配置上。

### 增强

- **i18n 补齐与清理**：新增 `load_mode`/`fit` 参数标签与帮助文案（含 mmap 冻结风险、fit 劣化警示、`-nkvo` 混合模型乱码提示），移除已废弃参数 `mmap`/`mlock` 的残留 i18n 条目。
- **参数文档同步**：重新生成 `docs/params/LLAMA_SERVER_PARAMS.md`（`--mmap/--mlock` 由已支持降为未支持，`--load-mode`/`--fit` 升为已支持），`verify-params-sync.cjs` 校验一致。

## [1.4.2] - 2026-08-14

### 修复

- **预设参数未正确覆盖到参数配置**：`applyPreset` 原先按「合并」语义仅覆盖预设中存在的参数 key 与 `_enabled` 中列出的启用状态，未包含的参数会残留当前会话配置（如切换模型后应用另一模型的预设、或应用旧版本保存的预设，产生混合配置，残留的已启用参数仍会发射进命令行）；旧格式预设（无 `_enabled`）加载后参数虽显示在配置页但不会生成到命令。修复：应用预设前先重置全部参数为默认（完全覆盖语义），未携带模型的预设保留当前模型；新格式预设以 `_enabled` 为权威启用状态，旧格式预设按「值非默认自动启用」兼容，确保预设真正覆盖参数配置并生效。

### 增强

- **退出资源释放强化**：主进程 `before-quit` 清理由 `pauseAll` 升级为 `getDownloadManager().dispose()`(暂停下载保存续传元数据 + 销毁 https 连接池 + 移除事件监听);dev 会话树清理统一收敛到 `before-quit` 并加 `LLAMA_DEV_SKIP_QUIT_KILL` 守卫(移除 `quit` 处理器中因 `NODE_ENV` 不可靠而失效的重复代码——热重载跨平台不再误杀 dev 会话树);渲染端新增 `settings.flushSave()` 并在 `App.vue` `beforeunload`/卸载时调用(防抖窗口内最后一次设置变更不再丢失),`SettingsPage` 卸载时清理挂起的引擎检测计时器。

- **开发热重载强化**：`apps/desktop` dev 流程由「vite + electron 单次启动」改为三进程编排——`dev:vite` = Vite(UI HMR) + `tsc -b --watch`(shared/core/desktop 增量重建) + 新增 `scripts/dev-watch.cjs`(监视主进程 dist / preload 源 / shared 类型,变更时自动重新生成并复制 preload、重启 Electron);主进程退出守卫 `LLAMA_DEV_SKIP_QUIT_KILL=1` 使热重启不连带杀掉 dev 会话树(tsc watch/监视器)。改 UI 即时热更;改 core/shared/主进程/preload 自动重建重启,无需手动操作。

- **下载量化标签识别修复（Q8_K_XL / Q8_K）**：`parseQuantization` 的 k-quant 模式区间 `[2-6]` 漏掉 Q8——`Qwen3.8-27B-UD-Q8_K_XL.gguf` 与裸 `Q8_K` 文件名均识别为 null,下载列表不显示量化徽章;修正 XL 与裸 k-quant 模式为 `[2-8]`(Q2_K..Q8_K,含 Q8_K_XL),新增回归用例。

- **ModelScope 下载跳过仓库搜索**：粘贴 `modelscope.cn/models/{author}/{model}` 链接时直接进入仓库文件列表（URL 已完整标识仓库），与 HuggingFace 链接行为一致——不再先搜索再"选择仓库"的多余操作；HF 与 ModelScope 两条 URL 路径合并为同一"直接列文件"逻辑（裸 `author/model` 输入仍走搜索）。

- **性能优化(续):模型列表浅响应式 + 选中态 O(n²)→O(n)**：模型管理页与顶栏模型下拉的模型数组改为 `shallowRef`(整体替换、无原地变更,取消数百个 ModelInfo 深响应式代理包装——大模型库扫描后过滤/渲染更快);模型行选中态由「每行执行 `filteredModels.findIndex`(O(n²))」改为模板直接比较 `m.path === modelPath`(O(1)/行)。

- **性能优化（减少卡顿）**：① 设置保存**防抖合并**（`settings` store 200ms 批量,路径输入/主题/语言等高频变更不再每次击键触发 IPC + 主进程同步文件 I/O,CAS 合并 + 原子写收敛为一次);② 引擎检测**防抖**(设置页 400ms 停止输入后才执行 findLlamaExe + fileExists,避免每次击键两次 IPC);③ 控制台**渲染窗口上限**(1500 行有界 DOM,长会话 5000 行日志不再整表渲染,复制/清空仍用全量缓冲);④ 主进程日志推送**批量合并**(launcher-bridge 16ms 窗口批量 webContents.send,模型加载数百行突发日志不再逐行压 IPC)。

- **模型列表管理能力增强**：模型列表项新增**伴随文件标签**（扫描器按模型目录检测 mmproj / dflash / draft 文件并写入 `ModelInfo.tags`，列表以淡底徽章展示）；每行新增**打开目录**（`openPath` 打开模型文件所在目录）与**移除**操作（新增 `models:remove` IPC，按模型子目录删除——含 mmproj/草稿等伴随文件，仅允许删除 `models_dir` 内路径，删除后扫描缓存失效并自动刷新列表；操作前有 danger 确认弹窗）。通道 45 → 46。

- **注册表化重构（P0）**：路由与侧栏导航由静态硬编码改为**功能注册表**装配——新增 `packages/ui/src/features/`（`FeatureDef`/`NavItem` 类型 + 6 个功能模块 + 注册表 `features/index.ts`），路由从注册表汇总（`router/index.ts` 只装配 `featureRoutes`），侧栏由 `navItems` 驱动渲染（含参数页橙点经 `dot()` 求值保持响应式，`order` 决定排序，`enabled:false` 可停用功能）；主进程 IPC 由单文件 `ipc-handlers.ts` 拆分为**功能域注册表** `apps/desktop/src/main/ipc/`（settings/models/presets/server/system/window/download 各自 `register*Ipc`，`index.ts` 聚合装配，共享 `models-watcher.ts` 监听单例）。行为零变化，通道数不变（45）。

- **冗余内容清理（前后端）**：移除 5 个 dialog IPC 桩通道（`dialog:pickDir/pickFile/saveFile/askYesNo/askCreateDir`，50 → 45）——目录/文件选择与确认弹窗早已迁移到渲染进程自定义组件（FileBrowserModal/ConfirmModal），这些通道仅剩返回 null/false 的桩实现且 UI 零使用；同步移除 preload `dialog.*` 暴露、env.d.ts 类型与 ipc-handlers 桩处理器（含未使用的 `FileFilter` 导入）。另清理 83 个未使用的 i18n 键（zh/en 同步，含历史页面标题 `page_*`、控制台状态 `console_*`、采样建议 `gguf_sampling_*`、下载旧文案 `dl_*`/`lbl_*`/`col_*` 等；动态拼接键 `dl_err_*`/`subcat_*`/`cat_*` 经核实在使用中，保留）。

- **Web UI 内嵌帧常驻（修复切页重载）**：Web UI iframe 从路由组件（被 keep-alive 缓存、切走时 DOM 移出文档导致浏览上下文销毁而重载）提升到布局层常驻组件 `WebUiFrame`（AppLayout 内 absolute 覆盖内容区），仅用 `v-show`（display:none）切换显隐——display:none 不销毁 iframe 浏览上下文，从 Web UI 切到其他菜单页再切回时页面保持不刷新；服务停止时清空 src（后端已不存在，重启后重新加载）。`WebUiPage` 简化为 `/webui` 路由占位。

- **Web UI 应用内嵌**：新增侧边栏「Web UI」标签页（路由 `/webui`）——服务运行时用 iframe 在应用内直接展示 llama-server 的 Web UI，不再跳转外部浏览器；服务未运行时显示占位提示（含启动引导文案）。「打开 Web UI」按钮（顶栏与控制台页）由 `openExternal` 改为跳转内嵌标签页；`openExternal` IPC 保留供模型页链接等场景使用。经 keep-alive 缓存，切换标签时 Web UI 会话状态保留。

- **应用设置入口统一化**：新增「应用设置」页（侧边栏齿轮入口，路由 `/settings`），把分散在模型管理页（引擎目录 + `llama-server.exe` 内联检测徽标、模型目录、HuggingFace 镜像源）与下载页（最大并发下载数）的应用设置收敛为一处统一表单，另含主题/语言完整面板；更改即时保存。ModelsPage 移除引擎/模型目录/镜像卡片（保留模型列表、GGUF 信息、建议参数，目录变化仍自动重扫），DownloadCard 移除并发选择器（并发数经设置页修改后由 SETTINGS_SAVE 同步到 DownloadManager）。**移除顶栏中英切换与深浅色切换按钮**（主题/语言统一由设置页「外观与语言」卡片调整；`Ctrl+D` 快捷键切主题保留），清理对应 i18n 键（`lang_toggle`/`theme_dark_tip`/`theme_light_tip`）。新增 i18n 键（zh/en）与 `settings` 图标。

- **下载任务状态改 JSONL 事实源 + 投影**：新增 `download-log.ts`——下载续传持久化从「内存状态 + 5s 周期快照 `.llama_dl.json`」改为 **append-only 事件日志 `.llama_dl.jsonl`**（`start` 含段布局 / `segment` 段进度逐事件落盘 / `done` 终态三类事件）；崩溃/重启后 `replayDownloadLog` 重放事件精确重建段进度，**状态丢失窗口从 ≤5s 归零**，内存/磁盘双份状态的漂移源（节流定时器）删除；旧版 `.llama_dl.json` 快照由 `migrateLegacyMeta` 一次性迁移为事件日志（v1/v2 均支持），下载完成/取消后日志随部分文件一并清理。新增 `download-log.test.ts` 11 例 + download-manager 重放/迁移路径回归。
- **设置保存 CAS 合并守卫**：`saveSettings` 写入前读取磁盘当前值作为合并基线——其他窗口/实例写入的字段（如 `hf_mirror_host`、`last_tab`）不再被盲写覆盖，本次传入值覆盖同名，写入失败重试；与原子写共同把「多实例并发保存互相踩」从概率性故障变为确定性合并。新增「并发磁盘更新合并」用例。
- **预设版本化 + 形状校验**：`Preset` 新增 `preset_version` 字段（当前 1）；`savePreset` 落盘盖章版本，`loadPreset`/`listPresets` 对旧版无版本文件补齐默认 1，并校验 `values` 形状（非对象回退空对象）、损坏 JSON 返回 null 静默跳过。
- **重试逻辑收敛**：新增 `retry.ts`（`isRetryableError` + `retryDelayMs`），统一原先 `download-manager.ts`（code/状态码判定）与 `huggingface-client.ts`（消息关键词判定）两份近似重复的实现，新增网络调用零成本复用；新增 `retry.test.ts` 5 例。
- **已有完整文件的校验和验证**：`startDownload` 的「文件已存在且大小达标」早完成路径现在也会计算 SHA-256 并与 `expectedChecksum` 比对——不匹配以 `checksum_mismatch` 显式失败（不再静默把损坏文件当作已完成），匹配则立即完成并随 `complete` 上报 checksum。新增 2 例测试。

- **GGUF 元数据读取异步化**：`readGgufMetadata` 改为异步（`fs/promises` + `FileHandle.read`，底层线程池 I/O，不再阻塞主进程事件循环）；`BufferReader` 持有 FileHandle；`MODELS_READ_GGUF_META` handler 改 async；测试 36 例全过（33 处 await、3 处 rejects）。决策：GGUF 头部解析为 I/O 密集，异步 fs 即充分，未引入 worker 池（避免 asar/ESM 打包复杂度）。
- **下载校验和接入源 API**：HF tree API 的 LFS `oid`（sha256）经 `extractSha256` 提取为 `ModelScopeFile.sha256`，DownloadCard 启动下载时透传为 `expectedChecksum`——HF 下载完成自动校验，损坏以 `checksum_mismatch` 显式失败。
- **实时指标改主进程推送（随指标面板一并移除）**：`server:metricsPush` 通道与 `launcher-bridge` 2s 采样推送已随实时指标面板移除（见「实时指标面板（Live Metrics，已移除）」）。
- **设置文件原子写 + schema 校验 + 版本迁移**：`settings.json` 保存改为「先写 `.tmp` 再 rename」原子替换（崩溃/断电不再留下半个 JSON）；`loadSettings` 逐字段归一化（`theme_mode`/`language` 枚举校验、布尔/数值钳制、`download_max_concurrent` 钳到 1–5），损坏或结构非法的文件自动备份为 `settings.json.bak` 后回退默认（不再静默吞掉用户配置）；新增 `settings_version` 字段（当前 1，未来字段变更走 `migrateSettings` 版本迁移，与下载元数据 `migrateMeta` 同模式）。
- **预设文件原子写**：`savePreset` 同样改为 `.tmp` + rename 原子替换。
- **下载统计（token-meter 模式，已移除）**：曾实现每次下载完成追加一行 `~/.llama_launcher/stats.jsonl`（append-only 事实源）+ `download:stats` IPC + `readDownloadStats` 聚合 + 下载页「累计下载」展示；2026-08-14 因展示内容无实际作用而整体移除——界面展示、`download-stats.ts` 模块、`stats.jsonl` 落盘、`download:stats` 通道（53 → 52）与对应 preload/类型一并删除。
- **自定义 HuggingFace 镜像源**：`AppSettings.hf_mirror_host`（默认空 = hf-mirror.com）经设置持久化，`loadSettings`/`saveSettings` 自动同步到 `setHfMirrorHost`；hf 列表/下载 URL/传输选择（`isHfMirrorHostname`，Electron net 分支）全部跟随配置；ModelsPage 引擎卡片新增镜像源输入行（受限网络可指向自建镜像/内网缓存）。
- **参数表驱动测试生成**：新增 `command-builder-definitions.test.ts`，从 `definitions.ts`（唯一事实源）自动生成用例——结构约束（key 唯一、flag 齐全、int/float 范围与默认值合法性、dropdown 默认在选项中、checkbox invert_flag 完整性）与发射行为（56 参数逐一验证显式启用按类型发射、禁用零发射、float 2 位小数无 float32 噪声）；新增/修改参数时零成本获得全约束覆盖，与 `verify-params-sync.cjs`（文档一致性）互补。
- **服务输出截断 + 统一 fetch helper**：`process.ts` 输出按行转发时对单行 >8KB 截断并追加 `... [truncated N bytes]` 标记，无换行缓冲 >64KB 时强制按一行输出并清空（防超长行/无换行流塞爆 IPC 与 UI 渲染，恒定内存）；`bench-client.ts` 的 `requestJson` 与 `fetchMetrics` 收敛为统一 `requestText`/`requestJson` helper（超时/网络错误/JSON 解析单点实现，非 2xx 不抛错、由调用方按语义处理），新增 API 调用零成本接入。
- **实时指标面板（Live Metrics，已移除）**：曾实现 Launch 页「实时指标」卡片（`server:metricsPush` 主进程 2s 推送 + `server:benchMetrics` 轮询回退 + `useServerMetrics` composable）；2026-08-14 因实际运行中无有效计数而整体移除——控制台指标卡、`useServerMetrics`（含 6 例测试）、`launcher-bridge` 2s 采样推送、`server:metricsPush`/`server:benchMetrics` 通道（52 → 50）与对应 preload/类型/i18n 一并删除；`bench-client.fetchMetrics` 保留（性能测试 runBench 仍需 `/metrics` 累计值）。
- **参数依赖清理声明化 + 稳定态测试**：依赖满足判定收敛为导出的纯函数 `isDependencySatisfied`（启用 + values/notValues 校验）与 `computeViolatedParams`（违规参数集合），`syncDependencies` 不再内联判定逻辑；新增用例覆盖「先填下游值、后选依赖源不被误清」「切 draft-mtp 清空 -md」「重复设置依赖源幂等收敛」三组稳定态不变量（params.test.ts 16 例全过）。
- **下载校验和（SHA-256）落地**：下载完成时流式计算已下载文件的 SHA-256（恒定内存，不整读大文件）并随 `DownloadCompletePayload.checksum` 上报；`StartDownloadRequest.expectedChecksum`（预留自源 API，如 HF LFS oid）提供时逐位比对，不匹配则以新错误类型 `checksum_mismatch` 显式失败（UI 友好文案已加中英文），把「下载损坏」从静默变为可归因；`DownloadMeta.checksum` 预留字段保留。
- **模型目录扫描异步化 + 缓存**：`scanModels` 从同步递归（`readdirSync/statSync`，阻塞主进程事件循环）改为 `fs/promises` 异步并行遍历；新增扫描结果缓存（按 `dir:mtimeMs` 为键，上限 8 条），切页/刷新命中缓存零重扫；`MODELS_WATCH` 监听到 .gguf 增删时调用新增的 `invalidateScanCache()` 使缓存失效（新增导出，IPC 层接入）。
- **IPC 常量生成化（消除双写漂移）**：新增 `scripts/generate-preload.cjs`，从 `packages/shared/src/types/ipc.ts`（唯一事实源）生成 `apps/desktop/src/preload/ipc-constants.cjs`；preload `index.cjs` 改为 require 生成物，不再内联 51 个通道常量；`verify-ipc-sync.cjs` 升级为「生成物未过期检查（--check）+ 防内联回退守卫」；`copy-preload.cjs` 在复制前自动重新生成；新增根脚本 `pnpm generate:ipc`。
- **预设值智能归一化**：应用预设时对每个参数值做类型/范围/选项适配——checkbox 布尔化（兼容字符串 `"true"`/`"1"`）、int/float 数值化并钳制到 [min, max]（旧预设超范围值不再产生非法命令）、dropdown 校验当前选项（旧版 `draft-model` 自动映射为 `draft-simple`，非法值回退默认）、未知 key（旧版本已移除的参数）直接丢弃。
- **模型预设智能应用**：在顶部模型下拉或模型管理页**显式选择**模型时，若存在该模型已保存的预设（按预设名匹配：文件名/去扩展名；或按预设内记录的模型路径匹配，兼容 alias 命名），弹窗询问是否应用；确认后完全覆盖参数配置，并以用户选择的模型为准重新自动检测 mmproj/草稿模型/GGUF 元数据。同一（模型,预设）组合本会话内拒绝后不再重复打扰。
- **应用反馈**：应用预设后面板内短暂显示「已应用预设「{0}」，启用 {1} 项参数」并写入控制台；预设列表中当前应用的预设行标记「当前」徽章（基于 `settings.last_preset`）。
- **UI 包新增 vitest 回归测试**：`packages/ui/src/stores/params.test.ts` 覆盖预设完全覆盖、残留清理、旧格式兼容、依赖联动、值归一化、快照往返恒等等 8 个用例（`pnpm --filter @llama-launcher/ui test`）。
- **性能测试历史「应用」按钮**：测试历史表格每条记录在「删除」前新增「应用」按钮，点击把该次测试使用的参数（含启用状态，来自测试时保存的快照）完全覆盖应用到当前参数设置——复用预设的覆盖逻辑（智能归一化 + 依赖联动清理），面板内短暂显示「已应用测试参数「{0}」，启用 {1} 项参数」并写入控制台。
- **切换模型预设应用修复**：修复切换模型时出现二次确认弹窗与确认后参数未正确切换的问题——(1) `applyModelPresetIfAny` 增加模块级并发防护（`applyingPath`），双击/快速连点触发重复调用时直接忽略，确保只弹一次确认；(2) 确认后直接应用预设列表返回的 `values`（不再二次 `load`，消除「确认后无反应」的失败路径），并以用户刚选择的模型路径为准重新同步 `selected_model`；(3) 应用预设后仅在预设未显式配置推测解码（`spec_type` 为空）时才自动检测草稿模型，避免检测结果覆盖预设已保存的 `spec_type`/`flash_attn`/`spec_draft_n_max` 等选择；(4) 失败时向控制台输出错误提示而非静默无反应。新增 `useModelPreset.test.ts` 7 个用例覆盖上述行为。

## [1.4.1] - 2026-08-09

### 新增功能

- **新增 `-ctkd` / `-ctvd` 参数**：`spec_cache_type_k`（`-ctkd`，下拉 `auto|f32|f16|bf64`）与 `spec_cache_type_v`（`-ctvd`，下拉 `auto|f32|f16|bf64`），依赖 `spec_type` 不为 `disabled`。参数总数 54 → 55。
- **新增 `-ngld` 参数**：`spec_draft_ngl`（`-ngld`，草稿模型 GPU 层数，text 类型，默认 `auto`，支持 `all`），依赖 `spec_type` 不为 `none`。DFlash 等草稿模型可卸载到 GPU 加速。参数总数 55 → 56。
- **`spec_type` 选项扩展**：跟随 llama-server b10360 新增 `draft-simple` / `draft-eagle3` / `draft-dflash` / `draft-dspark` / `ngram-simple` / `ngram-map-k` / `ngram-map-k4v` / `ngram-mod` / `ngram-cache`（移除已过时的 `draft-model`，command-builder 保留 `draft-model→draft-simple` 旧预设兼容映射）；`spec_draft_n_min` 默认值 1 → 0（对齐官方 help）。
- **mmproj 自动检测修复**：切换模型时，若未检测到对应 mmproj 文件，自动清空路径并禁用（`values['mmproj'] = ''` / `enabled['mmproj'] = false`），避免残留上一次模型的 mmproj 路径。

### 修复

- **服务器输出 ×N Bug**：`server.ts` `subscribe()` 添加 `let subscribed = false` 守卫，防止 Vite HMR 或组件重挂载时重复注册监听导致控制台输出被推送 ×N 次。
- **Launcher 桥接输出缓冲**：`launcher-bridge.ts` 增加 `bufferedWin` 字段，输出缓冲区仅在当前窗口有效时重放，窗口关闭后重置 buffer，防止残留 buffer 导致控制台出现旧输出或 `undefined` IPC 错误。
- **服务重启永远失败**：`useStartServer.restart()` 与 `start()` 共用异步校验，其中 `checkPort` 检测到当前 llama-server 正占用目标端口即返回 `Port is already in use`，导致运行中点击重启 100% 被拦截。修复：重启语义为先杀旧进程再启动，端口被自身占用属预期情况，`restart()` 通过 `checkAsync({ skipPortCheck: true })` 跳过端口占用检查，保留同步校验（引擎/模型目录/模型/端口范围）与 exe 存在性校验；`start()` 仍保留端口检查防止与其他程序冲突。
- **DFlash 加速未生效**：`detectDraftModel` 检测到 dflash 草稿模型（如 Muse-Glimmer-30B 的 `dflash-kquant.gguf`）时一律将 `spec_type` 设为 `draft-simple`（普通草稿模型推测解码），而 DFlash 专用实现需 `--spec-type draft-dflash` 才生效，导致加速效果完全未实现。修复：检测到文件名含 `dflash` 的草稿模型时自动配置 DFlash 完整组合——`spec_type=draft-dflash` + `flash_attn=on`（DFlash 前置要求）+ `spec_draft_n_max=15`（Muse-Glimmer DFlash 每 block 预测 16 位置：1 条件位 + 15 草稿 token），并在控制台推送检测提示（`msg_dflash_detected`）；普通 `draft-*.gguf` 仍走 `draft-simple`；用户已手动选择推测解码类型时尊重选择不覆盖。

### 新增功能

- **参数设置页新增「性能测试」子选项卡**：封装 llama-server 在线实测能力，帮助用户找到 DFlash 最佳参数组合（Muse-Glimmer-30B 场景）：
  - **在线实测**：通过 `--metrics` 端点 + completion `timings` 读取真实吞吐与 DFlash 指标。经 b10360 源码确认 `llama-bench` 不支持推测解码评测，故采用运行中 llama-server 实测（`predicted_tokens_seconds` 与 `spec_decode_num_*` 与日志 `draft acceptance` 同源）。
  - **参数 A/B 对比**：保存当前参数快照为命名组合，调整后重测并排对比 tok/s、DFlash 接受率、生成 tokens。
  - **自动重启**：测试前自动用当前参数重启服务（未启用 `--metrics` 时自动开启），等待 running 后发测试请求。
  - **快捷参数调整**：ctx_size、spec_draft_n_max/min、flash_attn、gpu_layers、spec_draft_ngl、采样参数等直接读写参数表。
  - 新增 IPC 通道 `server:bench` / `server:benchMetrics`（49 → 51 通道），主进程 `bench-client.ts` 用 Electron `net` 模块发 HTTP（无 CORS 限制，支持 `api_key` Bearer 鉴权）。
  - **避免模型重复加载**：`Launcher` 保存最近一次启动的参数快照（`currentValues`），`getStatus()`/`ServerInfo.values` 暴露给渲染进程；BenchPanel 运行测试前对比当前参数（含 `_enabled`）与运行中服务快照，若完全一致且 `--metrics` 已开启则**复用现有服务直接测试**（不再无条件重启，省去 30B 模型数十秒重复加载），参数变化时才重启。
  - **数值参数精度对齐**：性能测试页的 `tuneValue`/`setTune` 原先直接 `String(v)`/`Number(raw)`，float 显示可能带浮点尾数（如 `0.94999999`）、输入 3 位小数不校验、越界不钳制，与参数配置页 SliderParam 不一致。修复：复用同一套 float/int 处理——float 显示 `toFixed(2)`、输入校验最多 2 位小数、四舍五入到 2 位、min/max 钳制；int 取整 + 钳制；文本/下拉直存。两界面读写同一 params store，现在格式完全一致。
  - **下拉参数选项校验对齐**：性能测试页的 dropdown 参数（flash_attn、cache_type_k/v 等）原先为自由文本输入，可写入任意字符串（如 `flash_attn=banana`），command-builder 会原样发射导致 llama-server 拒绝；参数配置页 DropdownParam 只能从预定义选项选择。修复：`setTune` 对 dropdown 校验值必须在 `options` 中，非法值拒绝写入，与参数页行为一致。
  - **参数项动态化 + 控件复用**：性能测试页的参数项不再写死 10 个 key，改为**动态跟随参数配置页已启用项**——`activeTuneParams` 实时筛选 `params.isEnabled()` 的参数（排除 model/mmproj/spec_draft_model），勾选/取消参数后性能测试页自动增减；控件直接复用参数配置页组件（SliderParam/IntEntryParam/DropdownParam/CheckboxParam/TextParam），交互方式（滑块/下拉/开关/文本）与参数配置页完全一致，读写同一 params store 保证值精确同步传入后端；组合摘要 `snapshotSummary` 同步改为从快照 `_enabled` 解析已启用参数。
  - **参数行视觉隔离**：性能测试页参数行加 `1px` 边框 + `4px` 圆角 + hover 高亮（与参数配置页 ParamRow 卡片化分隔一致），提升视觉隔离与操作目标识别。
  - **运行测试行高修复**：测试提示词行与生成 Token 数行增加 `margin-bottom: 8px` 间距，消除组件重叠。
  - **运行测试按钮智能检测**：按钮不再因服务未运行而禁用——点击后自动检测：服务未运行 → 直接启动；运行中且参数一致（含 `--metrics` 已开启）→ 复用现有服务；运行中但参数不一致 → 停止后用调整后参数重启；`starting` 状态 → 直接重启不杀启动中进程。提示文案同步更新（`bench_status_starting`）。
  - **组合对比表格化**：参数组合对比从卡片式改为**表格**展示（组合名称 / 生成 tok/s / 提示 tok/s / DFlash 接受率 / 生成 tokens / 参数 / 删除），便于调整前后性能指标并排对比；新增 `bench_prompt_tok_s`、`bench_params` 列。
  - **去掉保存组合能力**：移除组合名称输入与「保存组合」按钮——用户直接调整参数后再次点击「运行测试」即可，减少多余操作。表格改为**测试历史**（内存态，关闭应用即清空），每次运行自动追加一条记录，按运行次数命名。
  - **参数摘要只显示已启用项**：修复 `snapshotSummary` 显示所有参数的问题——根因是 `onRunTest` 记录快照时用了 `{ ...params.values }`（不含 `_enabled`），导致摘要回退显示全部参数（含未勾选）。修复为 `{ ...params.snapshot() }`（含 `_enabled`），摘要只展示已启用参数；同时移除无 `_enabled` 时回退显示全部参数的逻辑。**运行测试传参核查**：`server.start/restart` 用的 `params.snapshot()` 含 `_enabled`，command-builder 按 `_enabled` 过滤，未勾选参数不会发射给 llama-server——启动参数正确，无需改动。表格列头标注「参数（仅已启用）」。
  - **性能测试历史切换页面不被清空**：ParamsPage 的 tab 面板原为 `v-else-if` 条件渲染，切换 tab 时 BenchPanel 组件被销毁重建，内存态测试历史（combos）丢失。修复：将参数渲染逻辑提取为独立的 `ParamsPanel.vue` 组件，ParamsPage 改用 `<KeepAlive include="ParamsPanel,PresetsPanel,BenchPanel">` 包裹 `<component :is>` 动态组件（KeepAlive 作为稳定父容器），各面板组件通过 `defineOptions({ name })` 提供缓存身份。经浏览器实测（setup 执行计数法）确认：切换 basic→bench 后组件不重新执行 setup，测试历史保留。
  - **测试历史清空按钮**：测试历史卡片标题栏新增「清空历史」按钮（复用 Card actions 插槽），应用运行期间可手动清空全部测试记录；无记录时按钮禁用。内存态数据关闭应用后自然清空。
  - **多次测试重启竞态修复**：`onRunTest` 原先在参数不一致时手动 `server.stop()` 后立即 `server.start()`——`taskkill` 杀进程是异步的，`exit` 事件触发前 `launcher.proc` 仍指向旧进程，`start()` 会误判 `Server is already running`，多次快速测试时偶发旧服务未停就启新服务。修复：统一改用 `server.restart()`——core 的 `Launcher.restart()` 在运行中会 `proc.once('exit', () => start)` 等旧进程退出后再启动新进程（未运行时直接 start），从根因消除 stop→start 竞态。逻辑测试 7/7 通过（未运行启动、运行一致复用、运行不一致重启、metrics 未启重启、修复前竞态复现、修复后消除）。
  - **重启后端点无法访问修复**：`waitRunning` 原先在 `server.status === 'running'` 时立即返回 true——但 `launcher.restart()` 是异步的（等旧进程 exit 后启动新进程），restart 调用后 `server.status` 可能仍是**旧进程的 running 残留**，此时立即发测试请求会在新进程模型尚未加载完成时访问端点（端点无法访问）。修复：`waitRunning` 增加两阶段等待——restart 场景先等状态**离开 running**（旧进程退出），再等重新进入 running（新进程加载完成）；每轮轮询 `server.refreshStatus()` 获取最新状态。复用场景（restarting=false）保持直接通过。逻辑测试 6/6 通过（旧 running 残留不误判、复用不卡、未运行 restart、超时）。
  - **启动失败不再卡在"等待服务就绪"**：模型/参数配置错误导致 llama-server 启动失败时（如 `failed to create MTP context`），进程 exit 后状态停在 `stopped` 且 pid 为 null，原 `waitRunning` 会一直等到 180s 超时。修复：`waitRunning` 增加启动失败检测——连续 4 次轮询（~1.2s）看到 `stopped` + `pid === null` 即判定失败并立即返回（区分 restart 时旧进程退出的短暂 stopped 中间态），返回类型改为 `'ok' | 'timeout' | 'failed'`；`onRunTest` 对 failed 显示「服务启动失败（模型/参数配置错误？请查看控制台日志）」（新增 `bench_status_failed`），不再无谓等待。逻辑测试 5/5 通过。
  - **控制台切回时自动滚动到底部**：LaunchPage 原只 watch `server.outputs.length` 滚动——从其他页面切回控制台时（keep-alive 缓存组件，outputs.length 未变化）watch 不触发，内容停留在旧位置。修复：新增 `onActivated` 钩子，切回本页时调用 `scrollConsoleToBottom()` 滚动到最底部，确保看到最新日志。
  - **切换回草稿模型模式自动填入路径**：从 draft-dflash/draft-simple 等外部草稿类型切到 draft-mtp/ngram（`syncDependencies` 清空 `spec_draft_model`）后，再切回外部草稿类型时草稿模型路径不会自动填入（`detectDraftModel` 原只在模型切换时调用）。修复：`set('spec_type', ...)` 检测到新值为外部草稿类型且 `spec_draft_model` 为空时，自动重新调用 `detectDraftModel` 检测并填入路径；路径已有值时不重复检测。逻辑测试 12/12 通过（draft-mtp→draft-dflash 自动填入、ngram→draft-simple 自动填入、路径已有不重复、切 none 不触发）。

### 重构

- **参数设置合并为单页标签页**：原 BasicParamsPage / AdvancedParamsPage / ServerParamsPage / PresetsPage 合并为 `ParamsPage.vue`（基础 / 高级 / 服务端 / 预设四个标签页），路由 `/basic`、`/advanced`、`/server`、`/presets`、`/sampling` 统一重定向到 `/params?tab=...`。
- **引擎配置移到模型管理页**：原控制台页面顶部的引擎目录配置卡片从 LaunchPage 移到 ModelsPage 顶部，顺序为引擎配置 → 模型目录 → 模型列表 → 元数据/建议。
- **启动校验逻辑去重**：新建 `useStartServer.ts` 抽取 `canStartSync` / `canStartAsync` + 跨页跳转逻辑，TopBar 与 LaunchPage 共用（消除原有两处重复实现）。
- **侧边栏导航重排**：去掉"参数设置"可折叠分组，新顺序为模型管理 → 参数设置（单入口，任一分组有改动显示橙点） → 控制台 → 模型下载。
- **模型切换统一入口**：新建 `params.applyModel(path)` 统一模型切换逻辑（清理控制台 + 设置模型 + 并行检测 mmproj + 加载 GGUF），`params.applyModelWithSuggestions` 用于「应用建议参数」场景（重置 + 恢复模型 + 重检 mmproj + 批量应用），ModelsPage 与 TopBar 切换均走统一入口。
- **GGUF 状态收归 store**：原 ModelsPage 本地 `ggufInfo` / `ggufSuggestions` / `ggufLoading` / `ggufError` 状态与 `autoDetectMmproj` / `loadGgufMetadata` 函数全部移除，统一由 `params.ts` store 管理，模板直接读 `params.ggufInfo/ggufSuggestions`。
- **预设管理提取为独立组件**：预设功能从 PresetsPage 提取为 `PresetsPanel.vue` 组件 + `useAutoPresetName.ts` 组合式函数，ParamsPage 嵌入 PresetsPanel。

### 文档

- `docs/frontend.md`：章节 7.1 路由表更新（新增 `/params` + 旧路由重定向）、7.3 页面表更新（7 页 → 4 页）、7.5 样式系统补充下拉面板、版本从 1.4.0 → 1.4.1。
- `AGENTS.md`：页面数 7 → 4，打包输出版本 1.4.0 → 1.4.1，参数表 55 → 56。
- `docs/README.md`：参数数量 54 → 56，打包输出版本 1.4.0 → 1.4.1。
- `docs/params/LLAMA_SERVER_PARAMS.md`：参数总数 54 → 56，新增 `spec_cache_type_k` / `spec_cache_type_v` / `spec_draft_ngl` 文档。

---


### 修复
- **版本号显示不一致**：侧边栏通过 `APP_VERSION` 显示版本，但 `packages/shared/src/params/definitions.ts` 中的 `APP_VERSION` 仍停留在 `1.2`，与 `package.json` 的 `1.4.0` 不一致。已同步为 `1.4.0`，并更新 `AGENTS.md` 与 `docs/packaging.md` 的版本一致性检查清单，明确包含 `APP_VERSION`。
- **内存泄露风险**：修复 `App.vue`、`LaunchPage.vue`、`StatusBar.vue` 中 `setTimeout` 未在组件卸载时清理的问题；`window.ts` 在窗口关闭时显式移除 resize/move/maximize/unmaximize/leave-full-screen 事件监听；`DownloadManager.clearFinished()` 增加对段、速度定时器、元数据定时器的防御性清理。
- **打包失败**：
  - `apps/desktop/node_modules/@llama-launcher/{core,shared}` 在 `shamefully-hoist=true` 或打包失败后可能变为循环/损坏符号链接，导致 `beforePack` 跳过处理、electron-builder 报 `The name of the file cannot be resolved by the system`。`scripts/before-pack.cjs` 现在检测损坏链接并移除，回退到 root `node_modules/@llama-launcher/{core,shared}` 作为来源；`scripts/after-pack.cjs` 在恢复时增加目标有效性回退。
  - `release/` 目录被 Defender/索引器/残留进程锁定时，`scripts/clean-before-pack.cjs` 6 次删除均会失败。新增终极容错：将 locked `release/` 重命名为 `release_stuck_<timestamp>` 并新建空的 `release/`，保证打包流程不中断；同时清理历史 `release_stuck_*` 与更多遗留临时目录。
  - 新增 `scripts/dist-with-fallback.cjs` 包装 electron-builder：`pnpm dist` 现在自动调用该脚本，先执行 `clean-before-pack.cjs`，再在 `release/` 仍被锁定时自动切换到 `release-tmp-<timestamp>` 临时输出目录，打包完成后尝试将产物迁回 `release/`；Windows 下对锁定的目录还会尝试 `robocopy /MIR` 直接覆盖目标文件，无需先删除目录。产物部分或全部迁回时都会给出明确的后续提示。`apps/desktop/package.json` 的 `dist` 脚本已改为 `pnpm build && node ../../scripts/dist-with-fallback.cjs`。
  - **二次打包仍被锁定**：`clean-before-pack.cjs` 原只 `taskkill /IM "llama Launcher.exe"`，无法匹配 portable 产物 `llama Launcher 1.4.0.exe` 的进程名，导致验证后二次打包时 `release/` 仍被占用。现改用 PowerShell 按名称通配符 `llama Launcher*.exe` + 可执行路径前缀双重匹配终止进程，杀进程后增加 1 秒句柄释放等待，并清理历史 `release-tmp-*` 临时目录。`dist-with-fallback.cjs` 的 `isDirLocked` 改为通过尝试重命名目录来探测锁定（目录内可写不代表整体可替换），产物回迁时对锁定文件增加 `copyFileSync` 覆盖回退；`robocopy`/`copyFileSync` 成功后还会清理对应的源目录/源文件，避免 `release-tmp-*` 残留。
  - **打包流程报错噪音与重试时间优化**：`release/` 被 Defender/索引器的文件系统过滤驱动锁定时，程序化重试无法突破。`clean-before-pack.cjs` 重试从 6×5s（30s）降至 2×3s（6s），rename 失败时不再 `console.error` 而改为 `console.log` 提示将走 fallback；新增关闭指向 `release/` 的 Explorer 窗口（通过 COM `Shell.Application`）。`dist-with-fallback.cjs` 的 fallback 检测改用 `console.log`（非 `warn`），并在打包完成后打印 `BUILD SUCCEEDED` / `BUILD FAILED` 摘要。

### 变更

- **HuggingFace 镜像下载支持**：新增 `huggingface-client.ts`，通过 `hf-mirror.com` 镜像访问 HuggingFace API 列出仓库文件。`url-parser` 识别 `huggingface.co` 与 `hf-mirror.com` 均为 `source: 'huggingface'`，DownloadCard 跳过 ModelScope 搜索直接走镜像链路。
- **可注入网络传输层**：新增 `DownloadTransport` / `HfHttpTransport` 接口，Electron 主进程注入基于 `net` 模块（Chromium 网络栈）的传输，规避 Electron 内置 Node 的 BoringSSL TLS 指纹被 hf-mirror.com 拒绝（`read ECONNRESET`）的问题。仅 `hf-mirror.com` 走注入传输，其余源（ModelScope 等）继续走 `node:https`。删除已失效的 `http2-pool.ts`（Node http2 同样使用 BoringSSL，被 RST）。
- **动态段数下载算法**：`computeSegmentCount` 按文件大小递增段数（<100MB→1、<1GB→2、<5GB→4、<20GB→6、≥20GB→8），配合 `SEGMENT_TARGET_SIZE`(50MB) 与 worker 队列模型，消除尾段瓶颈。进度推送间隔从 1s 降至 500ms。
- **移除参数设置页命令预览**：`BasicParamsPage`、`AdvancedParamsPage`、`ServerParamsPage` 不再显示底部命令预览条；删除 `CommandPreviewBar.vue` 组件、对应的 `shared/src/command-preview.ts` 死代码及 `lbl_command_preview` i18n 键。启动页（LaunchPage）保留独立的命令预览卡片。
- **状态栏模型名优先显示别名**：底部状态栏 `StatusBar.vue` 的模型名现在优先读取 `alias` 参数，无别名时回退到模型文件名；复制模型名时也使用 alias 后的名称。

### 测试

- 新增 5 项 `gguf-meta` 单元测试：覆盖新增的 16 个元数据字段提取与 7 个采样参数建议推导。
- 全部测试通过：188/188 → 200/200。

---

## [1.4.0] - 2026-07-25

### 新增功能

#### 下载功能优化
- **下载速度优化**：≥100MB 文件自动切分为 4 段并行下载；写入流 `highWaterMark` 提升至 4MB；HTTP Agent 启用 `keepAlive: true` 与 `maxSockets: 64`，整体吞吐接近或超过浏览器直链下载。
- **暂停/恢复/重试**：
  - 新增 `download:pause` / `download:resume` 两个 IPC 通道（IPC 总通道数 46 → 48）。
  - 下载任务卡片按状态显示「暂停 / 恢复 / 重试 / 取消」按钮。
  - 暂停时保留部分文件与元数据（`.llama_dl.json`），恢复时按段续传，零重复下载。
  - 失败任务可一键重试，无需重新选择文件。
- **量化标签分类**：
  - 文件名解析器 `parseQuantization` 支持 9 个量化系列：K-quants（Q4_K_M）、I-quants（IQ3_XS）、Legacy（Q8_0）、FP8（含 e4m3/e5m2 变体）、BF16、FP16/F16、FP32/F32、INT2/4/8。
  - 文件列表与下载任务列表均显示按系列着色的徽标（如 Q4_K_M 蓝色、IQ3_XS 紫色、FP8 橙色）。
  - 鼠标悬停徽标显示位宽信息（如「Q4_K_M (4-bit)」）。
- **量化解析容错**：
  - 使用 `(?![a-z0-9])` 边界，允许 `fp8_mixed`、`bf16-instruct` 这类下划线/中划线后缀。
  - `\b` 防止 `iq3_small`、`f16c` 这类非量化串被误识别。

### 修复

- **断点续传双重计数 Bug**：分段恢复时 `position` 计算错误（`start` 与 `segment.downloaded` 都包含已下载量），导致「Segment received more data than expected」错误。修复为 `segment.start + segment.downloaded`。
- **状态覆盖 Bug**：`executeDownload` 的 catch 块会覆盖 `pause/cancel` 已设置的目标状态。增加 `cur.status === 'downloading'` 守卫，仅在真正下载中才标记失败。
- **未处理的异步错误**：上述两个 Bug 的组合导致测试在销毁管理器时产生未处理的 Promise 拒绝，已修复。

### 打包修复

- **修复打包后应用无法启动/无窗口的问题**：
  - 根因：pnpm workspace 在 Windows 上使用 junction 链接 `node_modules/@llama-launcher/{core,shared}`，原 `before-pack.cjs` 仅检测 symlink，导致 electron-builder 把包含过时 `dist/` 甚至 `src/`、`tests/` 的整目录打包进 asar。运行时 `shared/dist` 缺少新增 IPC 通道，主进程注册 handler 时触发 `Attempted to register a second handler for 'undefined'`，应用启动后无窗口。
  - 修复 [`scripts/before-pack.cjs`](../scripts/before-pack.cjs)：使用 `fs.realpathSync` 检测 junction/symlink；无论原路径是链接还是真实目录，都重建为仅含 `package.json` + `dist/*.js` 的真实目录；保存 `.pack-link-map.json` 供 afterPack 恢复。
  - 修复 [`scripts/after-pack.cjs`](../scripts/after-pack.cjs)：读取 link map，删除临时真实目录并恢复原始 junction/symlink，避免破坏 pnpm 开发环境。
- **强化打包前清理**：
  - 更新 [`scripts/clean-before-pack.cjs`](../scripts/clean-before-pack.cjs)：先终止所有运行中的 `llama Launcher.exe`；对 `release/` 删除增加 6 次重试 × 5 秒间隔，并在 Node.js `fs.rmSync` 失败时通过 **重命名 + `cmd rd /s /q`** 绕过 Windows `mmap`/Defender 句柄锁定。
- **版本一致性与配置恢复**：
  - `apps/desktop/package.json` 与 workspace root `package.json` 版本统一提升至 **1.4.0**。
  - 临时为绕过文件锁改到 `release-fixed` 的输出已还原为 `release/`，并清理了 `release-fixed`、`release-1.3.0-backup`、`release_stuck_*`、`release_v1.4.0_fix` 等临时目录。
  - 修复了根目录 `package.json` 被意外覆盖为 desktop package.json 的问题，恢复 root workspace 配置（`scripts.dev/build/lint/test`、`packageManager: pnpm@10.12.1`、`turbo` 依赖）。
- **验证**：打包产物 `release/llama Launcher 1.4.0.exe` 可正常启动并显示主窗口；`pnpm lint` 与 188 项测试全部通过。

### 测试

- 新增 10 项 `parseQuantization` 单元测试：覆盖 K-quants、I-quants、Legacy、FP8/BF16/FP16/FP32/INT 系列，以及 `Qwen3-4B-Instruct`（非量化）不被误识别。
- 新增 5 项 `pauseDownload` / `resumeDownload` 单元测试：覆盖暂停后状态切换、恢复后从断点续传完成、错误任务重试、不存在任务与非暂停状态。
- 全部测试通过：188/188。

### 国际化

- `zh.ts` / `en.ts` 新增键：`btn_pause_download`、`btn_resume_download`、`btn_retry_download`、`lbl_quantization`、`lbl_quant_tooltip`、`status_paused`。

### 文档

- `docs/core-modules.md`：`4.6 在线下载` 章节更新（含多段并行、暂停/恢复、量化解析说明）。
- `docs/packaging.md`：新增 `11. 打包配置` 及子章节，记录 junction 检测、beforePack/afterPack 机制、clean-before-pack 重试策略、常见打包故障与版本一致性检查清单。
- `docs/packaging.md`：新增 `11.3 输出目录锁定回退` 记录 `dist-with-fallback.cjs` 的自动回退与产物回迁机制；常见打包故障表同步更新。
- `docs/testing.md` / `docs/design-decisions.md`：测试统计更新为 15 个测试文件 / 188 个用例；关键设计决策新增「打包健壮性」。
- `AGENTS.md`：
  - IPC 通道数 46 → 48，打包输出版本 1.3.0 → 1.4.0。
  - 新增打包规范：junction 检测、输出目录稳定性、workspace root `package.json` 保护、版本一致性、打包后启动验证。
  - 在「打包经验」中 refer 到 `docs/packaging.md` §11，并说明 `pnpm dist` 现在使用 `dist-with-fallback.cjs` 自动处理输出目录锁定。
- `docs/README.md`：参数数量 40 → 47，IPC 通道数 46 → 48，下载特性补充暂停/恢复/重试，打包输出版本 1.3.0 → 1.4.0。

## [1.3.0] - 2026-07-21

### 新增功能

- 思考控制参数（reasoning mode、token budget、output format、budget exhaustion prompt）。
- 高级参数页新增「思考控制」分组，参数总数 43 → 47。

## [1.2.0] - 更早

历史版本，未在此详列。
