/**
 * dsh-memory HTTP API 测试（不需要起真实服务器）。
 *   node test/api.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createApi, API_PREFIX } = await import('../lib/api.js');
const { createMemoryStore, workspaceKey } = await import('../lib/store.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err && err.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-api-'));
const WS = process.platform === 'win32' ? 'C:\\proj\\记忆测试' : '/proj/memory-test';
const WS2 = process.platform === 'win32' ? 'C:\\proj\\other' : '/proj/other';

const store = createMemoryStore({ dir: path.join(tmp, 'storage') });
let settingsValue = { autoCapture: true, briefingBudget: 12 };
const settings = {
  get: () => ({ ...settingsValue }),
  set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in settingsValue) settingsValue[key] = value;
    }
    return { ...settingsValue };
  },
};

const api = createApi({
  store,
  settings,
  activeWorkspace: () => WS,
  listWorkspaces: () => [{ key: workspaceKey(WS), root: WS, active: true }],
  captures: () => [{ at: '2026-01-01T00:00:00.000Z', status: 'saved', count: 2 }],
  version: '0.1.0',
  distillNow: async ({ text }) => [{ title: text.slice(0, 20), content: text, category: 'note', tags: [], confidence: 0.9 }],
  captureNow: async () => ({ status: 'skipped', reason: 'no_active_session' }),
});

const call = (method, sub, { query = {}, body = null } = {}) =>
  api.handle({ method, pathname: `${API_PREFIX}${sub}`, query, body });

console.log(`\ndsh-memory api tests  (tmp=${tmp})\n`);

/* ---------------- ping / state ---------------- */

await test('GET /ping 返回版本', async () => {
  const res = await call('GET', '/ping');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.version, '0.1.0');
});

await test('前缀可以省略（pathname 直接给子路径）', async () => {
  const res = await api.handle({ method: 'GET', pathname: '/ping' });
  assert.equal(res.status, 200);
});

await test('GET /state 汇总面板首屏需要的全部信息', async () => {
  const res = await call('GET', '/state');
  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.version, '0.1.0');
  assert.equal(b.workspace.root, WS);
  assert.equal(b.workspace.key, workspaceKey(WS));
  assert.equal(b.settings.autoCapture, true);
  assert.equal(b.categories.length, 9);
  assert.equal(b.categories[0].label, '事实');
  assert.ok(Array.isArray(b.workspaces));
  assert.equal(b.captures.length, 1);
  assert.ok(b.stats);
});

await test('GET /state 可以指定其它工作区', async () => {
  const res = await call('GET', '/state', { query: { workspace: WS2 } });
  assert.equal(res.body.workspace.root, path.resolve(WS2));
});

/* ---------------- save ---------------- */

let savedId = null;

await test('POST /save 新建一条记忆', async () => {
  const res = await call('POST', '/save', {
    body: { title: '包管理器用 pnpm', content: '统一使用 pnpm。', category: 'convention', tags: ['tooling'] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.record.title, '包管理器用 pnpm');
  assert.equal(res.body.record.category, 'convention');
  savedId = res.body.record.id;
});

await test('POST /save 空内容被拒绝', async () => {
  const res = await call('POST', '/save', { body: { title: '   ', content: '' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'empty_memory');
});

await test('POST /save 带 id 时更新', async () => {
  const res = await call('POST', '/save', { body: { id: savedId, title: '包管理器固定用 pnpm', content: '统一使用 pnpm，禁止 npm。' } });
  assert.equal(res.body.record.id, savedId);
  assert.equal(res.body.record.title, '包管理器固定用 pnpm');
});

await test('POST /save 默认 source=manual，可指定 auto', async () => {
  const a = await call('POST', '/save', { body: { title: '手写' } });
  const b = await call('POST', '/save', { body: { title: '自动', source: 'auto' } });
  assert.equal(a.body.record.source, 'manual');
  assert.equal(b.body.record.source, 'auto');
  assert.equal(b.body.record.confidence, 0.6);
});

await test('POST /save scope=global 落全局', async () => {
  const res = await call('POST', '/save', { body: { title: '全局：用中文回复', scope: 'global', category: 'preference' } });
  assert.equal(res.body.record.scope, 'global');
});

/* ---------------- list ---------------- */

await test('GET /list 返回当前工作区 + 全局记忆', async () => {
  const res = await call('GET', '/list');
  assert.equal(res.status, 200);
  const titles = res.body.records.map((r) => r.title);
  assert.ok(titles.includes('包管理器固定用 pnpm'));
  assert.ok(titles.includes('全局：用中文回复'));
});

await test('GET /list 支持中文查询', async () => {
  const res = await call('GET', '/list', { query: { q: 'pnpm' } });
  assert.ok(res.body.records.length >= 1);
  assert.ok(res.body.records[0].title.includes('pnpm'));
});

await test('GET /list 支持 category 过滤', async () => {
  const res = await call('GET', '/list', { query: { category: 'convention' } });
  assert.ok(res.body.records.every((r) => r.category === 'convention'));
});

await test('GET /list 非法 category 被忽略而不是报错', async () => {
  const res = await call('GET', '/list', { query: { category: 'nonsense' } });
  assert.equal(res.status, 200);
  assert.ok(res.body.records.length > 0);
});

await test('GET /list scope=global 只看全局', async () => {
  const res = await call('GET', '/list', { query: { scope: 'global' } });
  assert.ok(res.body.records.every((r) => r.scope === 'global'));
});

await test('GET /list global=0 排除全局', async () => {
  const res = await call('GET', '/list', { query: { global: '0' } });
  assert.ok(!res.body.records.some((r) => r.scope === 'global'));
});

await test('GET /list 分页', async () => {
  const res = await call('GET', '/list', { query: { limit: '1', offset: '0' } });
  assert.equal(res.body.records.length, 1);
  assert.ok(res.body.total >= 2);
});

await test('GET /list limit 上限被夹紧', async () => {
  const res = await call('GET', '/list', { query: { limit: '999999' } });
  assert.equal(res.status, 200);
});

/* ---------------- update ---------------- */

await test('POST /update 置顶', async () => {
  const res = await call('POST', '/update', { body: { id: savedId, pinned: true } });
  assert.equal(res.body.record.pinned, true);
});

await test('POST /update 归档后默认列表不可见', async () => {
  await call('POST', '/update', { body: { id: savedId, archived: true } });
  const res = await call('GET', '/list');
  assert.ok(!res.body.records.some((r) => r.id === savedId));
  await call('POST', '/update', { body: { id: savedId, archived: false } });
});

await test('POST /update 非法 category 回落到 note', async () => {
  const res = await call('POST', '/update', { body: { id: savedId, category: '乱写' } });
  assert.equal(res.body.record.category, 'note');
  const back = await call('POST', '/update', { body: { id: savedId, category: 'convention' } });
  assert.equal(back.body.record.category, 'convention');
});

await test('POST /update 缺 id 返回 400', async () => {
  assert.equal((await call('POST', '/update', { body: {} })).status, 400);
});

await test('POST /update 未知 id 返回 404', async () => {
  assert.equal((await call('POST', '/update', { body: { id: 'mem_nope' } })).status, 404);
});

/* ---------------- bulk / delete ---------------- */

await test('POST /bulk 批量归档', async () => {
  const a = (await call('POST', '/save', { body: { title: 'bulk-1' } })).body.record;
  const b = (await call('POST', '/save', { body: { title: 'bulk-2' } })).body.record;
  const res = await call('POST', '/bulk', { body: { action: 'archive', ids: [a.id, b.id] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.affected, 2);
  const list = await call('GET', '/list');
  assert.ok(!list.body.records.some((r) => r.id === a.id));
  await call('POST', '/bulk', { body: { action: 'delete', ids: [a.id, b.id] } });
});

await test('POST /bulk 非法 action 返回 400', async () => {
  const res = await call('POST', '/bulk', { body: { action: 'explode', ids: ['x'] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_action');
});

await test('POST /bulk 空 ids 返回 400', async () => {
  assert.equal((await call('POST', '/bulk', { body: { action: 'delete', ids: [] } })).status, 400);
});

await test('POST /delete 删除单条', async () => {
  const rec = (await call('POST', '/save', { body: { title: '待删除' } })).body.record;
  const res = await call('POST', '/delete', { body: { id: rec.id } });
  assert.equal(res.status, 200);
  assert.equal(res.body.removed, rec.id);
  assert.equal((await call('POST', '/delete', { body: { id: rec.id } })).status, 404);
});

await test('POST /delete 缺 id 返回 400', async () => {
  assert.equal((await call('POST', '/delete', { body: {} })).status, 400);
});

/* ---------------- settings ---------------- */

await test('POST /settings 更新并回读', async () => {
  const res = await call('POST', '/settings', { body: { settings: { briefingBudget: 5 } } });
  assert.equal(res.body.settings.briefingBudget, 5);
  const state = await call('GET', '/state');
  assert.equal(state.body.settings.briefingBudget, 5);
  await call('POST', '/settings', { body: { settings: { briefingBudget: 12 } } });
});

await test('POST /settings 未知键被忽略', async () => {
  const res = await call('POST', '/settings', { body: { settings: { hacker: true } } });
  assert.equal(res.body.settings.hacker, undefined);
});

/* ---------------- export / import ---------------- */

await test('GET /export 与 POST /import 往返', async () => {
  const exported = (await call('GET', '/export')).body.export;
  assert.ok(exported.records.length > 0);
  const res = await call('POST', '/import', { body: { workspace: WS2, export: exported } });
  assert.equal(res.status, 200);
  assert.ok(res.body.imported.added > 0);
  const list = await call('GET', '/list', { query: { workspace: WS2, global: '0' } });
  assert.ok(list.body.records.length > 0);
});

await test('POST /import 纯文本按段落切分', async () => {
  const res = await call('POST', '/import', {
    body: { workspace: WS2, text: '- 第一条记忆内容\n补充说明\n\n- 第二条记忆内容' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.imported.added, 2);
});

await test('POST /import 空载荷返回 400', async () => {
  assert.equal((await call('POST', '/import', { body: { text: '   ' } })).status, 400);
});

/* ---------------- mirror / distill / capture ---------------- */

await test('GET /mirror 返回路径与 markdown 全文', async () => {
  const res = await call('GET', '/mirror');
  assert.equal(res.status, 200);
  assert.ok(res.body.mirror.dataFile.endsWith('memories.json'));
  assert.ok(res.body.mirror.markdown.includes('# 工作区长期记忆'));
});

await test('POST /distill 走注入的提炼函数', async () => {
  const res = await call('POST', '/distill', { body: { text: '用户希望所有输出都用中文' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.candidates.length, 1);
  assert.equal(res.body.candidates[0].content, '用户希望所有输出都用中文');
});

await test('POST /distill 空文本返回 400', async () => {
  assert.equal((await call('POST', '/distill', { body: { text: '' } })).status, 400);
});

await test('POST /capture 调用注入的捕获函数', async () => {
  const res = await call('POST', '/capture', { body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.capture.status, 'skipped');
});

/* ---------------- 失败路径 ---------------- */

await test('未知路由返回 404 并列出可用路由', async () => {
  const res = await call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'unknown_route');
  assert.ok(res.body.detail.known.includes('GET /list'));
  assert.ok(res.body.detail.known.includes('POST /save'));
});

await test('方法不匹配返回 404', async () => {
  assert.equal((await call('POST', '/state')).status, 404);
  assert.equal((await call('GET', '/save')).status, 404);
});

await test('handler 抛错返回 500 而不是崩溃', async () => {
  const broken = createApi({
    store: {
      ...store,
      stats() {
        throw new Error('boom');
      },
    },
    settings,
    activeWorkspace: () => WS,
  });
  const res = await broken.handle({ method: 'GET', pathname: `${API_PREFIX}/state` });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'handler_failed');
  assert.equal(res.body.detail.message, 'boom');
});

await test('无 distill/capture 注入时返回 501', async () => {
  const bare = createApi({ store, settings, activeWorkspace: () => WS });
  assert.equal((await bare.handle({ method: 'POST', pathname: `${API_PREFIX}/distill`, body: { text: 'x' } })).status, 501);
  assert.equal((await bare.handle({ method: 'POST', pathname: `${API_PREFIX}/capture`, body: {} })).status, 501);
});

await test('尾部斜杠与重复斜杠被归一化', async () => {
  assert.equal((await api.handle({ method: 'GET', pathname: `${API_PREFIX}/state/` })).status, 200);
});

await test('body 为空时不崩溃', async () => {
  assert.equal((await call('POST', '/save')).status, 400);
  assert.equal((await call('GET', '/list', { query: {} })).status, 200);
});

/* ---------------- 既有记忆导入 / 扫描 ---------------- */

const NOTE_FILE = path.join(tmp, 'MEMORY.md');
fs.writeFileSync(
  NOTE_FILE,
  '# dsh 工作区 — 项目长期笔记\n\n## 环境坑\n\n- profile 的 package.json 改前必须备份。\n\n## 用户偏好\n\n- UI 用鲸鱼蓝 #4d6bfe。\n',
  'utf8',
);
const QODER_FILE = path.join(tmp, 'user-delivery-expectations.md');
fs.writeFileSync(
  QODER_FILE,
  '---\nname: user-delivery-expectations\ndescription: 用户与交付期望\nmetadata:\n  type: user\n---\n\n要能真跑的权重。\n',
  'utf8',
);

await test('GET /import-scan 列出本机既有记忆来源（只读）', async () => {
  const res = await call('GET', '/import-scan', { query: { workspace: WS } });
  assert.equal(res.status, 200);
  const ids = res.body.scan.sources.map((source) => source.id);
  assert.deepEqual(ids, ['workspace-workbuddy', 'user-workbuddy', 'user-qoder', 'dsh-memory-mirror']);
  assert.equal(res.body.formats.text, '纯文本');
});

await test('POST /import 按 path 解析 WorkBuddy 笔记', async () => {
  const res = await call('POST', '/import', { body: { workspace: WS, path: NOTE_FILE } });
  assert.equal(res.status, 200);
  assert.equal(res.body.imported.added, 2);
  assert.equal(res.body.files[0].format, 'workbuddy');
  const list = await call('GET', '/list', { query: { workspace: WS } });
  const imported = list.body.records.filter((r) => r.source === 'import');
  assert.deepEqual(imported.map((r) => r.title).sort(), ['环境坑', '用户偏好']);
});

await test('POST /import 按 path 解析 Qoder frontmatter 并进全局库', async () => {
  const res = await call('POST', '/import', {
    body: { workspace: WS, path: QODER_FILE, scope: 'global' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.files[0].format, 'qoder');
  const global = await call('GET', '/list', { query: { workspace: '', key: '_global' } });
  const imported = global.body.records.find((r) => r.title === '用户与交付期望');
  assert.ok(imported, 'Qoder 记忆应进全局库');
  assert.equal(imported.category, 'user', 'Qoder 的 user 类型直通原生类别');
  assert.equal(imported.scope, 'global');
  assert.equal(imported.source, 'import');
});

await test('POST /import 读不到文件时报告每文件的错误而不是 500', async () => {
  const res = await call('POST', '/import', {
    body: { workspace: WS, paths: [path.join(tmp, 'nope.md'), NOTE_FILE] },
  });
  assert.equal(res.status, 200);
  assert.match(res.body.files[0].error, /ENOENT|no such file/i);
  assert.equal(res.body.files[1].records, 2);
});

await test('POST /import 文本 + format 走格式解析并回报识别结果', async () => {
  const res = await call('POST', '/import', {
    body: { workspace: WS, workspace2: 1, text: '# 2026-10-10\n\n## 今天\n\n- 修了镜像缺陷。\n', format: 'auto' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.detectedFormat, 'daily');
  assert.equal(res.body.formatLabel, '每日日志');
});

await test('POST /import format=text 保持空行分段行为', async () => {
  const res = await call('POST', '/import', {
    body: { workspace: WS, text: '# 标题\n\n第一段\n\n第二段\n', format: 'text' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.detectedFormat, 'text');
  assert.equal(res.body.imported.total, 3);
});

await test('POST /import-scan 按来源导入，用户级进全局库', async () => {
  const res = await call('POST', '/import-scan', { body: { workspace: WS, sources: ['user-qoder'], mode: 'merge' } });
  // 本机没有 ~/.qoder 时这里什么也扫不到，用显式 paths 兜底。
  if (res.status === 400) {
    const fallback = await call('POST', '/import-scan', {
      body: { workspace: WS, paths: [QODER_FILE, NOTE_FILE] },
    });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.files.length, 2);
    assert.ok(fallback.body.imported.total >= 3);
    return;
  }
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.files));
});

await test('POST /import-scan 什么都没选中时 400 nothing_selected', async () => {
  const res = await call('POST', '/import-scan', { body: { workspace: WS, sources: ['__nope__'] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'nothing_selected');
  assert.ok(Array.isArray(res.body.detail.sources));
});

/* ---------------- v0.3.0：体检 / 时间线 / 审批队列 / 版本链 ---------------- */

await test('POST /save 带 supersedes 走版本链；/supersede/rollback 可回滚', async () => {
  const old = await call('POST', '/save', { body: { title: '版本旧条', content: 'webpack 时代', category: 'decision' } });
  const sup = await call('POST', '/save', {
    body: { title: '版本新条', content: 'vite 时代', category: 'decision', supersedes: old.body.record.id },
  });
  assert.equal(sup.status, 200);
  assert.equal(sup.body.superseded.id, old.body.record.id);
  assert.equal(store.get(old.body.record.id, { workspace: WS }).archived, true, '旧条应被归档');

  const bad = await call('POST', '/save', { body: { title: 'x', content: 'y', supersedes: 'mem_nope' } });
  assert.equal(bad.status, 404);
  assert.equal(bad.body.error, 'supersede_target_not_found');

  const rb = await call('POST', '/supersede/rollback', { body: { id: sup.body.record.id } });
  assert.equal(rb.status, 200);
  assert.equal(rb.body.restored, old.body.record.id);
  assert.equal(store.get(old.body.record.id, { workspace: WS }).archived, false, '回滚后旧条应恢复');
});

await test('GET /health 报告重复、断链与草稿；POST /health/resolve 一键处理', async () => {
  await call('POST', '/save', { body: { title: '体检重复甲', content: '体检专用的重复内容描述' } });
  await call('POST', '/save', { body: { title: '体检重复乙', content: '体检专用的重复内容描述' } });
  const linked = await call('POST', '/save', { body: { title: '断链条目', content: 'x', related: ['mem_missing'] } });
  store.upsert({ title: 'API 体检草稿', content: 'x', status: 'draft', source: 'auto' }, { workspace: WS });

  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.ok(health.body.health.duplicates.length >= 1, '应报重复簇');
  assert.ok(health.body.health.broken.some((b) => b.target === 'mem_missing'), '应报断链');
  assert.ok(health.body.health.drafts >= 1, '应报草稿数');
  assert.ok(health.body.health.duplicates[0][0].title, '重复簇应带标题方便展示');

  // 共享 store 里可能有别的测试留下的重复簇，定位本用例造的那一簇。
  const dupCluster = health.body.health.duplicates.find((cluster) =>
    cluster.some((item) => item.title === '体检重复甲'),
  );
  assert.ok(dupCluster, '应报出体检重复簇');
  const merged = await call('POST', '/health/resolve', {
    body: { action: 'merge', ids: dupCluster.map((item) => item.id), title: '体检合并' },
  });
  assert.equal(merged.status, 200);
  assert.ok(merged.body.merged.content.includes('甲'), '合并正文应含来源');

  const unlink = await call('POST', '/health/resolve', {
    body: { action: 'unlink', id: linked.body.record.id, target: 'mem_missing' },
  });
  assert.equal(unlink.status, 200);
  const after = await call('GET', '/health');
  assert.equal(after.body.health.broken.filter((b) => b.target === 'mem_missing').length, 0, '断链应被摘除');

  const bad = await call('POST', '/health/resolve', { body: { action: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_action');
});

await test('GET /timeline：含归档，按更新时间倒序', async () => {
  const first = await call('POST', '/save', { body: { title: '时间线甲', content: 'x' } });
  await call('POST', '/update', { body: { id: first.body.record.id, archived: true } });
  await call('POST', '/save', { body: { title: '时间线乙', content: 'x' } });
  const tl = await call('GET', '/timeline');
  const titles = tl.body.records.map((r) => r.title);
  assert.ok(titles.includes('时间线甲'), '归档条目也应在时间线里');
  assert.ok(titles.indexOf('时间线乙') < titles.indexOf('时间线甲'), '应按更新时间倒序');
});

await test('草稿队列：/queue 可见 → /queue/approve 生效（带编辑）→ /queue/reject 删除', async () => {
  const draft = store.upsert(
    { title: '待审草稿', content: '草稿正文', category: 'note', status: 'draft', source: 'auto' },
    { workspace: WS },
  );
  const queue = await call('GET', '/queue');
  assert.ok(queue.body.records.some((r) => r.id === draft.record.id), '草稿应在队列里');
  const normal = await call('GET', '/list');
  assert.equal(normal.body.records.some((r) => r.id === draft.record.id), false, '草稿不进默认列表');

  const approved = await call('POST', '/queue/approve', {
    body: { id: draft.record.id, title: '批准后的标题', category: 'fact' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.record.status, 'active');
  assert.equal(approved.body.record.title, '批准后的标题');
  assert.equal(approved.body.record.category, 'fact');
  assert.ok((await call('GET', '/list')).body.records.some((r) => r.id === draft.record.id), '批准后进默认列表');

  const draft2 = store.upsert({ title: '要拒绝的草稿', content: 'x', status: 'draft', source: 'auto' }, { workspace: WS });
  const rejected = await call('POST', '/queue/reject', { body: { id: draft2.record.id } });
  assert.equal(rejected.body.removed, draft2.record.id);
  assert.equal(store.get(draft2.record.id, { workspace: WS, includeDrafts: true }), null, '拒绝即删除');

  const missing = await call('POST', '/queue/approve', { body: { id: 'mem_nope' } });
  assert.equal(missing.status, 404);
});

await test('草稿带 supersedes：批准即兑现版本链，草稿被新头取代', async () => {
  const old = await call('POST', '/save', { body: { title: '链上旧条', content: '旧结论', category: 'decision' } });
  const draft = store.upsert(
    { title: '链上草稿', content: '新结论', category: 'decision', status: 'draft', source: 'auto', supersedes: old.body.record.id },
    { workspace: WS },
  );
  const approved = await call('POST', '/queue/approve', { body: { id: draft.record.id } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.superseded.id, old.body.record.id, '批准应兑现版本链');
  assert.equal(approved.body.record.supersedes, old.body.record.id);
  assert.notEqual(approved.body.record.id, draft.record.id, '新头应是新 id（草稿 id 不复用）');
  assert.equal(store.get(old.body.record.id, { workspace: WS }).archived, true);
  assert.equal(store.get(draft.record.id, { workspace: WS, includeDrafts: true }), null, '草稿应被移除');
});



console.log(`\n${passed} passed, ${failed} failed\n`);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exit(failed ? 1 : 0);
