// IPC 域：服务（启动/停止/重启/状态/预览/性能测试）。
import type { IpcMain } from 'electron';
import { launcherBridge } from '../launcher-bridge.js';
import { runBench, runBenchConcurrent } from '../bench-client.js';
import { logApp } from '../app-log.js';
import { previewCommand } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { AppSettings, PresetValues, BenchRequest, BenchRunResult } from '@llama-launcher/shared';

export function registerServerIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SERVER_START, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.start(values, settings);
      logApp('info', `Service start requested (model: ${String(values.model ?? '') || 'none'})`);
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service start failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STOP, () => {
    try {
      launcherBridge.stop();
      logApp('info', 'Service stop requested');
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service stop failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_RESTART, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.restart(values, settings);
      logApp('info', 'Service restart requested');
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service restart failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STATUS, () => launcherBridge.getStatus());
  ipcMain.handle(IPC.SERVER_PREVIEW, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      // 内置参数命令预览：不含扩展参数（扩展参数在 UI 独立文本框，复制时合并）
      return { ok: true, data: previewCommand({ values, settings, includeCustomArgs: false }) };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 性能测试：一次运行始终执行单并发（1 个请求）；多并发依据服务器实际并行槽位数（np）决定。
  // concurrency = min(np, 8)，仅当 np ≥ 2 时执行多并发；np ≤ 1 时无并行槽位可测，结果置 null。
  ipcMain.handle(IPC.SERVER_BENCH, async (_e, req: BenchRequest) => {
    try {
      const info = launcherBridge.getStatus();
      if (info.status !== 'running') {
        return { ok: false, error: 'Server is not running' };
      }
      const opts = { host: info.host, port: info.port, apiKey: req.apiKey };
      // 并发数语义（与 BenchPanel.benchConcurrency 约定一致）：1 = 无并行槽位（np≤1 或默认 -1），
      // 仅跑单并发；2–8 = min(np,8)，执行多并发聚合。钳制到 [1,8]，不得抬高下限。
      const concurrency = Math.min(8, Math.max(1, Math.floor(Number(req.concurrency)) || 1));
      const single = await runBench(opts, req);
      const concurrent = concurrency >= 2
        ? await runBenchConcurrent(opts, req, concurrency)
        : null;
      const data: BenchRunResult = { single, concurrent };
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}
