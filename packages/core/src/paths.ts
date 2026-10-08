import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';

/** 安全取文件名（跨平台），失败时返回空字符串。 */
export function basenameSafe(p: string): string {
  try { return basename(p); } catch { return ''; }
}

const __filename = fileURLToPath(import.meta.url);
// In production __dirname may be inside an asar archive; resolve to ../app.asar.unpacked
// For dev it's just packages/core/src
export const SCRIPT_DIR = path.resolve(__filename, '..', '..', '..', '..');
export const CONFIG_DIR = path.join(os.homedir(), '.llama_launcher');
export const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
// llama-bench 体检结果（跨重启保留，见 bench-records.ts）
export const BENCH_RECORDS_FILE = path.join(CONFIG_DIR, 'bench-records.json');
// 每模型参数集目录（2026-10-08 起：参数跟模型走，自动持久化/自动载回，取代手存预设）。
// 位置固定在应用配置目录，与模型目录解耦——模型目录只是模型文件的存放地。
export const MODEL_PARAMS_DIR = path.join(CONFIG_DIR, 'model-params');

// 旧版手存预设目录（两代历史：先 <models_dir>/presets，后集中到本目录）。
// 预设机制已移除，本目录仅作为 migratePresetsToModelParams 的迁移源保留。
export const LEGACY_PRESETS_DIR = path.join(CONFIG_DIR, 'presets');

/**
 * 旧版预设目录（<models_dir>/presets）：仅作为迁移源路径解析，
 * 不再有任何读写——每模型参数集活目录恒为 MODEL_PARAMS_DIR。
 */
export function legacyModelsPresetsDir(modelsDir: string): string {
  if (!modelsDir) return '';
  return path.join(modelsDir, 'presets');
}

/**
 * 动态查找 llama-server 可执行文件，不限制版本号。
 * 仅在开发模式（项目根目录存在 llama-*-bin-* 子目录）下生效；
 * 生产模式下返回空字符串，由用户通过界面手动配置路径。
 *
 * 查找顺序：
 *   1. 项目根目录下匹配 llama-*-bin-* 模式的子目录（如 llama-b9878-bin-win-vulkan-x64）
 *   2. 找到多个时按名称降序选择最新版本
 *   3. 未找到时返回空字符串
 */
function resolveDefaultServerExe(): string {
  const exeNames: Record<string, string> = {
    win32: 'llama-server.exe',
    darwin: 'llama-server',
    linux: 'llama-server',
  };
  const exeName = exeNames[process.platform] ?? '';
  if (!exeName) return '';

  // 动态扫描项目根目录下匹配 llama-*-bin-* 的目录（仅开发模式有效）
  try {
    const entries = readdirSync(SCRIPT_DIR);
    // 匹配 llama-<版本>-bin-<平台> 模式，如 llama-b9878-bin-win-vulkan-x64
    const llamaDirs = entries.filter((name) => /^llama-.+-bin-.+$/i.test(name));
    if (llamaDirs.length > 0) {
      // 按名称降序排序，选择最新版本
      llamaDirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const dir of llamaDirs) {
        const exePath = path.join(SCRIPT_DIR, dir, exeName);
        if (existsSync(exePath)) return exePath;
      }
    }
  } catch {
    // 扫描失败时静默回退
  }

  // 生产模式或未找到时返回空字符串，由用户手动配置
  return '';
}

export const DEFAULT_SERVER_EXE = resolveDefaultServerExe();
// 首次打开时模型目录为空，用户设置后持久化保存
export const DEFAULT_MODELS_DIR = '';

// Ensure config dir exists (settings.json 仍存放在此)
mkdirSync(CONFIG_DIR, { recursive: true });
