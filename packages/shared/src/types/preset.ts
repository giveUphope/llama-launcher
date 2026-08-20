export interface PresetValues {
  [key: string]: string | number | boolean;
}

export interface Preset {
  /** 预设 schema 版本（当前 1；未来字段变更在此递增并补迁移，与 settings_version/migrateMeta 同模式） */
  preset_version: number;
  name: string;
  saved_at: string; // ISO datetime string
  values: PresetValues; // includes MODEL_KEY
}
