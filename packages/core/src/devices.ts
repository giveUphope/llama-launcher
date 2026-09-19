/**
 * 显存探测：spawn 随引擎分发的 `llama-server --list-devices`，解析每设备的总/空闲显存。
 *
 * 输出格式（Vulkan/CUDA 通用，打印即退出）：
 *   Available devices:
 *     Vulkan0: AMD Radeon RX 7900 XTX (24560 MiB, 23749 MiB free)
 *     CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 23234 MiB free)
 * 解析对格式变化容错：不匹配的行静默跳过；spawn 失败/超时返回空数组（调用方降级为不估算）。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DeviceMemInfo } from '@llama-launcher/shared';

/** 各平台的 llama-server 可执行文件名 */
export function serverExeName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

/**
 * 依次列出可用于 `--list-devices` 的候选路径：
 * settings.server_exe 本身 → 其同目录 → llama_dir 根 → llama_dir 一级子目录 → 开发态默认（仓库根 llama-*-bin-*）。
 * 纯按设置拼装、不做存在性判断（便于单测）；校验由 resolveServerExe 负责。
 */
export function candidateServerExes(
  settings: { server_exe?: string; llama_dir?: string },
  devDefault = '',
  name: string = serverExeName(),
  listSubDirs: (dir: string) => string[] = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
): string[] {
  const out: string[] = [];
  // 去重必须忽略分隔符差异：win32 下 path.join 产出反斜杠，而 settings 里存的多是正斜杠，
  // 直接比字符串会把同一路径当两个候选（实测 D:/eng/stale/x 与 D:\eng\stale\x 并存）。
  const seen = new Set<string>();
  const push = (p: string) => {
    const k = p.replace(/\\/g, '/');
    if (p && !seen.has(k)) { seen.add(k); out.push(p); }
  };
  if (settings.server_exe) {
    push(settings.server_exe);
    push(join(dirname(settings.server_exe), name));
  }
  if (settings.llama_dir) {
    push(join(settings.llama_dir, name));
    for (const sub of listSubDirs(settings.llama_dir)) push(join(settings.llama_dir, sub, name));
  }
  push(devDefault);
  return out;
}

/** 取第一个真实存在的候选；全都不存在时 exe 为空串并回带尝试过的路径（供界面说明原因）。 */
export function resolveServerExe(
  settings: { server_exe?: string; llama_dir?: string },
  devDefault = '',
  exists: (p: string) => boolean = existsSync,
  listSubDirs?: (dir: string) => string[],
): { exe: string; tried: string[] } {
  const tried = candidateServerExes(settings, devDefault, undefined, listSubDirs);
  return { exe: tried.find((p) => exists(p)) ?? '', tried };
}

/** 单行设备描述解析：`<id>: <name> (<total> MiB, <free> MiB free)` */
export function parseListDevicesOutput(text: string): DeviceMemInfo[] {
  const devices: DeviceMemInfo[] = [];
  // 逐行锚定解析：避免跨行 \s* 把 "Available devices:" 标题行与下一行内容错误拼接
  const re = /^\s*([A-Za-z]+\d*)\s*:\s*(.+?)\s*\(\s*(\d+)\s*MiB\s*,\s*(\d+)\s*MiB\s+free\s*\)\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      devices.push({
        id: m[1],
        name: m[2].trim(),
        totalMiB: Number(m[3]),
        freeMiB: Number(m[4]),
      });
    }
  }
  return devices;
}

/**
 * 运行 `--list-devices` 并解析设备列表。
 * llama.cpp 的部分日志/列表走 stderr，stdout/stderr 合并后解析。
 * 超时或进程异常时返回已收集内容（通常为空数组），绝不抛出。
 */
export function listDevices(llamaServerExe: string, timeoutMs = 8000): Promise<DeviceMemInfo[]> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(llamaServerExe, ['--list-devices'], { windowsHide: true });
    } catch {
      resolve([]);
      return;
    }
    let out = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseListDevicesOutput(out));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += String(d); });
    child.stderr?.on('data', (d: Buffer) => { out += String(d); });
    child.on('error', () => finish());
    child.on('close', () => finish());
  });
}
