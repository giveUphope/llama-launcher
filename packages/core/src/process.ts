import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type { OutputEntry, OutputKind } from '@llama-launcher/shared';

/** 单行输出长度上限：超过部分截断并追加标记（防止超长行整行塞爆 IPC/UI 渲染） */
const MAX_OUTPUT_LINE_LENGTH = 8 * 1024;
/** 无换行缓冲上限：超限强制按一行（截断）输出并清空（防止流无换行导致缓冲无限增长） */
const MAX_OUTPUT_BUFFER_LENGTH = 64 * 1024;

export interface ProcessOptions {
  exePath: string;
  args: string[];
  cwd?: string;
}

export class LlamaServerProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private exeName: string | null = null;
  private stdoutBuf = '';
  private stderrBuf = '';
  public pid: number | null = null;

  start(opts: ProcessOptions): void {
    this.proc = spawn(opts.exePath, opts.args, {
      cwd: opts.cwd,
      windowsHide: true,
      shell: false,
    });
    this.pid = this.proc.pid ?? null;
    this.exeName = basename(opts.exePath);
    // 通知上层进程已拉起（携带 pid 与 exePath），用于建立窗口-进程关联映射
    this.emit('spawned', { pid: this.pid, exePath: opts.exePath });
    this.proc.stdout?.on('data', (chunk: Buffer) => this.feedOutput('stdout', chunk.toString('utf-8')));
    this.proc.stderr?.on('data', (chunk: Buffer) => this.feedOutput('stderr', chunk.toString('utf-8')));
    this.proc.on('error', (err) => {
      this.emitOutput('error', String(err));
    });
    this.proc.on('exit', (code, signal) => {
      // flush trailing（同样走截断逻辑）
      if (this.stdoutBuf) { this.emitOutputLine('stdout', this.stdoutBuf); this.stdoutBuf = ''; }
      if (this.stderrBuf) { this.emitOutputLine('stderr', this.stderrBuf); this.stderrBuf = ''; }
      this.emit('exit', code ?? -1, signal);
    });
  }

  /** 杀掉进程树：Windows 用 taskkill /F /T，类 Unix 用进程组信号（负 PID）。 */
  private killTree(pid: number): void {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    } else {
      // 负 PID 表示向整个进程组发送信号，覆盖所有子进程
      try { process.kill(-pid, 'SIGKILL'); } catch { /* 可能已退出或无权限 */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* 可能已退出 */ }
    }
  }

  /** 兜底：按可执行文件名结束可能残留的同名进程（本启动器拉起的 llama-server）。返回是否成功发起扫杀。 */
  sweepByName(name: string): boolean {
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/IM', name], { windowsHide: true });
        return true;
      } catch { return false; }
    }
    try { spawnSync('pkill', ['-f', name], { windowsHide: true }); return true; }
    catch { return false; } // pkill 不存在则跳过
  }

  kill(): boolean {
    if (!this.proc || this.proc.pid === undefined) return false;
    const pid = this.proc.pid;
    try {
      this.killTree(pid);
      this.proc = null;
      return true;
    } catch { return false; }
  }

  /**
   * 强制结束：先杀进程树，再按可执行文件名扫杀任何残留同名进程。
   * 不依赖 PID 句柄是否仍有效，确保关闭窗口后无残留进程占用资源。
   */
  forceKill(): void {
    const pid = this.proc?.pid;
    if (pid !== undefined && pid !== null) {
      this.killTree(pid);
    }
    if (this.exeName) {
      this.sweepByName(this.exeName);
    }
    this.proc = null;
  }

  /**
   * 同步杀进程：用于应用退出场景，确保子进程（llama-server）在主进程退出前被彻底终止。
   * 流程：1) 杀进程树（含所有子进程）；2) 轮询确认已退出；3) 若仍存活则重试；
   * 4) 无论 PID 树是否确认死亡，最后都按可执行文件名兜底扫杀，确保无残留进程。
   */
  killSync(): boolean {
    const pid = this.proc?.pid;
    let confirmedDead = false;
    if (pid !== undefined && pid !== null) {
      this.killTree(pid);
      const deadline = Date.now() + 1200;
      let alive = true;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0); // 抛出表示进程不存在
          alive = true;
        } catch {
          alive = false;
          break;
        }
        // 阻塞式微睡眠，避免空转占用 CPU（Node 标准做法）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      }
      if (alive) this.killTree(pid); // 重试一次
      confirmedDead = !alive;
    }
    // 兜底：按可执行文件名扫杀残留同名进程，确保无残留
    if (this.exeName) {
      this.sweepByName(this.exeName);
    }
    this.proc = null;
    return true;
  }

  /**
   * 两阶段终止：
   *   1) 正常退出（优雅策略）：Windows 用 `taskkill /PID`（默认发送 WM_CLOSE/SIGTERM 等价），
   *      类 Unix 用 `SIGTERM`（-PID 进程组）。随后轮询确认进程已退出。
   *   2) 强制终止（兜底策略）：若优雅策略在超时内未生效，使用 `taskkill /F /T`（Windows）
   *      或 `SIGKILL`（类 Unix）立即杀掉进程树。
   *
   * 该方法设计为可重复调用、幂等，并始终通过回调上报每一步的结果，便于上层记录清理状态。
   *
   * @param onStep 每一步的结果回调（'graceful' | 'forced' | 'already-dead'，以及 error）
   * @param timeoutMs 优雅策略等待进程退出的超时（默认 800ms）
   * @returns 是否确认进程已终止
   */
  terminate(
    onStep?: (step: 'already-dead' | 'graceful' | 'forced' | 'error', detail?: unknown) => void,
    timeoutMs = 800,
  ): boolean {
    const pid = this.proc?.pid;
    if (pid === undefined || pid === null) {
      onStep?.('already-dead');
      this.proc = null;
      return true;
    }

    // 阶段一：优雅终止
    try {
      if (process.platform === 'win32') {
        // 默认不带 /F：请求进程自行退出（等价于 SIGTERM）
        spawnSync('taskkill', ['/T', '/PID', String(pid)], { windowsHide: true });
      } else {
        try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ } }
      }
    } catch (e) {
      onStep?.('error', e);
    }

    // 轮询确认优雅终止是否生效
    const deadline = Date.now() + timeoutMs;
    let alive = true;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); alive = true; }
      catch { alive = false; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }

    if (!alive) {
      onStep?.('graceful');
      this.proc = null;
      return true;
    }

    // 阶段二：强制终止
    onStep?.('forced');
    try {
      this.killTree(pid);
    } catch (e) {
      onStep?.('error', e);
    }
    // 注意：此处不再按可执行文件名扫杀（sweepByName）。
    // 两阶段终止已通过 PID 进程树精确命中目标；按名扫杀会误伤同名但无关的
    // 进程（如测试用 node.exe、用户其他 llama-server 实例），仅在应用退出
    // 的 forceStop() 场景下才针对明确的 llama-server 可执行名做兜底。
    this.proc = null;
    return true;
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  /**
   * 喂入一段输出并按行转发：有换行逐行 emit，无换行部分留在缓冲。
   * 缓冲超限（长时间无换行）时强制按一行（截断）输出并清空，防止内存无限增长。
   */
  private feedOutput(kind: 'stdout' | 'stderr', chunk: string): void {
    const bufKey = kind === 'stdout' ? 'stdoutBuf' : 'stderrBuf';
    const combined = this[bufKey] + chunk;
    const lines = combined.split('\n');
    const remainder = lines.pop() ?? '';
    for (const line of lines) {
      this.emitOutputLine(kind, line + '\n');
    }
    this[bufKey] = remainder;
    if (remainder.length > MAX_OUTPUT_BUFFER_LENGTH) {
      this.emitOutputLine(kind, remainder);
      this[bufKey] = '';
    }
  }

  /** 输出单行：超长截断并追加标记（含原长度差），保证单条 OutputEntry 有界。 */
  private emitOutputLine(kind: OutputKind, line: string): void {
    if (line.length > MAX_OUTPUT_LINE_LENGTH) {
      const overflow = line.length - MAX_OUTPUT_LINE_LENGTH;
      this.emitOutput(
        kind,
        line.slice(0, MAX_OUTPUT_LINE_LENGTH) + `\n... [truncated ${overflow} bytes]\n`,
      );
    } else {
      this.emitOutput(kind, line);
    }
  }

  private emitOutput(kind: OutputKind, data: string): void {
    const entry: OutputEntry = { kind, data, ts: Date.now() };
    this.emit('output', entry);
  }
}

/**
 * 杀掉以 `pid` 为根的整棵进程树（含所有子孙）。
 * - Windows：taskkill /F /T /PID（强制、递归）。
 * - 类 Unix：先向进程组（-pid）发 SIGTERM，必要时 SIGKILL。
 * 用于应用退出时彻底结束 dev 会话（turbo/vite/concurrently 等兄弟进程）。
 * @returns 是否成功发起终止（false 表示 pid 无效或平台不支持）
 */
export function killProcessTree(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  try {
    try { process.kill(-pid, 'SIGTERM'); } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ }
    }
    return true;
  } catch {
    return false;
  }
}

export interface SimpleProcessInfo {
  pid: number;
  ppid: number;
  cmd: string;
}

/**
 * 从当前进程向上回溯父进程，找到"dev 会话根"（即 `turbo run dev` 的进程）。
 * 仅用于开发模式：关闭窗口时顺带结束整个 dev 会话。
 * - Windows：通过 WMIC 拉取全量进程父子关系。
 * - 类 Unix：通过 `ps -o pid,ppid,args` 拉取。
 * @returns dev 会话根 pid；若找不到则返回 null（不误杀）。
 */
export function findDevSessionRoot(): number | null {
  let infos: SimpleProcessInfo[] = [];
  try {
    if (process.platform === 'win32') {
      // 只筛选 turbo 相关进程（命令行含 turbo+run，或进程名即 turbo.exe），
      // 输出体积小、不会因进程过多导致 stdout 截断而 JSON 解析失败。
      // 用 PowerShell Get-CimInstance 输出 JSON（比已废弃的 wmic 可靠）。
      const ps =
        "Get-CimInstance Win32_Process | " +
        "Where-Object { $_.CommandLine -like '*turbo*run*' -or $_.Name -eq 'turbo.exe' } | " +
        'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
      const out = spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, encoding: 'utf8' });
      const text = (out.stdout ?? '').trim();
      if (!text) return null;
      const arr = text.startsWith('[') ? JSON.parse(text) : [JSON.parse(text)];
      for (const o of arr) {
        const pid = Number(o.ProcessId);
        const ppid = Number(o.ParentProcessId);
        const cmd = o.CommandLine ?? '';
        if (Number.isFinite(pid) && Number.isFinite(ppid)) infos.push({ pid, ppid, cmd });
      }
    } else {
      const out = spawnSync('ps', ['-o', 'pid,ppid,args', '-A'], { windowsHide: true, encoding: 'utf8' });
      const lines = (out.stdout ?? '').split(/\r?\n/).slice(1).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        infos.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] });
      }
    }
  } catch {
    return null;
  }

  const byPid = new Map<number, SimpleProcessInfo>();
  for (const i of infos) byPid.set(i.pid, i);

  return pickTurboDevRoot(infos, byPid);
}

/**
 * 从进程列表中挑选"dev 会话根"（纯函数，便于单测）。
 * 采用"自顶向下"定位，而非从当前进程向上回溯——
 * 原因：Windows 安全限制下，electron 主进程自身的 WMI 条目往往
 * ParentProcessId/CommandLine 为空，从它向上回溯会立即中断、返回 null，
 * 导致整棵 dev 树（turbo/vite）杀不掉。
 * 改为：扫描命令行含 "turbo" 且带 "run" 的条目（这些条目的 WMI 数据通常可靠），
 * 取其中"父进程不再是 turbo"的最顶层那个作为根。
 */
export function pickTurboDevRoot(
  infos: SimpleProcessInfo[],
  byPid: Map<number, SimpleProcessInfo>,
): number | null {
  const isTurboRoot = (i: SimpleProcessInfo): boolean =>
    /\bturbo\b/.test(i.cmd) && /run\b/.test(i.cmd);

  const turboMatches = infos.filter(isTurboRoot);
  if (turboMatches.length === 0) return null;

  const turboPids = new Set(turboMatches.map((i) => i.pid));
  // 顶端 turbo：其直接父进程不在 turbo 匹配集合中。
  const roots = turboMatches.filter((i) => {
    const parent = byPid.get(i.ppid);
    return !parent || !turboPids.has(parent.pid);
  });

  // 取最顶层的根（命令行最像 `turbo run dev` 启动入口的优先；否则取第一个）。
  const pick = roots.length > 0 ? roots[0] : turboMatches[turboMatches.length - 1];
  return pick.pid;
}
