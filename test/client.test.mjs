/**
 * dsh-memory 客户端半测试：把 lib/client.js 真的渲染出来，并接到真实的
 * lib/api.js + lib/store.js 上驱动交互（列表 / 搜索 / 新建 / 删除 / 国际化）。
 *
 *   node test/client.test.mjs
 *
 * 这里不需要 DSH，也不需要 React：test/mini-react.mjs 提供极小的 hook 运行时，
 * fetch 被换成直通 api.handle 的适配器。所以客户端页面里任何崩溃、契约错位、
 * 数据流断裂都会在这里暴露。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMiniReact } from './mini-react.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

const { createApi, API_PREFIX } = await import('../lib/api.js');
const { createMemoryStore } = await import('../lib/store.js');

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------ *
 * 真实后端：store + api，写在临时目录里
 * ------------------------------------------------------------------ */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-client-'));
const WS = process.platform === 'win32' ? 'C:\\proj\\记忆客户端' : '/proj/memory-client';

const store = createMemoryStore({ dir: path.join(tmp, 'storage'), mirror: true });

let settingsValue = {
  enabled: true,
  briefing: true,
  briefingLimit: 12,
  autoCapture: false,
  minConfidence: 0.4,
};
const settings = {
  get: () => ({ ...settingsValue }),
  set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in settingsValue) settingsValue[key] = value;
    }
    return settings.get();
  },
};

const captures = [];
const api = createApi({
  store,
  settings,
  activeWorkspace: () => WS,
  listWorkspaces: () => [{ root: WS, key: 'k', count: 0, active: true }],
  captures: () => captures,
  version: '0.1.0',
  captureNow: async () => ({ ok: true, saved: 1, reason: 'test' }),
  distillNow: async ({ text }) => ({
    candidates: [{ title: text.slice(0, 20), content: text, category: 'note', tags: [], confidence: 0.9 }],
  }),
});

/** 把浏览器的 fetch 直通到 api.handle。 */
const fetchCalls = [];
async function fetchStub(target, init = {}) {
  const parsed = new URL(String(target));
  const query = {};
  for (const [key, value] of parsed.searchParams.entries()) query[key] = value;
  let body;
  if (typeof init.body === 'string' && init.body.length) body = JSON.parse(init.body);
  fetchCalls.push({ method: init.method || 'GET', pathname: parsed.pathname });
  const result = await api.handle({
    method: init.method || 'GET',
    pathname: parsed.pathname,
    query,
    body,
  });
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    async json() {
      return result.body;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 加载客户端半
 * ------------------------------------------------------------------ */

const mini = createMiniReact();

/** 外壳设置导航里的按钮（apply 时就要在位，用于验证标记逻辑）。 */
function navButton(text) {
  return {
    textContent: text,
    attrs: {},
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
  };
}
const navButtons = [navButton('通用设置'), navButton('记忆'), navButton('模型')];

const styleTags = [];
const documentStub = {
  baseURI: 'http://127.0.0.1:19387/',
  body: {},
  head: {
    appendChild(node) {
      styleTags.push(node);
    },
  },
  createElement(tag) {
    return { tagName: tag, dataset: {}, textContent: '' };
  },
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '[role="dialog"] nav button') return navButtons;
    if (selector === '[data-dshmem-nav]') {
      return navButtons.filter((button) => 'data-dshmem-nav' in button.attrs);
    }
    return [];
  },
};

const observers = [];
class MutationObserverStub {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    observers.push(this);
  }
  observe(target, options) {
    this.target = target;
    this.options = options;
  }
  disconnect() {
    this.target = null;
  }
}

let confirmAnswer = true;
const confirmCalls = [];
const windowStub = {
  setTimeout,
  clearTimeout,
  confirm(message) {
    confirmCalls.push(message);
    return confirmAnswer;
  },
  __ModuleLoader__: {
    load(entry) {
      loaded = { id: entry.id, exports: entry.factory(requireStub) };
    },
  },
};
let loaded = null;

function requireStub(id) {
  if (id === 'react') return mini.react;
  throw new Error(`客户端半只允许 require("react")，实际为 ${id}`);
}

const source = fs.readFileSync(path.join(pkgRoot, 'lib', 'client.js'), 'utf8');
const factory = new Function(
  'window',
  'document',
  'fetch',
  'URL',
  'URLSearchParams',
  'AbortController',
  'navigator',
  'console',
  'MutationObserver',
  source,
);
factory(
  windowStub,
  documentStub,
  fetchStub,
  URL,
  URLSearchParams,
  AbortController,
  { clipboard: { writeText: async () => {} } },
  console,
  MutationObserverStub,
);

/* ------------------------------------------------------------------ *
 * 假 ctx：只实现 slots / locale / effect
 * ------------------------------------------------------------------ */

let lang = 'zh';
const slotRegistration = { name: null, options: null, component: null, disposer: null };
const localeRegistration = { ns: null, dicts: null };

function dict(locale) {
  return (key) => {
    const table = localeRegistration.dicts?.[locale] || {};
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  };
}

const effectDisposers = [];
const ctx = {
  effect(fn) {
    const disposer = fn();
    effectDisposers.push(disposer);
    return typeof disposer === 'function' ? disposer : () => {};
  },
  locale: {
    bind: () => (key) => dict(lang)(key),
    register(ns, dicts) {
      localeRegistration.ns = ns;
      localeRegistration.dicts = dicts;
      return () => {};
    },
    getSnapshot: () => ({ revision: 1 }),
    subscribe: () => () => {},
  },
  slots: {
    inject(name, register) {
      slotRegistration.name = name;
      slotRegistration.disposer = register();
      return () => {};
    },
    register(options, component) {
      slotRegistration.options = options;
      slotRegistration.component = component;
      return () => {};
    },
  },
};

/* ------------------------------------------------------------------ *
 * 种子数据
 * ------------------------------------------------------------------ */

await api.handle({
  method: 'POST',
  pathname: `${API_PREFIX}/save`,
  body: {
    workspace: WS,
    title: '插件安装方式',
    content: 'package 进入 dsh.profile.bundles 后，其 cordis.patch.yml 会被自动应用。',
    category: 'convention',
    tags: ['dsh', 'plugin'],
    source: 'manual',
  },
});
await api.handle({
  method: 'POST',
  pathname: `${API_PREFIX}/save`,
  body: {
    workspace: WS,
    title: 'alpha 约定',
    content: '搜索测试用的独特标记 alpha-9f2c。',
    category: 'fact',
    source: 'manual',
  },
});
await api.handle({
  method: 'POST',
  pathname: `${API_PREFIX}/save`,
  body: {
    workspace: WS,
    title: '全局偏好',
    content: '用户偏好中文回答。',
    category: 'preference',
    scope: 'global',
    source: 'manual',
  },
});

/* ------------------------------------------------------------------ *
 * 测试
 * ------------------------------------------------------------------ */

console.log('dsh-memory client half');

await test('模块通过 __ModuleLoader__.load 注册，id 与包名一致', () => {
  assert.ok(loaded, 'client.js 没有调用 window.__ModuleLoader__.load');
  assert.equal(loaded.id, 'dsh-memory');
  assert.equal(typeof loaded.exports.apply, 'function');
  assert.deepEqual(loaded.exports.inject, ['slots', 'locale']);
  assert.equal(loaded.exports.name, 'dsh-memory');
});

await test('CSS 只注入一次，且带 data-plugin-css 标记', () => {
  assert.equal(styleTags.length, 1);
  assert.equal(styleTags[0].tagName, 'style');
  assert.ok(styleTags[0].dataset.pluginCss, '缺少 dataset.pluginCss');
  assert.match(styleTags[0].textContent, /\.dshmem/);
  assert.match(styleTags[0].textContent, /--dsw-static-deepseek-450/);
});

await test('apply 注册 locale 字典（含 en）并挂到 settings.section', () => {
  loaded.exports.apply(ctx);
  assert.equal(localeRegistration.ns, 'settings.memory');
  assert.ok(localeRegistration.dicts.zh, '缺少 zh 字典');
  assert.ok(localeRegistration.dicts.en, '缺少 en 字典（DSH 要求回落链能到 en）');
  assert.equal(slotRegistration.name, 'settings.section');
  assert.equal(slotRegistration.options.name, 'settings.section');
  assert.equal(slotRegistration.options.id, 'memory');
  assert.equal(slotRegistration.options.order, 25, 'order 25 是唯一空档（20 已占用）');
  assert.equal(slotRegistration.options.locale, 'settings.memory');
  assert.equal(typeof slotRegistration.component, 'function');
  assert.equal(typeof slotRegistration.options.label, 'function');
  assert.equal(slotRegistration.options.label(), '记忆');
});

await test('导航项被标记成自有字形，且卸载时撤掉标记', () => {
  const mine = navButtons.find((button) => button.textContent === '记忆');
  const other = navButtons.find((button) => button.textContent === '通用设置');
  assert.ok('data-dshmem-nav' in mine.attrs, '本插件那一行没有被标记，齿轮图标换不掉');
  assert.ok(!('data-dshmem-nav' in other.attrs), '标记溢到了别的导航项上');
  assert.equal(observers.length, 1, '应只挂一个 MutationObserver');
  assert.equal(observers[0].target, documentStub.body);
  assert.ok(observers[0].options.childList && observers[0].options.subtree);
  assert.match(styleTags[0].textContent, /\[data-dshmem-nav\] svg:first-child\{display:none/);
  assert.match(styleTags[0].textContent, /--dshmem-nav-glyph:url\("data:image\/svg\+xml,/);

  // 卸载：标记撤掉、观察断开。apply 里的第二个 effect 就是它。
  const navDisposer = effectDisposers[1];
  assert.equal(typeof navDisposer, 'function');
  navDisposer();
  assert.equal(observers[0].target, null, 'disposer 没有断开 MutationObserver');
  assert.ok(!('data-dshmem-nav' in mine.attrs), 'disposer 没有撤掉标记');
});

await test('locale 字典键完全对齐：zh 与 en 的键集合一致', () => {
  const { zh, en } = localeRegistration.dicts;
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  const missingEn = zhKeys.filter((key) => !enKeys.includes(key));
  const missingZh = enKeys.filter((key) => !zhKeys.includes(key));
  assert.deepEqual(missingEn, [], `en 缺少键: ${missingEn.join(', ')}`);
  assert.deepEqual(missingZh, [], `zh 缺少键: ${missingZh.join(', ')}`);
  assert.ok(zhKeys.length >= 60, `字典太小：${zhKeys.length} 个键`);
});

/* ---------------- 渲染 ---------------- */

const makeT = (locale) => (key) => {
  const table = localeRegistration.dicts[locale] || {};
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
};

let handle = null;
let view = null;

function renderPage(locale = 'zh') {
  lang = locale;
  const bound = makeT(locale);
  handle = mini.render(
    mini.react.createElement(slotRegistration.component, {
      t: bound,
      close() {},
      useMemoryLocale: (selector) => selector({ revision: 1 }),
    }),
  );
  view = handle.tree;
  return view;
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await sleep(25);
    await mini.flush(4);
  }
  // 每次重渲染都会产生新的树对象，测试里始终读最新的。
  view = handle.tree;
}

const text = () => mini.textOf(handle.tree);

await test('首屏渲染出三条记忆与统计', async () => {
  renderPage('zh');
  await settle();
  const body = text();
  assert.match(body, /插件安装方式/);
  assert.match(body, /alpha 约定/);
  assert.match(body, /全局偏好/);
  // 默认范围是「全部」，所以顶部计数 = 本工作区 + 全局，和列表里的卡片数对得上。
  assert.match(body, /共 3条/);
  // 记忆空间默认把「项目记忆 / 全局记忆」分开统计与分区，和 Qoder 的划分一致。
  assert.match(body, /项目记忆 2/);
  assert.match(body, /全局记忆 1/);
  assert.ok(body.includes(makeT('zh')('nav')), '缺少导航标签');
});

await test('页面确实读了宿主 /state 与 /list', () => {
  const paths = fetchCalls.map((call) => call.pathname);
  assert.ok(paths.some((p) => p === `${API_PREFIX}/state`), '/state 未被调用');
  assert.ok(paths.some((p) => p === `${API_PREFIX}/list`), '/list 未被调用');
  assert.ok(
    fetchCalls.every((call) => call.pathname.startsWith('/memory/api')),
    '客户端请求没有走 /memory/api 前缀',
  );
});

await test('列表带上工作区、范围与类别标签', () => {
  const body = text();
  assert.match(body, /约定/); // 类别中文标签
  assert.match(body, /#dsh/); // 标签 chip
  assert.match(body, new RegExp(escapeRe(WS))); // 工作区路径
});

await test('搜索框过滤列表', async () => {
  const input = mini
    .findAllByTag(view, 'input')
    .find((node) => node.props.placeholder === makeT('zh')('search'));
  assert.ok(input, '找不到搜索输入框');
  mini.type(input, 'alpha');
  await settle(10);
  const body = text();
  assert.match(body, /alpha 约定/);
  assert.doesNotMatch(body, /插件安装方式/, '搜索后未过滤掉不匹配的记忆');
  assert.equal(store.list({ workspace: WS, query: '', includeGlobal: false }).total, 2);
});

await test('清空搜索后列表恢复', async () => {
  const input = mini
    .findAllByTag(view, 'input')
    .find((node) => node.props.placeholder === makeT('zh')('search'));
  mini.type(input, '');
  await settle(10);
  assert.match(text(), /插件安装方式/);
});

await test('点击卡片上的删除按钮会真的删掉记忆（走 /delete）', async () => {
  const title = makeT('zh')('remove');
  const cards = mini.findAll(
    view,
    (node) => node.type === 'div' && String(node.props.className || '').includes('dshmem_card'),
  );
  const target = cards.find((card) => mini.textOf(card).includes('alpha 约定'));
  assert.ok(target, '找不到 alpha 约定的卡片');
  const button = mini.findByText(target, title, 'button');
  assert.ok(button, '找不到删除按钮');

  const before = store.list({ workspace: WS, includeGlobal: false }).total;
  confirmAnswer = true;
  mini.click(button);
  await settle(10);
  assert.equal(store.list({ workspace: WS, includeGlobal: false }).total, before - 1);
  assert.equal(store.list({ workspace: WS, query: 'alpha' }).total, 0);
  assert.ok(confirmCalls.length >= 1, '删除前没有向用户确认');
  assert.doesNotMatch(text(), /alpha 约定/, '删除后列表没有刷新');
});

await test('取消确认时不删除', async () => {
  const cards = mini.findAll(
    view,
    (node) => node.type === 'div' && String(node.props.className || '').includes('dshmem_card'),
  );
  const target = cards.find((card) => mini.textOf(card).includes('插件安装方式'));
  assert.ok(target, '找不到目标卡片');
  const before = store.list({ workspace: WS, includeGlobal: false }).total;
  confirmAnswer = false;
  mini.click(mini.findByText(target, makeT('zh')('remove'), 'button'));
  await settle(6);
  assert.equal(store.list({ workspace: WS, includeGlobal: false }).total, before);
  confirmAnswer = true;
});

await test('置顶按钮切换 pinned 并让记录排到最前', async () => {
  const cards = mini.findAll(
    view,
    (node) => node.type === 'div' && String(node.props.className || '').includes('dshmem_card'),
  );
  const target = cards.find((card) => mini.textOf(card).includes('插件安装方式'));
  mini.click(mini.findByText(target, makeT('zh')('pin'), 'button'));
  await settle(10);
  const record = store.list({ workspace: WS, includeGlobal: false }).records.find(
    (item) => item.title === '插件安装方式',
  );
  assert.equal(record.pinned, true);
  const first = mini.findAll(
    view,
    (node) => node.type === 'div' && String(node.props.className || '').includes('dshmem_card'),
  )[0];
  assert.match(mini.textOf(first), /插件安装方式/, '置顶后没有排在最前');
});

await test('新建记忆：打开表单 → 填写 → 保存 → 落库', async () => {
  const newButton = mini.findByText(view, makeT('zh')('newMemory'), 'button');
  assert.ok(newButton, '找不到“新建记忆”按钮');
  mini.click(newButton);
  await settle(4);

  const titleInput = mini
    .findAllByTag(view, 'input')
    .find((node) => node.props.placeholder === makeT('zh')('fTitlePh'));
  const contentArea = mini
    .findAllByTag(view, 'textarea')
    .find((node) => node.props.placeholder === makeT('zh')('fContentPh'));
  assert.ok(titleInput && contentArea, '表单没有渲染出来');

  mini.type(titleInput, '端到端测试记忆');
  mini.type(contentArea, '由 test/client.test.mjs 写入。');
  await settle(4);

  const save = mini.findByText(view, makeT('zh')('save'), 'button');
  assert.ok(save, '找不到保存按钮');
  mini.click(save);
  await settle(10);

  const found = store.list({ workspace: WS, query: '端到端测试记忆' }).records;
  assert.equal(found.length, 1, '新建的记忆没有落库');
  assert.equal(found[0].source, 'manual');
  assert.match(text(), /端到端测试记忆/, '新建后列表没有刷新');
});

await test('空表单提交被拦下并提示', async () => {
  mini.click(mini.findByText(view, makeT('zh')('newMemory'), 'button'));
  await settle(3);
  const countBefore = store.list({ workspace: WS, includeGlobal: false }).total;
  mini.click(mini.findByText(view, makeT('zh')('save'), 'button'));
  await settle(4);
  assert.match(text(), new RegExp(makeT('zh')('errTitle').slice(0, 4)));
  assert.equal(store.list({ workspace: WS, includeGlobal: false }).total, countBefore);
  mini.click(mini.findByText(view, makeT('zh')('cancel'), 'button'));
  await settle(3);
});

/* ---------------- 其他两个 tab ---------------- */

await test('切到自动提炼页会渲染并调用 /capture', async () => {
  const tab = mini.findByText(view, makeT('zh')('tabCapture'), 'button');
  assert.ok(tab, '找不到自动提炼 tab');
  mini.click(tab);
  await settle(4);
  const run = mini.findByText(view, makeT('zh')('captureNow'), 'button');
  assert.ok(run, '找不到提炼按钮');
  mini.click(run);
  await settle(10);
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/capture`),
    '/capture 未被调用',
  );
});

await test('切到设置页会渲染开关与保存按钮', async () => {
  const tab = mini.findByText(view, makeT('zh')('tabSettings'), 'button');
  assert.ok(tab, '找不到设置 tab');
  mini.click(tab);
  await settle(8);
  const body = text();
  assert.match(body, new RegExp(makeT('zh')('sBriefing')));
  assert.match(body, new RegExp(makeT('zh')('sAuto')));
  assert.ok(mini.findByText(view, makeT('zh')('save'), 'button'), '找不到保存设置按钮');
  // 镜像区必须指向工作区里那份文件，而不是主库路径。
  assert.match(body, /\.dsh-memory/, '镜像区应显示工作区镜像路径');
  assert.match(body, new RegExp(makeT('zh')('mirrorStorage')), '镜像区应标出主库旁车');
  // 镜像已经存在时要自动把内容拉进预览区，不能一边显示「已生成」一边说没有文件。
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/mirror`),
    '镜像已存在时应自动拉一次 /mirror 填预览',
  );
  assert.doesNotMatch(
    body,
    new RegExp(escapeRe(makeT('zh')('mirrorEmpty'))),
    '镜像已存在时预览区不该再说「还没有生成镜像文件」',
  );
});

/* ---------------- 记忆空间：项目/全局分区 + 按标签分组 ---------------- */

/* 造两组同标签的记忆，才用得上「整合」；另外造一条全局的，验证分区不串。 */
for (const seed of [
  { title: '空间甲', content: '甲的内容', category: 'fact', tags: ['space'] },
  { title: '空间乙', content: '乙的内容', category: 'fact', tags: ['space'] },
  { title: '空间全局', content: '全局的内容', category: 'preference', tags: ['space'], scope: 'global' },
]) {
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/save`,
    body: { workspace: WS, source: 'manual', ...seed },
  });
}

/* 注意要整词匹配：class 里 dshmem_section 是 dshmem_sectionHead/_Title 的前缀。 */
const byClass = (name) => (node) =>
  String((node && node.props && node.props.className) || '')
    .split(/\s+/)
    .includes(name);

await test('记忆空间按「项目记忆 / 全局记忆」分区，组内再按标签归类', async () => {
  renderPage('zh');
  await settle(10);

  const sections = mini.findAll(view, byClass('dshmem_section'));
  assert.equal(sections.length, 2, `应该有两个分区，实际 ${sections.length} 个`);
  const [project, global] = sections.map((node) => mini.textOf(node));
  assert.match(project, /项目记忆/);
  assert.match(global, /全局记忆/);
  assert.match(project, /空间甲/, '项目分区里没有本工作区的记忆');
  assert.match(global, /空间全局/, '全局分区里没有全局记忆');
  assert.doesNotMatch(project, /空间全局/, '全局记忆混进了项目分区');
  assert.doesNotMatch(global, /空间甲/, '项目记忆混进了全局分区');

  const groups = mini.findAll(view, byClass('dshmem_group'));
  const spaceGroups = groups.filter((node) => mini.textOf(node).startsWith('▾ #space'));
  assert.equal(spaceGroups.length, 2, '#space 应该分别在两个分区里各成一组');
  assert.match(mini.textOf(spaceGroups[0]), /空间甲/);
  assert.match(mini.textOf(spaceGroups[0]), /空间乙/);
  assert.match(mini.textOf(spaceGroups[1]), /空间全局/);
  assert.doesNotMatch(mini.textOf(spaceGroups[1]), /空间甲/);

  /* 没有标签的记忆落到「未归类」，且排在最后。 */
  const labels = groups.map((node) => mini.textOf(node).slice(0, 8));
  assert.ok(labels.some((label) => label.includes('未归类')), '缺少「未归类」分组');
  assert.ok(
    labels[labels.length - 1].includes('未归类'),
    `「未归类」应该排在最后，实际顺序：${labels.join(' | ')}`,
  );
});

await test('分区与分组都能折叠', async () => {
  renderPage('zh');
  await settle(10);
  const spaceTitle = () =>
    mini
      .findAll(view, byClass('dshmem_groupTitle'))
      .find((node) => mini.textOf(node).includes('#space'));

  const open = spaceTitle();
  assert.ok(open, '找不到 #space 组标题');
  assert.match(mini.textOf(open), /^▾ /, '展开态应该带 ▾');
  mini.click(open);
  await settle(8);
  assert.match(mini.textOf(spaceTitle()), /^▸ /, '折叠后没有换成 ▸');
  assert.doesNotMatch(text(), /甲的内容/, '折叠后组内条目还在');
  mini.click(spaceTitle());
  await settle(8);
  assert.match(text(), /甲的内容/, '再点一次没能展开');

  const globalHead = mini.findAll(view, byClass('dshmem_sectionHead'))[1];
  assert.ok(globalHead, '找不到全局分区头');
  mini.click(globalHead);
  await settle(8);
  assert.doesNotMatch(text(), /空间全局/, '折叠分区后条目还在');
  assert.match(text(), /全局记忆/, '折叠分区后分区标题不该消失');
  mini.click(mini.findAll(view, byClass('dshmem_sectionHead'))[1]);
  await settle(8);
  assert.match(text(), /空间全局/, '分区没能重新展开');
});

await test('整合：同标签的记忆合并成一条，原条目自动归档', async () => {
  renderPage('zh');
  await settle(10);

  const group = mini
    .findAll(view, byClass('dshmem_group'))
    .find((node) => mini.textOf(node).startsWith('▾ #space'));
  assert.ok(group, '找不到 #space 分组');
  const button = mini.findByText(group, makeT('zh')('consolidate'), 'button');
  assert.ok(button, '同组两条记忆时没有出现「整合」按钮');
  mini.click(button);
  await settle(6);

  assert.match(text(), new RegExp(escapeRe(makeT('zh')('consolidateHint').slice(0, 6))));
  const titleInput = mini
    .findAllByTag(view, 'input')
    .find((node) => node.props.placeholder === makeT('zh')('fTitlePh'));
  const contentArea = mini
    .findAllByTag(view, 'textarea')
    .find((node) => node.props.placeholder === makeT('zh')('fContentPh'));
  assert.ok(titleInput && contentArea, '整合没有打开编辑表单');
  assert.equal(titleInput.props.value, 'space', '标题没有预填成标签名');
  assert.ok(contentArea.props.value.includes('空间甲'), '合并正文没有列出第一条');
  assert.ok(contentArea.props.value.includes('空间乙'), '合并正文没有列出第二条');

  mini.click(mini.findByText(view, makeT('zh')('save'), 'button'));
  await settle(14);

  const all = store.list({ workspace: WS, includeArchived: true }).records;
  const merged = all.find((record) => record.title === 'space' && !record.archived);
  assert.ok(merged, '没有生成合并后的记忆');
  assert.deepEqual(merged.tags, ['space']);
  assert.equal(merged.scope, 'workspace');
  assert.ok(merged.content.includes('空间甲') && merged.content.includes('空间乙'), '合并正文不完整');
  for (const title of ['空间甲', '空间乙']) {
    assert.equal(all.find((record) => record.title === title).archived, true, `${title} 没有被归档`);
  }
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('consolidated').slice(0, 6))));
  assert.equal(
    store.list({ workspace: WS }).records.some((record) => record.title === '空间甲'),
    false,
    '归档后的原条目不该留在默认列表里',
  );
});

await test('列表 / 记忆空间视图互切，范围 chip 只留一个分区', async () => {
  renderPage('zh');
  await settle(10);

  mini.click(mini.findByText(view, makeT('zh')('viewList'), 'button'));
  await settle(8);
  assert.equal(mini.findAll(view, byClass('dshmem_section')).length, 0, '列表视图不该再有分区');
  assert.ok(mini.findAll(view, byClass('dshmem_card')).length > 0, '列表视图没有卡片');
  assert.match(text(), /#space/, '列表视图应该显示标签云');

  mini.click(mini.findByText(view, makeT('zh')('viewSpace'), 'button'));
  await settle(8);
  assert.equal(mini.findAll(view, byClass('dshmem_section')).length, 2, '切回空间视图没有恢复分区');

  const chip = mini
    .findAll(view, byClass('dshmem_chip_click'))
    .find((node) => mini.textOf(node).startsWith(makeT('zh')('scopeGlobalFull')));
  assert.ok(chip, '找不到「全局记忆」范围 chip');
  mini.click(chip);
  await settle(12);
  const sections = mini.findAll(view, byClass('dshmem_section'));
  assert.equal(sections.length, 1, '筛到全局后应该只剩一个分区');
  assert.match(mini.textOf(sections[0]), /全局记忆 1|全局记忆/);
  assert.ok(mini.textOf(sections[0]).includes('空间全局'), '全局分区里没有全局记忆');
  assert.doesNotMatch(text(), /端到端测试记忆/, '筛到全局后不该再出现项目记忆');
});

/* ---------------- 英文 ---------------- */

await test('英文界面不带中文残留（导航/按钮走 en 字典）', async () => {
  renderPage('en');
  await settle();
  const body = text();
  assert.match(body, /Memories/);
  assert.match(body, /New memory/);
  assert.doesNotMatch(body, /新建记忆/);
});

await test('所有 t(...) 键都在 zh 与 en 字典里', async () => {
  const used = new Set();
  const pattern = /(?<![\w$.])t\("([A-Za-z0-9_]+)"\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) used.add(match[1]);
  const { zh, en } = localeRegistration.dicts;
  const missingZh = [...used].filter((key) => !(key in zh));
  const missingEn = [...used].filter((key) => !(key in en));
  assert.deepEqual(missingZh, [], `zh 缺少: ${missingZh.join(', ')}`);
  assert.deepEqual(missingEn, [], `en 缺少: ${missingEn.join(', ')}`);
  assert.ok(used.size >= 60, `只用到 ${used.size} 个键，可能解析失败`);
});

await test('后端出错时页面显示错误而不是白屏', async () => {
  const originalHandle = api.handle;
  api.handle = async () => ({
    status: 500,
    body: { ok: false, error: 'boom', detail: { message: '炸了' } },
  });
  try {
    handle = mini.render(
      mini.react.createElement(slotRegistration.component, {
        t: makeT('zh'),
        close() {},
        useMemoryLocale: (selector) => selector({ revision: 1 }),
      }),
    );
    view = handle.tree;
    await settle(8);
    assert.match(text(), /boom|炸了/, '错误没有呈现给用户');
    assert.doesNotMatch(text(), /新建记忆/, '出错时仍然渲染了正常内容');
  } finally {
    api.handle = originalHandle;
  }
});

/* ------------------------------------------------------------------ *
 * 结果
 * ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
