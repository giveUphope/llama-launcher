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
import { useAutoPresetName } from '@/composables/useAutoPresetName';

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
  const m = p.values[MODEL_KEY];
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
  await window.api.presets.save(name, params.snapshot());
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
  await window.api.presets.save(target.name, params.snapshot());
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
    const count = params.applyPreset(loaded.values);
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
      <div v-if="appliedMsg" class="applied-msg">{{ appliedMsg }}</div>
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

.applied-msg {
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-row);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid var(--success);
  color: var(--success);
  font-size: var(--fs-base);
}

.action-btn {
  height: var(--btn-h);
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  &.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
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
