/** 参数值表：通用「参数键 → 值」映射（命令构建、快照、持久化共用；名称沿用历史） */
export interface PresetValues {
  [key: string]: string | number | boolean;
}

/**
 * 每模型参数集（2026-10-08 起，取代手存预设）：
 * 参数跟着模型走——某模型的参数一经调整即自动持久化到该模型名下，
 * 切换/重启即自动载回，用户无需任何手动保存操作（LM Studio per-model defaults 同型）。
 *
 * `PresetValues` 保留原名：它早就是「参数值表」的通用类型（命令构建、会话快照共用），
 * 不因预设机制退场而改名。
 */
export interface ModelParams {
  /** 文件格式版本（当前 1） */
  format_version: number;
  /** 该参数集所属的模型文件绝对路径（写入时的原路径；存储键由路径派生，此字段用于展示与搬家后重识别） */
  model_path: string;
  /** ISO 最近一次写入时间 */
  updated_at: string;
  /** 纯参数值：不含 model（模型即键）与 legacy `_enabled` 残留，按 PARAMS 定义顺序稳定序列化 */
  values: PresetValues;
}
