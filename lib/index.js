/**
 * dsh-memory —— 宿主半。
 *
 * 职责：
 *  1. 按工作区落库的长期记忆（lib/store.js，纯文件，无 DSH 依赖）；
 *  2. 给模型一个 `memory` 工具（save / search / list / get / update / forget / stats）；
 *  3. 会话开始时把该工作区的高优先级记忆注入系统提示（条数与字数受设置控制）；
 *  4. 轮次结束时的可选自动提炼（用宿主 LLM 把有长期价值的事实归纳成记忆）；
 *  5. 给设置面板提供 HTTP API（lib/api.js），前缀 /memory/api。
 *
 * 客户端半在 lib/client.js，由「客户端模块宿主」按包名自动提供。
 */

import fs from 'node:fs';
import path from 'node:path';

import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BlockAssembler } from '@deepseek-ai/dsh-llm';

import {
  CATEGORIES,
  CATEGORY_LABELS,
  GLOBAL_KEY,
  createMemoryStore,
  defaultRoot,
  normalizeRoot,
  workspaceKey,
} from './store.js';
import { API_PREFIX, createApi } from './api.js';
import {
  DISTILL_SYSTEM,
  buildDistillInput,
  parseDistillResponse,
  selectTranscript,
  shouldDistill,
} from './distill.js';

/** Cordis 插件名。 */
const name = 'dsh-memory';

/** 依赖的宿主服务：没有 tools 就没有这个插件。 */
const inject = ['tools'];

/** 插件版本，与 package.json 保持同步（面板上展示）。 */
const VERSION = '0.1.0';

/** 设置面板注入系统提示的段落顺序：夹在 PLAN_POLICY(500) 与 TEAM_POLICY(600) 之间。 */
const DEFAULT_SECTION_ORDER = 550;

/** 捕获日志环形缓冲长度。 */
const CAPTURE_LOG_LIMIT = 30;

/** 提示词注入的备忘缓存有效期（毫秒），避免每个 step 都重排一次。 */
const BRIEFING_TTL_MS = 1500;

const Config = z.object({
  /** 总开关：关掉后不注入提示、不自动提炼、工具报错。 */
  enabled: z.boolean().default(true),
  /** 数据目录，留空用 ~/.dsh/storages/dsh-memory。 */
  directory: z.string().default(''),
  /** 是否在工作区生成 .dsh-memory/MEMORY.md 人类可读镜像。 */
  mirror: z.boolean().default(true),
  /** 是否在会话开始时把记忆摘要注入系统提示。 */
  briefing: z.boolean().default(true),
  /** 注入的最大条数。 */
  briefingLimit: z.natural().min(1).max(50).default(12),
  /** 注入的最大字符数。 */
  briefingMaxChars: z.natural().min(200).max(20000).default(2000),
  /** 轮次结束自动提炼开关。 */
  autoCapture: z.boolean().default(false),
  /** 一轮对话至少多少字符才值得提炼。 */
  autoCaptureMinChars: z.natural().min(0).max(200000).default(600),
  /** 两次自动提炼之间的最小间隔（毫秒）。 */
  captureCooldownMs: z.natural().min(0).max(3600000).default(60000),
  /** 提炼结果的最低置信度。 */
  minConfidence: z.number().min(0).max(1).default(0.4),
  /** 每次提炼最多落库条数。 */
  maxPerTurn: z.natural().min(1).max(20).default(5),
  /** 送给模型的对话摘录字符上限。 */
  maxTranscriptChars: z.natural().min(500).max(60000).default(6000),
  /** 落库时对高度相似的既有记忆做合并。 */
  dedupe: z.boolean().default(true),
  /** 系统提示段落顺序。 */
  sectionOrder: z.number().default(DEFAULT_SECTION_ORDER),
});

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function clamp(text, max) {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** 只保留 defaults 里声明过的键，并按默认值的类型做一次温和转换。 */
function coerceSettings(defaults, patch) {
  const next = {};
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
    const fallback = defaults[key];
    const raw = patch[key];
    if (typeof fallback === 'boolean') next[key] = Boolean(raw);
    else if (typeof fallback === 'number') {
      const num = Number(raw);
      if (Number.isFinite(num)) next[key] = num;
    } else next[key] = String(raw);
  }
  return next;
}

/**
 * 可运行时修改并落盘的插件设置（设置面板与 cordis config 的共同产物）。
 * cordis config 是初始值，用户在面板上的修改写入 <dir>/settings.json。
 */
function createSettings({ dir, defaults }) {
  const file = path.join(dir, 'settings.json');
  const stored = readJson(file, {});
  let state = { ...defaults, ...coerceSettings(defaults, stored && typeof stored === 'object' ? stored : {}) };

  return {
    file,
    get() {
      return { ...state };
    },
    set(patch = {}) {
      const clean = coerceSettings(defaults, patch && typeof patch === 'object' ? patch : {});
      if (Object.keys(clean).length > 0) {
        state = { ...state, ...clean };
        writeJson(file, state);
      }
      return { ...state };
    },
  };
}

/* ------------------------------------------------------------------ *
 * 插件
 * ------------------------------------------------------------------ */

/**
 * @param ctx — cordis 上下文（已注入 tools）。
 * @param config — 经 schemastery 校验后的 Config。
 */
function apply(ctx, config) {
  const defaults = { ...Config(config ?? {}) };
  const dir = defaults.directory ? path.resolve(defaults.directory) : defaultRoot();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    ctx.logger?.warn?.(`dsh-memory: 无法创建数据目录 ${dir}: ${error?.message || error}`);
  }

  const settings = createSettings({ dir, defaults });
  const store = createMemoryStore({
    dir,
    // 允许面板实时开关镜像，而不用重建 store。
    mirror: () => settings.get().mirror,
  });

  /* ---------------- 工作区跟踪 ---------------- */

  /** sessionId -> { root, at }，只保留最近 60 个会话。 */
  const sessionRoots = new Map();
  /** 最近一次产生事件的会话，用作「手动提炼」的目标。 */
  let lastSession = null;

  function noteSession(session) {
    if (!session) return;
    const cwd = session.header?.cwd;
    if (typeof cwd !== 'string' || !cwd.trim()) return;
    sessionRoots.set(String(session.id), { root: normalizeRoot(cwd), at: Date.now() });
    if (sessionRoots.size > 60) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [key, rec] of sessionRoots) {
        if (rec.at < oldestAt) {
          oldestAt = rec.at;
          oldestKey = key;
        }
      }
      if (oldestKey) sessionRoots.delete(oldestKey);
    }
  }

  function activeWorkspace() {
    let best = '';
    let bestAt = -1;
    for (const rec of sessionRoots.values()) {
      if (rec.at > bestAt) {
        bestAt = rec.at;
        best = rec.root;
      }
    }
    return best;
  }

  /**
   * 面板的工作区切换器数据：活跃会话的工作区 + 历史上落过库的工作区。
   */
  function listWorkspaces() {
    const active = activeWorkspace();
    const activeKey = active ? workspaceKey(active) : '';
    const byKey = new Map();

    for (const rec of sessionRoots.values()) {
      const key = workspaceKey(rec.root);
      const prev = byKey.get(key);
      if (!prev || rec.at > prev.at) byKey.set(key, { root: rec.root, at: rec.at, live: true });
    }

    for (const info of store.workspaces()) {
      const key = info.key || workspaceKey(info.root || '');
      if (byKey.has(key)) continue;
      byKey.set(key, {
        root: info.root || '',
        at: Date.parse(info.updatedAt) || 0,
        live: false,
      });
    }

    const rows = [];
    for (const [key, rec] of byKey) {
      const info = store.workspaceInfo(rec.root);
      const stats = store.stats({ workspace: rec.root });
      rows.push({
        key,
        root: rec.root,
        slug: info.slug,
        folder: info.folder,
        live: Boolean(rec.live),
        active: key === activeKey,
        count: stats.total,
        pinned: stats.pinned,
        global: stats.global,
        updatedAt: stats.updatedAt || (rec.at ? new Date(rec.at).toISOString() : ''),
      });
    }

    rows.sort(
      (a, b) =>
        (b.active ? 1 : 0) - (a.active ? 1 : 0) ||
        (b.live ? 1 : 0) - (a.live ? 1 : 0) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
    return rows;
  }

  /* ---------------- 提示词注入 ---------------- */

  let briefingMemo = { key: '', at: 0, text: '' };

  /** 把工作区记忆渲染成注入系统提示的 markdown 摘要；无内容时返回空串。 */
  function briefingText(workspace) {
    const cfg = settings.get();
    if (!cfg.enabled || !cfg.briefing || !workspace) return '';

    const stats = store.stats({ workspace });
    if (stats.total === 0 && stats.global === 0) return '';

    // 记录集变了（条数或更新时间变化）才重新排序渲染。
    const key = `${workspace}|${cfg.briefingLimit}|${cfg.briefingMaxChars}|${stats.total}|${stats.updatedAt}|${stats.global}`;
    const stamp = Date.now();
    if (briefingMemo.key === key && stamp - briefingMemo.at < BRIEFING_TTL_MS) return briefingMemo.text;

    const records = store.briefing({
      workspace,
      limit: cfg.briefingLimit,
      maxChars: cfg.briefingMaxChars,
    });

    const lines = [];
    lines.push('## 工作区长期记忆（dsh-memory）');
    lines.push('');
    lines.push(
      `工作区：\`${workspace}\` ｜ 本工作区 ${stats.total} 条（置顶 ${stats.pinned}）｜ 全局 ${stats.global} 条`,
    );
    lines.push('');
    for (const record of records) {
      const label = CATEGORY_LABELS[record.category] || record.category;
      const pin = record.pinned ? '📌 ' : '';
      lines.push(`- ${pin}[${label}] ${clamp(record.title, 120)} — ${clamp(record.content, 260)} (\`${record.id}\`)`);
    }
    lines.push('');
    lines.push(
      '需要更多细节时调用 `memory` 工具：`action=search` 按关键词检索全文，`action=get` 取单条全文，' +
        '`action=save` 保存新发现且值得长期保留的事实。',
    );

    const text = lines.join('\n');
    briefingMemo = { key, at: stamp, text };
    return text;
  }

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: 'dsh-memory:workspace-briefing',
          order: settings.get().sectionOrder,
          text: (context) => {
            const cwd = context?.agent?.session?.header?.cwd;
            return briefingText(typeof cwd === 'string' ? normalizeRoot(cwd) : '');
          },
        }),
      'dsh-memory: prompt section',
    );
  });

  /* ---------------- LLM 提炼 ---------------- */

  const captureLog = [];
  let capturing = false;
  let lastCaptureAt = 0;

  function pushCapture(entry) {
    captureLog.unshift({ at: new Date().toISOString(), ...entry });
    if (captureLog.length > CAPTURE_LOG_LIMIT) captureLog.length = CAPTURE_LOG_LIMIT;
  }

  /** 解析一次辅助调用要用的 provider/model 路由。 */
  function resolveRoute(session) {
    const header = session?.requestHeader?.();
    const fromHeader = header?.config;
    if (fromHeader && fromHeader.provider && fromHeader.model) {
      return { provider: String(fromHeader.provider), model: String(fromHeader.model) };
    }
    return { provider: '', model: '' };
  }

  /**
   * 用宿主 LLM 做一次「system + 单条 user」的辅助调用，返回纯文本。
   * 路由取当前会话的请求头，跟随用户选的模型。
   */
  async function callLlm({ session, system, userText, maxTokens = 1500, signal }) {
    const llm = ctx.get('llm');
    if (!llm || typeof llm.stream !== 'function') throw new Error('llm 服务不可用');
    const route = resolveRoute(session);
    if (!route.provider || !route.model) throw new Error('当前会话没有可用的 provider/model 路由');

    const assembler = new BlockAssembler();
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens,
      ...(session?.id ? { sessionId: session.id } : {}),
      ...(signal ? { signal } : {}),
    });
    for await (const chunk of stream) assembler.push(chunk);
    const blocks = assembler.blocks();
    return blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  }

  /**
   * 对一段对话做提炼。`force` 为真时忽略开关与冷却（面板上的手动按钮）。
   * @returns {Promise<{ok:boolean, reason?:string, saved?:number, candidates?:number, titles?:string[]}>}
   */
  async function runCapture({ force = false, workspace = '', session = null, text = '' } = {}) {
    const cfg = settings.get();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    if (!force && !cfg.autoCapture) return { ok: false, reason: 'auto_off' };
    if (capturing) return { ok: false, reason: 'busy' };

    const target = session || lastSession;
    const targetRoot = normalizeRoot(workspace || target?.header?.cwd || activeWorkspace() || '');
    if (!targetRoot) return { ok: false, reason: 'no_workspace' };

    const messages = typeof target?.deriveMessages === 'function' ? target.deriveMessages() : [];
    if (!force) {
      const gate = shouldDistill(messages, { minChars: cfg.autoCaptureMinChars });
      if (!gate.distill) {
        pushCapture({ workspace: targetRoot, reason: 'too_short', saved: 0, candidates: 0, total: gate.total });
        return { ok: false, reason: 'too_short' };
      }
    }

    const transcript = text
      ? text.slice(0, cfg.maxTranscriptChars)
      : selectTranscript(messages, { maxChars: cfg.maxTranscriptChars });
    if (!transcript || transcript === '[]') {
      pushCapture({ workspace: targetRoot, reason: 'empty_transcript', saved: 0, candidates: 0 });
      return { ok: false, reason: 'empty_transcript' };
    }

    capturing = true;
    try {
      const existing = store
        .list({ workspace: targetRoot, limit: 60 })
        .records.map((record) => record.title);
      const reply = await callLlm({
        session: target,
        system: DISTILL_SYSTEM,
        userText: buildDistillInput({ workspace: targetRoot, transcript, existingTitles: existing }),
      });
      const candidates = parseDistillResponse(reply, {
        minConfidence: cfg.minConfidence,
        max: cfg.maxPerTurn,
      });

      const savedIds = [];
      for (const candidate of candidates) {
        const result = store.upsert(
          { ...candidate, source: 'auto', sessionId: target?.id ?? null },
          { workspace: targetRoot, dedupe: cfg.dedupe },
        );
        if (result?.record?.id) savedIds.push(result.record.id);
      }
      if (savedIds.length) store.markUsed(savedIds, { workspace: targetRoot });

      pushCapture({
        workspace: targetRoot,
        reason: 'captured',
        candidates: candidates.length,
        saved: savedIds.length,
        titles: candidates.map((candidate) => candidate.title),
        ids: savedIds,
      });
      return { ok: true, saved: savedIds.length, candidates: candidates.length, ids: savedIds };
    } catch (error) {
      const message = error?.message || String(error);
      pushCapture({ workspace: targetRoot, reason: 'error', error: message, saved: 0, candidates: 0 });
      return { ok: false, reason: 'error', error: message };
    } finally {
      capturing = false;
    }
  }

  /** 面板上的「提炼这段文本」：只返回候选，不落库。 */
  async function distillNow({ workspace = '', text = '' } = {}) {
    const targetRoot = normalizeRoot(workspace || activeWorkspace() || '');
    const existing = targetRoot ? store.list({ workspace: targetRoot, limit: 60 }).records.map((r) => r.title) : [];
    const reply = await callLlm({
      session: lastSession,
      system: DISTILL_SYSTEM,
      userText: buildDistillInput({
        workspace: targetRoot,
        transcript: text.slice(0, 6000),
        existingTitles: existing,
      }),
    });
    return parseDistillResponse(reply, {
      minConfidence: settings.get().minConfidence,
      max: settings.get().maxPerTurn,
    });
  }

  /** 面板上的「立即提炼当前会话」。 */
  async function captureNow({ force = true, workspace = '' } = {}) {
    return runCapture({ force, workspace, session: lastSession });
  }

  /* ---------------- 会话事件 ---------------- */

  ctx.on('session/created', (session) => {
    noteSession(session);
    // 会话刚建好、还没产生任何事件时，面板上的「提炼当前会话」也该有目标。
    if (session) lastSession = session;
  });

  ctx.on('session/event', (session, event) => {
    noteSession(session);
    lastSession = session;
    if (event?.type !== 'turn/end') return;

    const cfg = settings.get();
    if (!cfg.enabled || !cfg.autoCapture || capturing) return;
    if (Date.now() - lastCaptureAt < cfg.captureCooldownMs) return;
    const cwd = session?.header?.cwd;
    if (typeof cwd !== 'string' || !cwd.trim()) return;

    lastCaptureAt = Date.now();
    // 不阻塞轮次收尾：提炼在后台跑，失败只记日志。
    void runCapture({ workspace: normalizeRoot(cwd), session }).catch((error) => {
      ctx.logger?.warn?.(`dsh-memory: 自动提炼失败: ${error?.message || error}`);
    });
  });

  // 启动时把已有会话的工作区拉一遍，让面板在第一次打开前就有数据。
  ctx.inject(['sessions'], (sessionCtx) => {
    try {
      const list = sessionCtx.sessions?.list?.();
      if (Array.isArray(list)) for (const session of list) noteSession(session);
    } catch {
      /* sessions 服务形态不同就忽略，事件路径仍然工作 */
    }
  });

  /* ---------------- HTTP API（设置面板） ---------------- */

  const api = createApi({
    store,
    settings,
    activeWorkspace,
    listWorkspaces,
    captures: () => captureLog.slice(0, 12),
    version: VERSION,
    distillNow,
    captureNow,
  });

  /** 本机回环 + 可信 Host 才放行；服务本身不带鉴权，这层是必须的。 */
  function trustedHosts() {
    try {
      const runtime = ctx.get('webRuntime');
      const list = runtime?.trustedHosts;
      if (Array.isArray(list)) return list.map(String);
      if (list && typeof list[Symbol.iterator] === 'function') return [...list].map(String);
    } catch {
      /* webRuntime 不存在时回落到回环白名单 */
    }
    return ['127.0.0.1', 'localhost', '::1'];
  }

  function isTrusted(req) {
    const address = String(req?.socket?.remoteAddress || '');
    const loopback =
      address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');
    const hosts = trustedHosts();
    if (!loopback) {
      const host = String(req?.headers?.host || '').split(':')[0];
      if (!host || !hosts.includes(host)) return false;
    }
    // 有 Origin 时必须是同源/回环，挡掉浏览器里的跨站请求。
    const origin = req?.headers?.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).hostname;
        if (!['127.0.0.1', 'localhost', '::1'].includes(originHost) && !hosts.includes(originHost)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function send(res, status, body) {
    const text = JSON.stringify(body ?? { ok: false, error: 'empty' });
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(text);
  }

  function readBody(req, limit = 4 * 1024 * 1024) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }

  async function route(req, res) {
    if (!isTrusted(req)) {
      send(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) {
      send(res, 404, { ok: false, error: 'unknown_route' });
      return;
    }

    const method = String(req.method || 'GET').toUpperCase();
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = await readBody(req);
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
      }
    }

    const result = await api.handle({
      method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    });
    send(res, result.status, result.body);
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: route }),
      'dsh-memory: settings api',
    );
  });

  /* ---------------- 模型工具 ---------------- */

  const memoryTool = defineTool({
    name: 'memory',
    description: [
      'Read and write the long-term memory for the current workspace.',
      'Memories persist across sessions and are keyed by the workspace directory, so they are the right place for',
      'durable facts: user preferences, project conventions, architecture decisions, environment gotchas,',
      'and "we already tried X and it failed because Y" lessons.',
      'Do NOT store transient state (current task progress, file contents you just read, tool output).',
      'Actions: save (create or update one memory), search (keyword retrieval over titles/content/tags),',
      'list (browse with filters), get (full record by id), update (patch flags/category/text),',
      'forget (delete one), stats (counts per category).',
      'Call `search` before saving when the fact may already be recorded, to keep the memory deduplicated.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['save', 'search', 'list', 'get', 'update', 'forget', 'stats'],
        description: 'What to do.',
      },
      title: {
        type: 'string',
        description: 'save/update: one-line headline of the memory (<=160 chars). Required for save.',
      },
      content: {
        type: 'string',
        description: 'save/update: the fact itself, with the reasoning or evidence that makes it useful.',
      },
      category: {
        type: 'string',
        enum: [...CATEGORIES],
        description: `save/update: ${CATEGORIES.map((id) => `${id}=${CATEGORY_LABELS[id]}`).join(', ')}.`,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'save/update: free-form tags for retrieval.',
      },
      scope: {
        type: 'string',
        enum: ['workspace', 'global'],
        description: 'save/update: workspace (default, keyed to this directory) or global (every workspace).',
      },
      id: { type: 'string', description: 'get/update/forget: exact memory id.' },
      query: { type: 'string', description: 'search: keywords. Empty returns the most recent memories.' },
      limit: { type: 'integer', description: 'search/list: max rows (1-50, default 10).' },
      tag: { type: 'string', description: 'list: only memories carrying this tag.' },
      pinned: { type: 'boolean', description: 'update: pin to the top of the injected briefing.' },
      archived: { type: 'boolean', description: 'list/update: include or set the archived flag.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          text: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const cfg = settings.get();
      if (!cfg.enabled) return { action: 'stats', count: 0, text: 'dsh-memory 已在设置中关闭。' };

      const session = exec?.agent?.session;
      if (session) lastSession = session;
      const workspace = normalizeRoot(session?.header?.cwd || activeWorkspace() || '');
      if (!workspace) {
        return { action: args.action, count: 0, text: '当前会话没有工作区目录，无法使用工作区记忆。' };
      }
      const action = String(args.action || '').toLowerCase();
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));

      const row = (record) => {
        const label = CATEGORY_LABELS[record.category] || record.category;
        const flags = [record.pinned ? '置顶' : '', record.archived ? '已归档' : '', record.scope === 'global' ? '全局' : '']
          .filter(Boolean)
          .join('/');
        const tags = (record.tags || []).length ? ` #${record.tags.join(' #')}` : '';
        return `- [${label}${flags ? ` ${flags}` : ''}] ${record.title}${tags}\n  ${clamp(record.content, 400)}\n  id=\`${record.id}\``;
      };

      if (action === 'save') {
        const title = String(args.title ?? '').trim();
        const content = String(args.content ?? '').trim();
        if (!title && !content) return { action, count: 0, text: 'save 需要 title 或 content。' };

        const probe = `${title} ${content}`;
        const similar = store.search({ workspace, query: probe, limit: 3 });
        const result = store.upsert(
          {
            title: title || clamp(content, 160),
            content: content || title,
            category: CATEGORIES.includes(args.category) ? args.category : 'decision',
            tags: Array.isArray(args.tags) ? args.tags : [],
            scope: args.scope === 'global' ? 'global' : 'workspace',
            source: 'agent',
            sessionId: session?.id ?? null,
            files: [],
          },
          { workspace, dedupe: cfg.dedupe },
        );
        briefingMemo = { key: '', at: 0, text: '' };

        const related = similar.filter((r) => r.id !== result.record.id).slice(0, 3);
        const lines = [
          result.mergedInto
            ? `已合并进高度相似的既有记忆 \`${result.record.id}\`：${result.record.title}`
            : `已保存记忆 \`${result.record.id}\`：${result.record.title}`,
        ];
        if (related.length) {
          lines.push('', '可能相关的既有记忆（如有重复可用 action=update 或 action=forget 处理）：');
          for (const rel of related) lines.push(`- ${rel.title} (id=\`${rel.id}\`)`);
        }
        return { action, count: 1, text: lines.join('\n') };
      }

      if (action === 'search') {
        const query = String(args.query ?? '').trim();
        const found = query
          ? store.search({ workspace, query, limit })
          : store.list({ workspace, limit }).records;
        store.markUsed(found.map((r) => r.id), { workspace });
        if (!found.length) {
          return {
            action,
            count: 0,
            text: query
              ? `本工作区没有匹配「${query}」的记忆。可用 action=list 浏览，或 action=save 记录新事实。`
              : '本工作区还没有任何记忆。',
          };
        }
        return {
          action,
          count: found.length,
          text: [`本工作区命中 ${found.length} 条：`, ...found.map(row)].join('\n'),
        };
      }

      if (action === 'list') {
        const result = store.list({
          workspace,
          category: CATEGORIES.includes(args.category) ? args.category : '',
          tag: String(args.tag ?? ''),
          archived: Boolean(args.archived),
          limit,
        });
        const stats = store.stats({ workspace });
        if (!result.records.length) {
          return {
            action,
            count: 0,
            text: `本工作区还没有记忆（共 ${stats.total} 条）。用 action=save 记录第一条。`,
          };
        }
        return {
          action,
          count: result.records.length,
          text: [
            `本工作区 ${stats.total} 条（置顶 ${stats.pinned}），本次显示 ${result.records.length}/${result.total}：`,
            ...result.records.map(row),
          ].join('\n'),
        };
      }

      if (action === 'get') {
        const id = String(args.id ?? '').trim();
        const record = id ? store.get(id, { workspace }) : null;
        if (!record) return { action, count: 0, text: `找不到记忆 ${id || '(缺少 id)'}。` };
        store.markUsed([record.id], { workspace });
        return {
          action,
          count: 1,
          text: [
            `# ${record.title}`,
            `id=\`${record.id}\` ｜ 类别 ${CATEGORY_LABELS[record.category] || record.category} ｜ 范围 ${record.scope} ｜ 来源 ${record.source}`,
            `标签 ${(record.tags || []).join(', ') || '(无)'} ｜ 置顶 ${record.pinned ? '是' : '否'} ｜ 归档 ${record.archived ? '是' : '否'}`,
            `创建 ${record.createdAt} ｜ 更新 ${record.updatedAt} ｜ 引用 ${record.useCount}`,
            '',
            record.content,
          ].join('\n'),
        };
      }

      if (action === 'update') {
        const id = String(args.id ?? '').trim();
        if (!id) return { action, count: 0, text: 'update 需要 id。' };
        const patch = {};
        for (const key of ['title', 'content', 'category', 'tags', 'scope', 'pinned', 'archived']) {
          if (args[key] !== undefined) patch[key] = args[key];
        }
        if (Object.keys(patch).length === 0) {
          return { action, count: 0, text: 'update 没有给出任何要改的字段。' };
        }
        const result = store.update(id, patch, { workspace });
        if (!result?.ok) return { action, count: 0, text: `找不到记忆 ${id}。` };
        briefingMemo = { key: '', at: 0, text: '' };
        return { action, count: 1, text: `已更新 \`${id}\`：${result.record.title}` };
      }

      if (action === 'forget') {
        const id = String(args.id ?? '').trim();
        if (!id) return { action, count: 0, text: 'forget 需要 id。' };
        const result = store.remove(id, { workspace });
        if (!result?.ok) return { action, count: 0, text: `找不到记忆 ${id}。` };
        briefingMemo = { key: '', at: 0, text: '' };
        return { action, count: 1, text: `已删除记忆 \`${id}\`（${result.removed?.title ?? ''}）。` };
      }

      // stats
      const stats = store.stats({ workspace });
      const byCategory = Object.entries(stats.byCategory || {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => `${CATEGORY_LABELS[id] || id} ${count}`)
        .join(' ｜ ');
      return {
        action: 'stats',
        count: stats.total,
        text: [
          `工作区 \`${workspace}\``,
          `本工作区 ${stats.total} 条 ｜ 置顶 ${stats.pinned} ｜ 归档 ${stats.archived} ｜ 全局 ${stats.global}`,
          byCategory ? `分类：${byCategory}` : '还没有分类数据',
          `数据目录：\`${store.dir}\` ｜ 镜像文件：\`${store.workspaceInfo(workspace).dataFile}\``,
          `最近更新：${stats.updatedAt || '(无)'}`,
        ].join('\n'),
      };
    },
  });

  ctx.effect(() => ctx.tools.register(memoryTool), 'dsh-memory: memory tool');

  ctx.logger?.info?.(`dsh-memory ready (dir=${dir})`);
}

export { API_PREFIX, Config, GLOBAL_KEY, apply, inject, name };
export default { Config, apply, inject, name, VERSION, API_PREFIX, GLOBAL_KEY };
