/**
 * dsh-memory — 持久化存储层。
 *
 * 纯 Node 实现（node:fs / node:path / node:crypto），不依赖任何 DSH 运行时 API，
 * 因此可以脱离 DSH 单独测试（见 test/store.test.mjs）。
 *
 * 磁盘布局（默认根目录 ~/.dsh/storages/dsh-memory）：
 *   index.json                          工作区索引
 *   workspaces/<slug>-<key8>/memories.json   该工作区的记忆记录
 *   workspaces/<slug>-<key8>/MEMORY.md       人类可读镜像（可选）
 *   workspaces/<slug>-<key8>/portrait.json   画像层（每工作区一份；_global 同构）
 *   workspaces/<slug>-<key8>/PORTRAIT.md     画像的人读正本（保存时同步刷）
 *   workspaces/<slug>-<key8>/portrait.history/v<N>.json  画像历史版本快照
 *   workspaces/_global/memories.json         跨工作区共享记忆
 *
 * 画像（portrait）：每工作区 / 全局各一份、由「重写式合并」滚动维护的叙事文档。
 * 条目层只存「不会过期」的知识；「现在是什么样」（版本现状、进度、待办）进画像。
 * 段落模型与渲染在 lib/portrait.js（纯函数），这里只管读写、版本快照与正本同步。
 *
 * 记录（record）字段：
 *   id, title, content, category, tags[], scope, source,
 *   sessionId, files[], createdAt, updatedAt, lastUsedAt, useCount,
 *   pinned, archived, confidence,
 *   keywords[]（检索加权词，提炼时顺带产出）,
 *   related[]（相关记忆 id，允许悬空）,
 *   supersedes / supersededBy（版本链：新条指旧条，旧条回指新条）,
 *   status（'active' | 'draft'，草稿不进简报/检索/镜像，等面板审批）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  PORTRAIT_HISTORY_LIMIT,
  normalizeSections,
  parsePortraitMarkdown,
  renderPortraitMarkdown,
} from './portrait.js';

export const SCHEMA_VERSION = 2;
export const GLOBAL_KEY = '_global';

export const CATEGORIES = [
  'fact',
  'preference',
  'decision',
  'convention',
  'component',
  'task',
  'note',
  'feedback',
  'user',
];

export const SOURCES = ['manual', 'agent', 'auto', 'import'];

/** 类别 -> 中文显示名（客户端也用它，避免两边不一致）。 */
export const CATEGORY_LABELS = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  convention: '约定',
  component: '组件',
  task: '待办',
  note: '笔记',
  feedback: '反馈',
  user: '用户',
};

const CATEGORY_SET = new Set(CATEGORIES);

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

export function defaultRoot() {
  return path.join(os.homedir(), '.dsh', 'storages', 'dsh-memory');
}

/** 统一路径：绝对化 + 去掉尾部分隔符 + Windows 上统一小写比较用。 */
export function normalizeRoot(root) {
  if (!root || typeof root !== 'string') return '';
  let p = path.resolve(root.trim());
  // Windows 下去掉盘符大小写差异
  if (process.platform === 'win32') p = p.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ':');
  while (p.length > 3 && (p.endsWith(path.sep) || p.endsWith('/'))) p = p.slice(0, -1);
  return p;
}

/**
 * 工作区标识：路径的稳定短哈希。
 * 归一化后（Windows 下小写、正斜杠）取 sha1 前 10 位，因此同一个工作区
 * 无论从哪个 shell / 哪种分隔符进入都能命中同一份记忆。
 */
export function workspaceKey(root) {
  const norm = normalizeRoot(root);
  if (!norm) return GLOBAL_KEY;
  const canon = process.platform === 'win32' ? norm.toLowerCase().replace(/\\/g, '/') : norm;
  return crypto.createHash('sha1').update(canon).digest('hex').slice(0, 10);
}

/** 目录友好名：取 basename，非法字符替换成 `-`。 */
export function slugify(root) {
  const norm = normalizeRoot(root);
  if (!norm) return 'global';
  const base = path.basename(norm) || norm.replace(/[:\\/]+/g, '-');
  const slug = base
    .replace(/[^0-9A-Za-z\u4e00-\u9fff._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  return slug || 'workspace';
}

export function folderName(root) {
  const key = workspaceKey(root);
  if (key === GLOBAL_KEY) return GLOBAL_KEY;
  return `${slugify(root)}-${key.slice(0, 8)}`;
}

function newId() {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `mem_${stamp}_${rand}`;
}

function now() {
  return new Date().toISOString();
}

/** 原子写：先写同目录临时文件再 rename，避免断电/崩溃产生半截 JSON。 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function fileStamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 工作区内那份人读镜像的路径：`<工作区>/.dsh-memory/MEMORY.md`。
 * 全局记忆（没有工作区）没有工作区镜像，返回 null。
 */
export function workspaceMirrorFile(workspace) {
  const root = normalizeRoot(workspace);
  if (!root) return null;
  return path.join(root, '.dsh-memory', 'MEMORY.md');
}

/* ------------------------------------------------------------------ *
 * 分词与相似度（中英文混合）
 * ------------------------------------------------------------------ */

const TOKEN_RE = /[a-z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;

/**
 * 英文按词、中文按「字 + 二元组」切分。
 * 二元组让「工作区」「记忆面板」这类中文查询能命中，而不必引入分词依赖。
 */
export function tokenize(text) {
  const out = [];
  const input = String(text == null ? '' : text).toLowerCase();
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(input)) !== null) {
    const t = m[0];
    if (/^[a-z0-9_]+$/.test(t)) {
      if (t.length > 1) out.push(t);
      continue;
    }
    for (let i = 0; i < t.length; i += 1) {
      out.push(t[i]);
      if (i + 1 < t.length) out.push(t.slice(i, i + 2));
    }
  }
  return out;
}

function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

/** Jaccard 相似度，用于自动捕获时的去重合并。 */
export function similarity(a, b) {
  const sa = new Set(uniqueTokens(a));
  const sb = new Set(uniqueTokens(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/* ------------------------------------------------------------------ *
 * 记录规整
 * ------------------------------------------------------------------ */

function asArray(value, limit = 64) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    const s = String(item == null ? '' : item).trim();
    if (s && !out.includes(s)) out.push(s.slice(0, 200));
    if (out.length >= limit) break;
  }
  return out;
}

function clampText(value, max) {
  const s = String(value == null ? '' : value).trim();
  return s.length > max ? `${value.slice(0, max - 1)}…` : s;
}

/**
 * 解析一条记录应落的范围。`user`（用户画像）类别强制 global——画像跟着人走，
 * 不属于任何一个工作区；显式传 scope='global' 照常生效。
 */
export function scopeFor(input = {}, existing = null) {
  if (input.scope === 'global') return 'global';
  const category = CATEGORY_SET.has(input.category) ? input.category : existing?.category;
  if (category === 'user') return 'global';
  if (input.scope === 'workspace') return 'workspace';
  return existing?.scope === 'global' ? 'global' : 'workspace';
}

export function normalizeRecord(input = {}, existing = null) {
  const created = existing?.createdAt || input.createdAt || now();
  const category = CATEGORY_SET.has(input.category)
    ? input.category
    : existing?.category || 'note';
  const source = SOURCES.includes(input.source) ? input.source : existing?.source || 'manual';

  const title =
    clampText(input.title ?? existing?.title, 160) ||
    clampText(input.content ?? existing?.content, 60) ||
    '未命名记忆';

  return {
    id: existing?.id || input.id || newId(),
    title,
    content: clampText(input.content ?? existing?.content ?? '', 8000),
    category,
    tags: asArray(input.tags ?? existing?.tags),
    scope: scopeFor(input, existing),
    source,
    sessionId: input.sessionId ?? existing?.sessionId ?? null,
    files: asArray(input.files ?? existing?.files, 32),
    keywords: asArray(input.keywords ?? existing?.keywords, 12),
    related: asArray(input.related ?? existing?.related, 16),
    supersedes: existing?.supersedes ?? (input.supersedes ? clampText(input.supersedes, 80) : null),
    supersededBy: existing?.supersededBy ?? (input.supersededBy ? clampText(input.supersededBy, 80) : null),
    status: (input.status ?? existing?.status) === 'draft' ? 'draft' : 'active',
    createdAt: created,
    updatedAt: now(),
    lastUsedAt: existing?.lastUsedAt ?? input.lastUsedAt ?? null,
    useCount: Number.isFinite(existing?.useCount) ? existing.useCount : 0,
    seenCount: (Number.isFinite(existing?.seenCount) ? existing.seenCount : 0) + 1,
    pinned: Boolean(input.pinned ?? existing?.pinned ?? false),
    archived: Boolean(input.archived ?? existing?.archived ?? false),
    confidence:
      typeof input.confidence === 'number' && input.confidence >= 0 && input.confidence <= 1
        ? input.confidence
        : existing?.confidence ?? (source === 'auto' ? 0.6 : 1),
  };
}

/* ------------------------------------------------------------------ *
 * 相关度打分
 * ------------------------------------------------------------------ */

const FIELD_WEIGHT = { title: 5, tag: 4, keyword: 3.5, file: 3, content: 1 };

function scoreRecord(record, queryTokens) {
  if (!queryTokens.length) return 0;
  const titleTokens = uniqueTokens(record.title);
  const tagTokens = uniqueTokens((record.tags || []).join(' '));
  const keywordTokens = uniqueTokens((record.keywords || []).join(' '));
  const fileTokens = uniqueTokens((record.files || []).join(' '));
  const contentTokens = uniqueTokens(record.content);
  const setOf = (arr) => new Set(arr);

  const tSet = setOf(titleTokens);
  const gSet = setOf(tagTokens);
  const kSet = setOf(keywordTokens);
  const fSet = setOf(fileTokens);
  const cSet = setOf(contentTokens);

  let score = 0;
  for (const token of queryTokens) {
    if (tSet.has(token)) score += FIELD_WEIGHT.title;
    if (gSet.has(token)) score += FIELD_WEIGHT.tag;
    if (kSet.has(token)) score += FIELD_WEIGHT.keyword;
    if (fSet.has(token)) score += FIELD_WEIGHT.file;
    if (cSet.has(token)) score += FIELD_WEIGHT.content;
  }
  return score;
}

/** 时间衰减：越新越高，半衰期 30 天，最低 0.25。 */
function recencyBoost(iso) {
  const ts = Date.parse(iso || '') || 0;
  if (!ts) return 0.25;
  const days = (Date.now() - ts) / 86400000;
  return Math.max(0.25, Math.pow(0.5, days / 30));
}

/** 用于「会话开始注入」的排序：置顶 > 类别权重 > 相关度 > 新鲜度 > 使用次数。 */
export function rankRecords(records, { query = '', limit = 20 } = {}) {
  const queryTokens = uniqueTokens(query);
  const catWeight = {
    preference: 1.5,
    feedback: 1.45,
    convention: 1.4,
    decision: 1.3,
    user: 1.2,
    fact: 1.15,
    component: 1.1,
    task: 1.05,
    note: 1,
  };
  return records
    .filter((r) => !r.archived && r.status !== 'draft')
    .map((r) => {
      const relevance = queryTokens.length ? scoreRecord(r, queryTokens) : 0;
      const cat = catWeight[r.category] ?? 1;
      const confidence = typeof r.confidence === 'number' ? r.confidence : 0.8;
      const usage = 1 + Math.log1p(r.useCount || 0) * 0.15;
      const score =
        (r.pinned ? 1000 : 0) +
        relevance * 10 * cat * confidence * usage +
        cat * 4 +
        recencyBoost(r.updatedAt || r.createdAt) * 3 +
        confidence * 2;
      return { record: r, relevance, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

/* ------------------------------------------------------------------ *
 * Markdown 镜像
 * ------------------------------------------------------------------ */

const CATEGORY_ORDER = ['user', 'feedback', 'preference', 'convention', 'decision', 'fact', 'component', 'task', 'note'];

export function renderMarkdown(records, { root = '', updatedAt = now() } = {}) {
  const active = records.filter((r) => !r.archived && r.status !== 'draft');
  const titleOf = new Map(records.map((r) => [r.id, r.title]));
  const lines = [];
  lines.push(`# 工作区长期记忆 — ${slugify(root) || 'global'}`);
  lines.push('');
  lines.push(`> 由 dsh-memory 自动生成，请勿手工编辑（改动会在下次同步时被覆盖）。`);
  lines.push(`> 工作区：\`${root || '(全局)'}\``);
  lines.push(`> 条数：${active.length} · 更新：${updatedAt}`);
  lines.push('');

  const pinned = active.filter((r) => r.pinned);
  if (pinned.length) {
    lines.push('## 置顶');
    lines.push('');
    for (const r of pinned) lines.push(`- **${r.title}** — ${oneLine(r.content)}`);
    lines.push('');
  }

  for (const category of CATEGORY_ORDER) {
    const group = active.filter((r) => r.category === category && !r.pinned);
    if (!group.length) continue;
    lines.push(`## ${CATEGORY_LABELS[category]}（${category}）`);
    lines.push('');
    for (const r of group.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
      const meta = [];
      if (r.tags?.length) meta.push(r.tags.map((t) => `\`${t}\``).join(' '));
      if (r.updatedAt) meta.push(r.updatedAt.slice(0, 10));
      lines.push(`- **${r.title}**${meta.length ? ` — ${meta.join(' · ')}` : ''}`);
      const body = oneLine(r.content);
      if (body && body !== r.title) lines.push(`  ${body}`);
      // 版本链与关联：给人看的线索，帮助判断这条记忆的新旧与脉络。
      if (r.supersedes && titleOf.has(r.supersedes)) lines.push(`  ↩ 替代了「${titleOf.get(r.supersedes)}」`);
      const relatedTitles = (r.related || [])
        .map((id) => titleOf.get(id))
        .filter(Boolean)
        .slice(0, 4);
      if (relatedTitles.length) lines.push(`  ⇔ 关联：${relatedTitles.join('、')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function oneLine(text) {
  return String(text || '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export function createMemoryStore({ dir = defaultRoot(), mirror = true } = {}) {
  const indexFile = path.join(dir, 'index.json');
  const cache = new Map(); // folder -> { file, records, stamp }

  const folderFor = (root) => folderName(root || '');
  const dataDirFor = (root) => path.join(dir, 'workspaces', folderFor(root));
  const dataFileFor = (root) => path.join(dataDirFor(root), 'memories.json');

  /* ---------------- 画像层：内部工具 ---------------- */

  function readTextFile(file) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }

  function portraitInfoFor(root) {
    const r = normalizeRoot(root);
    const base = dataDirFor(r);
    return {
      root: r,
      scope: folderFor(r) === GLOBAL_KEY ? 'global' : 'workspace',
      folder: folderFor(r),
      file: path.join(base, 'portrait.json'),
      mdFile: path.join(base, 'PORTRAIT.md'),
      historyDir: path.join(base, 'portrait.history'),
    };
  }

  /** 读画像：portrait.json 优先；缺失时回落解析 PORTRAIT.md（不落盘，persistent=false）。 */
  function readPortraitFor(root) {
    const info = portraitInfoFor(root);
    const raw = readJson(info.file, null);
    if (raw && typeof raw === 'object' && Array.isArray(raw.sections)) {
      return {
        scope: info.scope,
        version: Number(raw.version) || 1,
        updatedAt: raw.updatedAt || null,
        source: SOURCES.includes(raw.source) ? raw.source : 'manual',
        sections: normalizeSections(raw.sections, { scope: info.scope }),
        persistent: true,
      };
    }
    const md = readTextFile(info.mdFile);
    if (md) {
      const parsed = parsePortraitMarkdown(md);
      if (parsed && parsed.sections.some((s) => s.text)) {
        return {
          scope: parsed.scope,
          version: 0,
          updatedAt: null,
          source: 'import',
          sections: parsed.sections,
          persistent: false,
        };
      }
    }
    return null;
  }

  function prunePortraitHistory(historyDir) {
    try {
      const files = fs
        .readdirSync(historyDir)
        .map((name) => ({ name, version: Number((name.match(/^v(\d+)\.json$/) || [])[1]) }))
        .filter((item) => Number.isFinite(item.version))
        .sort((a, b) => b.version - a.version);
      for (const item of files.slice(PORTRAIT_HISTORY_LIMIT)) {
        try {
          fs.rmSync(path.join(historyDir, item.name));
        } catch {
          /* 单个快照删不掉不影响主体 */
        }
      }
    } catch {
      /* 无历史目录/权限问题时忽略 */
    }
  }

  function load(root) {
    const folder = folderFor(root);
    const file = dataFileFor(root);
    const stamp = fileStamp(file);
    const hit = cache.get(folder);
    if (hit && hit.stamp === stamp) return hit;

    const raw = readJson(file, null);
    const records = Array.isArray(raw?.records) ? raw.records.map((r) => normalizeLoaded(r)) : [];
    const entry = { folder, file, records, stamp };
    cache.set(folder, entry);
    return entry;
  }

  function normalizeLoaded(record) {
    return {
      id: record.id || newId(),
      title: clampText(record.title, 160) || '未命名记忆',
      content: clampText(record.content, 8000),
      category: CATEGORY_SET.has(record.category) ? record.category : 'note',
      tags: asArray(record.tags),
      scope: record.scope === 'global' ? 'global' : 'workspace',
      source: SOURCES.includes(record.source) ? record.source : 'manual',
      sessionId: record.sessionId ?? null,
      files: asArray(record.files, 32),
      keywords: asArray(record.keywords, 12),
      related: asArray(record.related, 16),
      supersedes: record.supersedes || null,
      supersededBy: record.supersededBy || null,
      status: record.status === 'draft' ? 'draft' : 'active',
      createdAt: record.createdAt || now(),
      updatedAt: record.updatedAt || record.createdAt || now(),
      lastUsedAt: record.lastUsedAt ?? null,
      useCount: Number.isFinite(record.useCount) ? record.useCount : 0,
      seenCount: Number.isFinite(record.seenCount) ? record.seenCount : 1,
      pinned: Boolean(record.pinned),
      archived: Boolean(record.archived),
      confidence: typeof record.confidence === 'number' ? record.confidence : 0.8,
    };
  }

  /**
   * 读改写：写入前若发现文件被别的进程改过（mtime/size 变了），
   * 先重新读取并按 id 合并，避免多开 DSH 会话时互相覆盖。
   */
  function mutate(root, fn) {
    const entry = load(root);
    const latest = fileStamp(entry.file);
    if (latest !== entry.stamp && latest !== 'missing') {
      const disk = readJson(entry.file, null);
      if (Array.isArray(disk?.records)) {
        const merged = new Map(entry.records.map((r) => [r.id, r]));
        for (const rec of disk.records) {
          const norm = normalizeLoaded(rec);
          const prev = merged.get(norm.id);
          if (!prev || String(prev.updatedAt) <= String(norm.updatedAt)) merged.set(norm.id, norm);
        }
        entry.records = [...merged.values()];
      }
    }

    const result = fn(entry.records);
    const next = result && Array.isArray(result.records) ? result.records : entry.records;

    writeJsonAtomic(entry.file, {
      schemaVersion: SCHEMA_VERSION,
      key: workspaceKey(root),
      root: normalizeRoot(root),
      updatedAt: now(),
      records: next,
    });
    entry.records = next;
    entry.stamp = fileStamp(entry.file);
    writeIndex(root, next);
    // mirror 可以是布尔值，也可以是 getter，便于设置面板实时开关而不重建 store。
    // 主库旁车始终写（它是数据自己的一份人读副本）；只有工作区镜像受开关控制。
    writeMirror(root, next, { workspace: Boolean(typeof mirror === 'function' ? mirror() : mirror) });
    return result;
  }

  function writeIndex(root, records) {
    const index = readJson(indexFile, { schemaVersion: SCHEMA_VERSION, workspaces: {} });
    index.schemaVersion = SCHEMA_VERSION;
    index.workspaces = index.workspaces || {};
    const key = workspaceKey(root);
    index.workspaces[key] = {
      key,
      root: normalizeRoot(root),
      slug: slugify(root),
      folder: folderFor(root),
      count: records.filter((r) => !r.archived && r.status !== 'draft').length,
      total: records.length,
      updatedAt: now(),
    };
    writeJsonAtomic(indexFile, index);
  }

  /**
   * Markdown 镜像，两处都写：
   *   1. 主库旁边 `~/.dsh/storages/dsh-memory/workspaces/<slug>/MEMORY.md`（面板与 /mirror 读这里）；
   *   2. 工作区内 `<工作区>/.dsh-memory/MEMORY.md` —— 设置里承诺的那份人读文件，
   *      可直接被 read/grep 与 git 使用。
   * 工作区目录不存在时跳过第 2 处：会话 cwd 已失效时绝不凭空造目录。
   */
  function writeMirror(root, records, { workspace: alsoWorkspace = true } = {}) {
    const active = records.filter((r) => !r.archived && r.status !== 'draft');
    const markdown = renderMarkdown(records, { root: normalizeRoot(root) });
    const result = { storageFile: path.join(dataDirFor(root), 'MEMORY.md'), workspaceFile: null };
    try {
      fs.mkdirSync(path.dirname(result.storageFile), { recursive: true });
      fs.writeFileSync(result.storageFile, markdown, 'utf8');
    } catch {
      /* 镜像失败不影响主流程 */
    }
    // 一条有效记忆都没有、或用户在设置里关了工作区镜像：别在工作区留过期文件。
    if (!active.length || !alsoWorkspace) {
      removeWorkspaceMirror(root);
      return result;
    }
    if (isDirectory(normalizeRoot(root))) {
      try {
        const target = workspaceMirrorFile(root);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, markdown, 'utf8');
        result.workspaceFile = target;
      } catch {
        /* 工作区只读或无权限：镜像降级，不影响主库 */
      }
    }
    return result;
  }

  /** 撤掉工作区镜像文件；`.dsh-memory` 空目录一并收掉。设置里关掉镜像时调用。 */
  function removeWorkspaceMirror(workspace) {
    const target = workspaceMirrorFile(workspace);
    if (!target) return false;
    let removed = false;
    try {
      if (fileExists(target)) {
        fs.rmSync(target, { force: true });
        removed = true;
      }
      const dir = path.dirname(target);
      if (isDirectory(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* 删不掉就算了，不是致命错误 */
    }
    return removed;
  }

  /** 重复簇核心（闭包级，health 与公开方法共用）：并查集 + 同 scope 两两 Jaccard。 */
  function clusterDuplicates({ workspace = '', threshold = 0.72 } = {}) {
    const pool = gather({ workspace });
    const parent = new Map(pool.map((r) => [r.id, r.id]));
    const find = (id) => {
      while (parent.get(id) !== id) {
        parent.set(id, parent.get(parent.get(id)));
        id = parent.get(id);
      }
      return id;
    };
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        if (pool[i].scope !== pool[j].scope) continue;
        const s = similarity(
          `${pool[i].title} ${pool[i].content}`,
          `${pool[j].title} ${pool[j].content}`,
        );
        if (s >= threshold) parent.set(find(pool[i].id), find(pool[j].id));
      }
    }
    const groups = new Map();
    for (const r of pool) {
      const root = find(r.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(r);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  }

  /** 更新核心（闭包级）：public update 与 unlink 共用，含 user 类别挪库。 */
  function patchRecord(id, patch = {}, { workspace = '' } = {}) {
    const all = gather({ workspace, includeArchived: true, includeDrafts: true });
    const current = all.find((r) => r.id === id);
    if (!current) return { ok: false, error: 'not_found' };
    const record = normalizeRecord({ ...patch, id }, current);
    record.createdAt = current.createdAt;
    record.updatedAt = now();
    const currentRoot = current.scope === 'global' ? '' : workspace;
    const homeRoot = record.scope === 'global' ? '' : currentRoot;
    if (homeRoot !== currentRoot) {
      mutate(currentRoot, (records) => ({ records: records.filter((r) => r.id !== id) }));
    }
    return mutate(homeRoot, (records) => {
      const idx = records.findIndex((r) => r.id === id);
      const next = idx >= 0 ? records.map((r, i) => (i === idx ? record : r)) : [...records, record];
      return { ok: true, record, records: next };
    });
  }

  /** 合并全局记忆 + 本工作区记忆。草稿默认不可见：要进审批队列必须显式带上 includeDrafts。 */
  function gather({ workspace = '', includeGlobal = true, includeArchived = false, includeDrafts = false } = {}) {
    const own = workspace ? load(workspace).records.map((r) => ({ ...r, scope: 'workspace' })) : [];
    const global = includeGlobal
      ? load('').records.map((r) => ({ ...r, scope: 'global' }))
      : [];
    let all = [...global, ...own];
    if (!includeArchived) all = all.filter((r) => !r.archived);
    if (!includeDrafts) all = all.filter((r) => r.status !== 'draft');
    return all;
  }

  return {
    dir,
    indexPath: indexFile,

    /** 工作区元信息（不需要先有记忆）。 */
    workspaceInfo(workspace) {
      return {
        key: workspaceKey(workspace),
        root: normalizeRoot(workspace),
        slug: slugify(workspace),
        folder: folderFor(workspace),
        dataFile: dataFileFor(workspace),
        mirrorFile: workspaceMirrorFile(workspace),
      };
    },

    /**
     * 镜像现状：主库旁车与工作区镜像各自的路径与存在性。
     * 面板用它显示「镜像文件」一栏，并在镜像关掉时给出明确提示。
     */
    mirrorInfo(workspace) {
      const root = normalizeRoot(workspace);
      const storageFile = path.join(dataDirFor(root), 'MEMORY.md');
      const workspaceFile = workspaceMirrorFile(root);
      return {
        storageFile,
        storageExists: fileExists(storageFile),
        workspaceFile,
        workspaceExists: workspaceFile ? fileExists(workspaceFile) : false,
        workspaceDirExists: isDirectory(root),
      };
    },

    /** 关掉工作区镜像时撤掉文件（见 removeWorkspaceMirror）。 */
    removeWorkspaceMirror(workspace) {
      return removeWorkspaceMirror(workspace);
    },

    list(options = {}) {
      const {
        workspace = '',
        query = '',
        category = '',
        scope = '',
        tag = '',
        includeGlobal = true,
        includeArchived = false,
        includeDrafts = false,
        sort = 'updated',
        limit = 500,
        offset = 0,
      } = options;

      let records = gather({ workspace, includeGlobal, includeArchived, includeDrafts });
      if (category) records = records.filter((r) => r.category === category);
      if (scope) records = records.filter((r) => r.scope === scope);
      if (tag) records = records.filter((r) => (r.tags || []).includes(tag));

      if (query) {
        const tokens = uniqueTokens(query);
        const scored = records
          .map((r) => ({ r, s: scoreRecord(r, tokens) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || String(b.r.updatedAt).localeCompare(String(a.r.updatedAt)));
        records = scored.map((x) => x.r);
      } else if (sort === 'updated') {
        records = [...records].sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return String(b.updatedAt).localeCompare(String(a.updatedAt));
        });
      } else if (sort === 'created') {
        records = [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      } else if (sort === 'title') {
        records = [...records].sort((a, b) => String(a.title).localeCompare(String(b.title)));
      }

      const total = records.length;
      return { total, records: records.slice(offset, offset + limit) };
    },

    get(id, { workspace = '', includeDrafts = false } = {}) {
      return gather({ workspace, includeArchived: true, includeDrafts }).find((r) => r.id === id) || null;
    },

    /**
     * 新增或更新。传入 id 时按 id 更新；否则按 workspaceKey 落库。
     * 当 `dedupe` 为真且发现高度相似的既有记录时，合并进那条记录。
     * `user` 类别强制落全局库：目标库不对时先从旧库摘出来再写入新库。
     */
    upsert(input = {}, { workspace = '', dedupe = false } = {}) {
      let targetRoot = input.scope === 'global' ? '' : workspace;
      let existing = null;
      if (input.id) {
        existing =
          load(targetRoot).records.find((r) => r.id === input.id) ||
          (targetRoot ? load('').records.find((r) => r.id === input.id) : null) ||
          null;
        if (existing?.scope === 'global') targetRoot = '';
      }

      let merged = null;
      if (!existing && dedupe) {
        const probe = `${input.title || ''} ${input.content || ''}`;
        let best = null;
        for (const r of load(targetRoot).records.filter((r) => r.status !== 'draft')) {
          const s = similarity(probe, `${r.title} ${r.content}`);
          if (!best || s > best.s) best = { r, s };
        }
        if (best && best.s >= 0.72) merged = best.r;
      }

      const record = normalizeRecord(input, existing || merged || null);
      if (existing || merged) record.createdAt = (existing || merged).createdAt;

      const homeRoot = record.scope === 'global' ? '' : targetRoot;
      if (homeRoot !== targetRoot) {
        mutate(targetRoot, (records) => ({ records: records.filter((r) => r.id !== record.id) }));
      }
      const result = mutate(homeRoot, (records) => {
        const idx = records.findIndex((r) => r.id === record.id);
        const next = idx >= 0 ? records.map((r, i) => (i === idx ? record : r)) : [...records, record];
        return { record, mergedInto: Boolean(merged), records: next };
      });
      return result;
    },

    /** 局部更新（置顶/归档/改类别/改正文）。类别改动触发挪库时同样走摘除+写入。 */
    update(id, patch = {}, { workspace = '' } = {}) {
      return patchRecord(id, patch, { workspace });
    },

    remove(id, { workspace = '' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const current = all.find((r) => r.id === id);
      if (!current) return { ok: false, error: 'not_found' };
      const targetRoot = current.scope === 'global' ? '' : workspace;
      return mutate(targetRoot, (records) => ({
        ok: true,
        removed: current,
        records: records.filter((r) => r.id !== id),
      }));
    },

    /** 批量删除 / 归档 / 置顶。 */
    bulk(action, ids = [], { workspace = '' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const targets = ids.map((id) => all.find((r) => r.id === id)).filter(Boolean);
      if (!targets.length) return { ok: true, affected: 0 };

      const byRoot = new Map();
      for (const r of targets) {
        const root = r.scope === 'global' ? '' : workspace;
        if (!byRoot.has(root)) byRoot.set(root, new Set());
        byRoot.get(root).add(r.id);
      }

      let affected = 0;
      for (const [root, idSet] of byRoot) {
        mutate(root, (records) => {
          let next = records;
          if (action === 'delete') {
            next = records.filter((r) => !idSet.has(r.id));
          } else {
            next = records.map((r) => {
              if (!idSet.has(r.id)) return r;
              const patch = {};
              if (action === 'archive') patch.archived = true;
              if (action === 'unarchive') patch.archived = false;
              if (action === 'pin') patch.pinned = true;
              if (action === 'unpin') patch.pinned = false;
              return { ...r, ...patch, updatedAt: now() };
            });
          }
          affected += idSet.size;
          return { records: next };
        });
      }
      return { ok: true, affected: targets.length };
    },

    /** 检索：给 agent 工具与会话注入用，按相关度排序。带 query 时只返回真命中的记录。 */
    search({ workspace = '', query = '', limit = 10, includeGlobal = true } = {}) {
      const pool = gather({ workspace, includeGlobal });
      const ranked = rankRecords(pool, { query, limit });
      const hits = String(query).trim() ? ranked.filter((x) => x.relevance > 0) : ranked;
      return hits.map((x) => ({ ...x.record, _score: Number(x.score.toFixed(3)) }));
    },

    /** 会话开始注入用：不需要 query，按重要度取前 N 条。index 模式一行一条，成本按行算。 */
    briefing({ workspace = '', limit = 12, maxChars = 2400, mode = 'full' } = {}) {
      const pool = gather({ workspace, includeGlobal: true });
      const picked = [];
      let used = 0;
      for (const { record } of rankRecords(pool, { limit: 200 })) {
        const cost =
          mode === 'index'
            ? record.title.length + (record.tags || []).join('').length + 30
            : record.title.length + record.content.length + 24;
        if (used + cost > maxChars && picked.length >= 3) break;
        picked.push(record);
        used += cost;
        if (picked.length >= limit) break;
      }
      return picked;
    },

    /**
     * 版本链：新观察推翻旧结论时，旧条归档并回指新条，新条指回旧条。
     * 归档不是删除——链一直在，面板可以一键回滚。
     */
    supersede(oldId, input = {}, { workspace = '' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const old = all.find((r) => r.id === oldId);
      if (!old) return { ok: false, error: 'not_found' };
      const seed = { ...input, supersedes: old.id, scope: old.scope, status: 'active' };
      if (!CATEGORY_SET.has(seed.category)) seed.category = old.category;
      const record = normalizeRecord(seed, null);
      const targetRoot = old.scope === 'global' ? '' : workspace;
      return mutate(targetRoot, (records) => {
        const next = records.map((r) =>
          r.id === old.id ? { ...r, archived: true, supersededBy: record.id, updatedAt: now() } : r,
        );
        return { ok: true, record, superseded: old, records: [...next, record] };
      });
    },

    /**
     * 回滚版本链。传新条 id：收起新条、恢复旧条；传旧条 id（带 supersededBy）：
     * 恢复自己、收起指向的新条。
     */
    rollback(id, { workspace = '' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const record = all.find((r) => r.id === id);
      if (!record) return { ok: false, error: 'not_found' };
      const oldId = record.supersedes || null;
      const newerId = record.supersededBy || null;
      if (!oldId && !newerId) return { ok: false, error: 'no_chain' };
      const targetRoot = record.scope === 'global' ? '' : workspace;
      return mutate(targetRoot, (records) => ({
        ok: true,
        restored: oldId || id,
        archived: oldId ? id : newerId,
        records: records.map((r) => {
          if (oldId && r.id === id) return { ...r, archived: true, updatedAt: now() };
          if (!oldId && r.id === id) return { ...r, archived: false, supersededBy: null, updatedAt: now() };
          if (oldId && r.id === oldId) return { ...r, archived: false, supersededBy: null, updatedAt: now() };
          if (!oldId && r.id === newerId) return { ...r, archived: true, updatedAt: now() };
          return r;
        }),
      }));
    },

    /** 相关记忆的双链是悬空允许的；这里把指向不存在记录的链接摘掉（体检的修复动作）。 */
    unlink(id, target = '', { workspace = '' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const current = all.find((r) => r.id === id);
      if (!current) return { ok: false, error: 'not_found' };
      const patch = {};
      if (target && current.supersedes === target) patch.supersedes = null;
      if (target && current.supersededBy === target) patch.supersededBy = null;
      if (!target || current.related?.includes(target)) {
        patch.related = target ? (current.related || []).filter((x) => x !== target) : [];
      }
      if (!Object.keys(patch).length) return { ok: false, error: 'nothing_to_unlink' };
      return patchRecord(id, patch, { workspace });
    },

    /** 重复簇：同 scope 内两两 Jaccard ≥ threshold 的记录归成一个簇（并查集）。 */
    findDuplicateClusters({ workspace = '', threshold = 0.72 } = {}) {
      return clusterDuplicates({ workspace, threshold });
    },

    /**
     * 合并标签变体：把 from 里的每个标签（原样匹配）统一替换成 to。
     * 用于治理「DSH / dsh / Dsh」这类大小写漂移。返回改动的条数。
     */
    mergeTag(from = [], to = '', { workspace = '' } = {}) {
      const names = asArray(from).filter((t) => t && t !== to);
      if (!names.length || !to) return { ok: false, error: 'nothing_to_merge' };
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const byRoot = new Map();
      for (const r of all) {
        if (!(r.tags || []).some((t) => names.includes(t))) continue;
        const root = r.scope === 'global' ? '' : workspace;
        if (!byRoot.has(root)) byRoot.set(root, new Set());
        byRoot.get(root).add(r.id);
      }
      let affected = 0;
      for (const [root, ids] of byRoot) {
        mutate(root, (records) => ({
          records: records.map((r) => {
            if (!ids.has(r.id)) return r;
            const next = [...new Set((r.tags || []).map((t) => (names.includes(t) ? to : t)))];
            return { ...r, tags: next, updatedAt: now() };
          }),
        }));
        affected += ids.size;
      }
      return { ok: true, affected };
    },

    /**
     * 把一簇重复记忆合并成一条新记忆并归档源条目（与面板「整合」同一套语义：
     * 归档可恢复，不真删）。ids 至少两条且同 scope。
     */
    consolidateCluster(ids = [], { workspace = '', title = '', category = '', tags = null, source = 'manual' } = {}) {
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const targets = ids
        .map((id) => all.find((r) => r.id === id))
        .filter(Boolean)
        .filter((r) => !r.archived && r.status !== 'draft');
      if (targets.length < 2) return { ok: false, error: 'need_two' };
      if (new Set(targets.map((r) => r.scope)).size > 1) return { ok: false, error: 'mixed_scope' };

      const tally = new Map();
      for (const r of targets) tally.set(r.category, (tally.get(r.category) || 0) + 1);
      const modeCategory = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'note';
      const base = [...targets].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      const record = normalizeRecord(
        {
          title: title || base.title,
          content: targets
            .map((r) => {
              const body = String(r.content || '').replace(/\s+/g, ' ').trim();
              return `- **${r.title}**${body ? ` — ${body}` : ''}`;
            })
            .join('\n'),
          category: CATEGORY_SET.has(category) ? category : modeCategory,
          tags: tags ?? [...new Set(targets.flatMap((r) => r.tags || []))],
          scope: base.scope,
          source,
          confidence: Math.max(...targets.map((r) => r.confidence ?? 0.8)),
        },
        null,
      );
      const targetRoot = base.scope === 'global' ? '' : workspace;
      return mutate(targetRoot, (records) => {
        const idSet = new Set(targets.map((r) => r.id));
        // 源条目归档（可恢复），不真删——与面板「整合」同一语义。
        return {
          ok: true,
          record,
          archivedIds: targets.map((r) => r.id),
          records: [
            ...records.map((r) => (idSet.has(r.id) ? { ...r, archived: true, updatedAt: now() } : r)),
            record,
          ],
        };
      });
    },

    /**
     * 记忆体检：重复簇、过期未用、断链（related/supersedes 指向不存在的记录）、
     * 待审草稿数。只报告，不动手——修复走 /health/resolve。
     */
    health({ workspace = '', staleDays = 60 } = {}) {
      const pool = gather({ workspace });
      const everything = gather({ workspace, includeArchived: true, includeDrafts: true });
      const byId = new Map(everything.map((r) => [r.id, r]));
      const cutoff = Date.now() - staleDays * 86400000;
      const stale = pool
        .filter((r) => !r.pinned && !r.useCount && (Date.parse(r.updatedAt) || 0) < cutoff)
        .map((r) => r.id);
      const duplicates = clusterDuplicates({ workspace }).map((group) => group.map((r) => r.id));
      const broken = [];
      for (const r of everything) {
        for (const target of r.related || []) {
          if (!byId.has(target)) broken.push({ id: r.id, field: 'related', target });
        }
        if (r.supersedes && !byId.has(r.supersedes)) broken.push({ id: r.id, field: 'supersedes', target: r.supersedes });
        if (r.supersededBy && !byId.has(r.supersededBy)) {
          broken.push({ id: r.id, field: 'supersededBy', target: r.supersededBy });
        }
      }
      return {
        workspace: normalizeRoot(workspace),
        staleDays,
        stale,
        duplicates,
        broken,
        drafts: everything.filter((r) => r.status === 'draft' && !r.archived).length,
      };
    },

    /** 标记被使用（影响后续排序）。 */
    markUsed(ids = [], { workspace = '' } = {}) {
      if (!ids.length) return { ok: true, affected: 0 };
      const all = gather({ workspace, includeArchived: true, includeDrafts: true });
      const byRoot = new Map();
      for (const id of ids) {
        const r = all.find((x) => x.id === id);
        if (!r) continue;
        const root = r.scope === 'global' ? '' : workspace;
        if (!byRoot.has(root)) byRoot.set(root, new Set());
        byRoot.get(root).add(id);
      }
      for (const [root, idSet] of byRoot) {
        mutate(root, (records) => ({
          records: records.map((r) =>
            idSet.has(r.id) ? { ...r, lastUsedAt: now(), useCount: (r.useCount || 0) + 1 } : r,
          ),
        }));
      }
      return { ok: true, affected: ids.length };
    },

    stats({ workspace = '' } = {}) {
      const active = gather({ workspace, includeGlobal: false });
      const global = load('').records.filter((r) => !r.archived && r.status !== 'draft');
      const pool = gather({ workspace });
      const drafts = gather({ workspace, includeArchived: true, includeDrafts: true }).filter(
        (r) => r.status === 'draft' && !r.archived,
      ).length;
      const used = pool.filter((r) => (r.useCount || 0) > 0).length;
      const byCategory = {};
      for (const r of active) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      return {
        workspace: normalizeRoot(workspace),
        key: workspaceKey(workspace),
        folder: folderFor(workspace),
        total: active.length,
        archived: load(workspace).records.filter((r) => r.archived).length,
        pinned: active.filter((r) => r.pinned).length,
        global: global.length,
        drafts,
        utilization: pool.length ? used / pool.length : 0,
        byCategory,
        updatedAt: active.reduce((acc, r) => (String(r.updatedAt) > acc ? String(r.updatedAt) : acc), ''),
      };
    },

    /** 所有已知工作区（设置面板的「工作区切换」用）。 */
    workspaces() {
      const index = readJson(indexFile, { workspaces: {} });
      return Object.values(index.workspaces || {}).sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
      );
    },

    /** 所有出现过的标签。 */
    tags({ workspace = '' } = {}) {
      const counts = new Map();
      for (const r of gather({ workspace })) {
        for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
      }
      return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
    },

    /** 导出（备份 / 迁移）。 */
    export({ workspace = '' } = {}) {
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: now(),
        workspace: normalizeRoot(workspace),
        key: workspaceKey(workspace),
        records: gather({ workspace, includeArchived: true }),
      };
    },

    import(payload = {}, { workspace = '', mode = 'merge' } = {}) {
      const incoming = Array.isArray(payload.records) ? payload.records : [];
      const targetRoot = workspace || '';
      /* 记录自带 scope：global 的进全局库，workspace 的进本工作区库。 */
      const groups = new Map();
      for (const raw of incoming) {
        const norm = normalizeLoaded(raw);
        const root = norm.scope === 'global' ? '' : targetRoot;
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(norm);
      }
      let added = 0;
      let replaced = 0;
      for (const [root, records] of groups) {
        mutate(root, (current) => {
          const byId = new Map(current.map((r) => [r.id, r]));
          if (mode === 'replace') byId.clear();
          for (const norm of records) {
            if (byId.has(norm.id)) replaced += 1;
            else added += 1;
            byId.set(norm.id, norm);
          }
          return { records: [...byId.values()] };
        });
      }
      return { ok: true, added, replaced, total: incoming.length };
    },

    /* ---------------- 画像层（portrait） ---------------- */

    /**
     * 画像的路径与状态信息（不读内容）。
     * root 传 '' 即全局画像（workspaces/_global/）。
     */
    portraitInfo(root) {
      return portraitInfoFor(root);
    },

    /**
     * 读画像：portrait.json 优先；缺失时回落解析 PORTRAIT.md（不落盘，persistent=false）。
     * 两份都没有时返回 null。
     */
    portrait(root) {
      return readPortraitFor(root);
    },

    /**
     * 保存画像（手动编辑 / 重写管线共用）。
     * 版本 +1；旧版落 portrait.history/v<N>.json（保留最近 PORTRAIT_HISTORY_LIMIT 版）；
     * 同步刷新 PORTRAIT.md 正本。
     */
    savePortrait(root, { sections = [], source = 'manual' } = {}) {
      const info = portraitInfoFor(root);
      const prev = readJson(info.file, null);
      const prevVersion = Number(prev?.version) || 0;
      if (prev && prevVersion > 0) {
        try {
          fs.mkdirSync(info.historyDir, { recursive: true });
          writeJsonAtomic(path.join(info.historyDir, `v${prevVersion}.json`), prev);
          prunePortraitHistory(info.historyDir);
        } catch {
          /* 快照留不住不阻断保存 */
        }
      }
      const next = {
        schemaVersion: 1,
        scope: info.scope,
        version: prevVersion + 1,
        updatedAt: now(),
        source: SOURCES.includes(source) ? source : 'manual',
        sections: normalizeSections(sections, { scope: info.scope }),
      };
      writeJsonAtomic(info.file, next);
      let mdWritten = true;
      try {
        fs.writeFileSync(
          info.mdFile,
          renderPortraitMarkdown(next, { scopeLabel: slugify(info.root) }),
          'utf8',
        );
      } catch {
        mdWritten = false;
      }
      return { ok: true, portrait: { ...next, persistent: true }, mdWritten };
    },

    /** 画像版本列表（含当前版本；降序）。 */
    portraitHistory(root) {
      const info = portraitInfoFor(root);
      const out = [];
      const current = readPortraitFor(root);
      if (current && current.persistent) {
        out.push({ version: current.version, updatedAt: current.updatedAt, source: current.source, current: true });
      }
      try {
        for (const name of fs.readdirSync(info.historyDir)) {
          const m = name.match(/^v(\d+)\.json$/);
          if (!m) continue;
          const raw = readJson(path.join(info.historyDir, name), null);
          out.push({
            version: Number(m[1]),
            updatedAt: raw?.updatedAt || null,
            source: SOURCES.includes(raw?.source) ? raw.source : 'manual',
            current: false,
          });
        }
      } catch {
        /* 无历史目录 */
      }
      out.sort((a, b) => b.version - a.version);
      return out;
    },

    /** 强制丢弃内存缓存（设置面板刷新 / 手工改了 json 之后）。 */
    invalidate(root) {
      if (root === undefined) cache.clear();
      else cache.delete(folderFor(root));
    },

    renderMarkdown(workspace) {
      return renderMarkdown(gather({ workspace, includeArchived: true }), { root: workspace });
    },
  };
}

export default { createMemoryStore, workspaceKey, defaultRoot, CATEGORIES, CATEGORY_LABELS };
