import { computed } from 'vue';
import { useParamsStore } from '@/stores/params';
import { MODEL_KEY } from '@llama-launcher/shared';

/**
 * 基于模型路径生成预设名候选（用于匹配该模型已保存的预设）。
 * 返回 文件名（含扩展名）与 去 .gguf/.bin 后缀的文件名，去重保序。
 */
export function presetNameCandidates(modelPath: string): string[] {
  const p = String(modelPath ?? '').trim();
  if (!p) return [];
  const fileName = p.split(/[\\/]/).pop() ?? p;
  return [...new Set([fileName, fileName.replace(/\.(gguf|bin)$/i, '')])];
}

/**
 * 基于当前模型自动生成预设名。
 * 优先使用 alias 参数，其次使用模型文件名（不含扩展名），均无则为空。
 * 供参数页「快捷保存预设」与预设面板共用，保证自动命名逻辑一致。
 */
export function useAutoPresetName() {
  const params = useParamsStore();
  return computed(() => {
    const alias = String(params.values['alias'] ?? '').trim();
    if (alias) return alias;
    const names = presetNameCandidates(String(params.values[MODEL_KEY] ?? ''));
    return names.length > 0 ? names[names.length - 1] : '';
  });
}
