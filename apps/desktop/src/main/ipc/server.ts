// IPC 域：服务（启动/停止/重启/状态/预览/性能测试）。
import type { IpcMain } from 'electron';
import { launcherBridge } from '../launcher-bridge.js';
import { runBench, runBenchConcurrent } from '../bench-client.js';
import { previewCommand } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { AppSettings, PresetValues, BenchRequest, BenchRunResult } from '@llama-launcher/shared';

export function registerServerIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SERVER_START, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.start(values, settings);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STOP, () => {
    try {
      launcherBridge.stop();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_RESTART, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.restart(values, settings);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STATUS, () => launcherBridge.getStatus());
  ipcMain.handle(IPC.SERVER_PREVIEW, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      return { ok: true, data: previewCommand({ values, settings }) };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 性能测试：一次运行执行两个场景——单并发（1 个请求）与多并发（concurrency 个并行请求）。
  // 并发数：请求指定值（缺省 4），钳制在 [2, 8]（避免并发数远超槽位数的无效压测）。
  ipcMain.handle(IPC.SERVER_BENCH, async (_e, req: BenchRequest) => {
    try {
      const info = launcherBridge.getStatus();
      if (info.status !== 'running') {
        return { ok: false, error: 'Server is not running' };
      }
      const concurrency = Math.min(8, Math.max(2, Math.floor(Number(req.concurrency ?? 4)) || 4));
      const opts = { host: info.host, port: info.port, apiKey: req.apiKey };
      const single = await runBench(opts, req);
      const concurrent = await runBenchConcurrent(opts, req, concurrency);
      const data: BenchRunResult = { single, concurrent };
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}
