<script setup lang="ts">
// 参数预设面板（低摩擦版）：
// - 智能命名：输入框自动同步 alias/模型文件名（useAutoPresetName），无需手输；
// - 自适应保存按钮：输入名已存在时按钮自动变为「覆盖预设」，同一入口完成保存/覆盖；
// - 行内操作 + 双击应用：应用/删除直接在行内完成（双击行 = 应用），无工具栏、无"先选中再操作"两步流；
// - 自动刷新：面板激活（onActivated）与增删改后自动拉取，无手动刷新按钮；
// - 保留名称↔绑定模型一致性确认（防「应用其他预设后沿用旧名保存」的错绑）。
import { ref, watch, computed, onActivated, onUnmounted } from 'vue';
import type { Preset } from '@llama-launcher/shared';
import { MODEL_KEY, formatRelativeTime } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
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

// 当前应用的预设（settings.last_preset 为单一事实源，用于列表标记"当前"）
const activePresetName = computed(() => settings.settings?.last_preset ?? '');

// 应用预设后的即时反馈（短暂显示，同时写入控制台）
const appliedMsg = ref('');
let appliedTimer: number | null = null;

// 自适应保存按钮：输入名与已有预设同名 → 覆盖（同一入口，无独立"覆盖"按钮）
const isOverwriteName = computed(() =>
  presetName.value.trim() !== '' && presets.value.some((p) => p.name === presetName.value.trim()),
);

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
}

// 名称↔模型一致性守卫（仅针对真实的错绑风险，不打扰自定义命名）：
// 当前绑定模型与保存名不对应，且同名预设已存在并绑定了另一模型时，本次保存
// 会把新模型写进旧名预设（错绑来源：「应用」其他预设连带切换模型后沿用旧名保存）——
// 弹确认说明后果，取消即中止。无同名预设/同名预设未绑定模型 = 用户自主行为，静默放行。
async function confirmNameModelMismatch(name: string): Promise<boolean> {
  const binding = String(params.values[MODEL_KEY] ?? '');
  if (!binding || isNameConsistentWithModel(name, binding)) return true;
  const row = presets.value.find((p) => p.name === name);
  if (!row || !row.model) return true;
  const base = binding.split(/[/\\]/).pop() ?? binding;
  return (await confirm({
    title: i18n.t('msg_preset_model_mismatch_title'),
    message: i18n.t('msg_preset_model_mismatch').replace('{0}', name).replace('{1}', base),
    variant: 'warning',
  })) === true;
}

async function onSavePreset() {
  const name = presetName.value.trim();
  if (!name) return;
  // 同名预设存在时弹出确认提示（按钮文案已提前变为「覆盖预设」预告行为）
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
  if (settings.settings) {
    settings.settings.last_preset = name;
    void settings.save();
  }
  await onRefreshList();
}

async function onApplyPreset(name: string) {
  const loaded = await window.api.presets.load(name);
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

// 删除不可恢复，二次确认由行内按钮的 a-popconfirm 承担（迁移 Arco 后不再走 useConfirm 弹窗）
async function onDeletePreset(name: string) {
  await window.api.presets.delete(name);
  await onRefreshList();
}

onUnmounted(() => {
  if (appliedTimer != null) {
    window.clearTimeout(appliedTimer);
    appliedTimer = null;
  }
});

// 首次进入刷新；面板在 KeepAlive 内，切回「预设」子标签时自动刷新（外部改动手动可见），替代原手动刷新按钮
onRefreshList();
onActivated(() => { void onRefreshList(); });
</script>

<template>
  <div class="presets-panel">
    <Card title-key="card_save">
      <div class="save-row">
        <label class="field-label">{{ i18n.t('lbl_preset_name') }}</label>
        <a-input
          class="name-input"
          v-model="presetName"
          :placeholder="autoPresetName"
          @press-enter="onSavePreset"
        />
        <a-button type="primary" :disabled="!presetName.trim()" @click="onSavePreset">
          {{ i18n.t(isOverwriteName ? 'overwrite_preset' : 'save_preset') }}
        </a-button>
      </div>
    </Card>

    <Card title-key="card_preset_list">
      <template #actions>
        <span class="list-hint">{{ i18n.t('preset_dblclick_hint') }}</span>
      </template>
      <!-- 应用提示防跳动：外层槽位常驻并与提示行等高（padding 6×2 + fs-base 行高 ≈ 32px），
           无提示时隐藏但占满高度——提示条出现/消失时下方表格不再下移（#42 预留位置模式）。 -->
      <div class="applied-msg-slot" :class="{ 'has-msg': !!appliedMsg }">
        <div v-if="appliedMsg" class="applied-msg">{{ appliedMsg }}</div>
      </div>
      <div class="list-wrap">
        <a-empty v-if="!presets.length" class="empty" :description="i18n.t('preset_empty')" />
        <a-list v-else :bordered="false" size="small" class="preset-list">
          <a-list-item
            v-for="p in presets"
            :key="p.name"
            class="preset-row"
            :class="{ active: p.name === activePresetName }"
            @dblclick="onApplyPreset(p.name)"
          >
            <div class="preset-row-inner">
              <span class="col-name">
                <span class="preset-name">{{ p.name }}</span>
                <a-tag v-if="p.name === activePresetName" size="small" color="arcoblue" class="active-badge">
                  {{ i18n.t('preset_active') }}
                </a-tag>
              </span>
              <span class="col-time">{{ formatRelativeTime(p.saved_at, settings.language) }}</span>
              <span class="col-model" :title="modelLabel(p)">{{ modelLabel(p) }}</span>
              <span class="col-actions">
                <a-button size="small" type="primary" class="row-action" :title="i18n.t('preset_apply')" @click="onApplyPreset(p.name)">
                  <Icon name="play" :size="11" />
                  {{ i18n.t('preset_apply') }}
                </a-button>
                <a-popconfirm
                  :title="i18n.t('msg_preset_delete_title')"
                  :content="i18n.t('msg_preset_delete').replace('{0}', p.name)"
                  @ok="onDeletePreset(p.name)"
                >
                  <a-button size="small" status="danger" class="row-action" :title="i18n.t('preset_delete')">
                    <Icon name="trash" :size="11" />
                    {{ i18n.t('preset_delete') }}
                  </a-button>
                </a-popconfirm>
              </span>
            </div>
          </a-list-item>
        </a-list>
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
}

// 列表卡右上角操作提示：次级弱化文案（双击应用 / 同名保存即覆盖）
.list-hint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
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
  color: var(--success-text); // 文字用深绿达 AA；底/边保留亮 --success 语义
  font-size: var(--fs-base);
}

.list-wrap {
  max-height: 360px;
  overflow: auto;
}

// 预设列表行：覆盖 a-list-item 默认内边距，改由行内 wrapper 控制（接近原表格 6×8 紧凑布局）
.preset-row {
  padding: 0;
  cursor: pointer; // 双击应用的可点击暗示

  :deep(.arco-list-item) {
    padding: 0;
  }

  &:hover {
    background: var(--bg-hover);
  }

  // 当前应用的预设行：accent 色调底纹
  &.active {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
}

.preset-row-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  min-width: 0;
}

.col-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;

  .preset-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.col-time {
  // 短时间文本（MM-DD HH:MM）：压缩到恰好容纳，把空间让给弹性名称列
  width: 110px;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--fg-secondary);
}

.col-model {
  // 长模型名单行截断：固定列宽内不再换行/溢出挤压相邻列
  width: 190px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

// 操作列：紧凑收纳行内按钮，避免挤压名称/模型列
.col-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty {
  padding: 20px;
}
</style>
