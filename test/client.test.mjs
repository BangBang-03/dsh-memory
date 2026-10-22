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
  mirror: true,
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
  rewriteNow: async ({ workspace, scope }) => {
    const saved = store.savePortrait(scope === 'global' ? '' : workspace, {
      sections: [{ key: 'background', text: '假重写背景。' }],
      source: 'auto',
    });
    return { ok: true, drafted: false, portrait: saved.portrait };
  },
  approveDraft: ({ workspace, scope }) => {
    const root = scope === 'global' ? '' : workspace;
    const draft = store.portraitDraftRead(root);
    if (!draft) return { ok: false, error: 'no_draft' };
    const saved = store.savePortrait(root, { sections: draft.sections, source: 'auto' });
    store.portraitDraftClear(root);
    return { ok: true, portrait: saved.portrait };
  },
});

/** 把浏览器的 fetch 直通到 api.handle。 */
const fetchCalls = [];
/* 客户端半在加载时就把 fetch 绑死了（new Function 的形参），所以换后端要换这个指针。 */
let activeApi = api;
async function fetchStub(target, init = {}) {
  const parsed = new URL(String(target));
  const query = {};
  for (const [key, value] of parsed.searchParams.entries()) query[key] = value;
  let body;
  if (typeof init.body === 'string' && init.body.length) body = JSON.parse(init.body);
  fetchCalls.push({ method: init.method || 'GET', pathname: parsed.pathname, body });
  const result = await activeApi.handle({
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
  const pkgName = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).name;
  /* 模块系统按 manifest 包名认领浏览器模块：id 不一致时客户端半根本不会激活
     （宿主半照常工作，界面却整块消失）——所以这里必须对着 package.json 断言。 */
  assert.equal(loaded.id, pkgName, `模块 id 必须等于 package.json 的 name（${pkgName}）`);
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

await test('次级文字对比度：dim 级文本由 currentColor 派生（随主题/背景自适应）', () => {
  const css = styleTags[0].textContent;
  assert.match(
    css,
    /--dshmem-dim:color-mix\(in srgb,currentColor 68%,transparent\)/,
    '缺少 --dshmem-dim 派生色定义（亮色下宿主 dimmed=#e1e5ee 对比度仅 1.26:1）',
  );
  assert.ok(!css.includes('dsw-alias-label-dimmed'), '不应再直接使用宿主 dimmed 令牌');
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

/* 视图分段控件只有两个：档案（默认）/ 列表。卡片只在列表视图里出现。 */
const switchView = async (key, locale = 'zh') => {
  const button = mini.findByText(handle.tree, makeT(locale)(key), 'button');
  assert.ok(button, `找不到视图按钮：${key}`);
  mini.click(button);
  await settle(8);
};

/* 档案视图的排布下拉：整篇文档（默认）/ 按标签分组 / 按类型分组——同一份内容的两种排布。 */
const setLayout = async (value, locale = 'zh') => {
  const select = mini
    .findAllByTag(handle.tree, 'select')
    .find((node) => mini.textOf(node).includes(makeT(locale)('groupByTag')));
  assert.ok(select, '档案视图里找不到排布下拉');
  mini.type(select, value);
  await settle(8);
};

await test('首屏渲染出三条记忆与统计', async () => {
  renderPage('zh');
  await settle();
  const body = text();
  assert.match(body, /插件安装方式/);
  assert.match(body, /alpha 约定/);
  assert.match(body, /全局偏好/);
  // 档案视图是「一个工作区一份长记忆」：只有视图切换、两个开关和正文，
  // 条数统计、搜索框、排序、新建这些管理动作全部收进列表视图。
  assert.doesNotMatch(body, /共 \d+条/, '档案视图不该出现条数统计');
  assert.equal(
    mini.findAllByTag(view, 'input').some((node) => node.props.placeholder === makeT('zh')('search')),
    false,
    '档案视图不该出现搜索框',
  );
  assert.match(body, /直接在对话里说/, '档案视图缺少「在对话里加记忆」的提示');
  // 切到列表视图才能看到条数与范围统计（列表把「项目记忆 / 全局记忆」分开统计，和 Qoder 的划分一致）。
  await switchView('viewList');
  const list = text();
  assert.match(list, /共 3条/);
  assert.match(list, /项目记忆 2/);
  assert.match(list, /全局记忆 1/);
  assert.ok(list.includes(makeT('zh')('nav')), '缺少导航标签');
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

/* 卡片、标签云、删除/置顶/新建按钮都只在列表视图里，下面这一组先切过去。 */
await switchView('viewList');

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

/* ---------------- 档案视图：项目/全局分区 + 可选的按标签分组 ---------------- */

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

await test('档案视图按「项目记忆 / 全局记忆」分区，可切成按标签归类', async () => {
  renderPage('zh');
  await settle(10);

  /* 默认排布是「整篇文档」：分区里只有标题与正文，没有分组卡片。 */
  assert.equal(mini.findAll(view, byClass('dshmem_group')).length, 0, '整篇文档排布不该有分组');
  assert.ok(mini.findAll(view, byClass('dshmem_docPara')).length > 0, '整篇文档排布没有正文段落');

  await setLayout('tag');

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
  await setLayout('tag');
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
  await setLayout('tag');

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

await test('档案 / 列表两个视图互切，范围 chip 只留一个分区', async () => {
  renderPage('zh');
  await settle(10);

  /* 列表：卡片 + 标签云 + 范围 chip，没有分区，也没有档案页的排布下拉。 */
  mini.click(mini.findByText(view, makeT('zh')('viewList'), 'button'));
  await settle(8);
  assert.equal(mini.findAll(view, byClass('dshmem_section')).length, 0, '列表视图不该再有分区');
  assert.ok(mini.findAll(view, byClass('dshmem_card')).length > 0, '列表视图没有卡片');
  assert.match(text(), /#space/, '列表视图应该显示标签云');
  assert.equal(
    mini
      .findAllByTag(view, 'select')
      .some((node) => mini.textOf(node).includes(makeT('zh')('groupByTag'))),
    false,
    '列表视图不该出现档案页的排布下拉',
  );

  const chip = mini
    .findAll(view, byClass('dshmem_chip_click'))
    .find((node) => mini.textOf(node).startsWith(makeT('zh')('scopeGlobalFull')));
  assert.ok(chip, '找不到「全局记忆」范围 chip');
  mini.click(chip);
  await settle(12);

  /* 切回档案：分区回来了，而且只剩筛中的那一个。 */
  mini.click(mini.findByText(view, makeT('zh')('viewDoc'), 'button'));
  await settle(10);
  const sections = mini.findAll(view, byClass('dshmem_section'));
  assert.equal(sections.length, 1, '筛到全局后应该只剩一个分区');
  assert.match(mini.textOf(sections[0]), /全局记忆/);
  assert.ok(mini.textOf(sections[0]).includes('空间全局'), '全局分区里没有全局记忆');
  assert.doesNotMatch(text(), /端到端测试记忆/, '筛到全局后不该再出现项目记忆');
});

/* ---------------- 档案视图：照 WorkBuddy 的「记忆与进化」 ---------------- */

/* 开关不是 checkbox，是 role="switch" 的按钮，用 data-on 表达状态。 */
const switchNodes = () => mini.findAll(view, (node) => node.props && node.props.role === 'switch');

await test('档案视图默认打开：分区小标题 + 粗体标题 + 整段正文', async () => {
  renderPage('zh');
  await settle(10);

  const segments = mini.findAll(view, byClass('dshmem_seg_btn'));
  assert.deepEqual(
    segments.map((node) => mini.textOf(node)),
    ['档案', '列表'],
    '分段控件应该是两个视图（档案已把记忆空间收进来）',
  );
  assert.ok(byClass('dshmem_seg_on')(segments[0]), '默认应该选中「档案」');

  const sections = mini.findAll(view, byClass('dshmem_sectionTitle'));
  assert.deepEqual(sections.map((node) => mini.textOf(node)), ['项目记忆', '全局记忆']);

  const titles = mini.findAll(view, byClass('dshmem_docTitle')).map((node) => mini.textOf(node));
  assert.ok(titles.includes('插件安装方式'), `档案里缺少已有记忆：${titles.join(' | ')}`);
  const paras = mini.findAll(view, byClass('dshmem_docPara')).map((node) => mini.textOf(node));
  assert.ok(paras.some((para) => para.includes('cordis.patch.yml')), '档案里没有整段正文');

  /* 卡片、标签云是列表视图的东西；档案视图整篇文档排布下只有分区、标题与正文。 */
  assert.equal(mini.findAll(view, byClass('dshmem_card')).length, 0, '档案视图不该渲染卡片');
  assert.equal(mini.findAll(view, byClass('dshmem_section')).length, 2, '档案视图应该有项目/全局两个分区');

  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('manageMemory'))));
  for (const key of ['tidy', 'editDoc', 'importDo']) {
    assert.ok(mini.findByText(view, makeT('zh')(key), 'button'), `缺少按钮：${key}`);
  }
  assert.match(body, new RegExp(escapeRe(makeT('zh')('docAutoHint').slice(0, 10))));
  assert.match(body, new RegExp(escapeRe(makeT('zh')('docLocalHint').slice(0, 10))));
  assert.match(body, /仅保存在你的设备上/);

  /* 两行开关：对话记忆 → autoCapture（默认关），本地记忆与技能 → mirror（默认开）。 */
  const switches = switchNodes();
  assert.equal(switches.length, 2, '应该有两个开关');
  assert.deepEqual(switches.map((node) => node.props['data-on']), ['0', '1']);
});

await test('整篇编辑：改正文、加条目，文档里消失的归档', async () => {
  renderPage('zh');
  await settle(10);

  mini.click(mini.findByText(view, makeT('zh')('editDoc'), 'button'));
  await settle(6);
  const area = mini.findAllByTag(view, 'textarea').find(byClass('dshmem_area_doc'));
  assert.ok(area, '点「编辑」没有打开整篇文本框');
  assert.match(area.props.value, /^## 项目记忆$/m);
  assert.match(area.props.value, /\*\*插件安装方式\*\*/);

  const kept = 'package 进入 dsh.profile.bundles 后，其 cordis.patch.yml 会被自动应用。';
  mini.type(
    area,
    ['## 项目记忆', '**档案新条目**', '整篇编辑写进来的正文。', '', '**插件安装方式**', kept].join('\n'),
  );
  await settle(6);
  mini.click(mini.findByText(view, makeT('zh')('save'), 'button'));
  await settle(20);

  const all = store.list({ workspace: WS, includeGlobal: true, includeArchived: true }).records;
  const fresh = all.find((record) => record.title === '档案新条目');
  assert.ok(fresh, '整篇编辑新建的条目没进库');
  assert.equal(fresh.content, '整篇编辑写进来的正文。');
  assert.equal(fresh.scope, 'workspace');
  assert.equal(fresh.archived, false);
  assert.equal(
    all.find((record) => record.title === '插件安装方式').archived,
    false,
    '文档里保留的条目不该被归档',
  );
  assert.equal(
    all.find((record) => record.title === '全局偏好').archived,
    true,
    '文档里消失的条目应该被归档（而不是删除）',
  );
  assert.deepEqual(
    all.filter((record) => !record.archived).map((record) => record.title).sort(),
    ['插件安装方式', '档案新条目'],
  );
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('docSaved').slice(0, 4))));
});

await test('整理：每个同标签分组各自合并，原条目归档', async () => {
  for (const seed of [
    { title: '整理甲', content: '甲的内容', category: 'fact', tags: ['tidy'] },
    { title: '整理乙', content: '乙的内容', category: 'fact', tags: ['tidy'] },
  ]) {
    await api.handle({
      method: 'POST',
      pathname: `${API_PREFIX}/save`,
      body: { workspace: WS, source: 'manual', ...seed },
    });
  }

  renderPage('zh');
  await settle(10);
  mini.click(mini.findByText(view, makeT('zh')('tidy'), 'button'));
  await settle(20);

  const all = store.list({ workspace: WS, includeArchived: true }).records;
  const merged = all.find((record) => record.title === 'tidy' && !record.archived);
  assert.ok(merged, '整理没有生成合并条');
  assert.deepEqual(merged.tags, ['tidy']);
  assert.ok(merged.content.includes('整理甲') && merged.content.includes('整理乙'), '合并正文不完整');
  for (const title of ['整理甲', '整理乙']) {
    assert.equal(all.find((record) => record.title === title).archived, true, `${title} 没有被归档`);
  }
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('tidied').slice(0, 3))));
});

await test('没有可整理的标签分组时直说，不发写请求', async () => {
  // 重新挂载：提示条靠 2600ms 定时器自动消失，复用上一页实例会让上一条提示的定时器
  // 正好在这次断言前把新提示清掉（实测确实被清掉）。新实例没有待触发的定时器。
  renderPage('zh');
  await settle(10);
  const writes = fetchCalls.length;
  mini.click(mini.findByText(view, makeT('zh')('tidy'), 'button'));
  await settle(10);
  const made = fetchCalls.slice(writes).map((call) => call.pathname);
  assert.equal(made.length, 0, `没有可整的分组却发了请求：${made.join(', ')}`);
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('tidyNothing').slice(0, 6))));
});

await test('档案页的两个开关即时写入设置（走 /settings）', async () => {
  const before = fetchCalls.filter((call) => call.pathname === `${API_PREFIX}/settings`).length;

  mini.click(switchNodes()[0]);
  await settle(10);
  assert.equal(settings.get().autoCapture, true, '对话记忆开关没有落库');
  mini.click(switchNodes()[1]);
  await settle(10);
  assert.equal(settings.get().mirror, false, '本地记忆与技能开关没有落库');

  const after = fetchCalls.filter((call) => call.pathname === `${API_PREFIX}/settings`).length;
  assert.equal(after - before, 2, '两个开关应该各发一次 /settings');

  /* 重新挂载后开关状态来自后端，而不是只改了本地 state。 */
  renderPage('zh');
  await settle(10);
  assert.deepEqual(switchNodes().map((node) => node.props['data-on']), ['1', '0']);
});

/* ---------------- 英文 ---------------- */

await test('英文界面不带中文残留（导航/按钮走 en 字典）', async () => {
  renderPage('en');
  await settle();
  const body = text();
  assert.match(body, /Memories/);
  assert.match(body, /No form needed to add a memory/);
  assert.doesNotMatch(body, /直接在对话里说/);
  // 新建按钮只在管理视图里，切过去再断言它也是英文。
  await switchView('viewList', 'en');
  const list = text();
  assert.match(list, /New memory/);
  assert.doesNotMatch(list, /新建记忆/);
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

/* ---------------- v0.3.3：变化横幅 / 注入预览 / 时间线排布 / 维护页 ---------------- */

/** tab 按钮可能带数量徽标（如「维护 2」），用 includes 而不是全等。 */
const clickTab = async (key, locale = 'zh') => {
  const label = makeT(locale)(key);
  const button = mini
    .findAll(view, (node) => node.type === 'button' && mini.textOf(node).includes(label))
    .find((node) => mini.textOf(node).trim().startsWith(label));
  assert.ok(button, `找不到 tab：${label}`);
  mini.click(button);
  await settle(8);
};

await test('记忆库顶部：变化横幅 + 注入预览（/briefing-preview 被调用，简报条目带标记）', async () => {
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/save`,
    body: { workspace: WS, title: '横幅专用记忆', content: '二十四小时内的变化。' },
  });

  renderPage('zh');
  await settle(8);
  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('recentTitle'))), '缺少「刚刚记了什么」横幅');
  assert.match(body, new RegExp(escapeRe(makeT('zh')('briefPreviewTitle'))), '缺少注入预览');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/briefing-preview`),
    '/briefing-preview 未被调用',
  );
  /* 索引模式、条数远小于上限：所有可见条目都应带「✓ 简报」标记。 */
  assert.match(body, /✓ 简报/, '简报内条目应带标记');

  /* 变化横幅默认收起：标题在档案索引里出现 1 次；点「展开」后横幅会再列一次（≥2 次）。 */
  const countOccurrences = (hay, needle) => hay.split(needle).length - 1;
  assert.equal(
    countOccurrences(body, '横幅专用记忆'),
    1,
    '收起时该条目只应出现在档案索引里',
  );
  const expand = mini.findByText(view, makeT('zh')('recentOpen'), 'button');
  assert.ok(expand, '缺少展开按钮');
  mini.click(expand);
  await settle(6);
  assert.ok(
    countOccurrences(text(), '横幅专用记忆') >= 2,
    '展开后变化横幅应额外列出这条新记忆',
  );
});

await test('时间线排布：档案视图下拉切到时间线，含归档记忆，点条目打开编辑器', async () => {
  const saved = await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/save`,
    body: { workspace: WS, title: '时间线专用记忆', content: '时间线正文第一行。\n第二行细节。' },
  });
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/update`,
    body: { workspace: WS, id: saved.body.record.id, archived: true },
  });

  renderPage('zh');
  await settle(8);
  /* 档案视图的工具栏里只有排布下拉这一个 select。 */
  const groupBySelect = mini
    .findAllByTag(view, 'select')
    .find((node) => ['none', 'tag', 'category', 'timeline'].includes(node.props.value));
  assert.ok(groupBySelect, '找不到排布下拉');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/timeline`),
    '/timeline 应随页面加载（时间线排布的数据源）',
  );
  groupBySelect.props.onChange({ target: { value: 'timeline' } });
  await settle(10);

  assert.match(text(), /时间线专用记忆/, '归档条目也应出现在时间线里');
  const findItem = () =>
    mini
      .findAll(view, byClass('dshmem_tlItem'))
      .find((node) => mini.textOf(node).includes('时间线专用记忆'));
  assert.ok(findItem(), '找不到时间线条目');

  /* 折叠语言与档案条目一致：点 chevron/标题 = 展开全文（内容不默认铺开）。 */
  assert.ok(mini.textOf(findItem()).includes('时间线正文第一行。'), '收起态应显示一句话钩子');
  assert.ok(!mini.textOf(findItem()).includes('第二行细节。'), '时间线正文默认应收起（只显示钩子）');
  const chev = mini.findAll(findItem(), byClass('dshmem_chev'))[0];
  assert.ok(chev, '时间线条目应有展开箭头');
  mini.click(chev);
  await settle(6);
  assert.ok(mini.textOf(findItem()).includes('第二行细节。'), '点开应展开全文');

  /* 编辑走 hover 小按钮（不再点整卡打开编辑器）。 */
  const editLink = mini.findAll(findItem(), byClass('dshmem_docFree'))[0];
  assert.ok(editLink, '时间线条目应有编辑入口');
  mini.click(editLink);
  await settle(6);
  assert.ok(
    mini.findAllByTag(view, 'textarea').some((node) => node.props.placeholder === makeT('zh')('fContentPh')),
    '点编辑入口应打开编辑器',
  );
});

await test('维护 tab：KPI 与体检结果渲染，/health 真被调用', async () => {
  const exposed = store.upsert(
    { title: '面板曝光未用示例', content: '被注入多次但从未被打开或引用。' },
    { workspace: WS },
  ).record;
  for (let i = 0; i < 3; i += 1) store.markExposed([exposed.id], { workspace: WS });
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');
  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('healthKpiTotal'))), '缺少记忆总数 KPI');
  assert.match(body, new RegExp(escapeRe(makeT('zh')('healthToken'))), '缺少简报注入 KPI');
  assert.match(body, new RegExp(escapeRe(makeT('zh')('healthProblems'))), '缺少体检结果区');
  assert.match(body, new RegExp(escapeRe(makeT('zh')('healthExposedUnused'))), '缺少曝光未用提示');
  assert.match(body, /面板曝光未用示例 ×3/, '应显示曝光次数');
  assert.ok(fetchCalls.some((call) => call.pathname === `${API_PREFIX}/health`), '/health 未被调用');
});

await test('维护页：Dream 按钮调用 /dream 并显示报告', async () => {
  store.upsert({ title: 'Dream 重复 A', content: 'dream 整理测试 identical-content' }, { workspace: WS });
  store.upsert({ title: 'Dream 重复 B', content: 'dream 整理测试 identical-content' }, { workspace: WS });
  const unused = store.upsert(
    { title: 'Dream 曝光未用', content: '只被注入过，从未被打开或引用。' },
    { workspace: WS },
  ).record;
  for (let i = 0; i < 3; i += 1) store.markExposed([unused.id], { workspace: WS });
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');

  const btn = mini.findByText(view, makeT('zh')('dreamRun'), 'button');
  assert.ok(btn, '缺少 Dream 按钮');
  mini.click(btn);
  await settle(16);

  assert.ok(fetchCalls.some((call) => call.pathname === `${API_PREFIX}/dream`), '/dream 应被调用');
  const body = text();
  assert.match(body, /合并 1 簇/, '应显示合并簇数');
  assert.match(body, /曝光未用 [1-9]\d* 条/, '应显示曝光未用数');
  assert.match(body, /Dream 完成/, '应有完成提示');
});

await test('维护页：注入审计显示最近进 prompt 的字节与 hash', async () => {
  store.injectionLogAppend(WS, {
    kind: 'briefing',
    mode: 'index',
    ids: ['mem_audit_demo'],
    text: '注入审计样例正文：这一行真的进过 prompt。',
  });
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');
  await settle(8);

  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('injectionTitle'))), '缺少注入审计卡');
  assert.match(body, /注入审计样例正文/, '应显示注入预览');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/injections`),
    '/injections 应被调用',
  );
});

await test('维护页：整库快照卡列出备份，点「立即备份」调 /backup', async () => {
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');
  await settle(8);

  assert.match(text(), new RegExp(escapeRe(makeT('zh')('backupTitle'))), '缺少整库快照卡');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/backups`),
    '/backups 应被调用',
  );

  const btn = mini.findByText(view, makeT('zh')('backupRun'), 'button');
  assert.ok(btn, '缺少「立即备份」按钮');
  mini.click(btn);
  await settle(14);

  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/backup` && call.method === 'POST'),
    '/backup 应被调用',
  );
  const backups = store.snapshots({ limit: 50 });
  assert.ok(backups.length >= 1, '点完应该真的落了一份快照');
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('backupDone').slice(0, 4))), '应有备份完成提示');
  assert.ok(text().includes(backups[0].name.slice(0, 10)), '清单应显示快照时间');
});

await test('画像卡：段落带证据标签，没有证据的段标「未溯源」', async () => {
  const version = (store.portrait(WS)?.version || 0) + 1;
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/portrait/save`,
    body: {
      workspace: WS,
      sections: [
        { key: 'background', text: '有证据的背景段。' },
        { key: 'focus', text: '没有证据的关注段。' },
      ],
      evidence: { background: ['mem_evidence_demo', 'journal:2026-10-20'] },
    },
  });

  renderPage('zh');
  await settle(8);
  const open = mini.findByText(view, makeT('zh')('portraitOpen'), 'button');
  assert.ok(open, '缺少「展开画像」按钮');
  mini.click(open);
  await settle(6);

  const wsTitle = mini
    .findAll(
      view,
      (node) =>
        node.type === 'span' &&
        mini.textOf(node) === `${makeT('zh')('portraitWorkspaceLabel')} v${version}`,
    )
    .find((node) => typeof node.props.onClick === 'function');
  assert.ok(wsTitle, '找不到可点击的工作区画像子行标题');
  mini.click(wsTitle);
  await settle(6);

  const body = text();
  assert.match(body, /#mem_evidence_demo/, '应显示记忆证据标签');
  assert.match(body, /2026-10-20 日志/, '应显示日志证据');
  assert.match(
    body,
    new RegExp(escapeRe(makeT('zh')('portraitUntraced'))),
    '没有证据的段应标未溯源',
  );
});

await test('维护页待审队列：草稿批准后生效、拒绝后消失，徽标随草稿数变化', async () => {
  const d1 = store.upsert(
    { title: '审批草稿甲', content: '甲草稿正文', status: 'draft', source: 'auto' },
    { workspace: WS },
  );
  const d2 = store.upsert(
    { title: '审批草稿乙', content: '乙草稿正文', status: 'draft', source: 'auto' },
    { workspace: WS },
  );

  renderPage('zh');
  await settle(8);
  const maintainTab = mini
    .findAll(view, (node) => node.type === 'button' && mini.textOf(node).includes(makeT('zh')('tabMaintain')))
    .find((node) => mini.textOf(node).includes('2'));
  assert.ok(maintainTab, '有草稿时维护 tab 应带数量徽标');
  mini.click(maintainTab);
  await settle(8);

  const cards = mini.findAll(view, byClass('dshmem_draftCard'));
  assert.equal(cards.length, 2, '应有两张草稿卡');

  const approveBtn = mini.findByText(
    cards.find((card) => mini.textOf(card).includes('甲')),
    makeT('zh')('queueApprove'),
    'button',
  );
  assert.ok(approveBtn, '找不到批准按钮');
  mini.click(approveBtn);
  await settle(12);
  assert.equal(
    store.get(d1.record.id, { workspace: WS, includeDrafts: true }).status,
    'active',
    '批准后草稿应转正',
  );

  const cardB = mini
    .findAll(view, byClass('dshmem_draftCard'))
    .find((card) => mini.textOf(card).includes('乙'));
  assert.ok(cardB, '乙草稿卡应还在队列里');
  confirmAnswer = true;
  mini.click(mini.findByText(cardB, makeT('zh')('queueReject'), 'button'));
  await settle(12);
  assert.equal(store.get(d2.record.id, { workspace: WS, includeDrafts: true }), null, '拒绝即删除');
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('queueEmpty'))), '处理完后队列应显示为空');

  renderPage('zh');
  await settle(8);
  const bareTab = mini
    .findAll(view, (node) => node.type === 'button' && mini.textOf(node).includes(makeT('zh')('tabMaintain')))
    .find((node) => mini.textOf(node).trim() === makeT('zh')('tabMaintain'));
  assert.ok(bareTab, '维护 tab 常驻');
});

/* ------------------------------------------------------------------ *
 * 画像卡（portrait）
 * ------------------------------------------------------------------ */

await test('画像卡：渲染、展开显示两份画像、编辑保存走 /portrait/save', async () => {
  /* Dream 测试可能已经触发过一次画像重写：基准版本号要在本测试写入前取。 */
  const baseWsVersion = store.portrait(WS)?.version || 0;
  const baseGlVersion = store.portrait('')?.version || 0;

  /* 准备：给当前工作区与全局各写一份画像。 */
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/portrait/save`,
    body: {
      workspace: WS,
      sections: [
        { key: 'background', text: '客户端测试背景。' },
        { key: 'focus', text: '客户端测试关注。' },
      ],
    },
  });
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/portrait/save`,
    body: { workspace: WS, scope: 'global', sections: [{ key: 'preference', text: '全局偏好文本。' }] },
  });

  /* 版本号用动态值：本测试自己 +1，之前的 Dream/重写可能已经推过版本。 */
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);

  assert.match(text(), new RegExp(escapeRe(makeT('zh')('portraitTitle'))), '缺少画像卡标题');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/portrait`),
    '/portrait 应随页面加载',
  );

  /* 一层：展开画像卡 → 看到两份画像的子折叠行（正文不铺开）。 */
  const open = mini.findByText(view, makeT('zh')('portraitOpen'), 'button');
  assert.ok(open, '缺少「展开画像」按钮');
  mini.click(open);
  await settle(6);

  const opened = text();
  assert.match(opened, new RegExp(escapeRe(makeT('zh')('portraitWorkspaceLabel'))), '展开后应有工作区画像子行');
  assert.match(opened, new RegExp(escapeRe(makeT('zh')('portraitGlobalLabel'))), '展开后应有全局画像子行');
  assert.match(opened, /v\d+/, '应显示版本号');
  assert.ok(!opened.includes('客户端测试背景。'), '子折叠默认收起，正文不应铺开');

  /* 二层：点开工作区子行看正文，再点开全局子行。 */
  const wsTitle = mini.findByText(
    view,
    `${makeT('zh')('portraitWorkspaceLabel')} v${baseWsVersion + 1}`,
    'span',
  );
  assert.ok(wsTitle, '找不到工作区画像子行标题');
  mini.click(wsTitle);
  await settle(6);
  assert.ok(text().includes('客户端测试背景。'), '展开子行后应显示工作区画像正文');

  const glTitle = mini.findByText(
    view,
    `${makeT('zh')('portraitGlobalLabel')} v${baseGlVersion + 1}`,
    'span',
  );
  assert.ok(glTitle, '找不到全局画像子行标题');
  mini.click(glTitle);
  await settle(6);
  assert.ok(text().includes('全局偏好文本。'), '展开子行后应显示全局画像正文');

  /* 编辑工作区画像（第一个「编辑」按钮 = 画像卡内的工作区画像）。 */
  const edit = mini.findByText(view, makeT('zh')('editDoc'), 'button');
  assert.ok(edit, '缺少编辑按钮');
  mini.click(edit);
  await settle(6);

  const area = mini
    .findAllByTag(view, 'textarea')
    .find((node) => String(node.props.value || '').includes('**工作背景**'));
  assert.ok(area, '点编辑应打开画像编辑框（含段标题）');
  area.props.onChange({ target: { value: '**工作背景**\n改过的背景。\n\n**当前关注**\n改过的关注。' } });
  await settle(4);

  const save = mini.findByText(view, makeT('zh')('save'), 'button');
  assert.ok(save, '缺少保存按钮');
  mini.click(save);
  await settle(12);

  const after = store.portrait(WS);
  assert.equal(after.version, baseWsVersion + 2, '保存后版本递增（初始保存 + 编辑保存）');
  assert.equal(after.sections.find((s) => s.key === 'background').text, '改过的背景。');
  assert.equal(after.sections.find((s) => s.key === 'focus').text, '改过的关注。');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/portrait/save` && call.method === 'POST'),
    '/portrait/save 应被调用',
  );
  assert.match(text(), /画像已保存/, '保存后应出现提示');
});

await test('画像卡：这次变了什么——拉 /portrait/diff 并渲染 +/- 行', async () => {
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);

  const open = mini.findByText(view, makeT('zh')('portraitOpen'), 'button');
  assert.ok(open, '缺少「展开画像」按钮');
  mini.click(open);
  await settle(6);

  const diffBtn = mini.findByText(view, makeT('zh')('portraitDiff'), 'button');
  assert.ok(diffBtn, '缺少「这次变了什么」按钮');
  mini.click(diffBtn);
  await settle(12);

  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/portrait/diff`),
    '/portrait/diff 应被调用',
  );
  const now = text();
  assert.match(now, /v\d+ → v\d+/, '应显示版本区间');
  assert.match(now, /\+ 改过的背景。/, '应显示新增行');
  assert.match(now, /− 客户端测试背景。/, '应显示删除行');
});

await test('画像卡：重写按钮触发 /portrait/rewrite，完成后出提示', async () => {
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  const rewrite = mini.findByText(view, makeT('zh')('portraitRewrite'), 'button');
  assert.ok(rewrite, '缺少重写按钮');
  mini.click(rewrite);
  await settle(14);
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/portrait/rewrite` && call.method === 'POST'),
    '/portrait/rewrite 应被调用',
  );
  assert.match(text(), /画像已重写/, '应有完成提示');
  assert.equal(
    store.portrait(WS).sections.find((s) => s.key === 'background').text,
    '假重写背景。',
  );
});

await test('画像卡：待审重写稿——预览与批准', async () => {
  store.portraitDraftWrite(WS, {
    sections: [{ key: 'background', text: '待审背景。' }],
    basedOn: { version: store.portrait(WS)?.version || 0 },
  });
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  const open = mini.findByText(view, makeT('zh')('portraitOpen'), 'button');
  mini.click(open);
  await settle(6);
  assert.match(text(), new RegExp(escapeRe(makeT('zh')('portraitDraftHint'))), '应有待审提示');

  const preview = mini.findByText(view, makeT('zh')('portraitDraftView'), 'button');
  assert.ok(preview, '缺少预览按钮');
  mini.click(preview);
  await settle(8);
  assert.match(text(), /待审背景。/, '预览应显示重写稿内容');

  const approve = mini.findByText(view, makeT('zh')('portraitDraftApprove'), 'button');
  assert.ok(approve, '缺少批准按钮');
  mini.click(approve);
  await settle(12);
  assert.equal(store.portraitDraftRead(WS), null, '批准后待审清空');
  assert.equal(
    store.portrait(WS).sections.find((s) => s.key === 'background').text,
    '待审背景。',
  );
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/portrait/draft/approve`),
    'approve 端点应被调用',
  );
});

await test('工作日志条：展开拉取并显示当天日志', async () => {
  await api.handle({
    method: 'POST',
    pathname: `${API_PREFIX}/journal`,
    body: { workspace: WS, text: '客户端日志条目。' },
  });
  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  /* 「展开」按钮有多个（变化横幅 / 注入预览 / 日志条），日志条在最末尾。 */
  const opens = mini.findAll(
    view,
    (node) => node.type === 'button' && mini.textOf(node).trim() === makeT('zh')('recentOpen'),
  );
  assert.ok(opens.length >= 1, '应有展开按钮');
  mini.click(opens[opens.length - 1]);
  await settle(10);
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/journal`),
    '/journal 应被拉取',
  );
  assert.match(text(), /客户端日志条目。/);
});

/* ------------------------------------------------------------------ *
 * 派生链与复审队列
 * ------------------------------------------------------------------ */

await test('维护页：派生链卡显示派生条目与失效状态', async () => {
  const source = store.upsert(
    { title: '派生链的源条目', content: '派生链测试正文' },
    { workspace: WS },
  ).record;
  store.savePortrait(WS, {
    sections: [{ key: 'preference', text: '派生链测试段落' }],
    evidence: { preference: [source.id] },
  });
  /* 源被归档 → 画像那一层派生就失效了。 */
  store.update(source.id, { archived: true }, { workspace: WS });

  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');
  await settle(8);

  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('derivationTitle'))), '缺少派生链卡');
  assert.match(body, /已失效/, '应显示派生失效状态');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/derivations`),
    '/derivations 应被调用',
  );
});

await test('维护页：复审队列列出到期项，标记后不再到期', async () => {
  const rec = store.upsert(
    {
      title: '该复审的条目',
      content: '复审测试正文',
      category: 'decision',
      falsifier: '当接口变了这条就不成立',
      reviewAt: new Date(Date.now() - 86400000).toISOString(),
    },
    { workspace: WS },
  ).record;

  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  await clickTab('tabMaintain');
  await settle(8);

  const body = text();
  assert.match(body, new RegExp(escapeRe(makeT('zh')('reviewTitle'))), '缺少复审队列卡');
  assert.match(body, /该复审的条目/, '应列出到期条目');
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/reviews`),
    '/reviews 应被调用',
  );

  const btn = mini.findByText(view, makeT('zh')('reviewDone'), 'button');
  assert.ok(btn, '应有「已复审」按钮');
  mini.click(btn);
  await settle(16);
  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/review` && call.method === 'POST'),
    '/review 应被调用',
  );
  assert.equal(store.reviewQueue(WS).due.filter((r) => r.id === rec.id).length, 0, '复审后不应再到期');
});

await test('画像卡：「写进 AGENTS.md」按钮调用 /promote', async () => {
  /* AGENTS.md 写在工作区目录里，测试工作区是假路径：先把目录造出来。 */
  fs.mkdirSync(WS, { recursive: true });
  store.savePortrait(WS, {
    sections: [{ key: 'preference', text: '客户端画像约定。' }],
  });

  fetchCalls.length = 0;
  renderPage('zh');
  await settle(8);
  const btn = mini.findByText(view, makeT('zh')('portraitPromote'), 'button');
  assert.ok(btn, '应有「写进 AGENTS.md」按钮');
  mini.click(btn);
  await settle(16);

  assert.ok(
    fetchCalls.some((call) => call.pathname === `${API_PREFIX}/promote` && call.method === 'POST'),
    '/promote 应被调用',
  );
  const agents = fs.readFileSync(path.join(WS, 'AGENTS.md'), 'utf8');
  assert.match(agents, /客户端画像约定/, 'AGENTS.md 应写进画像那一段');
});

/* ------------------------------------------------------------------ *
 * 空库引导：安装后第一屏看到的就是它
 * ------------------------------------------------------------------ */

/* 用一个全新的空库 + 空工作区渲染，避免动到前面那些种子里程碑。
   autoCapture 默认关，所以这一屏如果不给「怎么开始」，用户装完只会看到一片空白。 */
await test('空库首屏：引导卡 + 一键开启自动提炼（POST /settings）', async () => {
  const emptyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-firstrun-'));
  const emptyWs = process.platform === 'win32' ? 'C:\\proj\\空库' : '/proj/empty';
  const emptyStore = createMemoryStore({ dir: path.join(emptyTmp, 'storage'), mirror: false });
  const emptySettingsValue = { enabled: true, briefing: true, autoCapture: false, mirror: false };
  const emptyApi = createApi({
    store: emptyStore,
    settings: {
      get: () => ({ ...emptySettingsValue }),
      set(patch) {
        Object.assign(emptySettingsValue, patch);
        return { ...emptySettingsValue };
      },
    },
    activeWorkspace: () => emptyWs,
    listWorkspaces: () => [{ root: emptyWs, key: 'empty', count: 0, active: true }],
    captures: () => [],
    version: '0.1.0',
    captureNow: async () => ({ ok: true, saved: 0 }),
    distillNow: async () => ({ candidates: [] }),
    rewriteNow: async () => ({ ok: true }),
    approveDraft: () => ({ ok: false, error: 'no_draft' }),
  });

  const settingsBodies = [];
  const callsStart = fetchCalls.length;
  activeApi = emptyApi;

  try {
    renderPage('zh');
    await settle(12);
    const t = makeT('zh');
    const body = text();
    assert.match(body, new RegExp(escapeRe(t('firstRunTitle'))), '空库没有显示引导卡');
    assert.match(body, new RegExp(escapeRe(t('firstRunStep1').slice(0, 10))), '引导卡缺少第一步');
    assert.match(body, new RegExp(escapeRe(t('firstRunStep3').slice(0, 10))), '引导卡缺少导入那一步');

    const autoBtn = mini.findByText(handle.tree, t('firstRunAuto'), 'button');
    assert.ok(autoBtn, '引导卡缺少「开启自动提炼」按钮');
    mini.click(autoBtn);
    await settle(10);

    settingsBodies.push(
      ...fetchCalls
        .slice(callsStart)
        .filter((call) => call.pathname === `${API_PREFIX}/settings` && call.body)
        .map((call) => call.body.settings || call.body),
    );
    assert.ok(
      settingsBodies.some((patch) => patch.autoCapture === true),
      '/settings 没有收到 autoCapture:true',
    );
    assert.equal(emptySettingsValue.autoCapture, true, '自动提炼没有被真的打开');
    assert.doesNotMatch(text(), new RegExp(escapeRe(t('firstRunAuto'))), '开启后按钮应换成「已开启」');
    assert.match(text(), new RegExp(escapeRe(t('firstRunAutoOn').slice(0, 8))), '开启后应显示已开启状态');
  } finally {
    activeApi = api;
  }
});

/* ------------------------------------------------------------------ *
 * 结果
 * ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
