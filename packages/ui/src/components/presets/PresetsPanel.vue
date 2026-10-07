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
import ToolTip from '@/components/common/ToolTip.vue';
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

// 首次取数是否已落地（STYLE_TODO #81 ③）：IPC 回来之前 presets 是空数组，
// 直接渲染「暂无预设」等于把「还没查到」说成「确实没有」——错的默认态，
// 且列表一到位就整块替换。取数未回时渲染一行加载占位，不回就不下结论。
const presetsLoaded = ref(false);

async function onRefreshList() {
  try {
    const result = await window.api.presets.list();
    // 防御性检查：浏览器预览/mock 环境下 list 可能返回 null
    presets.value = Array.isArray(result) ? result : [];
  } finally {
    presetsLoaded.value = true;
  }
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
    message: i18n.t('msg_preset_model_mismatch', [name, base]),
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
      message: i18n.t('msg_confirm_overwrite', [name]),
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
    const msg = i18n.t('msg_preset_applied', [loaded.name, String(count)]);
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
      <!-- 应用提示：仅在有提示时渲染（瞬时反馈，出现时列表下移可接受）。
           2026-10-08 本体换 a-alert 官方成功横幅（自绘的底色 / 描边 / 文字色删除） -->
      <a-alert v-if="appliedMsg" type="success" class="applied-msg">{{ appliedMsg }}</a-alert>
      <div class="list-wrap">
        <!-- #81 ③：取数未回之前渲染一行加载占位（Arco a-spin），不再抢跑显示「暂无预设」 -->
        <div v-if="!presetsLoaded" class="list-loading">
          <a-spin />
        </div>
        <a-empty v-else-if="!presets.length" class="empty" :description="i18n.t('preset_empty')" />
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
              <ToolTip :text="modelLabel(p)"><span class="col-model">{{ modelLabel(p) }}</span></ToolTip>
              <span class="col-actions">
                <ToolTip :text="i18n.t('preset_apply')">
                  <a-button size="small" type="primary" class="row-action" @click="onApplyPreset(p.name)">
                    <template #icon><Icon name="check" :size="11" /></template>
                    {{ i18n.t('preset_apply') }}
                  </a-button>
                </ToolTip>
                <a-popconfirm
                  :title="i18n.t('msg_preset_delete_title')"
                  :content="i18n.t('msg_preset_delete', [p.name])"
                  @ok="onDeletePreset(p.name)"
                >
                  <ToolTip :text="i18n.t('preset_delete')">
                    <a-button size="small" status="danger" class="row-action row-danger">
                      <template #icon><Icon name="trash" :size="11" /></template>
                      {{ i18n.t('preset_delete') }}
                    </a-button>
                  </ToolTip>
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
  color: var(--color-text-2);
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
  color: var(--fg-hint);
}

/* 应用提示：a-alert 官方 success 横幅承载（配色 / 圆角 / 内距全交回库），此处只留节奏 */
.applied-msg {
  margin-bottom: 8px;
}

.list-wrap {
  max-height: 360px;
  overflow: auto;
  /* #81 ③：静态预留——本容器常驻，加载占位行 / 空态 / 列表 三者都在同一 ≥120px 盒子里
     互换，切状态不再改变卡片体高度（120 按 a-empty 的「图标 + 一行文案」自然高拍的，
     本轮不许开浏览器，未实测；若 a-empty 实测更高只需上调此值） */
  min-height: 120px;
}

/* 加载占位行：容器是块级，a-spin 默认贴左上，居中一下让占位与空态视觉同位
   （代理收尾报告点名缺这条；预留高度由上方 .list-wrap 的 min-height 负责） */
.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

// 预设列表行：对齐 Arco 原生列表样式（small 行 padding 9px 20px + split 分割线），
// 不再覆盖为自定义紧凑 0/6×8（行内 wrapper 仅负责 4 列布局，padding 交给 Arco 行）
.preset-row {
  cursor: pointer; // 双击应用的可点击暗示

  &:hover {
    background: var(--color-fill-3);
  }

  // 当前应用的预设行：accent 色调底纹
  &.active {
    background: color-mix(in srgb, rgb(var(--primary-6)) 10%, transparent);
  }
}

.preset-row-inner {
  display: flex;
  align-items: center;
  gap: 8px;
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
  color: var(--color-text-2);
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
