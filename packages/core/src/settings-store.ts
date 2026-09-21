import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, promises as fsp } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { SETTINGS_FILE, DEFAULT_SERVER_EXE, DEFAULT_MODELS_DIR } from './paths.js';
import { setHfMirrorHost } from './huggingface-client.js';
import { DOWNLOAD_CONCURRENCY_DEFAULT, DOWNLOAD_CONCURRENCY_MIN, DOWNLOAD_CONCURRENCY_MAX } from '@llama-launcher/shared';
import type { AppSettings } from '@llama-launcher/shared';

/**
 * 当前设置 schema 版本。
 * 新增字段或调整字段语义时必须递增，并在 migrateSettings 中补充旧版本 → 新版本的迁移步骤。
 */
const SETTINGS_VERSION = 1;

const THEME_MODES = ['dark', 'light', 'system'] as const;
const LANGUAGES = ['zh', 'en'] as const;
const CLOSE_BEHAVIORS = ['ask', 'exit', 'tray'] as const;

/** 异步保存瞬时失败（EBUSY/EPERM，Windows 句柄未释放）的重试间隔；总尝试次数与同步版一致（3） */
const ASYNC_SAVE_RETRY_MS = 50;

export function getDefaultSettings(): AppSettings {
  return {
    settings_version: SETTINGS_VERSION,
    server_exe: DEFAULT_SERVER_EXE,
    llama_dir: '',
    models_dir: DEFAULT_MODELS_DIR,
    selected_model: '',
    last_preset: '',
    // 窗口几何:空字符串表示使用默认值并居中;格式 "x,y,width,height"
    window_geometry: '',
    // 默认以最大化状态启动
    window_maximized: true,
    theme_mode: 'light',
    close_behavior: 'ask',
    sidebar_collapsed: false,
    language: 'zh',
    last_tab: '',
    // 最大并发下载任务数(1-5)
    download_max_concurrent: DOWNLOAD_CONCURRENCY_DEFAULT,
    // HuggingFace 镜像源（空 = 默认 hf-mirror.com）
    hf_mirror_host: '',
    // 扩展参数（追加到启动命令末尾的用户自定义参数，空 = 无）
    custom_args: '',
    // 参数会话（临时轨道）：null = 无会话，启动走 selected_model + last_preset 预设链
    session_values: null,
    session_baseline: null,
  };
}

// —— 设置 schema（zod）：逐字段容错回退默认，语义与旧手写 normalize 一致 ——
// 磁盘脏数据（手写/旧版本/损坏字段）不会产生非法运行时状态。
const str = (fallback: string) => z.string().catch(fallback);
const num = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (v) => {
      const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v);
      if (Number.isNaN(n)) return fallback;
      return Math.min(max, Math.max(min, Math.floor(n)));
    },
    z.number().catch(fallback),
  );
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'boolean') return v;
      // 兼容手写 JSON 的字符串/数字布尔（"true"/"false"/1/0）
      if (v === 'true' || v === 1 || v === '1') return true;
      if (v === 'false' || v === 0 || v === '0') return false;
      return fallback;
    },
    z.boolean().catch(fallback),
  );
const enumOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).catch(fallback);

const valuesShape = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/** 会话字段形状校验：非法/缺失一律回退 null（启动走预设应用链）。 */
const sessionValuesSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') clean[k] = val;
    }
    return Object.keys(clean).length > 0 ? clean : null;
  },
  valuesShape.nullable().catch(null),
);

const sessionBaselineSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const b = v as Record<string, unknown>;
    if (typeof b.preset_name !== 'string') return null;
    const values = sessionValuesSchema.parse(b.values);
    if (!values) return null;
    return { preset_name: b.preset_name, values };
  },
  z.object({ preset_name: z.string(), values: valuesShape }).nullable().catch(null),
);

const settingsSchema = z.object({
  settings_version: num(SETTINGS_VERSION, 0, 999),
  server_exe: str(DEFAULT_SERVER_EXE),
  llama_dir: str(''),
  models_dir: str(DEFAULT_MODELS_DIR),
  selected_model: str(''),
  last_preset: str(''),
  window_geometry: str(''),
  window_maximized: bool(true),
  theme_mode: enumOf(THEME_MODES, 'light'),
  close_behavior: enumOf(CLOSE_BEHAVIORS, 'ask'),
  sidebar_collapsed: bool(false),
  language: enumOf(LANGUAGES, 'zh'),
  last_tab: str(''),
  download_max_concurrent: num(DOWNLOAD_CONCURRENCY_DEFAULT, DOWNLOAD_CONCURRENCY_MIN, DOWNLOAD_CONCURRENCY_MAX),
  hf_mirror_host: str(''),
  custom_args: str(''),
  session_values: sessionValuesSchema,
  session_baseline: sessionBaselineSchema,
});

/**
 * 逐字段归一化：校验类型/枚举/范围，非法值回退默认。
 * 保证磁盘上的脏数据（手写、旧版本、损坏字段）不会产生非法运行时状态。
 */
function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return getDefaultSettings();
  return settingsSchema.parse(raw) as AppSettings;
}

/**
 * 版本迁移钩子：把旧版本设置升级到当前版本。
 * 未来新增字段时在此按版本逐级迁移，与下载续传日志的 migrateLegacyMeta 同模式。
 */
function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.settings_version === 'number' ? raw.settings_version : 0;
  let data = { ...raw };
  // 示例（未来 v1 → v2）：if (version < 2) { data = { ...data, hf_mirror_host: 'hf-mirror.com' }; }
  void version;
  data.settings_version = SETTINGS_VERSION;
  return data;
}

/**
 * 损坏文件备份：把无法解析的设置文件重命名为 <file>.bak（同名覆盖，保留最新损坏副本）。
 * 用户配置不会无声丢失——.bak 可手工恢复。
 */
function backupCorrupt(filePath: string): void {
  try {
    const bak = `${filePath}.bak`;
    try { unlinkSync(bak); } catch { /* 无旧备份 */ }
    renameSync(filePath, bak);
  } catch (e) {
    console.error('Failed to back up corrupt settings file:', e);
  }
}

/** 原子写：先写 <file>.tmp 再 rename，避免崩溃/断电留下半个 JSON。 */
function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 清理失败则忽略 */ }
    throw e;
  }
}

/** 异步原子写：同样的 .tmp → rename 保证（崩溃/断电不留半个 JSON），但不占用事件循环。 */
async function writeFileAtomicAsync(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, content, 'utf-8');
  try {
    await fsp.rename(tmp, filePath);
  } catch (e) {
    try {
      await fsp.unlink(tmp);
    } catch { /* 清理失败则忽略 */ }
    throw e;
  }
}

/**
 * 读盘记忆化。命中即免去 JSON.parse + zod 校验 + 归一化（这是加载路径上真正贵的部分）。
 *
 * 键含文件指纹（mtimeNs + size，覆盖缺失/截断/改写），但**指纹不足以证明内容未变**：
 * NTFS 的时间戳是延迟刷新的，实测同一毫秒内两次等长改写有九成以上报出完全相同的
 * mtimeNs/ctimeNs，只比指纹会在外部（手工编辑 / 测试 / 其他实例）快速改写后返回旧数据。
 * 故命中还须比对建立缓存时读到的原始字节：字节一致 ⇒ 解析结果一致，可放心复用。
 * 代价是每次加载仍要 stat + 读这个小文件（~1.5KB），但省去解析/校验/对象分配。
 */
let readCache: { key: string; raw: string; settings: AppSettings } | null = null;

/** 文件身份指纹（mtime+size）；不可 stat（不存在/无权限）返回 null。 */
function fileFingerprint(filePath: string): string | null {
  try {
    const st = statSync(filePath, { bigint: true });
    return `${st.mtimeNs}:${st.size}`;
  } catch {
    return null;
  }
}

/**
 * 读取 + 迁移 + 归一化磁盘设置（命中记忆化则零解析）。
 * 返回 null 表示没有可用文件；损坏文件在此备份为 .bak，与 loadSettings 旧行为一致。
 */
function readNormalizedSettings(): AppSettings | null {
  const key = fileFingerprint(SETTINGS_FILE);
  if (key === null) {
    readCache = null;
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(SETTINGS_FILE, 'utf-8');
  } catch (e) {
    console.error('Failed to read settings file:', e);
    readCache = null;
    return null;
  }
  if (readCache && readCache.key === key && readCache.raw === raw) return readCache.settings;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // 损坏 JSON：备份现场并回退默认，不静默吞掉用户配置
    backupCorrupt(SETTINGS_FILE);
    console.error('Settings file is corrupt; backed up and falling back to defaults.');
    readCache = null;
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    backupCorrupt(SETTINGS_FILE);
    console.error('Settings file has invalid shape; backed up and falling back to defaults.');
    readCache = null;
    return null;
  }
  const settings = normalizeSettings(migrateSettings(data as Record<string, unknown>));
  readCache = { key, raw, settings };
  return settings;
}

/** 落盘成功后刷新记忆化：内容与指纹都是刚写下的，下次加载直接命中。 */
function rememberWritten(content: string, normalized: AppSettings): void {
  const key = fileFingerprint(SETTINGS_FILE);
  readCache = key ? { key, raw: content, settings: normalized } : null;
}

export function loadSettings(): AppSettings {
  const settings = readNormalizedSettings();
  if (!settings) return getDefaultSettings();
  // 设置是镜像源配置的唯一入口：加载后同步到 huggingface-client（下载/列表/跳转统一生效）
  setHfMirrorHost(settings.hf_mirror_host ?? '');
  // 调用方会就地改写字段（如 window.ts 写回窗口几何），故返回副本，缓存对象始终与磁盘一致
  return { ...settings };
}

/**
 * 合并磁盘基线（CAS）+ 单次归一化 + 盖章版本 + 序列化。
 * 磁盘值已由记忆化读取归一化过，故只需一次 schema parse（曾是两次：磁盘一次、合并结果一次）。
 * 落盘内容格式不变：键序由 settingsSchema 声明顺序决定，2 空格缩进。
 */
function buildSavePayload(settings: AppSettings): { normalized: AppSettings; content: string } {
  const disk = readNormalizedSettings();
  // disk 为 null（无可用文件）时展开是 no-op
  const normalized = normalizeSettings({ ...getDefaultSettings(), ...disk, ...settings });
  normalized.settings_version = SETTINGS_VERSION;
  setHfMirrorHost(normalized.hf_mirror_host ?? '');
  return { normalized, content: JSON.stringify(normalized, null, 2) };
}

export function saveSettings(settings: AppSettings): void {
  // 版本守卫 + 冲突合并（对应 DSH replaceIfVersion 心智的落地方案）：
  // 写入前读取磁盘当前值作为基线，本进程未见过的字段（其他窗口/实例写入的更新）不丢，
  // 本次传入值覆盖同名；再归一化 + 盖章版本 + 原子写。写入失败重试，避免盲写互相覆盖。
  let attempt = 0;
  while (attempt < 3) {
    try {
      const { normalized, content } = buildSavePayload(settings);
      writeFileAtomic(SETTINGS_FILE, content);
      rememberWritten(content, normalized);
      return;
    } catch (e) {
      attempt++;
      if (attempt >= 3) {
        console.error('Failed to save settings:', e);
      }
    }
  }
}

/**
 * saveSettings 的异步变体：合并/归一化/序列化与同步版完全一致，仅落盘改为 fs.promises +
 * 定时器退避重试（EBUSY/EPERM 等瞬时失败），不阻塞主进程事件循环。
 * 与同步版一样不抛出：写失败只记日志。当前设置写入点（窗口几何/关闭行为/SETTINGS_SAVE IPC）
 * 都在同步上下文里、且退出前必须落盘，故仍走 saveSettings；新代码可 await 本函数。
 */
let saveChain: Promise<void> = Promise.resolve();

export function saveSettingsAsync(settings: AppSettings): Promise<void> {
  // 串行化：异步写共用同一个 <file>.tmp，两个写同时在飞会互相踩（先完成的 rename 搬走半成品）
  saveChain = saveChain.then(() => writeSettingsAsync(settings));
  return saveChain;
}

async function writeSettingsAsync(settings: AppSettings): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { normalized, content } = buildSavePayload(settings);
      await writeFileAtomicAsync(SETTINGS_FILE, content);
      rememberWritten(content, normalized);
      return;
    } catch (e) {
      if (attempt >= 2) {
        console.error('Failed to save settings:', e);
        return;
      }
      await sleep(ASYNC_SAVE_RETRY_MS);
    }
  }
}
