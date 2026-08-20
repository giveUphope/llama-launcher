/** 清理项类型 */
export type TrashKind =
  | 'stale_presets_dir'   // 旧预设目录（已迁移到 modelsDir/presets）
  | 'temp_file'           // 临时文件（*.tmp/*.bak/*.old/*.log）
  | 'broken_json';        // 损坏的 JSON 文件（非 settings.json）

/** 清理项描述 */
export interface TrashItem {
  /** 相对于 CONFIG_DIR 的路径（用于展示） */
  relPath: string;
  /** 绝对路径（用于执行清理） */
  absPath: string;
  kind: TrashKind;
  /** 大小（字节），目录为递归总和 */
  size: number;
}

/** 检测结果 */
export interface DetectResult {
  items: TrashItem[];
  totalSize: number;
}

/** 清理结果 */
export interface CleanResult {
  cleaned: number;
  failed: number;
  totalSize: number;
}
