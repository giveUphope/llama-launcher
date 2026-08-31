import { describe, it, expect } from 'vitest';
import { presetNameCandidates, isNameConsistentWithModel } from './useAutoPresetName';

describe('presetNameCandidates / isNameConsistentWithModel（预设名称↔模型对应）', () => {
  it('候选 = 文件名（含扩展名）与去 .gguf/.bin 后缀，去重保序', () => {
    expect(presetNameCandidates('D:\\models\\qwen\\foo.gguf')).toEqual(['foo.gguf', 'foo']);
    expect(presetNameCandidates('/models/bar.bin')).toEqual(['bar.bin', 'bar']);
    expect(presetNameCandidates('')).toEqual([]);
  });

  it('模型为空 = 纯参数集预设，任何名称均一致', () => {
    expect(isNameConsistentWithModel('任意名', '')).toBe(true);
  });

  it('名称等于文件名或去扩展名 = 一致', () => {
    const m = 'D:\\LLMmodels\\qwen\\Qwen3-8B-Q4_K_M.gguf';
    expect(isNameConsistentWithModel('Qwen3-8B-Q4_K_M', m)).toBe(true);
    expect(isNameConsistentWithModel('Qwen3-8B-Q4_K_M.gguf', m)).toBe(true);
  });

  it('名称对应另一模型（错绑场景）= 不一致', () => {
    const m = 'D:\\LLMmodels\\qwen\\Qwen3-8B-Q4_K_M.gguf';
    expect(isNameConsistentWithModel('Qwen3.6-35B-A3B-UD-IQ1_M', m)).toBe(false);
    // 自定义语义名与模型文件名不对应（函数层面判不一致；面板策略仅在同名预设
    // 已绑定另一模型时才弹确认，纯自定义新名静默放行）
    expect(isNameConsistentWithModel('高速模式', m)).toBe(false);
  });
});
