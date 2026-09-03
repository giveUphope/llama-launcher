import { describe, it, expect } from 'vitest';
import { parseListDevicesOutput, listDevices } from '../src/devices.js';

// 真实 --list-devices 输出样本（Vulkan，双设备）
const VULKAN_SAMPLE = `Available devices:
  Vulkan0: AMD Radeon RX 7900 XTX (24560 MiB, 23749 MiB free)
  Vulkan1: AMD Radeon(TM) Graphics (16209 MiB, 15398 MiB free)
`;

// CUDA 单设备样本
const CUDA_SAMPLE = `Available devices:
  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 23234 MiB free)
`;

describe('parseListDevicesOutput', () => {
  it('parses Vulkan multi-device output', () => {
    const devices = parseListDevicesOutput(VULKAN_SAMPLE);
    expect(devices).toEqual([
      { id: 'Vulkan0', name: 'AMD Radeon RX 7900 XTX', totalMiB: 24560, freeMiB: 23749 },
      { id: 'Vulkan1', name: 'AMD Radeon(TM) Graphics', totalMiB: 16209, freeMiB: 15398 },
    ]);
  });

  it('parses CUDA single-device output', () => {
    const devices = parseListDevicesOutput(CUDA_SAMPLE);
    expect(devices).toEqual([
      { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090', totalMiB: 24564, freeMiB: 23234 },
    ]);
  });

  it('tolerates log noise and non-matching lines', () => {
    const noisy = `llama.cpp build b10734
Available devices:
  no-memory-line-here
  Vulkan0: AMD Radeon RX 7900 XTX (24560 MiB, 23749 MiB free)
[ggml] some other log`;
    const devices = parseListDevicesOutput(noisy);
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('Vulkan0');
  });

  it('returns empty array for empty/garbage input', () => {
    expect(parseListDevicesOutput('')).toEqual([]);
    expect(parseListDevicesOutput('Available devices:\n')).toEqual([]);
  });
});

describe('listDevices', () => {
  it('returns empty array when exe does not exist (never throws)', async () => {
    const devices = await listDevices('D:/nonexistent/llama-server.exe', 2000);
    expect(devices).toEqual([]);
  });
});
