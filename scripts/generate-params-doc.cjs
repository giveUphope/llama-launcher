const fs = require('node:fs');
const path = require('node:path');

const HELP_FILE = path.join(__dirname, '..', 'docs', 'params', 'llama-server-help-out.txt');
const DEFS_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'params', 'definitions.ts');
const OUT_FILE = path.join(__dirname, '..', 'docs', 'params', 'LLAMA_SERVER_PARAMS.md');

const helpText = fs.readFileSync(HELP_FILE, 'utf8');
const defsText = fs.readFileSync(DEFS_FILE, 'utf8');

// Extract supported flags from definitions.ts (including invert_flag aliases)
const supportedFlags = new Set();
for (const m of defsText.matchAll(/flag:\s*'([^']+)'/g)) {
  supportedFlags.add(m[1]);
}
for (const m of defsText.matchAll(/invert_flag:\s*'([^']+)'/g)) {
  supportedFlags.add(m[1]);
}

// Preprocess help text: merge continuation lines into their preceding flag line
const rawLines = helpText.split(/\r?\n/);
const mergedLines = [];
let currentLine = '';

for (const rawLine of rawLines) {
  const trimmed = rawLine.trim();
  if (!trimmed || /^-----\s+.+\s+-----$/.test(trimmed)) {
    if (currentLine) {
      mergedLines.push(currentLine);
      currentLine = '';
    }
    mergedLines.push(rawLine);
    continue;
  }

  if (/^-[a-zA-Z0-9?-]|^--[a-zA-Z0-9_-]/.test(trimmed)) {
    // New parameter line
    if (currentLine) {
      mergedLines.push(currentLine);
    }
    currentLine = rawLine;
  } else if (currentLine) {
    // Continuation of previous parameter description
    currentLine += ' ' + trimmed;
  }
}
if (currentLine) mergedLines.push(currentLine);

// Parse help text into sections and params
const sections = [];
let currentSection = null;

for (const line of mergedLines) {
  const sectionMatch = line.match(/^-----\s+(.+?)\s+-----$/);
  if (sectionMatch) {
    currentSection = { title: sectionMatch[1], params: [] };
    sections.push(currentSection);
    continue;
  }
  if (!currentSection) continue;

  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith('[')) continue;

  // Parse flag part and description
  const paramMatch = trimmed.match(/^((?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)(?:,\s+(?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+))*(?:\s+[A-Z_<>\'"\[\]{}|]+)?)\s+(.*)$/);
  if (paramMatch) {
    const leftPart = paramMatch[1].trim();
    const descPart = paramMatch[2].trim();
    // Split left part by comma/space and keep only whole dash-prefixed tokens
    // (avoids matching "-hi" inside "lo-hi")
    const tokens = leftPart.split(/[,\s]+/).filter(Boolean);
    const flags = tokens.filter(t => /^(-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)$/.test(t));
    if (flags.length > 0) {
      const primaryFlag = flags.find(f => f.startsWith('--')) || flags[0];
      currentSection.params.push({
        flags,
        primaryFlag,
        description: descPart,
        supported: flags.some(f => supportedFlags.has(f)),
      });
    }
  }
}

// Build markdown
let md = `# llama-server 启动参数对照文档

> 来源：捆绑二进制 ".\\llama-b10734-bin-win-vulkan-x64\\llama-server.exe --help"
> 用途：对照当前启动器已支持参数，识别可新增/调整项

## 当前启动器已支持参数

当前参数定义位于 [packages/shared/src/params/definitions.ts](../../packages/shared/src/params/definitions.ts)。

`;

for (const section of sections) {
  md += `## ${section.title}\n\n`;
  md += '| 参数 | 说明 | 状态 |\n';
  md += '|------|------|------|\n';
  for (const p of section.params) {
    const status = p.supported ? '✅ 已支持' : '⬜ 未支持';
    const flagCell = '`' + p.flags.join('`, `') + '`';
    md += `| ${flagCell} | ${p.description.replace(/\|/g, '\\|')} | ${status} |\n`;
  }
  md += '\n';
}

// Summary
const totalParams = sections.reduce((sum, s) => sum + s.params.length, 0);
const supportedParams = sections.reduce((sum, s) => sum + s.params.filter(p => p.supported).length, 0);
md += `## 汇总\n\n- 官方参数总数：${totalParams}\n- 已支持：${supportedParams}\n- 未支持：${totalParams - supportedParams}\n`;

fs.writeFileSync(OUT_FILE, md, 'utf8');
console.log(`Generated ${OUT_FILE}`);
console.log(`Total: ${totalParams}, Supported: ${supportedParams}, Missing: ${totalParams - supportedParams}`);
