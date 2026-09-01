<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import type { Preset } from '@llama-launcher/shared';
import { MODEL_KEY, formatRelativeTime } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { useAutoPresetName, isNameConsistentWithModel } from '@/composables/useAutoPresetName';

const params = useParamsStore();
const settings = useSettingsStore();
const server = useServerStore();
const i18n = useI18nStore();
const autoPresetName = useAutoPresetName();

const presets = ref<Preset[]>([]);
const presetName = ref('');
const selectedRow = ref(-1);

// 当前应用的预设（settings.last_preset 为单一事实源，用于列表标记"当前"）
const activePresetName = computed(() => settings.settings?.last_preset ?? '');

// 应用预设后的即时反馈（短暂显示，同时写入控制台）
const appliedMsg = ref('');
let appliedTimer: number | null = null;

const modelLabel = (p: Preset): string => {
  // v2 结构：模型路径为顶层元数据字段（null = 未绑定模型）
  const m = p.model;
  return m ? (String(m).split(/[/\\]/).pop() ?? '') : i18n.t('status_model_none');
};

// 自动生成名称变化时同步到输入框（仅当输入框为空或与上次自动值一致时同步，避免覆盖用户手动输入）
let lastAutoName = '';
watch(autoPresetName, (nv) => {
  // 输入框为空 或 输入框仍为上次的自动值（用户未手动修改）时才同步
  if (presetName.value === '' || presetName.value === lastAutoName) {
    presetName.value = nv;
  }
  lastAutoName = nv;
}, { immediate: true });

async function onRefreshList() {
  const result = await window.api.presets.list();
  // 防御性检查：浏览器预览/mock 环境下 list 可能返回 null
  presets.value = Array.isArray(result) ? result : [];
  selectedRow.value = -1;
}

// 名称↔模型一致性守卫（仅针对真实的错绑风险，不打扰自定义命名）：
// 当前绑定模型与保存名不对应，且同名预设已存在并绑定了另一模型时，本次保存
// 会把新模型写进旧名预设（错绑来源：「应用」其他预设连带切换模型后沿用选中行名保存）——
// 弹确认说明后果，取消即中止。无同名预设/同名预设未绑定模型 = 用户自主行为，静默放行。
async function confirmNameModelMismatch(name: string): Promise<boolean> {
  const binding = String(params.values[MODEL_KEY] ?? '');
  if (!binding || isNameConsistentWithModel(name, binding)) return true;
  const row = presets.value.find((p) => p.name === name);
  if (!row || !row.model) return true;
  const base = binding.split(/[/\\]/).pop() ?? binding;
  return confirm({
    title: i18n.t('msg_preset_model_mismatch_title'),
    message: i18n.t('msg_preset_model_mismatch').replace('{0}', name).replace('{1}', base),
    variant: 'warning',
  });
}

async function onSavePreset() {
  const name = presetName.value.trim();
  if (!name) return;
  // 同名预设存在时弹出确认提示
  const exists = presets.value.some(p => p.name === name);
  if (exists) {
    const ok = await confirm({
      title: i18n.t('msg_confirm_overwrite_title'),
      message: i18n.t('msg_confirm_overwrite').replace('{0}', name),
      variant: 'warning',
    });
    if (!ok) return;
  }
  if (!(await confirmNameModelMismatch(name))) return;
  await window.api.presets.save(name, params.snapshot());
  // 保存点 = 新基线（双轨逻辑：显式保存才写预设文件，并刷新基线归零脏标记）
  params.markBaseline(name);
  presetName.value = '';
  await onRefreshList();
  if (settings.settings) {
    settings.settings.last_preset = name;
    void settings.save();
  }
}

// 覆盖当前选中的预设：确认后以选中预设名保存，无需手动输入同名
async function onOverwriteSelected() {
  if (selectedRow.value < 0 || selectedRow.value >= presets.value.length) return;
  const target = presets.value[selectedRow.value];
  const ok = await confirm({
    title: i18n.t('msg_confirm_overwrite_title'),
    message: i18n.t('msg_confirm_overwrite').replace('{0}', target.name),
    variant: 'warning',
  });
  if (!ok) return;
  if (!(await confirmNameModelMismatch(target.name))) return;
  await window.api.presets.save(target.name, params.snapshot());
  // 保存点 = 新基线
  params.markBaseline(target.name);
  await onRefreshList();
  // 保持选中状态指向刚覆盖的预设
  const idx = presets.value.findIndex(p => p.name === target.name);
  selectedRow.value = idx >= 0 ? idx : -1;
  if (settings.settings) {
    settings.settings.last_preset = target.name;
    void settings.save();
  }
}

async function onApplySelected() {
  if (selectedRow.value < 0 || selectedRow.value >= presets.value.length) return;
  const target = presets.value[selectedRow.value];
  const loaded = await window.api.presets.load(target.name);
  if (loaded) {
    // v2 结构：model 顶层字段注回 values 供 applyPreset 识别（null = 保留当前模型）
    const applyValues = loaded.model ? { ...loaded.values, [MODEL_KEY]: loaded.model } : loaded.values;
    const count = params.applyPreset(applyValues, loaded.name);
    if (settings.settings) {
      settings.settings.last_preset = loaded.name;
      void settings.save();
    }
    // 反馈：面板内短暂提示 + 控制台输出，让用户确认预设确实覆盖了参数配置
    const msg = i18n.t('msg_preset_applied').replace('{0}', loaded.name).replace('{1}', String(count));
    server.pushOutput({
      kind: 'success',
      data: `[preset] ${msg}\n`,
      ts: Date.now(),
    });
    appliedMsg.value = msg;
    if (appliedTimer != null) window.clearTimeout(appliedTimer);
    appliedTimer = window.setTimeout(() => { appliedMsg.value = ''; }, 3000);
  }
}

async function onDeleteSelected() {
  if (selectedRow.value < 0 || selectedRow.value >= presets.value.length) return;
  const target = presets.value[selectedRow.value];
  await window.api.presets.delete(target.name);
  presetName.value = '';
  await onRefreshList();
}

function selectRow(idx: number) {
  selectedRow.value = idx;
  // 选中预设时自动填充名称输入框，便于二次调整后覆盖保存
  if (idx >= 0 && idx < presets.value.length) {
    const name = presets.value[idx].name;
    presetName.value = name;
    // 标记为非自动值，避免模型别名变化时覆盖用户选中的预设名
    lastAutoName = name;
  }
}

onUnmounted(() => {
  if (appliedTimer != null) {
    window.clearTimeout(appliedTimer);
    appliedTimer = null;
  }
});

// 首次进入时刷新列表
onRefreshList();
</script>

<template>
  <div class="presets-panel">
    <Card title-key="card_save">
      <div class="save-row">
        <label class="field-label">{{ i18n.t('lbl_preset_name') }}</label>
        <input class="name-input" type="text" v-model="presetName" @keydown.enter="onSavePreset" />
        <button class="action-btn primary" :disabled="!presetName.trim()" @click="onSavePreset">
          {{ i18n.t('save_preset') }}
        </button>
        <span class="hint">{{ i18n.t('lbl_same_overwrite') }}</span>
      </div>
    </Card>

    <Card title-key="card_preset_list">
      <div class="toolbar">
        <button class="action-btn" :disabled="selectedRow < 0" @click="onApplySelected">
          {{ i18n.t('apply_selected') }}
        </button>
        <button class="action-btn primary" :disabled="selectedRow < 0" @click="onOverwriteSelected">
          {{ i18n.t('overwrite_selected') }}
        </button>
        <button class="action-btn danger" :disabled="selectedRow < 0" @click="onDeleteSelected">
          {{ i18n.t('delete_selected') }}
        </button>
        <button class="action-btn" @click="onRefreshList">{{ i18n.t('refresh_list') }}</button>
      </div>
      <!-- 应用提示防跳动：外层槽位常驻并与提示行等高（padding 6×2 + fs-base 行高 ≈ 32px），
           无提示时隐藏但占满高度——提示条出现/消失时下方表格不再下移（#42 预留位置模式）。 -->
      <div class="applied-msg-slot" :class="{ 'has-msg': !!appliedMsg }">
        <div v-if="appliedMsg" class="applied-msg">{{ appliedMsg }}</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ i18n.t('col_name') }}</th>
              <th class="col-time">{{ i18n.t('col_time') }}</th>
              <th class="col-model">{{ i18n.t('col_model') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!presets.length">
              <td colspan="3" class="empty">—</td>
            </tr>
            <tr
              v-for="(p, idx) in presets"
              :key="p.name"
              :class="{ selected: selectedRow === idx, active: p.name === activePresetName }"
              @click="selectRow(idx)"
            >
              <td>
                <span class="preset-name">{{ p.name }}</span>
                <span v-if="p.name === activePresetName" class="active-badge">{{ i18n.t('preset_active') }}</span>
              </td>
              <td class="col-time">{{ formatRelativeTime(p.saved_at, settings.language) }}</td>
              <td class="col-model">{{ modelLabel(p) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>

<style scoped lang="scss">
.presets-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.field-label {
  font-size: var(--fs-lg);
  color: var(--fg-secondary);
  width: 70px;
  flex-shrink: 0;
}

.name-input {
  flex: 1;
  min-width: 200px;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

.hint {
  font-size: var(--fs-base);
  color: var(--fg-muted);
}

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.applied-msg-slot {
  margin-bottom: 8px;
  min-height: 32px; // = 提示行实际高度（padding 6px×2 + fs-base 13 × 行高 1.5 ≈ 31.5px）

  &:not(.has-msg) {
    visibility: hidden;
  }
}

.applied-msg {
  padding: 6px 10px;
  border-radius: var(--radius-row);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid var(--success);
  color: var(--success);
  font-size: var(--fs-base);
}

.table-wrap {
  max-height: 360px;
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-base);

  thead th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--glass-border);
    color: var(--fg-secondary);
    font-weight: 600;
    position: sticky;
    top: 0;
    /* 粘性表头必须不透明：行滚动穿过表头时半透明玻璃会透底（且滚动容器禁 blur） */
    background: var(--bg-card);
  }

  tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-primary);
  }

  tbody tr {
    cursor: pointer;

    &:hover {
      background: var(--bg-hover);
    }

    &.selected {
      background: var(--bg-active);
    }

    // 当前应用的预设行：accent 色调底纹 + 左侧强调边
    &.active {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
  }

  .preset-name {
    margin-right: 6px;
  }

  .active-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: #fff;
    font-size: var(--fs-xs);
    line-height: 1.4;
    vertical-align: middle;
  }

  .col-time {
    width: 180px;
  }

  .col-model {
    width: 200px;
  }

  .empty {
    text-align: center;
    color: var(--fg-muted);
    padding: 20px;
  }
}
</style>
