/**
 * 应用设置的取值边界（唯一事实源）。
 *
 * 渲染层不依赖 core（依赖流单向 ui → shared），而 core 的 zod schema、下载器的运行时
 * 钳制与设置页的下拉/输入钳制必须同源，否则会出现「设置里能选 6、下载层悄悄压回 5」
 * 这类静默失配（此前 download_max_concurrent 的 3 / 1 / 5 散落在 6 处）。
 */

/** 最大并发下载任务数：默认值与闭区间边界 */
export const DOWNLOAD_CONCURRENCY_DEFAULT = 3;
export const DOWNLOAD_CONCURRENCY_MIN = 1;
export const DOWNLOAD_CONCURRENCY_MAX = 5;

/** 可选档位（含边界，升序），设置页下拉直接消费 */
export const DOWNLOAD_CONCURRENCY_OPTIONS: number[] = Array.from(
  { length: DOWNLOAD_CONCURRENCY_MAX - DOWNLOAD_CONCURRENCY_MIN + 1 },
  (_, i) => DOWNLOAD_CONCURRENCY_MIN + i,
);

/** 取整并夹进闭区间；非正数原样返回 NaN 语义交由调用方处理（沿用既有行为：向下取整） */
export function clampDownloadConcurrency(n: number): number {
  return Math.min(DOWNLOAD_CONCURRENCY_MAX, Math.max(DOWNLOAD_CONCURRENCY_MIN, Math.floor(n)));
}
