export interface PresetValues {
  [key: string]: string | number | boolean;
}

export interface Preset {
  /** 预设 schema 版本（当前 2；v1 = model 混在 values 中、无 created_at/app_version，加载时自动迁移，见 presets-store） */
  preset_version: number;
  name: string;
  /** ISO 首次创建时间（覆盖保存时保留；v1 旧文件迁移时以 saved_at 回填） */
  created_at: string;
  /** ISO 最近一次保存时间 */
  saved_at: string; // ISO datetime string
  /** 写入该预设的应用版本（旧文件迁移时为空串） */
  app_version: string;
  /** 关联的模型文件路径（null = 纯参数集，应用时保留当前模型；v1 迁移自 values[MODEL_KEY]） */
  model: string | null;
  /** 纯参数值：不含 model 与 legacy `_enabled` 残留，保存时按 PARAMS 定义顺序稳定序列化 */
  values: PresetValues;
}
