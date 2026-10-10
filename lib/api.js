/**
 * dsh-memory — HTTP API（设置面板与自动化调用共用的唯一读写入口）。
 *
 * 与传输层解耦：本模块只接收已解析的 `{ method, pathname, query, body }`，
 * 返回 `{ status, body }`。因此可以脱离 node:http 直接测试
 * （见 test/api.test.mjs），宿主侧只负责把 req/res 适配进来。
 */

import { CATEGORIES, CATEGORY_LABELS, GLOBAL_KEY, workspaceKey, normalizeRoot } from './store.js';
import {
  IMPORT_FORMATS,
  FORMAT_LABELS,
  parseMemoryFile,
  parseMemoryText,
  scanMemorySources,
} from './markdown.js';

const API_PREFIX = '/memory/api';

/** 允许的排序键。 */
const SORTS = ['updated', 'created', 'title'];

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
}

function int(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asStringArray(value, limit = 500) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, limit);
}

/** 统一响应外壳。 */
function ok(body) {
  return { status: 200, body: { ok: true, ...body } };
}

function fail(status, error, detail) {
  return { status, body: { ok: false, error, ...(detail ? { detail } : {}) } };
}

/**
 * 构造 API 处理器。
 *
 * @param deps.store             — createMemoryStore() 的返回值
 * @param deps.settings          — { get(): object, set(patch): object }
 * @param deps.activeWorkspace   — () => string，当前活动工作区路径
 * @param deps.listWorkspaces    — () => [{key, root, slug, active, sessionId, live}]
 * @param deps.captures          — () => 最近自动提炼日志
 * @param deps.version           — 插件版本号
 * @param deps.distillNow        — 可选 async ({workspace, text, title}) => 候选数组（设置页手动提炼）
 * @param deps.captureNow        — 可选 () => void，立即对当前会话触发一次提炼
 */
export function createApi(deps) {
  const {
    store,
    settings,
    activeWorkspace = () => '',
    listWorkspaces = () => [],
    captures = () => [],
    version = '0.0.0',
    distillNow,
    captureNow,
  } = deps;

  /** 解析目标工作区：显式传入 > _global > 当前活动工作区。 */
  function resolveWorkspace(query = {}, body = {}) {
    const explicit = body.workspace ?? query.workspace;
    if (typeof explicit === 'string' && explicit.trim()) return normalizeRoot(explicit);
    return normalizeRoot(activeWorkspace() || '');
  }

  function stateFor(workspace) {
    return {
      version,
      api: API_PREFIX,
      workspace: { root: workspace, key: workspaceKey(workspace), ...store.workspaceInfo(workspace) },
      stats: store.stats({ workspace }),
      settings: settings.get(),
      categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
      workspaces: listWorkspaces(),
      tags: store.tags({ workspace }).slice(0, 40),
      captures: captures(),
      mirror: store.mirrorInfo(workspace),
      globalFolder: GLOBAL_KEY,
    };
  }

  const routes = {
    /** 页面首屏：版本、当前工作区、统计、设置、类别、工作区列表、标签、最近提炼。 */
    'GET /state'({ query }) {
      return ok(stateFor(resolveWorkspace(query)));
    },

    /** 记忆列表（支持查询/过滤/分页）。 */
    'GET /list'({ query }) {
      const workspace = resolveWorkspace(query);
      const result = store.list({
        workspace,
        query: String(query.q ?? query.query ?? ''),
        category: CATEGORIES.includes(query.category) ? query.category : '',
        scope: query.scope === 'global' || query.scope === 'workspace' ? query.scope : '',
        tag: String(query.tag ?? ''),
        includeGlobal: bool(query.global, true),
        includeArchived: bool(query.archived, false),
        sort: SORTS.includes(query.sort) ? query.sort : 'updated',
        limit: int(query.limit, 200, 1, 1000),
        offset: int(query.offset, 0, 0, 1e6),
      });
      return ok({ workspace: { root: workspace, key: workspaceKey(workspace) }, ...result });
    },

    /** 新建或更新一条记忆。带 id 即更新。 */
    'POST /save'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const input = {
        id: body.id,
        title: body.title,
        content: body.content,
        category: body.category,
        tags: body.tags,
        scope: body.scope === 'global' ? 'global' : 'workspace',
        files: body.files,
        sessionId: body.sessionId,
        confidence: body.confidence,
      };
      if (input.id === undefined) input.source = body.source === 'auto' ? 'auto' : 'manual';
      if (body.pinned !== undefined) input.pinned = Boolean(body.pinned);
      if (body.archived !== undefined) input.archived = Boolean(body.archived);

      const hasContent = String(input.title ?? '').trim() || String(input.content ?? '').trim();
      if (!hasContent) return fail(400, 'empty_memory');

      const result = store.upsert(input, { workspace, dedupe: bool(body.dedupe, false) });
      return ok({ record: result.record, mergedInto: Boolean(result.mergedInto) });
    },

    /** 局部更新（置顶、归档、改类别、改正文）。 */
    'POST /update'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const id = String(body.id ?? '').trim();
      if (!id) return fail(400, 'missing_id');

      const patch = {};
      for (const key of ['title', 'content', 'category', 'tags', 'files', 'scope', 'pinned', 'archived', 'confidence']) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (patch.category !== undefined && !CATEGORIES.includes(patch.category)) patch.category = 'note';
      if (patch.scope !== undefined) patch.scope = patch.scope === 'global' ? 'global' : 'workspace';

      const result = store.update(id, patch, { workspace });
      if (!result.ok) return fail(404, 'not_found');
      return ok({ record: result.record });
    },

    /** 批量操作：delete | archive | unarchive | pin | unpin。 */
    'POST /bulk'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const action = String(body.action ?? '');
      const ids = asStringArray(body.ids);
      if (!['delete', 'archive', 'unarchive', 'pin', 'unpin'].includes(action)) return fail(400, 'bad_action');
      if (!ids.length) return fail(400, 'missing_ids');
      const result = store.bulk(action, ids, { workspace });
      return ok({ affected: result.affected, stats: store.stats({ workspace }) });
    },

    /** 删除单条（面板上的一次点击，语义更直白）。 */
    'POST /delete'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const id = String(body.id ?? '').trim();
      if (!id) return fail(400, 'missing_id');
      const result = store.remove(id, { workspace });
      if (!result.ok) return fail(404, 'not_found');
      return ok({ removed: result.removed.id, stats: store.stats({ workspace }) });
    },

    /** 读写插件设置。 */
    'POST /settings'({ query, body }) {
      const patch = body.settings ?? body;
      const before = settings.get();
      const next = settings.set(patch && typeof patch === 'object' ? patch : {});
      const workspace = resolveWorkspace(query, body);
      // 关掉工作区镜像就把文件收掉，别在仓库里留下过期的 MEMORY.md。
      if (before.mirror && !next.mirror) store.removeWorkspaceMirror(workspace);
      return ok({ settings: next, mirror: store.mirrorInfo(workspace) });
    },

    /** 导出全部记忆（备份）。 */
    'GET /export'({ query }) {
      const workspace = resolveWorkspace(query);
      return ok({ export: store.export({ workspace }) });
    },

    /** 从导出载荷、纯文本或本机既有记忆文件导入。 */
    'POST /import'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const mode = body.mode === 'replace' ? 'replace' : 'merge';

      // 1) 备份载荷原样回灌。
      if (body.records || body.export) {
        const result = store.import(body.export ?? body, { workspace, mode });
        return ok({ imported: result, stats: store.stats({ workspace }) });
      }

      // 2) 指定了文件路径：按文件解析。
      const paths = asStringArray(body.paths ?? body.path, 50);
      if (paths.length) {
        const records = [];
        const files = [];
        for (const file of paths) {
          try {
            const parsed = parseMemoryFile(file, { format: body.format });
            files.push({ path: file, format: parsed.format, records: parsed.records.length });
            for (const record of parsed.records) records.push({ ...record, scope: body.scope === 'global' ? 'global' : 'workspace' });
          } catch (error) {
            files.push({ path: file, records: 0, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (!records.length) return fail(400, 'empty_payload', { files });
        const result = store.import({ records }, { workspace, mode });
        return ok({ imported: result, files, stats: store.stats({ workspace }) });
      }

      // 3) 自由文本：按空行分段（text）或按竞品记忆格式切条。
      const text = String(body.text ?? '').trim();
      if (!text) return fail(400, 'empty_payload');
      const format = IMPORT_FORMATS.includes(body.format) ? body.format : 'auto';
      let records;
      let detected = format;
      if (format === 'text') {
        records = text
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block) => {
            const [first, ...rest] = block.split('\n');
            const clean = first.replace(/^[-*#\s]+/, '').trim();
            return rest.length
              ? { title: clean.slice(0, 160), content: block, category: 'note', source: 'import' }
              : { title: clean.slice(0, 160), content: clean, category: 'note', source: 'import' };
          });
      } else {
        const parsed = parseMemoryText(text, { format });
        records = parsed.records;
        detected = parsed.format;
      }
      if (!records.length) return fail(400, 'empty_payload');
      const result = store.import({ records }, { workspace, mode });
      return ok({
        imported: result,
        detectedFormat: detected,
        formatLabel: FORMAT_LABELS[detected] ?? detected,
        stats: store.stats({ workspace }),
      });
    },

    /** 扫描本机既有的竞品记忆（Qoder / WorkBuddy / 本插件镜像），只读。 */
    'GET /import-scan'({ query }) {
      const workspace = resolveWorkspace(query);
      return ok({
        scan: scanMemorySources({ workspace }),
        formats: FORMAT_LABELS,
      });
    },

    /** 把扫描到的来源导入：`{ sources: ['user-qoder', …] }` 或 `{ paths: [...] }`。 */
    'POST /import-scan'({ body }) {
      const workspace = resolveWorkspace({}, body);
      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      const wanted = new Set(asStringArray(body.sources, 20));
      const scan = scanMemorySources({ workspace });
      const targets = [];
      for (const source of scan.sources) {
        if (wanted.size && !wanted.has(source.id)) continue;
        for (const file of source.files) targets.push({ file, scope: source.scope, sourceId: source.id });
      }
      for (const path of asStringArray(body.paths, 50)) {
        targets.push({ file: { path, format: body.format ?? 'auto' }, scope: body.scope === 'global' ? 'global' : 'workspace', sourceId: 'manual' });
      }
      if (!targets.length) return fail(400, 'nothing_selected', { sources: scan.sources.map((s) => s.id) });

      const records = [];
      const files = [];
      for (const { file, scope } of targets) {
        try {
          const parsed = parseMemoryFile(file.path, { format: file.format ?? 'auto' });
          for (const record of parsed.records) records.push({ ...record, scope });
          files.push({ path: file.path, format: parsed.format, records: parsed.records.length, scope });
        } catch (error) {
          files.push({ path: file.path, records: 0, scope, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!records.length) return fail(400, 'empty_payload', { files });
      const result = store.import({ records }, { workspace, mode });
      return ok({ imported: result, files, stats: store.stats({ workspace }) });
    },

    /** 打开记忆镜像文件所在目录的信息（面板上「在文件夹中查看」）。 */
    'GET /mirror'({ query }) {
      const workspace = resolveWorkspace(query);
      const info = store.workspaceInfo(workspace);
      return ok({
        mirror: { ...info, ...store.mirrorInfo(workspace), markdown: store.renderMarkdown(workspace) },
      });
    },

    /** 手动触发一次「对当前会话做自动提炼」。 */
    async 'POST /capture'(ctxArgs) {
      if (typeof captureNow !== 'function') return fail(501, 'capture_unavailable');
      const workspace = resolveWorkspace({}, ctxArgs.body);
      const result = await captureNow({ force: true, workspace });
      return ok({ capture: result, stats: store.stats({ workspace }) });
    },

    /** 手动提炼：把一段文本交给模型变成记忆候选（不落库，返回给面板预览）。 */
    async 'POST /distill'({ body }) {
      if (typeof distillNow !== 'function') return fail(501, 'distill_unavailable');
      const text = String(body.text ?? '').trim();
      if (!text) return fail(400, 'empty_text');
      const workspace = resolveWorkspace({}, body);
      const candidates = await distillNow({ workspace, text: text.slice(0, 20000) });
      return ok({ candidates });
    },

    /** 让面板能探测服务是否在线。 */
    'GET /ping'() {
      return ok({ version, at: new Date().toISOString() });
    },
  };

  /**
   * 处理一个已解析的请求。
   * @param args.method   — 大写 HTTP 方法
   * @param args.pathname — 完整 pathname（含 /memory/api 前缀）
   * @param args.query    — 已解析的查询串对象
   * @param args.body     — 已解析的 JSON body（可空）
   * @returns {status, body}
   */
  async function handle({ method = 'GET', pathname = '', query = {}, body = null } = {}) {
    let sub = pathname;
    if (sub.startsWith(API_PREFIX)) sub = sub.slice(API_PREFIX.length);
    if (!sub.startsWith('/')) sub = `/${sub}`;
    sub = sub.replace(/\/+$/, '') || '/';

    const verb = String(method || 'GET').toUpperCase();
    const key = `${verb} ${sub}`;
    const handler = routes[key];

    if (!handler) {
      const known = Object.keys(routes);
      return fail(404, 'unknown_route', { request: key, known });
    }

    try {
      return await handler({ query: query || {}, body: body && typeof body === 'object' ? body : {} });
    } catch (error) {
      return fail(500, 'handler_failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { handle, routes: Object.keys(routes), API_PREFIX, stateFor, resolveWorkspace };
}

export { API_PREFIX };
export default createApi;
