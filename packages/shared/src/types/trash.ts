/** 清理项类型（应用生成文件的全量清单，与 core/trash-cleaner 扫描规则一一对应） */
export type TrashKind =
  | 'stale_presets_dir'   // 旧预设目录（已迁移到 modelsDir/presets）
  | 'temp_file'           // 临时/备份文件（*.tmp/*.bak/*.old/*.log；含模型目录预设目录残留）
  | 'broken_json'         // 损坏的 JSON 文件（非 settings.json）
  | 'legacy_stats'        // 旧版下载统计（stats.jsonl，已停用）
  | 'download_orphan'     // 下载残留（无活动任务占用的 .part / .llama_dl.jsonl / .llama_dl.json）
  | 'orphan_preset';      // 孤儿预设（绑定的模型文件已不存在）

/** 清理项所在根目录：config = ~/.llama_launcher，models = 用户设置的模型目录 */
export type TrashRoot = 'config' | 'models';

/** 清理项描述 */
export interface TrashItem {
  /** 相对所属根目录的路径（用于展示） */
  relPath: string;
  /** 绝对路径（用于执行清理） */
  absPath: string;
  /** 所在根目录（cleanTrash 按根做路径隔离校验） */
  root: TrashRoot;
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
