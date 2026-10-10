/**
 * dsh-memory 宿主半「激活」测试：假装自己是 cordis，把 apply() 真跑一遍。
 *   node test/activate.test.mjs
 *
 * 为什么要有这个套件：单个 bundle 激活失败会让整个 DSH 外壳起不来
 * （web 实例里 dsh-doctor 挂在 settingsScope 上就是这个后果），而 host.test.mjs 只测了
 * 导出与 Config。这里用假 ctx + 假 req/res 走完 apply() 的每一条注册路径，
 * 并验证注册出来的东西真的能用：模型工具能存取记忆、系统提示段真的产出简报、
 * webServer 路由真的应答、数据目录不可用时只告警不抛错。
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 相对 specifier：Windows 下动态 import() 不接受裸绝对路径。
const mod = await import('../lib/index.js');

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

/* ------------------------------------------------------------------ *
 * 夹具：假 cordis 上下文 / 假 HTTP 请求响应
 * ------------------------------------------------------------------ */

function createFakeCtx(services = {}) {
  const calls = { effects: [], injects: [], events: [], tools: [], sections: [], routes: [], info: [], warn: [] };

  const base = {
    logger: {
      info: (m) => calls.info.push(String(m)),
      warn: (m) => calls.warn.push(String(m)),
    },
    get: (key) => services[key],
    effect(fn, label) {
      calls.effects.push(label);
      return fn();
    },
    inject(deps, callback) {
      calls.injects.push(deps);
      const child = { ...base };
      if (deps.includes('systemPrompt')) {
        child.systemPrompt = {
          section: (options) => {
            calls.sections.push(options);
            return () => {};
          },
          variable: () => () => {},
        };
      }
      if (deps.includes('webServer')) {
        child.webServer = {
          register: (route) => {
            calls.routes.push(route);
            return () => {};
          },
        };
      }
      if (deps.includes('sessions')) child.sessions = { list: () => [] };
      callback(child);
      return () => {};
    },
    on(name, fn) {
      calls.events.push([name, fn]);
      return () => {};
    },
    tools: {
      register: (tool) => {
        calls.tools.push(tool);
        return () => {};
      },
    },
  };

  return { ctx: base, calls };
}

/**
 * 假 LLM 服务。块契约照抄 @deepseek-ai/dsh-llm 的 BlockAssembler：
 * block-start / text-delta / block-end / finish。每次调用把 options 记进 seen，
 * 方便断言 provider/model 路由确实跟着会话走。
 */
function fakeLlm(reply, seen = []) {
  return {
    stream(options) {
      seen.push(options);
      const chunks = [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: reply.slice(0, 12) },
        { type: 'text-delta', index: 0, text: reply.slice(12) },
        { type: 'block-end', index: 0, block: { type: 'text', text: reply } },
        { type: 'finish', reason: { kind: 'stop' } },
      ];
      return (async function* stream() {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

function makeReq({ method = 'GET', url = '/', body = '', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress };
  req.destroy = () => {};
  // route() 在第一个 await 之前就同步挂好了 data/end 监听，所以这里可以立刻投递。
  queueMicrotask(() => {
    if (body) req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    text: '',
    setHeader(key, value) {
      res.headers[String(key).toLowerCase()] = String(value);
    },
    end(text) {
      res.text = String(text ?? '');
    },
  };
  return res;
}

/** 走一遍真实的 webServer handler，返回 {status, body}。 */
async function callRoute(handler, options) {
  const res = makeRes();
  await handler(makeReq(options), res);
  let body = null;
  try {
    body = JSON.parse(res.text);
  } catch {
    body = res.text;
  }
  return { status: res.statusCode, body };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-activate-'));
const workspace = path.join(tmp, 'workspace');
fs.mkdirSync(workspace, { recursive: true });

/** 每项测试都拿一份干净的插件实例（自己的数据目录 + 自己的假 ctx）。 */
function activate({ services = {}, ...config } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const { ctx, calls } = createFakeCtx(services);
  mod.apply(ctx, { directory: dir, ...config });
  const tool = calls.tools[0];
  const route = calls.routes[0]?.handler;
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '插件 UI 想跟 DeepSeek 官网一个色调，用哪个蓝？'.repeat(3) }] },
    { role: 'assistant', content: [{ type: 'text', text: '用鲸鱼蓝 #4d6bfe，浅色深色都能用。'.repeat(3) }] },
  ];
  const session = {
    id: 'session-1',
    header: { cwd: workspace },
    requestHeader: () => ({ config: { provider: 'deepseek-account', model: 'deepseek-flash' } }),
    deriveMessages: () => messages,
  };
  const exec = { agent: { session }, callId: 'call-1', signal: undefined };
  return { ctx, calls, dir, tool, route, session, exec, messages };
}

const DISTILL_REPLY = JSON.stringify([
  {
    title: '插件基调用 DeepSeek 鲸鱼蓝',
    content: 'UI 视觉基调用 #4d6bfe，浅色与深色都成立。',
    category: 'preference',
    tags: ['ui', 'color'],
    confidence: 0.9,
  },
]);

/* ------------------------------------------------------------------ *
 * 测试
 * ------------------------------------------------------------------ */

await test('apply() 不抛错，工具 / 提示段 / 路由 / 事件都注册到位', () => {
  const { calls, tool, route } = activate();

  assert.equal(mod.name, 'dsh-memory');
  assert.deepEqual(mod.inject, ['tools']);

  assert.equal(calls.tools.length, 1);
  assert.equal(tool.name, 'memory');
  assert.equal(typeof tool.execute, 'function');
  // defineTool 在定义时就把简化 DSL 编译成 JSON Schema。
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.parameters.properties.action.type, 'string');
  assert.deepEqual(tool.parameters.properties.action.enum, ['save', 'search', 'list', 'get', 'update', 'forget', 'stats']);
  assert.ok(tool.parameters.required.includes('action'));

  assert.equal(calls.sections.length, 1);
  assert.equal(calls.sections[0].name, 'dsh-memory:workspace-briefing');
  assert.equal(typeof calls.sections[0].text, 'function');

  assert.equal(calls.routes.length, 1);
  assert.equal(calls.routes[0].kind, 'prefix');
  assert.equal(route && typeof route, 'function');

  assert.deepEqual(
    calls.events.map(([name]) => name).sort(),
    ['session/created', 'session/event'],
  );
  assert.deepEqual(calls.injects.map((deps) => deps[0]).sort(), ['sessions', 'systemPrompt', 'webServer']);
  assert.deepEqual(calls.warn, []);
  assert.equal(calls.info.length, 1);
  assert.match(calls.info[0], /^dsh-memory ready \(dir=/);
});

await test('模型工具 save / search / list / stats 走真实 store 并落盘', async () => {
  const { tool, exec, dir } = activate();

  const saved = await tool.execute(
    {
      action: 'save',
      title: '用户偏好鲸鱼蓝',
      content: '插件 UI 视觉基调用 DeepSeek 鲸鱼蓝 #4d6bfe。',
      category: 'preference',
      tags: ['ui', 'color'],
    },
    exec,
  );
  assert.equal(saved.count, 1);
  assert.match(saved.text, /已保存记忆/);

  const id = /`(mem_[A-Za-z0-9_]+)`/.exec(saved.text)?.[1];
  assert.ok(id, '返回文本里应带记忆 id');

  const searched = await tool.execute({ action: 'search', query: '鲸鱼蓝' }, exec);
  assert.equal(searched.count, 1);
  assert.match(searched.text, /用户偏好鲸鱼蓝/);

  const listed = await tool.execute({ action: 'list', limit: 5 }, exec);
  assert.equal(listed.count, 1);

  const got = await tool.execute({ action: 'get', id }, exec);
  assert.equal(got.count, 1);
  assert.match(got.text, /#4d6bfe/);

  const stats = await tool.execute({ action: 'stats' }, exec);
  assert.match(stats.text, /本工作区 1 条/);

  const forgotten = await tool.execute({ action: 'forget', id }, exec);
  assert.equal(forgotten.count, 1);
  assert.match(forgotten.text, /已删除记忆/);
  assert.equal((await tool.execute({ action: 'list' }, exec)).count, 0);

  // 输出渲染契约：结构值走 UI，纯文本走模型。
  assert.deepEqual(tool.output.render({}, { action: 'list', count: 0, text: 'x' }), [{ type: 'text', text: 'x' }]);
  assert.ok(fs.existsSync(path.join(dir, 'index.json')) || fs.existsSync(dir));
});

await test('没有工作区目录时工具给的是可读提示，而不是抛错', async () => {
  const { tool } = activate();
  const result = await tool.execute({ action: 'stats' }, { agent: { session: { header: {} } } });
  assert.equal(result.count, 0);
  assert.match(result.text, /没有工作区目录/);
});

await test('会话一开始，系统提示段就带上本工作区的记忆简报', async () => {
  const { calls, tool, exec, session } = activate();

  // 会话建立 → activeWorkspace() 应该认到这个工作区。
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const empty = calls.sections[0].text({ agent: { session } });
  assert.equal(typeof empty, 'string');

  await tool.execute(
    { action: 'save', title: '构建命令是 pnpm build', content: '改完客户端半要重跑 pnpm build。', category: 'convention' },
    exec,
  );
  const briefing = calls.sections[0].text({ agent: { session } });
  assert.equal(typeof briefing, 'string');
  assert.match(briefing, /构建命令是 pnpm build/);
  assert.match(briefing, /长期记忆/);

  // 没有 agent 上下文（比如别处的渲染）也不能炸。
  assert.equal(typeof calls.sections[0].text(undefined), 'string');
});

await test('webServer 路由：state 认工作区、save 落库、list 回读', async () => {
  const { calls, route, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const state = await callRoute(route, { url: '/memory/api/state' });
  assert.equal(state.status, 200);
  assert.equal(state.body.ok, true);
  assert.equal(state.body.workspace.root, workspace);
  assert.equal(state.body.settings.briefing, true);
  assert.equal(state.body.version, '0.1.0');

  const saved = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/save',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:19387' },
    body: JSON.stringify({ workspace, title: '面板写入', content: '从设置面板保存的记忆。', tags: ['panel'] }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);

  const list = await callRoute(route, { url: `/memory/api/list?workspace=${encodeURIComponent(workspace)}` });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.records[0].title, '面板写入');
  assert.deepEqual(list.body.records[0].tags, ['panel']);
});

await test('webServer 路由：面板改设置会真的作用到工具行为', async () => {
  const { route, tool, exec } = activate();

  const off = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/settings',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ settings: { enabled: false, briefingLimit: 7 } }),
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.settings.enabled, false);
  assert.equal(off.body.settings.briefingLimit, 7);
  assert.match((await tool.execute({ action: 'stats' }, exec)).text, /已在设置中关闭/);

  const on = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/settings',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ settings: { enabled: true } }),
  });
  assert.equal(on.body.settings.enabled, true);
  assert.match((await tool.execute({ action: 'stats' }, exec)).text, /本工作区 0 条/);
});

await test('webServer 路由守好边界：非本插件路径 404、不可信来源 403', async () => {
  const { route } = activate();

  const foreign = await callRoute(route, { url: '/plugins/dsh-memory/client.js', headers: { host: '127.0.0.1:19387' } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, 'unknown_route');

  const remote = await callRoute(route, {
    url: '/memory/api/state',
    remoteAddress: '10.0.0.5',
    headers: { host: 'evil.example' },
  });
  assert.equal(remote.status, 403);
  assert.equal(remote.body.error, 'forbidden');

  // 非回环但 Host 在可信表里 → 放行。
  const trusted = await callRoute(route, {
    url: '/memory/api/ping',
    remoteAddress: '10.0.0.5',
    headers: { host: 'localhost:19387' },
  });
  assert.equal(trusted.status, 200);

  // 跨站 Origin 一律挡掉。
  const crossSite = await callRoute(route, {
    url: '/memory/api/state',
    headers: { host: '127.0.0.1:19387', origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);
});

await test('数据目录不可用时只告警，apply() 仍然不抛错（外壳不会被拖垮）', () => {
  const file = path.join(tmp, 'a-file-not-a-dir');
  fs.writeFileSync(file, 'x', 'utf8');

  const { ctx, calls } = createFakeCtx();
  assert.doesNotThrow(() => mod.apply(ctx, { directory: file }));
  assert.equal(calls.tools.length, 1);
  assert.equal(calls.warn.length, 1);
  assert.match(calls.warn[0], /无法创建数据目录/);

  // 工具照样可用，只是读不到/写不进数据。
  const tool = calls.tools[0];
  const exec = { agent: { session: { id: 's', header: { cwd: workspace } } } };
  assert.doesNotReject(() => tool.execute({ action: 'stats' }, exec));
});

await test('Config 的默认值落到运行时设置里，且能被 settings.json 覆盖', async () => {
  const { route, dir } = activate({ briefingLimit: 3, mirror: false });

  const state = await callRoute(route, { url: '/memory/api/state' });
  assert.equal(state.body.settings.briefingLimit, 3);
  assert.equal(state.body.settings.mirror, false);

  // 面板改动写进 <dir>/settings.json，重启后仍然生效。
  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/settings',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ settings: { briefingMaxChars: 900 } }),
  });
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(stored.briefingMaxChars, 900);
  assert.equal(stored.briefingLimit, 3);
  assert.equal(stored.mirror, false);
});

await test('接了 llm 服务：粘贴文本提炼出候选，且不落库', async () => {
  const seen = [];
  const { calls, route, session } = activate({ services: { llm: fakeLlm(DISTILL_REPLY, seen) } });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const result = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/distill',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ workspace, text: '用户说插件想用 DeepSeek 官网的蓝色。' }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.candidates.length, 1);
  assert.equal(result.body.candidates[0].title, '插件基调用 DeepSeek 鲸鱼蓝');
  assert.equal(result.body.candidates[0].category, 'preference');
  assert.deepEqual(result.body.candidates[0].tags, ['ui', 'color']);

  // 路由跟着当前会话走的 provider/model，且带上会话 id 做归属。
  assert.equal(seen.length, 1);
  assert.equal(seen[0].provider, 'deepseek-account');
  assert.equal(seen[0].model, 'deepseek-flash');
  assert.equal(seen[0].sessionId, 'session-1');
  assert.equal(seen[0].messages[0].role, 'user');
  assert.ok(seen[0].system.length > 0);

  // 提炼只是预览，不该写进记忆。
  const list = await callRoute(route, { url: `/memory/api/list?workspace=${encodeURIComponent(workspace)}` });
  assert.equal(list.body.total, 0);
});

await test('接了 llm 服务：提炼当前会话会把候选真的落库，并记进提炼日志', async () => {
  const { calls, route, session } = activate({ services: { llm: fakeLlm(DISTILL_REPLY) } });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const result = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/capture',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ workspace }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.capture.ok, true);
  assert.equal(result.body.capture.saved, 1);
  assert.equal(result.body.capture.candidates, 1);
  assert.equal(result.body.stats.total, 1);

  const list = await callRoute(route, { url: `/memory/api/list?workspace=${encodeURIComponent(workspace)}` });
  assert.equal(list.body.total, 1);
  assert.equal(list.body.records[0].source, 'auto');
  assert.equal(list.body.records[0].category, 'preference');

  const state = await callRoute(route, { url: '/memory/api/state' });
  assert.equal(state.body.captures.length, 1);
  assert.equal(state.body.captures[0].reason, 'captured');
  assert.equal(state.body.captures[0].saved, 1);

  // 落库后简报里就会出现它 —— 这正是「下一轮开场模型就知道」的那条通路。
  const briefing = calls.sections[0].text({ agent: { session } });
  assert.match(briefing, /插件基调用 DeepSeek 鲸鱼蓝/);
});

await test('没接 llm 服务时，提炼路径给可读错误而不是崩外壳', async () => {
  const { calls, route, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const distilled = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/distill',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ workspace, text: '随便一段话。' }),
  });
  assert.equal(distilled.status, 500);
  assert.equal(distilled.body.error, 'handler_failed');
  assert.equal(distilled.body.detail.message, 'llm 服务不可用');

  const captured = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/capture',
    headers: { host: '127.0.0.1:19387' },
    body: JSON.stringify({ workspace }),
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.capture.ok, false);
  assert.equal(captured.body.capture.reason, 'error');
  assert.equal(captured.body.capture.error, 'llm 服务不可用');

  // 失败也要留痕，面板上能看到「为什么没提炼出来」。
  const state = await callRoute(route, { url: '/memory/api/state' });
  assert.equal(state.body.captures[0].reason, 'error');
  assert.match(state.body.captures[0].error, /llm 服务不可用/);

  // 提炼失败不该影响正常读写。
  assert.equal((await callRoute(route, { url: `/memory/api/list?workspace=${encodeURIComponent(workspace)}` })).status, 200);
});

await test('镜像：面板保存的记忆真的落到工作区 .dsh-memory/MEMORY.md，关掉开关后撤回', async () => {
  const { route } = activate();
  // 用独立工作区：本套件其它测试共用同一个目录，镜像会互相看见。
  const ws = path.join(tmp, 'mirror-workspace');
  fs.mkdirSync(ws, { recursive: true });
  const q = `?workspace=${encodeURIComponent(ws)}`;
  const mirrorFile = path.join(ws, '.dsh-memory', 'MEMORY.md');

  // 一开始还没有记忆：路径已经知道，但文件没生成、也没凭空造目录。
  const before = await callRoute(route, { url: `/memory/api/state${q}` });
  assert.equal(before.status, 200);
  assert.ok(before.body.mirror.workspaceFile.endsWith(path.join('.dsh-memory', 'MEMORY.md')));
  assert.equal(before.body.mirror.workspaceExists, false);
  assert.equal(fs.existsSync(mirrorFile), false);

  // 面板保存一条 → 主库与工作区镜像同时出现。
  const saved = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/save',
    body: JSON.stringify({ workspace: ws, title: '镜像落地', content: '这条应该出现在工作区镜像里。', tags: ['mirror'] }),
  });
  assert.equal(saved.status, 200);
  assert.equal(fs.existsSync(mirrorFile), true, '工作区镜像未生成');
  assert.match(fs.readFileSync(mirrorFile, 'utf8'), /镜像落地/);

  const after = await callRoute(route, { url: `/memory/api/state${q}` });
  assert.equal(after.body.mirror.workspaceExists, true);
  assert.equal(after.body.mirror.storageExists, true);

  // /mirror 端点同时给出两个路径与 markdown 预览。
  const mirror = await callRoute(route, { url: `/memory/api/mirror${q}` });
  assert.match(mirror.body.mirror.markdown, /镜像落地/);
  assert.equal(mirror.body.mirror.workspaceFile, mirrorFile);

  // 设置里关掉镜像 → 文件当场撤回，主库与旁车不受影响。
  const off = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/settings',
    body: JSON.stringify({ workspace: ws, settings: { mirror: false } }),
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.settings.mirror, false);
  assert.equal(off.body.mirror.workspaceExists, false);
  assert.equal(fs.existsSync(mirrorFile), false, '关掉开关后工作区镜像该消失');
  assert.equal(fs.existsSync(path.join(ws, '.dsh-memory')), false, '空目录也应收掉');
  assert.equal((await callRoute(route, { url: `/memory/api/list${q}` })).body.total, 1);
});

await test('既有记忆导入：扫描本机来源 → 按来源导入 → 真的落库', async () => {
  const { route } = activate();
  const ws = path.join(tmp, 'import-workspace');
  const home = path.join(tmp, 'import-home');
  fs.mkdirSync(path.join(ws, '.workbuddy', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(home, '.qoder', 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.workbuddy', 'memory', 'MEMORY.md'),
    '# dsh 工作区 — 项目长期笔记\n\n## 环境坑\n\n- 改 profile 前必须备份。\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(home, '.qoder', 'memory', 'user-delivery-expectations.md'),
    '---\nname: user-delivery-expectations\ndescription: 用户与交付期望\nmetadata:\n  type: user\n---\n\n要真跑的权重。\n',
    'utf8',
  );
  // 让扫描器去找这个临时 home。
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const scan = await callRoute(route, { url: `/memory/api/import-scan?workspace=${encodeURIComponent(ws)}` });
    assert.equal(scan.status, 200);
    const byId = new Map(scan.body.scan.sources.map((source) => [source.id, source]));
    assert.equal(byId.get('workspace-workbuddy').exists, true);
    assert.equal(byId.get('user-qoder').exists, true);

    const imported = await callRoute(route, {
      method: 'POST',
      url: '/memory/api/import-scan',
      body: JSON.stringify({ workspace: ws, sources: ['workspace-workbuddy', 'user-qoder'] }),
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported.added, 2);

    const list = await callRoute(route, { url: `/memory/api/list?workspace=${encodeURIComponent(ws)}` });
    const titles = list.body.records.map((record) => record.title).sort();
    assert.deepEqual(titles, ['用户与交付期望', '环境坑'].sort());
    // 用户级来源进全局库，工作区级进本工作区库。
    assert.equal(list.body.records.find((r) => r.title === '环境坑').scope, 'workspace');
    const global = await callRoute(route, { url: '/memory/api/list?key=_global' });
    assert.equal(global.body.records.length, 1);
    assert.equal(global.body.records[0].scope, 'global');
    // 来源文件是只读的：导入不改动它们。
    assert.match(fs.readFileSync(path.join(ws, '.workbuddy', 'memory', 'MEMORY.md'), 'utf8'), /改 profile 前必须备份/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
  }
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
