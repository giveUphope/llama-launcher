import { describe, it, expect } from 'vitest';
import { parseListDevicesOutput, listDevices, candidateServerExes, resolveServerExe } from '../src/devices.js';

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

describe('candidateServerExes / resolveServerExe（引擎目录失配时的探测回退）', () => {
  const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const SUB = 'llama-b11053-bin-win-vulkan-x64';
  const subDirs = () => [SUB];
  const ENG = 'D:/eng';
  // path.join 在 win32 下产出反斜杠，断言统一归一成正斜杠再比
  const norm = (p: string) => p.replace(/\\/g, '/');
  const normAll = (list: string[]) => list.map(norm);

  it('按可信度排序：server_exe → 其同目录 → llama_dir 根 → 一级子目录 → 开发态默认，且去重', () => {
    const list = candidateServerExes(
      { server_exe: `${ENG}/stale/${EXE}`, llama_dir: ENG },
      `D:/repo/llama-b9999-bin-win-vulkan-x64/${EXE}`,
      EXE,
      subDirs,
    );
    expect(normAll(list)).toEqual([
      `${ENG}/stale/${EXE}`,
      `${ENG}/${EXE}`,
      `${ENG}/${SUB}/${EXE}`,
      `D:/repo/llama-b9999-bin-win-vulkan-x64/${EXE}`,
    ]);
  });

  it('settings 全空时只给出开发态默认；连它也没有则空列表', () => {
    expect(candidateServerExes({}, '', EXE, subDirs)).toEqual([]);
    expect(candidateServerExes({}, `D:/dev/${EXE}`, EXE, subDirs)).toEqual([`D:/dev/${EXE}`]);
  });

  it('server_exe 指向已删除目录时，回退到实际存在的子目录候选（真机曾发生 b10938 → b11053）', () => {
    const good = `${ENG}/${SUB}/${EXE}`;
    const { exe, tried } = resolveServerExe(
      { server_exe: `${ENG}/llama-b10938-bin-win-vulkan-x64/${EXE}`, llama_dir: ENG },
      '',
      (p) => norm(p) === good,
      subDirs,
    );
    expect(norm(exe)).toBe(good);
    expect(normAll(tried)[0]).toContain('b10938'); // 首选仍是用户记录的路径，只有它不存在才回退
  });

  it('全部候选都不存在 → exe 为空串且 tried 非空（界面据此说明「试过哪些路径」）', () => {
    const { exe, tried } = resolveServerExe({ server_exe: `D:/gone/a/${EXE}` }, '', () => false, subDirs);
    expect(exe).toBe('');
    expect(tried.length).toBeGreaterThan(0);
    expect(normAll(tried)[0]).toContain('gone');
  });
});
