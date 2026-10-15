/**
 * dsh-memory 画像层测试：段落模型 / Markdown 渲染与解析 / 预算截断 / 注入渲染。
 *   node test/portrait.test.mjs
 */

import assert from 'node:assert/strict';

const {
  PORTRAIT_SECTIONS,
  PORTRAIT_HISTORY_LIMIT,
  REWRITE_SYSTEM,
  sectionsFor,
  normalizeSections,
  parsePortraitMarkdown,
  renderPortraitMarkdown,
  clampPortraitToBudget,
  renderPortraitInjection,
  buildRewriteInput,
  parseRewriteResponse,
} = await import('../lib/portrait.js');

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

console.log('\ndsh-memory portrait tests\n');

const FOUR = [
  { key: 'background', text: '背景文字。' },
  { key: 'preference', text: '约定文字。' },
  { key: 'focus', text: '关注文字。' },
  { key: 'recent', text: '动态文字。' },
];

/* ---------------- 段落定义 ---------------- */

test('sectionsFor: 工作区四段标题固定', () => {
  assert.deepEqual(
    sectionsFor('workspace').map((s) => [s.key, s.title]),
    [
      ['background', '工作背景'],
      ['preference', '协作约定'],
      ['focus', '当前关注'],
      ['recent', '近期动态'],
    ],
  );
});

test('sectionsFor: 全局版第二段叫「个人背景」', () => {
  assert.equal(sectionsFor('global')[1].title, '个人背景');
});

test('PORTRAIT_SECTIONS: key 稳定且与 history 上限一起导出', () => {
  assert.deepEqual(PORTRAIT_SECTIONS.map((s) => s.key), ['background', 'preference', 'focus', 'recent']);
  assert.equal(PORTRAIT_HISTORY_LIMIT, 10);
});

/* ---------------- normalizeSections ---------------- */

test('normalize: 数组输入按 key 归一，缺失段补空', () => {
  const out = normalizeSections([{ key: 'focus', text: '  x  ' }]);
  assert.equal(out.length, 4);
  assert.equal(out.find((s) => s.key === 'focus').text, 'x');
  assert.equal(out.find((s) => s.key === 'background').text, '');
});

test('normalize: 按标题匹配（含「个人背景」→ preference）', () => {
  const out = normalizeSections([{ title: '个人背景', text: 'p' }], { scope: 'global' });
  assert.equal(out.find((s) => s.key === 'preference').text, 'p');
});

test('normalize: 未知段忽略、重复段只取第一个', () => {
  const out = normalizeSections([
    { key: 'focus', text: 'a' },
    { key: 'focus', text: 'b' },
    { key: 'nonsense', text: 'c' },
  ]);
  assert.equal(out.find((s) => s.key === 'focus').text, 'a');
  assert.ok(!out.some((s) => s.key === 'nonsense'));
});

test('normalize: {key: text} 对象形态也能归一', () => {
  const out = normalizeSections({ background: 'bg', recent: 're' });
  assert.equal(out.find((s) => s.key === 'background').text, 'bg');
  assert.equal(out.find((s) => s.key === 'recent').text, 're');
});

test('normalize: 超长段截断到 4000 字符', () => {
  const out = normalizeSections([{ key: 'background', text: 'x'.repeat(5000) }]);
  const text = out.find((s) => s.key === 'background').text;
  assert.ok(text.length <= 4000, `长度 ${text.length}`);
  assert.ok(text.endsWith('…'));
});

test('normalize: 空输入返回空四段', () => {
  const out = normalizeSections(null);
  assert.deepEqual(out.map((s) => s.text), ['', '', '', '']);
});

/* ---------------- parsePortraitMarkdown ---------------- */

test('parse: 从 **标题** 分段并识别四段', () => {
  const md = [
    '# 工作区画像 — dsh',
    '',
    '> 更新：2026-10-15 ｜ 版本：v1',
    '',
    '**工作背景**',
    '',
    '背景正文。',
    '',
    '**当前关注**',
    '',
    '关注正文。',
  ].join('\n');
  const parsed = parsePortraitMarkdown(md);
  assert.equal(parsed.scope, 'workspace');
  assert.equal(parsed.sections.find((s) => s.key === 'background').text, '背景正文。');
  assert.equal(parsed.sections.find((s) => s.key === 'focus').text, '关注正文。');
  assert.equal(parsed.sections.find((s) => s.key === 'preference').text, '');
});

test('parse: H1「全局画像」识别 scope', () => {
  const md = ['# 全局画像', '', '**工作背景**', '', 'g'].join('\n');
  assert.equal(parsePortraitMarkdown(md).scope, 'global');
});

test('parse: 无 H1 时按「个人背景」推断全局', () => {
  const md = ['**个人背景**', '', '偏好。'].join('\n');
  const parsed = parsePortraitMarkdown(md);
  assert.equal(parsed.scope, 'global');
  assert.equal(parsed.sections.find((s) => s.key === 'preference').text, '偏好。');
});

test('parse: 无任何已知段时返回 null', () => {
  assert.equal(parsePortraitMarkdown('# 随便一篇文档\n\n正文。'), null);
  assert.equal(parsePortraitMarkdown(''), null);
});

test('parse: 段标题必须独占一行，行内粗体不当标题', () => {
  const md = ['**工作背景** 前缀同行的粗体不切段', '', '正文。'].join('\n');
  assert.equal(parsePortraitMarkdown(md), null);
});

/* ---------------- renderPortraitMarkdown ---------------- */

test('render: 含版本头、段标题；空段不渲染', () => {
  const md = renderPortraitMarkdown({
    scope: 'workspace',
    version: 3,
    updatedAt: '2026-10-15T08:00:00.000Z',
    sections: [
      { key: 'background', text: 'B' },
      { key: 'focus', text: '' },
    ],
  }, { scopeLabel: 'dsh' });
  assert.match(md, /^# 工作区画像 — dsh/);
  assert.match(md, /版本：v3/);
  assert.match(md, /\*\*工作背景\*\*/);
  assert.ok(!md.includes('**当前关注**'), '空段不应渲染');
});

test('render: 全局版标题不带 slug', () => {
  const md = renderPortraitMarkdown({ scope: 'global', version: 1, sections: [{ key: 'background', text: 'B' }] });
  assert.match(md, /^# 全局画像\n/);
});

test('render → parse 往返：段文本保持一致', () => {
  const md = renderPortraitMarkdown({
    scope: 'workspace',
    version: 2,
    updatedAt: '2026-10-15T08:00:00.000Z',
    sections: FOUR,
  });
  const parsed = parsePortraitMarkdown(md);
  for (const s of FOUR) {
    assert.equal(parsed.sections.find((x) => x.key === s.key).text, s.text, s.key);
  }
});

/* ---------------- clampPortraitToBudget ---------------- */

test('clamp: 预算内全保留且不标截断', () => {
  const res = clampPortraitToBudget(FOUR, 2000);
  assert.equal(res.sections.length, 4);
  assert.equal(res.truncated, false);
});

test('clamp: 超预算截断、标 truncated、丢弃更后的段', () => {
  const big = [
    { key: 'background', text: 'x'.repeat(300) },
    { key: 'preference', text: 'y'.repeat(300) },
    { key: 'focus', text: 'z'.repeat(300) },
  ];
  const res = clampPortraitToBudget(big, 400);
  assert.equal(res.truncated, true);
  assert.ok(res.chars <= 400, `chars=${res.chars}`);
  assert.equal(res.sections.length, 2, '第二段截断、第三段丢弃');
  assert.ok(res.sections[1].text.endsWith('…'));
});

test('clamp: 空段跳过不计费', () => {
  const res = clampPortraitToBudget(
    [{ key: 'background', text: '' }, { key: 'focus', text: 'f' }],
    100,
  );
  assert.equal(res.sections.length, 1);
  assert.equal(res.sections[0].key, 'focus');
});

/* ---------------- renderPortraitInjection ---------------- */

test('injection: 两份画像各带版本头', () => {
  const res = renderPortraitInjection({
    workspace: { version: 1, sections: FOUR },
    global: { version: 2, sections: [{ key: 'background', text: 'G' }] },
    maxChars: 1400,
  });
  assert.match(res.text, /### 工作区画像（v1）/);
  assert.match(res.text, /### 全局画像（v2）/);
  assert.equal(res.hasWorkspace, true);
  assert.equal(res.hasGlobal, true);
  assert.equal(res.truncated, false);
});

test('injection: 都为空时返回空文本', () => {
  const res = renderPortraitInjection({ workspace: null, global: null });
  assert.equal(res.text, '');
  assert.equal(res.hasWorkspace, false);
});

test('injection: 预算紧张时截断并附脚注', () => {
  const res = renderPortraitInjection({
    workspace: { version: 1, sections: [{ key: 'background', text: 'x'.repeat(2000) }] },
    global: null,
    maxChars: 400,
  });
  assert.equal(res.truncated, true);
  assert.match(res.text, /画像超出预算已截断/);
  assert.ok(res.chars <= 400 + 40, `chars=${res.chars}`);
});

test('injection: 空段不出现在文本里', () => {
  const res = renderPortraitInjection({
    workspace: { version: 1, sections: FOUR.map((s) => (s.key === 'recent' ? { ...s, text: '' } : s)) },
    global: null,
  });
  assert.ok(!res.text.includes('**近期动态**'));
});

/* ---------------- 重写管线（buildRewriteInput / parseRewriteResponse） ---------------- */

test('rewrite: REWRITE_SYSTEM 存在且要求 JSON 输出', () => {
  assert.match(REWRITE_SYSTEM, /JSON/);
  assert.match(REWRITE_SYSTEM, /Never invent facts/);
});

test('rewrite: buildRewriteInput 含四段 key 与旧画像', () => {
  const input = buildRewriteInput({
    scope: 'workspace',
    oldPortrait: { sections: [{ key: 'background', text: '旧背景。' }] },
  });
  assert.match(input, /keys: background, preference, focus, recent/);
  assert.match(input, /旧背景。/);
  assert.match(input, /ONLY a JSON object/);
});

test('rewrite: buildRewriteInput 带日志与条目摘要', () => {
  const input = buildRewriteInput({
    scope: 'workspace',
    journal: [{ date: '2026-10-15', text: '# 2026-10-15\n- 10:00 做了 X' }],
    records: [{ title: '条目甲', category: 'fact', updatedAt: '2026-10-15T02:00:00Z' }],
  });
  assert.match(input, /Journal \(newest first\)/);
  assert.match(input, /做了 X/);
  assert.match(input, /条目甲 \[fact\] 2026-10-15/);
});

test('rewrite: 没有旧画像时明说 (empty)', () => {
  assert.match(buildRewriteInput({ oldPortrait: null }), /Current profile:\n\(empty\)/);
});

test('rewrite: parse 接受围栏 / 裸 JSON / 前后噪声', () => {
  const good = '{"sections":[{"key":"background","text":"A。"}]}';
  for (const text of [good, `\`\`\`json\n${good}\n\`\`\``, `当然可以：\n${good}\n以上。`]) {
    const parsed = parseRewriteResponse(text, { scope: 'workspace' });
    assert.equal(parsed.ok, true, text.slice(0, 24));
    assert.equal(parsed.sections.find((s) => s.key === 'background').text, 'A。');
  }
});

test('rewrite: parse 的失败分支', () => {
  assert.deepEqual(parseRewriteResponse(''), { ok: false, error: 'empty' });
  assert.deepEqual(parseRewriteResponse('抱歉，无法完成'), { ok: false, error: 'no_json' });
  assert.deepEqual(parseRewriteResponse('{"foo":1}'), { ok: false, error: 'no_sections' });
  const empty = parseRewriteResponse('{"sections":[{"key":"background","text":""}]}');
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'empty_sections');
});

test('rewrite: parse 按 scope 归一（全局版段标题为「个人背景」）', () => {
  const parsed = parseRewriteResponse('{"sections":[{"key":"preference","text":"P"}]}', { scope: 'global' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.sections.find((s) => s.key === 'preference').title, '个人背景');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
