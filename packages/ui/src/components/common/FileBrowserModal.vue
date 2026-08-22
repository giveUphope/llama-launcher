<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useI18nStore } from '@/stores/i18n';
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

async function onPathSubmit() {
  const p = pathInput.value.trim();
  if (p) await loadDir(p);
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
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="current" class="fb-backdrop" @click.self="cancel">
        <div class="fb-panel" role="dialog" aria-modal="true">
          <div class="fb-head">
            <span class="fb-title">{{ current.title }}</span>
            <button class="fb-icon-btn" :title="i18n.t('picker_up')" @click="onUp" :disabled="!parent">↑</button>
          </div>

          <div class="fb-pathbar">
            <input
              class="fb-path-input"
              v-model="pathInput"
              @keyup.enter="onPathSubmit"
              :placeholder="dir"
            />
          </div>

          <div class="fb-list">
            <div v-if="loading" class="fb-empty">{{ i18n.t('picker_loading') }}</div>
            <div v-else-if="!dirExists" class="fb-empty fb-error">
              <div>{{ createFailed ? i18n.t('picker_create_failed') : i18n.t('picker_not_exist') }}</div>
              <button v-if="current.mode === 'dir' && !createFailed" class="fb-btn primary fb-create-btn" @click="onCreateDir">
                {{ i18n.t('picker_create_dir') }}
              </button>
            </div>
            <div v-else-if="error" class="fb-empty fb-error">{{ i18n.t('picker_unreadable') }}</div>
            <div v-else-if="visibleEntries.length === 0" class="fb-empty">{{ i18n.t('picker_no_selection') }}</div>
            <div
              v-for="entry in visibleEntries"
              :key="entry.name"
              class="fb-row"
              :class="{ 'is-selected': current.mode === 'file' && selected === entry.name }"
              @click="onEntryClick(entry)"
              @dblclick="onEntryDblClick(entry)"
            >
              <span class="fb-row-icon">{{ entry.isDir ? '📁' : '📄' }}</span>
              <span class="fb-row-name">{{ entry.name }}</span>
            </div>
          </div>

          <div v-if="current.mode === 'save'" class="fb-save-row">
            <label class="fb-save-label">{{ i18n.t('picker_filename') }}</label>
            <input class="fb-save-input" v-model="filename" @keyup.enter="confirm" />
          </div>

          <div class="fb-actions">
            <span class="fb-hint" v-if="current.mode === 'file' && !selected">{{ i18n.t('picker_no_selection') }}</span>
            <button class="fb-btn ghost" @click="cancel">{{ i18n.t('dlg_cancel') }}</button>
            <button class="fb-btn primary" @click="confirm">
              {{ current.mode === 'save' ? i18n.t('picker_save') : current.mode === 'dir' ? i18n.t('picker_select') : i18n.t('picker_open') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.fb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(var(--glass-blur));
}

.fb-panel {
  width: min(560px, calc(100vw - 48px));
  height: min(520px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
  color: var(--fg-primary);
  overflow: hidden;
}

.fb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.fb-title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-primary);
  flex: 1;
}

.fb-icon-btn {
  width: 30px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);
  &:hover:not(:disabled) { background: var(--bg-hover); }
  &:active:not(:disabled) { transform: scale(0.9); }
  &:disabled { opacity: 0.4; cursor: default; }
}

.fb-pathbar {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}

.fb-path-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);
  &:focus { border-color: var(--accent); outline: none; }
}

.fb-list {
  flex: 1;
  overflow: auto;
  padding: 6px 0;
}

.fb-empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--fg-muted);
  font-size: var(--fs-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.fb-error { color: var(--danger); }

.fb-create-btn {
  min-width: auto;
  height: 28px;
  padding: 0 14px;
  font-size: var(--fs-sm);
}

.fb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  &:hover { background: var(--bg-hover); }
  &.is-selected { background: var(--bg-active); color: var(--fg-primary); }
}

.fb-row-icon { width: 18px; text-align: center; }
.fb-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fb-save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
}

.fb-save-label {
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  white-space: nowrap;
}

.fb-save-input {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  &:focus { border-color: var(--accent); outline: none; }
}

.fb-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}

.fb-hint {
  margin-right: auto;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

.fb-btn {
  min-width: 84px;
  height: 32px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);

  &:active {
    transform: scale(0.96);
  }
}

.fb-btn.primary {
  background: var(--accent);
  color: #fff;
  &:hover { background: var(--accent-hover); }
  &:active { background: var(--accent-pressed); }
}
.fb-btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--fg-secondary);
  &:hover { background: var(--bg-hover); }
}

.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity var(--dur-med) var(--ease-jelly); }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .fb-panel,
.modal-fade-leave-active .fb-panel { transition: transform var(--dur-med) var(--ease-jelly); }
.modal-fade-enter-from .fb-panel,
.modal-fade-leave-to .fb-panel { transform: translateY(12px) scale(0.96); }
</style>
