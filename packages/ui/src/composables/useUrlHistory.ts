// 模型库 URL 会话历史（模块级单例）。
// 模型页三个子标签（本地模型/模型库/下载任务）用 v-if 切换面板，
// DownloadCard 随之销毁重建；历史若存在组件实例内会在切标签后丢失
// （表现为历史记录下拉不再弹出）。模块级状态跨实例保留，仅在应用退出
// （进程结束）时自然清空，符合「保留到关闭应用」的会话级语义。
import { ref } from 'vue';

/** 历史上限（超出丢弃最旧条目） */
const HISTORY_MAX = 10;

/** 历史 URL 列表：最新在前、去重 */
const urlHistory = ref<string[]>([]);

/** 记入提交的 URL：trim 后为空则忽略；去重并把最新一条提到最前 */
function rememberUrl(url: string): void {
  const v = url.trim();
  if (!v) return;
  const next = urlHistory.value.filter((u) => u !== v);
  next.unshift(v);
  urlHistory.value = next.slice(0, HISTORY_MAX);
}

/** 清空历史（应用内无入口；供测试与后续「清除历史」类功能复用） */
function clearUrlHistory(): void {
  urlHistory.value = [];
}

export function useUrlHistory() {
  return { urlHistory, rememberUrl, clearUrlHistory };
}
