// 浏览器 mock 的参数预览与真实启动命令同源校验。
// 为什么单独有这份测试：mock 环境没有 node 文件系统，拿不到 core 的 buildCommand，
// 于是 demo-mock 曾自带一份「简化版」发射逻辑——用界面初值当发射基准，结果服务页预览
// 少发启动器的 4 个基线推荐值（`--load-mode none` / `--fit off` / `-ctk` / `-ctv`），
// 而真实启动是另一套规则。发射逻辑现已收敛到 shared/params/command.ts，这里钉住
// 「预览里的值真会进命令行」这一用户可见结论，副本若再长出来即失败。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PARAMS, argvFromPreviewOptions, buildArgv, formatCommand } from '@llama-launcher/shared';
import type { AppSettings, PresetValues } from '@llama-launcher/shared';
import { createDemoApi } from './demo-mock';

const EXE = 'D:/Models/llama-bins/llama-server.exe';
const MODEL = 'D:/Models/Qwen3-32B/Qwen3-32B.gguf';

const settings: AppSettings = {
  server_exe: EXE,
  llama_dir: 'D:/Models/llama-bins',
  models_dir: 'D:/Models',
  selected_model: MODEL,
  last_preset: '',
  window_geometry: '1280x800',
  window_maximized: true,
  theme_mode: 'dark',
  close_behavior: 'ask',
  sidebar_collapsed: false,
  language: 'zh',
  last_tab: '',
  download_max_concurrent: 3,
  custom_args: '',
};

/** 界面初值（未手改任何参数）——正是此前"等于默认就不发射"判定失效的场景 */
function defaultValues(overrides: PresetValues = {}): PresetValues {
  const values: PresetValues = { model: MODEL };
  for (const p of PARAMS) values[p.key] = p.default;
  return { ...values, ...overrides };
}

/** 命令行 token 序列（预览是一整串，按空白切分后逐项比对更稳） */
function tokens(cmd: string): string[] {
  return cmd.split(' ').filter(Boolean);
}

describe('demo-mock 参数预览', () => {
  // createDemoApi() 会挂日志回放定时器；用假时钟拦住，避免测试进程被悬挂句柄拖住
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function preview(values: PresetValues, s: AppSettings = settings): Promise<string> {
    const api = createDemoApi() as unknown as {
      server: { previewCommand: (v: PresetValues, st: AppSettings) => Promise<{ ok: boolean; data: string }> };
    };
    const res = await api.server.previewCommand(values, s);
    expect(res.ok).toBe(true);
    return res.data;
  }

  it('初值态把启动器的基线推荐值发给引擎', async () => {
    const t = tokens(await preview(defaultValues()));
    expect(t).toContain('--load-mode');
    expect(t).toContain('none');
    expect(t).toContain('--fit');
    expect(t).toContain('-ctk');
    expect(t).toContain('-ctv');
    // checkbox 恒发射：取消勾选的也发 invert_flag
    expect(t).toContain('--no-context-shift');
    // 反之等于引擎缺省的值不发：top_k 初值 40 恰好也是引擎缺省
    expect(t).not.toContain('--top-k');
  });

  it('哨兵值不发射，把决定权留给引擎', async () => {
    const t = tokens(await preview(defaultValues()));
    // chat_template 初值 'none' 既是默认也是哨兵：命令行里不该出现它（后端用模型元数据模板）
    expect(t).not.toContain('--chat-template');
    // -c 初值 0 / -np 初值 -1 同理
    expect(t).not.toContain('-c');
    expect(t).not.toContain('-np');
  });

  it('手改值照原样进命令，扩展参数不进内置命令框', async () => {
    // 20 ≠ 引擎缺省 40 → 必须发射（初值 40 恰好也是引擎缺省，见上一条用例的不发射）
    const t = tokens(await preview(defaultValues({ top_k: 20 })));
    expect(t).toContain('--top-k');
    expect(t[t.indexOf('--top-k') + 1]).toBe('20');
    // 与真实侧一致：SERVER_PREVIEW 传 includeCustomArgs:false，扩展参数只进完整命令
    const withExtra = await preview(defaultValues(), { ...settings, custom_args: '--override-me' });
    expect(withExtra).not.toContain('--override-me');
  });

  it('预览与 shared 发射实现逐字相等（防 mock 另抄一套）', async () => {
    const values = defaultValues({ flash_attn: 'on', ngl: 99 });
    const expected = formatCommand(
      buildArgv(argvFromPreviewOptions({ values, settings, includeCustomArgs: false })),
    );
    expect(await preview(values)).toBe(expected);
  });
});
