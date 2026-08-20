import { describe, it, expect } from 'vitest';
import { buildCommand, quoteArg, formatCommand, previewCommand } from '../src/command-builder.js';
import type { AppSettings } from '@llama-launcher/shared';

// 使用真实存在的可执行文件路径，以便通过 buildCommand 的存在性校验
const EXE_PATH = process.execPath;

const baseSettings: AppSettings = {
  server_exe: EXE_PATH,
  models_dir: './models',
  selected_model: '',
  last_preset: '',
  window_geometry: '1280x800',
  theme_mode: 'dark',
  fx_mode: 'glass',
  close_behavior: 'ask',
  sidebar_collapsed: false,
  language: 'zh',
  last_tab: '',
};

describe('buildCommand', () => {
  it('returns exe path only when no model and no params', () => {
    const cmd = buildCommand({ exePath: EXE_PATH, modelPath: '', values: {} });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('includes model path with -m', () => {
    const cmd = buildCommand({ exePath: EXE_PATH, modelPath: 'model.gguf', values: {} });
    expect(cmd).toEqual([EXE_PATH, '-m', 'model.gguf']);
  });

  it('skips default values', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 0, port: 8080 },
    });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('emits checkbox flag when true', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { cont_batching: true },
    });
    expect(cmd).toEqual([EXE_PATH, '-cb']);
  });

  it('emits invert_flag when checkbox is false and invert exists', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { context_shift: false },
    });
    expect(cmd).toEqual([EXE_PATH, '--no-context-shift']);
  });

  it('emits non-default numeric values', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 4096, port: 9090 },
    });
    // 参数顺序遵循 PARAMS 定义，port 在 ctx_size 之前
    expect(cmd).toEqual([EXE_PATH, '--port', '9090', '-c', '4096']);
  });

  it('emits dropdown and text values when not default', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { flash_attn: 'on', host: '0.0.0.0' },
    });
    // 参数顺序遵循 PARAMS 定义，host 在 flash_attn 之前
    expect(cmd).toEqual([EXE_PATH, '--host', '0.0.0.0', '-fa', 'on']);
  });

  it('maps spec_type "draft-model" to "draft-simple" for llama-server', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { spec_type: 'draft-model', spec_draft_model: 'draft.gguf' },
    });
    expect(cmd).toEqual([EXE_PATH, '--spec-type', 'draft-simple', '--spec-draft-model', 'draft.gguf']);
  });

  it('does not map spec_type "none" or "draft-mtp" (regression guard)', () => {
    const cmd1 = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { spec_type: 'none' },
    });
    expect(cmd1).toEqual([EXE_PATH, '--spec-type', 'none']);

    const cmd2 = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { spec_type: 'draft-mtp' },
    });
    expect(cmd2).toEqual([EXE_PATH, '--spec-type', 'draft-mtp']);
  });

  it('emits gpu_layers (-ngl) when non-default value', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { gpu_layers: '99' },
    });
    expect(cmd).toEqual([EXE_PATH, '-ngl', '99']);
  });

  it('emits gpu_layers "auto" (text type does not skip non-empty defaults)', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { gpu_layers: 'auto' },
    });
    expect(cmd).toEqual([EXE_PATH, '-ngl', 'auto']);
  });

  it('skips gpu_layers when empty string', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { gpu_layers: '' },
    });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('emits flash_attn "off" (non-default dropdown value)', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { flash_attn: 'off' },
    });
    expect(cmd).toEqual([EXE_PATH, '-fa', 'off']);
  });

  it('skips empty string values', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { alias: '' },
    });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('throws when executable path is empty', () => {
    expect(() => buildCommand({ exePath: '', modelPath: '', values: {} })).toThrow('Server executable path is not configured');
  });

  it('throws when executable does not exist', () => {
    expect(() => buildCommand({ exePath: '/non/existent/llama-server', modelPath: '', values: {} })).toThrow('Server executable does not exist');
  });
});

describe('buildCommand - enabled mechanism', () => {
  // 启用状态以 JSON 字符串形式编码到 values['_enabled'] 中
  function withEnabled(values: Record<string, string | number | boolean>, enabledMap: Record<string, boolean>) {
    return { ...values, _enabled: JSON.stringify(enabledMap) };
  }

  it('skips params when _enabled exists and param is not enabled', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: withEnabled({ ctx_size: 4096, port: 9090 }, { ctx_size: false, port: false }),
    });
    // 未启用 → 全部跳过，使用 llama-server 内置默认值
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('includes params when _enabled exists and param is enabled', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: withEnabled({ ctx_size: 4096, port: 9090 }, { ctx_size: true, port: true }),
    });
    expect(cmd).toEqual([EXE_PATH, '--port', '9090', '-c', '4096']);
  });

  it('mixes enabled and disabled params', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: withEnabled({ ctx_size: 4096, port: 9090 }, { ctx_size: true, port: false }),
    });
    // 仅 ctx_size 启用，port 未启用被跳过
    expect(cmd).toEqual([EXE_PATH, '-c', '4096']);
  });

  it('treats all params as enabled when _enabled missing (backward compat)', () => {
    // 旧预设无 _enabled 字段，parseEnabled 返回 null，全部视为启用
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 4096, port: 9090 },
    });
    expect(cmd).toEqual([EXE_PATH, '--port', '9090', '-c', '4096']);
  });

  it('ignores malformed _enabled JSON (treats as all enabled)', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 4096, _enabled: 'not-json' },
    });
    expect(cmd).toEqual([EXE_PATH, '-c', '4096']);
  });

  it('emits explicitly enabled param even when value equals default', () => {
    // 用户显式启用的参数即使值等于默认值也应生成到命令行
    // 场景：spec_draft_n_max 默认值=3，用户启用并设为 3
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: withEnabled(
        { spec_type: 'draft-mtp', spec_draft_n_max: 3, spec_draft_n_min: 0 },
        { spec_type: true, spec_draft_n_max: true, spec_draft_n_min: true },
      ),
    });
    expect(cmd).toEqual([
      EXE_PATH,
      '--spec-type', 'draft-mtp',
      '--spec-draft-n-max', '3',
      '--spec-draft-n-min', '0',
    ]);
  });

  it('skips empty dropdown/text/file values even when enabled', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: withEnabled(
        { spec_type: '', alias: '', mmproj: '' },
        { spec_type: true, alias: true, mmproj: true },
      ),
    });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('emits baseline memory params when enabled (cache_type q8_0 / load-mode none / fit off)', () => {
    // 对应 store 初始化即启用的 BASELINE_ENABLED_KEYS：值等于默认也发射（显式启用）
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: 'model.gguf',
      values: withEnabled(
        { cache_type_k: 'q8_0', cache_type_v: 'q8_0', load_mode: 'none', fit: 'off' },
        { cache_type_k: true, cache_type_v: true, load_mode: true, fit: true },
      ),
    });
    // 发射顺序遵循 PARAMS 定义：basic memory 的 --load-mode/--fit 在前，advanced kv_cache 的 -ctk/-ctv 在后
    expect(cmd).toEqual([
      EXE_PATH, '-m', 'model.gguf',
      '--load-mode', 'none',
      '--fit', 'off',
      '-ctk', 'q8_0',
      '-ctv', 'q8_0',
    ]);
  });
});

describe('quoteArg', () => {
  it('does not quote plain strings', () => {
    expect(quoteArg('foo')).toBe('foo');
  });

  it('quotes strings containing spaces', () => {
    expect(quoteArg('hello world')).toBe('"hello world"');
  });

  it('escapes double quotes', () => {
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('formatCommand', () => {
  it('joins quoted arguments with spaces', () => {
    expect(formatCommand([EXE_PATH, '-m', 'my model.gguf'])).toBe(`${quoteArg(EXE_PATH)} -m "my model.gguf"`);
  });
});

describe('previewCommand', () => {
  it('formats full command from settings and values', () => {
    const preview = previewCommand({
      values: { model: 'm.gguf', ctx_size: 2048, port: 8081 },
      settings: baseSettings,
    });
    expect(preview).toBe(`${quoteArg(EXE_PATH)} -m m.gguf --port 8081 -c 2048`);
  });
});
