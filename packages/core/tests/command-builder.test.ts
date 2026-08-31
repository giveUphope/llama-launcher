import { describe, it, expect } from 'vitest';
import { buildCommand, quoteArg, formatCommand, previewCommand, tokenizeArgs } from '../src/command-builder.js';
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
  close_behavior: 'ask',
  sidebar_collapsed: false,
  language: 'zh',
  last_tab: '',
  custom_args: '',
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
    // spec_type 原始值 'draft-model' 被映射为 'draft-simple'；
    // spec_draft_model 依赖 spec_type ∈ 外部草稿类型，使用映射后的 'draft-simple' 判定依赖满足
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

  it('skips gpu_layers when value equals default ("auto")', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { gpu_layers: 'auto' },
    });
    expect(cmd).toEqual([EXE_PATH]);
  });

  it('emits gpu_layers when non-default', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { gpu_layers: '99' },
    });
    expect(cmd).toEqual([EXE_PATH, '-ngl', '99']);
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

describe('buildCommand - default-skip semantics', () => {
  it('skips params whose value equals the param default', () => {
    // spec_draft_n_max 默认=3、spec_draft_n_min 默认=0 → 均不发射
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { spec_type: 'draft-mtp', spec_draft_n_max: 3, spec_draft_n_min: 0 },
    });
    expect(cmd).toEqual([EXE_PATH, '--spec-type', 'draft-mtp']);
  });

  it('emits non-default values and skips defaults together', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 4096, port: 8080 },
    });
    // port 8080=默认不发射，ctx_size 4096 非默认发射
    expect(cmd).toEqual([EXE_PATH, '-c', '4096']);
  });

  it('ignores legacy _enabled field (backward compat)', () => {
    // 旧预设文件可能残留 _enabled 字段；构建命令时忽略，行为等同于"值非默认即发射"
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: { ctx_size: 4096, port: 9090, _enabled: JSON.stringify({ ctx_size: false, port: false }) },
    });
    expect(cmd).toEqual([EXE_PATH, '--port', '9090', '-c', '4096']);
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

  it('includeCustomArgs:false 预览不含扩展参数（内置命令框用）', () => {
    const preview = previewCommand({
      values: { model: 'm.gguf' },
      settings: { ...baseSettings, custom_args: '--no-warmup' },
      includeCustomArgs: false,
    });
    expect(preview).toBe(`${quoteArg(EXE_PATH)} -m m.gguf`);
  });
});

describe('tokenizeArgs / customArgs 扩展参数', () => {
  it('tokenizeArgs 按空白切分并支持双引号含空格值', () => {
    expect(tokenizeArgs('--a 1 --b "x y" -c')).toEqual(['--a', '1', '--b', 'x y', '-c']);
    expect(tokenizeArgs('  ')).toEqual([]);
    expect(tokenizeArgs('')).toEqual([]);
  });

  it('buildCommand 把 customArgs 追加到内置参数末尾', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: 'm.gguf',
      values: { ctx_size: 2048 },
      customArgs: '--override-kv tokenizer.ggml.add_bos_token=bool:false --no-warmup',
    });
    expect(cmd).toEqual([EXE_PATH, '-m', 'm.gguf', '-c', '2048', '--override-kv', 'tokenizer.ggml.add_bos_token=bool:false', '--no-warmup']);
  });

  it('customArgs 含带空格引号值时作为单个 argv 元素', () => {
    const cmd = buildCommand({
      exePath: EXE_PATH,
      modelPath: '',
      values: {},
      customArgs: '--chat-template "a b"',
    });
    expect(cmd).toEqual([EXE_PATH, '--chat-template', 'a b']);
  });

  it('空/纯空白 customArgs 不追加', () => {
    const cmd = buildCommand({ exePath: EXE_PATH, modelPath: 'm.gguf', values: {}, customArgs: '   ' });
    expect(cmd).toEqual([EXE_PATH, '-m', 'm.gguf']);
  });
});
