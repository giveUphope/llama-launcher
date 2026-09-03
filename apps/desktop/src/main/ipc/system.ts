// IPC 域：系统（端口/文件/引擎检测、回收站、文件系统只读列举、剪贴板、外链/打开目录）。
import { clipboard, shell, type IpcMain } from 'electron';
import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { totalmem, freemem } from 'node:os';
import { detectTrash, cleanTrash, getDownloadManager, loadSettings, listDevices, readGgufMetadata, estimateVram, estimateOccupancy, KV_DTYPE_BYTES, recommendForTarget, runLlamaBench } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { TrashItem, VramEstimateResult, LlamaBenchJobState, PerfTarget, DeviceMemInfo, ModelFitResult, OccupancyConfig } from '@llama-launcher/shared';

/** 占用端口进程信息（尽力而为：无法识别时为空） */
interface PortOwner {
  pid?: number;
  name?: string;
}

/**
 * 单一端口探测：尝试绑定指定 host:port，能绑定则空闲。
 */
function probePort(port: number, bindHost: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const tester = createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, bindHost);
  });
}

/**
 * 识别占用指定端口的进程（尽力而为）：
 * - Windows：`netstat -ano` 取 LISTENING 行 PID → `tasklist /FI` 查进程名
 * - POSIX：`lsof -nP -iTCP:<port> -sTCP:LISTEN`（缺失回退 `ss -ltnp`）提取 pid/comm
 */
function getPortOwner(port: number): PortOwner {
  try {
    if (process.platform === 'win32') {
      const ns = spawnSync('netstat', ['-ano'], { windowsHide: true, encoding: 'utf8' });
      const text = ns.stdout ?? '';
      const line = text.split(/\r?\n/).find(
        (l) => l.includes(`:${port}`) && /LISTENING/i.test(l),
      );
      if (!line) return {};
      const pidStr = line.trim().split(/\s+/).pop() ?? '';
      const pid = Number(pidStr);
      if (!Number.isFinite(pid) || pid <= 0) return {};
      const tl = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        encoding: 'utf8',
      });
      const m = (tl.stdout ?? '').match(/"([^"]+)"/);
      return { pid, name: m ? m[1] : undefined };
    }
    // POSIX：lsof 优先，ss 兜底
    let out = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
    let text = out.stdout ?? '';
    if (text.includes('command not found') || text.trim() === '') {
      out = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' });
      text = out.stdout ?? '';
      const line = text.split('\n').find((l) => l.includes(`:${port}`));
      const pidM = line ? line.match(/pid=(\d+)/) : null;
      const pid = pidM ? Number(pidM[1]) : NaN;
      if (!Number.isFinite(pid)) return {};
      const nameM = line ? line.match(/"([^"]+)"/) : null;
      return { pid, name: nameM ? nameM[1] : undefined };
    }
    const lines = text.split('\n');
    const line = lines.find((l) => l.includes(`:${port}`) && /LISTEN/i.test(l));
    if (!line) return {};
    const cols = line.trim().split(/\s+/);
    const pid = Number(cols[1]);
    if (!Number.isFinite(pid)) return {};
    return { pid, name: cols[0] };
  } catch {
    return {};
  }
}

export function registerSystemIpc(ipcMain: IpcMain): void {
  // 文件系统只读列举：供渲染进程自定义文件浏览器使用（渲染进程无 fs 权限）。
  ipcMain.handle(IPC.FS_LIST_DIR, (_e, path: string) => {
    const target = path && path.trim() ? path : process.cwd();
    // 始终计算父目录,即使 target 不存在 —— 这样用户在路径失效时仍可向上导航
    const parent = dirname(target);
    try {
      const names = readdirSync(target);
      const entries = names
        .map((name) => {
          let st;
          try { st = statSync(join(target, name)); } catch { return null; }
          const isDir = st.isDirectory();
          return { name, isDir, isFile: st.isFile() };
        })
        .filter((x): x is { name: string; isDir: boolean; isFile: boolean } => x !== null)
        .sort((a, b) => {
          // 目录在前、文件在后，同组按名称（不区分大小写）排序
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      return { path: target, parent: parent === target ? null : parent, entries, exists: true };
    } catch {
      // 目录不存在或无权限：返回空列表,但保留 parent 以便向上导航
      return { path: target, parent: parent === target ? null : parent, entries: [], exists: false };
    }
  });

  ipcMain.handle(IPC.FS_MKDIR, (_e, path: string) => {
    try {
      if (!path) return false;
      mkdirSync(path, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // Clipboard
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_e, text: string) => {
    clipboard.writeText(text);
  });

  // External links
  ipcMain.handle(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // 在系统文件管理器中打开本地目录
  ipcMain.handle(IPC.OPEN_PATH, async (_e, filePath: string) => {
    try {
      if (!filePath) return { ok: false, error: 'Empty path' };
      // shell.openPath 接受文件或目录路径，返回 Promise<error string>(空字符串表示成功)
      const result = await shell.openPath(filePath);
      return result ? { ok: false, error: result } : { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // System - 启动前校验辅助
  // 检查端口是否被占用：尝试创建 TCP server 监听该端口，能绑定则端口空闲；
  // 占用时返回占用者 PID/进程名（尽力而为），供 UI 展示可操作的处理选项。
  // host 传入 llama-server 将要绑定的地址（参数页 --host 值）：
  //   - 空/127.0.0.1 → 按 127.0.0.1 探测（回环精确）；
  //   - 0.0.0.0 / :: / 局域网 IP → 按该地址探测（2026-09 实测：占用者绑局域网 IP 时探 127.0.0.1 会漏报，
  //     探对应地址可命中——按 host 探测覆盖"占用者绑定在其他网卡 IP"的场景；
  //     注意 Windows 上通配与回环可共存（SO_REUSEADDR 语义），探测结果为尽力而为）
  ipcMain.handle(IPC.SYSTEM_CHECK_PORT, async (_e, port: number, host?: string) => {
    const bindHost = host && host.trim() ? host.trim() : '127.0.0.1';
    const free = await probePort(port, bindHost);
    if (free) return { inUse: false };
    return { inUse: true, ...getPortOwner(port) };
  });

  // 结束指定进程（端口占用处理：先确认再调用，仅接受纯数字 PID；Windows taskkill /F /PID、
  // POSIX SIGKILL——不递归杀子树，避免误伤占用者进程的其他子进程）。
  ipcMain.handle(IPC.SYSTEM_KILL_PROCESS, (_e, pid: number) => {
    if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'invalid pid' };
    try {
      if (process.platform === 'win32') {
        const r = spawnSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, encoding: 'utf8' });
        if (r.status !== 0) return { ok: false, error: (r.stderr ?? r.stdout ?? '').trim() };
      } else {
        process.kill(pid, 'SIGKILL');
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  // 从指定端口开始向后扫描，返回首个空闲端口（host 语义同 checkPort；失败/越界返回 null）。
  ipcMain.handle(IPC.SYSTEM_FIND_FREE_PORT, async (_e, port: number, host?: string, tries = 100) => {
    const bindHost = host && host.trim() ? host.trim() : '127.0.0.1';
    const from = Number.isInteger(port) ? port : 1;
    for (let i = 0; i < tries; i++) {
      const candidate = from + i;
      if (candidate > 65535) break;
      if (await probePort(candidate, bindHost)) return candidate;
    }
    return null;
  });

  // 设备探测缓存（30s）：空闲显存变化不频繁，避免 estimate / fit 批量调用重复 spawn --list-devices
  const devicesCache: { at: number; devices: DeviceMemInfo[] } = { at: 0, devices: [] };
  const DEVICES_CACHE_TTL_MS = 30_000;
  async function getDevicesCached(): Promise<DeviceMemInfo[]> {
    if (Date.now() - devicesCache.at < DEVICES_CACHE_TTL_MS) return devicesCache.devices;
    const settings = loadSettings();
    const exeDir = settings.server_exe ? dirname(settings.server_exe) : (settings.llama_dir || '');
    const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const devices = exeDir ? await listDevices(join(exeDir, exeName)) : [];
    devicesCache.at = Date.now();
    devicesCache.devices = devices;
    return devices;
  }

  // 显存探测 + 上下文容量估算（尽力而为，任一环节失败时对应字段为 null，绝不抛出）：
  // 1) spawn 随引擎分发的 `llama-server --list-devices` 取每设备空闲显存；
  // 2) GGUF 元数据 KV 内存模型（权重≈文件大小）估算全卸载上下文上限；
  // 3) 性能目标联动建议（四档目标 × 关键杠杆的确定性规则）。
  // 结果按 (模型|dtype|target|ngl|ctxSize) 缓存 60s——设备空闲显存变化不频繁，避免每次切页重复 spawn。
  const estimateCache = new Map<string, { at: number; result: VramEstimateResult }>();
  const ESTIMATE_CACHE_TTL_MS = 60_000;
  const PERF_TARGETS: PerfTarget[] = ['max-context', 'balanced', 'latency', 'memory'];
  ipcMain.handle(IPC.SYSTEM_ESTIMATE_VRAM, async (_e, modelPath: string, dtype = 'q8_0', target: PerfTarget = 'balanced', occ?: Partial<OccupancyConfig>) => {
    const validTarget: PerfTarget = PERF_TARGETS.includes(target) ? target : 'balanced';
    const occCfg: OccupancyConfig = {
      ngl: occ?.ngl ?? 'auto',
      ctxSize: Number.isFinite(occ?.ctxSize) ? Number(occ?.ctxSize) : 0,
      kvDtype: dtype,
    };
    const empty: VramEstimateResult = {
      devices: [], weightsMiB: null, kvLayers: null,
      kvBytesPerToken: null, maxContext: null, fullOffloadFits: null,
      dtype, target: validTarget, recommendations: [], occupancy: null,
    };
    if (!modelPath || !existsSync(modelPath)) return empty;
    const key = `${modelPath}|${dtype}|${validTarget}|${occCfg.ngl}|${occCfg.ctxSize}`;
    const hit = estimateCache.get(key);
    if (hit && Date.now() - hit.at < ESTIMATE_CACHE_TTL_MS) return hit.result;

    const devices = await getDevicesCached();

    let fileSizeBytes: number | null = null;
    try { fileSizeBytes = statSync(modelPath).size; } catch { /* 文件不可读 */ }
    let info = null;
    try { ({ info } = await readGgufMetadata(modelPath)); } catch { /* 非 GGUF/损坏 */ }

    const primary = [...devices].sort((a, b) => b.freeMiB - a.freeMiB)[0] ?? null;
    const systemFreeMiB = Math.round(freemem() / (1024 * 1024));
    const est = info && primary
      ? estimateVram({
          info,
          fileSizeBytes,
          freeBytes: primary.freeMiB * 1024 * 1024,
          dtypeBytes: KV_DTYPE_BYTES[dtype] ?? KV_DTYPE_BYTES.f16,
        })
      : null;
    const recommendations = info && primary
      ? recommendForTarget(validTarget, info, fileSizeBytes, primary.freeMiB, systemFreeMiB)
      : [];
    // 硬件占用估算（显存 + 内存双侧，会话参数驱动）：与渲染端展示共用同一份结构化结果
    const occupancy = info && primary
      ? estimateOccupancy({
          info,
          fileSizeBytes,
          deviceFreeMiB: primary.freeMiB,
          deviceTotalMiB: primary.totalMiB,
          systemTotalMiB: Math.round(totalmem() / (1024 * 1024)),
          systemFreeMiB: Math.round(freemem() / (1024 * 1024)),
          ngl: occCfg.ngl,
          ctxSize: occCfg.ctxSize,
          kvDtype: occCfg.kvDtype,
        })
      : null;

    const result: VramEstimateResult = {
      devices,
      weightsMiB: est?.weightsMiB ?? (fileSizeBytes !== null ? fileSizeBytes / (1024 * 1024) : null),
      kvLayers: est?.kvLayers ?? null,
      kvBytesPerToken: est?.kvBytesPerToken ?? null,
      maxContext: est?.maxContext ?? null,
      fullOffloadFits: est?.fullOffloadFits ?? null,
      dtype,
      target: validTarget,
      recommendations,
      occupancy,
    };
    if (estimateCache.size >= 16) {
      const first = estimateCache.keys().next().value;
      if (first) estimateCache.delete(first);
    }
    estimateCache.set(key, { at: Date.now(), result });
    return result;
  });

  // llama-bench 离线体检：单模型单作业，run 启动（fire-and-forget，错误落 job state）、
  // status 轮询取状态/结果；结果按模型路径缓存会话期（同模型重复体检直接返回缓存）。
  const benchJobs = new Map<string, LlamaBenchJobState>();
  const benchResults = new Map<string, LlamaBenchJobState>();  ipcMain.handle(IPC.SYSTEM_BENCH_LLAMA_RUN, (_e, modelPath: string) => {
    if (!modelPath || !existsSync(modelPath)) {
      return { ok: false as const, error: 'file not found' };
    }
    const running = benchJobs.get(modelPath);
    if (running?.state === 'running') return { ok: true as const, data: running };

    // 引擎目录的 llama-bench（与 llama-server 同目录）
    const settings = loadSettings();
    const exeDir = settings.server_exe ? dirname(settings.server_exe) : (settings.llama_dir || '');
    const exeName = process.platform === 'win32' ? 'llama-bench.exe' : 'llama-bench';

    const job: LlamaBenchJobState = { modelPath, state: 'running' };
    benchJobs.set(modelPath, job);
    runLlamaBench({ exePath: join(exeDir, exeName), modelPath })
      .then((summary) => {
        job.state = 'done';
        job.summary = summary;
        benchResults.set(modelPath, job);
      })
      .catch((err: Error) => {
        job.state = 'error';
        job.error = err.message;
        benchResults.set(modelPath, job);
      });
    // 显式重跑：返回新作业（running），完成后覆盖旧结果
    return { ok: true as const, data: job };
  });
  ipcMain.handle(IPC.SYSTEM_BENCH_LLAMA_STATUS, (_e, modelPath: string) => {
    return benchJobs.get(modelPath) ?? benchResults.get(modelPath) ?? null;
  });

  // 模型列表批量显存适配判定（fit/partial/no 徽章）：fit = 权重可全卸载；partial = 需部分卸载；
  // no = 权重超过全部设备总显存（建议更小量化）。元数据不可读的文件 verdict 为 null（UI 不出徽章）。
  ipcMain.handle(IPC.SYSTEM_ESTIMATE_MODEL_FIT, async (_e, paths: string[], dtype = 'q8_0') => {
    const out: Record<string, ModelFitResult> = {};
    if (!Array.isArray(paths) || paths.length === 0) return out;
    const devices = await getDevicesCached();
    const primary = [...devices].sort((a, b) => b.freeMiB - a.freeMiB)[0] ?? null;
    const totalVramMiB = devices.reduce((s, d) => s + d.totalMiB, 0);
    for (const p of paths.slice(0, 100)) {
      const base: ModelFitResult = { verdict: null, maxContext: null, weightsMiB: null, dtype };
      try {
        const size = statSync(p).size;
        base.weightsMiB = size / (1024 * 1024);
        if (primary) {
          const { info } = await readGgufMetadata(p);
          const est = estimateVram({
            info,
            fileSizeBytes: size,
            freeBytes: primary.freeMiB * 1024 * 1024,
            dtypeBytes: KV_DTYPE_BYTES[dtype] ?? KV_DTYPE_BYTES.f16,
          });
          base.maxContext = est.maxContext;
          base.verdict = base.weightsMiB > totalVramMiB ? 'no' : (est.fullOffloadFits ? 'fit' : 'partial');
        }
      } catch { /* 非 GGUF/损坏/不可读：保持 null */ }
      out[p] = base;
    }
    return out;
  });

  // 检查文件是否存在（用于校验 server_exe、model 文件）
  ipcMain.handle(IPC.SYSTEM_FILE_EXISTS, (_e, filePath: string) => {
    try {
      return existsSync(filePath);
    } catch {
      return false;
    }
  });

  // 在目录内查找 llama-server 可执行文件（内联检测机制）
  // 查找顺序：目录根 → 一级子目录
  ipcMain.handle(IPC.SYSTEM_FIND_LLAMA_EXE, (_e, dir: string) => {
    if (!dir) return '';
    const exeNames = process.platform === 'win32'
      ? ['llama-server.exe']
      : ['llama-server'];
    try {
      // 1. 目录根
      for (const name of exeNames) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
      }
      // 2. 一级子目录（如 llama-b9878-bin-win-vulkan-x64/llama-server.exe）
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const name of exeNames) {
          const p = join(dir, entry.name, name);
          if (existsSync(p)) return p;
        }
      }
    } catch {
      // 忽略读取错误
    }
    return '';
  });

  // 检测应用生成文件中的可清理项（配置目录 + 模型目录全清单）
  // 强校验：仅返回明确识别的无效/过时文件，settings.json 与有效预设永不清理；
  // 进行中/暂停/可重试下载任务占用的 .part/续传日志自动保护
  ipcMain.handle(IPC.SYSTEM_DETECT_TRASH, () => {
    return detectTrash({
      modelsDir: loadSettings().models_dir ?? '',
      protectedPaths: getDownloadManager().getProtectedPaths(),
    });
  });

  // 执行清理：对每个待清理项重新校验根归属、kind 特征、保护集与符号链接
  ipcMain.handle(IPC.SYSTEM_CLEAN_TRASH, (_e, items: TrashItem[]) => {
    return cleanTrash(items ?? [], {
      modelsDir: loadSettings().models_dir ?? '',
      protectedPaths: getDownloadManager().getProtectedPaths(),
    });
  });
}
