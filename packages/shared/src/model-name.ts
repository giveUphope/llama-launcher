// 模型显示名 / 别名派生：取路径末段文件名并去除 .gguf 后缀（大小写不敏感）。
// 用于① alias 参数自动派生（llama-server -a/--alias，API 侧模型名不带扩展名）
// 与② 界面「当前模型」显示回退（无别名时的展示名）。
export function modelBaseName(modelPath: string): string {
  const p = String(modelPath ?? '');
  if (!p) return '';
  const base = p.split(/[\\/]/).pop() ?? p;
  return base.replace(/\.gguf$/i, '');
}
