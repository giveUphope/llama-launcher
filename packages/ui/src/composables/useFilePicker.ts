import { ref } from 'vue';
import type { FileFilter } from '@llama-launcher/shared';

export type PickerMode = 'dir' | 'file' | 'save';

export interface PickerOptions {
  title: string;
  /** 初始目录（dir/file 模式）或初始完整路径（save 模式） */
  defaultPath?: string;
  /** 文件过滤（file/save 模式） */
  filters?: FileFilter[];
}

export interface PickerRequest extends PickerOptions {
  id: number;
  mode: PickerMode;
  resolve: (value: string | null) => void;
}

// 全局单例队列：所有页面共用一个 FileBrowserModal 宿主。
const queue = ref<PickerRequest[]>([]);
let seq = 0;

function open(mode: PickerMode, options: PickerOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    queue.value.push({ id: seq++, mode, resolve, ...options });
  });
}

/** 选择目录，返回目录绝对路径或 null（取消） */
export function pickDir(options: PickerOptions): Promise<string | null> {
  return open('dir', options);
}

/** 选择文件，返回文件绝对路径或 null（取消） */
export function pickFile(options: PickerOptions): Promise<string | null> {
  return open('file', options);
}

/** 保存文件，返回完整路径或 null（取消） */
export function saveFile(options: PickerOptions): Promise<string | null> {
  return open('save', options);
}

/** 供 FileBrowserModal 宿主使用 */
export function useFilePickerQueue() {
  function resolve(id: number, value: string | null) {
    const idx = queue.value.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const [req] = queue.value.splice(idx, 1);
    req.resolve(value);
  }
  return { queue, resolve };
}
