<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { PARAMS } from '@llama-launcher/shared';
import SliderParam from './SliderParam.vue';
import IntEntryParam from './IntEntryParam.vue';
import DropdownParam from './DropdownParam.vue';
import CheckboxParam from './CheckboxParam.vue';
import TextParam from './TextParam.vue';
import FileParam from './FileParam.vue';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{
  p: ParamDef;
}>();

const params = useParamsStore();
const i18n = useI18nStore();

const value = computed(() => params.values[props.p.key]);

const hasChange = computed(() => value.value !== props.p.default);

const dependencyMet = computed(() => {
  if (!props.p.dependsOn) return true;
  const dep = props.p.dependsOn;
  const depDef = PARAMS.find((x) => x.key === dep.key);
  if (!depDef) return false;
  const depValue = params.values[dep.key] ?? '';
  // 依赖源"生效"语义与命令构建器保持一致：
  // checkbox 依赖源按布尔语义判定（默认值为 true 的 cache_prompt 勾选即生效），
  // 其余类型以"值 ≠ 其默认值"判定。否则 cache_reuse 会被误标依赖不满足并禁用，
  // 与命令实际发射相反（详见 stores/params.ts isDependencySatisfied 注释）。
  if (depDef.type === 'checkbox') {
    const b = depValue === true || depValue === 'true' || depValue === 1 || depValue === '1';
    if (!b) return false;
  } else {
    if (depValue === depDef.default) return false;
  }
  if (dep.notValues && dep.notValues.includes(String(depValue))) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(String(depValue))) return false;
  return true;
});

const showDepWarning = computed(() => {
  if (!props.p.dependsOn) return false;
  if (dependencyMet.value) return false;
  return value.value !== props.p.default;
});

const dependencyHint = computed(() => {
  if (!showDepWarning.value) return '';
  const dep = props.p.dependsOn!;
  const depLabel = i18n.paramLabel(dep.key);
  const fmt = (v: string) => (v === '' ? i18n.t('lbl_dep_empty') : v);
  if (dep.notValues && dep.notValues.length > 0) {
    return i18n.t('msg_dependency_not_values').replace('{0}', depLabel).replace('{1}', dep.notValues.map(fmt).join(' / '));
  }
  if (dep.values && dep.values.length > 0) {
    return i18n.t('msg_dependency_values').replace('{0}', depLabel).replace('{1}', dep.values.map(fmt).join(' / '));
  }
  return i18n.t('msg_dependency_enable').replace('{0}', depLabel);
});

const ggufHint = computed<string | null>(() => {
  if (!params.ggufInfo) return null;
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) return formatGgufHint(sug.value);
  if (!props.p.ggufField) return null;
  const info = params.ggufInfo;
  const field = props.p.ggufField as keyof typeof info;
  const val = info[field];
  if (val === null || val === undefined || val === '') return null;
  if ((props.p.key === 'chat_template' || props.p.key === 'jinja') && typeof val === 'string') {
    return i18n.t('gguf_chat_template_custom');
  }
  return formatGgufHint(val);
});

const hasGgufSuggestion = computed(() => params.ggufSuggestions.some((s) => s.key === props.p.key));

function formatGgufHint(v: unknown): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

/* 提示槽定宽 72px，a-tag 内距 8px → 文本可用 56px；mono 12px 实测 7.3px/字，即 8 字。
   长值（如别名建议 = 模型文件名 30 字）按尾部省略只会剩 "Qwen3-32B"（看不出是什么），
   故做「头 5 + … + 尾 2」中间省略——尾部（量化后缀 / 单位）才是区分信息；完整值走 tooltip。 */
const HINT_MAX_CHARS = 8;
const ggufHintText = computed<string | null>(() => {
  const v = ggufHint.value;
  if (v === null || v.length <= HINT_MAX_CHARS) return v;
  return `${v.slice(0, 5)}…${v.slice(-2)}`;
});

const ggufHintTip = computed(() => {
  const v = ggufHint.value;
  if (v === null) return '';
  const action = hasGgufSuggestion.value ? i18n.t('msg_click_to_apply') : i18n.t('msg_gguf_model_value');
  return `${i18n.paramLabel(props.p.key)}\n${v}\n${action}`;
});

function applyGgufHint() {
  if (!hasGgufSuggestion.value) return;
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) params.set(sug.key, sug.value);
}

function onClear() {
  params.resetParam(props.p.key);
}
</script>

<template>
  <div class="param-row-wrapper" :class="{ 'dep-unmet': showDepWarning, 'changed': hasChange && !showDepWarning }">
    <div class="param-content">
      <div class="param-control">
        <SliderParam v-if="p.type === 'int_slider' || p.type === 'float_slider'" :p="p" />
        <IntEntryParam v-else-if="p.type === 'int_entry'" :p="p" />
        <DropdownParam v-else-if="p.type === 'dropdown'" :p="p" />
        <CheckboxParam v-else-if="p.type === 'checkbox'" :p="p" />
        <FileParam v-else-if="p.type === 'file' || p.type === 'dir'" :p="p" />
        <TextParam v-else :p="p" />
      </div>
      <!-- GGUF 值提示：a-tag 原生外观（中性=默认标签，可点击建议=color="arcoblue"），
           自定义底/字色/下划线覆盖已移除（与 meta-chip 等非 checkable 标签统一走原生态） -->
      <!-- GGUF 值提示常驻槽位（定宽 72px = 提示最大宽）：提示本身 v-if，但槽位恒在——
           否则 8/60 带提示行的控件宽从 400 掉到 296~352，整列右边缘不齐；且切换模型时
           提示出现/消失会让控件宽度当场跳动（同「槽位常驻防跳动」口径） -->
      <div class="gguf-hint-slot">
        <ToolTip v-if="ggufHintText !== null" :text="ggufHintTip">
          <a-tag
            size="small"
            :color="hasGgufSuggestion ? 'arcoblue' : undefined"
            class="gguf-hint"
            :class="{ applicable: hasGgufSuggestion }"
            @click="hasGgufSuggestion && applyGgufHint()"
          >{{ ggufHintText }}</a-tag>
        </ToolTip>
      </div>
      <a-tooltip v-if="showDepWarning" :content="dependencyHint">
        <span class="dep-hint">
          <Icon name="alert" :size="12" />
        </span>
      </a-tooltip>
    </div>
    <!-- 提示走 ToolTip（Arco a-tooltip）而非原生 title：原生浮层不受主题控制、约 1s 延迟，
         与建议值芯片同源；按钮基座仍是纯 Arco（.clear-btn 类无任何 CSS 覆写） -->
    <ToolTip v-if="hasChange" :text="i18n.t('msg_clear_param')">
      <a-button
        class="clear-btn"
        type="text"
        size="mini"
        shape="circle"
        status="warning"
        @click="onClear"
      >
        <Icon name="close" :size="12" />
      </a-button>
    </ToolTip>
  </div>
</template>

<style scoped lang="scss">
.param-row-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  border: 1px solid transparent;
  background: transparent;
  transition: background var(--dur-fast) var(--ease-smooth),
              border-color var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--color-fill-3);
    border-color: var(--color-border-2);
  }

  &.dep-unmet {
    border-color: rgb(var(--orange-6));
    background: color-mix(in srgb, rgb(var(--orange-6)) 6%, transparent);
  }

  // 非默认值行：--warn 调整提示橙描边（与右侧还原按钮同色系）。
  // 依赖未满足时由 dep-unmet 呈现（同色描边 + 底色 + 警示图标），不重复挂类；
  // 悬停保持橙色，不回落到通用 hover 灰描边。
  &.changed {
    border-color: rgb(var(--orange-6));

    &:hover {
      border-color: rgb(var(--orange-6));
    }
  }
}

.param-content {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;

  // 行距自持：清零子控件 a-form-item 的默认外距（迁移残留 12/20px 曾把 24px
  // 参数行撑到 54px，悬浮高亮下方出现大片空白）与 wrapper/content 最小高度（32px）
  .param-control {
    margin-bottom: 0;
  }

  :deep(.arco-form-item-wrapper-col),
  :deep(.arco-form-item-content) {
    min-height: 0;
  }

  // Arco 标签列基础 line-height 32px（无 form size 时），压回行内语义行高；
  // form-item 默认 align-items: flex-start，label-col 内容高被压缩为 label 高，
  // 顶部对齐会相对控件中心偏上 ~5px（历史：所有参数行 label 与控件垂直不齐）。
  // align-self: center 让 label-col 整体垂直居中于行高
  :deep(.arco-form-item-label-col),
  :deep(.arco-form-item-label) {
    line-height: 1.3;
  }
  /* 标签列定宽 140px + 右对齐（与 AdvancedPanel 同档）。取值依据：离屏探针量 60 行标签自然宽，
     历史上最长「合成接受长度（基准）」= 140px，而 110px（设置面板值）扣掉 8px 右距后可用 94px
     会截断 11 行——定宽是为对齐，不能以牺牲可读性为代价。该两条标签的限定语已并入 tooltip，
     现全页最长 127px ≤ 可用 132px，零截断。
     **必须 `flex: 0 0`（不收缩）**：参数行控件（滑块 + 88px 数字框 + 72px 提示槽）占满行，
     可收缩的标签列会被挤压——实测 `0 1 110px` 下标签缩成 64 / 83px 两种、控件起点重新错位。
     Arco label-col 原生 `flex: 0 0 auto` 更糟：按文字宽自适应（实测 28–93px 九种），
     控件起点从 x=318 一路漂到 380。 */
  :deep(.arco-form-item-label-col) {
    align-self: center;
    flex: 0 0 140px;
    min-width: 0;
    justify-content: flex-end;
    margin-right: 8px;
  }
  /* 长标签（英文/未命中 i18n 回落 snake）省略号截断，不换行不撑宽列 */
  :deep(.arco-form-item-label) {
    width: 100%;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :deep(.arco-form-item-label .tooltip-host) {
    display: block;
    max-width: 100%;
    overflow: hidden;
  }
}

.param-control {
  flex: 1;
  min-width: 0;
  :deep(.tooltip-host) {
    max-width: 100%;
  }
}

.gguf-hint-slot {
  flex: 0 0 72px;
  /* min-width: 0 不可省：flex 项默认 min-width:auto，长提示（如别名建议
     "Qwen3-32B-A3B-Instruct-Q4_K_M"）会把定宽 72px 的槽位撑到 222px，
     反过来把控件列挤到 146px、输入框实际只剩 0px 宽（实测） */
  min-width: 0;
  display: flex;
  justify-content: flex-start;
  overflow: hidden;
  /* 提示标签包在 ToolTip 的 host（inline-flex）里，host 同样要能收缩到槽内 */
  :deep(.tooltip-host) {
    min-width: 0;
    max-width: 100%;
  }
}

// GGUF 值提示：a-tag 原生外观，仅保留布局尺寸与 mono 字体（§7.5.1 数值 mono）
.gguf-hint {
  font-family: var(--font-mono);
  /* 横向内距收到 §7.5.4 ① 徽章档 6px（Arco small 默认 8px）：8 字 mono 12px 实测 58.7px，
     配 8px 内距要 74.7px > 72px 槽，会差 2px 把尾部字母切掉 */
  padding-inline: 6px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;

  &.applicable {
    cursor: pointer;
  }
}

.dep-hint {
  color: rgb(var(--orange-6));
  font-size: var(--fs-sm);
  flex-shrink: 0;
  display: inline-flex;
  cursor: help;
}

</style>
