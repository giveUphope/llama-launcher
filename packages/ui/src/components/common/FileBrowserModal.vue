<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useFilePickerQueue, type PickerRequest } from '@/composables/useFilePicker';
import { useDialogFocus } from '@/composables/useDialogFocus';
import type { FsDirResult } from '@/env';

const i18n = useI18nStore();
const { queue, resolve } = useFilePickerQueue();

const current = computed<PickerRequest | null>(() => queue.value[0] ?? null);
const visible = computed(() => !!current.value);
const { titleId } = useDialogFocus({ visible, containerClass: 'fc-file-browser' });

const dir = ref<string>('');
const entries = ref<FsDirResult['entries']>([]);
const parent = ref<string | null>(null);
const loading = ref(false);
const error = ref(false);
const dirExists = ref(true); // 当前路径是否存在
const createFailed = ref(false); // 创建目录是否失败
const selected = ref<string | null>(null); // file 模式选中的文件名
const filename = ref<string>(''); // save 模式输入的文件名
const pathInput = ref<string>(''); // 可编辑路径栏

const isWin = /Win/i.test(navigator.platform);
const sep = isWin ? '\\' : '/';

/**
 * 列表区可视高度（px）：既当外层盒子的高度（弹窗尺寸不随条目多少跳动），又当 `a-list`
 * 开始滚动的阈值。两处必须是同一个数——分开写过就会出现「盒子 300 高、滚动阈值 260」
 * 这类底部留白，所以只留这一个常量，外层用 style 绑定取它。
 */
const LIST_VIEWPORT_HEIGHT = 300;
const listWrapStyle = { height: `${LIST_VIEWPORT_HEIGHT}px` };

function joinPath(base: string, name: string): string {
  if (!base) return name;
  return base.endsWith(sep) ? base + name : base + sep + name;
}

function resolveStart(req: PickerRequest): string {
  const dp = req.defaultPath?.trim();
  if (dp) {
    // file/save 模式：defaultPath 可能是完整文件路径，取其目录作为起始目录
    if (req.mode === 'save' || req.mode === 'file') {
      const idx = Math.max(dp.lastIndexOf('/'), dp.lastIndexOf('\\'));
      return idx > 0 ? dp.slice(0, idx) : dp;
    }
    return dp;
  }
  return isWin ? 'C:\\' : '/';
}

async function loadDir(path: string) {
  loading.value = true;
  error.value = false;
  createFailed.value = false;
  selected.value = null;
  try {
    const res = await window.api.system.listDir(path);
    if (res && res.path) {
      dir.value = res.path;
      parent.value = res.parent;
      entries.value = res.entries;
      pathInput.value = res.path;
      // exists 字段可能缺失(旧版后端兼容),默认 true
      dirExists.value = res.exists !== false;
    } else {
      error.value = true;
      dirExists.value = false;
    }
  } catch {
    error.value = true;
    dirExists.value = false;
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function filterMatch(name: string): boolean {
  const req = current.value;
  if (!req || req.mode === 'dir') return true;
  const filters = req.filters;
  if (!filters || filters.length === 0) return true;
  const lower = name.toLowerCase();
  return filters.some((f) => f.extensions.some((ext) => lower.endsWith('.' + ext.replace(/^\./, '').toLowerCase())));
}

const visibleEntries = computed(() => entries.value.filter((e) => e.isDir || filterMatch(e.name)));

watch(current, (req) => {
  if (req) {
    const start = resolveStart(req);
    dir.value = start;
    filename.value = req.mode === 'save' && req.defaultPath ? req.defaultPath.split(/[\\/]/).pop() ?? '' : '';
    void loadDir(start);
  }
}, { immediate: true });

function onUp() {
  if (parent.value) void loadDir(parent.value);
}

function onPathSubmit() {
  const p = pathInput.value.trim();
  if (p) void loadDir(p);
}

// 创建当前不存在的目录(dir 模式下,路径不存在时提供容错创建)
async function onCreateDir() {
  const p = dir.value.trim();
  if (!p) return;
  const ok = await window.api.system.mkdir(p);
  if (ok) {
    await loadDir(p);
  } else {
    createFailed.value = true;
  }
}

function onEntryClick(entry: FsDirResult['entries'][number]) {
  if (entry.isDir) {
    void loadDir(joinPath(dir.value, entry.name));
  } else if (current.value?.mode === 'file') {
    selected.value = entry.name;
  }
}

function onEntryDblClick(entry: FsDirResult['entries'][number]) {
  if (entry.isDir) void loadDir(joinPath(dir.value, entry.name));
}

function confirm() {
  const req = current.value;
  if (!req) return;
  let result: string | null = null;
  if (req.mode === 'dir') {
    result = dir.value;
  } else if (req.mode === 'file') {
    result = selected.value ? joinPath(dir.value, selected.value) : null;
  } else {
    const name = filename.value.trim();
    result = name ? joinPath(dir.value, name) : null;
  }
  if (result) resolve(req.id, result);
}

function cancel() {
  const req = current.value;
  if (req) resolve(req.id, null);
}
</script>

<template>
  <a-modal
    class="fc-file-browser"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-labelledby="titleId"
    :visible="visible"
    :modal-style="{ width: '560px' }"
    @cancel="cancel"
  >
    <template #title><span :id="titleId">{{ current?.title }}</span></template>

    <div class="fb-toolbar">
      <ToolTip :text="i18n.t('picker_up')">
        <a-button size="small" :disabled="!parent" :aria-label="i18n.t('picker_up')" @click="onUp">
          <template #icon><Icon name="chevron_up" :size="13" /></template>
        </a-button>
      </ToolTip>
      <a-input
        class="fb-path-input"
        v-model="pathInput"
        :placeholder="dir"
        @press-enter="onPathSubmit"
      />
    </div>

    <div class="fb-list-wrap" :style="listWrapStyle">
      <!-- 加载态与空态都交回 a-list 的官方入口（:loading 内部就是 a-spin，#empty 是它的空态槽）：
           原先外面自包一层 a-spin + 四个 v-if/v-else-if 分支，等于把库已有的两个 prop 重做一遍。
           滚动同样走官方入口 `max-height`——库把 maxHeight + overflow-y:auto 加在**内层 .arco-list**
           （List.js 的 contentStyle），而 `.fb-list` 这个类落在外层 `.arco-list-wrapper` 上，
           库对该 wrapper 写死 `overflow: hidden`（list/index.css:32）。此前在这里写
           `height:100%; overflow:auto` 等于给一个被裁的容器加滚动条：条目超过 300px 直接看不见，
           也没有可拖的滚动条（Electron 真机报「所有目录选择器滚不动」，mock 因 listDir 恒回空列表而从未暴露）。 -->
      <a-list size="small" :bordered="false" :loading="loading" :max-height="LIST_VIEWPORT_HEIGHT">
        <a-list-item
          v-for="entry in (loading ? [] : visibleEntries)"
          :key="entry.name"
          class="fb-row"
          :class="{ 'is-selected': current?.mode === 'file' && selected === entry.name }"
          @click="onEntryClick(entry)"
          @dblclick="onEntryDblClick(entry)"
        >
          <span class="fb-e">
            <Icon :name="entry.isDir ? 'folder' : 'file'" :size="15" />
            <span class="fb-e-name">{{ entry.name }}</span>
          </span>
        </a-list-item>
        <template #empty>
          <!-- 空态：a-empty 官方组件（同族统一，见 STYLE_TODO 当轮登记）；错误态文字保留语义着色 -->
          <div v-if="loading" class="fb-empty" />
          <a-empty v-else-if="!dirExists" class="fb-empty">
            <template #description>
              <span :class="{ 'fb-error': true }">
                {{ createFailed ? i18n.t('picker_create_failed') : i18n.t('picker_not_exist') }}
              </span>
            </template>
            <a-button v-if="current?.mode === 'dir' && !createFailed" size="small" type="primary" @click="onCreateDir">
              {{ i18n.t('picker_create_dir') }}
            </a-button>
          </a-empty>
          <a-empty v-else-if="error" class="fb-empty">
            <template #description><span class="fb-error">{{ i18n.t('picker_unreadable') }}</span></template>
          </a-empty>
          <a-empty v-else class="fb-empty" :description="i18n.t('picker_no_selection')" />
        </template>
      </a-list>
    </div>

    <div v-if="current?.mode === 'save'" class="fb-save-row">
      <span class="fb-save-label">{{ i18n.t('picker_filename') }}</span>
      <a-input v-model="filename" @press-enter="confirm" />
    </div>

    <template #footer>
      <span v-if="current?.mode === 'file' && !selected" class="fb-hint">{{ i18n.t('picker_no_selection') }}</span>
      <a-button @click="cancel">{{ i18n.t('dlg_cancel') }}</a-button>
      <a-button type="primary" @click="confirm">
        {{ current?.mode === 'save' ? i18n.t('picker_save') : current?.mode === 'dir' ? i18n.t('picker_select') : i18n.t('picker_open') }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.fb-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.fb-path-input {
  flex: 1;
  min-width: 0;
}

// .fb-list-wrap 的高度由模板绑定 LIST_VIEWPORT_HEIGHT（同一处数字源），此处不再重复写 300px
.fb-row {
  cursor: pointer;
  /* .fb-row 即 a-list-item 本身（.arco-list-item 是它的根元素），原 `&.is-selected :deep(.arco-list-item)`
     要求「行内的后代列表项」，永远匹配不到——选中态与悬停反馈实际从未生效（真机渲染核对发现，
     与 DownloadCard 行内距失效同一根因）。`&.is-selected:hover` 用于压过后面的 :hover 规则，
     保证悬停中选中行不掉色（同 STYLE_TODO #56 口径）。 */
  &.is-selected,
  &.is-selected:hover {
    background: var(--row-selected-bg);
  }
}

.fb-e {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-2);
  font-size: var(--fs-base);
}
.fb-row:hover { background: var(--color-fill-3); }
.fb-e-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--fg-hint);
  font-size: var(--fs-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.fb-error { color: var(--fg-danger-text); }

.fb-save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.fb-save-label {
  font-size: var(--fs-base);
  color: var(--color-text-2);
  white-space: nowrap;
}

.fb-hint {
  margin-right: auto;
  font-size: var(--fs-sm);
  color: var(--fg-hint);
}
</style>