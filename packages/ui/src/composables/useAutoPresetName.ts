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
 * 预设名称与绑定模型的一致性判定（保存链防错用）。
 * 一致 = 模型为空（纯参数集预设）或 名称 ∈ 该模型路径的文件名候选（含/不含扩展名）。
 * 背景：预设「应用」会连带切换当前模型（绑定语义），此后保存/覆盖若沿用另一预设名，
 * 会把新模型写进旧名预设——名称与绑定模型不再对应（智能匹配按名命中后携带错误模型）。
 */
export function isNameConsistentWithModel(name: string, modelPath: string): boolean {
  const m = String(modelPath ?? '').trim();
  if (!m) return true;
  return presetNameCandidates(m).includes(name);
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
