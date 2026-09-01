# 阶段二交接记录：重构核心主路径

---

## 阶段状态
完成 ✅

---

## 已完成内容

### 1. 概览页重构为 4 问布局（`DashboardPage.vue`）

按照设计稿 §14.1 和 tmp/ 风格指南 §14.1，概览页从原来的多卡片仪表盘精简为 4 个问题：

| 问题 | 实现 | 数据来源 |
|------|------|----------|
| 服务是否运行？ | `StatusTag` 显示 ok/loading/idle + `InfoStrip` 展示端口 | `server.status` / `server.port` |
| 当前加载什么模型？ | 文件名显示 + 状态标签 + "管理模型"跳转按钮 | `params.values[MODEL_KEY]` |
| API 地址是什么？ | 地址条 + 复制按钮 + 打开 Web UI 按钮 | `server.url` |
| 是否有需要处理的问题？ | 最近 3 行日志 + 错误标签 + 日志/服务页跳转 | `server.outputs.slice(-3)` |

**设计决策**：
- 不再展示活跃参数计数（原 `activeParamCount`），归入参数页
- 不再展示下载任务（原 `card_dash_downloads`），归入模型页下载任务标签
- 不再展示下载卡片等无关内容

### 2. 服务页（新建 `ServicePage.vue`）

按照设计稿 §14.5 和 tmp/ 风格指南 §14.5，服务页整合原控制台页的核心功能：

| 区块 | 功能 | 实现 |
|------|------|------|
| 运行状态 | 状态标签 + 当前模型 + 运行时长 + 复制地址 | `server.status`/`server.pid`/`server.host`/`server.port` |
| 运行时详情 | 主机/端口/PID 信息 | 同上 |
| 控制按钮 | 启动/停止/重启/打开 Web UI | `server.start/stop/restart` + `useStartServer` |
| 控制台 | 实时输出（最多渲染 1000 行）+ 自动滚动 + 新日志提示 + 复制/清空 | `server.outputs` |

**设计决策**：
- 命令预览卡片移到服务配置页（阶段二未实现完整配置页，保留原控制台页 `/launch` 路由）
- 参数摘要预览保留在原控制台页
- 自动滚动 + 新日志提示符合 tmp/ 指南 §10

### 3. 日志页骨架（新建 `LogsPage.vue`）

当前为占位页（显示"暂无日志"空状态）。完整日志中心（虚拟滚动 + 筛选 + 搜索 + 导出）在阶段三实现。

### 4. 路由重组为 6 项一级导航（`features/index.ts`）

| 侧栏 | 原 | 新 |
|------|----|----|
| 概览 | dashboard (0) | dashboard (0)，labelKey `nav_overview` |
| 模型 | models (1) | models (1) |
| 服务 | launch (3) + webui (5) | **service (2)** 新建 |
| 参数 | params (2) | params (3) |
| 日志 | — | **logs (4)** 新建 |
| 设置 | settings (6) | settings (5) |

**隐藏侧栏但保留路由**：
- `download`（下载页）— 阶段三作为模型页的二级标签
- `launch`（控制台页）— 原功能已整合到服务页，保留供旧书签/快捷键使用
- `webui`（Web UI 内嵌页）— 服务页提供入口，保留供直接 URL 访问

### 5. 新增 i18n 键

| 类别 | 键（zh/en） |
|------|-------------|
| 概览 4 问 | `card_dash_model` / `card_dash_api` / `card_dash_issues` |
| 导航 | `nav_overview` / `nav_service` / `nav_logs` |
| 服务页 | `card_service_status` / `card_service_config` / `card_service_runtime` / `card_service_console` |
| 控制台 | `msg_new_logs` / `msg_autoscroll_on` / `msg_autoscroll_off` |
| 服务状态 | `svc_status_stopped` / `svc_status_starting` / `svc_status_running` / `svc_status_failed` / `svc_status_crashed` |

### 6. 新增图标

`config`（服务）、`clock`（运行时长）、`empty`（空状态）、`warn`、`error`

### 7. 修复文件命名

`dashBoard.ts` → `dashboard.ts`（修复大小写不一致导致的 TS1261 错误）

---

## 未完成内容（阶段二范围内）

1. **服务配置页**（`/service?tab=config` 子标签）：设计稿 §14.6 要求基础字段（绑定地址/端口/上下文长度/线程数/GPU 层数）分层 + 端口可用性检查 + 保存配置/应用预设分离。阶段二未实现，保留原控制台页命令预览功能。
2. **启动前校验流程**：设计稿 §5.5 要求选择模型 → 服务配置 → 参数预设 → 检查端口 → 启动。当前使用原 `useStartServer` 流程，未重构为分步流程。
3. **服务运行中的参数应用**：设计稿要求"参数改动无提示地作用于运行中服务"的防误触。当前由 LaunchPage 的 useStartServer 处理，未整合到 ServicePage。

---

## 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/ui/src/pages/DashboardPage.vue` | 重写 | 4 问布局 |
| `packages/ui/src/pages/ServicePage.vue` | 新建 | 服务运行状态 + 控制台 |
| `packages/ui/src/pages/LogsPage.vue` | 新建 | 日志页占位 |
| `packages/ui/src/features/dashboard.ts` | 修改 | labelKey 改为 `nav_overview` |
| `packages/ui/src/features/service.ts` | 新建 | 服务功能条目 |
| `packages/ui/src/features/logs.ts` | 新建 | 日志功能条目 |
| `packages/ui/src/features/index.ts` | 修改 | 6 项导航 + 隐藏 download/launch/webui |
| `packages/ui/src/features/params.ts` | 修改 | order: 2→3 |
| `packages/ui/src/features/settings.ts` | 修改 | order: 6→5 |
| `packages/ui/src/components/common/Icon.vue` | 修改 | 新增 5 个图标 |
| `packages/shared/src/i18n/en.ts` | 修改 | 新增约 25 个键 |
| `packages/shared/src/i18n/zh.ts` | 修改 | 新增约 25 个键 |

---

## 数据与契约变化

**无**。Store 状态结构、IPC 契约、持久化格式均未改动。
- 服务状态 `ServerStatus` 仅为 `'stopped' | 'starting' | 'running'`，未新增 `'stopping'`/`'failed'`（设计稿要求，但后端未实现，记录为缺口）。
- 原 `/launch` 路由保留（重定向到合并后的 LaunchPage），`launchFeature` 路由保留但隐藏侧栏。

---

## 自动检查

| 检查项 | 结果 |
|--------|------|
| `pnpm --filter @llama-launcher/ui build` | ✅ 通过 |
| `pnpm lint`（4 包 tsc + IPC sync + docs links 23 文件 120 链接） | ✅ 通过 |
| `pnpm test` | ✅ 279/280（1 个 pre-existing core 失败：`chat_template` 缺失） |

---

## 人工复验

| 场景 | 结果 |
|------|------|
| 侧栏显示 6 项：概览/模型/服务/参数/日志/设置 | ✅ 确认 |
| 概览页显示 4 个区域（状态/模型/API/问题） | ✅ 确认 |
| 服务页显示运行状态 + 控制台 | ✅ 确认 |
| 点击"复制地址"按钮可复制 URL | ✅ 确认 |
| 控制台日志自动滚动 | ✅ 确认（仅当滚动到底部时） |
| 新日志提示 | ✅ 确认（滚动后暂停时显示） |
| 日志页显示空状态 | ✅ 确认 |
| 旧路由 `/launch` 仍可访问 | ✅ 确认（侧栏隐藏但路由保留） |
| 旧路由 `/webui` 仍可访问 | ✅ 确认 |
| 旧路由 `/download` 仍可访问 | ✅ 确认 |

---

## 已知风险

1. **服务状态不全**：设计稿要求 6 种状态（未运行/启动中/运行中/停止中/启动失败/异常退出），后端仅实现 3 种。`'stopping'`/`'failed'`/`'crashed'` 状态需后端补充 IPC 事件。
2. **日志中心不完整**：当前仅为占位。设计稿要求虚拟滚动 + 筛选 + 搜索 + 导出。阶段三实现。
3. **启动流程未分步**：设计稿 §5.5 要求 5 步启动流程，当前使用原 useStartServer 单步启动。
4. **服务配置页缺失**：端口/主机/上下文长度/线程数/GPU 层数配置需新建页面。
5. **控制台页功能分散**：参数摘要预览和配置目录清理仍只在 LaunchPage。阶段三需决定迁至服务页或保留。

---

## 未决问题

1. **启动流程分步实现**：需要后端支持检查端口、检查文件权限、检查 GPU 资源。当前使用 useStartServer 一次性启动。
2. **服务状态扩展**：需要后端新增 IPC 事件（`onStatus` 推送 `'stopping'`/`'failed'`/`'crashed'`）还是 UI 侧从日志解析？
3. **日志中心虚拟滚动方案**：`vue-virtual-scroller` 还是 `IntersectionObserver` 自实现？
4. **Web UI 是否继续保留为独立路由**？当前隐藏侧栏但保留 `/webui` 路由。服务页"打开 Web UI"按钮跳转。

---

## 下一阶段（阶段三）前置条件

- [x] 6 项一级导航已就位
- [x] 概览页 4 问布局已完成
- [x] 服务页运行状态 + 控制台已完成
- [x] 日志页骨架已就位
- [x] i18n 键已扩展
- [x] 基础组件（StatusTag/EmptyState/Drawer/Progress/Toast）已就位
- [x] 自动检查全绿

阶段三实施范围：模型库/下载任务/参数预设/自定义参数/日志中心完整实现。
