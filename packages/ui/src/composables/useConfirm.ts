import { ref } from 'vue';

export type ConfirmVariant = 'info' | 'warning' | 'danger';

/** 多动作按钮：点击后以该动作 key 作为 resolve 结果（区别于布尔确认） */
export interface ConfirmAction {
  key: string;
  labelKey: string;
  variant?: 'primary' | 'danger' | 'warning' | 'ghost';
}

export interface ConfirmOptions {
  title: string;
  message: string;
  /** 确认按钮文案 key，默认 dlg_confirm */
  confirmKey?: string;
  /** 取消按钮文案 key，默认 dlg_cancel */
  cancelKey?: string;
  /** 是否显示取消按钮（false 时仅一个确认按钮） */
  showCancel?: boolean;
  /** 弹窗语义：影响确认按钮配色与图标 */
  variant?: ConfirmVariant;
  /** 多动作模式：提供时渲染这些按钮（替代 确认/取消 两按钮），resolve(动作 key) */
  actions?: ConfirmAction[];
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (value: boolean | string) => void;
}

// 全局单例队列：所有页面的确认弹窗共用一个 ModalHost。
// 用 module 级 ref 保证任意组件 import 后拿到同一份状态。
const queue = ref<ConfirmRequest[]>([]);
let seq = 0;

/**
 * 弹出自定义居中确认弹窗，返回 Promise<boolean>；提供 actions 时返回所选动作 key（取消/遮罩点击为 ''）。
 * 替代原生 Electron showMessageBox，统一应用内 UI 风格（浅色/深色主题自适应）。
 */
export function confirm(options: ConfirmOptions): Promise<boolean | string> {
  return new Promise<boolean | string>((resolve) => {
    queue.value.push({
      id: seq++,
      resolve,
      showCancel: true,
      variant: 'info',
      confirmKey: 'dlg_confirm',
      cancelKey: 'dlg_cancel',
      ...options,
    });
  });
}

/** 供 ModalHost 使用：读取当前队列与响应操作 */
export function useConfirmQueue() {
  function resolve(id: number, value: boolean | string) {
    const idx = queue.value.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const [req] = queue.value.splice(idx, 1);
    req.resolve(value);
  }
  return { queue, resolve };
}
