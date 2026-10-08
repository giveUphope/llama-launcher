import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DownloadProgressPayload, DownloadTask } from '@llama-launcher/shared';
import { useDownloadStore } from './download';

// —— window.api.download 桩：捕获 onProgress 回调；resume 返回值可编程 ——
// 此前本 store 无专项单测，「清除已完成吞掉 paused」「resume 被后端拒绝仍置 queued」
// 两个状态机缺口（B1/G2）正是无测试的盲区
type ProgressCb = (p: DownloadProgressPayload) => void;
let progressCb: ProgressCb = () => {};
let resumeResult: { ok: true; data: boolean } | { ok: false; error: string } = { ok: true, data: true };
const resumeMock = vi.fn();

function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 't1',
    modelId: 'ns/name',
    filePath: 'f.gguf',
    fileName: 'f.gguf',
    totalSize: 1000,
    downloadedSize: 0,
    speed: 0,
    status: 'queued',
    source: 'modelscope',
    localPath: '',
    partPath: '',
    error: '',
    errorType: null,
    createdAt: 1,
    completedAt: null,
    ...overrides,
  };
}

function emitProgress(overrides: Partial<DownloadProgressPayload> = {}) {
  progressCb({
    id: 't1',
    downloadedSize: 500,
    totalSize: 1000,
    speed: 42,
    status: 'downloading',
    ...overrides,
  } as DownloadProgressPayload);
}

beforeEach(() => {
  setActivePinia(createPinia());
  progressCb = () => {};
  resumeResult = { ok: true, data: true };
  resumeMock.mockReset().mockImplementation(async () => resumeResult);
  vi.stubGlobal('window', {
    api: {
      download: {
        onProgress: (cb: ProgressCb) => {
          progressCb = cb;
          return () => {};
        },
        onComplete: () => () => {},
        onError: () => () => {},
        pause: async () => ({ ok: true, data: true }),
        resume: resumeMock,
        cancel: async () => ({ ok: true, data: true }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('download store 清除已结束任务（B1）', () => {
  it('清除 completed/canceled/error，保留 paused——paused 在 core 侧仍可恢复，清掉即孤儿任务', () => {
    const store = useDownloadStore();
    store.addTask(makeTask({ id: 'done', status: 'completed', downloadedSize: 1000 }));
    store.addTask(makeTask({ id: 'canceled', status: 'canceled' }));
    store.addTask(makeTask({ id: 'err', status: 'error', error: 'x' }));
    store.addTask(makeTask({ id: 'paused', status: 'paused', downloadedSize: 300 }));
    store.addTask(makeTask({ id: 'downloading' }));
    store.addTask(makeTask({ id: 'queued' }));

    store.clearFinished();

    const ids = store.tasks.map((t) => t.id);
    expect(ids).toEqual(['paused', 'downloading', 'queued']);
  });
});

describe('download store 恢复被后端拒绝时不再乐观翻转（G2）', () => {
  it('resume 返回 true：行置 queued 并清错误', async () => {
    const store = useDownloadStore();
    store.addTask(makeTask({ id: 't1', status: 'error', error: 'boom' }));
    await store.resumeTask('t1');
    expect(store.tasks[0].status).toBe('queued');
    expect(store.tasks[0].error).toBe('');
  });

  it('resume 返回 false（后端拒绝）：状态保持原样，不渲染「永远排队中」', async () => {
    const store = useDownloadStore();
    store.addTask(makeTask({ id: 't1', status: 'paused', downloadedSize: 300 }));
    resumeResult = { ok: true, data: false };
    await store.resumeTask('t1');
    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(store.tasks[0].status).toBe('paused');
  });
});

describe('download store 进度静默门控（G3）', () => {
  it('静默期跳过高频进度应用，解除后下一帧自愈；取消移除不受门控影响', () => {
    const store = useDownloadStore();
    store.addTask(makeTask({ id: 't1' }));
    store.ensureSubscribed();

    emitProgress();
    expect(store.tasks[0].downloadedSize).toBe(500);

    // 面板失活：字节/速度/状态不再应用（隐藏行不重渲染）
    store.setProgressMuted(true);
    emitProgress({ downloadedSize: 800, speed: 7, status: 'paused' });
    expect(store.tasks[0].downloadedSize).toBe(500);
    expect(store.tasks[0].speed).toBe(42);

    // 取消移除是列表卫生，静默期照常
    emitProgress({ status: 'canceled' });
    expect(store.tasks.length).toBe(0);
  });

  it('解除静默后下一个进度帧即恢复应用', () => {
    const store = useDownloadStore();
    store.addTask(makeTask({ id: 't1' }));
    store.ensureSubscribed();

    store.setProgressMuted(true);
    emitProgress({ downloadedSize: 800 });
    expect(store.tasks[0].downloadedSize).toBe(0);

    store.setProgressMuted(false);
    emitProgress({ downloadedSize: 900 });
    expect(store.tasks[0].downloadedSize).toBe(900);
  });
});
