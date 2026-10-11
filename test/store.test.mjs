/**
 * dsh-memory 存储层测试：脱离 DSH 直接跑。
 *   node test/store.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = await import('../lib/store.js');
const {
  createMemoryStore,
  workspaceKey,
  slugify,
  tokenize,
  similarity,
  rankRecords,
  renderMarkdown,
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

/* ---------------- 结果 ---------------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exit(failed ? 1 : 0);


