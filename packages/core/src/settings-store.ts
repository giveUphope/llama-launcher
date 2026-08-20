import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { SETTINGS_FILE, DEFAULT_SERVER_EXE, DEFAULT_MODELS_DIR } from './paths.js';
import { setHfMirrorHost } from './huggingface-client.js';
import type { AppSettings, ThemeMode, Language, CloseBehavior } from '@llama-launcher/shared';

/**
 * 当前设置 schema 版本。
 * 新增字段或调整字段语义时必须递增，并在 migrateSettings 中补充旧版本 → 新版本的迁移步骤。
 */
const SETTINGS_VERSION = 1;

const THEME_MODES: ThemeMode[] = ['dark', 'light'];
const LANGUAGES: Language[] = ['zh', 'en'];
const CLOSE_BEHAVIORS: CloseBehavior[] = ['ask', 'exit', 'tray'];

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
    theme_mode: 'dark',
    fx_mode: 'glass',
    close_behavior: 'ask',
    sidebar_collapsed: false,
    language: 'zh',
    last_tab: '',
    // 最大并发下载任务数(1-5)
    download_max_concurrent: 3,
    // HuggingFace 镜像源（空 = 默认 hf-mirror.com）
    hf_mirror_host: '',
  };
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  // 兼容手写 JSON 的字符串/数字布尔（"true"/"false"/1/0）
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function asNumber(v: unknown, fallback: number, min: number, max: number): number {
  let n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v);
  if (Number.isNaN(n)) return fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return Math.floor(n);
}

/**
 * 逐字段归一化：校验类型/枚举/范围，非法值回退默认。
 * 保证磁盘上的脏数据（手写、旧版本、损坏字段）不会产生非法运行时状态。
 */
function normalizeSettings(raw: unknown): AppSettings {
  const d = getDefaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const theme = r.theme_mode as string;
  const lang = r.language as string;
  return {
    settings_version: SETTINGS_VERSION,
    server_exe: asString(r.server_exe, d.server_exe),
    llama_dir: asString(r.llama_dir, d.llama_dir),
    models_dir: asString(r.models_dir, d.models_dir),
    selected_model: asString(r.selected_model, d.selected_model),
    last_preset: asString(r.last_preset, d.last_preset),
    window_geometry: asString(r.window_geometry, d.window_geometry),
    window_maximized: asBool(r.window_maximized, d.window_maximized),
    theme_mode: THEME_MODES.includes(theme as ThemeMode) ? (theme as ThemeMode) : d.theme_mode,
    fx_mode: r.fx_mode === 'off' ? 'off' : 'glass',
    close_behavior: CLOSE_BEHAVIORS.includes(r.close_behavior as CloseBehavior) ? (r.close_behavior as CloseBehavior) : 'ask',
    sidebar_collapsed: asBool(r.sidebar_collapsed, d.sidebar_collapsed),
    language: LANGUAGES.includes(lang as Language) ? (lang as Language) : d.language,
    last_tab: asString(r.last_tab, d.last_tab),
    download_max_concurrent: asNumber(r.download_max_concurrent, d.download_max_concurrent, 1, 5),
    hf_mirror_host: asString(r.hf_mirror_host, d.hf_mirror_host ?? ''),
  };
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

/** 读取磁盘当前设置（仅解析，不做备份/归一化）；缺失或损坏返回 undefined。 */
function readDiskSettings(): Record<string, unknown> | undefined {
  try {
    if (!existsSync(SETTINGS_FILE)) return undefined;
    const raw = readFileSync(SETTINGS_FILE, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    return data as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function loadSettings(): AppSettings {
  const defaults = getDefaultSettings();
  if (!existsSync(SETTINGS_FILE)) return defaults;
  let raw: string;
  try {
    raw = readFileSync(SETTINGS_FILE, 'utf-8');
  } catch (e) {
    console.error('Failed to read settings file:', e);
    return defaults;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // 损坏 JSON：备份现场并回退默认，不静默吞掉用户配置
    backupCorrupt(SETTINGS_FILE);
    console.error('Settings file is corrupt; backed up and falling back to defaults.');
    return defaults;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    backupCorrupt(SETTINGS_FILE);
    console.error('Settings file has invalid shape; backed up and falling back to defaults.');
    return defaults;
  }
  const migrated = migrateSettings(data as Record<string, unknown>);
  const settings = normalizeSettings(migrated);
  // 设置是镜像源配置的唯一入口：加载后同步到 huggingface-client（下载/列表/跳转统一生效）
  setHfMirrorHost(settings.hf_mirror_host ?? '');
  return settings;
}

export function saveSettings(settings: AppSettings): void {
  // 版本守卫 + 冲突合并（对应 DSH replaceIfVersion 心智的落地方案）：
  // 写入前读取磁盘当前值作为基线，本进程未见过的字段（其他窗口/实例写入的更新）不丢，
  // 本次传入值覆盖同名；再归一化 + 盖章版本 + 原子写。写入失败重试，避免盲写互相覆盖。
  let attempt = 0;
  while (attempt < 3) {
    try {
      const disk = readDiskSettings();
      const merged = disk
        ? { ...normalizeSettings(disk), ...settings }
        : settings;
      // 写入前归一化 + 盖章版本，保证落盘内容始终是合法 schema
      const normalized = normalizeSettings({ ...getDefaultSettings(), ...merged });
      normalized.settings_version = SETTINGS_VERSION;
      setHfMirrorHost(normalized.hf_mirror_host ?? '');
      writeFileAtomic(SETTINGS_FILE, JSON.stringify(normalized, null, 2));
      return;
    } catch (e) {
      attempt++;
      if (attempt >= 3) {
        console.error('Failed to save settings:', e);
      }
    }
  }
}
