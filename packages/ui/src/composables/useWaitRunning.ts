import { useServerStore } from '@/stores/server';

export type WaitRunningResult = 'ok' | 'timeout' | 'failed';

/**
 * 等待服务进入 running 的两阶段轮询（BenchPanel 智能启动原实现，抽取为公共 composable）：
 * - restarting=true（重启场景）：先等状态离开 running（旧进程 exit）再等重新 running（新进程就绪）——
 *   避免旧 running 残留导致新进程模型未加载完就发请求（端点无法访问）；
 * - restarting=false（首次启动）：直接等待 running。
 * 启动失败检测：模型配置错误等导致 llama-server 启动失败时，进程 exit → 状态停在 stopped 且
 * pid 为 null，不会重新 running。此时连续多次轮询确认后立即判定 'failed'（而非等到超时），
 * 避免界面一直停留在"等待服务就绪"。
 * 每次轮询经 setInterval(300ms) 调用 server.refreshStatus() 刷新主进程侧状态。
 */
export async function waitForRunning(timeoutMs: number, restarting = false): Promise<WaitRunningResult> {
  const server = useServerStore();
  return new Promise((resolve) => {
    const started = Date.now();
    // 阶段标记：restart 时先等旧进程退出（状态 != running），再等新进程 running
    let phase: 'wait-exit' | 'wait-running' = restarting ? 'wait-exit' : 'wait-running';
    // 启动失败判定：连续 N 次轮询看到 stopped + pid null（进程已退出且未重启）→ 判定失败
    let stoppedStreak = 0;
    const FAIL_STREAK = 4; // ~1.2s（300ms × 4），区分 restart 的短暂 stopped 中间态
    const timer = setInterval(async () => {
      // 每次轮询刷新 pid/status（restart 后主进程状态变化）
      try {
        await server.refreshStatus();
      } catch {
        /* 忽略轮询失败 */
      }
      const s = server.status;
      if (phase === 'wait-exit') {
        // 旧进程退出：状态离开 running（stopped/starting 都算退出完成）
        if (s !== 'running') phase = 'wait-running';
        stoppedStreak = 0;
      } else if (s === 'running') {
        clearInterval(timer);
        resolve('ok');
        return;
      } else if (s === 'stopped' && server.pid === null) {
        // 进程已退出（启动失败或意外退出）：连续确认后判定失败
        stoppedStreak++;
        if (stoppedStreak >= FAIL_STREAK) {
          clearInterval(timer);
          resolve('failed');
          return;
        }
      } else {
        // starting 等中间态：重置连续计数
        stoppedStreak = 0;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve('timeout');
      }
    }, 300);
  });
}