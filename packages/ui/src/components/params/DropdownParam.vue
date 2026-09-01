<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import ToolTip from '@/components/common/ToolTip.vue';
import Icon from '@/components/common/Icon.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();

const model = computed<string>({
  get: () => String(params.values[props.p.key] ?? ''),
  set: (v) => params.set(props.p.key, v),
});

const options = computed(() => props.p.options ?? []);
const editable = computed(() => !!props.p.editable);

// 下拉项的展示标签（可选 labels 覆盖）
function optionLabel(opt: string, idx: number): string {
  if (props.p.labels && idx < props.p.labels.length) {
    return props.p.labels[idx];
  }
  return opt;
}

const label = computed(() => i18n.paramLabel(props.p.key));

// 悬停提示 = 标签 + 帮助描述（paramHelp 为空时仅标签），与其余参数控件一致
const tip = computed(() => {
  const h = i18n.paramHelp(props.p.key);
  return h ? `${label.value}\n${h}` : label.value;
});

// ----- 自定义下拉面板状态 -----
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

// 面板定位样式（基于触发器 getBoundingClientRect 计算）
const panelStyle = ref<Record<string, string>>({});

// 触发器显示文本：优先用 optionLabel 显示友好名，editable 模式下直接显示当前值
const displayText = computed(() => {
  const v = model.value;
  if (v === '' || v === null || v === undefined) {
    // 空值显示占位符（与下拉面板首项一致），避免触发器空白
    return '—';
  }
  // 查找匹配选项的友好标签
  const idx = options.value.indexOf(v);
  if (idx >= 0) return optionLabel(v, idx);
  // editable 模式下可能是自定义值，直接显示
  return v;
});

// 根据触发器位置计算面板定位
function updatePanelPosition() {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  panelStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    minWidth: `${rect.width}px`,
  };
}

function toggle() {
  open.value = !open.value;
  if (open.value) {
    nextTick(() => {
      updatePanelPosition();
      if (editable.value) {
        inputRef.value?.focus();
        inputRef.value?.select();
      }
    });
  }
}

function selectOption(opt: string) {
  model.value = opt;
  open.value = false;
}

// 点击外部关闭下拉（需同时检查触发器和 teleported 面板）
function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (rootRef.value?.contains(target)) return;
  if (panelRef.value?.contains(target)) return;
  open.value = false;
}

// ESC 关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    open.value = false;
  }
}

// 窗口大小变化或滚动时重新定位（或关闭）
function onReposition() {
  if (open.value) updatePanelPosition();
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', onReposition);
  // capture: true 捕获滚动事件（包括子容器滚动）
  window.addEventListener('scroll', onReposition, true);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', onReposition);
  window.removeEventListener('scroll', onReposition, true);
});

// 切换参数时关闭下拉（避免残留）
watch(() => props.p.key, () => { open.value = false; });
</script>

<template>
  <div class="param-row">
    <div class="label-col">
      <ToolTip :text="tip">
        <span class="label-text">{{ label }}</span>
      </ToolTip>
    </div>
    <div class="ctrl-col">
      <div class="dropdown" ref="rootRef" :class="{ open, editable }">
        <!-- 触发器 -->
        <div class="dropdown-trigger" ref="triggerRef" @click="toggle">
          <input
            v-if="editable"
            ref="inputRef"
            class="dropdown-input"
            type="text"
            v-model="model"
            :placeholder="options.length ? optionLabel(options[0], 0) : ''"
            @click.stop="toggle"
            @keydown.enter.prevent="open = false"
          />
          <span v-else class="dropdown-value" :title="displayText">{{ displayText }}</span>
          <Icon name="chevron_down" :size="12" class="dropdown-chevron" :class="{ rotated: open }" />
        </div>
      </div>
    </div>
    <!-- 下拉面板 Teleport 到 body：脱离父级 opacity 和层叠上下文，
         避免被淡化效果影响和点击穿透 -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="dropdown-panel"
        :style="panelStyle"
        @click.stop
      >
        <button
          v-for="(opt, idx) in options"
          :key="opt + idx"
          class="dropdown-option"
          :class="{ active: opt === model }"
          :title="optionLabel(opt, idx)"
          @click="selectOption(opt)"
        >
          <span class="option-label">{{ opt === '' ? '—' : optionLabel(opt, idx) }}</span>
          <Icon v-if="opt === model" name="check" :size="11" class="option-check" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.param-row {
  display: flex;
  align-items: center;
  min-height: 24px;
  width: 100%;
  gap: 4px;
}

// 标签列：允许收缩（避免长标签换行撑高行），溢出用省略号
.label-col {
  flex: 0 1 110px;
  min-width: 64px;
  text-align: right;
  padding-right: 8px;
}

.label-text {
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  cursor: help;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 100%;
  vertical-align: middle;
}

.ctrl-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

// ----- 自定义下拉（与 TopBar 模型下拉设计语言统一） -----
.dropdown {
  position: relative;
  width: 180px;
  flex: 0 1 180px;
  min-width: 0;
}

.dropdown-trigger {
  position: relative;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 26px 0 8px;
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  background: var(--bg-input);
  border: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    box-shadow var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }


}

.dropdown.open .dropdown-trigger {
  border-color: var(--accent);
  background: var(--bg-hover);
}

// editable 模式下输入框占满触发器
.dropdown-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);
  padding: 0;
  cursor: text;
}

.dropdown-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  color: var(--fg-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-chevron {
  position: absolute;
  right: 7px;
  pointer-events: none;
  color: var(--fg-muted);
  transition: color var(--dur-fast) var(--ease-smooth), transform var(--dur-med) var(--ease-jelly);
}

.dropdown-trigger:hover .dropdown-chevron {
  color: var(--fg-secondary);
}

.dropdown-chevron.rotated {
  transform: rotate(180deg);
}
</style>

<!-- 面板样式：Teleport 到 body 后需用非 scoped 样式才能生效 -->
<!-- 使用 :global 保证面板在 body 层级也能应用样式 -->
<style lang="scss">
.dropdown-panel {
  z-index: 9999;
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
  border-radius: var(--radius-row);
  // 实底菜单（STYLE_TODO #41 / §7.5.6）：半透明底透出下层内容 + backdrop-filter 合成层
  // 使文字发虚，功能菜单可读性优先
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-dropdown);
  animation: dropdown-panel-in var(--dur-fast) var(--ease-jelly);

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: var(--radius-pill);

    &:hover {
      background: var(--fg-muted);
    }
  }
}

@keyframes dropdown-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// 选项样式与 TopBar .dropdown-item 一致
.dropdown-panel .dropdown-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--fg-primary);
  font-size: var(--fs-base);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--bg-hover);
  }



  &.active {
    // accent 淡底 + accent 文字（原 --bg-active 暗蓝底叠蓝字深色主题对比度不足，STYLE_TODO #13/#41）
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .option-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    // 确保空内容也保持一致高度（避免空值选项高度塌陷）
    line-height: 1.4;
    min-height: 1.4em;
  }

  .option-check {
    color: var(--accent);
    flex-shrink: 0;
  }
}
</style>
