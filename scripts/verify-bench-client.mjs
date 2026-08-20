// 性能测试端到端冒烟：启动真实 llama-server（--metrics），
// 用 Node http 客户端模拟 bench-client 的 fetchMetrics + runBench 逻辑，验证解析正确。
// 注意：真实 Electron net 模块仅在生产环境可用；此处用 node:http 验证协议与解析逻辑等价。
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';

const EXE = 'D:/DEV/llama_launcher/llama-b10502-bin-win-vulkan-x64/llama-server.exe';
// 需要真实存在的模型 + dflash 草稿模型
const MODEL = process.env.BENCH_MODEL || '';
const DRAFT = process.env.BENCH_DRAFT || '';
const PORT = 18181;

if (!MODEL || !existsSync(MODEL)) {
  console.error('需要真实模型：设置 BENCH_MODEL 环境变量指向 .gguf 模型（推荐 Muse-Glimmer 主模型）');
  console.error('可选 BENCH_DRAFT 指向 dflash-kquant.gguf');
  process.exit(1);
}

const args = [
  '-m', MODEL,
  '--port', String(PORT),
  '--host', '127.0.0.1',
  '--metrics',
  '--no-slots',
];
if (DRAFT && existsSync(DRAFT)) {
  args.push('--spec-type', 'draft-dflash', '--spec-draft-model', DRAFT, '--spec-draft-n-max', '15', '-fa', 'on');
}

console.log('启动 llama-server:', args.join(' '));
const proc = spawn(EXE, args, { windowsHide: true });
let started = false;

proc.stdout.on('data', (d) => process.stdout.write(`[out] ${d}`));
proc.stderr.on('data', (d) => {
  const s = String(d);
  process.stdout.write(`[err] ${s}`);
  if (s.includes('listening') && !started) {
    started = true;
    setTimeout(runTests, 1500);
  }
});
proc.on('exit', (code) => {
  console.log(`\nserver exited: ${code}`);
  process.exit(0);
});

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 复刻 bench-client 的 metrics 解析
function parseMetrics(text) {
  const valueOf = (name) => {
    const re = new RegExp(`^llamacpp:${name}\\s+([-+0-9.eE]+)`, 'm');
    const m = text.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    promptPerSecond: valueOf('prompt_tokens_seconds'),
    predictedPerSecond: valueOf('predicted_tokens_seconds'),
    draftAccepted: valueOf('spec_decode_num_accepted_tokens_total'),
    draftTotal: valueOf('spec_decode_num_draft_tokens_total'),
    nDecode: valueOf('n_decode_total'),
  };
}

async function runTests() {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('✅', name); } else { fail++; console.log('❌', name); } };

  // 1. /metrics 端点
  const metricsRes = await get('/metrics');
  check(`/metrics HTTP 200（实际 ${metricsRes.status}）`, metricsRes.status === 200);
  const metrics = parseMetrics(metricsRes.body);
  check('metrics 含 predicted_tokens_seconds', metrics.predictedPerSecond > 0 || metricsRes.body.includes('predicted_tokens_seconds'));
  check('metrics 含 spec_decode_num_draft_tokens_total', metricsRes.body.includes('spec_decode_num_draft_tokens_total'));
  console.log('  metrics:', JSON.stringify(metrics));

  // 2. 发测试请求
  const t0 = Date.now();
  const benchRes = await post('/v1/chat/completions', {
    model: 'bench',
    messages: [{ role: 'user', content: '请用中文解释推测解码的基本原理。' }],
    max_tokens: 128,
    stream: false,
  });
  check(`completion HTTP 200（实际 ${benchRes.status}）`, benchRes.status === 200);
  let body;
  try { body = JSON.parse(benchRes.body); } catch { body = null; }
  check('completion 返回 JSON', !!body);
  if (body?.timings) {
    const t = body.timings;
    console.log('  timings:', JSON.stringify(t));
    check('timings 含 predicted_per_second', typeof t.predicted_per_second === 'number' && t.predicted_per_second > 0);
    check(`timings 含 draft_n（DFlash 激活，实际 ${t.draft_n}）`, typeof t.draft_n === 'number');
    console.log(`  本次请求: ${t.predicted_per_second?.toFixed?.(2) ?? '?'} tok/s, draft=${t.draft_n ?? 0} accepted=${t.draft_n_accepted ?? 0}`);
  } else {
    check('timings 存在', false);
  }

  // 3. 测试后 metrics 的 DFlash 接受率
  const metrics2 = parseMetrics((await get('/metrics')).body);
  if (metrics2.draftTotal > 0) {
    const rate = metrics2.draftAccepted / metrics2.draftTotal;
    check(`metrics DFlash 接受率 = ${(rate * 100).toFixed(1)}%`, rate > 0 && rate <= 1);
  } else {
    console.log('  ⚠️ metrics 中尚无 draft 累计值（模型无 DFlash 或未配置草稿模型）');
  }

  // 4. 多并发场景：4 个并行请求，全部成功且聚合 tok/s 非零（复刻 runBenchConcurrent 的聚合语义）
  const t1 = Date.now();
  const concurrent = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      post('/v1/chat/completions', {
        model: 'bench',
        messages: [{ role: 'user', content: '请用中文解释推测解码的基本原理。' }],
        max_tokens: 128,
        stream: false,
      })),
  );
  const okRes = concurrent.filter((s) => s.status === 'fulfilled' && s.value.status === 200);
  check(`4 并发请求全部成功（实际 ${okRes.length}/4）`, okRes.length === 4);
  const aggTokS = okRes.reduce((sum, s) => {
    const t = JSON.parse(s.value.body)?.timings;
    return sum + (typeof t?.predicted_per_second === 'number' ? t.predicted_per_second : 0);
  }, 0);
  check(`并发聚合 tok/s > 0（实际 ${aggTokS.toFixed(2)}）`, aggTokS > 0);
  console.log(`  并发聚合: ${aggTokS.toFixed(2)} tok/s，墙钟 ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  console.log(`\n${pass} 通过 / ${fail} 失败（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  proc.kill();
  setTimeout(() => process.exit(fail ? 1 : 0), 1500);
}
