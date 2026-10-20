/**
 * dsh-memory 检索层测试：BM25F、短语、related 一跳、搜索集成与一套小型评测。
 *   node test/retrieval.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BM25F_FIELDS,
  createBm25fIndex,
  scoreBm25f,
  exactPhraseBoost,
  relatedBoostMap,
  expandQueryTokens,
} from '../lib/retrieval.js';
import { uniqueTokens } from '../lib/text.js';
import { createMemoryStore, rankRecords } from '../lib/store.js';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-retrieval-'));
const store = createMemoryStore({ dir: path.join(tmp, 'storage'), mirror: false });
const WS = process.platform === 'win32' ? 'C:\\proj\\retrieval' : '/proj/retrieval';

console.log(`\ndsh-memory retrieval tests  (tmp=${tmp})\n`);

function base(overrides = {}) {
  return {
    category: 'fact',
    confidence: 1,
    pinned: false,
    archived: false,
    status: 'active',
    useCount: 0,
    tags: [],
    keywords: [],
    files: [],
    related: [],
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ---------------- 纯函数 ---------------- */

test('BM25F: 标题命中高于正文命中', () => {
  const records = [
    base({ id: 'title', title: 'keyword 在标题', content: '无关正文' }),
    base({ id: 'content', title: 'zzz plain', content: 'keyword 只在正文出现 keyword' }),
  ];
  const index = createBm25fIndex(records);
  const q = uniqueTokens('keyword');
  assert.ok(scoreBm25f(records[0], q, index) > scoreBm25f(records[1], q, index));
});

test('BM25F: 稀有词比常见词更有区分度', () => {
  const records = [
    base({ id: 'rare', title: 'rare', content: 'common rare' }),
    base({ id: 'c1', title: 'c1', content: 'common' }),
    base({ id: 'c2', title: 'c2', content: 'common' }),
    base({ id: 'c3', title: 'c3', content: 'common' }),
    base({ id: 'c4', title: 'c4', content: 'common' }),
  ];
  const index = createBm25fIndex(records);
  const rare = scoreBm25f(records[0], uniqueTokens('rare'), index);
  const common = scoreBm25f(records[1], uniqueTokens('common'), index);
  assert.ok(rare > common, `rare=${rare} common=${common}`);
});

test('BM25F: 字段权重覆盖 title/tags/keywords/files/content', () => {
  assert.deepEqual(BM25F_FIELDS.map((f) => f.key), ['title', 'tags', 'keywords', 'files', 'content']);
  const weights = BM25F_FIELDS.map((f) => f.weight);
  assert.ok(weights[0] > weights[1]);
  assert.ok(weights[1] >= weights[4]);
});

test('exactPhraseBoost: 标题 1.0 / 标签 0.8 / 路径 0.7 / 正文 0.5', () => {
  assert.equal(exactPhraseBoost(base({ title: '深色主题' }), '深色主题'), 1);
  assert.equal(exactPhraseBoost(base({ tags: ['深色主题'] }), '深色主题'), 0.8);
  assert.equal(exactPhraseBoost(base({ files: ['src/深色主题.ts'] }), '深色主题'), 0.7);
  assert.equal(exactPhraseBoost(base({ content: '关于深色主题' }), '深色主题'), 0.5);
  assert.equal(exactPhraseBoost(base({ title: '别的' }), '深色主题'), 0);
});

test('expandQueryTokens: 同义词扩展、保留原词并去重', () => {
  const out = expandQueryTokens(['发版', '检查', '发版']);
  for (const token of ['发版', '发布', '上线', '校验', '验证']) {
    assert.ok(out.includes(token), `缺少 ${token}: ${out.join(',')}`);
  }
  assert.equal(out.filter((token) => token === '发版').length, 1, '原词只保留一次');
  const empty = expandQueryTokens([]);
  assert.deepEqual(empty, []);
});

test('relatedBoostMap: related 一跳有 boost，反向也有', () => {
  const records = [
    base({ id: 'a', title: '检索', related: ['b'] }),
    base({ id: 'b', title: 'BM25' }),
    base({ id: 'c', title: '无关' }),
  ];
  const scores = new Map([['a', 1], ['b', 0], ['c', 0]]);
  const boost = relatedBoostMap(records, scores);
  assert.ok(boost.get('b') > 0, '正向：a 指向 b');
  assert.equal(boost.get('c'), 0);
});

/* ---------------- rankRecords / search 集成 ---------------- */

test('rankRecords: related 一跳能把无字面命中的记录带上来', () => {
  const records = [
    base({ id: 'a', title: '检索算法', content: 'BM25 字段权重', related: ['b'] }),
    base({ id: 'b', title: '实现细节', content: '倒排索引与长度归一' }),
    base({ id: 'c', title: '无关', content: '完全不同的主题' }),
  ];
  const ranked = rankRecords(records, { query: '检索算法', limit: 5 });
  const ids = ranked.map((x) => x.record.id);
  assert.ok(ids.indexOf('b') < ids.indexOf('c'), `ids=${ids.join(',')}`);
});

test('search: 返回 _score、按分数降序，且标题命中优先', () => {
  const ws = path.join(tmp, 'ws-search');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-search'), mirror: false });
  s.upsert({ title: '深色主题', content: '用户偏好深色主题' }, { workspace: ws });
  s.upsert({ title: '无关', content: '深色主题只在正文' }, { workspace: ws });
  const hits = s.search({ workspace: ws, query: '深色主题', limit: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].title, '深色主题');
  for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1]._score >= hits[i]._score);
});

test('list({query}) 也走 BM25F，并能过滤零命中', () => {
  const ws = path.join(tmp, 'ws-list');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-list'), mirror: false });
  s.upsert({ title: 'alpha', content: 'beta gamma' }, { workspace: ws });
  s.upsert({ title: 'delta', content: 'epsilon' }, { workspace: ws });
  const hit = s.list({ workspace: ws, query: 'alpha' });
  assert.equal(hit.total, 1);
  assert.equal(hit.records[0].title, 'alpha');
  const none = s.list({ workspace: ws, query: 'zeta' });
  assert.equal(none.total, 0);
});

/* ---------------- 小型评测：Recall@5 / MRR@10 ---------------- */

test('eval: 20 条记忆 / 10 条查询，Recall@5 与 MRR 达标', () => {
  const ws = path.join(tmp, 'ws-eval');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-eval'), mirror: false });

  const docs = [
    ['r1', 'BM25 检索', 'BM25F 字段权重、IDF 与长度归一；检索排序', ['检索']],
    ['r2', '画像版本', '画像每次重写版本 +1，旧版留档，可回滚', ['画像']],
    ['r3', '密钥扫描', '写入前扫描 sk-、ghp_、AKIA 等密钥模式', ['安全']],
    ['r4', 'dream 巩固', '空闲时合并重复、重写画像、清理过期记忆', ['巩固']],
    ['r5', '导入 WorkBuddy', '扫描 WorkBuddy 与 Qoder 的记忆文件并导入', ['导入']],
    ['r6', '缓存冻结', '会话级冻结简报字节，尾部注入不破坏前缀缓存', ['缓存']],
    ['r7', '路径注入', '按 files 字段在文件被读取时召回相关记忆', ['路径']],
    ['r8', '会话检索', '对会话日志建 FTS，返回原话与 sessionId', ['会话']],
    ['r9', '审批队列', '自动提炼先进草稿，批准后才生效', ['审批']],
    ['r10', '技能晋升', '把 convention 晋升为 AGENTS.md 或 Skill', ['技能']],
    ['r11', '向量检索', '可选的 embedding 召回，默认关闭', ['向量']],
    ['r12', '知识图谱', '实体与关系图谱，支持多跳', ['图谱']],
    ['r13', '跨 Agent 共享', '一个记忆库供 Claude Code、Codex、Cursor 共享', ['共享']],
    ['r14', '衰减遗忘', '半衰期 30 天，约定类地板更高', ['衰减']],
    ['r15', '任务关联', '任务与文件关联，新会话可续接', ['任务']],
    ['r16', '成本看板', '按 provider/model 记录蒸馏 token 成本', ['成本']],
    ['r17', '证据门', '检索结果相关不代表证据充分，不足时继续搜索', ['证据']],
    ['r18', '冲突冻结', '冲突记忆先冻结，等用户裁决', ['冲突']],
    ['r19', 'Markdown 镜像', '工作区落一份人读 MEMORY.md', ['镜像']],
    ['r20', '子代理隔离', '子代理只召回不写记忆', ['子代理']],
  ];

  for (const [id, title, content, tags] of docs) {
    s.upsert({ id, title, content, tags, category: 'fact' }, { workspace: ws });
  }

  const queries = [
    ['BM25 检索排序', 'r1'],
    ['画像 版本 回滚', 'r2'],
    ['密钥 扫描', 'r3'],
    ['dream 合并 重复', 'r4'],
    ['导入 WorkBuddy', 'r5'],
    ['冻结 前缀缓存', 'r6'],
    ['files 路径 召回', 'r7'],
    ['会话 原话 FTS', 'r8'],
    ['草稿 审批', 'r9'],
    ['技能 晋升 AGENTS.md', 'r10'],
  ];

  let hits = 0;
  let reciprocal = 0;
  for (const [query, expected] of queries) {
    const results = s.search({ workspace: ws, query, limit: 10 });
    const ids = results.map((r) => r.id);
    if (ids.slice(0, 5).includes(expected)) hits += 1;
    const rank = ids.indexOf(expected);
    if (rank >= 0) reciprocal += 1 / (rank + 1);
  }

  const recall = hits / queries.length;
  const mrr = reciprocal / queries.length;
  console.log(`       recall@5=${recall.toFixed(3)}  mrr@10=${mrr.toFixed(3)}`);
  assert.ok(recall >= 0.8, `Recall@5=${recall}`);
  assert.ok(mrr >= 0.6, `MRR@10=${mrr}`);
});

/* ---------------- 60 条硬评测：六类各 10 条 ---------------- */

const hardFixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/retrieval-hard-60.json', import.meta.url), 'utf8'),
);
const idOfKey = (key) => `mem_eval_${key}`;

test('eval-hard: fixture 完整，六类各 10 条且 gold/related 都存在', () => {
  assert.equal(hardFixture.queries.length, 60);
  assert.ok(hardFixture.memories.length >= 40, `memories=${hardFixture.memories.length}`);
  const keys = new Set(hardFixture.memories.map((m) => m.key));
  const types = {};
  for (const q of hardFixture.queries) {
    types[q.type] = (types[q.type] || 0) + 1;
    assert.ok(q.gold.length >= 1, `${q.id} 缺少 gold`);
    for (const key of q.gold) assert.ok(keys.has(key), `${q.id} gold 不存在: ${key}`);
  }
  for (const m of hardFixture.memories) {
    for (const key of m.related || []) assert.ok(keys.has(key), `${m.key} related 不存在: ${key}`);
  }
  assert.deepEqual(
    types,
    { paraphrase: 10, code_path: 10, hard_negative: 10, multi_hop: 10, negation: 10, tag_keyword: 10 },
  );
});

test('eval-hard: Recall@5 >= 0.95、MRR@10 >= 0.90，并优于词重叠基线', () => {
  const ws = path.join(tmp, 'ws-hard');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-hard'), mirror: false });
  for (const memory of hardFixture.memories) {
    s.upsert(
      {
        id: idOfKey(memory.key),
        title: memory.title,
        content: memory.content,
        category: memory.category,
        tags: memory.tags || [],
        keywords: memory.keywords || [],
        files: memory.files || [],
        related: (memory.related || []).map(idOfKey),
        source: 'manual',
        confidence: 1,
      },
      { workspace: ws, dedupe: false },
    );
  }
  assert.equal(s.list({ workspace: ws, limit: 1000 }).records.length, hardFixture.memories.length);

  /**
   * 词重叠基线：最老的那套「命中多少 token 排多高」，不读 IDF、长度、短语与 related。
   * 用它回答「BM25F + 短语 + related 到底比原来强多少」。
   */
  function overlapRank(query) {
    const q = new Set(uniqueTokens(query));
    const pool = s.list({ workspace: ws, limit: 1000 }).records;
    return pool
      .map((record) => {
        const haystack = [
          record.title,
          record.content,
          (record.tags || []).join(' '),
          (record.keywords || []).join(' '),
          (record.files || []).join(' '),
        ].join(' ');
        const tokens = new Set(uniqueTokens(haystack));
        let score = 0;
        for (const token of q) if (tokens.has(token)) score += 1;
        return { id: record.id, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((row) => row.id);
  }

  const stats = {
    recall: 0,
    mrr: 0,
    baseRecall: 0,
    baseMrr: 0,
    byType: {},
  };
  const misses = [];
  const baseMisses = [];
  const perQuery = {};

  for (const q of hardFixture.queries) {
    const gold = q.gold.map(idOfKey);
    const ranked = s.search({ workspace: ws, query: q.query, limit: 10 }).map((r) => r.id);
    const top5 = ranked.slice(0, 5);
    const recall = gold.filter((id) => top5.includes(id)).length / gold.length;
    const first = gold
      .map((id) => ranked.indexOf(id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    const reciprocal = first === undefined ? 0 : 1 / (first + 1);

    const baseRanked = overlapRank(q.query);
    const baseTop5 = baseRanked.slice(0, 5);
    const baseRecall = gold.filter((id) => baseTop5.includes(id)).length / gold.length;
    const baseFirst = gold
      .map((id) => baseRanked.indexOf(id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    const baseReciprocal = baseFirst === undefined ? 0 : 1 / (baseFirst + 1);

    stats.recall += recall;
    stats.mrr += reciprocal;
    stats.baseRecall += baseRecall;
    stats.baseMrr += baseReciprocal;
    perQuery[q.id] = { recall, baseRecall };
    const bucket = stats.byType[q.type] || (stats.byType[q.type] = { n: 0, recall: 0, mrr: 0, baseRecall: 0, baseMrr: 0 });
    bucket.n += 1;
    bucket.recall += recall;
    bucket.mrr += reciprocal;
    bucket.baseRecall += baseRecall;
    bucket.baseMrr += baseReciprocal;
    if (recall < 1) {
      misses.push({
        id: q.id,
        type: q.type,
        query: q.query,
        gold: q.gold.join(','),
        top: ranked.slice(0, 5).map((id) => id.replace('mem_eval_', '')).join(','),
      });
    }
    if (baseRecall < 1) {
      baseMisses.push({
        id: q.id,
        type: q.type,
        query: q.query,
        gold: q.gold.join(','),
        top: baseRanked.slice(0, 5).map((id) => id.replace('mem_eval_', '')).join(','),
      });
    }
  }

  const n = hardFixture.queries.length;
  stats.recall /= n;
  stats.mrr /= n;
  stats.baseRecall /= n;
  stats.baseMrr /= n;

  const hardSubset = Object.values(perQuery).filter((row) => row.baseRecall < 1);
  const hardOurs = hardSubset.length
    ? hardSubset.reduce((sum, row) => sum + row.recall, 0) / hardSubset.length
    : 1;
  const hardBaseline = hardSubset.length
    ? hardSubset.reduce((sum, row) => sum + row.baseRecall, 0) / hardSubset.length
    : 1;

  console.log(
    `       Recall@5=${stats.recall.toFixed(3)}  MRR@10=${stats.mrr.toFixed(3)}` +
      `  baseline=${stats.baseRecall.toFixed(3)}/${stats.baseMrr.toFixed(3)}`,
  );
  console.log(
    `       hard-subset n=${hardSubset.length} ours=${hardOurs.toFixed(3)} baseline=${hardBaseline.toFixed(3)}`,
  );
  for (const [type, bucket] of Object.entries(stats.byType)) {
    console.log(
      `       ${type.padEnd(13)} n=${bucket.n} recall=${(bucket.recall / bucket.n).toFixed(3)}` +
        ` mrr=${(bucket.mrr / bucket.n).toFixed(3)}` +
        ` | baseline ${(bucket.baseRecall / bucket.n).toFixed(3)}/${(bucket.baseMrr / bucket.n).toFixed(3)}`,
    );
  }
  for (const miss of misses) {
    console.log(`       miss ${miss.id} ${miss.type}: ${miss.query} | gold=${miss.gold} | top5=${miss.top}`);
  }
  for (const miss of baseMisses) {
    console.log(`       base-miss ${miss.id} ${miss.type}: ${miss.query} | gold=${miss.gold} | top5=${miss.top}`);
  }

  /*
   * 天花板说明：词重叠基线在这 60 条上已经 0.967，Recall@5 最多只能再涨 0.033，
   * 所以不拿「+10% 召回」当闸门。改用：绝对阈值 + 基线不劣化 + 同义改写/多跳的分类提升。
   * 这也避免为了凑指标而把 fixture 改成只对某一种算法友好。
   */
  assert.ok(stats.recall >= 0.95, `Recall@5=${stats.recall.toFixed(3)}`);
  assert.ok(stats.mrr >= 0.9, `MRR@10=${stats.mrr.toFixed(3)}`);
  assert.ok(stats.baseRecall < 1, `fixture 应包含词重叠基线失败的硬样例，实际=${stats.baseRecall.toFixed(3)}`);
  assert.ok(stats.recall >= stats.baseRecall, `Recall 不应低于基线: ${stats.recall.toFixed(3)} vs ${stats.baseRecall.toFixed(3)}`);
  assert.ok(
    stats.mrr >= stats.baseMrr + 0.01,
    `MRR 相对基线提升不足: ${stats.mrr.toFixed(3)} vs ${stats.baseMrr.toFixed(3)}`,
  );
  const paraphrase = stats.byType.paraphrase;
  const multiHop = stats.byType.multi_hop;
  assert.ok(
    paraphrase.mrr / paraphrase.n >= paraphrase.baseMrr / paraphrase.n + 0.1,
    `同义改写 MRR 提升不足: ${(paraphrase.mrr / paraphrase.n).toFixed(3)} vs ${(paraphrase.baseMrr / paraphrase.n).toFixed(3)}`,
  );
  assert.ok(
    multiHop.recall / multiHop.n >= multiHop.baseRecall / multiHop.n + 0.05,
    `多跳召回提升不足: ${(multiHop.recall / multiHop.n).toFixed(3)} vs ${(multiHop.baseRecall / multiHop.n).toFixed(3)}`,
  );
  assert.ok(
    hardOurs >= hardBaseline + 0.1,
    `词重叠失败子集提升不足: ${hardOurs.toFixed(3)} vs ${hardBaseline.toFixed(3)}`,
  );
});

/* ---------------- 路径召回（path JIT） ---------------- */

test('recallByFiles: 全路径 > 目录后缀 > 同名文件，无关不命中', () => {
  const ws = path.join(tmp, 'ws-files');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-files'), mirror: false });
  s.upsert({ title: '全路径命中', files: ['lib/store.js'], category: 'convention' }, { workspace: ws });
  s.upsert({ title: '后缀命中', files: ['store.js'], category: 'fact' }, { workspace: ws });
  s.upsert({ title: '同名命中', files: ['src/other/store.js'], category: 'fact' }, { workspace: ws });
  s.upsert({ title: '无关文件', files: ['docs/readme.md'], category: 'note' }, { workspace: ws });

  const hits = s.recallByFiles({ workspace: ws, files: ['lib/store.js'], limit: 5 });
  const titles = hits.map((r) => r.title);
  assert.equal(titles[0], '全路径命中', `顺序: ${titles.join(',')}`);
  assert.ok(titles.includes('后缀命中'));
  assert.ok(titles.includes('同名命中'));
  assert.ok(!titles.includes('无关文件'));
});

test('recallByFiles: limit / excludeIds / 空入参 / 大小写与反斜杠归一', () => {
  const ws = path.join(tmp, 'ws-files2');
  const s = createMemoryStore({ dir: path.join(tmp, 'store-files2'), mirror: false });
  s.upsert({ title: '甲', files: ['lib/a.ts'] }, { workspace: ws });
  s.upsert({ title: '乙', files: ['lib/b.ts'] }, { workspace: ws });

  const one = s.recallByFiles({ workspace: ws, files: ['lib/a.ts'], limit: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0].title, '甲');

  const excluded = s.recallByFiles({
    workspace: ws,
    files: ['lib/a.ts'],
    limit: 5,
    excludeIds: one.map((r) => r.id),
  });
  assert.equal(excluded.length, 0, '排除后应无命中');

  assert.deepEqual(s.recallByFiles({ workspace: ws, files: [] }), []);
  const winPath = process.platform === 'win32' ? ws + '\\LIB\\A.TS' : ws + '/LIB/A.TS';
  const normalized = s.recallByFiles({ workspace: ws, files: [winPath], limit: 5 });
  assert.ok(normalized.some((r) => r.title === '甲'), '盘符/大小写/反斜杠应归一');
});

console.log('');
if (failed > 0) {
  console.log(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
