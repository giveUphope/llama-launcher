import { useParamsStore } from '@/stores/params';
import { usePresetsStore } from '@/stores/presets';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { useServerStore } from '@/stores/server';
import { MODEL_KEY } from '@llama-launcher/shared';

let applyingPath: string | null = null;

/** 路径归一：分隔符统一 / + 小写（Windows 大小写不敏感语义） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * 模型文件身份比较：全路径一致优先；退化按文件名一致（用户换盘/移动模型目录后，
 * 旧预设存的绝对路径失效，文件名是最后一层稳定身份）。
 */
export function sameModelFile(a: string, b: string): boolean {
  const na = normPath(a);
  const nb = normPath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const baseA = na.split('/').pop() ?? '';
  const baseB = nb.split('/').pop() ?? '';
  return baseA !== '' && baseA === baseB;
}

/**
 * 智能预设：模型切换时静默匹配并应用该模型已保存的预设（不弹窗询问）。
 * - 匹配规则（2026-10-08 起）：预设**绑定的模型文件** = 当前模型（路径一致优先、文件名退化）。
 *   旧版「预设名 = 模型别名/文件名」的命名约定匹配废除——名字是展示属性，不再承担身份匹配；
 *   未绑定模型的纯参数集预设永不自动应用（那是用户显式「应用」的范畴）。
 * - 匹配成功即直接覆盖应用（以预设名建立基线）；无匹配则不动（参数留在内存，关闭应用即丢弃）。
 */
export function useModelPreset() {
  const params = useParamsStore();
  const presetsStore = usePresetsStore();
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
      const hit = list.find((s) => s.model && sameModelFile(s.model, modelPath)) ?? null;
      if (!hit) return false;
      if (settings.settings?.last_preset_id === hit.id) return false;

      // 应用参数值（不注回预设携带的模型路径——用户刚选择的模型优先，
      // 预设绑定的可能是移动前的旧路径）；当前模型保持，基线由 applyPreset 建立
      const preset = await window.api.presets.load(hit.id);
      if (!preset) return false;
      const count = params.applyPreset(preset.values, preset.name);
      presetsStore.setActive(preset.id);
      // 显式再设一次模型：写回 selected_model 并派生 alias（预设归一化可能改写了别名）
      params.set(MODEL_KEY, modelPath);
      await Promise.all([
        params.detectMmproj(modelPath),
        params.loadGguf(modelPath),
        String(params.values.spec_type ?? '') === ''
          ? params.detectDraftModel(modelPath)
          : Promise.resolve(),
      ]);
      server.pushOutput({
        kind: 'success',
        data: `[preset] ${i18n.t('msg_preset_applied', [preset.name, String(count)])}\n`,
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
