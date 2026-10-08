<script setup lang="ts">
// 参数预设面板（低摩擦版，纯视图）：
// - 数据全部来自 presets store（视图模型 PresetSummary，以稳定 id 为行键/引用键）；
//   目录、文件名、JSON 布局属于存储层，本组件一概不知（2026-10-08 解耦重构）。
// - 智能命名：输入框自动同步 alias/模型文件名（useAutoPresetName），无需手输；
// - 自适应保存按钮：输入名已存在时按钮自动变为「覆盖预设」，同一入口完成保存/覆盖；
// - 行内操作 + 双击应用：应用/重命名/删除直接在行内完成（双击行 = 应用）；
// - 自动刷新：面板激活（onActivated）时经 store 拉取，增删改由 store 内刷新；
// - 保留名称↔绑定模型一致性确认（防「应用其他预设后沿用旧名保存」的错绑）。
import { ref, computed, watch, onActivated, onUnmounted } from 'vue';
import type { PresetSummary } from '@llama-launcher/shared';
import { MODEL_KEY, formatRelativeTime } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useParamsStore } from '@/stores/params';
import { usePresetsStore } from '@/stores/presets';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { useAutoPresetName, isNameConsistentWithModel } from '@/composables/useAutoPresetName';

const params = useParamsStore();
const store = usePresetsStore();
const settings = useSettingsStore();
const server = useServerStore();
const i18n = useI18nStore();
const autoPresetName = useAutoPresetName();

const presetName = ref('');

// 自适应保存按钮：输入名与已有预设同名 → 覆盖（同一入口，无独立"覆盖"按钮）。
// 覆盖判定来自 store 摘要（存储层 upsert 语义的预告知），不依赖本地完整列表。
const isOverwriteName = computed(() =>
  presetName.value.trim() !== '' && store.summaries.some((p) => p.name === presetName.value.trim()),
);

const modelLabel = (p: PresetSummary): string => {
  // 绑定的模型文件路径取 basename 展示（null = 未绑定模型的纯参数集）
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

// 应用预设后的即时反馈（短暂显示，同时写入控制台）
const appliedMsg = ref('');
let appliedTimer: number | null = null;

// ---- 行内重命名（id 恒定，改名不再使「当前」标记失效） ----
const renamingId = ref('');
const renameDraft = ref('');
function onStartRename(p: PresetSummary) {
  renamingId.value = p.id;
  renameDraft.value = p.name;
}
async function onConfirmRename() {
  const id = renamingId.value;
  const name = renameDraft.value.trim();
  renamingId.value = '';
  if (!id || !name) return;
  // 重名/不存在时 store 静默返回 null，列表保持原样（无需额外提示，输入框已收起）
  await store.renamePreset(id, name);
}

// 名称↔模型一致性守卫（仅针对真实的错绑风险，不打扰自定义命名）：
// 当前绑定模型与保存名不对应，且同名预设已存在并绑定了另一模型时，本次保存
// 会把新模型写进旧名预设（错绑来源：「应用」其他预设连带切换模型后沿用旧名保存）——
// 弹确认说明后果，取消即中止。无同名预设/同名预设未绑定模型 = 用户自主行为，静默放行。
async function confirmNameModelMismatch(name: string): Promise<boolean> {
  const binding = String(params.values[MODEL_KEY] ?? '');
  if (!binding || isNameConsistentWithModel(name, binding)) return true;
  const row = store.summaries.find((p) => p.name === name);
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
  const existing = store.summaries.find((p) => p.name === name);
  // 同名预设存在时弹出确认提示（按钮文案已提前变为「覆盖预设」预告行为）
  if (existing) {
    const ok = await confirm({
      title: i18n.t('msg_confirm_overwrite_title'),
      message: i18n.t('msg_confirm_overwrite', [name]),
      variant: 'warning',
    });
    if (!ok) return;
  }
  if (!(await confirmNameModelMismatch(name))) return;
  // store 内完成：IPC upsert → 保存点设为新基线 → 当前预设引用指向新 id → 刷新列表
  await store.savePreset({ name, id: existing?.id });
}

async function onApplyPreset(id: string) {
  const applied = await store.applyById(id);
  if (!applied) return;
  // 反馈：面板内短暂提示 + 控制台输出，让用户确认预设确实覆盖了参数配置
  const msg = i18n.t('msg_preset_applied', [applied.name, String(applied.count)]);
  server.pushOutput({
    kind: 'success',
    data: `[preset] ${msg}\n`,
    ts: Date.now(),
  });
  appliedMsg.value = msg;
  if (appliedTimer != null) window.clearTimeout(appliedTimer);
  appliedTimer = window.setTimeout(() => { appliedMsg.value = ''; }, 3000);
}

// 删除不可恢复，二次确认由行内按钮的 a-popconfirm 承担（迁移 Arco 后不再走 useConfirm 弹窗）
async function onDeletePreset(id: string) {
  await store.deleteById(id);
}

onUnmounted(() => {
  if (appliedTimer != null) {
    window.clearTimeout(appliedTimer);
    appliedTimer = null;
  }
});

// 首次进入刷新；面板在 KeepAlive 内，切回「预设」子标签时自动刷新（外部改动手动可见），替代原手动刷新按钮
void store.refresh();
onActivated(() => { void store.refresh(); });
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
        <div v-if="!store.loaded" class="list-loading">
          <a-spin />
        </div>
        <a-empty v-else-if="!store.summaries.length" class="empty" :description="i18n.t('preset_empty')" />
        <a-list v-else :bordered="false" size="small" class="preset-list">
          <a-list-item
            v-for="p in store.summaries"
            :key="p.id"
            class="preset-row"
            :class="{ active: p.id === store.activeId }"
            @dblclick="onApplyPreset(p.id)"
          >
            <div class="preset-row-inner">
              <span class="col-name">
                <!-- 重命名态：行内输入替换名称（Enter/确定提交，Esc/取消收起） -->
                <template v-if="p.id === renamingId">
                  <a-input
                    v-model="renameDraft"
                    size="small"
                    class="rename-input"
                    :maxlength="80"
                    @press-enter="onConfirmRename"
                    @keyup.esc="renamingId = ''"
                    @dblclick.stop
                    @click.stop
                  />
                  <a-button size="mini" type="primary" class="row-action" @click.stop="onConfirmRename">
                    {{ i18n.t('preset_rename_ok') }}
                  </a-button>
                  <a-button size="mini" class="row-action" @click.stop="renamingId = ''">
                    {{ i18n.t('dlg_cancel') }}
                  </a-button>
                </template>
                <template v-else>
                  <span class="preset-name">{{ p.name }}</span>
                  <a-tag v-if="p.id === store.activeId" size="small" color="arcoblue" class="active-badge">
                    {{ i18n.t('preset_active') }}
                  </a-tag>
                </template>
              </span>
              <span class="col-time">{{ formatRelativeTime(p.saved_at, settings.language) }}</span>
              <ToolTip :text="modelLabel(p)"><span class="col-model">{{ modelLabel(p) }}</span></ToolTip>
              <span class="col-actions">
                <ToolTip :text="i18n.t('preset_apply')">
                  <a-button size="small" type="primary" class="row-action" @click="onApplyPreset(p.id)">
                    <template #icon><Icon name="check" :size="11" /></template>
                    {{ i18n.t('preset_apply') }}
                  </a-button>
                </ToolTip>
                <ToolTip :text="i18n.t('preset_rename')">
                  <a-button size="small" class="row-action" @click.stop="onStartRename(p)">
                    <template #icon><Icon name="edit" :size="11" /></template>
                    {{ i18n.t('preset_rename') }}
                  </a-button>
                </ToolTip>
                <a-popconfirm
                  :title="i18n.t('msg_preset_delete_title')"
                  :content="i18n.t('msg_preset_delete', [p.name])"
                  @ok="onDeletePreset(p.id)"
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

  // 当前应用的预设行：accent 色调底纹（按 id 判定，改名不丢标记）
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

  .rename-input {
    max-width: 260px;
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
