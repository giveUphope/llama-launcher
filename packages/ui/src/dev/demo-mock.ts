// 开发预览演示数据（仅浏览器 mock 环境注入，Electron 真实 api 不受影响）。
// main.ts 在无 Electron preload 时调用 createDemoApi()，让预览环境呈现完整业务状态，
// 便于目测 UI 布局与交互。数据为静态仿真 + 周期性模拟服务日志/下载进度。
import { PARAMS, APP_VERSION, parseQuantization, formatBytes } from '@llama-launcher/shared';
import type {
  AppSettings, ModelInfo, Preset, GgufReadResult,
  ParsedModelUrl, OutputEntry, AppLogEntry,
  ModelScopeSearchResult, ModelScopeFileListResult,
  DownloadProgressPayload, DownloadCompletePayload,
  ParamDef, TargetRecommendation,
  ServerStatus, ServerStatusEvent, ServerStopInfo,
} from '@llama-launcher/shared';

const ENGINE_DIR = 'D:/Models/llama-bins';
const MODELS_DIR = 'D:/Models';
/** 体检演示作业的轮询计数（path → 已轮询次数，≥2 转 done） */
const mockBenchCalls: Record<string, number> = {};

// ---- 简化命令构建（规则与 core/command-builder 对齐，仅用于浏览器预览环境）----
// 「还原命令」依赖 previewCommand 按当前参数重新生成：此前的硬编码命令与参数无关，
// 导致还原后用户手输的内置参数值丢失。规则要点：checkbox 恒发射 flag/invert_flag、
// 空串与默认值跳过、dependsOn 不满足跳过、spec_type 'draft-model'→'draft-simple'、
// float 保留 2 位小数、含空格参数引号包装。
type DemoValues = Record<string, string | number | boolean>;

function isDepMet(dep: NonNullable<ParamDef['dependsOn']>, values: DemoValues): boolean {
  const depDef = PARAMS.find((p) => p.key === dep.key);
  if (!depDef) return false;
  let depValue = values[dep.key];
  if (depDef.key === 'spec_type' && depValue === 'draft-model') depValue = 'draft-simple';
  if (depDef.type === 'checkbox') {
    const b = depValue === true || depValue === 'true' || depValue === 1 || depValue === '1';
    if (!b) return false;
  } else if (depValue === depDef.default) {
    return false;
  }
  const s = String(depValue);
  if (dep.notValues && dep.notValues.includes(s)) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(s)) return false;
  return true;
}

function quoteArg(s: string): string {
  if (/[\s"]/.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

function buildDemoPreviewCommand(values: DemoValues, settings: AppSettings): string {
  const cmd: string[] = [settings.server_exe];
  if (values.model) cmd.push('-m', String(values.model));
  for (const p of PARAMS) {
    const v = values[p.key];
    if (v === undefined) continue;
    if (p.type === 'checkbox') {
      if (v === true) cmd.push(p.flag);
      else if (p.invert_flag) cmd.push(p.invert_flag);
      continue;
    }
    if (v === '') continue;
    if (p.dependsOn && !isDepMet(p.dependsOn, values)) continue;
    if (v === p.default) continue;
    if (p.type === 'float_slider') {
      cmd.push(p.flag, String(Math.round(Number(v) * 100) / 100));
      continue;
    }
    const s = String(v);
    cmd.push(p.flag, p.key === 'spec_type' && s === 'draft-model' ? 'draft-simple' : s);
  }
  return cmd.map(quoteArg).join(' ');
}

// ---- 模型目录（模型页「本地模型」列表） ----
const DEMO_MODELS: ModelInfo[] = [
  { name: 'Qwen3-32B-A3B-Instruct-Q4_K_M.gguf', path: `${MODELS_DIR}/Qwen3-32B-A3B-Instruct/Qwen3-32B-A3B-Instruct-Q4_K_M.gguf`, size: 20899999988, size_str: '19.5 GB', modified: '2026-08-20T09:12:00.000Z' },
  { name: 'Qwen3-8B-Instruct-Q8_0.gguf', path: `${MODELS_DIR}/Qwen3-8B/Qwen3-8B-Instruct-Q8_0.gguf`, size: 8624000000, size_str: '8.0 GB', modified: '2026-08-18T15:40:00.000Z' },
  { name: 'gemma-3-27b-it-QAT_Q4_K_M.gguf', path: `${MODELS_DIR}/gemma-3-27b/gemma-3-27b-it-QAT_Q4_K_M.gguf`, size: 16139999999, size_str: '15.0 GB', modified: '2026-08-12T08:03:00.000Z', tags: ['mmproj'] },
  { name: 'Qwen3-VL-4B-Instruct-fp8.gguf', path: `${MODELS_DIR}/Qwen3-VL-4B/Qwen3-VL-4B-Instruct-fp8.gguf`, size: 5136000000, size_str: '4.8 GB', modified: '2026-08-02T20:21:00.000Z', tags: ['mmproj', 'dflash'] },
  { name: 'Llama-3.2-1B-Instruct-Q6_K.gguf', path: `${MODELS_DIR}/Llama-3.2-1B/Llama-3.2-1B-Instruct-Q6_K.gguf`, size: 903000000, size_str: '861 MB', modified: '2026-07-28T11:45:00.000Z' },
  { name: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf', path: `${MODELS_DIR}/DeepSeek-R1-7B/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf`, size: 4500000000, size_str: '4.2 GB', modified: '2026-07-20T16:00:00.000Z' },
];

// ---- GGUF 元数据（模型信息卡 + 建议参数） ----
const DEMO_GGUF: GgufReadResult = {
  info: {
    path: DEMO_MODELS[0].path,
    version: 3,
    tensor_count: 483,
    metadata_kv_count: 39,
    metadata: {} as never,
    architecture: 'qwen3',
    // 与首个演示模型的文件名（去 .gguf）一致，保证模型列表 / 内置信息 / 建议参数互相对应
    name: 'Qwen3-32B-A3B-Instruct',
    quantization: 'Q4_K_M',
    file_type: 15,
    quantization_version: 2,
    type: 'model',
    finetune: null,
    basename: 'qwen3',
    size_label: '32B (A3B)',
    context_length: 32768,
    embedding_length: 4096,
    feed_forward_length: 1280,
    block_count: 64,
    attention_head_count: 32,
    attention_head_count_kv: 8,
    attention_key_length: 128,
    attention_value_length: 128,
    attention_layer_norm_rms_epsilon: 1e-6,
    expert_count: 128,
    expert_used_count: 8,
    full_attention_interval: null,
    nextn_predict_layers: null,
    chat_template: 'qwen3',
    rope_freq_base: 1000000,
  } as never,
  // 与 core buildSuggestions 输出同构：附件守卫后仅主模型生成；ctx_size 为训练上限信息
  // 不再进入建议（-c 默认 0 = 从模型加载）；采样建议来自 general.sampling.*（作者推荐值）
  suggestions: [
    { key: 'temperature', value: 1, source: 'general.sampling.temp' },
    { key: 'top_k', value: 20, source: 'general.sampling.top_k' },
    { key: 'alias', value: 'Qwen3-32B-A3B-Instruct-Q4_K_M', source: 'general.name+file_type+filename' },
    { key: 'cache_type_k', value: 'q8_0', source: 'general.file_type' },
    { key: 'cache_type_v', value: 'q8_0', source: 'general.file_type' },
    { key: 'flash_attn', value: 'on', source: 'qwen3.context_length' },
  ] as never,
};

// ---- 参数预设（参数设置页「预设」） ----
const DEMO_PRESETS: Preset[] = [
  {
    preset_version: 2, name: 'qwen3-32b-chat',
    created_at: '2026-08-20T09:00:00.000Z', saved_at: '2026-08-26T18:30:00.000Z',
    app_version: APP_VERSION, model: 'D:/models/qwen3-32b/qwen3-32b-q4_k_m.gguf',
    values: { ctx_size: 32768, n_gpu_layers: 99, temperature: 0.7 },
  },
  {
    preset_version: 2, name: '高占用-双卡',
    created_at: '2026-08-19T14:00:00.000Z', saved_at: '2026-08-21T10:05:00.000Z',
    app_version: APP_VERSION, model: 'D:/models/qwen3-32b/qwen3-32b-q4_k_m.gguf',
    values: { ctx_size: 16384, n_gpu_layers: 99, tensor_split: '1,1' },
  },
  {
    preset_version: 2, name: '低内存模式',
    created_at: '2026-08-10T09:00:00.000Z', saved_at: '2026-08-10T09:00:00.000Z',
    app_version: APP_VERSION, model: null,
    values: { ctx_size: 4096, n_gpu_layers: 12 },
  },
];

// ---- 应用日志（日志页初始内容） ----
const DEMO_APP_LOGS: AppLogEntry[] = [
  { kind: 'info', data: 'Service start requested (model: Qwen3-32B-A3B-Instruct-Q4_K_M.gguf)', ts: Date.now() - 62000 },
  { kind: 'success', data: 'Service listening on http://127.0.0.1:8080', ts: Date.now() - 58000 },
  { kind: 'info', data: 'Download started: Qwen3-8B/Qwen3-8B-Instruct-Q8_0.gguf', ts: Date.now() - 30000 },
  { kind: 'warn', data: 'Download paused: d1', ts: Date.now() - 18000 },
  { kind: 'info', data: 'Download resumed: d1', ts: Date.now() - 15000 },
];

// ---- 服务输出模拟（服务页控制台） ----
const LLAMA_LINES: string[] = [
  'ggml_cuda_init: found 1 CUDA device: NVIDIA GeForce RTX 4090',
  'llama_model_load_from_file: using device CUDA0 (NVIDIA GeForce RTX 4090) - 23999 MiB free',
  'llama_model_loader: loaded meta data with 39 key-value pairs and 483 tensors',
  'llama_model_loader: - tensor 0: text_embd.0.weight 4096 x 2640, type = Q4_K_M',
  'load_tensors: offloading 64 layers to GPU, model memory 12556.50 MiB',
  'llama_new_context_with_model: n_ctx = 32768',
  'llama-server: initialized, server listening on http://127.0.0.1:8080',
  'slot 0: ctx size = 32768 (2048.00 MB), n_parallel = 1',
  '{"timestamp":1756100000,"level":"INFO","function":"update_slots","line":1559,"msg":"n_slot = 1 - request processed OK"}',
];

// 启动演示 API：返回可挂载到 window.api 的对象。
export function createDemoApi() {
  // ---- 服务模拟状态 ----
  const serverOutputs: OutputEntry[] = [];
  const outputCbs: Array<(entries: OutputEntry[]) => void> = [];
  const statusCbs: Array<(e: ServerStatusEvent) => void> = [];
  let serverStatus: ServerStatus = 'running';
  // 与 core Launcher 同形状：状态与「停止事实」合成一条事件下发（渲染层据此区分 stopped/failed/crashed）
  let lastStop: ServerStopInfo | null = null;
  function emitStatus(s: ServerStatus, stop: ServerStopInfo | null = null): void {
    serverStatus = s;
    lastStop = s === 'stopped' ? stop : null;
    for (const cb of statusCbs) cb({ status: s, stop: lastStop });
  }
  /** 主动停止的停止事实（用户点停止/重启）——渲染层据此保持「已停止」而非「异常退出」 */
  function userStopInfo(hadBeenReady = true): ServerStopInfo {
    return { reason: 'stopped_by_user', code: null, signal: null, hadBeenReady, at: Date.now() };
  }
  let outputIdx = -1;
  let outputTimer: ReturnType<typeof setInterval> | null = null;
  // 运行中服务的参数快照（对齐 core getStatus().values：bench 复用/重启判定依赖它）
  let runningValuesSnapshot: Record<string, string | number | boolean> | null = null;

  function cloneValues(v: DemoValues): Record<string, string | number | boolean> {
    return JSON.parse(JSON.stringify(v ?? {})) as Record<string, string | number | boolean>;
  }

  function pushOutput(kind: string, data: string) {
    const entry = { kind, data: data + '\n', ts: Date.now() } as never as OutputEntry;
    serverOutputs.push(entry);
    // 真实 preload 走 SERVER_OUTPUT_BATCH（载荷恒为数组），mock 同形以免渲染层两套逻辑
    for (const cb of outputCbs) { try { cb([entry]); } catch { /* 忽略 */ } }
  }

  function startOutputFeed() {
    // 先回放已有行，之后每 2.5s 追加一行（模拟运行中的 llama-server 输出）
    if (outputTimer) return;
    let delay = 0;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        outputIdx = (outputIdx + 1) % LLAMA_LINES.length;
        pushOutput(outputIdx % 9 === 7 ? 'info' : 'stdout', LLAMA_LINES[outputIdx]);
      }, delay);
      delay += 160;
    }
    outputTimer = setInterval(() => {
      outputIdx = (outputIdx + 1) % LLAMA_LINES.length;
      pushOutput(outputIdx % 5 === 0 ? 'info' : 'stdout', LLAMA_LINES[outputIdx]);
    }, 2500);
  }
  setTimeout(startOutputFeed, 300);

  // ---- 下载模拟状态 ----
  const progressCbs: Array<(p: DownloadProgressPayload) => void> = [];
  const completeCbs: Array<(p: DownloadCompletePayload) => void> = [];

  /**
   * 每个模拟任务的进度游标与定时器。
   * pause/resume/cancel 必须真正改变模拟状态并回推对应 status——此前三个桩全是 no-op
   * （只 `Promise.resolve({ok:true})`），预览里点暂停/取消零反馈，既无法核对状态机，
   * 也无法验证按钮态切换（暂停↔恢复、取消移除行）。真实侧由 DownloadManager 发
   * `paused` / `canceled` 进度事件，这里保持同一事件契约。
   */
  interface DemoDl { fileName: string; total: number; done: number; timer: ReturnType<typeof setInterval> | null }
  const demoDownloads = new Map<string, DemoDl>();

  function emitProgress(id: string, dl: DemoDl, speed: number, status: string) {
    const payload = { id, downloadedSize: dl.done, totalSize: dl.total, speed, status } as never;
    for (const cb of progressCbs) { try { cb(payload); } catch { /* 忽略 */ } }
  }

  function stopFeed(id: string) {
    const dl = demoDownloads.get(id);
    if (dl?.timer) { clearInterval(dl.timer); dl.timer = null; }
  }

  function startFeed(id: string) {
    const dl = demoDownloads.get(id);
    if (!dl || dl.timer) return;
    // 与真实下载管理器同节奏：120ms 推一次、每次推进一小段（带抖动模拟网络波动）。
    // 曾用 8 步 × 900ms（12.5% 一跳），预览里看到的进度条就是"卡一下跳一大截"。
    const baseStep = Math.max(1, Math.floor(dl.total / 125));
    dl.timer = setInterval(() => {
      dl.done += Math.max(1, Math.floor(baseStep * (0.7 + Math.random() * 0.6)));
      if (dl.done >= dl.total) {
        dl.done = dl.total;
        stopFeed(id);
        emitProgress(id, dl, 0, 'downloading');
        demoDownloads.delete(id);
        const payload = { id, localPath: `${MODELS_DIR}/tmp/${dl.fileName}`, modelId: 'demo', fileName: dl.fileName, checksum: 'deadbeef' } as never;
        for (const cb of completeCbs) { try { cb(payload); } catch { /* 忽略 */ } }
      } else {
        emitProgress(id, dl, Math.round(90_000_000 * (0.8 + Math.random() * 0.4)), 'downloading');
      }
    }, 120);
  }

  // ---- settings ----
  const demoSettings: AppSettings = {
    server_exe: `${ENGINE_DIR}/llama-server.exe`,
    llama_dir: ENGINE_DIR,
    models_dir: MODELS_DIR,
    selected_model: DEMO_MODELS[0].path,
    last_preset: '',
    window_geometry: '',
    window_maximized: true,
    theme_mode: 'light',
    close_behavior: 'ask',
    sidebar_collapsed: false,
    language: 'zh',
    last_tab: '/dashboard',
    download_max_concurrent: 3,
    hf_mirror_host: '',
    custom_args: '',
  };

  return {
    settings: {
      load: () => Promise.resolve(demoSettings),
      save: () => Promise.resolve(),
    },
    models: {
      scan: (_dir: string, _opts?: { createIfMissing?: boolean }) => Promise.resolve(DEMO_MODELS),
      detectMmproj: () => Promise.resolve(''),
      detectDraft: () => Promise.resolve(''),
      readGgufMeta: (_path: string) => Promise.resolve({ ok: true, data: DEMO_GGUF }),
      watch: () => Promise.resolve({ ok: true }),
      remove: () => Promise.resolve({ ok: true }),
      onChanged: (cb: () => void) => { const iv = setInterval(cb, 60000); return () => clearInterval(iv); },
    },
    presets: {
      list: () => Promise.resolve(DEMO_PRESETS),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      load: (name: string) => Promise.resolve(DEMO_PRESETS.find((p) => p.name === name) ?? null),
    },
    server: {
      start: (values: never, _settings: never) => {
        emitStatus('starting');
        pushOutput('info', 'llama-server starting...');
        setTimeout(() => {
          runningValuesSnapshot = cloneValues(values as DemoValues);
          emitStatus('running');
        }, 1200);
        return Promise.resolve({ ok: true });
      },
      stop: () => { runningValuesSnapshot = null; emitStatus('stopped', userStopInfo()); pushOutput('info', 'llama-server stopped (signal: SIGTERM)'); return Promise.resolve({ ok: true }); },
      // 模拟 core Launcher.restart() 语义：运行中先离开 running（旧进程退出），再 starting → running（新进程就绪）
      restart: (values: never, _settings: never) => {
        runningValuesSnapshot = null;
        emitStatus('stopped', userStopInfo());
        pushOutput('info', 'llama-server stopped (restart)');
        setTimeout(() => {
          emitStatus('starting');
          pushOutput('info', 'llama-server starting...');
          setTimeout(() => {
            runningValuesSnapshot = cloneValues(values as DemoValues);
            emitStatus('running');
          }, 1200);
        }, 400);
        return Promise.resolve({ ok: true });
      },
      getStatus: () => Promise.resolve({ status: serverStatus, pid: 23508, host: '127.0.0.1', port: 8080, url: serverStatus === 'running' ? 'http://127.0.0.1:8080' : '', values: runningValuesSnapshot ? { ...runningValuesSnapshot } : null, stop: lastStop }),
      previewCommand: (values: never, settings: never) => Promise.resolve({
        ok: true,
        data: buildDemoPreviewCommand(values as DemoValues, settings as AppSettings),
      }),
      bench: () => Promise.resolve({
        ok: true,
        data: {
          single: { promptN: 16, promptPerSecond: 812.4, predictedN: 256, predictedPerSecond: 93.2, draftN: 0, draftNAccepted: 0, metricsDraftAccepted: 0, metricsDraftTotal: 0, metricsPredictedPerSecond: 93.2, elapsedMs: 2810, sampledAt: Date.now(), concurrency: 1 },
          concurrent: null,
        },
      }),
      onOutputBatch: (cb: (entries: OutputEntry[]) => void) => {
        outputCbs.push(cb);
        return () => { const i = outputCbs.indexOf(cb); if (i >= 0) outputCbs.splice(i, 1); };
      },
      onStatus: (cb: (e: ServerStatusEvent) => void) => {
        statusCbs.push(cb);
        return () => { const i = statusCbs.indexOf(cb); if (i >= 0) statusCbs.splice(i, 1); };
      },
    },
    clipboard: { write: () => Promise.resolve() },
    openExternal: () => Promise.resolve(),
    openPath: () => Promise.resolve({ ok: true }),
    window: {
      close: () => Promise.resolve(),
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      getState: () => Promise.resolve({ maximized: true }),
      onMaximized: () => () => {},
      onUnmaximized: () => () => {},
      onCloseDialog: () => () => {},
      respondCloseDialog: () => {},
    },
    system: {
      // 控制台设 globalThis.__mockExternalServer = true 可模拟「外部 llama-server 占用端口」
      // 场景（概览页外部实例徽章 / 启动冲突接管监控弹窗），默认关闭不影响常规演示流
      checkPort: () => Promise.resolve(
        (globalThis as unknown as { __mockExternalServer?: boolean }).__mockExternalServer
          ? { inUse: true, pid: 23508, name: 'llama-server.exe' }
          : { inUse: false },
      ),
      killProcess: () => Promise.resolve({ ok: true }),
      findFreePort: () => Promise.resolve(8081),
      fileExists: () => Promise.resolve(false),
      findLlamaExe: () => Promise.resolve(`${ENGINE_DIR}/llama-server.exe`),
      detectTrash: () => Promise.resolve({ trashCount: 0, trashFiles: [], detectDurationMs: 12 } as never),
      cleanTrash: () => Promise.resolve({ cleanedCount: 0, freedBytes: 0 } as never),
      listDir: () => Promise.resolve({ path: null, parent: null, entries: [], exists: true }),
      mkdir: () => Promise.resolve(true),
      // 显存估算演示数据：7900 XTX 空闲 23.2GB，权重 19.5GB；演示会话 ctx 32768（f16 KV ≈ 8 GiB）
      // → 显存总占用 28.5 GiB 超出空闲 → fits false（演示超限警示场景）；
      // occupancy 与 core estimateOccupancy 输出同构；目标建议与 core solveMaxContext 规则同构
      //（无固定封顶：ctx = 各目标 dtype 下显存(+内存联合)预算内的无 OOM 最大值）
      estimateVram: (_modelPath: string, dtype?: string, target?: string, _occ?: { ngl?: string; ctxSize?: number }) => {
        const t = target ?? 'balanced';
        const kv: Record<string, string> = { 'max-context': 'q8_0', balanced: 'q8_0', latency: 'f16', memory: 'q4_0' };
        // max-context：联合显存+内存预算（部分卸载 ngl 59/64 换上下文）推到训练上限；其余全卸载预算
        const ctx: Record<string, number> = { 'max-context': 32768, balanced: 20480, latency: 10240, memory: 32768 };
        const kvD = kv[t] ?? 'q8_0';
        const recs: TargetRecommendation[] = [
          { key: 'flash_attn', value: 'on', reasonKey: 'target_rec_fa' },
          { key: 'cache_type_k', value: kvD, reasonKey: 'target_rec_kv', reasonArgs: [kvD] },
          { key: 'cache_type_v', value: kvD, reasonKey: 'target_rec_kv', reasonArgs: [kvD] },
          { key: 'ctx_size', value: ctx[t] ?? 20480, reasonKey: t === 'max-context' ? 'target_rec_ctx_partial' : 'target_rec_ctx_full' },
        ];
        if (t === 'max-context') {
          recs.push({ key: 'gpu_layers', value: 59, reasonKey: 'target_rec_layers', reasonArgs: [59, 64] });
        }
        return Promise.resolve({
          devices: [{ id: 'Vulkan0', name: 'AMD Radeon RX 7900 XTX', totalMiB: 24560, freeMiB: 23749 }],
          weightsMiB: 19968,
          kvLayers: 64,
          kvBytesPerToken: 139264,
          maxContext: 20480,
          fullOffloadFits: true,
          dtype: dtype ?? 'q8_0',
          target: t,
          recommendations: recs,
          occupancy: {
            vram: {
              weightsMiB: 19968, kvMiB: 8192, reserveMiB: 1024, totalMiB: 29184,
              capacityMiB: 24560, availableMiB: 23749, fits: false,
            },
            ram: {
              weightsMiB: 0, kvMiB: 0, reserveMiB: 512, totalMiB: 512,
              capacityMiB: 32768, availableMiB: 21000, fits: true,
            },
            contextTokens: 32768,
            offloadLayers: 64,
            totalLayers: 64,
            maxContext: 20480,
          },
        });
      },
      // 显存适配徽章演示：19.5GB 主模型 → fit；>24GB（总显存）→ no
      estimateModelFit: (paths: string[], dtype?: string) => {
        const out: Record<string, { verdict: 'fit' | 'partial' | 'no' | null; maxContext: number | null; weightsMiB: number | null; dtype: string }> = {};
        for (const p of paths) {
          out[p] = { verdict: 'fit', maxContext: 20480, weightsMiB: 19968, dtype: dtype ?? 'q8_0' };
        }
        return Promise.resolve(out);
      },
      // llama-bench 体检演示：首次轮询 running，第二次 done（模拟 2.5s 后出结果）
      benchLlamaRun: (modelPath: string) => {
        mockBenchCalls[modelPath] = 0;
        return Promise.resolve({ ok: true, data: { modelPath, state: 'running' } as never });
      },
      benchLlamaStatus: (modelPath: string) => {
        const calls = (mockBenchCalls[modelPath] ?? 0) + 1;
        mockBenchCalls[modelPath] = calls;
        if (calls < 2) return Promise.resolve({ modelPath, state: 'running' } as never);
        return Promise.resolve({
          modelPath,
          state: 'done',
          summary: {
            modelPath, ppTokS: 867.99, tgTokS: 167.66, ngl: 99,
            backend: 'Vulkan', modelType: 'qwen3 32B.A3B Q4_K_M（演示数据）',
            testedAt: new Date().toISOString(),
          },
        } as never);
      },
    },
    download: {
      parseUrl: (url: string) => Promise.resolve({
        ok: true,
        data: {
          raw: url,
          source: url.includes('hf-mirror.com') || url.includes('huggingface.co') ? 'huggingface' : 'modelscope',
          author: 'Qwen',
          modelName: 'Qwen3-8B',
          modelId: 'Qwen/Qwen3-8B',
          filePath: '',
        } as never as ParsedModelUrl,
      }),
      search: (_author: string, modelName: string) => Promise.resolve({
        ok: true,
        data: {
          totalCount: 3,
          models: [modelName, `${modelName}-Instruct`, `${modelName}-GGUF`].map((n, i) => ({
            modelId: `Qwen/${n}`, name: n, author: 'Qwen', description: 'Demo search result', starCount: 12800 - i * 100, downloadCount: 990000 - i * 1000,
          })) as never,
        } as never as ModelScopeSearchResult,
      }),
      listFiles: (_ns: string, _name: string, source: string) => Promise.resolve({
        ok: true,
        data: {
          namespace: 'Qwen', name: 'Qwen3-8B',
          // 字段与 packages/core 的 *-client.ts 对齐：sizeStr 与 quantization 均由后端计算。
          // quantization 直接复用 shared 的真解析器（此前手写 family: 'k' 与
          // QuantizationFamily 枚举不符，导致 .quant-k-quants 等样式类全部失配、徽章退化为 Arco 默认灰底）。
          files: [
            { name: 'Qwen3-8B-Instruct-Q8_0.gguf', path: 'Qwen3-8B-Instruct-Q8_0.gguf', size: 8624000000, sizeStr: formatBytes(8624000000), quantization: parseQuantization('Qwen3-8B-Instruct-Q8_0.gguf'), category: 'gguf', isRecommended: true },
            { name: 'Qwen3-8B-Instruct-Q4_K_M.gguf', path: 'Qwen3-8B-Instruct-Q4_K_M.gguf', size: 4900000000, sizeStr: formatBytes(4900000000), quantization: parseQuantization('Qwen3-8B-Instruct-Q4_K_M.gguf'), category: 'gguf' },
            { name: 'README.md', path: 'README.md', size: 9200, sizeStr: formatBytes(9200), category: 'other' },
            ...(source === 'huggingface' ? [
              { name: 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors', path: 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors', size: 5242467968, sizeStr: formatBytes(5242467968), quantization: parseQuantization('text_encoders/qwen3vl_4b_fp8_scaled.safetensors'), category: 'safetensors' },
            ] : []),
          ],
        } as never as ModelScopeFileListResult,
      }),
      start: (req: any) => {
        // 同一毫秒内可连点多个文件，id 必须唯一（曾用纯 Date.now() 会撞号，
        // 撞号后进度事件会串到别的任务行上）
        const id = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        demoDownloads.set(id, {
          fileName: req.fileName,
          total: req.fileSize || 4900000000,
          done: 0,
          timer: null,
        });
        startFeed(id);
        return Promise.resolve({ ok: true, data: id });
      },
      cancel: (id: string) => {
        const dl = demoDownloads.get(id);
        if (dl) {
          stopFeed(id);
          emitProgress(id, dl, 0, 'canceled');
          demoDownloads.delete(id);
        }
        return Promise.resolve({ ok: true, data: true });
      },
      pause: (id: string) => {
        const dl = demoDownloads.get(id);
        if (!dl || dl.timer === null) return Promise.resolve({ ok: false, data: false });
        stopFeed(id);
        emitProgress(id, dl, 0, 'paused');
        return Promise.resolve({ ok: true, data: true });
      },
      resume: (id: string) => {
        const dl = demoDownloads.get(id);
        if (!dl || dl.timer) return Promise.resolve({ ok: false, data: false });
        startFeed(id);
        return Promise.resolve({ ok: true, data: true });
      },
      onProgress: (cb: (p: DownloadProgressPayload) => void) => { progressCbs.push(cb); return () => {}; },
      onComplete: (cb: (p: DownloadCompletePayload) => void) => { completeCbs.push(cb); return () => {}; },
      onError: () => () => {},
    },
    logs: {
      list: () => Promise.resolve(DEMO_APP_LOGS),
      clear: () => Promise.resolve(true),
      onLog: () => () => {},
    },
  } as never;
}