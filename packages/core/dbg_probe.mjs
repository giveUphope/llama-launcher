import { findDevSessionRoot, killProcessTree } from './dist/process.js';
import { writeFileSync } from 'node:fs';
try {
  const root = findDevSessionRoot();
  let killed = false;
  if (root) killed = killProcessTree(root);
  writeFileSync('probe_result.json', JSON.stringify({ root, killed, self: process.pid, ok: true }));
} catch (e) {
  writeFileSync('probe_result.json', JSON.stringify({ error: String((e && e.stack) || e) }));
}
