/**
 * 应用日志 store（appLog）：渲染层消费的应用生命周期日志行。
 * 守的判据与 server store 同源但独立成套：
 *  - 派生字段（id/时间串/着色类/搜索小写副本）在**入队时算一次**随行携带（frontend.md §7.1 铁律②），
 *    不得在渲染期逐行重算；
 *  - 缓冲截断：超过 APP_LOG_MAX_LINES 从头部裁掉（日志页渲染上限与缓冲上限同源，两处各写一个数
 *    曾出现「页面 RENDER_LIMIT 高于缓冲而永远触发不到的死余量」）；
 *  - 订阅防重入：重复 subscribe 不叠加监听（dev HMR 下 listener 累积会双份推送）；
 *  - 切语言重算已缓存行的时间串（Intl 结果与 locale 绑定）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AppLogEntry } from '@llama-launcher/shared';
import { useAppLogStore, APP_LOG_MAX_LINES, formatLogTime } from './appLog';

// ---- window.api.logs 桩：捕获推送回调与调用记录 ----
let logCb: ((e: AppLogEntry) => void) | null = null;
let listResult: AppLogEntry[] | null = null;
let listCalls = 0;
let onLogCalls = 0;
let clearCalls = 0;
let listShouldThrow = false;
let listReject = false;

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  logs: {
    // 「抛错」有两种形态，store 侧各有兜底：
    // ① 同步 throw（listShouldThrow，list() 调用当场炸）——subscribe 的 try/catch 兜
    //    （浏览器预览下 window.api.logs 直接 undefined，访问 .list 即同步 TypeError）；
    // ② 异步拒绝（listReject，返回 rejected promise）——promise 链上的 .catch 兜（T04：
    //    此前 `void list().then(...)` 没挂 catch，会以 Unhandled Rejection 把 vitest 进程
    //    退出码打成 1，恰是本文件曾长期带病运行的根因）。
    list: vi.fn((): Promise<AppLogEntry[] | null> => {
      listCalls++;
      if (listShouldThrow) throw new Error('no preload');
      if (listReject) return Promise.reject(new Error('history read failed'));
      return Promise.resolve(listResult);
    }),
    onLog: vi.fn((cb: (e: AppLogEntry) => void) => {
      onLogCalls++;
      logCb = cb;
    }),
    clear: vi.fn(async () => {
      clearCalls++;
    }),
  },
};

function entry(kind: AppLogEntry['kind'], data: string, ts = 1_700_000_000_000): AppLogEntry {
  return { kind, data, ts };
}

beforeEach(() => {
  vi.clearAllMocks();
  logCb = null;
  listResult = null;
  listCalls = 0;
  onLogCalls = 0;
  clearCalls = 0;
  listShouldThrow = false;
  listReject = false;
  setActivePinia(createPinia());
});

describe('appLog store - 入队派生字段（铁律②：渲染期零重算）', () => {
  it('推送后行自带 id/时间串/着色类/搜索小写副本', () => {
    const store = useAppLogStore();
    store.subscribe();
    logCb!(entry('error', 'Download FAILED'));
    expect(store.entries).toHaveLength(1);
    const line = store.entries[0];
    expect(line.id).toBe(1);
    expect(line.time, '时间串在入队时算好').toBe(formatLogTime(1_700_000_000_000, 'zh-CN'));
    expect(line.cls).toBe('kind-error');
    expect(line.lower, '搜索用小写副本在入队时算好').toBe('download failed');
  });

  it('级别着色映射齐全：warn/success/未知 kind 各归其类', () => {
    const store = useAppLogStore();
    store.subscribe();
    logCb!(entry('warn', 'w'));
    logCb!(entry('success', 's'));
    logCb!(entry('info', 'i'));
    // 未知 kind 走 default 分支（主进程新增枚举时界面不至于没有样式）
    logCb!(entry('future-kind' as AppLogEntry['kind'], 'f'));
    expect(store.entries.map((l) => l.cls)).toEqual(['kind-warn', 'kind-success', 'kind-info', 'kind-info']);
  });

  it('id 连续自增，空 data 也不炸（空串兜底）', () => {
    const store = useAppLogStore();
    store.subscribe();
    logCb!(entry('info', ''));
    logCb!(entry('info', 'x'));
    expect(store.entries.map((l) => l.id)).toEqual([1, 2]);
    expect(store.entries[0].lower).toBe('');
  });
});

describe('appLog store - 缓冲截断', () => {
  it('超过 APP_LOG_MAX_LINES 从头部裁掉，只留最新 N 条', () => {
    const store = useAppLogStore();
    store.subscribe();
    // 少量溢出：前 5 条被裁，其余保留且 id 连续
    for (let i = 0; i < APP_LOG_MAX_LINES + 5; i++) logCb!(entry('info', `line-${i}`));
    expect(store.entries).toHaveLength(APP_LOG_MAX_LINES);
    expect(store.entries[0].lower).toBe(`line-${5}`);
    expect(store.entries.at(-1)?.lower).toBe(`line-${APP_LOG_MAX_LINES + 4}`);
  });
});

describe('appLog store - 订阅与初始缓冲', () => {
  it('subscribe 拉一次缓冲并挂推送回调；重复调用不叠加监听', async () => {
    listResult = [entry('info', 'boot')];
    const store = useAppLogStore();
    store.subscribe();
    store.subscribe();
    // list/onLog 的注册都是同步的；初始缓冲是异步落地
    await vi.waitFor(() => expect(store.entries).toHaveLength(1));
    expect(listCalls).toBe(1);
    expect(onLogCalls, '防重入：第二次 subscribe 不得再挂一份监听').toBe(1);

    logCb!(entry('info', 'runtime'));
    expect(store.entries.map((l) => l.lower)).toEqual(['boot', 'runtime']);
  });

  it('本地已推的行不被快照冲掉：合并去重而不是整体替换（[params]/[mmproj] 概览闪失回归）', async () => {
    const store = useAppLogStore();
    // 渲染层本地先推（App.vue 启动即恢复模型，早于订阅与快照落地）
    store.push(entry('info', '[params] loaded'));
    store.push(entry('info', '[mmproj] not detected'));
    // 主进程缓冲快照里有新行，也有一条与本地重复的行（同 ts+data）
    listResult = [entry('info', '[params] loaded'), entry('info', 'Service start requested')];
    store.subscribe();
    await vi.waitFor(() => expect(store.entries.length).toBe(3));
    expect(store.entries.map((l) => l.lower)).toEqual([
      '[params] loaded',
      '[mmproj] not detected',
      'service start requested',
    ]);
  });

  it('初始缓冲超过上限时只留尾部 N 条', async () => {
    listResult = Array.from({ length: APP_LOG_MAX_LINES + 30 }, (_, i) => entry('info', `old-${i}`));
    const store = useAppLogStore();
    store.subscribe();
    await vi.waitFor(() => expect(store.entries.length).toBe(APP_LOG_MAX_LINES));
    expect(store.entries[0].lower).toBe('old-30');
  });

  it('list 同步抛错（无 preload）：整个订阅静默跳过，不炸也不产生条目', async () => {
    // 真实的「浏览器预览无 preload」环境里 window.api.logs 整个不存在——访问 .list 就同步 TypeError，
    // try 块当场中止：初始缓冲与推送订阅**一并**跳过（那里也没有任何事件源可挂），这正是
    // catch 分支的语义。钉住「不炸、无条目、不再挂监听」三个结果。
    const store = useAppLogStore();
    listShouldThrow = true;
    expect(() => store.subscribe()).not.toThrow();
    await vi.waitFor(() => expect(listCalls).toBe(1));
    expect(store.entries).toHaveLength(0);
    expect(onLogCalls, '初始缓冲取不到时订阅整体跳过（无 preload 环境也没有事件源）').toBe(0);
  });

  it('list 返回 null（浏览器 mock 环境）：初始缓冲为空，但推送订阅照常工作', async () => {
    listResult = null;
    const store = useAppLogStore();
    store.subscribe();
    await vi.waitFor(() => expect(listCalls).toBe(1));
    expect(store.entries).toHaveLength(0);
    logCb!(entry('info', 'after-null'));
    expect(store.entries.map((l) => l.lower)).toEqual(['after-null']);
  });

  it('list 异步拒绝（T04）：不产生 Unhandled Rejection，推送订阅照常工作', async () => {
    // 真实场景：主进程读历史日志文件失败（权限/磁盘），list() 以 rejected promise 落空。
    // store 必须吞掉这次初始拉取失败（无历史可补，live 推送不受影响），而不是把
    // Unhandled Rejection 抛给整个进程。
    listReject = true;
    const store = useAppLogStore();
    expect(() => store.subscribe()).not.toThrow();
    // 让被拒的 promise 走完微任务链；vitest 4 会把未处理的 rejection 记为测试失败，
    // 这里能跑过即证明 .catch 已兜住
    await Promise.resolve();
    await Promise.resolve();
    expect(listCalls).toBe(1);
    expect(store.entries).toHaveLength(0);
    expect(onLogCalls, '初始缓冲失败不得影响推送订阅的挂接').toBe(1);
    logCb!(entry('info', 'after-reject'));
    expect(store.entries.map((l) => l.lower)).toEqual(['after-reject']);
  });
});

describe('appLog store - 语言切换与清空', () => {
  it('setLocale 重算已缓存行的时间串；同语言/空语言是空操作', () => {
    const store = useAppLogStore();
    store.subscribe();
    logCb!(entry('info', 'x', 1_700_000_061_500));
    const zh = store.entries[0].time;
    expect(zh).toBe(formatLogTime(1_700_000_061_500, 'zh-CN'));

    store.setLocale('en-US');
    expect(store.entries[0].time, '切语言后缓存行的时间串必须重算').toBe(formatLogTime(1_700_000_061_500, 'en-US'));
    expect(store.entries[0].time).not.toBe(zh);

    // 同语言再设一次不得变动（Intl 重算一次全表不是免费的）
    const en = store.entries[0].time;
    store.setLocale('en-US');
    store.setLocale('');
    expect(store.entries[0].time).toBe(en);
  });

  it('clear 清空缓冲并通知主进程清盘', () => {
    const store = useAppLogStore();
    store.subscribe();
    logCb!(entry('info', 'x'));
    store.clear();
    expect(store.entries).toHaveLength(0);
    expect(clearCalls).toBe(1);
  });
});
