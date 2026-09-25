// 引擎侧「地址与环境变量」两条通路的解析边界（纯函数住在 shared，core 与渲染层共用）。
// 这两组判定都是 b11178 基线审计引出的：`--host` 新支持逗号分隔多地址，且 57/60 个应用
// 参数带 `(env: LLAMA_ARG_*)` 覆写通道——两者都会让「界面值 / 命令行」与「引擎实际接受的」分叉。
import { describe, it, expect } from 'vitest';
import { hostList, displayHost, tcpHosts, isUnixSocketHost, detectLlamaEnvOverrides, DEFAULT_HOST } from '@llama-launcher/shared';

describe('hostList / displayHost / tcpHosts', () => {
  it('单地址原样可用，空输入回落到默认回环地址', () => {
    expect(hostList('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(displayHost('')).toBe(DEFAULT_HOST);
    expect(tcpHosts(undefined)).toEqual([DEFAULT_HOST]);
  });

  it('逗号分隔多地址逐项解析，访问地址优先取回环', () => {
    expect(hostList(' 0.0.0.0 , ::1 ')).toEqual(['0.0.0.0', '::1']);
    expect(displayHost('0.0.0.0,127.0.0.1')).toBe('127.0.0.1');
    expect(displayHost('0.0.0.0,::1')).toBe('::1');
    // 没有回环时取首个，而不是把整串当地址（整串拼进 URL 会得到打不开的链接）
    expect(displayHost('0.0.0.0,192.168.1.7')).toBe('0.0.0.0');
  });

  it('.sock 项既不作访问地址也不参与 TCP 探测', () => {
    expect(isUnixSocketHost('/tmp/llama.sock')).toBe(true);
    expect(displayHost('/tmp/llama.sock')).toBe('');
    // 全为 socket → 探测列表为空：没有 TCP 端口可探，判定「不占用」而非拿路径去 bind
    expect(tcpHosts('/tmp/llama.sock')).toEqual([]);
    // 混合列表只保留 TCP 项
    expect(tcpHosts('0.0.0.0,/tmp/llama.sock')).toEqual(['0.0.0.0']);
  });
});

describe('detectLlamaEnvOverrides', () => {
  it('只收 LLAMA_ARG_ 前缀且有值的项，按名字排序', () => {
    expect(
      detectLlamaEnvOverrides({
        LLAMA_ARG_TEMPERATURE: '0.5',
        LLAMA_ARG_TOP_P: '0.9',
        LLAMA_ARG_HOST: '',
        LLAMA_ARGS_OTHER: '1',
        PATH: 'x',
      }),
    ).toEqual(['LLAMA_ARG_TEMPERATURE', 'LLAMA_ARG_TOP_P']);
  });

  it('没有任何引擎侧变量时返回空数组（发射规则的「不发射=引擎缺省」前提成立）', () => {
    expect(detectLlamaEnvOverrides({ HOME: '/x', LANG: 'zh_CN' })).toEqual([]);
  });
});
