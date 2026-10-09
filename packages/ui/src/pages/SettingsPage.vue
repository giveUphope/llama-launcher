<script setup lang="ts">
// 阶段三：设置页子标签壳 —— 常规 / 外观 / 高级 / 关于。
// 设计稿 §14.10 / 补充指南 §14.10。
// 实现方式：各 panel 为独立组件，SettingsPage 只负责 tab 切换与子标签状态同步。
// 原「llama.cpp」标签已整合进「常规」卡片（GeneralPanel 引擎目录行）。
import type { IconName } from '@/components/common/icon-map';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import GeneralPanel from '@/components/settings/GeneralPanel.vue';
import AppearancePanel from '@/components/settings/AppearancePanel.vue';
import AdvancedPanel from '@/components/settings/AdvancedPanel.vue';
import AboutPanel from '@/components/settings/AboutPanel.vue';
import { useI18nStore } from '@/stores/i18n';
import { useSettingsStore } from '@/stores/settings';

type TabKey = 'general' | 'appearance' | 'advanced' | 'about';

const TABS: Array<{ key: TabKey; icon: IconName; labelKey: string }> = [
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
    <a-tabs class="settings-tabs" :active-key="activeTab" @change="(k) => setTab(k as TabKey)">
      <a-tab-pane v-for="t in TABS" :key="t.key" :key-value="t.key">
        <template #title>
          <Icon :name="t.icon" :size="13" />
          <span>{{ i18n.t(t.labelKey) }}</span>
        </template>
      </a-tab-pane>
    </a-tabs>

    <!-- 提示条整体仅「常规」页签展示：其中即时保存提示、模型目录/引擎文件状态均对应常规控件，
         其他页签不显示无关状态（idle 未设置 / missing 路径不存在 文案分离，避免自相矛盾） -->
    <div v-if="activeTab === 'general'" class="status-summary">
      <div class="summary-item">
        <Icon name="check_circle" :size="14" />
        <span class="summary-label">{{ i18n.t('lbl_settings_hint') }}</span>
      </div>
      <div class="summary-item">
        <Icon :name="modelsState === 'ok' ? 'check_circle' : modelsState === 'idle' ? 'info' : 'alert'" :size="14" />
        <ToolTip :text="modelsDir" :disabled="!modelsDir">
          <span class="summary-label">
            <template v-if="modelsState === 'checking'">{{ i18n.t('msg_detecting') }}</template>
            <template v-else-if="modelsState === 'missing'">{{ i18n.t('lbl_model_dir_missing') }}</template>
            <template v-else-if="modelsState === 'idle'">{{ i18n.t('lbl_model_dir_unset') }}</template>
            <template v-else>{{ i18n.t('lbl_model_dir_ready') }}</template>
          </span>
        </ToolTip>
      </div>
      <div class="summary-item">
        <Icon
          :name="exeState === 'checking' ? 'loading' : exeState === 'ok' ? 'check_circle' : exeState === 'missing' ? 'alert' : 'info'"
          :size="14"
        />
        <ToolTip :text="serverExe || llamaDir" :disabled="!serverExe && !llamaDir">
          <span class="summary-label">
            <template v-if="exeState === 'checking'">{{ i18n.t('msg_detecting') }}</template>
            <template v-else-if="exeState === 'ok'">{{ i18n.t('lbl_exe_state_ready') }}</template>
            <template v-else-if="exeState === 'missing'">{{ i18n.t('lbl_exe_state_missing') }}</template>
            <template v-else>{{ i18n.t('lbl_exe_state_idle') }}</template>
          </span>
        </ToolTip>
      </div>
    </div>

    <div class="tab-content">
      <!-- GeneralPanel 包进 KeepAlive：v-if 切子标签会销毁重建它，而它的引擎二进制检测
           是「挂载即跑」（400ms 去抖 + 两趟 IPC + 目录扫描），于是每次从「外观」切回「常规」
           徽章都先掉回灰色「未检测」、约半秒后才跳回「已就绪」。缓存后检测结论随组件保留；
           组件自身的监听已按 activate/deactivate 配对且 addEventListener 幂等，缓存不会
           留下后台常驻监听。AdvancedPanel 同理纳入（T08A）：TrashCleanCard 的回切轻量重扫
           要求卡片跨页签存活，而 KeepAlive 必须放在**不被页签 v-if 销毁的本层**——放在
           AdvancedPanel 内部会连缓存容器一起被销毁（mock 实测场景 B 因此失效）。
           AppearancePanel/AboutPanel 读 store/setting，重建成本可忽略，不缓存。 -->
      <KeepAlive include="GeneralPanel,AdvancedPanel">
        <GeneralPanel v-if="activeTab === 'general'" />
        <AppearancePanel v-else-if="activeTab === 'appearance'" />
        <AdvancedPanel v-else-if="activeTab === 'advanced'" />
        <AboutPanel v-else-if="activeTab === 'about'" />
      </KeepAlive>
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
.settings-tabs {
  // 页签条与下方提示条/内容区保持 8px 间距：间距由 status-summary / .tab-content 的
  // margin-top 单点提供（tabs 自身不设 margin-bottom，避免与下方 margin 叠加成 16-24px）
  :deep(.arco-tabs-content) {
    padding-top: 0; // Arco 默认顶部内距 16px（+ summary margin-top 8 = 24px），
                    // 本项目 pane 为空、内容由下方 .tab-content 承载，收敛为 8px
  }

  // 标签列宽按「双语最长标签」定（STYLE_TODO #79），此为兜底：万一将来某语言的新标签更长，
  // 宁可省略号截断也不可溢出压到控件——Arco 的 label-col/label 默认 overflow: visible +
  // nowrap，实测英文标签会直接盖进控件左侧 24px。三面板共用本处，不各自复制一份。
  :deep(.arco-form-item-label) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.status-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  // 顶栏条与相邻区块间距统一 8px（tab 条→状态条 8、状态条→内容由 .tab-content margin-top 8 提供）
  margin: 8px 0 0;
}

.summary-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-2);
}

.summary-label {
  font-size: var(--fs-sm);
  color: var(--color-text-1);
  white-space: nowrap;
  // 不做 min-width 预留（2026-10-09 二次修正）：预留宽与均间距在流式布局里不可兼得——
  // 预留箱宽于当前文案时，死区落在项间（132 箱 vs 98px 文案 = 44px 视觉间距 vs 首项 10px）。
  // 代价：状态文案切换（检测中 → 就绪/缺失）时末项一次性横移文案宽度差（≤ ~24px），可接受
}

// （summary-divider 自绘分隔线已删：与统计条分隔线同族的被淘汰样式（STYLE_TODO 116 号），
// 项间距由容器既有 gap 承担）

.tab-content {
  display: flex;
  flex-direction: column;
  // 分区风格：面板内卡片由底边实线分隔，gap 归 0；与上方 tab 条保持 8px 间距
  gap: 0;
  margin-top: 8px;
  min-height: 0;
  // 同 ModelsPage：骨架改成 flex 列后原来的 flex: 1 才会生效，收缩一档就是裁切长表单，
  // 故只允许「撑满」不允许「压缩」（STYLE_TODO #82）。
  flex: 1 0 auto;
}

/* 摘要状态行（检测中图标走 Arco IconLoading 自带旋转动画） */
</style>
