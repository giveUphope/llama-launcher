<script setup lang="ts">
// 阶段四：参数摘要预览卡（从原 LaunchPage 迁入 ServicePage）。
// 按 PARAM_GROUPS 分组展示已启用参数（值非默认），含启动前快速核对。
// 提示词 §9：「参数保存与应用清晰分离」— 摘要只读，不提供编辑入口。
import { computed } from 'vue';
import { PARAMS, PARAM_GROUPS, MODEL_KEY } from '@llama-launcher/shared';
import type { ParamDef } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

const params = useParamsStore();
const i18n = useI18nStore();

interface SummaryRow {
  key: string;
  label: string;
  value: string;
  flag: string;
}
interface SummaryGroup {
  groupKey: string;
  labelKey: string;
  rows: SummaryRow[];
}

function formatParamValue(p: ParamDef): string {
  const v = params.values[p.key];
  if (v === undefined || v === null || v === '') return '—';
  if (p.type === 'checkbox') return v ? '✓' : '✗';
  if (p.key === 'api_key') return '••••••';
  // 路径类参数（model/mmproj/spec_draft_model）显示完整绝对路径，供启动前核对
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

const summaryGroups = computed<SummaryGroup[]>(() => {
  const groups: SummaryGroup[] = [];
  // 模型单独一组置顶（显示完整绝对路径，供启动前核对）
  const modelPath = String(params.values[MODEL_KEY] ?? '');
  groups.push({
    groupKey: '_model',
    labelKey: 'card_current',
    rows: [{
      key: MODEL_KEY,
      label: i18n.t('lbl_model_path'),
      value: modelPath || i18n.t('status_model_none'),
      flag: '-m',
    }],
  });

  const skipKeys = new Set([MODEL_KEY, 'mmproj', 'spec_draft_model']);
  for (const g of PARAM_GROUPS) {
    const rows: SummaryRow[] = [];
    for (const p of PARAMS) {
      if (p.group !== g.key) continue;
      if (skipKeys.has(p.key)) continue;
      // 仅展示非默认值的参数
      if (params.values[p.key] === p.default) continue;
      rows.push({
        key: p.key,
        label: i18n.paramLabel(p.key),
        value: formatParamValue(p),
        flag: p.flag,
      });
    }
    if (rows.length > 0) {
      groups.push({ groupKey: g.key, labelKey: g.labelKey, rows });
    }
  }
  return groups;
});

const activeParamCount = computed(() => {
  let n = 0;
  for (const p of PARAMS) if (params.values[p.key] !== p.default) n++;
  return n;
});
</script>

<template>
  <Card title-key="card_param_summary">
    <div class="summary-hint">
      {{ i18n.t('msg_param_summary_hint').replace('{0}', String(activeParamCount)) }}
    </div>
    <div class="summary-groups">
      <div v-for="g in summaryGroups" :key="g.groupKey" class="summary-group">
        <div class="summary-group-title">{{ i18n.t(g.labelKey) }}</div>
        <div class="summary-chips">
          <span v-for="r in g.rows" :key="r.key" class="summary-chip" :title="r.flag">
            <span class="chip-key">{{ r.label }}</span>
            <span class="chip-eq">=</span>
            <span class="chip-val">{{ r.value }}</span>
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.summary-hint {
  font-size: var(--fs-base);
  color: var(--fg-muted);
  margin-bottom: 10px;
}
.summary-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.summary-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.summary-group-title {
  font-size: var(--fs-sm);
  color: var(--fg-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}
.chip-key { color: var(--accent); font-weight: 600; }
.chip-eq { color: var(--fg-muted); }
.chip-val { color: var(--fg-primary); }
</style>
