<script setup lang="ts">
// 阶段四：参数摘要预览卡（从原 LaunchPage 迁入 ServicePage）。
// 按 PARAM_GROUPS 分组展示已启用参数（值非默认），含启动前快速核对。
// 提示词 §9：「参数保存与应用清晰分离」— 摘要只读，不提供编辑入口。
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { PARAMS, PARAM_GROUPS, MODEL_KEY } from '@llama-launcher/shared';
import type { ParamDef } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import ToolTip from '@/components/common/ToolTip.vue';
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

// 值区浮层只在「界面真的装不下」时出现（2026-10-11 用户批注：`0.7` 这种短值也弹完整值
// 是噪声）。截断与否量得出来、猜不出来——chip 宽度随窗口与字体变，写阈值必错。
const chipRoot = ref<HTMLElement | null>(null);
const truncatedVals = ref<Set<string>>(new Set());

function measureTruncated() {
  const root = chipRoot.value;
  if (!root) return;
  const next = new Set<string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.chip-val'))) {
    const key = el.dataset.key;
    // +1 容差：亚像素取整会让未截断的边界值误判成截断
    if (key && el.scrollWidth > el.clientWidth + 1) next.add(key);
  }
  truncatedVals.value = next;
}

watch(summaryGroups, () => { void nextTick(measureTruncated); });
onMounted(() => {
  void nextTick(measureTruncated);
  window.addEventListener('resize', measureTruncated);
});
// keep-alive 铁律①：服务页常驻缓存，onUnmounted 不执行——监听按激活/停用配对收放。
// addEventListener 对同一 (type, listener) 幂等，故 mounted 与 activated 都加不会重复。
onActivated(() => {
  window.addEventListener('resize', measureTruncated);
  void nextTick(measureTruncated);
});
onDeactivated(() => window.removeEventListener('resize', measureTruncated));
onUnmounted(() => window.removeEventListener('resize', measureTruncated));
</script>

<template>
  <Card title-key="card_param_summary">
    <div class="summary-hint">
      {{ i18n.t('msg_param_summary_hint', [String(activeParamCount)]) }}
    </div>
    <div ref="chipRoot" class="summary-groups">
      <div v-for="g in summaryGroups" :key="g.groupKey" class="summary-group">
        <div class="summary-group-title">{{ i18n.t(g.labelKey) }}</div>
        <div class="summary-chips">
          <!-- 一处一事（2026-10-11 用户三条批注）：外层原先包着**整只 chip**，于是悬停
               等号弹的是 flag、悬停值区内外两层同时命中（屏幕上一角一只、两只气泡）。
               现在键名与值各包各的：悬停键名看 CLI flag、悬停被截断的值看完整值，
               等号与未截断的短值不出气泡，Arco 的箭头也对准了鼠标下的文本 -->
          <a-tag v-for="r in g.rows" :key="r.key" class="summary-chip" size="small">
            <ToolTip :text="r.flag"><span class="chip-key">{{ r.label }}</span></ToolTip>
            <span class="chip-eq">=</span>
            <!-- 值区单行省略（#81 低档：模型 chip 的值由短文本变成完整绝对路径 →
                 chip 超宽换行、摘要卡整块长高）；完整值提示只在量出截断时启用 -->
            <ToolTip :text="r.value" :disabled="!truncatedVals.has(r.key)">
              <span class="chip-val" :data-key="r.key">{{ r.value }}</span>
            </ToolTip>
          </a-tag>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.summary-hint {
  font-size: var(--fs-base);
  color: var(--fg-hint);
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
  color: var(--color-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border-2);
}
.summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  /* 芯片行为一档定高（Arco small a-tag 自然高 20px）：组内空/一条/多条时
     行高不变，值改写不再让整组长高 */
  min-height: 20px;
}
// 参数摘要 chip：Arco a-tag 承载（同 ModelMetaCard meta-chip 范式），仅补 mono 字体
// 与内容排列；key/eq/val 三段配色与原自绘一致。
// gap 必须写在 a-tag 根元素上：Arco 的插槽子节点直接挂在 .arco-tag 下、**没有**
// .arco-tag-content 包装层，:deep(.arco-tag-content) 是死规则（实测三段间距 0px）
.summary-chip {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  align-items: center;
  gap: 5px;
  // 芯片整体不越行宽（值再长也只在自己的 max-width 内省略，不换行撑高）
  max-width: 100%;
  min-width: 0;
}
// key 列定宽档：中英标签长短不一时（英文更长）按较长那态预留，key 自身省略
.chip-key {
  color: var(--fg-accent);
  font-weight: 600;
  flex: 0 0 auto;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// 装饰符号：信息由 key/val 两段承载，等号本身不携带内容，保留 text-3 不并入 --fg-hint
.chip-eq { color: var(--color-text-3); flex: 0 0 auto; }
// 值区：单行省略 + 静态 max-width（绝对路径 / --host 多址串等长值都在此收敛），
// 完整值走 ToolTip，行结构固定不再因值变长而换行
.chip-val {
  color: var(--color-text-1);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
