<script setup lang="ts">
// 阶段三：设置页子标签壳 —— 常规 / 外观 / 高级 / 关于。
// 设计稿 §14.10 / 补充指南 §14.10。
// 实现方式：各 panel 为独立组件，SettingsPage 只负责 tab 切换与子标签状态同步。
// 原「llama.cpp」标签已整合进「常规」卡片（GeneralPanel 引擎目录行）。
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import GeneralPanel from '@/components/settings/GeneralPanel.vue';
import AppearancePanel from '@/components/settings/AppearancePanel.vue';
import AdvancedPanel from '@/components/settings/AdvancedPanel.vue';
import AboutPanel from '@/components/settings/AboutPanel.vue';
import { useI18nStore } from '@/stores/i18n';
import { APP_VERSION } from '@llama-launcher/shared';
import { useSettingsStore } from '@/stores/settings';

type TabKey = 'general' | 'appearance' | 'advanced' | 'about';

const TABS: Array<{ key: TabKey; icon: string; labelKey: string }> = [
  { key: 'general', icon: 'settings', labelKey: 'nav_settings_general' },
  { key: 'appearance', icon: 'theme', labelKey: 'nav_settings_appearance' },
  { key: 'advanced', icon: 'params', labelKey: 'nav_settings_advanced' },
  { key: 'about', icon: 'info', labelKey: 'nav_settings_about' },
];

const route = useRoute();
const router = useRouter();
const i18n = useI18nStore();
const settings = useSettingsStore();

const activeTab = computed<TabKey>(() => {
  const t = String(route.query.tab ?? 'general');
  if (t === 'appearance' || t === 'advanced' || t === 'about') return t;
  return 'general';
});

function setTab(key: TabKey) {
  if (key === activeTab.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}

// 顶部状态摘要：引擎/模型目录按「实际环境」真实检测（fileExists），并随配置变化实时刷新。
// 三态：idle（未配置）/ ok（已配置且文件存在）/ missing（已配置但文件不存在）
type ReadyState = 'idle' | 'checking' | 'ok' | 'missing';
const llamaDir = computed(() => settings.settings?.llama_dir ?? '');
const modelsDir = computed(() => settings.settings?.models_dir ?? '');
const serverExe = computed(() => settings.settings?.server_exe ?? '');
const exeState = ref<ReadyState>('idle');
const modelsState = ref<ReadyState>('idle');

async function checkExe() {
  const exe = serverExe.value.trim();
  if (!exe) { exeState.value = 'idle'; return; }
  exeState.value = 'checking';
  try {
    const exists = await window.api.system.fileExists(exe);
    exeState.value = exists ? 'ok' : 'missing';
  } catch {
    exeState.value = 'missing';
  }
}

async function checkModelsDir() {
  const dir = modelsDir.value.trim();
  if (!dir) { modelsState.value = 'idle'; return; }
  modelsState.value = 'checking';
  try {
    const exists = await window.api.system.fileExists(dir);
    modelsState.value = exists ? 'ok' : 'missing';
  } catch {
    modelsState.value = 'missing';
  }
}

// 配置变化时实时重新检测（引擎目录/模型目录被修改、保存后立即刷新指示）
watch(serverExe, () => { void checkExe(); }, { immediate: true });
watch(modelsDir, () => { void checkModelsDir(); }, { immediate: true });
</script>

<template>
  <PageFrame>
    <div class="tab-strip" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        :aria-selected="activeTab === t.key"
        role="tab"
        @click="setTab(t.key)"
      >
        <Icon :name="t.icon" :size="13" />
        <span>{{ i18n.t(t.labelKey) }}</span>
      </button>
    </div>

    <div class="status-summary">
      <div class="summary-item">
        <Icon name="save" :size="14" />
        <span class="summary-label">{{ i18n.t('lbl_settings_hint') }}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <Icon :name="modelsState === 'ok' ? 'check_circle' : 'alert'" :size="14" />
        <span class="summary-label" :title="modelsDir || undefined">
          <template v-if="modelsState === 'checking'">{{ i18n.t('msg_detecting') }}</template>
          <template v-else-if="modelsState === 'missing'">{{ i18n.t('lbl_model_dir_missing') }}（{{ i18n.t('lbl_dir_not_exist') }}）</template>
          <template v-else>{{ modelsState === 'ok' ? i18n.t('lbl_model_dir_ready') : i18n.t('lbl_model_dir_missing') }}</template>
        </span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <Icon
          :name="exeState === 'ok' ? 'check_circle' : exeState === 'missing' ? 'alert' : 'info'"
          :size="14"
          :class="{ spinning: exeState === 'checking' }"
        />
        <span class="summary-label" :title="serverExe || llamaDir || undefined">
          <template v-if="exeState === 'checking'">{{ i18n.t('msg_detecting') }}</template>
          <template v-else-if="exeState === 'ok'">{{ i18n.t('lbl_exe_state_ready') }}</template>
          <template v-else-if="exeState === 'missing'">{{ i18n.t('lbl_exe_state_missing') }}</template>
          <template v-else>{{ i18n.t('msg_no_exe_hint') }}</template>
        </span>
      </div>
      <div class="summary-right">
        <span class="version">v{{ APP_VERSION }}</span>
      </div>
    </div>

    <div class="tab-content">
      <GeneralPanel v-if="activeTab === 'general'" />
      <AppearancePanel v-else-if="activeTab === 'appearance'" />
      <AdvancedPanel v-else-if="activeTab === 'advanced'" />
      <AboutPanel v-else-if="activeTab === 'about'" />
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
.status-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  // 顶栏条与相邻区块间距统一 8px（tab 条→状态条 8、状态条→内容由 .tab-content margin-top 8 提供）
  margin: 8px 0 0;
}

.summary-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-secondary);
}

.summary-label {
  font-size: var(--fs-sm);
  color: var(--fg-primary);
}

.summary-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
}

.summary-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-content {
  display: flex;
  flex-direction: column;
  // 分区风格：面板内卡片由底边实线分隔，gap 归 0；与上方 tab 条保持 8px 间距
  gap: 0;
  margin-top: 8px;
  min-height: 0;
  flex: 1;
}

/* 摘要检测中旋转图标 */
.spinning {
  animation: settings-spin 1s linear infinite;
}
@keyframes settings-spin {
  to { transform: rotate(360deg); }
}
</style>
