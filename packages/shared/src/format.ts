// 跨包通用格式化工具（core 与 ui 共用的"单位 → 可读文本"收敛处；
// 原先分散在 modelscope-client.formatFileSize / DownloadCard.formatBytes /
// TrashCleanCard.formatSize / ServicePage.formatDuration 的重复实现统一于此）

/** 字节数 → 人类可读字符串（1024 进制；B 整数、KB 1 位小数、MB/GB/TB 2 位；≤0 → '0 B'）。
 *  MB 起 2 位小数是硬要求：清理卡/下载列表的「各分类大小之和」要与总数肉眼可加，
 *  1 位小数会把 ~26 KB 的零头抹成「1.0 MB」，与分类行加出的 1.03 MB 明显不符（2026-10-08）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  const digits = idx === 0 ? 0 : idx === 1 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[idx]}`;
}

/** 秒数 → 时长文本（<60s → `Ns`；<1h → `Nm Ns`；其余 → `Nh Nm`） */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}