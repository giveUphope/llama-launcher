// 开发预览演示数据（仅浏览器 mock 环境注入，Electron 真实 api 不受影响）。
// main.ts 在无 Electron preload 时调用 createDemoApi()，让预览环境呈现完整业务状态，
// 便于目测 UI 布局与交互。数据为静态仿真 + 周期性模拟服务日志/下载进度。
import { APP_VERSION, PARAMS, parseQuantization, formatBytes, argvFromPreviewOptions, buildArgv, checkEngineProps, formatCommand, ENGINE_BASELINE_BUILD } from '@llama-launcher/shared';
import type {
  AppSettings, ModelInfo, Preset, GgufReadResult,
  ParsedModelUrl, OutputEntry, AppLogEntry, AppLogKind,
  ModelScopeSearchResult, ModelScopeFileListResult,
  DownloadProgressPayload, DownloadCompletePayload,
  TargetRecommendation,
  DeviceMemInfo, HardwareOccupancy, OccupancySide, PerfTarget, VramEstimateResult,
  ServerStatus, ServerStatusEvent, ServerStopInfo,
  PresetValues, PropsCheck,
} from '@llama-launcher/shared';

const ENGINE_DIR = 'D:/Models/llama-bins';
const MODELS_DIR = 'D:/Models';
/** 体检作业演示状态表与推送订阅者（与真实侧同一契约：完成走推送，不走被轮询） */
const benchJobStates = new Map<string, unknown>();
const benchStatusCbs: Array<(job: unknown) => void> = [];

// ---- 模型目录（模型页「本地模型」列表） ----
const DEMO_MODELS: ModelInfo[] = [
  { name: 'Qwen3-32B-A3B-Instruct-Q4_K_M.gguf', path: `${MODELS_DIR}/Qwen3-32B-A3B-Instruct/Qwen3-32B-A3B-Instruct-Q4_K_M.gguf`, size: 20899999988, size_str: '19.5 GB', modified: '2026-08-20T09:12:00.000Z' },
  { name: 'Qwen3-8B-Instruct-Q8_0.gguf', path: `${MODELS_DIR}/Qwen3-8B/Qwen3-8B-Instruct-Q8_0.gguf`, size: 8624000000, size_str: '8.0 GB', modified: '2026-08-18T15:40:00.000Z' },
  { name: 'gemma-3-27b-it-QAT_Q4_K_M.gguf', path: `${MODELS_DIR}/gemma-3-27b/gemma-3-27b-it-QAT_Q4_K_M.gguf`, size: 16139999999, size_str: '15.0 GB', modified: '2026-08-12T08:03:00.000Z', tags: ['mmproj'] },
  { name: 'Qwen3-VL-4B-Instruct-fp8.gguf', path: `${MODELS_DIR}/Qwen3-VL-4B/Qwen3-VL-4B-Instruct-fp8.gguf`, size: 5136000000, size_str: '4.8 GB', modified: '2026-08-02T20:21:00.000Z', tags: ['mmproj', 'dflash'] },
  { name: 'Llama-3.2-1B-Instruct-Q6_K.gguf', path: `${MODELS_DIR}/Llama-3.2-1B/Llama-3.2-1B-Instruct-Q6_K.gguf`, size: 903000000, size_str: '861 MB', modified: '2026-07-28T11:45:00.000Z' },
  { name: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf', path: `${MODELS_DIR}/DeepSeek-R1-7B/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf`, size: 4500000000, size_str: '4.2 GB', modified: '2026-07-20T16:00:00.000Z' },
];

// ---- 体检「历史记录」演示数据 ----
// 真实侧这条记录来自 ~/.llama_launcher/bench-records.json：应用重启后主进程把落盘的终态
// 回灌进结果缓存，模型面板按路径问一次 system:benchLlamaStatus 就把徽章补回来。
// 这里预置一条已完成记录，用来目测「重启后记录仍在」这条路径（不必真跑一次 1–3 分钟的体检）。
benchJobStates.set(DEMO_MODELS[1].path, {
  modelPath: DEMO_MODELS[1].path,
  state: 'done',
  summary: {
    modelPath: DEMO_MODELS[1].path,
    ppTokS: 1421.6, tgTokS: 96.4, ngl: 99,
    backend: 'Vulkan', modelType: 'qwen3 8B Q8_0（历史记录）',
    testedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
});

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

// ---- 应用日志实时推送（与真实侧同一契约：主进程逐条推 LOGS_ONLOG） ----
const appLogCbs: Array<(entry: AppLogEntry) => void> = [];
function pushAppLog(entry: AppLogEntry) {
  for (const cb of appLogCbs) {
    try { cb(entry); } catch { /* 单个订阅者出错不影响其他 */ }
  }
}

/**
 * 控制台钩子：`__mockPushAppLog(320)` 一次灌入 320 条应用日志，返回实际条数。
 * 为什么要它：STYLE_TODO #82 的验收判据是「日志远多于一屏时控制台内部滚动生效」，
 * 而上面的初始缓冲只有 5 条、真实推送节奏又不受控，取证时只能干等。
 * 既有范式：globalThis.__mockExternalServer（见本文件 system.checkPort）。
 */
(globalThis as unknown as { __mockPushAppLog?: (n?: number) => number }).__mockPushAppLog = (n = 200) => {
  const kinds: AppLogKind[] = ['info', 'success', 'warn', 'error'];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    pushAppLog({
      kind: kinds[i % kinds.length],
      data: `demo app log #${i + 1} — streamed from mock push hook`,
      ts: now + i,
    });
  }
  return n;
};

// ---- 权重落位 / 减负建议演示现场（docs/zh/params-system.md §5.6 第 2、3 项）----
/**
 * 为什么要有这一段：这两行是本轮新加的呈现，mock 造不出对应数据形态就等于**没人目测过**，
 * e2e 也没有判据可钉（真后端只在「权重真的超出空闲显存」时才发减负条目，本机那块 24 GB 卡
 * 跑演示模型全都装得下，现场演示不出来）。
 *
 * 每个现场都是**手抄的 core 快照**，字段严格取 `shared/src/types/vram.ts` 的 VramEstimateResult
 * （用 `satisfies` 钉住，字段名/形状与后端不一致时 vue-tsc 直接报错——本仓库有过 mock 自造字段
 *  导致徽章样式全失配的先例，别再犯第二遍）。
 * 数字按 core `estimateOccupancy` / `recommendOffloadAdvice` 的算式在纸面算好后写死，**不在 mock 里
 * 重算**：占用模型与「装不下该改哪个参数」这条判据一旦在 mock 里有第二份，core 改了 mock 不动，
 * 目测与 e2e 验的就不是真实行为。
 *
 * 切换方式（两条，等价）：
 *   - URL 参数：`/?hw=all-vram|split|all-ram|relief|relief-off|silent`（整页重载，e2e 用这条）
 *   - 控制台钩子：`__mockVramScene('relief')`，返回切换后的现场名。改完**不会立刻**刷新界面——
 *     hardware store 只在页面重新可见时取数（§7.1 铁律①），切到别的页再切回来即可看到新现场。
 *     既有范式：globalThis.__mockExternalServer / __mockPushAppLog。
 *
 * 快照口径：会话 `-ctk q8_0` / `-c 4096`（KV = 2×64 层×8 头×128 维×1 B/token = 131072 B/token
 * ⇒ 4096 token 正好 512 MiB）。**改滑块不会让这几行联动**——mock 是静态快照，真实侧才会跟着
 * 会话值重算；目测只需看形状与几何，数值联动由 core 侧单测负责。
 */
type HwScene = 'all-vram' | 'split' | 'all-ram' | 'relief' | 'relief-off' | 'silent';

const HW_SCENES: readonly HwScene[] = ['all-vram', 'split', 'all-ram', 'relief', 'relief-off', 'silent'];

/**
 * 默认现场取 split：落位行「有权重落在内存侧」这一态才是本轮特性的主场景，
 * 默认就该看得见，而不是只在带参 URL 上出现（silent 留给几何判据当「无声」参照）。
 */
const DEFAULT_HW_SCENE: HwScene = 'split';

const isHwScene = (v: unknown): v is HwScene =>
  typeof v === 'string' && (HW_SCENES as readonly string[]).includes(v);

function initialHwScene(): HwScene {
  try {
    const raw = new URLSearchParams(window.location.search).get('hw');
    return isHwScene(raw) ? raw : DEFAULT_HW_SCENE;
  } catch {
    return DEFAULT_HW_SCENE;
  }
}

let hwScene: HwScene = initialHwScene();

(globalThis as unknown as { __mockVramScene?: (scene?: string) => string }).__mockVramScene = (scene) => {
  if (scene === undefined) return hwScene;
  if (!isHwScene(scene)) {
    // i18n-ignore 控制台诊断，不进界面
    console.warn(`[demo-mock] unknown hw scene "${String(scene)}", expected one of: ${HW_SCENES.join(' | ')}`);
    return hwScene;
  }
  hwScene = scene;
  return hwScene;
};

/** 减负/落位两行在服务 running 时按设计闭嘴（ServiceStatusCard 的 reliefActive 闸门），
 *  「还没跑就看出装不下」这一现场必须把服务初始化为已停止才演示得出来。 */
const hwSceneNeedsStoppedServer = (scene: HwScene): boolean => scene === 'relief' || scene === 'relief-off';

/** 本机 `llama-server --list-devices` 实测值（不要改成「好看的整数」，徽章/落位文案都取这里的名字） */
const HW_VULKAN0: DeviceMemInfo = { id: 'Vulkan0', name: 'AMD Radeon RX 7900 XTX', totalMiB: 24560, freeMiB: 21975 };
const HW_VULKAN1: DeviceMemInfo = { id: 'Vulkan1', name: 'AMD Radeon(TM) Graphics', totalMiB: 16225, freeMiB: 15413 };
const HW_DEVICES_SINGLE: DeviceMemInfo[] = [HW_VULKAN0];
const HW_DEVICES_DUAL: DeviceMemInfo[] = [HW_VULKAN0, HW_VULKAN1];

/** 系统内存侧（演示机 32 GiB / 可用约 21 GiB） */
const HW_RAM_TOTAL_MIB = 32768;
const HW_RAM_FREE_MIB = 21000;
/** core vram-estimate 的同名常量，只为让快照的 totalMiB 与 fits 自洽（不参与任何判据推导） */
const HW_COMPUTE_RESERVE_MIB = 1024;
const HW_RAM_OVERHEAD_MIB = 512;

/** 单侧占用：totalMiB/fits 由已给的三项相加得出，与 core OccupancySide 同形 */
function hwSide(weightsMiB: number, kvMiB: number, reserveMiB: number, capacityMiB: number, availableMiB: number): OccupancySide {
  const totalMiB = weightsMiB + kvMiB + reserveMiB;
  return { weightsMiB, kvMiB, reserveMiB, totalMiB, capacityMiB, availableMiB, fits: totalMiB <= availableMiB };
}

/** 双侧占用：offloadLayers/totalLayers 只作展示回填，权重与 KV 的分配数已按 core 口径算好写死 */
function hwOccupancy(
  vram: OccupancySide,
  ram: OccupancySide,
  contextTokens: number,
  offloadLayers: number,
  totalLayers: number,
  maxContext: number,
): HardwareOccupancy {
  return { vram, ram, contextTokens, offloadLayers, totalLayers, maxContext };
}

/**
 * core recommendOffloadAdvice 在 relief 现场会发的四条（出单顺序即杠杆强弱：-cmoe → -ngl → -dev → -ts；
 * 状态卡只放前两条，档位所限，见 ServiceStatusCard reliefShown）。
 * 数值来源：演示的这份 27 GiB 权重在 21975 MiB 空闲显存上放不下
 *   -ngl 48  = floor((21975 − 1024) / (27648 / 64))（每层 432 MiB）
 *   -ts 21,15 = 两块卡空闲显存各取整 GiB（round(21975/1024)=21、round(15413/1024)=15）
 */
const HW_RELIEF_RECS: TargetRecommendation[] = [
  { key: 'cpu_moe', value: true, reasonKey: 'offload_rec_cmoe', offloadRelief: true },
  { key: 'gpu_layers', value: 48, reasonKey: 'offload_rec_ngl', reasonArgs: [48, 64], offloadRelief: true },
  { key: 'device', value: 'Vulkan0', reasonKey: 'offload_rec_device', reasonArgs: ['Vulkan0'], offloadRelief: true },
  { key: 'tensor_split', value: '21,15', reasonKey: 'offload_rec_split', reasonArgs: ['21,15'], offloadRelief: true },
];

interface HwSceneData {
  devices: DeviceMemInfo[];
  weightsMiB: number | null;
  kvLayers: number | null;
  kvBytesPerToken: number | null;
  maxContext: number | null;
  fullOffloadFits: boolean | null;
  occupancy: HardwareOccupancy | null;
  /** 减负条目：relief 发、relief-off **故意不发**（这条现场专门用来验「core 没发条目时界面必须闭嘴」） */
  relief: TargetRecommendation[];
  probeError: string | null;
}

/**
 * 现场速查（权重 MiB / 卸载层 / 显存侧 权重·KV·合计·空闲·装得下 / 内存侧 权重·KV·合计）：
 *   all-vram   19931.79  64/64  19931.79 · 512 · 21467.79 · 21975 · 是   |   0 · 0 · 512
 *   split      19931.79  40/64  12457.37 · 320 · 13801.37 · 21975 · 是   |   7474.42 · 192 · 8178.42
 *   all-ram    19931.79   0/64  0 · 0 · 1024 · 21975 · 是                |   19931.79 · 512 · 20955.79
 *   relief     27648     48/64  20736 · 384 · 22144 · 21975 · **否**     |   6912 · 128 · 7552
 *   relief-off 与 relief 完全同形，只是 recommendations 里没有 offloadRelief 条目
 *   silent     没探到设备（occupancy null、无任何建议），两行都必须闭嘴
 *
 * relief 为什么换一份 27 GiB 的权重：演示目录里最大的文件是 19.5 GiB，在这块 24 GB 卡上**装得下**，
 * 造不出「装不下」的现场。KV 沿用同一份 64 层配置（这两行只消费权重与卸载层）。
 */
const HW_SCENE_DATA: Record<HwScene, HwSceneData> = {
  'all-vram': {
    devices: HW_DEVICES_SINGLE,
    weightsMiB: 19931.79,
    kvLayers: 64,
    kvBytesPerToken: 131072,
    maxContext: 8192,
    fullOffloadFits: true,
    occupancy: hwOccupancy(
      hwSide(19931.79, 512, HW_COMPUTE_RESERVE_MIB, HW_VULKAN0.totalMiB, HW_VULKAN0.freeMiB),
      hwSide(0, 0, HW_RAM_OVERHEAD_MIB, HW_RAM_TOTAL_MIB, HW_RAM_FREE_MIB),
      4096, 64, 64, 8192,
    ),
    relief: [],
    probeError: null,
  },
  split: {
    devices: HW_DEVICES_SINGLE,
    weightsMiB: 19931.79,
    kvLayers: 64,
    kvBytesPerToken: 131072,
    maxContext: 8192,
    fullOffloadFits: true,
    occupancy: hwOccupancy(
      hwSide(12457.37, 320, HW_COMPUTE_RESERVE_MIB, HW_VULKAN0.totalMiB, HW_VULKAN0.freeMiB),
      hwSide(7474.42, 192, HW_RAM_OVERHEAD_MIB, HW_RAM_TOTAL_MIB, HW_RAM_FREE_MIB),
      4096, 40, 64, 8192,
    ),
    relief: [],
    probeError: null,
  },
  'all-ram': {
    devices: HW_DEVICES_SINGLE,
    weightsMiB: 19931.79,
    kvLayers: 64,
    kvBytesPerToken: 131072,
    maxContext: 8192,
    fullOffloadFits: true,
    occupancy: hwOccupancy(
      hwSide(0, 0, HW_COMPUTE_RESERVE_MIB, HW_VULKAN0.totalMiB, HW_VULKAN0.freeMiB),
      hwSide(19931.79, 512, HW_RAM_OVERHEAD_MIB, HW_RAM_TOTAL_MIB, HW_RAM_FREE_MIB),
      4096, 0, 64, 8192,
    ),
    relief: [],
    probeError: null,
  },
  relief: {
    devices: HW_DEVICES_DUAL,
    weightsMiB: 27648,
    kvLayers: 64,
    kvBytesPerToken: 131072,
    maxContext: 0,
    fullOffloadFits: false,
    occupancy: hwOccupancy(
      hwSide(20736, 384, HW_COMPUTE_RESERVE_MIB, HW_VULKAN0.totalMiB, HW_VULKAN0.freeMiB),
      hwSide(6912, 128, HW_RAM_OVERHEAD_MIB, HW_RAM_TOTAL_MIB, HW_RAM_FREE_MIB),
      4096, 48, 64, 0,
    ),
    relief: HW_RELIEF_RECS,
    probeError: null,
  },
  'relief-off': {
    devices: HW_DEVICES_DUAL,
    weightsMiB: 27648,
    kvLayers: 64,
    kvBytesPerToken: 131072,
    maxContext: 0,
    fullOffloadFits: false,
    occupancy: hwOccupancy(
      hwSide(20736, 384, HW_COMPUTE_RESERVE_MIB, HW_VULKAN0.totalMiB, HW_VULKAN0.freeMiB),
      hwSide(6912, 128, HW_RAM_OVERHEAD_MIB, HW_RAM_TOTAL_MIB, HW_RAM_FREE_MIB),
      4096, 48, 64, 0,
    ),
    // 与 relief 唯一差别就在这条空数组：占用照样是「显存装不下」的形状。
    // 界面若在这里还能冒出建议按钮，说明它在自己算「装不下」（第二套判据）。
    relief: [],
    probeError: null,
  },
  silent: {
    devices: [],
    weightsMiB: null,
    kvLayers: null,
    kvBytesPerToken: null,
    maxContext: null,
    fullOffloadFits: null,
    occupancy: null,
    relief: [],
    probeError: 'llama-server --list-devices returned no compute devices',
  },
};

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
  // 初始状态跟随 hw 现场：relief / relief-off 演示的是「还没跑就看出装不下」，
  // 而减负行在服务 running 时按设计闭嘴（引擎已把这份模型装起来了，此刻喊装不下自相矛盾），
  // 所以这两个现场必须从「已停止」起步，否则概览卡上看不到那行——详见 HW 现场一节。
  const demoInitialStatus: ServerStatus = hwSceneNeedsStoppedServer(hwScene) ? 'stopped' : 'running';
  let serverStatus: ServerStatus = demoInitialStatus;
  // 与 core 同语义的「本轮就绪时刻」：首次 running 记下、进程真死才归零（stopping 保留）。
  // mock 不给这个字段的话，演示页的运行时长永远是 0，界面上看不出这条修复。
  // 初值取 42 秒前，纯演示数据；停止态现场没有就绪时刻可给（给了就是谎报运行时长）。
  let readyAtMs: number | null = demoInitialStatus === 'running' ? Date.now() - 42_000 : null;
  // 与 core Launcher 同形状：状态与「停止事实」合成一条事件下发（渲染层据此区分 stopped/failed/crashed）
  let lastStop: ServerStopInfo | null = null;
  function emitStatus(s: ServerStatus, stop: ServerStopInfo | null = null): void {
    serverStatus = s;
    lastStop = s === 'stopped' ? stop : null;
    if (s === 'running' && readyAtMs === null) readyAtMs = Date.now();
    if (s === 'stopped') readyAtMs = null;
    for (const cb of statusCbs) cb({ status: s, stop: lastStop, readyAt: readyAtMs });
  }
  /** 主动停止的停止事实（用户点停止/重启）——渲染层据此保持「已停止」而非「异常退出」 */
  function userStopInfo(hadBeenReady = true): ServerStopInfo {
    // `globalThis.__mockStopReason` 把这条事实换成失败态（取值同 ServerStopInfo.reason）：
    // 顶栏「停止」只给得出 stopped_by_user，而 #92 的播报判据要验的是「启动失败 / 异常退出」
    // 这两态怎么出声——真实侧只有核心进程真死时才发得出，浏览器 mock 造不出来。
    // 不设＝保持原有语义，既有用例不受影响。
    const forced = (globalThis as unknown as { __mockStopReason?: ServerStopInfo['reason'] }).__mockStopReason;
    return {
      reason: forced ?? 'stopped_by_user',
      // exited 走「曾就绪后自己退出且退出码非 0」，与 core 的异常退出同一形状
      code: forced === 'exited' ? 1 : null,
      signal: null,
      hadBeenReady: forced === 'spawn_failed' ? false : hadBeenReady,
      at: Date.now(),
    };
  }
  let outputIdx = -1;
  let outputTimer: ReturnType<typeof setInterval> | null = null;
  // 运行中服务的参数快照（对齐 core getStatus().values：bench 复用/重启判定依赖它）
  let runningValuesSnapshot: Record<string, string | number | boolean> | null = null;
  /**
   * 预览卡每次调 previewCommand 都会把当前值传进来——演示模式用它作为「服务在跑的值」，
   * 而不是另造一份默认值快照：后者与 store 真值差几项，会让普通加载谎报
   * 「运行中 ≠ 当前参数」（加 ?demo 开关时发现，2026-09-26）。
   */
  let lastSeenValues: PresetValues | null = null;

  /**
   * 演示开关：`?demo=props-mismatch` 造一条引擎回读不一致（并带上 env 变量以演示归因合并），
   * `?demo=props-drift` 造一条「引擎版本 ≠ 参数基线版本」，`?demo=props-ok` 造一条
   * 「已核对且全部一致」的正面结论。默认三者都不出——
   * 提示行平时是安静的，若 mock 总是亮着，就无法用它来证明"真实场景下不误报"。
   * 规则本身复用 shared 的 checkEngineProps，mock 不另写一套判定（同 demo 命令预览的教训）。
   */
  const demoMode = (() => {
    try {
      return new URLSearchParams(window.location.search).get('demo') ?? '';
    } catch {
      return '';
    }
  })();

  /** 演示用的兜底"在跑的值"：预览卡首次回传之前也要能确定性出那几行，不能靠时序运气 */
  const demoBaselineValues: PresetValues = {
    model: DEMO_MODELS[0].path,
    ...Object.fromEntries(PARAMS.map((p) => [p.key, p.default])),
  };

  function demoPropsCheck(values: PresetValues | null): PropsCheck | null {
    if (demoMode !== 'props-mismatch' && demoMode !== 'props-drift' && demoMode !== 'props-ok') return null;
    // 用预览卡刚传来的当前值（与真实界面一致）；没拿到过时退回默认值基线。
    // 注意不写回 runningValuesSnapshot——那会让普通加载多出「运行中 ≠ 当前参数」假行。
    const v = values ?? demoBaselineValues;
    const perturbTopK = demoMode === 'props-mismatch';
    return checkEngineProps(
      {
        // props-ok 的构建号必须等于当前基线，否则每次 re-pin 后演示页会自己显示成「基线漂移」
        build_info: demoMode === 'props-drift' ? 'b99999-demo' : `${ENGINE_BASELINE_BUILD}-demo`,
        ui: v.ui !== false,
        endpoint_slots: true,
        endpoint_metrics: false,
        model_path: String(v.model ?? ''),
        model_alias: String(v.alias ?? ''),
        default_generation_settings: {
          n_ctx: Number(v.ctx_size) || 4096,
          params: {
            seed: -1,
            temperature: Number(v.temperature ?? 0.8),
            // 故意差 1：模拟"界面写着 40、引擎按别的值在跑"
            top_k: Number(v.top_k ?? 40) + (perturbTopK ? 1 : 0),
            top_p: Number(v.top_p ?? 0.95),
            min_p: Number(v.min_p ?? 0.05),
            repeat_penalty: Number(v.repeat_penalty ?? 1),
            presence_penalty: Number(v.presence_penalty ?? 0),
          },
        },
      },
      v,
      // 演示也走 shared 的同一实现；时刻必须给真值，否则界面会显示 1970 年
      Date.now(),
    );
  }

  function demoEnvOverrides(check: PropsCheck | null): string[] {
    return check && check.mismatched.length ? ['LLAMA_ARG_TOP_K'] : [];
  }

  function cloneValues(v: PresetValues): Record<string, string | number | boolean> {
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

  /**
   * 控制台钩子：`__mockPushConsole(320)` 一次灌入 320 行框架输出，返回实际条数。
   * 为什么要它：日志页（框架输出的唯一出口）的验收判据是「输出远多于一屏时面板内部滚动
   * 生效」（STYLE_TODO #82），而上面的喂送节奏每 2.5s 才一行、初始只有 5 行，取证只能干等。
   * 与 __mockPushAppLog 同一范式，走同一个 pushOutput（真实侧是 SERVER_OUTPUT_BATCH 数组）。
   */
  (globalThis as unknown as { __mockPushConsole?: (n?: number) => number }).__mockPushConsole = (n = 200) => {
    for (let i = 0; i < n; i++) {
      outputIdx = (outputIdx + 1) % LLAMA_LINES.length;
      pushOutput(outputIdx % 9 === 7 ? 'info' : 'stdout', LLAMA_LINES[outputIdx]);
    }
    return n;
  };

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
    // 预览钩子：URL 带 ?lang=en 时以英文态启动（既有 ?demo= 同范式）。
    // 布局类取证要中英各跑一轮 7 个页面，而 mock 的设置不落盘——界面切完语言一刷新就回中文。
    language: (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lang') === 'en') ? 'en' : 'zh',
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
          runningValuesSnapshot = cloneValues(values as PresetValues);
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
            runningValuesSnapshot = cloneValues(values as PresetValues);
            emitStatus('running');
          }, 1200);
        }, 400);
        return Promise.resolve({ ok: true });
      },
      getStatus: () => {
        const snap = runningValuesSnapshot ? { ...runningValuesSnapshot } : null;
        // 演示路径用「预览卡刚传进来的当前值」当在跑的值；真实快照语义不动
        const check = demoPropsCheck(snap ?? lastSeenValues);
        return Promise.resolve({ status: serverStatus, pid: serverStatus === 'running' || serverStatus === 'starting' ? 23508 : null, host: '127.0.0.1', port: 8080, url: serverStatus === 'running' ? 'http://127.0.0.1:8080' : '', readyAt: readyAtMs, values: snap, stop: lastStop, envOverrides: demoEnvOverrides(check), propsCheck: check });
      },
      // 与真实侧同一发射规则：apps/desktop 的 SERVER_PREVIEW 走 core 的 previewCommand，
      // 那里只多一层 exe 存在性校验（浏览器没有文件系统），argv 本身两边共用 shared 的实现。
      // includeCustomArgs:false 与真实侧一致——内置参数命令框不含扩展参数。
      previewCommand: (values: PresetValues, settings: AppSettings) => {
        lastSeenValues = { ...values };
        return Promise.resolve({
          ok: true,
          data: formatCommand(buildArgv(argvFromPreviewOptions({ values, settings, includeCustomArgs: false }))),
        });
      },
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
      // 引擎文件是否存在：默认 false（设置页的「路径不存在」三态与既有判据都靠这个默认值）。
      // 顶栏「启动」走 useStartServer 的异步校验，false 时永远起不来——播报判据要看
      // starting→running 这一程，故留一个开关：`globalThis.__mockEngineFileExists = true`。
      // 既有范式：globalThis.__mockExternalServer（同为本文件的 system.checkPort）。
      fileExists: () => Promise.resolve(
        (globalThis as unknown as { __mockEngineFileExists?: boolean }).__mockEngineFileExists === true,
      ),
      findLlamaExe: () => Promise.resolve(`${ENGINE_DIR}/llama-server.exe`),
      detectTrash: () => Promise.resolve({ trashCount: 0, trashFiles: [], detectDurationMs: 12 } as never),
      cleanTrash: () => Promise.resolve({ cleanedCount: 0, freedBytes: 0 } as never),
      listDir: () => Promise.resolve({ path: null, parent: null, entries: [], exists: true }),
      mkdir: () => Promise.resolve(true),
      /**
       * 显存/落位估算演示：返回 HW_SCENE_DATA[hwScene] 那份 core 快照（现场切换见本节开头的说明）。
       * 目标建议部分仍按 target 四档给（参数页的目标选择器要用），减负条目只在 relief 现场发，
       * 并沿用 core 的去重规则——同 key 已有目标建议时不再补一条（`-ngl` 是重灾区）。
       */
      estimateVram: (_modelPath: string, dtype?: string, target?: string, _occ?: { ngl?: string; ctxSize?: number }) => {
        const t = (target ?? 'balanced') as PerfTarget;
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
        const scene = HW_SCENE_DATA[hwScene];
        for (const relief of scene.relief) {
          if (!recs.some((r) => r.key === relief.key)) recs.push(relief);
        }
        return Promise.resolve({
          devices: scene.devices,
          weightsMiB: scene.weightsMiB,
          kvLayers: scene.kvLayers,
          kvBytesPerToken: scene.kvBytesPerToken,
          maxContext: scene.maxContext,
          fullOffloadFits: scene.fullOffloadFits,
          dtype: dtype ?? 'q8_0',
          target: t,
          recommendations: recs,
          occupancy: scene.occupancy,
          probeError: scene.probeError,
        } satisfies VramEstimateResult);
      },
      // 显存适配徽章演示：19.5GB 主模型 → fit；>24GB（总显存）→ no
      estimateModelFit: (paths: string[], dtype?: string) => {
        const out: Record<string, { verdict: 'fit' | 'partial' | 'no' | null; maxContext: number | null; weightsMiB: number | null; dtype: string }> = {};
        for (const p of paths) {
          out[p] = { verdict: 'fit', maxContext: 8192, weightsMiB: 19931.79, dtype: dtype ?? 'q8_0' };
        }
        return Promise.resolve(out);
      },
      // llama-bench 体检演示：与真实侧同一契约——run 只回 running，
      // 完成由**推送**送达（真实侧在主进程 Promise 回调里 send，这里用定时器模拟那次推送）。
      // 此前靠"被第二次轮询时才变 done"演出进度，改成推送后若不同步改这里，徽章会永远停在体检中。
      benchLlamaRun: (modelPath: string) => {
        benchJobStates.set(modelPath, { modelPath, state: 'running' } as never);
        setTimeout(() => {
          const done = {
            modelPath,
            state: 'done',
            summary: {
              modelPath, ppTokS: 867.99, tgTokS: 167.66, ngl: 99,
              backend: 'Vulkan', modelType: 'qwen3 32B.A3B Q4_K_M（演示数据）',
              testedAt: new Date().toISOString(),
            },
          } as never;
          benchJobStates.set(modelPath, done);
          for (const cb of benchStatusCbs) { try { cb(done); } catch { /* 忽略 */ } }
        }, 1400);
        return Promise.resolve({ ok: true, data: { modelPath, state: 'running' } as never });
      },
      // 激活时补状态 + 取回历史记录（真实侧这个缓存会被 bench-records.json 回灌）：直接回当前态
      benchLlamaStatus: (modelPath: string) =>
        Promise.resolve(benchJobStates.get(modelPath) ?? null),
      onBenchStatus: (cb: (job: unknown) => void) => {
        benchStatusCbs.push(cb);
        return () => {
          const i = benchStatusCbs.indexOf(cb);
          if (i >= 0) benchStatusCbs.splice(i, 1);
        };
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
      onLog: (cb: (entry: AppLogEntry) => void) => {
        appLogCbs.push(cb);
        return () => { const i = appLogCbs.indexOf(cb); if (i >= 0) appLogCbs.splice(i, 1); };
      },
    },
  } as never;
}