<script setup lang="ts">
// 阶段三：设置页「高级」分组 —— HF 镜像、下载并发、危险设置单独分组（设计稿 §14.10）。
import { computed } from 'vue';
import Card from '@/components/common/Card.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';

const settings = useSettingsStore();
const i18n = useI18nStore();

const hfMirrorHost = computed<string>({
  get: () => settings.settings?.hf_mirror_host ?? '',
  set: (v) => { if (settings.settings) { settings.settings.hf_mirror_host = v; void settings.save(); } },
});
const maxConcurrent = computed<number>({
  get: () => settings.settings?.download_max_concurrent ?? 3,
  set: (v) => {
    if (!settings.settings) return;
    settings.settings.download_max_concurrent = Math.min(5, Math.max(1, Math.floor(Number(v) || 3)));
    void settings.save();
  },
});
const concurrentOptions = [1, 2, 3, 4, 5];
</script>

<template>
  <Card title-key="nav_settings_advanced">
    <!-- 长标签（'HuggingFace 镜像源'≈122px）超出等列 110px，本面板标签列加宽至 140px 保持等列且不截断 -->
    <InfoStrip :label="i18n.t('lbl_hf_mirror')">
      <input class="path-input" type="text" v-model="hfMirrorHost"
             :placeholder="i18n.t('lbl_hf_mirror_placeholder')"
             :title="i18n.t('lbl_hf_mirror_hint')" />
    </InfoStrip>
    <InfoStrip :label="i18n.t('lbl_max_concurrent')">
      <div class="select-row">
        <select class="settings-select" v-model.number="maxConcurrent">
          <option v-for="n in concurrentOptions" :key="n" :value="n">{{ n }}</option>
        </select>
        <span class="field-hint">{{ i18n.t('lbl_max_concurrent_hint') }}</span>
      </div>
    </InfoStrip>
  </Card>
</template>

<style scoped lang="scss">
.path-input {
  flex: 1 1 240px;
  min-width: 240px; // 放得下完整 placeholder（实测文本宽约 223px + 左右 padding 24px）
  max-width: 460px; // 限制最大宽度：避免拉满整行，同时保证 placeholder 全文可见
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);
  &:focus { border-color: var(--accent); outline: none; }
}
.settings-select {
  min-width: 140px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  &:focus { border-color: var(--accent); outline: none; }
}
.select-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.field-hint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}
// 长标签等列：本面板标签列 140px（全局等列默认 110px 会截断 'HuggingFace 镜像源'）；
// 标签是 InfoStrip 内部元素，scoped 需 :deep() 命中
:deep(.info-label) {
  flex-basis: 140px;
}
</style>
