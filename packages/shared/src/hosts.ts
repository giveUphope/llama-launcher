/**
 * 下载源主机名与镜像回退（唯一事实源）。
 *
 * core 客户端与渲染层外链共用此处：UI 不依赖 core（依赖流单向），若各写一份，
 * 用户改了 settings.hf_mirror_host 后会出现「下载走自建镜像、在浏览器打开仍跳默认站」。
 */

/** ModelScope 站点/API 主机名 */
export const MODELSCOPE_HOST = 'www.modelscope.cn';

/** HuggingFace 镜像默认站（settings.hf_mirror_host 为空时生效） */
export const DEFAULT_HF_MIRROR_HOST = 'hf-mirror.com';

/**
 * settings.hf_mirror_host → 实际生效的 host：空值回退默认站，
 * 剥掉协议前缀与尾部斜杠（与 core 的 setHfMirrorHost 共用本函数，语义不分叉）。
 */
export function normalizeMirrorHost(raw?: string | null): string {
  const v = (raw ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return v || DEFAULT_HF_MIRROR_HOST;
}
