import { existsSync } from 'node:fs';
import { argvFromPreviewOptions, buildArgv, formatCommand } from '@llama-launcher/shared';
import type { ArgvOptions, PreviewOptions } from '@llama-launcher/shared';

/**
 * 命令构建的执行侧包装。发射规则本身在 `shared/params/command.ts`（`buildArgv`），
 * 这里只加需要 node 能力的守卫——预览方（渲染层 / 浏览器 mock）没有文件系统，
 * 不能复用这个入口，否则会抛 ENOENT 或被迫另抄一份规则。
 */
export function buildCommand(opts: ArgvOptions): string[] {
  if (!opts.exePath) {
    throw new Error('Server executable path is not configured');
  }
  if (!existsSync(opts.exePath)) {
    throw new Error(`Server executable does not exist: ${opts.exePath}`);
  }
  return buildArgv(opts);
}

export function previewCommand(opts: PreviewOptions): string {
  return formatCommand(buildCommand(argvFromPreviewOptions(opts)));
}
