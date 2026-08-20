import { findDevSessionRoot, killProcessTree } from './dist/process.js';
import { writeFileSync } from 'node:fs';
try {
  const root = findDevSessionRoot();
  let killed = false;
  if (root) killed = killProcessTree(root);
  writeFileSync('D:/DEV/llama_launcher/packages/core/live_result.json',
    JSON.stringify({ root, killed, ok: true }));
} catch (e) {
  writeFileSync('D:/DEV/llama_launcher/packages/core/live_result.json',
    JSON.stringify({ error: String((e && e.stack) || e) }));
}
