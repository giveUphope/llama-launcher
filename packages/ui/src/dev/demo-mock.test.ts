// 浏览器 mock 的参数预览与真实启动命令同源校验。
// 为什么单独有这份测试：mock 环境没有 node 文件系统，拿不到 core 的 buildCommand，
// 于是 demo-mock 曾自带一份「简化版」发射逻辑——用界面初值当发射基准，结果服务页预览
// 少发启动器的 5 个基线推荐值（`--load-mode none` / `--fit off` / `-ctk` / `-ctv`），
// 而真实启动是另一套规则。发射逻辑现已收敛到 shared/params/command.ts，这里钉住
// 「预览里的值真会进命令行」这一用户可见结论，副本若再长出来即失败。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PARAMS, argvFromPreviewOptions, buildArgv } from '@llama-launcher/shared';
import type { AppSettings, PresetValues, ModelInfo, ModelParams, AppLogEntry, ServerStatus } from '@llama-launcher/shared';
import { createDemoApi } from './demo-mock';

const EXE = 'D:/Models/llama-bins/llama-server.exe';
const MODEL = 'D:/Models/Qwen3-32B/Qwen3-32B.gguf';

const settings: AppSettings = {
  server_exe: EXE,
  llama_dir: 'D:/Models/llama-bins',
  models_dir: 'D:/Models',
  selected_model: MODEL,
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
describe('demo-mock 参数预览', () => {
  // createDemoApi() 会挂日志回放定时器；用假时钟拦住，避免测试进程被悬挂句柄拖住
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function preview(values: PresetValues, s: AppSettings = settings): Promise<string[]> {
    const api = createDemoApi() as unknown as {
      server: { previewCommand: (v: PresetValues, st: AppSettings) => Promise<{ ok: boolean; data: string[] }> };
    };
    const res = await api.server.previewCommand(values, s);
    expect(res.ok).toBe(true);
    return res.data;
  }

  it('初值态把启动器的基线推荐值发给引擎', async () => {
    const t = await preview(defaultValues());
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
    const t = await preview(defaultValues());
    // chat_template 初值 'none' 既是默认也是哨兵：命令行里不该出现它（后端用模型元数据模板）
    expect(t).not.toContain('--chat-template');
    // -c 初值 0 / -np 初值 -1 同理
    expect(t).not.toContain('-c');
    expect(t).not.toContain('-np');
  });

  it('手改值照原样进命令，扩展参数不进内置命令框', async () => {
    // 20 ≠ 引擎缺省 40 → 必须发射（初值 40 恰好也是引擎缺省，见上一条用例的不发射）
    const t = await preview(defaultValues({ top_k: 20 }));
    expect(t).toContain('--top-k');
    expect(t[t.indexOf('--top-k') + 1]).toBe('20');
    // 与真实侧一致：SERVER_PREVIEW 传 includeCustomArgs:false，扩展参数只进完整命令
    const withExtra = await preview(defaultValues(), { ...settings, custom_args: '--override-me' });
    expect(withExtra).not.toContain('--override-me');
  });

  it('预览与 shared 发射实现逐字相等（防 mock 另抄一套）', async () => {
    const values = defaultValues({ flash_attn: 'on', ngl: 99 });
    const expected = buildArgv(argvFromPreviewOptions({ values, settings, includeCustomArgs: false }));
    expect(await preview(values)).toEqual(expected);
  });
});

// 首次使用空态开关（`?fresh=1`）：mock 的预填数据全部归零，用来目测「刚装好什么都没配」的界面。
// 双向都要钉：空态漏出预填 = 看不到首次使用的问题；默认态被改成空 = e2e 的
// app.spec.ts（演示模型列表 / running 状态卡）判据连带作废，而红的是测试不是产品。
describe('demo-mock 首次使用空态开关', () => {
  /** 只声明本组用例要读的 API 面，避免与 mock 的完整返回类型耦合 */
  type DemoApiSlice = {
    settings: { load: () => Promise<AppSettings> };
    models: { scan: (dir: string) => Promise<ModelInfo[]> };
    modelParams: { load: (p: string) => Promise<ModelParams | null> };
    logs: { list: () => Promise<AppLogEntry[]> };
    server: {
      getStatus: () => Promise<{ status: ServerStatus; pid: number | null; readyAt: number | null }>;
      start: (values: never, settings: never) => Promise<{ ok: boolean }>;
      stop: () => Promise<{ ok: boolean }>;
      onOutputBatch: (cb: (entries: unknown[]) => void) => () => void;
    };
    system: {
      findLlamaExe: () => Promise<string>;
      detectTrash: () => Promise<{ items: unknown[]; totalSize: number }>;
      benchLlamaStatus: (p: string) => Promise<unknown>;
      estimateModelFit: (paths: string[], dtype?: string) => Promise<Record<string, unknown>>;
      estimateVram: (p: string, dtype?: string, target?: string) => Promise<{
        devices: unknown[]; occupancy: unknown; recommendations: unknown[];
      }>;
    };
  };

  // FRESH 在模块求值时读 URL，所以「设 window → resetModules → 重新 import」才换得了模式。
  // 本文件默认 node 环境（无 window），此处给一个最小桩：mock 只读 location.search。
  async function demoApiWithSearch(search: string): Promise<DemoApiSlice> {
    (globalThis as unknown as { window?: unknown }).window = { location: { search } };
    vi.resetModules();
    const { createDemoApi: create } = await import('./demo-mock');
    return create() as unknown as DemoApiSlice;
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('带 ?fresh=1 时预填数据全部归空', async () => {
    const api = await demoApiWithSearch('?fresh=1');
    const s = await api.settings.load();
    expect([s.server_exe, s.llama_dir, s.models_dir, s.selected_model]).toEqual(['', '', '', '']);
    expect(s.last_tab).toBe('');
    expect(await api.models.scan('')).toEqual([]);
    expect(await api.modelParams.load(MODEL)).toBeNull();
    expect(await api.logs.list()).toEqual([]);
    expect(await api.system.findLlamaExe()).toBe('');
    expect(await api.system.detectTrash()).toEqual({ items: [], totalSize: 0 });
    const st = await api.server.getStatus();
    expect(st.status).toBe('stopped');
    expect(st.pid).toBeNull();
    expect(st.readyAt).toBeNull();
    // 没有模型文件时与 core handler 的早退同形：不探设备、不发建议、不出占用
    const vram = await api.system.estimateVram(MODEL, 'q8_0', 'balanced');
    expect(vram.devices).toEqual([]);
    expect(vram.occupancy).toBeNull();
    expect(vram.recommendations).toEqual([]);
    // 体检历史预置与显存适配徽章同样不外泄
    expect(await api.system.benchLlamaStatus(MODEL)).toBeNull();
    expect(await api.system.estimateModelFit([MODEL])).toEqual({});
  });

  it('不带 ?fresh 时预填照常（e2e 判据依赖演示模型列表与 running 状态卡）', async () => {
    const api = await demoApiWithSearch('');
    const models = await api.models.scan('');
    expect(models.length).toBeGreaterThan(0);
    expect((await api.logs.list()).length).toBeGreaterThan(0);
    expect((await api.server.getStatus()).status).toBe('running');
    // 预置的那条体检记录 = 演示「重启后记录仍在」这条路径，只此一条
    const records = await Promise.all(models.map((m) => api.system.benchLlamaStatus(m.path)));
    expect(records.filter(Boolean).length).toBe(1);
    expect(Object.keys(await api.system.estimateModelFit([MODEL]))).toEqual([MODEL]);
  });

  // 喂送时机是本轮唯一「跨模式」的行为改动（此前建 mock 就起定时器，与服务状态无关），
  // 所以空态与填充态两条都要断言——布局判据顶替不了状态机断言。
  it('空态控制台初始零行：启动后才回放引擎输出，停服随即收口', async () => {
    const api = await demoApiWithSearch('?fresh=1');
    const rows: string[] = [];
    api.server.onOutputBatch((entries) => { for (const e of entries) rows.push(JSON.stringify(e)); });
    vi.advanceTimersByTime(10_000);
    expect(rows, '服务没跑起来时控制台不该有引擎行').toEqual([]);

    await api.server.start({} as never, {} as never);
    vi.advanceTimersByTime(2_000); // starting → running（1200ms）+ 启动序列回放
    expect(rows.length).toBeGreaterThan(0);

    await api.server.stop();
    const seen = rows.length;
    vi.advanceTimersByTime(20_000);
    expect(rows.length, '已停止的服务不该继续往控制台打字').toBe(seen);
  });

  it('非空态仍按周期喂送（logs-scroll 的持续增长判据依赖它）', async () => {
    const api = await demoApiWithSearch('');
    const rows: string[] = [];
    api.server.onOutputBatch((entries) => { for (const e of entries) rows.push(JSON.stringify(e)); });
    vi.advanceTimersByTime(6_300); // 300ms 预喂 + 5 行启动回放 + 两次 2.5s 周期
    expect(rows.length).toBeGreaterThan(5);
  });
});
