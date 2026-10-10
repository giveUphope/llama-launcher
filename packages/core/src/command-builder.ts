import { existsSync } from 'node:fs';
import { argvFromPreviewOptions, buildArgv, makeCommandError } from '@llama-launcher/shared';
import type { ArgvOptions, PreviewOptions } from '@llama-launcher/shared';

/**
 * 命令构建的执行侧包装。发射规则本身在 `shared/params/command.ts`（`buildArgv`），
 * 这里只加需要 node 能力的守卫——预览方（渲染层 / 浏览器 mock）没有文件系统，
 * 不能复用这个入口，否则会抛 ENOENT 或被迫另抄一份规则。
 *
 * 两个守卫抛的是**带码**异常（`makeCommandError`）：错误文本给人看日志，`code` 才是给界面的
 * （主进程把它填进 IPC 响应，渲染层按码出 i18n 文案——首次使用时这里必然命中，
 * 把英文文本直出界面等于让用户读堆栈）。
 */
export function buildCommand(opts: ArgvOptions): string[] {
  if (!opts.exePath) {
    throw makeCommandError('exe_not_configured', 'Server executable path is not configured');
  }
  if (!existsSync(opts.exePath)) {
    throw makeCommandError('exe_missing', `Server executable does not exist: ${opts.exePath}`);
  }
  return buildArgv(opts);
}

/**
 * 预览命令：返回 **argv 数组**（发射唯一实现的产物）——单行/一行一参数两种展示形态
 * 都由渲染层从同一 argv 格式化（shared 的 formatCommand / formatCommandLines），
 * 这里不再固定任何一种字符串形态。
 */
export function previewCommand(opts: PreviewOptions): string[] {
  return buildCommand(argvFromPreviewOptions(opts));
}
