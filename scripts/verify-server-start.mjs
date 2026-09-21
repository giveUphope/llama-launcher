/**
 * 手动冒烟：真起一次 llama-server，验证 Launcher 的启动/监听判定/停止链路。
 * 不进 CI（需要本机有引擎与模型），用法：
 *   node scripts/verify-server-start.mjs [--model=<path.gguf>] [--port=18081]
 * 模型解析顺序：--model → 环境变量 LLAMA_SMOKE_MODEL → 设置里的 models_dir 中最小的 .gguf。
 * （原先此处硬编码了某台机器的绝对路径，换机/删模型即失效，故改为解析 + 明确报错。）
 */
import { Launcher, loadSettings, scanModels } from '../packages/core/dist/index.js';
import { PARAMS, DEFAULT_HOST } from '../packages/shared/dist/index.js';
import path from 'node:path';

// 冒烟专用端口：避开默认 8080，防止与开发中已在跑的服务抢端口
const SMOKE_PORT = 18081;
// running 后停留多久再停（够观察到监听判定与状态迁移）
const SMOKE_HOLD_MS = 3000;

const argv = process.argv.slice(2);
const argVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const settings = loadSettings();

/** 解析要加载的模型：显式参数 → 环境变量 → models_dir 中最小的 .gguf */
async function resolveModel() {
  const fromArg = argVal('model') || process.env.LLAMA_SMOKE_MODEL;
  if (fromArg) return path.resolve(fromArg);
  if (!settings.models_dir) return null;
  const models = await scanModels(settings.models_dir);
  const ggufs = models
    .filter((m) => m.path.toLowerCase().endsWith('.gguf'))
    .sort((a, b) => a.size - b.size);
  return ggufs[0]?.path ?? null;
}

const modelPath = await resolveModel();
if (!modelPath) {
  console.error(
    '[verify] 找不到可用模型：请传 --model=<path.gguf>、设置 LLAMA_SMOKE_MODEL，' +
      '或在应用设置里配置模型目录（当前 models_dir=' + (settings.models_dir || '未设置') + '）',
  );
  process.exit(1);
}

const values = Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));
values.model = modelPath;
values.host = DEFAULT_HOST;
values.port = Number(argVal('port')) || SMOKE_PORT;
values.ctx_size = 512;
values.gpu_layers = 0;
values.embedding = true;

const launcher = new Launcher();
let started = false;

launcher.on('output', (entry) => {
  process.stdout.write(entry.data);
});

launcher.on('status', (status) => {
  console.log(`[status] ${status}`);
  if (status === 'running') {
    started = true;
    console.log('[verify] server started successfully');
    setTimeout(() => {
      console.log('[verify] stopping server...');
      launcher.stop();
    }, SMOKE_HOLD_MS);
  }
});

launcher.on('exit', (code) => {
  console.log(`[verify] server exited with code ${code ?? 'unknown'}`);
  process.exit(started ? 0 : 1);
});

launcher.on('error', (err) => {
  console.error('[verify] error:', err.message);
});

console.log('[verify] starting server with model:', path.basename(modelPath));
launcher.start({ values, settings });
