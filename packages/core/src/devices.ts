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
import type { DeviceMemInfo } from '@llama-launcher/shared';

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
