<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';
import { useFilePickerQueue, type PickerRequest } from '@/composables/useFilePicker';
import type { FsDirResult } from '@/env';

const i18n = useI18nStore();
const { queue, resolve } = useFilePickerQueue();

const current = computed<PickerRequest | null>(() => queue.value[0] ?? null);

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
    :visible="!!current"
    :modal-style="{ width: '560px' }"
    :mask-closable="true"
    :esc-to-close="true"
    :closable="true"
    @cancel="cancel"
  >
    <template #title>{{ current?.title }}</template>

    <div class="fb-toolbar">
      <a-button size="small" :disabled="!parent" :title="i18n.t('picker_up')" @click="onUp">
        <template #icon><Icon name="folder_open" :size="13" /></template>
      </a-button>
      <a-input
        class="fb-path-input"
        v-model="pathInput"
        :placeholder="dir"
        @press-enter="onPathSubmit"
      />
    </div>

    <div class="fb-list-wrap">
      <a-spin :loading="loading" style="display: block">
        <a-list
          v-if="!loading && dirExists && !error && visibleEntries.length"
          class="fb-list"
          size="small"
          :bordered="false"
        >
          <a-list-item
            v-for="entry in visibleEntries"
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
        </a-list>
        <div v-else-if="!loading && !dirExists" class="fb-empty">
          <span :class="{ 'fb-error': true }">
            {{ createFailed ? i18n.t('picker_create_failed') : i18n.t('picker_not_exist') }}
          </span>
          <a-button v-if="current?.mode === 'dir' && !createFailed" size="small" type="primary" @click="onCreateDir">
            {{ i18n.t('picker_create_dir') }}
          </a-button>
        </div>
        <div v-else-if="!loading && error" class="fb-empty fb-error">{{ i18n.t('picker_unreadable') }}</div>
        <div v-else-if="!loading" class="fb-empty">{{ i18n.t('picker_no_selection') }}</div>
      </a-spin>
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

.fb-list-wrap {
  height: 300px; // 限定列表区高度，内容滚动由 a-list 内置滚动条承载
}

.fb-list {
  height: 100%;
  overflow: auto;
}

.fb-row {
  cursor: pointer;
  &.is-selected :deep(.arco-list-item) {
    background: rgb(var(--primary-1));
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
.fb-row:hover :deep(.arco-list-item) { background: var(--color-fill-3); }
.fb-e-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--color-text-3);
  font-size: var(--fs-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.fb-error { color: rgb(var(--danger-6)); }

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
  color: var(--color-text-3);
}
</style>