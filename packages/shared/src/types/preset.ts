export interface PresetValues {
  [key: string]: string | number | boolean;
}

export interface Preset {
  /** 预设 schema 版本（当前 3。v2 = model 从 values 分离为顶层；v3 = 新增稳定 id 主键，读取旧版本自动迁移回填，见 presets-store） */
  preset_version: number;
  /**
   * 稳定主键（UUID）。id 与「用户看到的名字」解耦：改名 = 换文件名 + 更新 name 字段，
   * id 恒定——列表行 key、当前预设引用（settings.last_preset_id）一律以 id 为准，
   * 改名/换存储位置不再使引用失效。v2 及以前的文件无此字段，读取时回填。
   */
  id: string;
  /** 展示名（同名覆盖即更新此字段）；落盘文件名由 name 清洗非法字符而来，仅是存储细节 */
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

/**
 * 预设列表视图模型（presets:list 载荷）：只含列表展示所需的元数据，不含 values。
 * 展示层对「一条预设」的认知到此为止——values 与文件布局属于存储层内部，
 * 改展示（分组/搜索/排序）不需要碰存储，改存储（文件→其他介质）不需要碰展示。
 */
export interface PresetSummary {
  id: string;
  name: string;
  created_at: string;
  saved_at: string;
  model: string | null;
}

/**
 * presets:save 载荷（upsert 语义）：
 * - id 缺省 = 按名新建；同名预设已存在则覆盖它（继承其 id 与 created_at，即「保存同名即覆盖」）；
 * - id 传入 = 更新指定预设（values 整体替换，可同时改名，id 恒定）。
 * name 与其他预设冲突且非覆盖目标时报错（preset-name-exists / preset-not-found）。
 */
export interface PresetSaveInput {
  name: string;
  values: PresetValues;
  id?: string;
}
