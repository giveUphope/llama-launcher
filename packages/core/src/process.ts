import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
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

/**
 * 判断进程是否仍存活（跨平台）。
 *
 * `process.kill(pid, 0)` 仅探测"该 PID 是否为有效进程"，对已退出但尚未被父进程收割（reap）
 * 的**僵尸进程**（Linux/macOS 上的 POSIX 语义）仍返回成功；僵尸进程已不可调度，等同死亡。
 *
 * 本模块所有存活轮询均为同步（`Atomics.wait` 阻塞事件循环），子进程退出后 SIGCHLD 无法被
 * libuv 处理、不会被收割，若仅依赖 `kill(pid, 0)` 会把僵尸进程误判为存活，导致优雅终止超时、
 * 误入强制路径并返回 false（CI Linux 实测失败）。故类 Unix 下补充僵尸态检测：
 * - Linux：读 `/proc/<pid>/stat` 的状态位（Z = zombie）；
 * - macOS/BSD：`ps -o state=` 输出含 `Z`。
 *
 * @returns true 表示进程存活且可调度；无法探测时保守视为存活（避免误判死进程而触发按名扫杀）。
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') return true;
  try {
    let state = '';
    if (process.platform === 'linux') {
      // /proc/<pid>/stat 形如 "pid (comm) state ..."；comm 可含空格与括号，以最后一个 ')' 为界取状态位
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const idx = stat.lastIndexOf(')');
      state = idx >= 0 ? stat.charAt(idx + 2) : '';
    } else {
      const out = spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
      state = (out.stdout ?? '').trim();
    }
    return !state.includes('Z');
  } catch {
    return true;
  }
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
      // 短轮询确认：仅当 PID 定向终止未能确认死亡时才按名兜底扫杀，
      // 避免 taskkill /F /IM 误杀用户自启的同名 llama-server 实例。
      const deadline = Date.now() + 400;
      let alive = true;
      while (Date.now() < deadline) {
        if (!isPidAlive(pid)) { alive = false; break; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
      }
      if (alive && this.exeName) {
        this.sweepByName(this.exeName);
      }
    }
    // 无 PID 句柄（spawn 失败/句柄丢失）时不做全局按名扫杀：
    // 无证据表明目标进程存在，taskkill /F /IM 只会误伤无关同名进程。
    this.proc = null;
  }

  /**
   * 同步杀进程：用于应用退出场景，确保子进程（llama-server）在主进程退出前被彻底终止。
   * 流程：1) 杀进程树（含所有子进程）；2) 轮询确认已退出；3) 若仍存活则重试；
   * 4) 无论 PID 树是否确认死亡，最后都按可执行文件名兜底扫杀，确保无残留进程。
   * @returns PID 是否被确认为已退出（pid 不存在时视为已退出，返回 true）
   */
  killSync(): boolean {
    const pid = this.proc?.pid;
    let confirmedDead = true;
    if (pid !== undefined && pid !== null) {
      this.killTree(pid);
      const deadline = Date.now() + 1200;
      let alive = true;
      while (Date.now() < deadline) {
        if (!isPidAlive(pid)) { alive = false; break; }
        // 阻塞式微睡眠，避免空转占用 CPU（Node 标准做法）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      }
      if (alive) this.killTree(pid); // 重试一次
      confirmedDead = !alive;
    }
    // 兜底：仅当 PID 定向终止未能确认死亡时才按名扫杀残留同名进程。
    // 无条件 taskkill /F /IM 会杀掉系统中所有同名进程，包括用户自行启动、
    // 与本应用无关的 llama-server 实例，故只在确认失败时兜底。
    if (this.exeName && !confirmedDead) {
      this.sweepByName(this.exeName);
    }
    this.proc = null;
    return confirmedDead;
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
    // 注：Atomics.wait 是阻塞式休眠（挂起线程至超时），并非忙等/空转；
    // 退出路径刻意保持同步（退出时序确定性优先于事件循环响应性）。
    // 存活判定走 isPidAlive：同步轮询期间事件循环被阻塞、子进程退出后不会被收割，
    // kill(pid, 0) 对 Linux/macOS 的僵尸进程仍返回成功，需叠加僵尸态检测（见其注释）。
    const deadline = Date.now() + timeoutMs;
    let alive = true;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) { alive = false; break; }
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
    // 强制终止后短轮询确认（最多 ~400ms）。返回值表达真实确认结果：
    // 仍存活时返回 false，由调用方决定是否做按名兜底扫杀。
    // 此处不直接 sweepByName：无条件按名扫杀（taskkill /F /IM）会误伤
    // 同名但无关的进程（如测试用 node.exe、用户自启的其他 llama-server 实例）。
    const forcedDeadline = Date.now() + 400;
    let aliveAfterForced = true;
    while (Date.now() < forcedDeadline) {
      if (!isPidAlive(pid)) { aliveAfterForced = false; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
    }
    this.proc = null;
    return !aliveAfterForced;
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
