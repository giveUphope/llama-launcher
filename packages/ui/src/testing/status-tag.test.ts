// @vitest-environment happy-dom
// 迁移组件渲染（DOM 环境）：验证已 Arco 化的 StatusTag 在 happy-dom 下以真实 a-tag 渲染，
// 证明 Arco 组件在组件测试环境可挂载。
// 状态→颜色映射的边界判据（详见下方用例）：Arco Tag 只认 13 个预设物理色名，语义名
// （success/warning/danger）会落进 custom-color 分支渲染成不可读的浅灰——映射必须落在预设色名上。
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import StatusTag from '@/components/common/StatusTag.vue';

function mountTag(status: string) {
  return mount(StatusTag, {
    props: { status, label: `L(${status})` },
    global: { plugins: [ArcoVue] },
  });
}

describe('StatusTag（Arco a-tag 渲染，happy-dom）', () => {
  it('渲染状态标签文本与 arco-tag 结构', () => {
    const w = mount(StatusTag, {
      props: { status: 'ok', label: '运行中' },
      global: { plugins: [ArcoVue] },
    });
    expect(w.text()).toContain('运行中');
    expect(w.find('.arco-tag').exists()).toBe(true);
  });
});

describe('StatusTag - 状态→预设色映射边界', () => {
  // 每种业务状态必须落在 Arco 预设物理色名上（类名 arco-tag-<color> 即预设色分支的标志；
  // 落进 custom-color 分支的 tag 没有此类名，深浅主题下都会渲染成不可读的浅灰）
  const cases: Array<[string, string]> = [
    ['ok', 'arco-tag-green'],
    ['warn', 'arco-tag-orange'],
    ['error', 'arco-tag-red'],
    ['loading', 'arco-tag-arcoblue'],
  ];
  it.each(cases)('status=%s 落在预设色 %s（不进 custom-color 分支）', (status, expectedClass) => {
    const w = mountTag(status);
    expect(w.find('.arco-tag').classes(), `status=${status} 必须带预设色类名`).toContain(expectedClass);
    w.unmount();
  });

  it('未知状态兜底灰色，不抛错也不落 custom-color', () => {
    // 主进程新增枚举而前端漏映射时，宁可灰也不炸/不可读
    const w = mountTag('future-status');
    expect(w.find('.arco-tag').classes()).toContain('arco-tag-gray');
    w.unmount();
  });

  it('loading 态渲染加载转圈；非 loading 态没有', () => {
    const loading = mountTag('loading');
    expect(loading.find('.arco-spin').exists(), 'loading 必须有转圈，光靠文字分不清「在启动」和「卡住了」').toBe(
      true,
    );
    loading.unmount();

    const stopped = mountTag('ok');
    expect(stopped.find('.arco-spin').exists()).toBe(false);
    stopped.unmount();
  });
});