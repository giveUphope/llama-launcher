<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useSettingsStore } from '@/stores/settings';
import { useDownloadStore } from '@/stores/download';
import { useI18nStore } from '@/stores/i18n';
import { useUrlHistory } from '@/composables/useUrlHistory';
import {
  type ParsedModelUrl,
  type ModelScopeSearchItem,
  type ModelScopeFile,
  type DownloadTask,
  type DownloadSource,
  type DownloadErrorType,
  type FileCategory,
  type QuantizationInfo,
  recommendFileName,
  sortFilesByRelevance,
  parseQuantization,
  formatBytes,
} from '@llama-launcher/shared';

const settings = useSettingsStore();
const download = useDownloadStore();
const i18n = useI18nStore();

// 模式：'library'（默认）= 模型库（URL 解析/搜索/文件列表 + 任务区）；'tasks' = 仅下载任务列表
withDefaults(defineProps<{ mode?: 'library' | 'tasks' }>(), { mode: 'library' });

// 每页数量
const RESULTS_PER_PAGE = 6;
const FILES_PER_PAGE = 8;

// URL 输入
const urlInput = ref('');
const parsing = ref(false);
const parseError = ref('');

// URL 历史（会话级）：状态提升至 useUrlHistory 模块级单例——本页面子标签 v-if
// 切换会销毁重建 DownloadCard，实例级状态会丢失导致切换界面后历史不再弹出；
// 应用退出（进程结束）才清空，隐藏到托盘（进程仍在）时保留。
const { urlHistory, rememberUrl } = useUrlHistory();

// 历史面板（点击空白输入框时在下方弹出）
const historyOpen = ref(false);
const urlInputRef = ref<HTMLInputElement | null>(null);
const historyPanelRef = ref<HTMLElement | null>(null);
const historyPanelStyle = ref<Record<string, string>>({});

function updateHistoryPanelPosition() {
  if (!urlInputRef.value) return;
  const rect = urlInputRef.value.getBoundingClientRect();
  historyPanelStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    minWidth: `${rect.width}px`,
  };
}

// 输入框为空且有历史时，聚焦即弹出历史列表
function onUrlFocus() {
  if (urlInput.value.trim() !== '' || urlHistory.value.length === 0) return;
  updateHistoryPanelPosition();
  historyOpen.value = true;
}

// 用户开始输入（输入框非空）时收起历史面板
function onUrlInput() {
  if (urlInput.value.trim() !== '') historyOpen.value = false;
}

// 点击历史项：回填并直接解析
function pickHistoryUrl(url: string) {
  historyOpen.value = false;
  urlInput.value = url;
  void onParseUrl();
}

// 点击外部关闭（同时检查输入行与 Teleport 到 body 的面板）
function handleHistoryClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (urlInputRef.value?.contains(target)) return;
  if (historyPanelRef.value?.contains(target)) return;
  historyOpen.value = false;
}

function handleHistoryKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && historyOpen.value) {
    historyOpen.value = false;
  }
}

// 窗口大小变化或滚动时重新定位（或关闭）
function onHistoryReposition() {
  if (historyOpen.value) updateHistoryPanelPosition();
}

onMounted(() => {
  document.addEventListener('click', handleHistoryClickOutside);
  document.addEventListener('keydown', handleHistoryKeydown);
  window.addEventListener('resize', onHistoryReposition);
  window.addEventListener('scroll', onHistoryReposition, true);
});

onUnmounted(() => {
  document.removeEventListener('click', handleHistoryClickOutside);
  document.removeEventListener('keydown', handleHistoryKeydown);
  window.removeEventListener('resize', onHistoryReposition);
  window.removeEventListener('scroll', onHistoryReposition, true);
});

// 拖拽状态(用计数器避免子元素切换导致的闪烁)
const dragDepth = ref(0);
const isDragging = computed(() => dragDepth.value > 0);

// 当前来源(决定文件列表与下载 URL 走 ModelScope 还是 HF Mirror)
const currentSource = computed<DownloadSource>(() =>
  parsedInfo.value?.source === 'huggingface' ? 'huggingface' : 'modelscope',
);

// 搜索结果
const searchResults = ref<ModelScopeSearchItem[]>([]);
const resultsPage = ref(1);
const selectedModel = ref<ModelScopeSearchItem | null>(null);
const loadingFiles = ref(false);
const filesError = ref('');

// 文件列表
const modelFiles = ref<ModelScopeFile[]>([]);
const selectedFiles = ref<Set<string>>(new Set());
const categoryFilter = ref<'all' | FileCategory>('all');
const filesPage = ref(1);

// 解析的 URL 信息（用于显示）
const parsedInfo = ref<ParsedModelUrl | null>(null);

// 搜索结果分页
const resultsTotalPages = computed(() =>
  Math.max(1, Math.ceil(searchResults.value.length / RESULTS_PER_PAGE)),
);
const pagedResults = computed(() => {
  const start = (resultsPage.value - 1) * RESULTS_PER_PAGE;
  return searchResults.value.slice(start, start + RESULTS_PER_PAGE);
});

// 文件类别过滤
const fileCategoryCounts = computed(() => {
  const counts: Record<string, number> = { all: modelFiles.value.length };
  for (const f of modelFiles.value) {
    counts[f.category] = (counts[f.category] ?? 0) + 1;
  }
  return counts;
});
const presentCategories = computed(() =>
  (['gguf', 'safetensors', 'bin', 'other'] as FileCategory[]).filter(
    (c) => (fileCategoryCounts.value[c] ?? 0) > 0,
  ),
);
const filteredFiles = computed(() =>
  categoryFilter.value === 'all'
    ? modelFiles.value
    : modelFiles.value.filter((f) => f.category === categoryFilter.value),
);
// 推荐关键词:优先用链接尾部文件名,否则用模型名;用于相关性排序与推荐文件选择
const recommendKeyword = computed(() => parsedInfo.value?.fileName || parsedInfo.value?.modelName || '');
// 按相关性降序排序:匹配度高的模型权重文件排在前面(稳定排序,同分保持原顺序)
const sortedFiles = computed(() => sortFilesByRelevance(filteredFiles.value, recommendKeyword.value));
const filesTotalPages = computed(() =>
  Math.max(1, Math.ceil(sortedFiles.value.length / FILES_PER_PAGE)),
);
const pagedFiles = computed(() => {
  const start = (filesPage.value - 1) * FILES_PER_PAGE;
  return sortedFiles.value.slice(start, start + FILES_PER_PAGE);
});

// 推荐文件：优先以链接尾部文件名匹配，否则以模型名关键词做相关性推荐
const recommendedName = computed(() => {
  if (modelFiles.value.length === 0) return null;
  return recommendFileName(modelFiles.value, recommendKeyword.value);
});
const recommendedPath = computed(() => {
  if (!recommendedName.value) return null;
  const f = modelFiles.value.find((x) => x.name === recommendedName.value);
  return f ? f.path : null;
});

// 下载任务列表（从 store）
const tasks = computed(() => download.tasks);

// 模型目录
const modelsDir = computed(() => settings.settings?.models_dir ?? '');

function resetSelections() {
  selectedFiles.value = new Set();
  categoryFilter.value = 'all';
  filesPage.value = 1;
}

// 解析 URL 并搜索
async function onParseUrl() {
  const url = urlInput.value.trim();
  if (!url) return;

  rememberUrl(url); // 会话级历史：记录本次运行提交的 URL（应用退出清空）
  historyOpen.value = false;

  parsing.value = true;
  parseError.value = '';
  searchResults.value = [];
  resultsPage.value = 1;
  selectedModel.value = null;
  modelFiles.value = [];
  resetSelections();
  parsedInfo.value = null;

  try {
    // 1. 解析 URL
    const parseResp = await window.api.download.parseUrl(url);
    // 防御性检查：浏览器预览/mock 环境下 IPC 可能返回 null/undefined
    if (!parseResp || !parseResp.ok || !parseResp.data) {
      parseError.value = i18n.t('msg_url_invalid');
      return;
    }
    parsedInfo.value = parseResp.data;

    // HF / ModelScope URL 均已完整标识仓库（/models/{author}/{model}）：
    // 跳过仓库搜索，直接用解析结果构造模型项并加载文件列表
    // （HF 镜像仓库可能不存在于 ModelScope，无需搜索；ModelScope 链接则避免多余的"选择仓库"操作）
    if (parsedInfo.value.source === 'huggingface' || parsedInfo.value.source === 'modelscope') {
      searchResults.value = [];
      const item: ModelScopeSearchItem = {
        id: parsedInfo.value.modelId,
        path: parsedInfo.value.author,
        name: parsedInfo.value.modelName,
        chineseName: '',
        description: '',
        downloads: 0,
        stars: 0,
        license: '',
        libraries: [],
        architectures: [],
        modelType: [],
        storageSize: 0,
        tasks: [],
      };
      await onSelectModel(item);
      return;
    }

    // 2. 搜索 ModelScope
    const searchResp = await window.api.download.search(
      parseResp.data.author,
      parseResp.data.modelName,
    );
    // 防御性检查：响应或 data 可能 undefined(浏览器预览/mock 环境)
    if (!searchResp || !searchResp.ok) {
      parseError.value = i18n.t('msg_search_failed', [searchResp?.error ?? 'unknown']);
      return;
    }
    // 防御性检查：data.models 可能 undefined
    const models = searchResp.data?.models;
    if (!models) {
      parseError.value = i18n.t('msg_search_failed', ['invalid response']);
      return;
    }
    searchResults.value = models;

    if (searchResults.value.length === 0) {
      parseError.value = i18n.t('msg_no_match');
    } else if (searchResults.value.length === 1) {
      // 只有一个结果，自动选中并加载文件
      await onSelectModel(searchResults.value[0]);
    }
  } catch (err: any) {
    parseError.value = i18n.t('msg_search_failed', [err?.message ?? String(err)]);
  } finally {
    parsing.value = false;
  }
}

// 选择模型,加载文件列表
// 过期响应守卫用自增序号而非对象引用比较：ref 存入对象后读出的会是
// 响应式代理（!== 原始入参），引用比较会把正常响应误判为过期。
let modelSelectionSeq = 0;
async function onSelectModel(model: ModelScopeSearchItem) {
  const seq = ++modelSelectionSeq;
  selectedModel.value = model;
  modelFiles.value = [];
  resetSelections();
  filesError.value = '';
  loadingFiles.value = true;

  try {
    // 根据解析出的来源选择文件列表 API(ModelScope 或 HF Mirror)
    const resp = await window.api.download.listFiles(model.path, model.name, currentSource.value);
    // 加载期间用户已切换到其他模型：丢弃这次过期结果（避免列表落到错误仓库）
    if (seq !== modelSelectionSeq) return;
    // 防御性检查：浏览器预览/mock 环境下 IPC 可能返回 null/undefined
    if (!resp || !resp.ok) {
      filesError.value = i18n.t('msg_files_load_failed', [resp?.error ?? 'unknown']);
      return;
    }
    // 防御性检查：data.files 可能 undefined
    const files = resp.data?.files;
    if (!files) {
      filesError.value = i18n.t('msg_files_load_failed', ['invalid response']);
      return;
    }
    modelFiles.value = files;
    // 推荐文件只作「推荐」徽标/高亮与排序置顶展示（见 recommendedName / sortedFiles），
    // 不默认勾选：下载哪些文件完全由用户主动勾选决定。
  } catch (err: any) {
    filesError.value = i18n.t('msg_files_load_failed', [err?.message ?? String(err)]);
  } finally {
    // 仅当本次仍是最新选择时才清除加载状态（过期请求不干扰新加载的 spinner）
    if (seq === modelSelectionSeq) loadingFiles.value = false;
  }
}

function setCategory(c: 'all' | FileCategory) {
  categoryFilter.value = c;
  filesPage.value = 1;
}

// 切换文件选择
function toggleFile(path: string) {
  if (selectedFiles.value.has(path)) {
    selectedFiles.value.delete(path);
  } else {
    selectedFiles.value.add(path);
  }
  // 触发响应式更新
  selectedFiles.value = new Set(selectedFiles.value);
}

// 打开 ModelScope 模型页面
function onOpenModelScope() {
  if (!selectedModel.value) return;
  const url = `https://www.modelscope.cn/models/${selectedModel.value.path}/${selectedModel.value.name}`;
  void window.api.openExternal(url);
}

// 打开 HF Mirror 模型页面
// 若解析出具体文件路径,则跳转到该文件页(blob/main/<filePath>),否则跳转仓库根
function onOpenHfMirror() {
  if (!selectedModel.value) return;
  const base = `https://hf-mirror.com/${selectedModel.value.path}/${selectedModel.value.name}`;
  const filePath = parsedInfo.value?.filePath;
  const url = filePath
    ? `${base}/blob/main/${filePath}`
    : base;
  void window.api.openExternal(url);
}

// 拖拽处理:URL 文本拖入
function onDragEnter(_e: DragEvent) {
  dragDepth.value++;
}
function onDragLeave(_e: DragEvent) {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0;
  if (!e.dataTransfer) return;
  // 优先取 uri-list,退化为 text/plain
  const text =
    e.dataTransfer.getData('text/uri-list') ||
    e.dataTransfer.getData('text/plain') ||
    '';
  const trimmed = text.trim();
  if (trimmed && trimmed !== urlInput.value) {
    urlInput.value = trimmed;
    void onParseUrl();
  }
}

// 跳过原因 → 提示文案
function skipReasonText(reason: 'in_queue' | 'completed' | 'exists'): string {
  if (reason === 'in_queue') return i18n.t('msg_download_already_in_queue');
  if (reason === 'completed') return i18n.t('msg_download_already_completed');
  return i18n.t('msg_download_file_exists');
}

/** 提交一组文件的下载任务：Store 去重 + 本地同名检测，跳过项自动取消勾选并返回原因列表。
 *  手动「下载所选」与推荐文件自动下载共用此逻辑，保证校验规则一致。 */
async function enqueueFiles(
  filesToDownload: ModelScopeFile[],
): Promise<Array<{ fileName: string; reason: 'in_queue' | 'completed' | 'exists' }>> {
  const skipped: Array<{ fileName: string; reason: 'in_queue' | 'completed' | 'exists' }> = [];
  if (!selectedModel.value) return skipped;

  download.ensureSubscribed();
  const source = currentSource.value;

  for (const file of filesToDownload) {
    const modelId = `${selectedModel.value.path}/${selectedModel.value.name}`;

    // 检查 1：Store 中已有同一文件的下载任务（任何状态），已完成/在队列中则跳过并自动取消勾选
    const existing = download.tasks.find(
      (t) => t.modelId === modelId && t.filePath === file.path,
    );
    if (existing) {
      if (existing.status === 'completed') {
        skipped.push({ fileName: file.name, reason: 'completed' });
      } else if (existing.status === 'queued' || existing.status === 'downloading' || existing.status === 'paused') {
        skipped.push({ fileName: file.name, reason: 'in_queue' });
      } else {
        // canceled/error：允许重新下载，不跳过
      }
      // 自动取消勾选
      const next = new Set(selectedFiles.value);
      next.delete(file.path);
      selectedFiles.value = next;
      continue;
    }

    // 检查 2：目标目录中是否已存在同名文件（路径规则与后端 startDownload 一致）
    const targetPath = `${modelsDir.value}/${selectedModel.value.path}/${selectedModel.value.name}/${file.name}`;
    try {
      const exists = await window.api.system.fileExists(targetPath);
      if (exists) {
        skipped.push({ fileName: file.name, reason: 'exists' });
        const next = new Set(selectedFiles.value);
        next.delete(file.path);
        selectedFiles.value = next;
        continue;
      }
    } catch {
      // fileExists IPC 失败时放行，后端会处理
    }

    const task: DownloadTask = {
      id: crypto.randomUUID(),
      modelId,
      filePath: file.path,
      fileName: file.name,
      totalSize: file.size,
      downloadedSize: 0,
      speed: 0,
      status: 'queued',
      source,
      localPath: '',
      partPath: '',
      error: '',
      errorType: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    download.addTask(task);

    try {
      const resp = await window.api.download.start({
        modelId: task.modelId,
        namespace: selectedModel.value.path,
        name: selectedModel.value.name,
        filePath: file.path,
        fileName: file.name,
        fileSize: file.size,
        modelsDir: modelsDir.value,
        source,
        // 源 API 提供的 SHA-256（HF LFS oid）：下载完成时校验，不匹配则以 checksum_mismatch 失败
        expectedChecksum: file.sha256 ?? null,
      });
      if (resp && resp.ok) {
        // 用后端返回的真实 ID 替换临时 ID
        const idx = download.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          // 后端返回的 ID 可能来自已有任务（去重命中），此时移除重复的本地任务
          if (download.tasks.some((t) => t.id === resp.data && t.id !== task.id)) {
            download.tasks.splice(idx, 1);
          } else {
            download.tasks[idx].id = resp.data;
          }
        }
      } else {
        const idx = download.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          download.tasks[idx].status = 'error';
          download.tasks[idx].error = resp?.error ?? 'unknown';
          download.tasks[idx].errorType = 'unknown';
        }
      }
    } catch (err: any) {
      const idx = download.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        download.tasks[idx].status = 'error';
        download.tasks[idx].error = err?.message ?? String(err);
        download.tasks[idx].errorType = 'unknown';
      }
    }
  }
  return skipped;
}

// 开始下载选中文件(任意类别:gguf / safetensors / bin / 其他)
async function onDownloadSelected() {
  if (!selectedModel.value) return;
  if (!modelsDir.value) {
    parseError.value = i18n.t('msg_no_models_dir');
    return;
  }
  if (selectedFiles.value.size === 0) {
    parseError.value = i18n.t('msg_select_files');
    return;
  }

  parseError.value = '';

  const filesToDownload = modelFiles.value.filter((f) => selectedFiles.value.has(f.path));
  const skipped = await enqueueFiles(filesToDownload);

  // 提示用户哪些文件被跳过以及原因
  if (skipped.length > 0) {
    parseError.value = skipped.map((s) => `${s.fileName} — ${skipReasonText(s.reason)}`).join('\n');
  }
}

// 取消下载
function onCancelDownload(id: string) {
  void download.cancelTask(id);
}

// 暂停下载
function onPauseDownload(id: string) {
  void download.pauseTask(id);
}

// 恢复下载（含失败重试）
function onResumeDownload(id: string) {
  void download.resumeTask(id);
}

// 清除已完成
function onClearCompleted() {
  download.clearFinished();
}

// 计算任务的目标目录路径（与下载管理器的目录规则一致：modelsDir/namespace/name）
function getTaskDir(task: DownloadTask): string {
  const parts = task.modelId.split('/');
  const namespace = parts[0] ?? '';
  const name = parts.slice(1).join('/') ?? '';
  return [modelsDir.value, namespace, name].filter(Boolean).join('/');
}

// 打开任务的目标目录
async function onOpenDir(task: DownloadTask) {
  const dir = getTaskDir(task);
  if (!dir) return;
  try {
    const resp = await window.api.openPath(dir);
    if (!resp || !resp.ok) {
      parseError.value = i18n.t('msg_open_dir_failed', [resp?.error ?? 'unknown']);
    }
  } catch (err: any) {
    parseError.value = i18n.t('msg_open_dir_failed', [err?.message ?? String(err)]);
  }
}

// 打开模型根目录
async function onOpenModelsDir() {
  if (!modelsDir.value) return;
  try {
    const resp = await window.api.openPath(modelsDir.value);
    if (!resp || !resp.ok) {
      parseError.value = i18n.t('msg_open_dir_failed', [resp?.error ?? 'unknown']);
    }
  } catch (err: any) {
    parseError.value = i18n.t('msg_open_dir_failed', [err?.message ?? String(err)]);
  }
}

// 格式化进度百分比
function progressPercent(task: DownloadTask): string {
  if (task.totalSize <= 0) return '0%';
  return `${Math.min(100, (task.downloadedSize / task.totalSize) * 100).toFixed(1)}%`;
}

// 格式化速度
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—';
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

// 格式化预计剩余时间(基于当前速度推算)
// 返回紧凑时长: <60s → "45s"; <1h → "12m 34s"; 否则 → "1h 23m"
// 速度为 0 或总量未知时返回 '—'
function formatEta(task: DownloadTask): string {
  if (task.speed <= 0 || task.totalSize <= 0) return '—';
  const remaining = task.totalSize - task.downloadedSize;
  if (remaining <= 0) return '—';
  const totalSec = Math.floor(remaining / task.speed);
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—';
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
}

// 格式化已下载/总大小
function formatDownloaded(task: DownloadTask): string {
  const downloaded = formatBytes(task.downloadedSize);
  const total = task.totalSize > 0 ? formatBytes(task.totalSize) : '?';
  return `${downloaded} / ${total}`;
}

// 任务状态文本
function statusText(status: string): string {
  const map: Record<string, string> = {
    queued: i18n.t('status_queued'),
    downloading: i18n.t('status_downloading'),
    paused: i18n.t('status_paused'),
    completed: i18n.t('status_completed'),
    error: i18n.t('status_error'),
    canceled: i18n.t('status_canceled'),
  };
  return map[status] ?? status;
}

// 任务状态颜色
function statusColor(status: string): string {
  const map: Record<string, string> = {
    queued: 'var(--fg-muted)',
    downloading: 'var(--accent)',
    paused: 'var(--warn)',
    completed: 'var(--success)',
    error: 'var(--danger)',
    canceled: 'var(--fg-muted)',
  };
  return map[status] ?? 'var(--fg-primary)';
}

// 文件类别徽标文本（category 缺失时回退「其他」，避免 cat_undefined 裸键）
function categoryLabel(c: FileCategory): string {
  return i18n.t(`cat_${c ?? 'other'}`);
}

// 任务量化徽标:从文件名解析(任务对象不携带 quantization 字段,避免扩展 IPC)
function taskQuant(task: DownloadTask): QuantizationInfo | null {
  return parseQuantization(task.fileName);
}

// 错误类型友好提示:优先返回 i18n 文案,无 errorType 时回退到原始 error
function errorDisplay(task: DownloadTask): string {
  if (task.errorType) {
    return i18n.t('dl_err_' + task.errorType);
  }
  return task.error || '';
}

// 任务来源徽标文本
function sourceLabel(source: DownloadSource): string {
  return source === 'huggingface'
    ? i18n.t('lbl_source_huggingface')
    : i18n.t('lbl_source_modelscope');
}

// 解析结果来源徽标文本：ParsedModelUrl.source 可能为 'lmstudio'/'unknown'（品牌名不翻译，与按钮「HF Mirror/ModelScope」一致）
function parseSourceLabel(source: NonNullable<ParsedModelUrl['source']>): string {
  if (source === 'modelscope' || source === 'huggingface') return sourceLabel(source);
  if (source === 'lmstudio') return 'LM Studio';
  return '—';
}

// 量化徽标 tooltip：包含位宽信息
function quantTooltip(q: QuantizationInfo | null): string {
  if (!q) return '';
  if (q.bits !== null) {
    return i18n.t('lbl_quant_tooltip', [q.label, String(q.bits)]);
  }
  return q.label;
}
</script>

<template>
  <Card :title-key="mode === 'tasks' ? 'lbl_download_tasks' : 'card_download_model'">
    <div class="download-card">
      <template v-if="mode === 'library'">
      <!-- URL 输入区(支持拖拽) -->
      <div
        class="url-row"
        :class="{ dragging: isDragging }"
        @dragover.prevent
        @dragenter.prevent="onDragEnter"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <input
          ref="urlInputRef"
          v-model="urlInput"
          class="url-input"
          :placeholder="isDragging ? i18n.t('lbl_drag_url_hint') : i18n.t('lbl_download_url_hint')"
          @focus="onUrlFocus"
          @click="onUrlFocus"
          @input="onUrlInput"
          @keyup.enter="onParseUrl"
        />
        <button
          class="dl-btn primary"
          :disabled="!urlInput.trim() || parsing"
          @click="onParseUrl"
        >
          <Icon v-if="parsing" name="refresh" :size="12" class="spinning" />
          <span>{{ parsing ? i18n.t('msg_parsing') : i18n.t('btn_parse_url') }}</span>
        </button>
      </div>

      <!-- 会话级 URL 历史面板：点击空白输入框弹出，Teleport 到 body 脱离父级层叠上下文 -->
      <Teleport to="body">
        <div
          v-if="historyOpen && urlHistory.length > 0"
          ref="historyPanelRef"
          class="url-history-panel"
          :style="historyPanelStyle"
          @click.stop
        >
          <div class="url-history-title">{{ i18n.t('lbl_recent_urls') }}</div>
          <button
            v-for="u in urlHistory"
            :key="u"
            class="url-history-item"
            :title="u"
            @click="pickHistoryUrl(u)"
          >
            <Icon name="link" :size="11" class="url-history-icon" />
            <span class="url-history-text">{{ u }}</span>
          </button>
        </div>
      </Teleport>

      <!-- 错误提示 -->
      <div v-if="parseError" class="error-msg">{{ parseError }}</div>

      <!-- 解析信息 -->
      <div v-if="parsedInfo" class="parsed-info">
        <span class="info-tag">{{ parseSourceLabel(parsedInfo.source) }}</span>
        <span class="info-id">{{ parsedInfo.modelId }}</span>
        <span v-if="parsedInfo.fileName" class="info-file">→ {{ parsedInfo.fileName }}</span>
      </div>

      <!-- 搜索结果列表（分页式） -->
      <div v-if="searchResults.length > 1" class="search-results">
        <div class="section-title">
          {{ i18n.t('lbl_search_results') }} ({{ searchResults.length }})
        </div>
        <div class="result-list">
          <button
            v-for="m in pagedResults"
            :key="m.id"
            class="result-item"
            :class="{ active: selectedModel?.id === m.id }"
            @click="onSelectModel(m)"
          >
            <div class="result-name">{{ m.path }}/{{ m.name }}</div>
            <div class="result-meta">
              <span v-if="m.downloads">{{ i18n.t('col_size') }}: {{ formatBytes(m.storageSize) }}</span>
              <span v-if="m.license">{{ m.license }}</span>
            </div>
          </button>
        </div>
        <div v-if="resultsTotalPages > 1" class="pager">
          <button class="dl-btn small" :disabled="resultsPage <= 1" @click="resultsPage--">
            <Icon name="chevron_left" :size="12" />
          </button>
          <span class="page-ind">{{ i18n.t('lbl_page', [resultsPage, resultsTotalPages]) }}</span>
          <button class="dl-btn small" :disabled="resultsPage >= resultsTotalPages" @click="resultsPage++">
            <Icon name="chevron_right" :size="12" />
          </button>
        </div>
      </div>

      <!-- 模型文件列表 -->
      <div v-if="selectedModel" class="files-section">
        <div class="files-header">
          <span class="section-title">
            {{ i18n.t('lbl_model_files') }}
            <span class="source-badge" :class="`src-${currentSource}`">{{ sourceLabel(currentSource) }}</span>
          </span>
          <button
            v-if="currentSource === 'huggingface'"
            class="dl-btn small"
            @click="onOpenHfMirror"
            :title="i18n.t('btn_open_hf_mirror')"
          >
            <Icon name="external" :size="12" />
            <span>HF Mirror</span>
          </button>
          <button
            v-else
            class="dl-btn small"
            @click="onOpenModelScope"
            :title="i18n.t('btn_open_modelscope')"
          >
            <Icon name="external" :size="12" />
            <span>ModelScope</span>
          </button>
        </div>

        <!-- 类别筛选 -->
        <div v-if="modelFiles.length > 0" class="cat-filter">
          <button
            class="chip"
            :class="{ active: categoryFilter === 'all' }"
            @click="setCategory('all')"
          >
            {{ i18n.t('lbl_filter_all') }}
            <span class="chip-count">{{ fileCategoryCounts.all }}</span>
          </button>
          <button
            v-for="c in presentCategories"
            :key="c"
            class="chip"
            :class="{ active: categoryFilter === c }"
            @click="setCategory(c)"
          >
            {{ categoryLabel(c) }}
            <span class="chip-count">{{ fileCategoryCounts[c] }}</span>
          </button>
        </div>

        <div v-if="loadingFiles" class="loading-msg">{{ i18n.t('msg_parsing') }}</div>
        <div v-else-if="filesError" class="error-msg">{{ filesError }}</div>
        <div v-else-if="modelFiles.length === 0" class="empty-msg">{{ i18n.t('msg_no_files') }}</div>
        <div v-else-if="pagedFiles.length === 0" class="empty-msg">{{ i18n.t('msg_no_files_in_cat') }}</div>
        <div v-else class="file-list">
          <label
            v-for="f in pagedFiles"
            :key="f.path"
            class="file-item"
            :class="{ checked: selectedFiles.has(f.path), recommended: f.path === recommendedPath }"
          >
            <input
              type="checkbox"
              :checked="selectedFiles.has(f.path)"
              @change="toggleFile(f.path)"
            />
            <span class="file-name" :title="f.path">{{ f.name }}</span>
            <span
              v-if="f.quantization"
              class="quant-badge"
              :class="`quant-${f.quantization.family}`"
              :title="quantTooltip(f.quantization)"
            >{{ f.quantization.label }}</span>
            <span v-if="f.path === recommendedPath" class="rec-badge">{{ i18n.t('lbl_recommended') }}</span>
            <span class="file-cat" :class="`cat-${f.category}`">{{ categoryLabel(f.category) }}</span>
            <span class="file-size">{{ f.sizeStr }}</span>
          </label>
        </div>

        <!-- 文件分页 -->
        <div v-if="filesTotalPages > 1" class="pager">
          <button class="dl-btn small" :disabled="filesPage <= 1" @click="filesPage--">
            <Icon name="chevron_left" :size="12" />
          </button>
          <span class="page-ind">{{ i18n.t('lbl_page', [filesPage, filesTotalPages]) }}</span>
          <button class="dl-btn small" :disabled="filesPage >= filesTotalPages" @click="filesPage++">
            <Icon name="chevron_right" :size="12" />
          </button>
        </div>

        <!-- 下载按钮 -->
        <div v-if="modelFiles.length > 0" class="files-actions">
          <span class="selected-count">
            {{ i18n.t('lbl_selected') }}: {{ selectedFiles.size }}/{{ modelFiles.length }}
          </span>
          <button
            class="dl-btn primary"
            :disabled="selectedFiles.size === 0 || !modelsDir"
            @click="onDownloadSelected"
          >
            <Icon name="download" :size="12" />
            <span>{{ i18n.t('btn_download_selected') }}</span>
          </button>
        </div>
        <div v-if="!modelsDir" class="warn-msg">{{ i18n.t('msg_no_models_dir') }}</div>
      </div>
      </template>

      <!-- 下载任务列表 -->
      <div v-if="tasks.length > 0" class="tasks-section">
        <div class="tasks-header">
          <span v-if="mode !== 'tasks'" class="section-title">{{ i18n.t('lbl_download_tasks') }} ({{ tasks.length }})</span>
          <div class="tasks-actions">
            <button
              v-if="modelsDir"
              class="dl-btn small"
              @click="onOpenModelsDir"
              :title="i18n.t('btn_open_dir')"
            >
              <Icon name="folder_open" :size="12" />
              <span>{{ i18n.t('btn_open_dir') }}</span>
            </button>
            <button class="dl-btn small" @click="onClearCompleted">
              {{ i18n.t('btn_clear_completed') }}
            </button>
          </div>
        </div>
        <div class="task-list">
          <div v-for="t in tasks" :key="t.id" class="task-item">
            <div class="task-info">
              <span class="task-name" :title="t.fileName">{{ t.fileName }}</span>
              <span class="task-model">
                {{ t.modelId }}
                <span class="source-badge" :class="`src-${t.source}`">{{ sourceLabel(t.source) }}</span>
                <span
                  v-if="taskQuant(t)"
                  class="quant-badge"
                  :class="`quant-${taskQuant(t)?.family}`"
                  :title="quantTooltip(taskQuant(t))"
                >{{ taskQuant(t)?.label }}</span>
              </span>
            </div>
            <div class="task-progress-bar">
              <div
                class="task-progress-fill"
                :style="{
                  width: progressPercent(t),
                }"
              ></div>
            </div>
            <div class="task-stats">
              <span class="task-status" :style="{ color: statusColor(t.status) }">
                {{ statusText(t.status) }}
              </span>
              <span class="task-size">{{ formatDownloaded(t) }}</span>
              <span v-if="t.status === 'downloading'" class="task-speed">{{ formatSpeed(t.speed) }}</span>
              <span v-if="t.status === 'downloading'" class="task-eta">{{ i18n.t('lbl_eta') }} {{ formatEta(t) }}</span>
              <span v-if="t.status === 'error'" class="task-error" :title="t.error">{{ errorDisplay(t) }}</span>
            </div>
            <div class="task-actions">
              <button
                v-if="t.status === 'downloading' || t.status === 'queued'"
                class="dl-btn small"
                @click="onPauseDownload(t.id)"
              >
                {{ i18n.t('btn_pause_download') }}
              </button>
              <button
                v-if="t.status === 'paused' || t.status === 'error'"
                class="dl-btn small primary"
                @click="onResumeDownload(t.id)"
              >
                {{ t.status === 'error' ? i18n.t('btn_retry_download') : i18n.t('btn_resume_download') }}
              </button>
              <button
                v-if="t.status === 'downloading' || t.status === 'queued' || t.status === 'paused' || t.status === 'error'"
                class="dl-btn small danger"
                @click="onCancelDownload(t.id)"
              >
                {{ i18n.t('btn_cancel_download') }}
              </button>
              <button
                v-if="t.status === 'completed'"
                class="dl-btn small"
                @click="onOpenDir(t)"
                :title="i18n.t('btn_open_dir')"
              >
                <Icon name="folder_open" :size="12" />
                <span>{{ i18n.t('btn_open_dir') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.download-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* URL 输入区 */
.url-row {
  display: flex;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-row);
  transition: border-color var(--dur-fast) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &.dragging {
    border-color: var(--accent);
    background: var(--bg-active);
  }
}

.url-input {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-family);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }

  &::placeholder {
    color: var(--fg-muted);
  }
}

/* 按钮 */
.dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    color var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }


  &.small {
    height: 24px;
    padding: 0 8px;
    font-size: var(--fs-base);
  }

  &.primary {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-fg);

    &:hover:not(:disabled) {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }
  }

  &.danger {
    color: var(--danger-text);
    border-color: var(--danger-text);

    &:hover:not(:disabled) {
      background: var(--danger);
      color: #fff;
    }
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 错误/提示消息 */
.error-msg {
  color: var(--danger-text); // 浅色主题深红达 AA（原亮 --danger 仅 3.8:1）
  font-size: var(--fs-base);
  padding: 4px 0;
  white-space: pre-line;
}

.warn-msg {
  color: var(--warn-text); // 浅色主题深琥珀达 AA（原亮 --warn 仅 2.2:1 看不清）
  font-size: var(--fs-base);
  padding: 4px 0;
}

.loading-msg,
.empty-msg {
  color: var(--fg-muted);
  font-size: var(--fs-base);
  padding: 8px 0;
  text-align: center;
}

/* 解析信息 */
.parsed-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-base);
}

.info-tag {
  background: var(--bg-hover);
  color: var(--accent);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  font-weight: 600;
}

.info-id {
  font-family: var(--font-mono);
  color: var(--fg-secondary);
}

.info-file {
  font-family: var(--font-mono);
  color: var(--accent);
}

/* 区段标题 */
.section-title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--fg-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 搜索结果 */
.search-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius-row);
  border: 1px solid var(--border);
  background: var(--bg-input);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }


  &.active {
    background: var(--bg-active);
    border-color: var(--accent);
  }
}

.result-name {
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  color: var(--fg-primary);
}

.result-meta {
  display: flex;
  gap: 12px;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* 分页控件 */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 4px 0;
}

.page-ind {
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  min-width: 64px;
  text-align: center;
}

/* 文件列表 */
.files-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.files-header,
.tasks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tasks-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 类别筛选 */
.cat-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 4px; // 与页内选项胶囊组间距统一（tab-strip / level-chips 同为 4px）
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px; // 胶囊内 icon/计数间距与其他筛选 chip（level-chip）一致
  height: 24px;
  padding: 0 8px; // 筛选 chip 水平内距统一 8px（与 LogsPage .level-chip 一致；原 9px 离群，§7.5.4）
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    color var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
  }


  &.active {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-fg);
  }
}

.chip-count {
  font-size: var(--fs-xs);
  opacity: 0.75;
  /* 表面着色（跟随 chip 文本色相的半透明计数底），不纳入阴影 token */
  background: color-mix(in srgb, var(--fg-secondary) 12%, transparent);
  border-radius: var(--radius-pill);
  padding: 0 5px;
}

.chip.active .chip-count {
  opacity: 0.85;
  /* 激活态 chip 为 --primary-bg，计数底跟随主按钮文字色，双主题下均可见 */
  background: color-mix(in srgb, var(--primary-fg) 22%, transparent);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-row);
  border: 1px solid var(--border);
  background: var(--bg-input);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
  }

  &.checked {
    border-color: var(--accent);
    background: var(--bg-active);
  }

  &.recommended {
    border-color: var(--accent);
    // 推荐标记竖条：accent 蓝（统一蓝色系，原为彩虹渐变）
    box-shadow: inset 3px 0 0 var(--accent);
  }

  input[type='checkbox'] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }
}

.file-name {
  flex: 1;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  color: var(--fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec-badge {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border-radius: var(--radius-pill);
  padding: 1px 6px;
}

.file-cat {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: var(--radius-pill);
  padding: 1px 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;

  &.cat-gguf { color: var(--badge-cat-gguf); background: color-mix(in srgb, var(--badge-cat-gguf) 14%, transparent); }
  &.cat-safetensors { color: var(--badge-cat-safetensors); background: color-mix(in srgb, var(--badge-cat-safetensors) 14%, transparent); }
  &.cat-bin { color: var(--badge-cat-bin); background: color-mix(in srgb, var(--badge-cat-bin) 14%, transparent); }
  &.cat-other { color: var(--fg-muted); background: var(--bg-hover); }
}

/* 量化徽标：按 family 着色，便于区分 K-quants / I-quants / FP / INT 系列 */
.quant-badge {
  flex-shrink: 0;
  display: inline-block;
  font-size: var(--fs-xs);
  font-weight: 600;
  font-family: var(--font-mono);
  border-radius: var(--radius-pill);
  padding: 1px 6px;
  letter-spacing: 0.2px;
  line-height: 1.4;

  &.quant-k-quants { color: var(--badge-quant-k); background: color-mix(in srgb, var(--badge-quant-k) 14%, transparent); }
  &.quant-i-quants { color: var(--badge-quant-i); background: color-mix(in srgb, var(--badge-quant-i) 14%, transparent); }
  &.quant-legacy    { color: var(--badge-quant-legacy); background: color-mix(in srgb, var(--badge-quant-legacy) 16%, transparent); }
  &.quant-fp8       { color: var(--badge-quant-fp8); background: color-mix(in srgb, var(--badge-quant-fp8) 14%, transparent); }
  &.quant-bf16      { color: var(--badge-quant-bf16); background: color-mix(in srgb, var(--badge-quant-bf16) 14%, transparent); }
  &.quant-fp16      { color: var(--badge-quant-fp16); background: color-mix(in srgb, var(--badge-quant-fp16) 14%, transparent); }
  &.quant-fp32      { color: var(--badge-quant-fp32); background: color-mix(in srgb, var(--badge-quant-fp32) 16%, transparent); }
  &.quant-int       { color: var(--badge-quant-int); background: color-mix(in srgb, var(--badge-quant-int) 14%, transparent); }
}

.file-size {
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  flex-shrink: 0;
}

/* 来源徽标:区分 ModelScope / HF Mirror */
.source-badge {
  display: inline-block;
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: var(--radius-pill);
  padding: 1px 6px;
  letter-spacing: 0.2px;
  line-height: 1.4;

  &.src-modelscope { color: var(--badge-src-modelscope); background: color-mix(in srgb, var(--badge-src-modelscope) 14%, transparent); }
  &.src-huggingface { color: var(--badge-src-huggingface); background: color-mix(in srgb, var(--badge-src-huggingface) 14%, transparent); }
}

.files-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.selected-count {
  font-size: var(--fs-base);
  color: var(--fg-secondary);
}

/* 下载任务 */
.tasks-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 14px;

  // 分隔线上方 14px（容器 flex gap 8px + 6px margin），与线下方 14px 对齐；
  // 任务模式（mode='tasks'）下本块是 card-body 首个子块，不额外加间距
  &:not(:first-child) {
    margin-top: 6px;
  }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto auto;
  gap: 4px 8px;
  padding: 8px 10px;
  border-radius: var(--radius-row);
  border: 1px solid var(--border);
  background: var(--bg-input);
}

.task-info {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.task-name {
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  color: var(--fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-model {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.task-progress-bar {
  grid-column: 1;
  grid-row: 2;
  height: 6px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  /* accent 蓝填充（统一蓝色系，原为彩虹渐变）；宽度过渡为进度跟随展示（与 Progress.vue 一致） */
  background: var(--accent);
  border-radius: var(--radius-pill);
  transition: width var(--dur-med) var(--ease-smooth);
}

.task-stats {
  grid-column: 1;
  grid-row: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--fs-sm);
}

.task-status {
  font-weight: 600;
}

.task-size {
  color: var(--fg-secondary);
  font-family: var(--font-mono);
}

.task-speed {
  color: var(--accent);
  font-family: var(--font-mono);
}

.task-eta {
  color: var(--fg-secondary);
  font-family: var(--font-mono);
}

.task-error {
  color: var(--danger-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.task-actions {
  grid-column: 2;
  grid-row: 1 / 4;
  align-self: center;
  display: flex;
  flex-direction: row;
  gap: 4px;
}
</style>

<!-- 历史面板样式：Teleport 到 body 后需用非 scoped 样式才能生效 -->
<style lang="scss">
.url-history-panel {
  z-index: 9999;
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
  border-radius: var(--radius-row);
  // 实底浮层（STYLE_TODO #41 / §7.5.6）：可读性优先，不用半透明玻璃 + backdrop-filter
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-dropdown);
  animation: url-history-panel-in var(--dur-fast) var(--ease-jelly);

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: var(--radius-pill);

    &:hover {
      background: var(--fg-muted);
    }
  }
}

@keyframes url-history-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.url-history-title {
  padding: 4px 10px 6px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

.url-history-panel .url-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--fg-primary);
  font-size: var(--fs-base);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
  }

}

.url-history-icon {
  flex-shrink: 0;
  color: var(--fg-muted);
}

.url-history-text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
