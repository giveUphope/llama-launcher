const fs = require('node:fs');
const path = require('node:path');

const HELP_FILE = path.join(__dirname, '..', 'docs', 'params', 'llama-server-help-out.txt');
const DEFS_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'params', 'definitions.ts');
// 输出路径见文件末尾 LANGS 表（中英成对产出）

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
  const paramMatch = trimmed.match(/^((?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)(?:,\s+(?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+))*(?:\s+[A-Z_<>'"[\]{}|]+)?)\s+(.*)$/);
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

// Build markdown — 一次运行同时产出中英两份（成对生成，避免只刷一种语言造成漂移）
const DEFS_LINK = '../../../packages/shared/src/params/definitions.ts';
const LANGS = {
  zh: {
    out: path.join(__dirname, '..', 'docs', 'zh', 'params', 'LLAMA_SERVER_PARAMS.md'),
    head: `# llama-server 启动参数对照文档

> 语言：中文 · [English](../../en/params/LLAMA_SERVER_PARAMS.md)
> 索引：[README.md](../../../README.md) · 相关：[params-system.md](../params-system.md)
> 来源：捆绑二进制 ".\\llama-b11053-bin-win-vulkan-x64\\llama-server.exe --help"
> 用途：对照当前启动器已支持参数，识别可新增/调整项

## 当前启动器已支持参数

当前参数定义位于 [packages/shared/src/params/definitions.ts](${DEFS_LINK})。
`,
    tableHead: '| 参数 | 说明 | 状态 |',
    tableSep: '|------|------|------|',
    yes: '✅ 已支持',
    no: '⬜ 未支持',
    summary: (t, s) => `## 汇总\n\n- 官方参数总数：${t}\n- 已支持：${s}\n- 未支持：${t - s}\n`,
  },
  en: {
    out: path.join(__dirname, '..', 'docs', 'en', 'params', 'LLAMA_SERVER_PARAMS.md'),
    head: `# llama-server Startup Parameter Reference

> Language: English · [中文](../../zh/params/LLAMA_SERVER_PARAMS.md)
> Index: [README.en.md](../../../README.en.md) · Related: [params-system.md](../params-system.md)
> Source: bundled binary ".\\llama-b11053-bin-win-vulkan-x64\\llama-server.exe --help"
> Purpose: cross-check the parameters this launcher already supports and spot gaps

## Parameters supported today

Parameter definitions live in [packages/shared/src/params/definitions.ts](${DEFS_LINK}).
`,
    tableHead: '| Parameter | Description | Status |',
    tableSep: '|------|------|------|',
    yes: '✅ supported',
    no: '⬜ not supported',
    summary: (t, s) => `## Summary\n\n- Flags in official help: ${t}\n- Supported: ${s}\n- Not supported: ${t - s}\n`,
  },
};

for (const lang of Object.keys(LANGS)) {
  const cfg = LANGS[lang];
  let md = cfg.head + '\n';
  for (const section of sections) {
    md += `## ${section.title}\n\n`;
    md += cfg.tableHead + '\n';
    md += cfg.tableSep + '\n';
    for (const p of section.params) {
      const status = p.supported ? cfg.yes : cfg.no;
      const flagCell = '`' + p.flags.join('`, `') + '`';
      md += `| ${flagCell} | ${p.description.replace(/\|/g, '\\|')} | ${status} |\n`;
    }
    md += '\n';
  }
  const totalParams = sections.reduce((sum, s) => sum + s.params.length, 0);
  const supportedParams = sections.reduce((sum, s) => sum + s.params.filter((p) => p.supported).length, 0);
  md += cfg.summary(totalParams, supportedParams);
  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  fs.writeFileSync(cfg.out, md, 'utf8');
  console.log(`Generated [${lang}] ${path.relative(path.join(__dirname, '..'), cfg.out)}`);
}
console.log(`Total: ${sections.reduce((s, x) => s + x.params.length, 0)}, Supported: ${sections.reduce((s, x) => s + x.params.filter((p) => p.supported).length, 0)}`);
