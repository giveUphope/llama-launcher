<script setup lang="ts">
// 阶段四：配置目录清理卡（从原 LaunchPage 迁入 ServicePage 控制台旁）。
// 检测 + 二次确认 + 清理，复用 server.pushOutput 输出到控制台。
import { ref } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { formatBytes } from '@llama-launcher/shared';
import type { TrashKind } from '@llama-launcher/shared';

const server = useServerStore();
const i18n = useI18nStore();

const detecting = ref(false);
const lastResult = ref<{ cleaned: number; failed: number; totalSize: number } | null>(null);

const TRASH_KIND_LABEL_KEY: Record<TrashKind, string> = {
  stale_presets_dir: 'lbl_trash_stale_presets_dir',
  temp_file: 'lbl_trash_temp_file',
  broken_json: 'lbl_trash_broken_json',
  legacy_stats: 'lbl_trash_legacy_stats',
  download_orphan: 'lbl_trash_download_orphan',
  orphan_preset: 'lbl_trash_orphan_preset',
};

function pushError(message: string) {
  server.pushOutput({ kind: 'error', data: `[Clean] ${message}\n`, ts: Date.now() });
}

async function onCleanTrash() {
  if (detecting.value) return;
  detecting.value = true;
  try {
    // 1. 检测
    const detected = await window.api.system.detectTrash().catch((e: any) => {
      pushError(i18n.t('msg_trash_detect_failed').replace('{0}', String(e?.message ?? e)));
      return null;
    });
    if (!detected) {
      detecting.value = false;
      return;
    }
    if (detected.items.length === 0) {
      server.pushOutput({
        kind: 'info',
        data: `[Clean] ${i18n.t('msg_trash_empty')}\n`,
        ts: Date.now(),
      });
      detecting.value = false;
      return;
    }

    // 2. 按类型汇总
    const kindCount = new Map<TrashKind, { count: number; size: number }>();
    for (const item of detected.items) {
      const cur = kindCount.get(item.kind) ?? { count: 0, size: 0 };
      cur.count++;
      cur.size += item.size;
      kindCount.set(item.kind, cur);
    }
    const summary = Array.from(kindCount.entries())
      .map(([kind, { count, size }]) =>
        `${i18n.t(TRASH_KIND_LABEL_KEY[kind])}×${count} (${formatBytes(size)})`)
      .join(', ');
    const msg = i18n.t('msg_trash_confirm')
      .replace('{0}', String(detected.items.length))
      .replace('{1}', formatBytes(detected.totalSize))
      + '\n\n' + summary;

    const confirmed = await confirm({
      title: i18n.t('msg_trash_confirm_title'),
      message: msg,
      variant: 'danger',
    });
    if (!confirmed) {
      detecting.value = false;
      return;
    }

    // 3. 执行清理
    const result = await window.api.system.cleanTrash(detected.items);
    if (!result) {
      pushError('cleanTrash returned no response');
      return;
    }
    lastResult.value = result;
    if (result.failed > 0) {
      server.pushOutput({
        kind: 'warn',
        data: `[Clean] ${i18n.t('msg_trash_failed')
          .replace('{0}', String(result.cleaned))
          .replace('{1}', String(result.failed))}\n`,
        ts: Date.now(),
      });
    } else {
      server.pushOutput({
        kind: 'success',
        data: `[Clean] ${i18n.t('msg_trash_cleaned')
          .replace('{0}', String(result.cleaned))
          .replace('{1}', formatBytes(result.totalSize))}\n`,
        ts: Date.now(),
      });
    }
  } finally {
    detecting.value = false;
  }
}
</script>

<template>
  <Card title-key="msg_clean_trash">
    <div class="trash-row">
      <div class="trash-hint">
        <Icon name="info" :size="12" />
        <span>{{ i18n.t('msg_trash_hint') }}</span>
      </div>
      <button class="action-btn warn" :disabled="detecting" @click="onCleanTrash">
        <Icon name="trash" :size="12" />
        <span>{{ detecting ? i18n.t('msg_detecting') : i18n.t('msg_detect_trash') }}</span>
      </button>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.trash-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.trash-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  flex: 1;
  min-width: 0;
}
</style>
