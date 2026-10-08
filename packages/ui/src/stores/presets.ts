import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { PresetSummary } from '@llama-launcher/shared';
import { useSettingsStore } from './settings';
import { useParamsStore } from './params';

/**
 * 预设视图模型 store：列表展示与应用/保存/改名/删除的唯一入口。
 *
 * 解耦边界（2026-10-08 预设重构）：本 store 只认 id 与 PresetSummary——
 * 目录位置、文件名、JSON 布局都在 core 的 PresetRepository 之后，界面永远接触不到。
 * 「当前预设」以 last_preset_id 引用（旧版按名的 last_preset 仅在启动链兜底读取一次），
 * 改名/换存储位置不再产生悬空引用；删除当前预设时主动清空引用。
 */
export const usePresetsStore = defineStore('presets', () => {
  const summaries = ref<PresetSummary[]>([]);
  // 首次取数是否已落地（STYLE_TODO #81 ③）：IPC 回来之前不渲染「暂无预设」的错默认态
  const loaded = ref(false);

  const settings = useSettingsStore();

  /** 当前应用的预设 id（settings.last_preset_id 为单一事实源） */
  const activeId = computed(() => settings.settings?.last_preset_id ?? '');

  /** 写当前预设引用：id 接管后同步清空旧版按名字段，完成 last_preset → last_preset_id 的单向迁移 */
  function setActive(id: string) {
    if (!settings.settings) return;
    settings.settings.last_preset_id = id;
    settings.settings.last_preset = '';
    void settings.save();
  }

  async function refresh() {
    try {
      const result = await window.api.presets.list();
      // 防御性检查：浏览器预览/mock 环境下 list 可能返回 null
      summaries.value = Array.isArray(result) ? result : [];
    } finally {
      loaded.value = true;
    }
  }

  /**
   * 应用预设：完整实体由存储层按 id 取回，「model 顶层注回 values」的布局知识
   * 收敛在 params.applyPresetEntity 一处。返回展示信息（预设名 + 非默认参数数）供调用方反馈。
   */
  async function applyById(id: string): Promise<{ name: string; count: number } | null> {
    const preset = await window.api.presets.load(id);
    if (!preset) return null;
    const params = useParamsStore();
    const count = params.applyPresetEntity(preset);
    setActive(preset.id);
    return { name: preset.name, count };
  }

  /** 保存当前参数为预设（upsert 语义见 shared PresetSaveInput）；保存点 = 新基线（双轨逻辑） */
  async function savePreset(input: { name: string; id?: string }): Promise<PresetSummary | null> {
    const params = useParamsStore();
    const saved = await window.api.presets.save({ name: input.name, values: params.snapshot(), id: input.id });
    setActive(saved.id);
    params.markBaseline(saved.name);
    await refresh();
    return saved;
  }

  /** 重命名（id 恒定；当前预设引用不受影响）；失败（重名/不存在）返回 null */
  async function renamePreset(id: string, name: string): Promise<PresetSummary | null> {
    try {
      const renamed = await window.api.presets.rename(id, name);
      await refresh();
      return renamed;
    } catch {
      return null;
    }
  }

  /** 删除预设；删的是当前预设时同步清空引用（v3 起 last_preset 不再有悬空窗口） */
  async function deleteById(id: string): Promise<boolean> {
    const ok = await window.api.presets.delete(id);
    if (ok && activeId.value === id) setActive('');
    await refresh();
    return ok;
  }

  return { summaries, loaded, activeId, refresh, applyById, savePreset, renamePreset, deleteById, setActive };
});
