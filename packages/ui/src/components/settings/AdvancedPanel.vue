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
      <a-input v-model="hfMirrorHost" class="path-input" size="small"
               :placeholder="i18n.t('lbl_hf_mirror_placeholder')"
               :title="i18n.t('lbl_hf_mirror_hint')" />
    </InfoStrip>
    <InfoStrip :label="i18n.t('lbl_max_concurrent')">
      <div class="select-row">
        <a-select class="fc-select" :model-value="maxConcurrent" :style="{ width: '80px' }"
                  @change="(v) => (maxConcurrent = v as number)">
          <a-option v-for="n in concurrentOptions" :key="n" :value="n">{{ n }}</a-option>
        </a-select>
        <span class="field-hint">{{ i18n.t('lbl_max_concurrent_hint') }}</span>
      </div>
    </InfoStrip>
  </Card>
</template>

<style scoped lang="scss">
// 路径输入：Arco a-input（small=28px 与原自绘同高），仅保留布局尺寸与 mono 字体覆盖
// （input 原生不继承 font，mono 需打在内层 .arco-input 上，§7.5.1 路径一律 --font-mono）
.path-input {
  flex: 1 1 240px;
  min-width: 240px; // 放得下完整 placeholder（实测文本宽约 223px + 左右 padding 24px）
  max-width: 460px; // 限制最大宽度：避免拉满整行，同时保证 placeholder 全文可见
  :deep(.arco-input) {
    font-family: var(--font-mono);
    font-size: var(--fs-md);
  }
}
.select-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.field-hint {
  font-size: var(--fs-sm);
  color: var(--color-text-3);
}
// 长标签等列：本面板标签列 140px（全局等列默认 110px 会截断 'HuggingFace 镜像源'）；
// 标签是 InfoStrip 内部元素，scoped 需 :deep() 命中
:deep(.info-label) {
  flex-basis: 140px;
}
</style>
