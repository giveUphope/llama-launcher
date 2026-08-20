import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
const out = spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, encoding: 'utf8' });
const text = out.stdout ?? '';
let arr;
try { arr = text.trim().startsWith('[') ? JSON.parse(text) : [JSON.parse(text)]; }
catch (e) { writeFileSync('D:/DEV/llama_launcher/packages/core/live_result.json', JSON.stringify({ jsonError: String(e), head: text.slice(0,400) })); process.exit(0); }

const infos = [];
for (const o of arr) {
  const pid = Number(o.ProcessId); const ppid = Number(o.ParentProcessId); const cmd = o.CommandLine ?? '';
  if (Number.isFinite(pid) && Number.isFinite(ppid)) infos.push({ pid, ppid, cmd });
}
const byPid = new Map(); infos.forEach((i) => byPid.set(i.pid, i));

// 从命令行传入的目标 pid（如真实 electron 主进程）向上回溯
const target = Number(process.argv[2]) || process.pid;
const chain = []; const vis = new Set(); let cur = target;
while (cur > 0 && !vis.has(cur)) {
  vis.add(cur);
  const info = byPid.get(cur);
  const isTurbo = !!(info && /\bturbo\b/.test(info.cmd) && /run\b/.test(info.cmd));
  chain.push({ pid: cur, ppid: info?.ppid, isTurbo, cmd: (info?.cmd || '').slice(0, 90) });
  cur = info?.ppid ?? 0;
}
writeFileSync('D:/DEV/llama_launcher/packages/core/live_result.json', JSON.stringify({ target, chain }, null, 2));
