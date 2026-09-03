<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import { useParamsStore } from '@/stores/params';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { GgufModelInfo } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';

const i18n = useI18nStore();
const params = useParamsStore();

// 详情展开状态（默认折叠，避免信息过载；用户主动展开查看完整元数据）。
// 头部的「收起到只显示模型名」按钮已整合移除：卡片紧凑、两层展开控件用途重复，
// 详情开关（details-toggle）为唯一展开/收起控制点。
const showDetails = ref(false);

const modelPath = computed(() => String(params.values[MODEL_KEY] ?? ''));
const info = computed(() => params.ggufInfo);
const hasInfo = computed(() => !!info.value);
const modelName = computed(() => info.value?.name || info.value?.architecture || '');

interface MetaRow {
  labelKey: string;
  value: unknown;
}

// 主摘要：A 类身份识别信息（架构、量化、规模、上下文长度——确认"这是什么模型"）
const summaryRows = computed<MetaRow[]>(() => {
  if (!info.value) return [];
  const i = info.value;
  return [
    { labelKey: 'gguf_arch', value: i.architecture },
    { labelKey: 'gguf_quant', value: i.quantization },
    { labelKey: 'gguf_size_label', value: i.size_label },
    { labelKey: 'gguf_context_length', value: i.context_length },
  ].filter((r) => r.value !== null && r.value !== undefined && r.value !== '');
});

// 详细信息按实际用途分两类（展示信息 ≠ 参数建议，映射分类见 docs/params-system.md §5.1）：
// - B 类「模型事实 → 参数关联」：对应参数页可调整的启动参数，其中确定性事实（MTP 头）
//   已由 buildSuggestions 映射为建议；上下文长度为训练上限参考（-c 默认 0 = 从模型加载）。
// - D 类「纯参考信息」：仅辅助了解模型结构，永不映射参数（llama-server 自动读取元数据）。
const detailRows = computed<MetaRow[]>(() => {
  if (!info.value) return [];
  const i: GgufModelInfo = info.value;
  return [
    // ---- B 类：与运行参数相关的事实 ----
    // 推测解码（已映射建议 → spec-type=draft-mtp）
    { labelKey: 'gguf_mtp_layers', value: i.nextn_predict_layers },
    // 混合注意力间隔（混合架构标识；缓存策略可在参数页 --swa-full 手动调整，不自动建议）
    { labelKey: 'gguf_full_attn_interval', value: i.full_attention_interval },
    // 聊天模板（存在 → --jinja 启用即可生效；避免手动覆盖 --chat-template）
    { labelKey: 'gguf_chat_template', value: i.chat_template ? '✓' : null },
    // ---- D 类：纯参考信息 ----
    // MoE 专家配置（总数/每 token 激活数）
    {
      labelKey: 'gguf_moe_experts',
      value: i.expert_count ? `${i.expert_count} / ${i.expert_used_count ?? '—'}` : null,
    },
    // RoPE 基频（llama-server 默认自动读取元数据，无需参数映射）
    { labelKey: 'gguf_rope_freq_base', value: i.rope_freq_base },
  ].filter((r) => r.value !== null && r.value !== undefined && r.value !== '');
});

// 是否有详细信息可展开
const hasDetails = computed(() => detailRows.value.length > 0);
// 注：显存估算不在此卡展示（参数页状态条为唯一展示位，避免两页重复）

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}
</script>

<template>
  <Card v-if="modelPath && hasInfo" title-key="card_model_info">
    <div class="meta-header">
      <span v-if="modelName" class="meta-model-name">{{ modelName }}</span>
    </div>
    <div class="meta-body">
      <div class="meta-chips">
        <span v-for="row in summaryRows" :key="row.labelKey" class="meta-chip">
          <span class="chip-key">{{ i18n.t(row.labelKey) }}</span>
          <span class="chip-eq">=</span>
          <span class="chip-val">{{ formatValue(row.value) }}</span>
        </span>
      </div>
      <button
        v-if="hasDetails"
        class="details-toggle"
        @click="showDetails = !showDetails"
      >
        <Icon :name="showDetails ? 'chevron_down' : 'chevron_right'" :size="11" />
        <span>{{ i18n.t(showDetails ? 'gguf_details_collapse' : 'gguf_details_toggle') }} ({{ detailRows.length }})</span>
      </button>
      <div v-if="showDetails && hasDetails" class="meta-chips details">
        <span v-for="row in detailRows" :key="row.labelKey" class="meta-chip">
          <span class="chip-key">{{ i18n.t(row.labelKey) }}</span>
          <span class="chip-eq">=</span>
          <span class="chip-val">{{ formatValue(row.value) }}</span>
        </span>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.meta-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.meta-model-name {
  font-family: var(--font-mono);
  color: var(--accent);
  font-size: var(--fs-md);
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.chip-key {
  color: var(--accent);
  font-weight: 600;
}

.chip-eq {
  color: var(--fg-muted);
}

.chip-val {
  color: var(--fg-primary);
}

// 详情区使用更小字号和更淡的背景，与主摘要区分视觉层级
// 次级分隔（dashed）线到内容 8px；主分隔（solid）为 14px，见 frontend.md §7.5.4
.meta-chips.details {
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-pill);
  align-self: flex-start;
  transition: color var(--dur-fast) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }

}
</style>
