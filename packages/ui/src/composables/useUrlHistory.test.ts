import { describe, it, expect, beforeEach } from 'vitest';
import { useUrlHistory } from './useUrlHistory';

describe('useUrlHistory（模块级单例会话历史）', () => {
  const { urlHistory, rememberUrl, clearUrlHistory } = useUrlHistory();

  beforeEach(() => {
    clearUrlHistory();
  });

  it('trim 后记入；空白输入忽略', () => {
    rememberUrl('  https://a.example/x  ');
    expect(urlHistory.value).toEqual(['https://a.example/x']);
    rememberUrl('   ');
    rememberUrl('');
    expect(urlHistory.value).toHaveLength(1);
  });

  it('去重且最新在前：重复提交移到最前', () => {
    rememberUrl('u1');
    rememberUrl('u2');
    rememberUrl('u1');
    expect(urlHistory.value).toEqual(['u1', 'u2']);
  });

  it('上限 10 条，超出丢弃最旧', () => {
    for (let i = 1; i <= 12; i++) rememberUrl(`u${i}`);
    expect(urlHistory.value).toHaveLength(10);
    expect(urlHistory.value[0]).toBe('u12');
    expect(urlHistory.value[9]).toBe('u3');
    expect(urlHistory.value).not.toContain('u1');
  });

  it('跨调用点共享同一状态（模拟子标签 v-if 重建组件后历史保留）', () => {
    rememberUrl('shared');
    // 新「组件实例」再次 useUrlHistory()：读到的是同一份模块级状态
    const second = useUrlHistory();
    expect(second.urlHistory.value).toEqual(['shared']);
    second.rememberUrl('from-second');
    expect(urlHistory.value).toEqual(['from-second', 'shared']);
  });
});
