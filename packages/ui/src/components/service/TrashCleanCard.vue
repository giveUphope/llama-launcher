<script setup lang="ts">
// 阶段四：配置目录清理卡（从原 LaunchPage 迁入 ServicePage 控制台旁）。
// 2026-10-08 两步流（用户批注「按建议全做」）：检测 → 卡内逐类勾选 → 清理所选；
// 结果就地显示（此前 lastResult 是死代码、一切反馈走 pushOutput 进日志页——档 B 后
// 日志页是框架输出页，反馈跨页不可见；现按「一类信息一个出口」全部收进卡片，
// pushOutput 日志出口移除）。
import { computed, ref } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { formatBytes } from '@llama-launcher/shared';
import type { CleanResult, DetectResult, TrashKind } from '@llama-launcher/shared';

const i18n = useI18nStore();

const detecting = ref(false);
const cleaning = ref(false);
const detected = ref<DetectResult | null>(null);
const result = ref<CleanResult | null>(null);
const detectError = ref('');
const selectedKinds = ref<TrashKind[]>([]);

const TRASH_KIND_LABEL_KEY: Record<TrashKind, string> = {
  stale_presets_dir: 'lbl_trash_stale_presets_dir',
  temp_file: 'lbl_trash_temp_file',
  broken_json: 'lbl_trash_broken_json',
  legacy_stats: 'lbl_trash_legacy_stats',
  download_orphan: 'lbl_trash_download_orphan',
  orphan_preset: 'lbl_trash_orphan_preset',
};

const FAIL_REASON_KEY: Record<string, string> = {
  revalidated: 'msg_trash_fail_revalidated',
  symlink: 'msg_trash_fail_symlink',
  unsupported: 'msg_trash_fail_unsupported',
  error: 'msg_trash_fail_error',
};

/** 检测项按类型分组（勾选与确认摘要的行数据，入列时算好，渲染期零遍历） */
const kindRows = computed(() => {
  const map = new Map<TrashKind, { count: number; size: number }>();
  for (const item of detected.value?.items ?? []) {
    const cur = map.get(item.kind) ?? { count: 0, size: 0 };
    cur.count++;
    cur.size += item.size;
    map.set(item.kind, cur);
  }
  return Array.from(map.entries()).map(([kind, agg]) => ({ kind, ...agg }));
});

const selectedItems = computed(() =>
  (detected.value?.items ?? []).filter((i) => selectedKinds.value.includes(i.kind)),
);

async function onDetect() {
  if (detecting.value) return;
  detecting.value = true;
  detected.value = null;
  result.value = null;
  detectError.value = '';
  try {
    const res = await window.api.system.detectTrash();
    detected.value = res;
    // 默认全选：清理是该按钮的主体语义，逐类取消是例外操作
    selectedKinds.value = [...new Set((res.items ?? []).map((i) => i.kind))];
  } catch (e: any) {
    detectError.value = i18n.t('msg_trash_detect_failed', [String(e?.message ?? e)]);
  } finally {
    detecting.value = false;
  }
}

async function onCleanSelected() {
  if (cleaning.value) return;
  const items = selectedItems.value;
  if (items.length === 0) return;
  // 确认摘要按所选类型实时生成（全选时与原一锤子流等价）
  const kindCount = new Map<TrashKind, { count: number; size: number }>();
  for (const item of items) {
    const cur = kindCount.get(item.kind) ?? { count: 0, size: 0 };
    cur.count++;
    cur.size += item.size;
    kindCount.set(item.kind, cur);
  }
  const summary = Array.from(kindCount.entries())
    .map(([kind, { count, size }]) =>
      `${i18n.t(TRASH_KIND_LABEL_KEY[kind])}×${count} (${formatBytes(size)})`)
    .join(', ');
  const msg = i18n.t('msg_trash_confirm', [String(items.length), formatBytes(items.reduce((s, i) => s + i.size, 0))])
    + '\n\n' + summary;

  const confirmed = await confirm({
    title: i18n.t('msg_trash_confirm_title'),
    message: msg,
    variant: 'danger',
  });
  if (!confirmed) return;

  cleaning.value = true;
  try {
    result.value = await window.api.system.cleanTrash(items);
    // 清理完成后结果与剩余可清项同屏：清掉的类型从待清列表消失（重新检测可再扫）
    detected.value = {
      items: (detected.value?.items ?? []).filter((i) => !selectedKinds.value.includes(i.kind)),
      totalSize: 0,
    };
    selectedKinds.value = [];
  } catch (e: any) {
    detectError.value = i18n.t('msg_trash_detect_failed', [String(e?.message ?? e)]);
  } finally {
    cleaning.value = false;
  }
}
</script>

<template>
  <Card title-key="msg_clean_trash">
    <!-- 操作按钮上移至卡片头（与标题同行，§7.5.4 卡片头操作区）；说明文字留在体内。
         loading 用 a-button 官方 prop（官方转圈，替代此前的纯文字「检测中…」） -->
    <template #actions>
      <a-button class="trash-detect-btn" type="outline" status="warning" size="small" :loading="detecting" @click="onDetect">
        <template #icon><Icon name="trash" :size="12" /></template>
        {{ i18n.t('msg_detect_trash') }}
      </a-button>
    </template>
    <div class="trash-hint">
      <Icon name="info" :size="12" />
      <span>{{ i18n.t('msg_trash_hint') }}</span>
    </div>

    <!-- 两步流面板：检测结果逐类勾选（本卡是服务页末卡，条件渲染不涉及下方内容跳动）。
         状态行全部走 a-tag 官方预设色（2026-10-08 与引擎提示 / 状态卡同族对齐） -->
    <div v-if="detected" class="trash-panel">
      <a-tag v-if="(detected.items ?? []).length === 0 && !result" color="gray" size="small">
        <template #icon><Icon name="check_circle" :size="12" /></template>
        {{ i18n.t('msg_trash_empty') }}
      </a-tag>
      <template v-else>
        <a-checkbox-group v-if="kindRows.length" v-model="selectedKinds" class="trash-kinds" direction="vertical">
          <a-checkbox v-for="row in kindRows" :key="row.kind" :value="row.kind">
            <span class="trash-kind-label">{{ i18n.t(TRASH_KIND_LABEL_KEY[row.kind]) }}</span>
            <span class="trash-kind-agg">×{{ row.count }}（{{ formatBytes(row.size) }}）</span>
          </a-checkbox>
        </a-checkbox-group>
        <a-button
          class="trash-clean-btn"
          status="danger"
          size="small"
          :loading="cleaning"
          :disabled="selectedKinds.length === 0"
          @click="onCleanSelected"
        >
          <template #icon><Icon name="trash" :size="12" /></template>
          {{ i18n.t('msg_trash_clean_selected') }}
        </a-button>
      </template>

      <a-tag v-if="result" :color="result.failed > 0 ? 'orange' : 'green'" size="small" nowrap>
        <template #icon><Icon :name="result.failed > 0 ? 'alert' : 'check_circle'" :size="12" /></template>
        <span v-if="result.failed > 0">{{ i18n.t('msg_trash_failed', [String(result.cleaned), String(result.failed)]) }}</span>
        <span v-else>{{ i18n.t('msg_trash_cleaned', [String(result.cleaned), formatBytes(result.totalSize)]) }}</span>
      </a-tag>
      <div v-if="result && result.failures.length" class="trash-failures">
        <div v-for="f in result.failures" :key="f.path" class="trash-fail-row">
          <span class="trash-fail-path" :title="f.path">{{ f.path }}</span>
          <span class="trash-fail-reason">{{ i18n.t(FAIL_REASON_KEY[f.reason]) }}<template v-if="f.detail">：{{ f.detail }}</template></span>
        </div>
      </div>
      <a-tag v-if="detectError" color="orange" size="small" nowrap>
        <template #icon><Icon name="alert" :size="12" /></template>
        {{ detectError }}
      </a-tag>
    </div>
  </Card>
</template>

<style scoped lang="scss">
// 两态文案宽窄不同（zh「检测配置目录」/「检测中…」，en「Scan Config Dir」/「Detecting…」）：
// 按较宽态定 min-width，按钮不再随检测状态换文案而撑宽，卡片头操作区不横向抖动
.trash-detect-btn {
  min-width: 142px;
}

.trash-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-hint);
  font-size: var(--fs-sm);
  min-width: 0;
}

/* 两步流面板：勾选列表 + 清理所选 + 结果行，纵向节奏走 4px 最小间距档 */
.trash-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}

.trash-kinds {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trash-kind-label {
  font-size: var(--fs-sm);
}

.trash-kind-agg {
  font-size: var(--fs-sm);
  color: var(--fg-hint);
  font-family: var(--font-mono);
}

.trash-clean-btn {
  min-width: 142px;
}

/* 状态行（空态 / 结果 / 检测失败）：a-tag 官方预设色（gray/green/orange），自绘配色删除 */

/* 失败明细：路径（mono 等宽，超长省略，完整路径 title）+ 原因短语 */
.trash-failures {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.trash-fail-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--fs-xs);
  min-width: 0;
}

.trash-fail-path {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--color-text-2);
}

.trash-fail-reason {
  flex: 0 0 auto;
  color: var(--fg-warning-text);
}
</style>
