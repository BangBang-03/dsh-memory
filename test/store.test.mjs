/**
 * dsh-memory 存储层测试：脱离 DSH 直接跑。
 *   node test/store.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const mod = await import('../lib/store.js');
const {
  createMemoryStore,
  workspaceKey,
  slugify,
  tokenize,
  similarity,
  rankRecords,
  renderMarkdown,
  pathWorkspaceKey,
  decayFactor,
  CATEGORIES,
  CATEGORY_LABELS,
} = mod;

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-test-'));
const dir = path.join(tmp, 'storage');
const WS_A = process.platform === 'win32' ? 'C:\\proj\\alpha' : '/proj/alpha';
const WS_B = process.platform === 'win32' ? 'C:\\proj\\beta' : '/proj/beta';

console.log(`\ndsh-memory store tests  (tmp=${tmp})\n`);

/* ---------------- tokenize / similarity ---------------- */

test('tokenize: 英文按词切分并小写', () => {
  assert.deepEqual(tokenize('Hello World_2'), ['hello', 'world_2']);
});

test('tokenize: 单个英文字母被丢弃', () => {
  assert.deepEqual(tokenize('a bb'), ['bb']);
});

test('tokenize: 中文产生一元与二元组', () => {
  const t = tokenize('记忆');
  assert.ok(t.includes('记'), 'unigram 记');
  assert.ok(t.includes('忆'), 'unigram 忆');
  assert.ok(t.includes('记忆'), 'bigram 记忆');
});

test('tokenize: 中英混排都能切', () => {
  const t = tokenize('用 dsh-memory 存记忆');
  assert.ok(t.includes('dsh'));
  assert.ok(t.includes('memory'));
  assert.ok(t.includes('记忆'));
});

test('tokenize: 空值安全', () => {
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(''), []);
});

test('similarity: 相同文本为 1', () => {
  assert.equal(similarity('用户偏好深色主题', '用户偏好深色主题'), 1);
});

test('similarity: 不相干文本接近 0', () => {
  assert.ok(similarity('用户偏好深色主题', 'hello world foo') < 0.1);
});

test('similarity: 空串为 0 而不是 NaN', () => {
  assert.equal(similarity('', 'abc'), 0);
  assert.equal(similarity('abc', ''), 0);
});

/* ---------------- workspaceKey ---------------- */

test('workspaceKey: 同一路径稳定', () => {
  assert.equal(workspaceKey(WS_A), workspaceKey(WS_A));
  assert.match(workspaceKey(WS_A), /^[0-9a-f]{10}$/);
});

test('workspaceKey: 尾部分隔符与相对写法归一化', () => {
  assert.equal(workspaceKey(WS_A), workspaceKey(`${WS_A}${path.sep}`));
  assert.equal(workspaceKey(WS_A), workspaceKey(`${WS_A}${path.sep}.`));
});

if (process.platform === 'win32') {
  test('workspaceKey: Windows 下大小写不敏感', () => {
    assert.equal(workspaceKey('C:\\Proj\\Alpha'), workspaceKey('c:\\proj\\alpha'));
  });
  test('workspaceKey: Windows 下分隔符不敏感', () => {
    assert.equal(workspaceKey('C:/proj/alpha'), workspaceKey('C:\\proj\\alpha'));
  });
}

test('workspaceKey: 不同工作区不同 key', () => {
  assert.notEqual(workspaceKey(WS_A), workspaceKey(WS_B));
});

test('workspaceKey: 空工作区 => _global', () => {
  assert.equal(workspaceKey(''), '_global');
});

test('slugify: 取目录名并清理非法字符', () => {
  assert.equal(slugify(WS_A), 'alpha');
  assert.equal(slugify('C:\\my proj!'), 'my-proj');
});

test('slugify: 中文目录名保留', () => {
  assert.equal(slugify('C:\\项目\\记忆插件'), '记忆插件');
});

/* ---------------- CRUD ---------------- */

const store = createMemoryStore({ dir });

test('upsert: 新增返回完整记录', () => {
  const { record } = store.upsert(
    { title: '用户偏好深色主题', content: '用户明确要求全局使用深色模式', category: 'preference', tags: ['ui'] },
    { workspace: WS_A },
  );
  assert.match(record.id, /^mem_/);
  assert.equal(record.category, 'preference');
  assert.equal(record.scope, 'workspace');
  assert.equal(record.pinned, false);
  assert.equal(record.useCount, 0);
  assert.equal(record.exposedCount, 0);
  assert.equal(record.openedCount, 0);
  assert.equal(record.citedCount, 0);
  assert.equal(record.lastExposedAt, null);
  assert.ok(Date.parse(record.createdAt) > 0);
});

test('upsert: 落盘到 workspaces/<slug>-<hash>/memories.json', () => {
  const info = store.workspaceInfo(WS_A);
  assert.ok(fs.existsSync(info.dataFile), `期望存在 ${info.dataFile}`);
  const parsed = JSON.parse(fs.readFileSync(info.dataFile, 'utf8'));
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.key, workspaceKey(WS_A));
  assert.equal(parsed.records.length, 1);
});

test('upsert: 产生人类可读镜像 MEMORY.md', () => {
  const mirror = path.join(path.dirname(store.workspaceInfo(WS_A).dataFile), 'MEMORY.md');
  assert.ok(fs.existsSync(mirror));
  const md = fs.readFileSync(mirror, 'utf8');
  assert.ok(md.includes('用户偏好深色主题'), '镜像含标题');
  assert.ok(md.includes('## 偏好（preference）'), '镜像按类别分组');
});

test('upsert: 落盘产生 index.json 索引', () => {
  assert.ok(fs.existsSync(path.join(dir, 'index.json')));
  const ws = store.workspaces();
  assert.ok(ws.some((w) => w.key === workspaceKey(WS_A)));
});

test('upsert: 未知 category 回落到 note', () => {
  const { record } = store.upsert({ title: 'x', content: 'y', category: 'bogus' }, { workspace: WS_A });
  assert.equal(record.category, 'note');
});

test('upsert: 未知 source 回落到 manual', () => {
  const { record } = store.upsert({ title: 'x2', content: 'y', source: 'bot' }, { workspace: WS_A });
  assert.equal(record.source, 'manual');
});

test('upsert: auto 来源默认置信度 0.6', () => {
  const { record } = store.upsert({ title: 'a', content: 'b', source: 'auto' }, { workspace: WS_A });
  assert.equal(record.confidence, 0.6);
});

test('upsert: 标题超长被截断且带省略号', () => {
  const { record } = store.upsert({ title: 'x'.repeat(300) }, { workspace: WS_A });
  assert.equal(record.title.length, 160);
  assert.ok(record.title.endsWith('…'));
});

test('upsert: 无标题时用正文前 60 字兜底', () => {
  const { record } = store.upsert({ content: '这是一段没有标题的记忆内容' }, { workspace: WS_A });
  assert.equal(record.title, '这是一段没有标题的记忆内容');
});

test('upsert: 完全空输入得到「未命名记忆」', () => {
  const { record } = store.upsert({}, { workspace: WS_A });
  assert.equal(record.title, '未命名记忆');
});

test('upsert: 传 id 时更新而不是新增', () => {
  const first = store.upsert({ title: 'A', content: '1' }, { workspace: WS_A }).record;
  const second = store.upsert({ id: first.id, title: 'A2', content: '2' }, { workspace: WS_A }).record;
  assert.equal(second.id, first.id);
  assert.equal(second.title, 'A2');
  assert.equal(second.createdAt, first.createdAt, 'createdAt 保持');
  assert.equal(store.get(first.id, { workspace: WS_A }).content, '2');
});

test('upsert: dedupe 命中相似记录时合并而不是新增', () => {
  const before = store.list({ workspace: WS_A }).total;
  const res = store.upsert(
    { title: '用户偏好深色主题', content: '用户明确要求全局使用深色模式', category: 'preference', tags: ['ui'] },
    { workspace: WS_A, dedupe: true },
  );
  assert.equal(res.mergedInto, true, '应合并');
  assert.equal(store.list({ workspace: WS_A }).total, before, '条数不变');
  assert.equal(res.record.createdAt, res.record.createdAt);
});

test('upsert: dedupe 对不同内容仍新增', () => {
  const before = store.list({ workspace: WS_A }).total;
  store.upsert(
    { title: '完全无关的另一条记忆 zzz', content: '关于构建流水线的独立事实 qqq' },
    { workspace: WS_A, dedupe: true },
  );
  assert.equal(store.list({ workspace: WS_A }).total, before + 1);
});

test('upsert: scope=global 落到 _global 目录', () => {
  const { record } = store.upsert({ title: '全局偏好：中文回复', scope: 'global', category: 'preference' }, { workspace: WS_A });
  assert.equal(record.scope, 'global');
  assert.ok(fs.existsSync(path.join(dir, 'workspaces', '_global', 'memories.json')));
});

/* ---------------- 隔离 ---------------- */

test('隔离: 工作区 B 看不到 A 的私有记忆', () => {
  store.upsert({ title: 'B 的独有记忆 beta-only' }, { workspace: WS_B });
  const titles = store.list({ workspace: WS_B, includeGlobal: false }).records.map((r) => r.title);
  assert.ok(titles.includes('B 的独有记忆 beta-only'));
  assert.ok(!titles.includes('用户偏好深色主题'), 'B 不应看到 A 的私有记忆');
});

test('隔离: 全局记忆在所有工作区可见', () => {
  const inA = store.list({ workspace: WS_A }).records.map((r) => r.title);
  const inB = store.list({ workspace: WS_B }).records.map((r) => r.title);
  assert.ok(inA.includes('全局偏好：中文回复'));
  assert.ok(inB.includes('全局偏好：中文回复'));
});

test('隔离: includeGlobal=false 时全局记忆被排除', () => {
  const titles = store.list({ workspace: WS_A, includeGlobal: false }).records.map((r) => r.title);
  assert.ok(!titles.includes('全局偏好：中文回复'));
  assert.ok(titles.includes('用户偏好深色主题'));
});

/* ---------------- 查询 / 过滤 / 排序 ---------------- */

test('list: 中文关键词命中（二元组）', () => {
  const { records } = store.list({ workspace: WS_A, query: '深色' });
  assert.ok(records.length >= 1);
  assert.equal(records[0].title, '用户偏好深色主题');
});

test('list: 英文关键词命中', () => {
  store.upsert({ title: 'Build pipeline uses pnpm', content: 'always run pnpm build' }, { workspace: WS_A });
  const { records } = store.list({ workspace: WS_A, query: 'pnpm' });
  assert.ok(records.length >= 1);
  assert.ok(records.some((r) => r.title.includes('pnpm')));
});

test('list: 查询无命中时返回空', () => {
  assert.equal(store.list({ workspace: WS_A, query: 'zzzzzznothing' }).total, 0);
});

test('list: category 过滤', () => {
  const { records } = store.list({ workspace: WS_A, category: 'preference' });
  assert.ok(records.length >= 1);
  assert.ok(records.every((r) => r.category === 'preference'));
});

test('list: tag 过滤', () => {
  const { records } = store.list({ workspace: WS_A, tag: 'ui' });
  assert.ok(records.length >= 1);
  assert.ok(records.every((r) => r.tags.includes('ui')));
});

test('list: scope 过滤', () => {
  const { records } = store.list({ workspace: WS_A, scope: 'global' });
  assert.ok(records.length >= 1);
  assert.ok(records.every((r) => r.scope === 'global'));
});

test('list: 默认按置顶优先 + 更新时间倒序', () => {
  const r = store.upsert({ title: '置顶条目', pinned: true }, { workspace: WS_A }).record;
  const { records } = store.list({ workspace: WS_A, includeGlobal: false });
  assert.equal(records[0].id, r.id);
  store.update(r.id, { pinned: false }, { workspace: WS_A });
});

test('list: limit / offset 分页', () => {
  const all = store.list({ workspace: WS_A }).total;
  const page = store.list({ workspace: WS_A, limit: 2, offset: 1 });
  assert.equal(page.total, all, 'total 是过滤后总数');
  assert.equal(page.records.length, Math.min(2, all - 1));
});

test('list: 归档记录默认不出现，includeArchived 时出现', () => {
  const r = store.upsert({ title: '将被归档' }, { workspace: WS_A }).record;
  store.update(r.id, { archived: true }, { workspace: WS_A });
  assert.ok(!store.list({ workspace: WS_A }).records.some((x) => x.id === r.id));
  assert.ok(store.list({ workspace: WS_A, includeArchived: true }).records.some((x) => x.id === r.id));
});

/* ---------------- search / briefing ---------------- */

test('search: 返回 _score 且按相关度降序', () => {
  const hits = store.search({ workspace: WS_A, query: '深色主题', limit: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].title, '用户偏好深色主题');
  for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1]._score >= hits[i]._score);
});

test('search: 标题命中权重高于正文命中', () => {
  store.upsert({ title: 'zzz plain', content: 'keyword 只在正文出现' }, { workspace: WS_A });
  store.upsert({ title: 'keyword 在标题', content: '无关正文' }, { workspace: WS_A });
  const hits = store.search({ workspace: WS_A, query: 'keyword', limit: 5 });
  assert.equal(hits[0].title, 'keyword 在标题');
});

test('briefing: 遵守 maxChars 且至少给 3 条', () => {
  const picked = store.briefing({ workspace: WS_A, limit: 50, maxChars: 10 });
  assert.ok(picked.length >= 3);
});

test('briefing: 置顶记忆排在最前', () => {
  const r = store.upsert({ title: '必须最先出现', pinned: true, category: 'fact' }, { workspace: WS_A }).record;
  assert.equal(store.briefing({ workspace: WS_A, limit: 5 })[0].id, r.id);
  store.update(r.id, { pinned: false }, { workspace: WS_A });
});

test('markUsed: 累加 useCount 并写 lastUsedAt', () => {
  const r = store.upsert({ title: '会被使用' }, { workspace: WS_A }).record;
  store.markUsed([r.id], { workspace: WS_A });
  store.markUsed([r.id], { workspace: WS_A });
  const after = store.get(r.id, { workspace: WS_A });
  assert.equal(after.useCount, 2);
  assert.ok(after.lastUsedAt);
});

test('markUsed: 未知 id 不报错', () => {
  assert.equal(store.markUsed(['mem_nope'], { workspace: WS_A }).ok, true);
});

test('markExposed: 只记曝光，不计入 useCount / lastUsedAt', () => {
  const r = store.upsert({ title: '只被注入过' }, { workspace: WS_A }).record;
  store.markExposed([r.id], { workspace: WS_A });
  store.markExposed([r.id], { workspace: WS_A });
  const after = store.get(r.id, { workspace: WS_A });
  assert.equal(after.exposedCount, 2);
  assert.ok(after.lastExposedAt);
  assert.equal(after.useCount, 0);
  assert.equal(after.lastUsedAt, null);
  assert.equal(after.openedCount, 0);
  assert.equal(after.citedCount, 0);
});

test('markOpened / markCited: 分开计数，并共同计入 useCount', () => {
  const r = store.upsert({ title: '被打开又被引用' }, { workspace: WS_A }).record;
  store.markOpened([r.id], { workspace: WS_A });
  store.markCited([r.id], { workspace: WS_A });
  const after = store.get(r.id, { workspace: WS_A });
  assert.equal(after.openedCount, 1);
  assert.equal(after.citedCount, 1);
  assert.equal(after.useCount, 2);
  assert.ok(after.lastUsedAt);
});

test('markCitations: 只记录文本里真实存在的 id', () => {
  const hit = store.upsert({ title: '会被引用的记忆' }, { workspace: WS_A }).record;
  const miss = store.upsert({ title: '没被引用的记忆' }, { workspace: WS_A }).record;
  const result = store.markCitations(`参考 ${hit.id}，以及并不存在的 mem_missing_000`, { workspace: WS_A });
  assert.equal(result.affected, 1);
  assert.equal(store.get(hit.id, { workspace: WS_A }).citedCount, 1);
  assert.equal(store.get(miss.id, { workspace: WS_A }).citedCount, 0);
});

test('health: 列出多次曝光但从未使用的条目', () => {
  const r = store.upsert({ title: '曝光很多次没人用' }, { workspace: WS_A }).record;
  for (let i = 0; i < 3; i += 1) store.markExposed([r.id], { workspace: WS_A });
  const before = store.health({ workspace: WS_A });
  assert.ok(before.exposedButUnused.includes(r.id));
  store.markOpened([r.id], { workspace: WS_A });
  const after = store.health({ workspace: WS_A });
  assert.ok(!after.exposedButUnused.includes(r.id));
});

test('rankRecords: 曝光不提升排序，打开才提升', () => {
  const at = new Date().toISOString();
  const base = {
    category: 'fact',
    content: 'alpha beta gamma',
    tags: [],
    keywords: [],
    related: [],
    files: [],
    confidence: 1,
    quality: 100,
    pinned: false,
    archived: false,
    status: 'active',
    createdAt: at,
    updatedAt: at,
  };
  const a = { ...base, id: 'mem_a', title: 'alpha' };
  const b = { ...base, id: 'mem_b', title: 'alpha' };
  const scoreOf = (records) => rankRecords(records, { query: 'alpha', limit: 2 })[0].score;
  const baseline = scoreOf([a, b]);
  const exposed = { ...a, exposedCount: 10 };
  assert.ok(Math.abs(scoreOf([exposed, b]) - baseline) < 1e-6, '曝光次数不该改变排序分数');
  const opened = { ...a, openedCount: 2, useCount: 2 };
  assert.ok(scoreOf([opened, b]) > baseline, '显式打开应提升排序分数');
});

/* ---------------- update / remove / bulk ---------------- */

test('update: 未知 id 返回 not_found', () => {
  assert.equal(store.update('mem_missing', { title: 'x' }, { workspace: WS_A }).ok, false);
});

test('remove: 删除后 list 与 get 都查不到', () => {
  const r = store.upsert({ title: '待删除' }, { workspace: WS_A }).record;
  assert.equal(store.remove(r.id, { workspace: WS_A }).ok, true);
  assert.equal(store.get(r.id, { workspace: WS_A }), null);
});

test('remove: 未知 id 返回 not_found', () => {
  assert.equal(store.remove('mem_missing', { workspace: WS_A }).ok, false);
});

test('remove: 能删掉全局记忆', () => {
  const r = store.upsert({ title: '临时全局', scope: 'global' }, { workspace: WS_A }).record;
  assert.equal(store.remove(r.id, { workspace: WS_A }).ok, true);
});

test('bulk: 批量归档与删除', () => {
  const a = store.upsert({ title: 'bulk-a' }, { workspace: WS_B }).record;
  const b = store.upsert({ title: 'bulk-b' }, { workspace: WS_B }).record;
  store.bulk('archive', [a.id, b.id], { workspace: WS_B });
  assert.ok(!store.list({ workspace: WS_B, includeGlobal: false }).records.some((r) => r.id === a.id));
  store.bulk('unarchive', [a.id], { workspace: WS_B });
  assert.ok(store.list({ workspace: WS_B, includeGlobal: false }).records.some((r) => r.id === a.id));
  store.bulk('delete', [a.id, b.id], { workspace: WS_B });
  assert.equal(store.list({ workspace: WS_B, includeGlobal: false }).total, 1);
});

test('bulk: 空数组安全', () => {
  assert.equal(store.bulk('delete', [], { workspace: WS_B }).ok, true);
});

/* ---------------- stats / tags / workspaces ---------------- */

test('stats: 统计条数、置顶、类别分布、全局条数', () => {
  const s = store.stats({ workspace: WS_A });
  assert.equal(s.key, workspaceKey(WS_A));
  assert.ok(s.total > 0);
  assert.ok(s.global >= 1);
  assert.equal(Object.values(s.byCategory).reduce((x, y) => x + y, 0), s.total);
});

test('stats: 空工作区返回 0 而不是抛错', () => {
  const s = store.stats({ workspace: path.join(tmp, 'never-used') });
  assert.equal(s.total, 0);
  assert.equal(s.global >= 1, true);
});

test('tags: 按出现次数倒序', () => {
  const tags = store.tags({ workspace: WS_A });
  assert.ok(tags.some((t) => t.tag === 'ui'));
  for (let i = 1; i < tags.length; i += 1) assert.ok(tags[i - 1].count >= tags[i].count);
});

test('workspaces: 同时收录 A 与 B', () => {
  const keys = store.workspaces().map((w) => w.key);
  assert.ok(keys.includes(workspaceKey(WS_A)));
  assert.ok(keys.includes(workspaceKey(WS_B)));
});

/* ---------------- 导入导出 ---------------- */

test('export/import: 导出再导入到另一工作区', () => {
  const payload = store.export({ workspace: WS_A });
  assert.ok(Array.isArray(payload.records));
  const wsC = path.join(tmp, 'gamma');
  const res = store.import(payload, { workspace: wsC });
  assert.equal(res.ok, true);
  assert.ok(res.added > 0);
  assert.ok(store.list({ workspace: wsC, includeGlobal: false }).total > 0);
});

test('export/import: 曝光、打开、引用计数随记录保留', () => {
  const r = store.upsert({ title: '计数随导出保留' }, { workspace: WS_A }).record;
  store.markExposed([r.id], { workspace: WS_A });
  store.markOpened([r.id], { workspace: WS_A });
  store.markCited([r.id], { workspace: WS_A });
  const wsE = path.join(tmp, 'epsilon');
  store.import(store.export({ workspace: WS_A }), { workspace: wsE });
  const imported = store
    .list({ workspace: wsE, includeGlobal: false })
    .records.find((item) => item.title === '计数随导出保留');
  assert.ok(imported, '导入后应找到记录');
  assert.equal(imported.exposedCount, 1);
  assert.equal(imported.openedCount, 1);
  assert.equal(imported.citedCount, 1);
  assert.equal(imported.useCount, 2);
  assert.ok(imported.lastExposedAt);
});

test('import: mode=replace 清空后写入', () => {
  const wsD = path.join(tmp, 'delta');
  store.upsert({ title: '会被替换掉' }, { workspace: wsD });
  store.import({ records: [{ title: '新记录' }] }, { workspace: wsD, mode: 'replace' });
  const titles = store.list({ workspace: wsD, includeGlobal: false }).records.map((r) => r.title);
  assert.deepEqual(titles, ['新记录']);
});

/* ---------------- 并发/缓存失效 ---------------- */

test('外部改动: 另一 store 实例写入后本实例能读到', () => {
  const other = createMemoryStore({ dir });
  other.upsert({ title: '外部实例写入的记录' }, { workspace: WS_A });
  const titles = store.list({ workspace: WS_A }).records.map((r) => r.title);
  assert.ok(titles.includes('外部实例写入的记录'), '应按 mtime 失效缓存');
});

test('invalidate: 清缓存后仍能正确读取', () => {
  store.invalidate(WS_A);
  assert.ok(store.list({ workspace: WS_A }).total > 0);
});

/* ---------------- 渲染 ---------------- */

test('renderMarkdown: 含标题、分组与置顶区', () => {
  const md = renderMarkdown([
    { id: '1', title: 'P', content: 'c', category: 'fact', tags: [], pinned: true, archived: false, updatedAt: new Date().toISOString() },
    { id: '2', title: 'F', content: 'c2', category: 'fact', tags: ['t'], pinned: false, archived: false, updatedAt: new Date().toISOString() },
    { id: '3', title: 'Gone', content: 'c3', category: 'note', tags: [], pinned: false, archived: true, updatedAt: new Date().toISOString() },
  ], { root: WS_A });
  assert.ok(md.includes('# 工作区长期记忆'));
  assert.ok(md.includes('## 置顶'));
  assert.ok(md.includes('## 事实（fact）'));
  assert.ok(!md.includes('Gone'), '归档记录不进镜像');
});

test('renderMarkdown: 空列表不抛错', () => {
  assert.ok(renderMarkdown([], { root: WS_A }).includes('条数：0'));
});

/* ---------------- 边界 ---------------- */

test('健壮性: 损坏的 json 不会让 store 崩溃', () => {
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-bad-'));
  fs.mkdirSync(path.join(badDir, 'workspaces'), { recursive: true });
  const s = createMemoryStore({ dir: badDir });
  const info = s.workspaceInfo(WS_A);
  fs.mkdirSync(path.dirname(info.dataFile), { recursive: true });
  fs.writeFileSync(info.dataFile, '{ this is not json', 'utf8');
  assert.equal(s.list({ workspace: WS_A }).total, 0);
  s.upsert({ title: '恢复写入' }, { workspace: WS_A });
  assert.equal(s.list({ workspace: WS_A }).total, 1);
});

test('健壮性: 空工作区字符串按全局处理', () => {
  assert.equal(store.workspaceInfo('').folder, '_global');
});

test('健壮性: tags 去重且过滤空值', () => {
  const r = store.upsert({ title: 'tag 去重', tags: ['a', 'a', '', '  ', 'b'] }, { workspace: WS_A }).record;
  assert.deepEqual(r.tags, ['a', 'b']);
});

test('健壮性: 原子写不留 .tmp 文件', () => {
  const info = store.workspaceInfo(WS_A);
  const strays = fs.readdirSync(path.dirname(info.dataFile)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(strays, []);
});

test('rankRecords: 置顶优先于高相关度', () => {
  const base = { archived: false, useCount: 0, confidence: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [] };
  const ranked = rankRecords(
    [
      { ...base, id: 'p', title: 'nothing', content: 'nothing', category: 'note', pinned: true },
      { ...base, id: 'r', title: 'query term', content: 'query term query term', category: 'note', pinned: false },
    ],
    { query: 'query term', limit: 5 },
  );
  assert.equal(ranked[0].record.id, 'p');
});

test('rankRecords: 归档记录被排除', () => {
  const base = { pinned: true, useCount: 0, confidence: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [], category: 'note', title: 'x', content: 'x' };
  assert.equal(rankRecords([{ ...base, id: 'a', archived: true }], { limit: 5 }).length, 0);
});

test('CATEGORIES: 覆盖 9 类且与标签表一致', () => {
  assert.equal(CATEGORIES.length, 9);
  for (const c of CATEGORIES) assert.ok(typeof CATEGORY_LABELS[c] === 'string');
});

/* ---------------- 工作区镜像（设置里承诺的 .dsh-memory/MEMORY.md） ---------------- */

/** 造一个真实存在于磁盘上的工作区目录——镜像只在工作区目录存在时才落盘。 */
function makeWorkspace(name) {
  const ws = path.join(tmp, name);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

test('镜像：开启时真的写进工作区 .dsh-memory/MEMORY.md', () => {
  const ws = makeWorkspace('mirror-on');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-on-store'), mirror: true });
  s.upsert({ title: '工作区镜像', content: '这条应该出现在工作区里的 MEMORY.md。', tags: ['mirror'] }, { workspace: ws });
  const file = path.join(ws, '.dsh-memory', 'MEMORY.md');
  assert.ok(fs.existsSync(file), `期望 ${file} 存在`);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('工作区镜像'), '标题在镜像里');
  assert.ok(text.includes('由 dsh-memory 自动生成'), '带自动生成声明');
  assert.equal(s.mirrorInfo(ws).workspaceExists, true);
  assert.ok(s.mirrorInfo(ws).workspaceFile.endsWith(path.join('.dsh-memory', 'MEMORY.md')));
});

test('镜像：主库旁车与工作区镜像同时存在，内容一致', () => {
  const ws = makeWorkspace('mirror-both');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-both-store'), mirror: true });
  s.upsert({ title: '双写', content: '两处都应有一份。' }, { workspace: ws });
  const info = s.mirrorInfo(ws);
  assert.equal(info.storageExists, true);
  assert.equal(info.workspaceExists, true);
  assert.equal(fs.readFileSync(info.storageFile, 'utf8'), fs.readFileSync(info.workspaceFile, 'utf8'));
});

test('镜像：关闭时不写工作区，主库旁车照写', () => {
  const ws = makeWorkspace('mirror-off');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-off-store'), mirror: false });
  s.upsert({ title: '不镜像', content: '工作区里不该出现 .dsh-memory。' }, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory')), false);
  assert.equal(s.mirrorInfo(ws).storageExists, true, '主库旁车始终写');
  assert.equal(s.mirrorInfo(ws).workspaceExists, false);
});

test('镜像：关掉开关后旧的工作区镜像会被清掉', () => {
  const ws = makeWorkspace('mirror-stale');
  let on = true;
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-stale-store'), mirror: () => on });
  s.upsert({ title: '先开', content: '开着时写进工作区。' }, { workspace: ws });
  assert.ok(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')));
  on = false;
  s.upsert({ title: '后关', content: '关掉后旧文件不该留着。' }, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')), false);
});

test('镜像：工作区目录不存在时绝不凭空造目录，但主库正常', () => {
  const ghost = path.join(tmp, 'not-a-real-workspace');
  const s = createMemoryStore({ dir: path.join(tmp, 'ghost-store'), mirror: true });
  s.upsert({ title: '幽灵工作区', content: '工作区不存在就别写文件。' }, { workspace: ghost });
  assert.equal(fs.existsSync(ghost), false);
  assert.equal(s.mirrorInfo(ghost).workspaceExists, false);
  assert.equal(s.mirrorInfo(ghost).storageExists, true);
});

test('镜像：mirror 传函数时按调用时取值（设置面板实时开关）', () => {
  const ws = makeWorkspace('mirror-dynamic');
  let on = false;
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-dynamic-store'), mirror: () => on });
  s.upsert({ title: '开关', content: '关着的时候不写。' }, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')), false);
  on = true;
  s.upsert({ title: '开关2', content: '打开之后就该写了。' }, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')), true);
});

test('镜像：最后一条记忆被删掉后撤掉工作区文件与空目录', () => {
  const ws = makeWorkspace('mirror-clean');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-clean-store'), mirror: true });
  const rec = s.upsert({ title: '待清理', content: '删掉它，镜像也该消失。' }, { workspace: ws }).record;
  assert.ok(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')));
  s.remove(rec.id, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')), false);
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory')), false, '空目录也应收掉');
});

test('镜像：归档掉最后一条有效记忆同样撤掉镜像', () => {
  const ws = makeWorkspace('mirror-archive');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-archive-store'), mirror: true });
  const rec = s.upsert({ title: '待归档', content: '归档后就没有有效记忆了。' }, { workspace: ws }).record;
  assert.ok(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')));
  s.update(rec.id, { archived: true }, { workspace: ws });
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory', 'MEMORY.md')), false);
});

test('镜像：removeWorkspaceMirror 显式撤掉文件（设置关掉镜像时用）', () => {
  const ws = makeWorkspace('mirror-explicit');
  const s = createMemoryStore({ dir: path.join(tmp, 'mirror-explicit-store'), mirror: true });
  s.upsert({ title: '显式撤', content: '先写再撤。' }, { workspace: ws });
  assert.equal(s.removeWorkspaceMirror(ws), true);
  assert.equal(s.mirrorInfo(ws).workspaceExists, false);
  assert.equal(s.removeWorkspaceMirror(ws), false, '再撤一次返回 false');
  assert.equal(s.removeWorkspaceMirror(''), false, '全局记忆没有工作区镜像');
});

/* ---------------- v0.3.0：版本链 / 草稿 / 体检 / 索引简报 ---------------- */

/* 这一组全部用独立 store：列表/检索/体检都会合并全局库，共享实例会跨用例串数据。 */
const iso = (name) => createMemoryStore({ dir: path.join(tmp, `v03-${name}`) });

test('supersede：旧条归档并回指新条，新条指回旧条', () => {
  const s = iso('supersede');
  const ws = makeWorkspace('v03-supersede');
  const old = s.upsert({ title: '旧结论', content: '用 webpack 构建', category: 'decision' }, { workspace: ws });
  const result = s.supersede(old.record.id, { title: '新结论', content: '改用 vite 构建', source: 'agent' }, { workspace: ws });
  assert.ok(result.ok, 'supersede 应成功');
  assert.equal(result.record.supersedes, old.record.id, '新条应指回旧条');
  const oldAfter = s.get(old.record.id, { workspace: ws });
  assert.equal(oldAfter.archived, true, '旧条应被归档');
  assert.equal(oldAfter.supersededBy, result.record.id, '旧条应回指新条');
  const listed = s.list({ workspace: ws }).records.map((r) => r.title);
  assert.deepEqual(listed, ['新结论']);
});

test('rollback：从新条回滚恢复旧条；再从旧条撤销亦然', () => {
  const s = iso('rollback');
  const ws = makeWorkspace('v03-rollback');
  const old = s.upsert({ title: '回滚旧条', content: 'A 方案', category: 'decision' }, { workspace: ws });
  const sup = s.supersede(old.record.id, { title: '回滚新条', content: 'B 方案', source: 'agent' }, { workspace: ws });

  const back = s.rollback(sup.record.id, { workspace: ws });
  assert.ok(back.ok, '回滚应成功');
  assert.equal(s.get(old.record.id, { workspace: ws }).archived, false, '旧条应恢复');
  assert.equal(s.get(old.record.id, { workspace: ws }).supersededBy, null, '旧条应清掉回指');
  assert.equal(s.get(sup.record.id, { workspace: ws }).archived, true, '新条应收起');

  // 从旧条（带 supersededBy 的那端）再推翻一次也走回滚语义。
  const sup2 = s.supersede(old.record.id, { title: '回滚新条2', content: 'C 方案', source: 'agent' }, { workspace: ws });
  const undo = s.rollback(old.record.id, { workspace: ws });
  assert.ok(undo.ok, '从旧条端回滚应成功');
  assert.equal(s.get(old.record.id, { workspace: ws }).archived, false);
  assert.equal(s.get(sup2.record.id, { workspace: ws }).archived, true);
});

test('user 类别强制全局：落库进全局库，改类别时跨库迁移', () => {
  const s = iso('user-scope');
  const ws = makeWorkspace('v03-user-scope');
  const saved = s.upsert({ title: '用户画像', content: '用户是投研工程师', category: 'user' }, { workspace: ws });
  assert.equal(saved.record.scope, 'global', 'user 类别应强制 global');
  const forced = s.upsert({ title: '画像二', content: 'x', category: 'user', scope: 'workspace' }, { workspace: ws });
  assert.equal(forced.record.scope, 'global');
  const stats = s.stats({ workspace: ws });
  assert.equal(stats.global, 2, '两条 user 记录都应落进全局库');
  assert.equal(stats.total, 0, '工作区库里不该有它们');

  // 普通记录改成 user 类别时要挪进全局库。
  const moved = s.upsert({ title: '会挪库的记录', content: 'x', category: 'fact' }, { workspace: ws });
  const after = s.update(moved.record.id, { category: 'user' }, { workspace: ws });
  assert.equal(after.record.scope, 'global');
  const reread = s.get(moved.record.id, { workspace: ws });
  assert.ok(reread, '挪库后按工作区仍可读到（合并全局）');
  assert.equal(reread.scope, 'global');
});

test('草稿：不进 list/search/briefing/镜像，includeDrafts 可见', () => {
  const s = iso('drafts');
  const ws = makeWorkspace('v03-drafts');
  s.upsert({ title: '正式记忆', content: '已生效的内容', category: 'fact' }, { workspace: ws });
  const draft = s.upsert({ title: '草稿记忆', content: '等待审批的内容', category: 'note', status: 'draft', source: 'auto' }, { workspace: ws });
  assert.equal(draft.record.status, 'draft');

  const listed = s.list({ workspace: ws }).records.map((r) => r.title);
  assert.deepEqual(listed, ['正式记忆'], '默认列表不该有草稿');
  assert.equal(s.search({ workspace: ws, query: '等待审批' }).length, 0, '检索不该命中草稿');
  assert.equal(s.briefing({ workspace: ws, mode: 'index' }).some((r) => r.status === 'draft'), false, '简报不进草稿');

  const withDrafts = s.list({ workspace: ws, includeDrafts: true }).records.map((r) => r.title);
  assert.ok(withDrafts.includes('草稿记忆'), 'includeDrafts 时可见');

  // 镜像也不写草稿：镜像在主库旁车，读回来确认。
  const mirrorFile = path.join(path.dirname(s.workspaceInfo(ws).dataFile), 'MEMORY.md');
  assert.ok(fs.existsSync(mirrorFile), '镜像应存在（有正式记忆）');
  assert.doesNotMatch(fs.readFileSync(mirrorFile, 'utf8'), /草稿记忆/, '镜像不该出现草稿');

  // 批准：update 成 active 后一切照旧可见。
  s.update(draft.record.id, { status: 'active' }, { workspace: ws });
  assert.equal(s.list({ workspace: ws }).records.length, 2);
});

test('findDuplicateClusters + consolidateCluster：相似条目聚类并合并归档', () => {
  const s = iso('dup');
  const ws = makeWorkspace('v03-dup');
  const a = s.upsert({ title: '构建去重甲', content: '构建流程要走 withSession 封装并等待 ready' }, { workspace: ws });
  const b = s.upsert({ title: '构建去重乙', content: '构建流程要走 withSession 封装并等待 ready' }, { workspace: ws });
  s.upsert({ title: '毫不相关的记忆', content: '完全另一个话题的内容' }, { workspace: ws });

  const clusters = s.findDuplicateClusters({ workspace: ws });
  assert.equal(clusters.length, 1, '应聚出一个重复簇');
  const ids = clusters[0].map((r) => r.id).sort();
  assert.deepEqual(ids, [a.record.id, b.record.id].sort());

  const merged = s.consolidateCluster(clusters[0].map((r) => r.id), { workspace: ws, title: '构建去重' });
  assert.ok(merged.ok, '合并应成功');
  assert.ok(merged.record.content.includes('甲') && merged.record.content.includes('乙'), '合并正文应含两条来源');
  for (const id of merged.archivedIds) {
    assert.equal(s.get(id, { workspace: ws }).archived, true, '来源条目应归档');
  }
  // 合并后体检不再报这一簇。
  assert.equal(s.findDuplicateClusters({ workspace: ws }).length, 0);
});

test('health：重复簇 / 过期未用 / 断链 / 草稿数', () => {
  const s = iso('health');
  const ws = makeWorkspace('v03-health');
  const dupA = s.upsert({ title: '体检重复甲', content: '同样的体检内容描述文本' }, { workspace: ws });
  s.upsert({ title: '体检重复乙', content: '同样的体检内容描述文本' }, { workspace: ws });
  const linked = s.upsert({ title: '带链接的记忆', content: 'x', related: [dupA.record.id, 'mem_missing'] }, { workspace: ws });
  s.upsert({ title: '体检草稿', content: 'x', status: 'draft', source: 'auto' }, { workspace: ws });

  // 造一条「过期未用」：直接改盘上的 updatedAt 再让 store 重读。
  const stale = s.upsert({ title: '过期未用的记忆', content: 'x' }, { workspace: ws });
  const dataFile = s.workspaceInfo(ws).dataFile;
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  raw.records.find((r) => r.id === stale.record.id).updatedAt = new Date(Date.now() - 90 * 86400000).toISOString();
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');
  s.invalidate(ws);

  const health = s.health({ workspace: ws, staleDays: 60 });
  assert.equal(health.duplicates.length, 1, '应报一个重复簇');
  assert.ok(health.stale.includes(stale.record.id), '应报过期未用');
  const brokenTargets = health.broken.filter((b) => b.id === linked.record.id).map((b) => b.target);
  assert.deepEqual(brokenTargets, ['mem_missing'], '应报悬空 related');
  assert.equal(health.drafts, 1, '应报一条待审草稿');

  // 修复：unlink 摘掉断链后体检干净。
  s.unlink(linked.record.id, 'mem_missing', { workspace: ws });
  const after = s.health({ workspace: ws, staleDays: 60 });
  assert.equal(after.broken.length, 0, '断链修复后不该再报');
});

test('briefing({mode:"index"})：索引模式按行预算，更多条目进得了简报', () => {
  const s = iso('index-brief');
  const ws = makeWorkspace('v03-index-brief');
  for (let i = 0; i < 6; i += 1) {
    s.upsert({ title: `索引条目${i}`, content: '长正文'.repeat(80), category: 'fact' }, { workspace: ws });
  }
  const full = s.briefing({ workspace: ws, mode: 'full', limit: 12, maxChars: 700 });
  const index = s.briefing({ workspace: ws, mode: 'index', limit: 12, maxChars: 700 });
  assert.ok(full.length < index.length, `同样字数预算下索引模式应装下更多条（full=${full.length}, index=${index.length}）`);
});

test('renderMarkdown：草稿排除；版本链与关联渲染成人读线索', () => {
  const s = iso('mirror-mark');
  const ws = makeWorkspace('v03-mirror-mark');
  const old = s.upsert({ title: '被推翻的旧条', content: '旧内容' }, { workspace: ws });
  const sup = s.supersede(old.record.id, { title: '新条', content: '新内容', source: 'agent' }, { workspace: ws });
  s.upsert({ title: '有草稿的条', content: 'x', status: 'draft', source: 'auto' }, { workspace: ws });

  const md = s.renderMarkdown(ws);
  assert.match(md, /↩ 替代了「被推翻的旧条」/, '版本链应渲染成线索');
  assert.doesNotMatch(md, /旧内容/, '旧条已归档不该再出现在正文里');
  assert.doesNotMatch(md, /有草稿的条/, '草稿不该出现在镜像里');
  assert.ok(sup.ok);
});

test('keywords 参与检索加权', () => {
  const s = iso('keywords');
  const ws = makeWorkspace('v03-keywords');
  s.upsert({ title: '普通标题甲', content: '正文里没提关键词', keywords: ['会话生命周期'] }, { workspace: ws });
  s.upsert({ title: '无关记录', content: '完全另一个话题' }, { workspace: ws });
  const hit = s.search({ workspace: ws, query: '会话生命周期' });
  assert.ok(hit.length >= 1, 'keywords 应命中检索');
  assert.equal(hit[0].title, '普通标题甲', 'keywords 命中的应排最前');
});

test('unlink：可摘掉指定断链，也可一键清空 related', () => {
  const s = iso('unlink');
  const ws = makeWorkspace('v03-unlink');
  const rec = s.upsert({ title: '多链接', content: 'x', related: ['mem_a', 'mem_b'] }, { workspace: ws });
  const one = s.unlink(rec.record.id, 'mem_a', { workspace: ws });
  assert.deepEqual(one.record.related, ['mem_b'], '指定摘除应只去掉一个');
  const all = s.unlink(rec.record.id, '', { workspace: ws });
  assert.deepEqual(all.record.related, [], '不带 target 应清空');
});

test('mergeTag：合并大小写变体，全局库一并治理', () => {
  const s = iso('merge-tag');
  const ws = makeWorkspace('v03-merge-tag');
  s.upsert({ title: '标签甲', content: 'x', tags: ['DSH', '项目'] }, { workspace: ws });
  s.upsert({ title: '标签乙', content: 'x', tags: ['dsh'] }, { workspace: ws });
  s.upsert({ title: '标签丙', content: 'x', tags: ['别的'] }, { workspace: ws });
  s.upsert({ title: '全局标签', content: 'x', tags: ['DSH'], scope: 'global' }, { workspace: ws });

  const result = s.mergeTag(['DSH', 'dsh'], 'dsh', { workspace: ws });
  assert.equal(result.ok, true);
  /* 乙本来就写成 dsh，不算受影响；需要改的是甲与全局库那条。 */
  assert.equal(result.affected, 2, '两条带旧写法的记忆应更新（含全局库一条）');

  const all = s.list({ workspace: ws, includeArchived: true, includeDrafts: true }).records;
  const withDsh = all.filter((r) => (r.tags || []).includes('dsh'));
  assert.equal(withDsh.length, 3, '合并后统一为 dsh');
  assert.ok(all.every((r) => !(r.tags || []).includes('DSH')), '旧写法应被清除');
  assert.ok((all.find((r) => r.title === '标签甲').tags).includes('项目'), '无关标签应保留');

  const empty = s.mergeTag([], 'x', { workspace: ws });
  assert.equal(empty.ok, false, 'from 为空应拒绝');
});

test('briefing 预览口径：index 模式下 store.briefing 给出被选中的条目', () => {
  const s = iso('brief-preview');
  const ws = makeWorkspace('v03-brief-preview');
  s.upsert({ title: '置顶必进', content: 'x', category: 'fact', pinned: true }, { workspace: ws });
  s.upsert({ title: '普通条目', content: 'x', category: 'fact' }, { workspace: ws });
  const picked = s.briefing({ workspace: ws, limit: 5, maxChars: 2000, mode: 'index' });
  assert.equal(picked.length, 2, '两条都应进简报');
  assert.equal(picked[0].title, '置顶必进', '置顶应排最前');
});

/* ---------------- 画像层（portrait） ---------------- */

test('portrait: 保存与读取——版本 +1、正本同步、persistent=true', () => {
  const s = iso('portrait-basic');
  const ws = makeWorkspace('v04-portrait-basic');
  assert.equal(s.portrait(ws), null, '空库没有画像');

  const res = s.savePortrait(ws, {
    sections: [
      { key: 'background', text: '背景。' },
      { key: 'focus', text: '关注。' },
    ],
  });
  assert.equal(res.portrait.version, 1);
  assert.equal(res.mdWritten, true);

  const back = s.portrait(ws);
  assert.equal(back.version, 1);
  assert.equal(back.persistent, true);
  assert.equal(back.sections.find((x) => x.key === 'background').text, '背景。');
  assert.equal(back.sections.find((x) => x.key === 'recent').text, '');
});

test('portrait: evidence 与 sectionMeta 落库，历史快照保留证据', () => {
  const s = iso('portrait-evidence');
  const ws = makeWorkspace('v04-portrait-evidence');
  s.savePortrait(ws, {
    sections: [
      { key: 'background', text: '有证据的背景。' },
      { key: 'focus', text: '没有证据的关注。' },
    ],
    evidence: { background: ['mem_a', 'journal:2026-10-20'] },
  });
  const back = s.portrait(ws);
  assert.deepEqual(back.evidence.background, ['mem_a', 'journal:2026-10-20']);
  assert.equal(back.sectionMeta.background.evidenceCount, 2);
  assert.equal(back.sectionMeta.background.untraced, false);
  assert.equal(back.sectionMeta.focus.untraced, true);
  const info = s.portraitInfo(ws);
  const md = fs.readFileSync(info.mdFile, 'utf8');
  assert.match(md, /mem_a/, '正本里应能看到参考');
});

test('portrait: 手工保存——正文没变的段沿用证据，改过的段清空', () => {
  const s = iso('portrait-evidence-merge');
  const ws = makeWorkspace('v04-portrait-evidence-merge');
  s.savePortrait(ws, {
    sections: [
      { key: 'background', text: '背景一。' },
      { key: 'focus', text: '关注一。' },
    ],
    evidence: { background: ['mem_a'], focus: ['mem_b'] },
  });
  s.savePortrait(ws, {
    sections: [
      { key: 'background', text: '背景一。' },
      { key: 'focus', text: '关注改了。' },
    ],
  });
  const back = s.portrait(ws);
  assert.deepEqual(back.evidence.background, ['mem_a'], '没改的段应沿用证据');
  assert.equal(back.evidence.focus, undefined, '改过的段应清空证据');
  assert.equal(back.sectionMeta.focus.untraced, true);
});

test('portrait: PORTRAIT.md 正本生成，含标题与段头', () => {
  const s = iso('portrait-md');
  const ws = makeWorkspace('v04-portrait-md');
  s.savePortrait(ws, { sections: [{ key: 'background', text: '正本正文。' }] });
  const info = s.portraitInfo(ws);
  const md = fs.readFileSync(info.mdFile, 'utf8');
  assert.match(md, /# 工作区画像/);
  assert.match(md, /\*\*工作背景\*\*/);
  assert.match(md, /正本正文。/);
});

test('portrait: 只有 PORTRAIT.md（无 json）时回落读取，且不落盘', () => {
  const s = iso('portrait-import');
  const ws = makeWorkspace('v04-portrait-import');
  const info = s.portraitInfo(ws);
  fs.mkdirSync(path.dirname(info.mdFile), { recursive: true });
  fs.writeFileSync(
    info.mdFile,
    ['# 工作区画像 — x', '', '**工作背景**', '', '从正本读。'].join('\n'),
    'utf8',
  );
  const p = s.portrait(ws);
  assert.equal(p.persistent, false);
  assert.equal(p.version, 0);
  assert.equal(p.sections.find((x) => x.key === 'background').text, '从正本读。');
  assert.ok(!fs.existsSync(info.file), '回落读取不应自动写 portrait.json');
});

test('portrait: 版本递增、旧版快照留档、历史列表降序', () => {
  const s = iso('portrait-history');
  const ws = makeWorkspace('v04-portrait-history');
  s.savePortrait(ws, { sections: [{ key: 'background', text: 'v1' }] });
  s.savePortrait(ws, { sections: [{ key: 'background', text: 'v2' }] });
  const hist = s.portraitHistory(ws);
  assert.equal(hist[0].version, 2);
  assert.equal(hist[0].current, true);
  assert.equal(hist[1].version, 1);
  assert.equal(hist[1].current, false);
  const info = s.portraitInfo(ws);
  assert.ok(fs.existsSync(path.join(info.historyDir, 'v1.json')), 'v1 快照应留档');
});

test('portrait: 快照保留最近 10 版', () => {
  const s = iso('portrait-prune');
  const ws = makeWorkspace('v04-portrait-prune');
  for (let i = 0; i < 12; i += 1) {
    s.savePortrait(ws, { sections: [{ key: 'focus', text: `v${i}` }] });
  }
  const info = s.portraitInfo(ws);
  const files = fs.readdirSync(info.historyDir).filter((n) => /^v\d+\.json$/.test(n));
  assert.equal(files.length, 10);
  assert.ok(!files.includes('v1.json'), '最老的快照应被清掉');
});

test('portrait: 全局画像（root=""）独立读写，与工作区互不影响', () => {
  const s = iso('portrait-global');
  const ws = makeWorkspace('v04-portrait-global');
  const res = s.savePortrait('', { sections: [{ key: 'preference', text: '全局偏好。' }] });
  assert.equal(res.portrait.scope, 'global');
  const g = s.portrait('');
  assert.equal(g.scope, 'global');
  assert.equal(g.sections.find((x) => x.key === 'preference').text, '全局偏好。');
  assert.equal(s.portrait(ws), null, '全局与工作区互不影响');
});

test('portrait: portraitInfo 报告路径且不读内容', () => {
  const s = iso('portrait-info');
  const ws = makeWorkspace('v04-portrait-info');
  const info = s.portraitInfo(ws);
  assert.ok(info.file.endsWith('portrait.json'));
  assert.ok(info.mdFile.endsWith('PORTRAIT.md'));
  assert.ok(info.historyDir.endsWith('portrait.history'));
});

test('portrait draft: evidence 随草稿存取', () => {
  const s = iso('portrait-draft-evidence');
  const ws = makeWorkspace('v05-portrait-draft-evidence');
  s.portraitDraftWrite(ws, {
    sections: [{ key: 'background', text: '草稿背景。' }],
    evidence: { background: ['mem_z'] },
  });
  const draft = s.portraitDraftRead(ws);
  assert.deepEqual(draft.evidence.background, ['mem_z']);
  assert.equal(draft.sectionMeta.background.evidenceCount, 1);
});

test('injection 审计：记录正文与 hash，倒序读回，只留最近 500 条', () => {
  const s = iso('injection-log');
  const ws = makeWorkspace('v06-injection-log');
  const one = s.injectionLogAppend(ws, {
    sessionId: 's1',
    turn: 2,
    kind: 'briefing',
    mode: 'index',
    ids: ['mem_a', 'mem_b'],
    text: '真正进 prompt 的字节',
    dropped: [{ id: 'mem_c', title: '被挤掉' }],
  });
  assert.equal(one.ok, true);
  assert.equal(one.entry.hash.length, 16);
  assert.equal(one.entry.chars, '真正进 prompt 的字节'.length);

  const rows = s.injectionLogRead(ws, { limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'briefing');
  assert.equal(rows[0].text, '真正进 prompt 的字节');
  assert.deepEqual(rows[0].ids, ['mem_a', 'mem_b']);
  assert.equal(rows[0].dropped.length, 1);

  s.injectionLogAppend(ws, { kind: 'turn-recall', text: '尾部注入' });
  const recalls = s.injectionLogRead(ws, { kind: 'turn-recall' });
  assert.equal(recalls.length, 1);
  assert.equal(recalls[0].text, '尾部注入');

  for (let i = 0; i < 520; i += 1) s.injectionLogAppend(ws, { kind: 'briefing', text: `x${i}` });
  const all = s.injectionLogRead(ws, { limit: 1000 });
  assert.equal(all.length, 500, '只留最近 500 条');
});

/* ---------------- 日志层（journal）与重写稿（draft） ---------------- */

test('journal: 追加创建按天文件（标题 + 时间前缀）', () => {
  const s = iso('journal-basic');
  const ws = makeWorkspace('v05-journal-basic');
  const r1 = s.journalAppend(ws, { text: '第一条。', at: new Date('2026-10-15T10:05:00') });
  assert.equal(r1.ok, true);
  assert.equal(r1.date, '2026-10-15');
  assert.equal(r1.time, '10:05');
  const day = s.journalRead(ws, { date: '2026-10-15' });
  assert.match(day.text, /^# 2026-10-15\n/);
  assert.match(day.text, /- 10:05 第一条。/);
});

test('journal: 多行正文缩进、连续追加不覆盖、跨天分文件', () => {
  const s = iso('journal-multi');
  const ws = makeWorkspace('v05-journal-multi');
  s.journalAppend(ws, { text: '首行。\n第二行。', at: new Date('2026-10-14T09:00:00') });
  s.journalAppend(ws, { text: '次日。', at: new Date('2026-10-15T08:30:00') });
  const day1 = s.journalRead(ws, { date: '2026-10-14' }).text;
  assert.match(day1, /- 09:00 首行。\n {2}第二行。/);
  assert.ok(!day1.includes('次日。'), '不同天分文件');
  assert.deepEqual(s.journalDates(ws), ['2026-10-15', '2026-10-14']);
});

test('journal: 空文本拒绝；recent 限量并降序', () => {
  const s = iso('journal-recent');
  const ws = makeWorkspace('v05-journal-recent');
  assert.equal(s.journalAppend(ws, { text: '   ' }).ok, false);
  for (const day of ['2026-10-10', '2026-10-12', '2026-10-13']) {
    s.journalAppend(ws, { text: `d-${day}`, at: new Date(`${day}T12:00:00`) });
  }
  const recent = s.journalRecent(ws, { days: 2 });
  assert.equal(recent.length, 2);
  assert.equal(recent[0].date, '2026-10-13');
  assert.equal(recent[1].date, '2026-10-12');
  assert.match(recent[0].text, /d-2026-10-13/);
});

test('journal: 没写过的日期读出空串', () => {
  const s = iso('journal-missing');
  const ws = makeWorkspace('v05-journal-missing');
  assert.equal(s.journalRead(ws, { date: '2020-01-01' }).text, '');
  assert.deepEqual(s.journalDates(ws), []);
});

test('draft: 写 / 读 / 清（批准前对模型不可见）', () => {
  const s = iso('draft');
  const ws = makeWorkspace('v05-draft');
  assert.equal(s.portraitDraftRead(ws), null);
  s.portraitDraftWrite(ws, { sections: [{ key: 'background', text: '待审稿。' }], basedOn: { version: 2 } });
  const draft = s.portraitDraftRead(ws);
  assert.equal(draft.sections.find((x) => x.key === 'background').text, '待审稿。');
  assert.equal(draft.basedOn.version, 2);
  assert.equal(s.portrait(ws), null, 'draft 不影响正式画像');
  s.portraitDraftClear(ws);
  assert.equal(s.portraitDraftRead(ws), null);
});


/* ---------------- 质量分 / 衰减 / git 键 / 来源 ---------------- */

test('quality: 自动来源的低分条目直接归档，手工写入不拦', () => {
  const ws = makeWorkspace('v05-quality');
  const auto = store.upsert({ title: 'x', content: '太短', source: 'auto' }, { workspace: ws });
  assert.equal(auto.record.archiveReason, 'low_quality');
  assert.ok(auto.record.quality < 30);
  assert.equal(store.list({ workspace: ws, includeGlobal: false }).records.length, 0, '归档后不进列表');
  const manual = store.upsert({ title: 'y', content: '同样很短', source: 'manual' }, { workspace: ws });
  assert.equal(manual.record.archived, false, '手工条目不被质量闸门藏起来');
});

test('quality: 内容扎实的条目分数 >= 60 且带理由', () => {
  const ws = makeWorkspace('v05-quality-good');
  const r = store.upsert(
    {
      title: '发布纪律',
      content: '打 tag 前必须先在本地跑完整套件，绿了再推，不然 CI 会红两次。',
      category: 'convention',
      tags: ['release'],
      keywords: ['发布', 'CI'],
      source: 'agent',
    },
    { workspace: ws },
  ).record;
  assert.ok(r.quality >= 60, 'quality=' + r.quality);
  assert.ok(Array.isArray(r.qualityReasons));
});

test('decay: 半衰期 30 天、地板 0.5', () => {
  const now = new Date().toISOString();
  const thirty = new Date(Date.now() - 30 * 86400000).toISOString();
  const year = new Date(Date.now() - 365 * 86400000).toISOString();
  assert.equal(decayFactor(now), 1);
  assert.ok(Math.abs(decayFactor(thirty) - 0.5) < 0.02);
  assert.equal(decayFactor(year), 0.5);
  assert.equal(decayFactor(null), 0.5);
});

test('rankRecords stable: 不读使用次数与当前时间，顺序确定', () => {
  const ws = makeWorkspace('v05-stable');
  const older = store.upsert(
    { title: '旧约定', content: '一'.repeat(40), category: 'convention', createdAt: '2026-01-01T00:00:00.000Z' },
    { workspace: ws },
  ).record;
  const newer = store.upsert(
    { title: '新事实', content: '二'.repeat(40), category: 'fact', createdAt: '2026-02-01T00:00:00.000Z' },
    { workspace: ws },
  ).record;
  store.markUsed([newer.id], { workspace: ws });
  store.markUsed([newer.id], { workspace: ws });
  const records = store.list({ workspace: ws, limit: 50, includeGlobal: false }).records;
  const a = rankRecords(records, { limit: 10, stable: true });
  const b = rankRecords(records, { limit: 10, stable: true });
  assert.deepEqual(a.map((x) => x.record.id), b.map((x) => x.record.id));
  assert.equal(a[0].record.id, older.id, '同分时按 createdAt 升序');
});

test('adaptive floor: 短查询只留 Top1 一半以上的命中', () => {
  const ws = makeWorkspace('v05-floor');
  store.upsert({ title: 'keyword 在标题', content: '无关正文' }, { workspace: ws });
  store.upsert({ title: 'zzz plain', content: 'keyword 只在正文出现' }, { workspace: ws });
  const hits = store.search({ workspace: ws, query: 'keyword', limit: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'keyword 在标题');
});

test('git 键：仓库内工作区用 git- 前缀，且与路径键不同', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-git-'));
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  const key = workspaceKey(repo);
  assert.ok(key.startsWith('git-'), key);
  assert.notEqual(key, pathWorkspaceKey(repo));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('迁移：旧路径键目录里的记忆会被新键读到', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-migrate-'));
  const ws = path.join(base, 'repo');
  fs.mkdirSync(ws, { recursive: true });
  const legacyKey = pathWorkspaceKey(ws).slice(0, 8);
  const legacyDir = path.join(dir, 'workspaces', slugify(ws) + '-' + legacyKey);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'memories.json'),
    JSON.stringify({
      schemaVersion: 1,
      key: legacyKey,
      root: ws,
      records: [{ id: 'mem_legacy', title: '旧键里的记忆', content: '还在。' }],
    }),
  );
  const found = store.list({ workspace: ws, includeGlobal: false }).records;
  assert.equal(found.length, 1);
  assert.equal(found[0].title, '旧键里的记忆');
  fs.rmSync(base, { recursive: true, force: true });
});

test('来源与理由：reason/evidence 跨读写保留，supersede 也带过去', () => {
  const ws = makeWorkspace('v05-reason');
  const first = store.upsert(
    {
      title: '旧说法',
      content: '旧结论'.repeat(10),
      source: 'agent',
      reason: '用户当时明确要求',
      evidence: { quote: '以后都这样' },
    },
    { workspace: ws },
  ).record;
  const got = store.get(first.id, { workspace: ws });
  assert.equal(got.reason, '用户当时明确要求');
  assert.equal(got.evidence.quote, '以后都这样');
  const next = store.supersede(
    first.id,
    { title: '新说法', content: '新结论'.repeat(10), source: 'agent', reason: '情况变了' },
    { workspace: ws },
  );
  assert.equal(next.record.reason, '情况变了');
  assert.equal(store.get(first.id, { workspace: ws }).archived, true);
});

/* ---------------- 结果 ---------------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exit(failed ? 1 : 0);


