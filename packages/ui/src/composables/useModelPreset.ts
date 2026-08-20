import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { presetNameCandidates } from '@/composables/useAutoPresetName';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { Preset } from '@llama-launcher/shared';

// 会话内已拒绝过的（模型路径|预设名）组合：模块级共享，避免切换模型/页面时重复打扰
const declined = new Set<string>();
// 正在处理中的模型路径：并发防护。双击/快速连续点击会并发触发两次调用，
// 两次都会在确认弹窗出现前同时通过 last_preset/declined 检查（当时均为旧值），
// 导致二次确认弹窗。首调用置位后，后续调用直接返回。
let applyingPath: string | null = null;

/**
 * 智能预设：用户显式选择模型时，自动发现该模型已保存的预设并询问是否应用。
 * - 匹配规则：预设名 ∈ 模型文件名候选（文件名 / 去 .gguf/.bin 后缀），
 *   或预设内记录的模型路径与所选模型一致（兼容以 alias 命名的预设）
 * - 确认后直接应用列表中的预设值（含 _enabled），完全覆盖当前参数配置，
 *   再以用户选择的模型为准补齐 mmproj / GGUF；草稿模型仅在预设未配置推测解码时自动检测，
 *   避免检测结果覆盖预设已保存的 spec_type/flash_attn 等选择
 */
export function useModelPreset() {
  const params = useParamsStore();
  const settings = useSettingsStore();
  const server = useServerStore();
  const i18n = useI18nStore();

  async function findPresetForModel(modelPath: string): Promise<Preset | null> {
    if (!modelPath) return null;
    const list = await window.api.presets.list();
    if (!Array.isArray(list) || list.length === 0) return null;
    const names = presetNameCandidates(modelPath);
    return (
      list.find((p) => names.includes(p.name)) ??
      list.find((p) => String(p.values[MODEL_KEY] ?? '') === modelPath) ??
      null
    );
  }

  /**
   * 模型选择后调用：存在匹配预设且当前未应用它时弹窗询问，确认后应用。
   * 返回是否实际应用了预设。
   */
  async function applyModelPresetIfAny(modelPath: string): Promise<boolean> {
    if (!modelPath) return false;
    // 并发防护：上一次模型切换（含确认弹窗与异步检测）尚未结束时忽略后续触发
    if (applyingPath !== null) return false;
    applyingPath = modelPath;
    try {
      const preset = await findPresetForModel(modelPath);
      if (!preset) return false;
      // 该预设已应用 / 本会话已拒绝过 → 不再打扰
      if (settings.settings?.last_preset === preset.name) return false;
      const declineKey = `${modelPath}|${preset.name}`;
      if (declined.has(declineKey)) return false;
      const ok = await confirm({
        title: i18n.t('msg_apply_model_preset_title'),
        message: i18n.t('msg_apply_model_preset').replace('{0}', preset.name),
        variant: 'info',
      });
      if (!ok) {
        declined.add(declineKey);
        return false;
      }
      // 直接应用列表返回的预设值（含 _enabled），避免二次 load 失败导致"确认后无反应"
      const count = params.applyPreset(preset.values);
      // 以用户刚选择的模型为准（预设可能携带旧模型路径或未包含模型）
      params.set(MODEL_KEY, modelPath);
      // 补齐预设可能缺失的信息：
      // - mmproj / GGUF 元数据：始终重新检测（收敛到模型当前实际状态）
      // - 草稿模型：仅当预设未显式配置推测解码（spec_type 为空）时才自动检测，
      //   否则保留预设的 spec_type/flash_attn/spec_draft_n_max 等选择
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
      server.pushOutput({
        kind: 'success',
        data: `[preset] ${i18n.t('msg_preset_applied').replace('{0}', preset.name).replace('{1}', String(count))}\n`,
        ts: Date.now(),
      });
      return true;
    } catch (e: any) {
      server.pushOutput({
        kind: 'error',
        data: `[preset] ${i18n.t('msg_preset_apply_failed').replace('{0}', e?.message ?? String(e))}\n`,
        ts: Date.now(),
      });
      return false;
    } finally {
      applyingPath = null;
    }
  }

  return { findPresetForModel, applyModelPresetIfAny };
}
