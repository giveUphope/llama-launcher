// shared 命令展示层纯函数（tokenizeArgs / quoteArg / formatCommand / formatCommandLines）。
// 发射规则本身（buildArgv）由 command-builder.test.ts 守；这里守的是**展示/复制**侧：
// 命令预览卡的「复制 = 单行 formatCommand」与「预览框 = formatCommandLines」都从同一份
// argv 出发，切分/引号处理一旦分叉，用户复制出去的命令就无法在 shell 里原样执行。
import { describe, it, expect } from 'vitest';
import { tokenizeArgs, quoteArg, formatCommand, formatCommandLines } from '@llama-launcher/shared';

describe('tokenizeArgs（扩展参数词法切分）', () => {
  it('按空白切分，丢弃首尾空白', () => {
    expect(tokenizeArgs('--verbose  --no-mmap')).toEqual(['--verbose', '--no-mmap']);
    expect(tokenizeArgs('  -a   ')).toEqual(['-a']);
  });

  it('双引号包裹的值保留内部空格', () => {
    expect(tokenizeArgs('--model "my dir/a b.gguf"')).toEqual(['--model', 'my dir/a b.gguf']);
  });

  it('引号内 \\" 转义为字面引号', () => {
    expect(tokenizeArgs('"a\\"b"')).toEqual(['a"b']);
  });

  it('空引号对产生空串参数（有意传空值的形态）', () => {
    // 引号切换即 has=true："" 不是被丢弃的空白，而是一个空参数
    expect(tokenizeArgs('""')).toEqual(['']);
  });

  it('未闭合引号：剩余部分并入最后一个参数（宽容处理，不抛错）', () => {
    expect(tokenizeArgs('-a "b c')).toEqual(['-a', 'b c']);
  });

  it('空串/纯空白输入得空数组', () => {
    expect(tokenizeArgs('')).toEqual([]);
    expect(tokenizeArgs('   ')).toEqual([]);
  });
});

describe('quoteArg / formatCommand（复制用单行形态）', () => {
  it('含空格或引号的参数加双引号，内部引号转义', () => {
    expect(quoteArg('a b')).toBe('"a b"');
    expect(quoteArg('a"b')).toBe('"a\\"b"');
    expect(quoteArg('--plain')).toBe('--plain');
  });

  it('formatCommand 用单空格连接各段，含空格参数整体加引号', () => {
    expect(formatCommand(['exe', '-m', 'my dir/m.gguf', '--verbose'])).toBe('exe -m "my dir/m.gguf" --verbose');
  });
});

describe('formatCommandLines（预览框一行一个参数形态）', () => {
  it('exe 独占首行；flag 起一行缩进两格；flag 后的非 flag 值并到同一行', () => {
    expect(formatCommandLines(['exe', '-m', 'm.gguf', '-c', '4096'])).toBe(
      ['exe', '  -m m.gguf', '  -c 4096'].join('\n'),
    );
  });

  it('含空格的值并行时加引号，不破坏一行一参结构', () => {
    const lines = formatCommandLines(['exe', '-m', 'my dir/m.gguf']).split('\n');
    expect(lines).toEqual(['exe', '  -m "my dir/m.gguf"']);
  });

  it('连续 flag 各占一行；空 argv 得空串', () => {
    expect(formatCommandLines(['exe', '--a', '--b'])).toBe(['exe', '  --a', '  --b'].join('\n'));
    expect(formatCommandLines([])).toBe('');
  });
});
