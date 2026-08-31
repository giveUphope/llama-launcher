import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { useServerStore } from '@/stores/server';
import { presetNameCandidates } from '@/composables/useAutoPresetName';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { Preset } from '@llama-launcher/shared';

let applyingPath: string | null = null;

/**
 * 智能预设：模型切换时静默匹配并应用该模型已保存的预设（不再弹窗询问）。
 * - 匹配规则：预设名 = 模型别名（alias）优先，其次模型文件名 / 去 .gguf/.bin 后缀
 * - 匹配成功即直接覆盖应用；无匹配则不动（参数留在内存，关闭应用即丢弃）
 */
export function useModelPreset() {
  const params = useParamsStore();
  const settings = useSettingsStore();
  const server = useServerStore();
  const i18n = useI18nStore();

  async function applyModelPresetIfAny(modelPath: string): Promise<boolean> {
    if (!modelPath) return false;
    if (applyingPath !== null) return false;
    // 并发防护先占位
    applyingPath = modelPath;
    try {
      // 本函数为「静默匹配」：调用方（selectRow/TopBar）都已先经 params.applyModel
      // 的防丢确认并重建基线，此处不再二次弹窗（否则脏状态下双确认/阻塞预设匹配）。
      const list = await window.api.presets.list();
      if (!Array.isArray(list) || list.length === 0) return false;
      const candidates: string[] = [];
      const alias = String(params.values['alias'] ?? '').trim();
      if (alias) candidates.push(alias);
      candidates.push(...presetNameCandidates(modelPath));
      const uniq = [...new Set(candidates)];
      const preset = list.find((p) => uniq.includes(p.name)) ?? null;
      if (!preset) return false;
      if (settings.settings?.last_preset === preset.name) return false;

      // 静默覆盖应用（以预设名建立基线）
      params.applyPreset(preset.values, preset.name);
      params.set(MODEL_KEY, modelPath);
      await Promise.all([
        params.detectMmproj(modelPath),
        params.loadGguf(modelPath),
        String(params.values.spec_type ?? '') === ''
          ? params.detectDraftModel(modelPath)
          : Promise.resolve(),
      ]);
      if (settings.settings) {
        settings.settings.last_preset = preset.name;
        void settings.save();
      }
      let count = 0;
      for (const [k, v] of Object.entries(preset.values)) {
        if (k === MODEL_KEY || k === '_enabled') continue;
        if (typeof v === 'string' && v === '') continue;
        count++;
      }
      server.pushOutput({
        kind: 'success',
        data: `[preset] ${i18n.t('msg_preset_applied').replace('{0}', preset.name).replace('{1}', String(count))}\n`,
        ts: Date.now(),
      });
      return true;
    } catch {
      return false;
    } finally {
      applyingPath = null;
    }
  }

  return { applyModelPresetIfAny };
}
