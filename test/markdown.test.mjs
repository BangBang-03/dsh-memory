/**
 * dsh-memory 既有记忆读取层测试（lib/markdown.js）。
 *   node test/markdown.test.mjs
 *
 * 样例文本照着机器上真实文件的结构写：WorkBuddy 的工作区笔记 / 每日日志、
 * Qoder 的 frontmatter 记忆，以及本插件自己的镜像。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  IMPORT_FORMATS,
  FORMAT_LABELS,
  detectFormat,
  parseFrontmatter,
  parseMemoryText,
  parseMemoryFile,
  memorySourceSpecs,
  scanMemorySources,
} = await import('../lib/markdown.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err && err.message}`);
  }
}

console.log('\ndsh-memory markdown tests\n');

const WORKBUDDY_NOTE = `# dsh 工作区 — 项目长期笔记

## dsh-client-ui-quote（用户的 DSH 客户端插件）

- 仓库在 \`C:\\Users\\15812\\Desktop\\dsh\\dsh-client-ui-quote\`，MIT。
- 无构建步骤，\`lib/client.js\` 是 vendor-CJS 工厂。

## 环境坑

- asar 内路径不能用 \`Test-Path\` 探测。
- 改 profile 的 package.json 之前必须先备份。
`;

const WORKBUDDY_DAILY = `# 2026-10-10

## 记忆插件开工

- 定了三条设计：用户级存储、自动+显式捕获、注入+检索。

## 修掉镜像缺陷

- 镜像一直写在主库目录，改成真的落到工作区 \`.dsh-memory/MEMORY.md\`。
`;

const QODER_USER = `---
name: user-delivery-expectations
description: 用户与交付期望
metadata:
  type: user
---

**期望的交付深度：** 要真训权重 + 实测指标。

**决策风格：** 先给结论再给证据。
`;

const QODER_REF = `---
name: dsh-deepseek-harness-env
description: dsh（DeepSeek Harness）环境
metadata:
  type: reference
---

桌面版装在 \`D:\\DSH\`，数据与 CLI 都在 \`~\\.dsh\`。
`;

/* ---------------- 识别 ---------------- */

test('detectFormat：有 frontmatter 且带 name 判为 qoder', () => {
  assert.equal(detectFormat(QODER_USER), 'qoder');
});

test('detectFormat：二级标题 + 日期 H1 判为 daily', () => {
  assert.equal(detectFormat(WORKBUDDY_DAILY), 'daily');
});

test('detectFormat：二级标题 + 普通 H1 判为 workbuddy', () => {
  assert.equal(detectFormat(WORKBUDDY_NOTE), 'workbuddy');
});

test('detectFormat：空文本与无结构文本落到 text', () => {
  assert.equal(detectFormat(''), 'text');
  assert.equal(detectFormat('   \n  '), 'text');
  assert.equal(detectFormat('就一句话'), 'text');
});

test('detectFormat：只有 frontmatter 的引用式写法也能认出来', () => {
  assert.equal(detectFormat('---\nname: "x"\ndescription: y\n---\n\n正文\n'), 'qoder');
});

/* ---------------- frontmatter ---------------- */

test('parseFrontmatter：顶层键、缩进键与引号都处理', () => {
  const meta = parseFrontmatter('name: "a-b"\ndescription: hello\nmetadata:\n  type: user\n');
  assert.equal(meta.name, 'a-b');
  assert.equal(meta.description, 'hello');
  assert.equal(meta['metadata.type'], 'user');
});

test('parseFrontmatter：注释行被忽略，不产生键', () => {
  const meta = parseFrontmatter('# 注释\nname: x\n');
  assert.deepEqual(Object.keys(meta), ['name']);
});

/* ---------------- WorkBuddy 笔记 ---------------- */

test('parseMemoryText：每个二级标题一条记录', () => {
  const { format, records } = parseMemoryText(WORKBUDDY_NOTE);
  assert.equal(format, 'workbuddy');
  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'dsh-client-ui-quote（用户的 DSH 客户端插件）');
  assert.match(records[0].content, /dsh-client-ui-quote/);
  assert.match(records[1].content, /Test-Path/);
});

test('parseMemoryText：H1 与前言不会变成记录', () => {
  const { records } = parseMemoryText(WORKBUDDY_NOTE);
  assert.ok(!records.some((r) => r.title.includes('项目长期笔记')));
});

test('parseMemoryText：每条都带 workbuddy 标签且 source=import', () => {
  const { records } = parseMemoryText(WORKBUDDY_NOTE);
  for (const record of records) {
    assert.ok(record.tags.includes('workbuddy'), `缺 workbuddy 标签: ${record.tags}`);
    assert.equal(record.source, 'import');
    assert.equal(record.category, 'note');
  }
});

test('parseMemoryText：正文里的 #标签 会被收集', () => {
  const { records } = parseMemoryText('# t\n\n## 主题\n\n- 用了 #性能 和 #缓存 两处\n');
  assert.ok(records[0].tags.includes('性能'));
  assert.ok(records[0].tags.includes('缓存'));
  assert.ok(records[0].tags.includes('workbuddy'));
});

test('parseMemoryText：## 标题本身不会被当成标签', () => {
  const { records } = parseMemoryText('# t\n\n## 一个标题\n\n正文\n');
  assert.deepEqual(records[0].tags, ['workbuddy']);
});

test('parseMemoryText：没有二级标题时整篇算一条', () => {
  const { format, records } = parseMemoryText('# 只有一层\n\n- 甲\n- 乙\n');
  assert.equal(format, 'workbuddy');
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '只有一层');
  assert.match(records[0].content, /甲/);
});

test('parseMemoryText：空小节被丢掉，不留空记录', () => {
  const { records } = parseMemoryText('# t\n\n## 有内容\n\n正文\n\n## 空的\n\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '有内容');
});

/* ---------------- 每日日志 ---------------- */

test('parseMemoryText：日志按事件拆条并带上日期与 log 标签', () => {
  const { format, records } = parseMemoryText(WORKBUDDY_DAILY);
  assert.equal(format, 'daily');
  assert.equal(records.length, 2);
  assert.equal(records[0].title, '记忆插件开工');
  assert.ok(records[0].tags.includes('log'));
  assert.ok(records[0].tags.includes('2026-10-10'));
});

test('parseMemoryText：日志标题里的日期只取到日', () => {
  const { records } = parseMemoryText('# 2026-10-10T12:30\n\n## 事件\n\n正文\n');
  assert.ok(records[0].tags.includes('2026-10-10'));
});

/* ---------------- Qoder ---------------- */

test('parseMemoryText：Qoder 用 description 当标题、type 映射类别', () => {
  const { format, records } = parseMemoryText(QODER_USER);
  assert.equal(format, 'qoder');
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '用户与交付期望');
  assert.equal(records[0].category, 'user', 'v0.3.0 起 Qoder 的 user 类型直通原生类别');
  assert.ok(records[0].tags.includes('qoder'));
  assert.ok(records[0].tags.includes('user'));
  assert.ok(records[0].tags.includes('user-delivery-expectations'));
});

test('parseMemoryText：reference 类型映射成 fact', () => {
  const { records } = parseMemoryText(QODER_REF);
  assert.equal(records[0].category, 'fact');
  assert.equal(records[0].title, 'dsh（DeepSeek Harness）环境');
});

test('parseMemoryText：Qoder 正文不含 frontmatter', () => {
  const { records } = parseMemoryText(QODER_USER);
  assert.doesNotMatch(records[0].content, /^---/);
  assert.doesNotMatch(records[0].content, /metadata/);
  assert.match(records[0].content, /期望的交付深度/);
});

test('parseMemoryText：没有 description 时用 name 当标题', () => {
  const { records } = parseMemoryText('---\nname: only-name\n---\n\n正文\n');
  assert.equal(records[0].title, 'only-name');
});

/* ---------------- 纯文本 ---------------- */

test('parseMemoryText：纯文本按空行分段、首行当标题', () => {
  const { format, records } = parseMemoryText('标题甲\n正文甲\n\n标题乙\n正文乙\n');
  assert.equal(format, 'text');
  assert.equal(records.length, 2);
  assert.equal(records[0].title, '标题甲');
  assert.match(records[0].content, /正文甲/);
});

test('parseMemoryText：单行段落不重复正文', () => {
  const { records } = parseMemoryText('就一行');
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '就一行');
  assert.equal(records[0].content, '就一行');
});

/* ---------------- 参数与边界 ---------------- */

test('parseMemoryText：显式指定格式时不再自动识别', () => {
  const auto = parseMemoryText(WORKBUDDY_NOTE);
  const forced = parseMemoryText(WORKBUDDY_NOTE, { format: 'text' });
  assert.equal(forced.format, 'text');
  assert.notEqual(forced.records.length, auto.records.length);
  // 走纯文本路径时 H1 那一行自己成段，标题是剥掉 # 之后的内容。
  assert.equal(forced.records[0].title, 'dsh 工作区 — 项目长期笔记');
});

test('parseMemoryText：maxRecords 生效', () => {
  const many = ['# t', ...Array.from({ length: 30 }, (_, i) => `## 第 ${i} 条\n\n正文`)].join('\n');
  const { records } = parseMemoryText(many, { maxRecords: 4 });
  assert.equal(records.length, 4);
});

test('parseMemoryText：非字符串输入不抛错', () => {
  assert.deepEqual(parseMemoryText(null).records, []);
  assert.deepEqual(parseMemoryText(undefined).records, []);
  assert.deepEqual(parseMemoryText(12345).records.length, 0);
});

test('parseMemoryText：标签去重并限长', () => {
  const text = '# t\n\n## s\n\n用了 #perf #perf #cache\n';
  const { records } = parseMemoryText(text);
  assert.equal(records[0].tags.filter((tag) => tag === 'perf').length, 1);
  assert.ok(records[0].tags.length <= 12);
});

test('parseMemoryText：单字符 #a 这种噪声不当标签', () => {
  const { records } = parseMemoryText('# t\n\n## s\n\n用了 #a 和 #perf\n');
  assert.ok(!records[0].tags.includes('a'));
  assert.ok(records[0].tags.includes('perf'));
});

test('IMPORT_FORMATS 与 FORMAT_LABELS 一一对应', () => {
  for (const format of IMPORT_FORMATS) {
    assert.ok(FORMAT_LABELS[format], `缺标签: ${format}`);
  }
  assert.equal(Object.keys(FORMAT_LABELS).length, IMPORT_FORMATS.length);
});

/* ---------------- 读文件与扫描 ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-markdown-'));
const workspace = path.join(tmp, 'proj');
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(workspace, '.workbuddy', 'memory'), { recursive: true });
fs.mkdirSync(path.join(home, '.qoder', 'memory'), { recursive: true });
fs.mkdirSync(path.join(home, '.workbuddy', 'memory'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.workbuddy', 'memory', 'MEMORY.md'), WORKBUDDY_NOTE, 'utf8');
fs.writeFileSync(path.join(workspace, '.workbuddy', 'memory', '2026-10-10.md'), WORKBUDDY_DAILY, 'utf8');
fs.writeFileSync(path.join(home, '.qoder', 'memory', 'user-delivery-expectations.md'), QODER_USER, 'utf8');
fs.writeFileSync(path.join(home, '.qoder', 'memory', 'MEMORY.md'), '- [甲](a.md) — 说明\n', 'utf8');
fs.writeFileSync(path.join(home, '.workbuddy', 'memory', '3fd_memory.md'), '# 用户画像\n\n## 习惯\n\n- 喜欢先看结论\n', 'utf8');

test('parseMemoryText：小节里用 **粗体** 当子标题时会再切一层', () => {
  const text = [
    '# User Memory Profile',
    '',
    '## Memory Block',
    '',
    '**工作背景**',
    '做量化策略。',
    '',
    '**个人背景**',
    '偏好结构化输出。',
    '',
    '**当前关注**',
    '记忆插件。',
    '',
  ].join('\n');
  const { records } = parseMemoryText(text);
  assert.deepEqual(records.map((r) => r.title), ['工作背景', '个人背景', '当前关注']);
  assert.match(records[0].content, /量化策略/);
});

test('parseMemoryText：只有一个粗体行时不当子标题切', () => {
  const text = '# t\n\n## s\n\n**注意**\n\n正文。\n';
  const { records } = parseMemoryText(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 's');
});

test('parseMemoryText：Qoder 目录里的索引页不会被当成记忆文件格式', () => {
  const index = '- [用户与交付期望](user-delivery-expectations.md) — 要真跑的权重\n- [环境](env.md) — 桌面版装在 D:\\DSH\n';
  assert.equal(detectFormat(index), 'text');
});

test('scanMemorySources：Qoder 的索引页被剔除，只留带 frontmatter 的记忆文件', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-home-'));
  const dir = path.join(home, '.qoder', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [A](a.md) — 索引页\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: a\ndescription: A 记忆\n---\n\n正文\n', 'utf8');
  const { sources } = scanMemorySources({ workspace: '', home });
  const qoder = sources.find((source) => source.id === 'user-qoder');
  assert.deepEqual(qoder.files.map((file) => file.name), ['a.md']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('parseMemoryFile：Qoder 文件名参与标题兜底', () => {
  const file = path.join(home, '.qoder', 'memory', 'user-delivery-expectations.md');
  const { format, records } = parseMemoryFile(file);
  assert.equal(format, 'qoder');
  assert.equal(records[0].title, '用户与交付期望');
});

test('memorySourceSpecs：工作区两个 + 用户级两个', () => {
  const specs = memorySourceSpecs({ workspace, home });
  assert.deepEqual(specs.map((s) => s.id).sort(), [
    'dsh-memory-mirror',
    'user-qoder',
    'user-workbuddy',
    'workspace-workbuddy',
  ]);
  assert.equal(specs.find((s) => s.id === 'user-qoder').scope, 'global');
  assert.equal(specs.find((s) => s.id === 'workspace-workbuddy').scope, 'workspace');
});

test('memorySourceSpecs：没有工作区时只剩用户级', () => {
  const specs = memorySourceSpecs({ workspace: '', home });
  assert.deepEqual(specs.map((s) => s.id), ['user-workbuddy', 'user-qoder']);
});

test('scanMemorySources：列出文件、格式与条数预览', () => {
  const { sources } = scanMemorySources({ workspace, home });
  const ws = sources.find((s) => s.id === 'workspace-workbuddy');
  assert.equal(ws.exists, true);
  assert.equal(ws.files.length, 2);
  const note = ws.files.find((f) => f.name === 'MEMORY.md');
  assert.equal(note.format, 'workbuddy');
  assert.equal(note.records, 2);
  assert.equal(note.preview[0], 'dsh-client-ui-quote（用户的 DSH 客户端插件）');
  const daily = ws.files.find((f) => f.name === '2026-10-10.md');
  assert.equal(daily.format, 'daily');
  assert.equal(daily.records, 2);
  assert.ok(daily.bytes > 0);
  assert.equal(daily.error, null);
});

test('scanMemorySources：不存在的工作区镜像报告 exists=false 而不是抛错', () => {
  const { sources } = scanMemorySources({ workspace, home });
  const mirror = sources.find((s) => s.id === 'dsh-memory-mirror');
  assert.equal(mirror.exists, false);
  assert.deepEqual(mirror.files, []);
});

test('scanMemorySources：空的 home 也不抛错', () => {
  const { sources } = scanMemorySources({ workspace: '', home: path.join(tmp, 'nope') });
  assert.equal(sources.length, 2);
  for (const source of sources) {
    assert.equal(source.exists, false);
    assert.deepEqual(source.files, []);
  }
});

test('scanMemorySources：扫描是只读的，不会改动来源文件', () => {
  const file = path.join(workspace, '.workbuddy', 'memory', 'MEMORY.md');
  const before = fs.readFileSync(file, 'utf8');
  scanMemorySources({ workspace, home });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

/* ---------------- 出口 ---------------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
