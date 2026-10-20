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

async function listRecords(route, workspace) {
  const q = `?workspace=${encodeURIComponent(workspace)}`;
  const res = await callRoute(route, { url: `/memory/api/list${q}` });
  return res.body?.records || [];
}

/**
 * 假宿主跑一遍 `agent/pre-step`：把 claimed 交给插件的 waterfall 监听器，
 * `next()` 返回宿主的原生 decision（claimed 即「这一 step 要进入的批次」）。
 * 返回的就是宿主随后会落进会话、并发给模型的那份 decision。
 */
async function runPreStep(calls, payload) {
  const handler = calls.events.find(([name]) => name === 'agent/pre-step')[1];
  const claimed = payload.messages || [];
  const next = async () => ({ kind: 'enter', messages: claimed.slice() });
  return handler({ ...payload, messages: claimed }, next);
}

/**
 * 轮询等待一个异步条件成立。自动提炼是「发出去就不管」的后台任务，
 * 断言前必须等它自己跑完，不能靠固定 sleep 猜时间。
 */
async function waitFor(predicate, { timeout = 3000, step = 15 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-activate-'));
/* 版本号断言不写死——对着 package.json 比（bump 时不需要回来改测试）。 */
const pkgVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
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
  assert.deepEqual(
    tool.parameters.properties.action.enum,
    ['save', 'search', 'sessions', 'promote', 'list', 'get', 'update', 'forget', 'stats', 'journal'],
  );
  assert.ok(tool.parameters.required.includes('action'));

  assert.equal(calls.sections.length, 1);
  assert.equal(calls.sections[0].name, 'dsh-memory:workspace-briefing');
  assert.equal(typeof calls.sections[0].text, 'function');

  assert.equal(calls.routes.length, 1);
  assert.equal(calls.routes[0].kind, 'prefix');
  assert.equal(route && typeof route, 'function');

  assert.deepEqual(
    calls.events.map(([name]) => name).sort(),
    ['agent/pre-step', 'session/created', 'session/event', 'tools/pre-execute'],
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
  // 主库里的存储文件和人看的镜像文件是两个路径，stats 不能把前者标成「镜像文件」。
  assert.match(stats.text, /本工作区存储：`[^`]*memories\.json`/);
  assert.match(stats.text, /镜像文件：`[^`]*\.dsh-memory[\\/]MEMORY\.md`/);

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
  // 装得下的时候不该出现「只列了…」的说明。
  assert.doesNotMatch(briefing, /只列了/);

  // 没有 agent 上下文（比如别处的渲染）也不能炸。
  assert.equal(typeof calls.sections[0].text(undefined), 'string');
});

await test('记忆装不下时，简报会说明「只列了几条」而不是假装列全了', async () => {
  // 把字数上限压到刚好只能放 3 条（briefing 的规则：至少 3 条，之后看字数）。
  // 关掉 dedupe，否则这 5 条太像会被合并成 1 条（那是另一条测试覆盖的行为）。
  // 截断说明只在全文模式里出现（索引模式一行一条，默认另测）。
  const { calls, tool, exec, session } = activate({
    briefingMaxChars: 260,
    briefingLimit: 12,
    dedupe: false,
    briefMode: 'full',
  });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  for (let index = 0; index < 5; index += 1) {
    await tool.execute(
      {
        action: 'save',
        title: `约定 ${index}：${'长标题'.repeat(12)}`,
        content: '内容'.repeat(90),
        category: 'convention',
      },
      exec,
    );
  }

  const briefing = calls.sections[0].text({ agent: { session } });
  assert.match(briefing, /只列了最相关的 3 \/ 5 条/);
  assert.match(briefing, /action=list/);
});

await test('webServer 路由：state 认工作区、save 落库、list 回读', async () => {
  const { calls, route, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const state = await callRoute(route, { url: '/memory/api/state' });
  assert.equal(state.status, 200);
  assert.equal(state.body.ok, true);
  assert.equal(state.body.workspace.root, workspace);
  assert.equal(state.body.settings.briefing, true);
  assert.equal(state.body.version, pkgVersion);

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

await test('轮次结束的自动提炼：默认关着，一次 LLM 都不调', async () => {
  const seen = [];
  const { calls, session } = activate({ services: { llm: fakeLlm(DISTILL_REPLY, seen) } });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];

  assert.equal(onEvent(session, { type: 'turn/end' }), undefined);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(seen.length, 0, 'autoCapture 默认 false，不该烧 token');
});

await test('轮次结束的自动提炼：开着的时候后台真的落库', async () => {
  const { calls, route, session } = activate({
    services: { llm: fakeLlm(DISTILL_REPLY) },
    autoCapture: true,
    captureCooldownMs: 0,
    // 夹具对话只有一百多字，把门槛压下来才能走到 LLM（门槛本身由 distill 套件守着）。
    autoCaptureMinChars: 100,
  });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  const q = `?workspace=${encodeURIComponent(workspace)}`;

  onEvent(session, { type: 'turn/end' });

  const landed = await waitFor(async () => {
    const list = await callRoute(route, { url: `/memory/api/list${q}` });
    return list.body.records.some((record) => record.source === 'auto');
  });
  assert.ok(landed, '后台提炼应该把候选落库');

  const list = await callRoute(route, { url: `/memory/api/list${q}` });
  const record = list.body.records.find((item) => item.source === 'auto');
  assert.equal(record.title, '插件基调用 DeepSeek 鲸鱼蓝');
  assert.equal(record.sessionId, 'session-1');
  assert.equal(record.useCount, 0, '刚沉淀不等于被使用');
  assert.equal(record.exposedCount, 0, '落库本身不算曝光');

  // 面板上的「最近提炼」也要能看到这次自动提炼。
  const state = await callRoute(route, { url: `/memory/api/state${q}` });
  assert.equal(state.body.captures[0].reason, 'captured');
  assert.equal(state.body.captures[0].saved, 1);
});

await test('轮次结束的自动提炼：对话太短就直接跳过，不烧 token', async () => {
  const seen = [];
  const { calls, route, session, messages } = activate({
    services: { llm: fakeLlm(DISTILL_REPLY, seen) },
    autoCapture: true,
    captureCooldownMs: 0,
  });
  messages.length = 0;
  messages.push({ role: 'user', content: [{ type: 'text', text: '嗯' }] });

  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  onEvent(session, { type: 'turn/end' });

  const logged = await waitFor(async () => {
    const state = await callRoute(route, { url: `/memory/api/state?workspace=${encodeURIComponent(workspace)}` });
    return state.body.captures.length > 0;
  });
  assert.ok(logged, '跳过也要留痕');
  assert.equal(seen.length, 0, '太短就不该调用 LLM');
  const state = await callRoute(route, { url: `/memory/api/state?workspace=${encodeURIComponent(workspace)}` });
  assert.equal(state.body.captures[0].reason, 'too_short');
});

await test('轮次结束的自动提炼：LLM 卡住时轮次收尾照样立刻返回', () => {
  const stalling = { stream: () => (async function* stream() { await new Promise(() => {}); })() };
  const { calls, session } = activate({ services: { llm: stalling }, autoCapture: true, captureCooldownMs: 0 });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];

  const started = Date.now();
  onEvent(session, { type: 'turn/end' });
  // 真的把 LLM await 在轮次收尾里的话，这里会永远回不来。
  assert.ok(Date.now() - started < 500, '不能同步等 LLM');
});

await test('轮次结束的自动提炼：LLM 报错时只记 reason=error，不影响读写', async () => {
  const boom = { stream: () => (async function* stream() { throw new Error('boom'); })() };
  const { calls, route, session } = activate({
    services: { llm: boom },
    autoCapture: true,
    captureCooldownMs: 0,
    autoCaptureMinChars: 100,
  });
  const q = `?workspace=${encodeURIComponent(workspace)}`;
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];

  onEvent(session, { type: 'turn/end' });

  const logged = await waitFor(async () => {
    const state = await callRoute(route, { url: `/memory/api/state${q}` });
    return state.body.captures.some((entry) => entry.reason === 'error');
  });
  assert.ok(logged, '失败要留痕：' + JSON.stringify(calls.warn));
  const list = await callRoute(route, { url: `/memory/api/list${q}` });
  assert.equal(list.status, 200);
  assert.equal(list.body.records.length, 0);
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

await test('索引模式简报（默认）：一行一条带 id、不展开正文、页脚提示验证', async () => {
  const { calls, tool, exec, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);
  await tool.execute(
    { action: 'save', title: '索引模式的记忆', content: '这条正文不该出现在索引简报里。'.repeat(3), category: 'fact' },
    exec,
  );
  const briefing = calls.sections[0].text({ agent: { session } });
  assert.match(briefing, /索引模式的记忆/, '索引应有标题');
  assert.match(briefing, /`mem_[A-Za-z0-9_]+`/, '索引应带 id 供按需取正文');
  assert.doesNotMatch(briefing, /这条正文不该出现在索引简报里/, '索引模式不该展开正文');
  assert.match(briefing, /上面是索引/);
  assert.match(briefing, /先验证它们现在还存在/, '页脚应有验证式过期提示');
  // full 模式仍展开正文。
  const { calls: fullCalls, tool: fullTool, exec: fullExec, session: fullSession } = activate({ briefMode: 'full' });
  fullCalls.events.find(([name]) => name === 'session/created')[1](fullSession);
  await fullTool.execute({ action: 'save', title: '全文模式的记忆', content: '全文正文在这里。', category: 'fact' }, fullExec);
  assert.match(fullCalls.sections[0].text({ agent: { session: fullSession } }), /全文正文在这里。/);
});

await test('路径 JIT：工具触达 files 挂靠的文件时，相关记忆在下一个 pre-step 尾部注入', async () => {
  const { calls, tool, exec, session, route } = activate({ briefing: false, turnRecall: false });
  calls.events.find(([name]) => name === 'session/created')[1](session);
  await tool.execute(
    {
      action: 'save',
      title: '存储层分库约定',
      content: '每个工作区一个 memories.json；改存储层前先看这个文件。',
      category: 'convention',
      files: ['lib/store.js'],
    },
    exec,
  );

  /* 工具触达挂靠文件：pre-execute 只观察（原样放行 next()），把路径记进 stash。 */
  const preExecute = calls.events.find(([name]) => name === 'tools/pre-execute')[1];
  const passthrough = Symbol('passthrough');
  const released = await preExecute(
    { agent: { session }, name: 'read', args: { path: `${workspace}/lib/store.js` } },
    async () => passthrough,
  );
  assert.equal(released, passthrough, 'pre-execute 不拥有决策，必须原样放行 next()');

  /* 下一个 pre-step：路径召回作为尾部消息进入本 step。 */
  const userMessage = { role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } };
  const entered = await runPreStep(calls, { agent: { session }, messages: [userMessage], turn: 1, step: 2 });
  assert.equal(entered.messages.length, 2, '路径召回应作为一条额外消息进入本 step');
  assert.equal(entered.messages[0], userMessage, '被认领的消息保持原样在前');
  const tail = entered.messages[1];
  assert.equal(tail.source.kind, 'dsh-memory');
  assert.equal(tail.source.form, 'path-recall');
  assert.ok(
    tail.source.files.some((file) => /lib[\\/]+store\.js$/.test(file)),
    '触达的 store.js 应进入召回批次',
  );
  const tailText = tail.content.map((block) => block.text).join('');
  assert.match(tailText, /相关记忆（按文件触达）/);
  assert.match(tailText, /只是背景参考/, '路径召回同样要写清是背景参考');
  assert.match(tailText, /存储层分库约定/);

  const recalled = (await listRecords(route, workspace)).find((r) => r.title === '存储层分库约定');
  assert.equal(recalled.exposedCount, 1, '路径 JIT 注入应记曝光');
  assert.equal(recalled.useCount, 0, '曝光不是使用');

  /* 同一次触达只注入一次：stash 已弹出，后续 pre-step 不再带出。 */
  const again = await runPreStep(calls, {
    agent: { session },
    messages: [{ role: 'user', content: [{ type: 'text', text: '再继续' }], source: { kind: 'user' } }],
    turn: 1,
    step: 3,
  });
  assert.equal(again.messages.length, 1, '同一次文件触达不该重复注入');

  /* 触达没有挂靠记忆的文件：不出额外消息。 */
  await preExecute(
    { agent: { session }, name: 'read', args: { path: `${workspace}/README.md` } },
    async () => null,
  );
  const clean = await runPreStep(calls, {
    agent: { session },
    messages: [{ role: 'user', content: [{ type: 'text', text: '换文件' }], source: { kind: 'user' } }],
    turn: 1,
    step: 4,
  });
  assert.equal(clean.messages.length, 1, '没有命中时不注入');
});

await test('会话索引与溯源：turn/end 落原文，action=sessions 搜回原话', async () => {
  const { calls, tool, exec, session } = activate({ briefing: false, turnRecall: false });
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  session.deriveMessages = () => [
    { role: 'user', content: [{ type: 'text', text: '我们决定检索层用 BM25F 加 RRF 融合' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
  ];
  onEvent(session, { type: 'turn/end', turn: 3 });

  const hit = await tool.execute({ action: 'sessions', query: 'BM25F 融合' }, exec);
  assert.ok(hit.text.includes('BM25F'), '应搜回当轮原话');
  assert.ok(hit.text.includes('turn 3'), '应带轮次');

  const miss = await tool.execute({ action: 'sessions', query: '完全不相关的长颈鹿话题' }, exec);
  assert.equal(miss.count, 0, '无命中时明说');
});

await test('程序记忆晋升：action=promote 写进 AGENTS.md 托管块，重复晋升幂等', async () => {
  const { tool, exec } = activate({ briefing: false });
  const saved = await tool.execute(
    { action: 'save', title: '发版前先跑测试', content: '改完任何一半都要重跑全部断言。', category: 'convention' },
    exec,
  );
  const id = (saved.text.match(/`([^`]+)`/) || [])[1];
  assert.ok(id, 'save 的返回文本里应带新记忆 id');

  const promoted = await tool.execute({ action: 'promote', id }, exec);
  assert.match(promoted.text, /已晋升进/);
  const agentsMd = fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /发版前先跑测试/);
  assert.match(agentsMd, /dsh-memory:promoted 开始/);

  const again = await tool.execute({ action: 'promote', id }, exec);
  assert.match(again.text, /已晋升进/);
  const twice = fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');
  assert.equal((twice.match(/发版前先跑测试/g) || []).length, 1, '重复晋升不产生重复行');

  const global = await tool.execute(
    { action: 'save', title: '全局偏好', content: '全局内容', category: 'preference', scope: 'global' },
    exec,
  );
  const globalId = (global.text.match(/`([^`]+)`/) || [])[1];
  const refused = await tool.execute({ action: 'promote', id: globalId }, exec);
  assert.match(refused.text, /不晋升/, 'global 记忆应拒绝晋升');

  const junk = await tool.execute(
    { action: 'save', title: '一条笔记', content: '普通笔记', category: 'note' },
    exec,
  );
  const junkId = (junk.text.match(/`([^`]+)`/) || [])[1];
  const notPromotable = await tool.execute({ action: 'promote', id: junkId }, exec);
  assert.match(notPromotable.text, /只有 convention/);
});

await test('压缩协同：compaction/summary 把摘要照录进工作日志', async () => {
  const { calls, route, session } = activate({ briefing: false, autoCapture: false });
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];

  onEvent(session, { type: 'compaction/summary', data: { summary: '本轮敲定检索层用 BM25F' } });
  const read1 = await callRoute(route, { method: 'GET', url: '/memory/api/journal?days=1' });
  const text1 = (read1.body?.recent || []).map((item) => item.text).join('\n');
  assert.match(text1, /上下文已压缩；压缩摘要（原文照录）：本轮敲定检索层用 BM25F/);

  onEvent(session, { type: 'compaction/prune' });
  const read2 = await callRoute(route, { method: 'GET', url: '/memory/api/journal?days=1' });
  const text2 = (read2.body?.recent || []).map((item) => item.text).join('\n');
  assert.match(text2, /上下文已压缩；压缩前的结论如未写进记忆或日志/);
});

await test('轮末召回改走尾部注入：系统提示里没有召回，agent/pre-step 每轮只注入一次', async () => {
  const { calls, tool, exec, session } = activate({ briefing: false });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  calls.events.find(([name]) => name === 'session/created')[1](session);
  await tool.execute(
    { action: 'save', title: '构建命令是 pnpm build', content: '改完客户端半要重跑 pnpm build。', category: 'convention' },
    exec,
  );

  // 当轮用户消息提到构建 → 命中该记忆 → 缓冲给下一轮。
  session.deriveMessages = () => [
    { role: 'user', content: [{ type: 'text', text: '帮我跑一下构建命令，然后告诉我结果' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
  ];
  onEvent(session, { type: 'turn/end' });

  // 系统提示段里不再有召回块——它已经挪到尾部注入。
  const sectionText = calls.sections[0].text({ agent: { session } });
  assert.equal(sectionText, '', '简报关着时系统提示段就是空的');
  assert.doesNotMatch(sectionText, /与当前话题相关的召回/);

  // 下一轮 step 1：召回作为一条额外的 user 消息折进进入批次（紧跟被认领的消息）。
  const userMessage = { role: 'user', content: [{ type: 'text', text: '那构建产物在哪' }], source: { kind: 'user' } };
  const entered = await runPreStep(calls, { agent: { session }, messages: [userMessage], turn: 2, step: 1 });
  assert.equal(entered.messages.length, 2, '召回应作为一条额外消息进入本 step');
  assert.equal(entered.messages[0], userMessage, '被认领的消息保持原样在前');
  const tail = entered.messages[1];
  assert.equal(tail.role, 'user');
  assert.equal(tail.source.kind, 'dsh-memory');
  assert.equal(tail.source.form, 'turn-recall');
  assert.equal(tail.source.turn, 2);
  const tailText = tail.content.map((block) => block.text).join('');
  assert.match(tailText, /与当前话题相关的召回/);
  assert.match(tailText, /只是背景参考/, '尾部注入要写清是背景参考');
  assert.match(tailText, /构建命令是 pnpm build/);
  assert.match(tailText, /改完客户端半要重跑/, '召回块带正文摘录');

  // 同一轮的后续 step 不再重复注入。
  const step2 = await runPreStep(calls, {
    agent: { session },
    messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }],
    turn: 2,
    step: 2,
  });
  assert.equal(step2.messages.length, 1, '同一轮第二次 pre-step 不该再注入');

  // 连续第二轮同样的话题：上轮已召回的不重复注入。
  onEvent(session, { type: 'turn/end' });
  const third = await runPreStep(calls, {
    agent: { session },
    messages: [{ role: 'user', content: [{ type: 'text', text: '构建又挂了' }], source: { kind: 'user' } }],
    turn: 3,
    step: 1,
  });
  assert.equal(third.messages.length, 1, '连续两轮不该重复召回同一条');
  assert.doesNotMatch(calls.sections[0].text({ agent: { session } }), /与当前话题相关的召回/);
});

await test('轮末召回：排期不等于曝光，真正注入时才记 exposedCount', async () => {
  const { calls, tool, exec, session, route } = activate({ briefing: false, autoCapture: false });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const saved = await tool.execute(
    { action: 'save', title: '构建命令是 pnpm build', content: '改完客户端半要重跑 pnpm build。', category: 'convention' },
    exec,
  );
  const id = /`(mem_[A-Za-z0-9_]+)`/.exec(saved.text)?.[1];

  session.deriveMessages = () => [
    { role: 'user', content: [{ type: 'text', text: '帮我跑一下构建命令，然后告诉我结果' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
  ];
  onEvent(session, { type: 'turn/end' });

  const scheduled = (await listRecords(route, workspace)).find((r) => r.id === id);
  assert.equal(scheduled.exposedCount, 0, '只是排期、还没注入，不该算曝光');
  assert.equal(scheduled.useCount, 0, '排期更不该算使用');

  const userMessage = { role: 'user', content: [{ type: 'text', text: '那构建产物在哪' }], source: { kind: 'user' } };
  const entered = await runPreStep(calls, { agent: { session }, messages: [userMessage], turn: 2, step: 1 });
  assert.equal(entered.messages.length, 2, '召回应该真的注入');

  const injected = (await listRecords(route, workspace)).find((r) => r.id === id);
  assert.equal(injected.exposedCount, 1, '真正进入 prompt 才记曝光');
  assert.equal(injected.useCount, 0, '曝光不能冒充使用');
});

await test('搜索只记曝光，get 记打开，assistant 引用 id 记 cited', async () => {
  const { calls, tool, exec, session, route } = activate({
    briefing: false,
    turnRecall: false,
    autoCapture: false,
  });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const saved = await tool.execute(
    { action: 'save', title: '检索计数约定', content: '搜索命中只算看见，读过或引用才算使用。', category: 'convention' },
    exec,
  );
  const id = /`(mem_[A-Za-z0-9_]+)`/.exec(saved.text)?.[1];

  await tool.execute({ action: 'search', query: '检索计数' }, exec);
  const afterSearch = (await listRecords(route, workspace)).find((r) => r.id === id);
  assert.equal(afterSearch.exposedCount, 1);
  assert.equal(afterSearch.useCount, 0);
  assert.equal(afterSearch.openedCount, 0);

  const got = await tool.execute({ action: 'get', id }, exec);
  assert.match(got.text, /打开 1/);
  assert.match(got.text, /引用 0/);
  const afterGet = (await listRecords(route, workspace)).find((r) => r.id === id);
  assert.equal(afterGet.openedCount, 1);
  assert.equal(afterGet.useCount, 1);

  session.deriveMessages = () => [
    { role: 'assistant', content: [{ type: 'text', text: `结论见 ${id}。` }] },
  ];
  onEvent(session, { type: 'turn/end' });
  const afterCite = (await listRecords(route, workspace)).find((r) => r.id === id);
  assert.equal(afterCite.citedCount, 1);
  assert.equal(afterCite.useCount, 2);
});

await test('注入审计：简报与尾部召回都留下可复算的字节、hash 与取舍', async () => {
  const { calls, tool, exec, session, route } = activate({ autoCapture: false, briefingLimit: 1 });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const q = `?workspace=${encodeURIComponent(workspace)}`;

  await tool.execute(
    { action: 'save', title: '审计用的记忆甲', content: '这条记忆用来验证注入审计确实记下了进 prompt 的字节。', category: 'fact' },
    exec,
  );

  calls.sections[0].text({ agent: { session } });
  calls.sections[0].text({ agent: { session } });

  let entries = (await callRoute(route, { url: `/memory/api/injections${q}` })).body.entries;
  assert.equal(entries.length, 1, '同一会话冻结后不应重复记账');
  assert.equal(entries[0].kind, 'briefing');
  assert.equal(entries[0].hash.length, 16);
  assert.ok(entries[0].chars > 0);
  assert.ok(entries[0].preview.includes('工作区长期记忆'), '审计应能看到真正注入的正文');
  assert.ok(entries[0].ids.length >= 1, '审计应记下带了哪些记忆 id');

  /* 简报已冻结：之后新增的记忆不在简报里，才可能被尾部召回带出去。 */
  await tool.execute(
    { action: 'save', title: '审计用的记忆乙', content: '这条在简报冻结之后写入，只有尾部召回才会带上它。', category: 'fact' },
    exec,
  );
  session.deriveMessages = () => [
    { role: 'user', content: [{ type: 'text', text: '帮我看看审计用的记忆乙' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
  ];
  onEvent(session, { type: 'turn/end' });
  const userMessage = { role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } };
  await runPreStep(calls, { agent: { session }, messages: [userMessage], turn: 2, step: 1 });

  entries = (await callRoute(route, { url: `/memory/api/injections${q}` })).body.entries;
  const kinds = entries.map((entry) => entry.kind);
  assert.ok(kinds.includes('turn-recall'), `应有尾部召回审计，实际=${kinds.join(',')}`);
  const tail = entries.find((entry) => entry.kind === 'turn-recall');
  assert.equal(tail.hash.length, 16);
  assert.ok(tail.ids.length >= 1, '尾部召回应记下 id');
});

await test('captureMode=draft：自动提炼先进队列，批准后才生效', async () => {
  const { calls, route, session } = activate({
    services: { llm: fakeLlm(DISTILL_REPLY) },
    autoCapture: true,
    captureMode: 'draft',
    captureCooldownMs: 0,
    autoCaptureMinChars: 100,
  });
  const onEvent = calls.events.find(([name]) => name === 'session/event')[1];
  const q = `?workspace=${encodeURIComponent(workspace)}`;

  onEvent(session, { type: 'turn/end' });

  const queued = await waitFor(async () => {
    const queue = await callRoute(route, { url: `/memory/api/queue${q}` });
    return queue.body.records.length > 0;
  });
  assert.ok(queued, '草稿应进待审队列');
  const draft = (await callRoute(route, { url: `/memory/api/queue${q}` })).body.records[0];
  assert.equal(draft.status, 'draft');

  // 草稿不进默认列表（不进简报、不进检索是同一道过滤）。
  const list = await callRoute(route, { url: `/memory/api/list${q}` });
  assert.equal(list.body.records.length, 0);
  // 提炼日志记 reason=drafted，与直接落库区分。
  const state = await callRoute(route, { url: `/memory/api/state${q}` });
  assert.equal(state.body.captures[0].reason, 'drafted');

  const approved = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/queue/approve',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:19387' },
    body: JSON.stringify({ id: draft.id }),
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.record.status, 'active');

  const listAfter = await callRoute(route, { url: `/memory/api/list${q}` });
  assert.equal(listAfter.body.records.length, 1, '批准后进默认列表');
  assert.equal(listAfter.body.records[0].title, '插件基调用 DeepSeek 鲸鱼蓝');
});

await test('工具 save 带 supersedes：旧条归档，get 展示版本链', async () => {
  const { tool, exec } = activate();
  const old = await tool.execute(
    { action: 'save', title: '旧构建结论', content: '用 webpack 构建', category: 'decision' },
    exec,
  );
  const oldId = /`(mem_[A-Za-z0-9_]+)`/.exec(old.text)?.[1];
  assert.ok(oldId);

  const sup = await tool.execute(
    { action: 'save', title: '新构建结论', content: '改用 vite 构建', category: 'decision', supersedes: oldId },
    exec,
  );
  assert.match(sup.text, /归档被推翻的旧记忆/);

  const newId = /`(mem_[A-Za-z0-9_]+)`/.exec(sup.text)?.[1];
  const got = await tool.execute({ action: 'get', id: newId }, exec);
  assert.match(got.text, /推翻了/, 'get 应展示版本链');

  const listed = await tool.execute({ action: 'list' }, exec);
  assert.equal(listed.count, 1, '旧条归档后 list 只剩新条');
});

/* ------------------------------------------------------------------ *
 * 画像层（portrait）：注入、冻结、API
 * ------------------------------------------------------------------ */

await test('portrait 模式：简报里画像全量在前、索引清单在后', async () => {
  const { calls, tool, exec, session, route } = activate({ briefMode: 'portrait' });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  /* 先没有画像也没有记录：简报为空但不炸。 */
  assert.equal(calls.sections[0].text({ agent: { session } }), '');

  const saved = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({
      workspace,
      scope: 'workspace',
      sections: [
        { key: 'background', text: '这是画像背景段落。' },
        { key: 'focus', text: '这是画像关注段落。' },
      ],
    }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.portrait.version, 1);

  await tool.execute(
    { action: 'save', title: '画像模式下的普通条目', content: '正文。', category: 'fact' },
    exec,
  );

  /* 画像对 session-1 已冻结（当时为空），换新会话看新文本。 */
  const briefing = calls.sections[0].text({ agent: { session: { ...session, id: 'session-2' } } });
  assert.match(briefing, /### 工作区画像（v1）/);
  assert.match(briefing, /这是画像背景段落。/);
  assert.match(briefing, /画像模式下的普通条目/, '索引清单也要在');
});

await test('portrait 快照：首次渲染为空，画像落库后的下一次渲染即生效并重新冻结', async () => {
  const { calls, route, session } = activate({ briefMode: 'portrait' });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  /* 第一次渲染即冻结（此刻画像为空）。 */
  const first = calls.sections[0].text({ agent: { session } });
  assert.equal(first, '');

  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '会话一之后写入。' }] }),
  });

  /* 画像真的变了 → 下一次渲染重算一次（内容变了就该生效）。 */
  const again = calls.sections[0].text({ agent: { session } });
  assert.match(again, /会话一之后写入。/, '画像落库后下一次渲染应带上它');

  /* 重算之后再冻结：连续两次渲染逐字节相同。 */
  assert.equal(calls.sections[0].text({ agent: { session } }), again, '重新冻结后必须逐字节稳定');

  /* 新会话同样看得到。 */
  assert.match(
    calls.sections[0].text({ agent: { session: { ...session, id: 'session-fresh' } } }),
    /会话一之后写入。/,
  );
});

await test('portrait 快照：重写后重算一次，之后继续逐字节稳定（前缀缓存不受持续影响）', async () => {
  const { calls, route, session } = activate({ briefMode: 'portrait' });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '第一版画像。' }] }),
  });
  const a = calls.sections[0].text({ agent: { session } });
  assert.match(a, /第一版画像。/);
  assert.equal(calls.sections[0].text({ agent: { session } }), a, '没有任何写入时逐字节稳定');

  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '第二版画像。' }] }),
  });
  const b = calls.sections[0].text({ agent: { session } });
  assert.match(b, /第二版画像。/, '重写是一次真实写入，下一次渲染应带上新版本');
  assert.notEqual(b, a, '内容变了，文本当然会变');
  assert.equal(calls.sections[0].text({ agent: { session } }), b, '重算之后重新冻结，后续请求逐字节相同');
});

await test('portrait API：GET 读取、save 版本递增、history 降序、坏请求 400', async () => {
  const { calls, route, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);

  const empty = await callRoute(route, { url: '/memory/api/portrait' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.workspace, null);
  assert.equal(empty.body.global, null);
  assert.equal(empty.body.sectionDefs.length, 4);

  const save1 = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'focus', text: '一。' }] }),
  });
  assert.equal(save1.body.portrait.version, 1);

  const save2 = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'focus', text: '二。' }] }),
  });
  assert.equal(save2.body.portrait.version, 2);

  const globalSave = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, scope: 'global', sections: [{ key: 'preference', text: '全局段。' }] }),
  });
  assert.equal(globalSave.body.portrait.scope, 'global');

  const read = await callRoute(route, { url: '/memory/api/portrait' });
  assert.equal(read.body.workspace.version, 2);
  assert.equal(read.body.workspace.sections.find((s) => s.key === 'focus').text, '二。');
  assert.equal(read.body.global.version, 1);
  assert.equal(read.body.global.sections.find((s) => s.key === 'preference').text, '全局段。');

  const history = await callRoute(route, { url: '/memory/api/portrait/history' });
  assert.equal(history.body.history[0].version, 2);
  assert.equal(history.body.history[0].current, true);
  assert.equal(history.body.history[1].version, 1);

  const bad = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace }),
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_sections');
});

await test('portrait 预览：/briefing-preview 给出画像计量并排除画像条目', async () => {
  const { calls, route, session } = activate({ briefMode: 'portrait' });
  calls.events.find(([name]) => name === 'session/created')[1](session);

  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '预览用背景。' }] }),
  });
  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/save',
    body: JSON.stringify({ workspace, title: '画像条目样例', content: 'x', tags: ['portrait'], pinned: true }),
  });
  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/save',
    body: JSON.stringify({ workspace, title: '普通条目样例', content: 'y' }),
  });

  const preview = await callRoute(route, { url: '/memory/api/briefing-preview' });
  assert.equal(preview.body.preview.mode, 'portrait');
  assert.ok(preview.body.preview.portrait.chars > 0, '画像计量应为正');
  assert.ok(!preview.body.preview.titles.includes('画像条目样例'), '画像条目不应进清单');
  assert.ok(preview.body.preview.titles.includes('普通条目样例'), '普通条目应在清单');
});

/* ------------------------------------------------------------------ *
 * M1：日志层 / 记忆纪律 / 画像重写管线
 * ------------------------------------------------------------------ */

const REWRITE_REPLY = JSON.stringify({
  sections: [
    { key: 'background', text: '重写后的背景。' },
    { key: 'focus', text: '重写后的关注。' },
  ],
  evidence: { background: ['journal:2026-10-20'], focus: [] },
});

await test('工具 journal：写一条、再读回来；空文本拒绝', async () => {
  const { tool, exec } = activate();
  const w = await tool.execute({ action: 'journal', text: '完成了 M1 日志层。' }, exec);
  assert.match(w.text, /已写入工作日志/);
  assert.equal(w.count, 1);
  const r = await tool.execute({ action: 'journal' }, exec);
  assert.match(r.text, /完成了 M1 日志层。/);
  const empty = await tool.execute({ action: 'journal', text: '   ' }, exec);
  assert.match(empty.text, /内容为空/);
});

await test('记忆纪律：默认注入；discipline=false 时不出现', async () => {
  /* 正文要够长：store 的质量闸门会归档「自动/agent 来源 + 低质量」的新条目，
     而 tool.save 的来源就是 agent——测试数据得像一条真记忆。 */
  const good = {
    action: 'save',
    title: '记纪律用的样例记忆',
    content: '这条正文足够长，不会被质量闸门归档，也不会被当成元记忆。',
    category: 'fact',
  };
  const a1 = activate();
  a1.calls.events.find(([name]) => name === 'session/created')[1](a1.session);
  await a1.tool.execute(good, a1.exec);
  const withDiscipline = a1.calls.sections[0].text({ agent: { session: a1.session } });
  assert.match(withDiscipline, /记忆纪律/);
  assert.match(withDiscipline, /action=journal/);
  assert.match(withDiscipline, /记住/);

  const a2 = activate({ discipline: false });
  a2.calls.events.find(([name]) => name === 'session/created')[1](a2.session);
  await a2.tool.execute({ ...good, title: '记纪律用的样例记忆（二）' }, a2.exec);
  const without = a2.calls.sections[0].text({ agent: { session: a2.session } });
  assert.doesNotMatch(without, /记忆纪律/);
});

await test('画像重写 direct：落库版本 +1，提示词里带日志原料', async () => {
  const seen = [];
  const { calls, route, session, tool, exec } = activate({ services: { llm: fakeLlm(REWRITE_REPLY, seen) } });
  calls.events.find(([name]) => name === 'session/created')[1](session);
  await tool.execute({ action: 'journal', text: '重写原料日志。' }, exec);
  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '旧背景。' }] }),
  });

  const res = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/rewrite',
    body: JSON.stringify({ workspace, scope: 'workspace' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.drafted, false);
  assert.equal(res.body.portrait.version, 2);
  assert.equal(res.body.portrait.sections.find((s) => s.key === 'background').text, '重写后的背景。');
  assert.deepEqual(res.body.portrait.evidence.background, ['journal:2026-10-20'], '重写的证据应落库');
  assert.equal(res.body.portrait.sectionMeta.background.untraced, false);
  assert.equal(res.body.portrait.sectionMeta.focus.untraced, true, '没有证据的段标未溯源');

  const prompt = seen.at(-1)?.messages?.[0]?.content?.[0]?.text || '';
  assert.match(prompt, /重写原料日志。/, '提示词应包含日志原料');
});

await test('画像重写 draft：进待审 → 批准后生效 → 重复批准 404', async () => {
  const { calls, route, session } = activate({ services: { llm: fakeLlm(REWRITE_REPLY) } });
  calls.events.find(([name]) => name === 'session/created')[1](session);
  await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/save',
    body: JSON.stringify({ workspace, sections: [{ key: 'background', text: '旧背景。' }] }),
  });

  const res = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/rewrite',
    body: JSON.stringify({ workspace, mode: 'draft' }),
  });
  assert.equal(res.body.drafted, true);
  assert.equal(res.body.sections.find((s) => s.key === 'background').text, '重写后的背景。');

  const state = await callRoute(route, { url: '/memory/api/portrait' });
  assert.equal(state.body.draft, true);
  assert.equal(state.body.workspace.version, 1, '批准前画像不变');

  const draft = await callRoute(route, { url: '/memory/api/portrait/draft' });
  assert.equal(draft.body.draft.sections.find((s) => s.key === 'background').text, '重写后的背景。');
  assert.deepEqual(draft.body.draft.evidence.background, ['journal:2026-10-20'], '草稿应带证据');

  const approve = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/draft/approve',
    body: JSON.stringify({ workspace }),
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.portrait.version, 2);

  const after = await callRoute(route, { url: '/memory/api/portrait' });
  assert.equal(after.body.draft, false);
  assert.equal(after.body.workspace.sections.find((s) => s.key === 'background').text, '重写后的背景。');
  assert.deepEqual(after.body.workspace.evidence.background, ['journal:2026-10-20'], '批准后证据生效');

  const again = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/portrait/draft/approve',
    body: JSON.stringify({ workspace }),
  });
  assert.equal(again.status, 404, '没有待审稿时应 404');
});

await test('journal API：写与读、空文本 400、指定日期校验', async () => {
  const { calls, route, session } = activate();
  calls.events.find(([name]) => name === 'session/created')[1](session);
  const w = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/journal',
    body: JSON.stringify({ workspace, text: 'API 写的日志。' }),
  });
  assert.equal(w.status, 200);
  const r = await callRoute(route, { url: '/memory/api/journal' });
  assert.ok(Array.isArray(r.body.dates));
  assert.match(r.body.recent[0].text, /API 写的日志。/);
  const bad = await callRoute(route, {
    method: 'POST',
    url: '/memory/api/journal',
    body: JSON.stringify({ workspace, text: '' }),
  });
  assert.equal(bad.status, 400);
  const badDate = await callRoute(route, { url: '/memory/api/journal?date=20x5-13-99' });
  assert.equal(badDate.status, 400);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
