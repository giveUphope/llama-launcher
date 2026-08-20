import { Launcher } from '../packages/core/dist/launcher.js';
import { loadSettings } from '../packages/core/dist/settings-store.js';
import { PARAMS } from '../packages/shared/dist/index.js';
import path from 'node:path';

const modelPath = 'C:\\Users\\78557\\.lmstudio\\.internal\\bundled-models\\nomic-ai\\nomic-embed-text-v1.5-GGUF\\nomic-embed-text-v1.5.Q4_K_M.gguf';
const settings = loadSettings();

const values = Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));
values.model = modelPath;
values.host = '127.0.0.1';
values.port = 18081;
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
    }, 3000);
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
