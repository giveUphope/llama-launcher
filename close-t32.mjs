import fs from 'node:fs';

const entry = '- **fix(ui): 「没截断就不该弹回声气泡」收口到 ToolTip（新 prop `overflowOnly`）——全站六处回声提示统一（用户第二次批注，关闭 TODO T32）**：出了什么事——T30 只在参数摘要里治好了这一条，用户随即在概览页服务状态卡抓到同一缺陷：API 地址 `http://127.0.0.1:9931` 全量看得见，悬停却还是弹同一句话。**改法**：① 判定上收到全站唯一提示通道 `ToolTip.vue`——新增 `overflowOnly`，组件自己量插槽首元素的 `scrollWidth > clientWidth + 1`（+1 防亚像素误判），未截断时把 `a-tooltip` 的 `disabled` 置真；`ParamSummaryCard` 里那份本地测量代码（`truncatedVals` / `measureTruncated` / resize 监听与 activate/deactivate 配对）随之删除，同一类判定只留一处实现；② 挂上 `overflow-only` 的六处回声提示：摘要 chip 值、下载卡 URL 历史与任务文件名、服务状态卡模型名与 API 地址、清理卡失败路径；③ **明确不开**的边界写进规范：凡是浮层携带界面上看不到的信息的调用点（模型名 → 完整路径、文件名 → 完整路径、短句 → 完整长句、归一文案 → 后端原始 error、以及一切动作提示）按截断关闭等于删功能；`ServiceStatusCard` 的 API 地址格另有一态提示的是「发现外部实例」那句话，故该处的 `overflow-only` 按那一态取 false。**测试面**：新增 `packages/ui/src/components/common/ToolTip.test.ts`（三态：截断 ⇒ 不 disabled、未截断 ⇒ disabled、不开关 ⇒ 恒不 disabled）；`ParamSummaryCard.test.ts` 改读**内层 `a-tooltip` 的 disabled**（判定已下沉到 ToolTip，读组件自己的 prop 等于没测）；新增 `e2e/web/overflow-tip.spec.ts` 两条互为对照（概览页未截断的 API 地址悬停零气泡、服务页被截断的模型路径悬停恰一只且内容 = 完整值）。**踩到的两个坑（已写进 spec 注释）**：① 浮层节点在**生产构建里没有 `role="tooltip"`**（dev 有），用它选得到恒 0，得用 `.arco-tooltip:visible`；② 从侧栏点进服务页后摘要 chip 会随模型参数集异步载回**重渲染一次**，指针刚好停在旧节点上时 mouseenter 丢一次不补（实测第一次 hover 弹不出、第二次正常），故判据统一走「等落定 → 移开 → 悬停 → 轮询」。**验证**：preview 产物真鼠标实测两态符合预期；`pnpm lint` / `pnpm test`（core 41 文件 567 + ui **24 文件 241**）/ `pnpm e2e:web` **104 条**（102+2）/ `pnpm style:audit` 退出码全 0；双语 `frontend.md` §7.5.6 新增边界条、双语 `testing.md` 判据清单与计数同步。';

const jobs = [
  // 计数：ui 23 文件 238 → 24 文件 241
  ['AGENTS.md', '23 个测试文件 / 238 用例', '24 个测试文件 / 241 用例'],
  ['AGENTS.md', '2026-10-11 mock 对齐轮按实跑校准（core 567：+1 alwaysEmit 判据；ui 23 文件 238：+ParamSummaryCard 4 条、+fileExists 同源 1 条）', '2026-10-11 回声气泡收口轮按实跑校准（core 567；ui 24 文件 241：+ToolTip.test 3 条、+ParamSummaryCard 4 条、+fileExists 同源 1 条）'],
  ['docs/zh/testing.md', 'ui **23** 个测试文件 / **238** 个用例', 'ui **24** 个测试文件 / **241** 个用例'],
  ['docs/zh/testing.md', '2026-10-11 mock 对齐轮按实跑校准', '2026-10-11 回声气泡收口轮按实跑校准'],
  ['docs/en/testing.md', 'ui **23** test files / **238** cases', 'ui **24** test files / **241** cases'],
  ['docs/en/testing.md', 'calibrated against an actual run in the mock-alignment round, 2026-10-11', 'calibrated against an actual run in the echo-tooltip round, 2026-10-11'],
  // 组件测试表补 ToolTip.test 一行
  [
    'docs/zh/testing.md',
    '| `src/components/service/ParamSummaryCard.test.ts`',
    '| `src/components/common/ToolTip.test.ts` | 统一提示浮层的 `overflowOnly`：量出截断才不 disabled、未截断必须 disabled、不开关时恒不 disabled（动作提示与信息补充型提示不得被牵连） |\n| `src/components/service/ParamSummaryCard.test.ts`',
  ],
  [
    'docs/en/testing.md',
    '| `src/components/service/ParamSummaryCard.test.ts`',
    '| `src/components/common/ToolTip.test.ts` | The shared tooltip\'s `overflowOnly`: enabled only when truncation is measured, disabled while the text fits, and never disabled when the flag is off (action hints and information-carrying tooltips must not be affected) |\n| `src/components/service/ParamSummaryCard.test.ts`',
  ],
  // 判据清单：把 overflow-tip 登记进 e2e 那一行（zh / en 各一处）
  [
    'docs/zh/testing.md',
    '。五类判据都配删除实验。',
    '另有**回声气泡判据**（概览页未截断的 API 地址悬停零气泡、服务页被截断的模型路径悬停恰一只且内容 = 完整值，两条互为对照；浮层节点在生产构建里没有 `role="tooltip"`，只能选 `.arco-tooltip:visible`，`e2e/web/overflow-tip.spec.ts`）。五类判据都配删除实验。',
  ],
  [
    'docs/en/testing.md',
    '。All five families carry deletion experiments.',
    'There are also **echo-tooltip judgments** (hovering the untruncated API address on the overview yields zero popups, while hovering the ellipsised model path on the service page yields exactly one whose content equals the full value — the two cases cross-check each other; the popup node carries no `role="tooltip"` in the production build, so only `.arco-tooltip:visible` selects it — `e2e/web/overflow-tip.spec.ts`). All five families carry deletion experiments.',
  ],
];

for (const [file, oldText, newText] of jobs) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(oldText)) {
    console.error('未匹配 ' + file + ' :: ' + oldText.slice(0, 45));
    process.exit(1);
  }
  fs.writeFileSync(file, s.replace(oldText, newText));
}

// CHANGELOG 插入
const cp = 'docs/CHANGELOG.md';
const raw = fs.readFileSync(cp, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const i = lines.findIndex((l) => l.trim().startsWith('## ') && l.includes('[0.0.68] - 2026-10-10'));
if (i < 0) { console.error('0.0.68 标题未找到'); process.exit(1); }
lines.splice(i, 0, entry, '');
fs.writeFileSync(cp, lines.join(eol));

// TODO 关闭 T32
const tp = 'docs/TODO.md';
const traw = fs.readFileSync(tp, 'utf8');
const teol = traw.includes('\r\n') ? '\r\n' : '\n';
const tl = traw.split(/\r?\n/);
const s0 = tl.findIndex((l) => l.startsWith('### T32 '));
if (s0 < 0) { console.error('T32 未找到'); process.exit(1); }
let e0 = s0 + 1;
while (e0 < tl.length && !/^#{2,3} /.test(tl[e0])) e0++;
if (!tl.slice(s0, e0).join('').includes('overflowOnly')) { console.error('待删块非预期'); process.exit(1); }
let t0 = e0;
while (t0 < tl.length && tl[t0].trim() === '') t0++;
tl.splice(s0, t0 - s0);
while (tl.length && tl[tl.length - 1].trim() === '') tl.pop();
fs.writeFileSync(tp, tl.join(teol) + teol);
console.log('CHANGELOG 已记条目；TODO 关闭 T32；计数与判据清单已同步');
