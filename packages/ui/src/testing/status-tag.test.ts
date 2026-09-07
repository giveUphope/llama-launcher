// @vitest-environment happy-dom
// 迁移组件渲染（DOM 环境）：验证已 Arco 化的 StatusTag 在 happy-dom 下以真实 a-tag 渲染，
// 证明 Arco 组件在组件测试环境可挂载。
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import StatusTag from '@/components/common/StatusTag.vue';

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