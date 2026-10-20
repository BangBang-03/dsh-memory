/**
 * dsh-memory 可执行校验测试：失效条件（falsifier）与到期复审队列。
 *   node test/verification.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemoryStore } from '../lib/store.js';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-verify-'));
const store = createMemoryStore({ dir: path.join(tmp, 'storage'), mirror: false });
const WS = path.join(tmp, 'ws');
fs.mkdirSync(WS, { recursive: true });

console.log(`\ndsh-memory verification tests  (tmp=${tmp})\n`);

const DAY = 86400000;

/* ---------------- 失效条件字段 ---------------- */

test('falsifier：显式字段被存下来', () => {
  const rec = store.upsert(
    {
      title: '检索用 BM25F',
      content: '排序走 BM25F，不走词重叠',
      category: 'decision',
      falsifier: '如果 store.js 里不再有 createBm25fIndex',
    },
    { workspace: WS },
  );
  assert.equal(rec.record.falsifier, '如果 store.js 里不再有 createBm25fIndex');
});

test('falsifier：正文里的「失效条件：…」会被提取成字段', () => {
  const rec = store.upsert(
    {
      title: '发版走 lab 分支',
      content: '日常改动进 lab。\n失效条件：如果仓库改成只有 main 一条线',
      category: 'convention',
    },
    { workspace: WS },
  );
  assert.equal(rec.record.falsifier, '如果仓库改成只有 main 一条线');
});

test('falsifier：没有失效条件的记忆不排期', () => {
  const rec = store.upsert({ title: '普通笔记', content: '随手记的一条' }, { workspace: WS });
  assert.equal(rec.record.falsifier, null);
  assert.equal(rec.record.reviewAt, null);
});

test('falsifier：显式空串可以清掉', () => {
  const rec = store.upsert(
    { title: '会被清掉的', content: '失效条件：x', category: 'note' },
    { workspace: WS },
  );
  assert.ok(rec.record.falsifier);
  const cleared = store.update(rec.record.id, { falsifier: '' }, { workspace: WS });
  assert.equal(cleared.record.falsifier, null);
});

/* ---------------- 复审排期 ---------------- */

test('复审：带失效条件的记忆默认按 90 天排期', () => {
  const rec = store.upsert(
    { title: '默认排期', content: '正文', category: 'decision', falsifier: '当 API 变了' },
    { workspace: WS },
  );
  assert.ok(rec.record.reviewAt, '应自动排期');
  const days = (Date.parse(rec.record.reviewAt) - Date.now()) / DAY;
  assert.ok(days > 85 && days <= 90, `排期应在 90 天内，实际 ${days.toFixed(1)} 天`);
});

test('复审：显式 reviewAt 覆盖默认排期', () => {
  const at = new Date(Date.now() + 7 * DAY).toISOString();
  const rec = store.upsert(
    { title: '自定义排期', content: '正文', category: 'decision', falsifier: '当 X 变了', reviewAt: at },
    { workspace: WS },
  );
  assert.equal(rec.record.reviewAt, at);
});

test('复审：TTL 可配置', () => {
  const dir2 = path.join(tmp, 'storage-ttl');
  const store2 = createMemoryStore({ dir: dir2, mirror: false, review: { days: 7 } });
  const rec = store2.upsert(
    { title: '短周期', content: '正文', category: 'decision', falsifier: '当 Y 变了' },
    { workspace: WS },
  );
  const days = (Date.parse(rec.record.reviewAt) - Date.now()) / DAY;
  assert.ok(days > 5 && days <= 7, `排期应在 7 天内，实际 ${days.toFixed(1)} 天`);
});

/* ---------------- 复审队列 ---------------- */

test('复审队列：过期的进 due，快到期的进 soon', () => {
  const ws2 = path.join(tmp, 'ws-queue');
  fs.mkdirSync(ws2, { recursive: true });
  const overdue = store.upsert(
    {
      title: '早就该复审',
      content: '正文',
      category: 'decision',
      falsifier: '当 Z 变了',
      reviewAt: new Date(Date.now() - 2 * DAY).toISOString(),
    },
    { workspace: ws2 },
  );
  const soon = store.upsert(
    {
      title: '快到期了',
      content: '正文',
      category: 'decision',
      falsifier: '当 W 变了',
      reviewAt: new Date(Date.now() + 3 * DAY).toISOString(),
    },
    { workspace: ws2 },
  );
  store.upsert({ title: '不用复审', content: '正文' }, { workspace: ws2 });

  const queue = store.reviewQueue(ws2, { withinDays: 30 });
  assert.equal(queue.due.length, 1);
  assert.equal(queue.due[0].id, overdue.record.id);
  assert.equal(queue.soon.length, 1);
  assert.equal(queue.soon[0].id, soon.record.id);
});

test('复审：markReviewed 记下复审时间并把到期推后', () => {
  const ws3 = path.join(tmp, 'ws-review');
  fs.mkdirSync(ws3, { recursive: true });
  const rec = store.upsert(
    {
      title: '复审对象',
      content: '正文',
      category: 'decision',
      falsifier: '当 Q 变了',
      reviewAt: new Date(Date.now() - DAY).toISOString(),
    },
    { workspace: ws3 },
  );
  assert.equal(store.reviewQueue(ws3).due.length, 1);

  const marked = store.markReviewed(rec.record.id, { workspace: ws3 });
  assert.equal(marked.ok, true);
  assert.ok(marked.record.reviewedAt, '应写上次复审时间');
  const days = (Date.parse(marked.record.reviewAt) - Date.now()) / DAY;
  assert.ok(days > 85, `到期应推后约 90 天，实际 ${days.toFixed(1)} 天`);
  assert.equal(store.reviewQueue(ws3).due.length, 0, '复审后不再到期');
});

test('复审：导入的旧数据带失效条件却没排期时，从今天起补排（不翻旧账）', () => {
  const dir = path.join(tmp, 'storage-legacy');
  const s = createMemoryStore({ dir, mirror: false });
  const ws = path.join(tmp, 'ws-legacy');
  fs.mkdirSync(ws, { recursive: true });
  const oldAt = new Date(Date.now() - 400 * DAY).toISOString();
  s.import(
    {
      records: [
        {
          id: 'mem_legacy1',
          title: '很久以前的约定',
          content: '正文',
          category: 'convention',
          falsifier: '当 X 变了这条就不成立',
          createdAt: oldAt,
          updatedAt: oldAt,
        },
      ],
    },
    { workspace: ws },
  );

  const rec = s.get('mem_legacy1', { workspace: ws });
  assert.ok(rec.reviewAt, '应补上排期');
  const days = (Date.parse(rec.reviewAt) - Date.now()) / DAY;
  assert.ok(days > 85, `应从今天起算，实际 ${days.toFixed(1)} 天`);
  assert.equal(s.reviewQueue(ws).due.length, 0, '不该一升级就冒出一堆欠账');
});

test('复审：体检会列出到期条目', () => {
  const ws4 = path.join(tmp, 'ws-health');
  fs.mkdirSync(ws4, { recursive: true });
  const rec = store.upsert(
    {
      title: '体检里的到期项',
      content: '正文',
      category: 'decision',
      falsifier: '当 P 变了',
      reviewAt: new Date(Date.now() - DAY).toISOString(),
    },
    { workspace: ws4 },
  );
  const health = store.health({ workspace: ws4 });
  assert.deepEqual(health.reviewDue, [rec.record.id]);
});

test('复审：不存在的 id 明确报错', () => {
  const marked = store.markReviewed('mem_not_exists', { workspace: WS });
  assert.equal(marked.ok, false);
  assert.equal(marked.error, 'not_found');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
