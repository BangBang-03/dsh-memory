/**
 * dsh-memory — 画像层（portrait）纯逻辑。
 *
 * 画像 = 每工作区 / 全局各一份、由「重写式合并」滚动维护的叙事文档。
 * 条目层只存「不会过期」的知识与坑；画像层承担「现在是什么样」。
 *
 * 本模块只做纯函数：段落模型、Markdown 渲染 / 解析、注入渲染与预算截断。
 * 读写（含版本快照与 PORTRAIT.md 同步）在 lib/store.js 的 portrait* 方法；
 * 重写管线（LLM）见设计稿 P1。测试见 test/portrait.test.mjs。
 */

/** 固定四段；key 稳定，title 按 scope 取（global 版第二段叫「个人背景」）。 */
export const PORTRAIT_SECTIONS = [
  { key: 'background', title: '工作背景', globalTitle: '工作背景' },
  { key: 'preference', title: '协作约定', globalTitle: '个人背景' },
  { key: 'focus', title: '当前关注', globalTitle: '当前关注' },
  { key: 'recent', title: '近期动态', globalTitle: '近期动态' },
];

/** 版本快照保留上限。 */
export const PORTRAIT_HISTORY_LIMIT = 10;

/** 单段正文上限。 */
const SECTION_MAX = 4000;

function clampText(text, max) {
  const s = String(text == null ? '' : text).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 该 scope 下的四段定义（{key, title}）。 */
export function sectionsFor(scope = 'workspace') {
  const field = scope === 'global' ? 'globalTitle' : 'title';
  return PORTRAIT_SECTIONS.map((s) => ({ key: s.key, title: s[field] }));
}

/**
 * 画像证据：section key -> 引用列表（mem_… / journal:YYYY-MM-DD / session:…）。
 * 只保留固定四段，去重、裁剪，防止模型输出把画像撑爆。
 */
export function normalizePortraitEvidence(input = {}, { scope = 'workspace' } = {}) {
  const keys = new Set(sectionsFor(scope).map((s) => s.key));
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (!keys.has(key)) continue;
    const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const refs = [];
    const seen = new Set();
    for (const raw of list) {
      const ref = String(raw ?? '').trim();
      if (!ref || ref.length > 160 || seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
      if (refs.length >= 12) break;
    }
    if (refs.length) out[key] = refs;
  }
  return out;
}

/** 每段的证据计数与「未溯源」标记；旧画像没有 evidence 时全部标未溯源。 */
export function portraitSectionMeta(evidence = {}, { scope = 'workspace' } = {}) {
  const normalized = normalizePortraitEvidence(evidence, { scope });
  const out = {};
  for (const def of sectionsFor(scope)) {
    const count = (normalized[def.key] || []).length;
    out[def.key] = { evidenceCount: count, untraced: count === 0 };
  }
  return out;
}

/**
 * 把任意输入归一成固定四段（缺失补空、未知忽略、标题统一按 scope）。
 * 输入支持：[{key?,title?,text?}] / {key: text} / {title: text}。
 */
export function normalizeSections(input, { scope = 'workspace' } = {}) {
  const defs = sectionsFor(scope);
  const byKey = new Map(defs.map((s) => [s.key, s]));
  const byTitle = new Map();
  for (const s of PORTRAIT_SECTIONS) {
    byTitle.set(s.title, s.key);
    byTitle.set(s.globalTitle, s.key);
  }

  const raw = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? Object.entries(input).map(([k, v]) => ({ key: k, text: v }))
      : [];

  const out = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = clampText(item.text ?? item.content ?? '', SECTION_MAX);
    let key = null;
    if (item.key && byKey.has(item.key)) key = item.key;
    else if (item.title && byTitle.has(String(item.title).trim())) key = byTitle.get(String(item.title).trim());
    if (!key || out.has(key)) continue;
    out.set(key, text);
  }
  return defs.map((s) => ({ key: s.key, title: s.title, text: out.get(s.key) ?? '' }));
}

/**
 * 解析 PORTRAIT.md 风格的 Markdown：`**段标题**` 起段，正文跟到下一段为止。
 * 返回 { scope, sections }；识别不出任何段时返回 null。
 */
export function parsePortraitMarkdown(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const keyByTitle = new Map();
  for (const s of PORTRAIT_SECTIONS) {
    keyByTitle.set(s.title, s.key);
    keyByTitle.set(s.globalTitle, s.key);
  }

  const found = new Map();
  let cur = null;
  let scope = null;
  for (const line of lines) {
    if (/^#\s*全局画像/.test(line)) scope = 'global';
    else if (/^#\s*工作区画像/.test(line) && !scope) scope = 'workspace';
    const m = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (m) {
      const title = m[1].trim();
      const key = keyByTitle.get(title);
      if (key) {
        cur = { key, title, lines: [], evidence: [] };
        if (!found.has(key)) found.set(key, cur);
        continue;
      }
    }
    if (cur) {
      const ref = line.match(/^>\s*参考[:：]\s*(.+)$/u);
      if (ref) {
        for (const token of ref[1].split(/[、,，\s]+/u)) if (token) cur.evidence.push(token);
        continue;
      }
    }
    if (line.startsWith('#')) continue;
    if (cur) cur.lines.push(line);
  }
  if (!found.size) return null;

  /* 无 H1 标题时按段标题兜底：出现「个人背景」即全局版。 */
  if (!scope) {
    for (const item of found.values()) {
      if (item.title === '个人背景') {
        scope = 'global';
        break;
      }
    }
  }
  const resolved = scope || 'workspace';
  const sections = normalizeSections(
    [...found.values()].map((s) => ({ key: s.key, text: s.lines.join('\n').trim() })),
    { scope: resolved },
  );
  const evidence = {};
  for (const item of found.values()) {
    if (item.evidence.length) evidence[item.key] = item.evidence;
  }
  return {
    scope: resolved,
    sections,
    evidence: normalizePortraitEvidence(evidence, { scope: resolved }),
  };
}

/** 渲染 PORTRAIT.md 正本（人读）；内容与 portrait.json 同源。 */
export function renderPortraitMarkdown(portrait = {}, { scopeLabel = '' } = {}) {
  const scope = portrait.scope === 'global' ? 'global' : 'workspace';
  const sections = normalizeSections(portrait.sections, { scope });
  const evidence = normalizePortraitEvidence(portrait.evidence, { scope });
  const lines = [];
  lines.push(scope === 'global' ? '# 全局画像' : `# 工作区画像${scopeLabel ? ` — ${scopeLabel}` : ''}`);
  lines.push('');
  lines.push(
    `> 更新：${String(portrait.updatedAt || '').slice(0, 10)} ｜ 版本：v${portrait.version ?? 1} ｜ 由 dsh-memory 维护（portrait.json 的正本镜像）`,
  );
  lines.push('');
  for (const s of sections) {
    if (!s.text) continue;
    lines.push(`**${s.title}**`);
    lines.push('');
    lines.push(s.text);
    if (evidence[s.key]?.length) {
      lines.push('');
      lines.push(`> 参考：${evidence[s.key].join('、')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function sectionCost(s) {
  return (s.title?.length || 0) + (s.text?.length || 0) + 8;
}

/** 单份画像的预算截断：按段累加，超预算的段截断（余量 >80 字符才保留），更后的段丢弃。 */
export function clampPortraitToBudget(sections = [], maxChars = 1200) {
  const out = [];
  let used = 0;
  let truncated = false;
  for (const s of sections) {
    if (!s.text) continue;
    const cost = sectionCost(s);
    if (used + cost <= maxChars) {
      out.push({ ...s });
      used += cost;
      continue;
    }
    const remain = maxChars - used - (s.title?.length || 0) - 8;
    if (remain > 80) {
      out.push({ ...s, text: `${String(s.text).slice(0, remain - 1)}…` });
      used += remain + (s.title?.length || 0) + 8;
    }
    truncated = true;
    break;
  }
  return { sections: out, chars: used, truncated };
}

/**
 * 渲染注入块：工作区 + 全局两份画像，合计受 maxChars 约束。
 * 预算分配：全局先取 min(600, 预算/3)（它通常更短），剩余给工作区（至少一半）。
 * 返回 { text, chars, truncated, hasWorkspace, hasGlobal }。
 */
export function renderPortraitInjection({ workspace = null, global = null, maxChars = 1400 } = {}) {
  const budget = Math.max(200, Math.floor(Number(maxChars) || 1400));
  const parts = [];
  let chars = 0;
  let truncated = false;

  let ws = null;
  let gl = null;
  if (global) {
    gl = clampPortraitToBudget(global.sections || [], Math.min(600, Math.floor(budget / 3)));
  }
  const wsCap = Math.max(budget - (gl ? gl.chars + 24 : 0), Math.floor(budget / 2));
  if (workspace) {
    ws = clampPortraitToBudget(workspace.sections || [], wsCap);
  }

  const render = (portrait, clamped, head) => {
    const body = clamped.sections
      .filter((s) => s.text)
      .map((s) => `**${s.title}**\n${s.text}`)
      .join('\n');
    if (!body) return null;
    return `${head}\n${body}`;
  };

  if (ws) {
    const block = render(workspace, ws, `### 工作区画像（v${workspace.version ?? 1}）`);
    if (block) {
      parts.push(block);
      chars += block.length + 2;
      truncated = truncated || ws.truncated;
    }
  }
  if (gl) {
    const block = render(global, gl, `### 全局画像（v${global.version ?? 1}）`);
    if (block) {
      parts.push(block);
      chars += block.length + 2;
      truncated = truncated || gl.truncated;
    }
  }
  if (!parts.length) return { text: '', chars: 0, truncated: false, hasWorkspace: false, hasGlobal: false };
  if (truncated) parts.push('（画像超出预算已截断，完整版见 设置 → 记忆。）');
  return {
    text: parts.join('\n\n'),
    chars,
    truncated,
    hasWorkspace: Boolean(ws && ws.sections.some((s) => s.text)),
    hasGlobal: Boolean(gl && gl.sections.some((s) => s.text)),
  };
}

/* ------------------------------------------------------------------ *
 * 重写管线（纯逻辑）：旧画像 + 日志 + 条目摘要 → 提示词；模型输出 → 四段。
 * ------------------------------------------------------------------ */

/** 重写管线的系统提示词（模型侧）。要求只输出 JSON。 */
export const REWRITE_SYSTEM = [
  "You maintain the rolling 'portrait' of a coding agent's long-term memory (one scope per call).",
  'Given the current portrait, recent journal entries, and a list of memory entries, REWRITE the portrait.',
  '',
  'Rules:',
  '- Keep the fixed sections; rewrite text WITHIN them, never append new sections or meta notes.',
  '- Merge durable facts from the material; correct what is outdated; compress redundancy.',
  '- Never invent facts. Only use what appears in the material provided.',
  '- Keep the same language as the material; plain markdown lines inside each section.',
  '- Stay close to the current portrait in length — rewrite, do not grow.',
  '- For every section, attach evidence copied from the material: memory ids (mem_…) or journal:YYYY-MM-DD.',
  '- Never invent an id; use an empty array for a section you cannot back with material.',
  '',
  'Answer with ONLY a JSON object, no prose, no code fence:',
  '{"sections":[{"key":"background","text":"..."},{"key":"preference","text":"..."},{"key":"focus","text":"..."},{"key":"recent","text":"..."}],' +
    '"evidence":{"background":["mem_...","journal:2026-10-18"],"preference":[],"focus":[],"recent":[]}}',
].join('\n');

/** 把画像段落渲染成提示词里的「现状」部分。 */
export function renderProfileSections(sections, scope = 'workspace') {
  const body = normalizeSections(sections, { scope })
    .filter((s) => s.text)
    .map((s) => `**${s.title}**\n${s.text}`)
    .join('\n\n');
  return body || '(empty)';
}

/**
 * 构造「重写式合并」的提示词输入（user 侧文本）。
 * 原料 = 旧画像 + 最近日志 + 记忆条目摘要（标题级）；只允许使用给定材料，不许发明。
 */
export function buildRewriteInput({ scope = 'workspace', oldPortrait = null, journal = [], records = [] } = {}) {
  const defs = sectionsFor(scope);
  const keys = defs.map((s) => s.key);
  const parts = [];
  parts.push(
    [
      `Scope: ${scope}. Rewrite the profile below by MERGING in new material.`,
      `Rules:`,
      `- Keep the four fixed sections (keys: ${keys.join(', ')}); rewrite text WITHIN them, never add new sections.`,
      `- Incorporate durable facts from the journal and memory entries; correct what is outdated; compress redundancy.`,
      `- Never invent facts. Only use what appears in the material provided below.`,
      `- Keep the same language as the material; plain markdown lines inside each section.`,
      `- Attach evidence per section: memory ids exactly as given (id=mem_…), journal entries as journal:YYYY-MM-DD.`,
      `- Never invent an id; use [] when a section has no support in the material.`,
    ].join('\n'),
  );
  parts.push(`Current profile:\n${renderProfileSections(oldPortrait?.sections, scope)}`);
  if (Array.isArray(journal) && journal.length) {
    parts.push(
      `Journal (newest first):\n(cite journal entries as journal:YYYY-MM-DD)\n${journal
        .map((j) => `## ${j.date}\n${String(j.text || '').trim()}`)
        .join('\n\n')
        .slice(0, 6000)}`,
    );
  }
  if (Array.isArray(records) && records.length) {
    parts.push(
      `Memory entries (title — category — updated — id):\n${records
        .slice(0, 60)
        .map((r) => `- ${r.title} [${r.category}] ${String(r.updatedAt || '').slice(0, 10)} id=${r.id || 'mem_?'}`)
        .join('\n')}`,
    );
  }
  parts.push(
    `Answer with ONLY a JSON object: {"sections":[${keys
      .map((k) => `{"key":"${k}","text":"..."}`)
      .join(',')}],"evidence":{${keys.map((k) => `"${k}":[]`).join(',')}}}`,
  );
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ *
 * 画像 2.0：版本 diff
 *
 * 现在画像只有「整篇替换 + 版本快照」，用户看历史版本时只能自己逐字比对。
 * 这里补一层纯函数 diff：按段落做行级 LCS，输出 added / removed，
 * 供面板的「这次变了什么」横幅、版本回滚前的预览、以及以后的证据链使用。
 * ------------------------------------------------------------------ */

function splitSectionLines(text) {
  return String(text == null ? '' : text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 行级 LCS diff；返回按出现顺序的 added / removed。 */
function lineDiff(before, after) {
  const a = splitSectionLines(before);
  const b = splitSectionLines(after);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const removed = [];
  const added = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(a[i]);
      i += 1;
    } else {
      added.push(b[j]);
      j += 1;
    }
  }
  while (i < m) removed.push(a[i++]);
  while (j < n) added.push(b[j++]);
  return { added, removed };
}

/**
 * 对比两份画像段落，返回逐段变化。
 * 返回：{ scope, sections:[{key,title,added,removed,changed}], changed:[...], summary }
 */
export function diffPortraitSections(beforeSections = [], afterSections = [], { scope = 'workspace' } = {}) {
  const before = new Map(normalizeSections(beforeSections, { scope }).map((s) => [s.key, s]));
  const after = new Map(normalizeSections(afterSections, { scope }).map((s) => [s.key, s]));
  const sections = sectionsFor(scope).map((def) => {
    const prev = before.get(def.key)?.text || '';
    const next = after.get(def.key)?.text || '';
    const { added, removed } = lineDiff(prev, next);
    return { key: def.key, title: def.title, added, removed, changed: added.length + removed.length };
  });
  const changed = sections.filter((s) => s.changed > 0);
  const summary = changed.length
    ? changed.map((s) => `${s.title} +${s.added.length} −${s.removed.length}`).join('；')
    : '无变化';
  return { scope, sections, changed, summary };
}

/** 把 diff 渲染成人类可读的 Markdown；默认跳过无变化的段。 */
export function renderPortraitDiff(diff, { includeUnchanged = false } = {}) {
  const scope = diff?.scope === 'global' ? 'global' : 'workspace';
  const list = Array.isArray(diff?.sections) ? diff.sections : [];
  const lines = [`### 画像变化（${scope === 'global' ? '全局' : '工作区'}）`];
  const shown = list.filter((s) => includeUnchanged || s.changed > 0);
  if (!shown.length) {
    lines.push('');
    lines.push('（无变化）');
    return `${lines.join('\n')}\n`;
  }
  for (const section of shown) {
    lines.push('');
    lines.push(`**${section.title}**${section.changed ? `（+${section.added.length} −${section.removed.length}）` : '（无变化）'}`);
    for (const line of section.removed) lines.push(`- ~~${line}~~`);
    for (const line of section.added) lines.push(`+ ${line}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 一行摘要，给面板横幅/日志用；无变化时返回空串，方便 `if (line)`。 */
export function portraitChangeLine(diff) {
  const changed = Array.isArray(diff?.changed) ? diff.changed : [];
  if (!changed.length) return '';
  return changed.map((s) => `${s.title} +${s.added.length} −${s.removed.length}`).join('；');
}

/** 解析模型输出的重写结果 → { ok: true, sections } 或 { ok: false, error }。 */
export function parseRewriteResponse(text, { scope = 'workspace' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidates = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(raw);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  let parsed = null;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') {
        parsed = value;
        break;
      }
    } catch {
      /* 尝试下一个候选 */
    }
  }
  if (!parsed) return { ok: false, error: 'no_json' };
  const list = Array.isArray(parsed.sections) ? parsed.sections : null;
  if (!list) return { ok: false, error: 'no_sections' };
  const sections = normalizeSections(list, { scope });
  if (!sections.some((s) => s.text)) return { ok: false, error: 'empty_sections' };
  const evidence = normalizePortraitEvidence(parsed.evidence, { scope });
  return { ok: true, sections, evidence, sectionMeta: portraitSectionMeta(evidence, { scope }) };
}

export default {
  PORTRAIT_SECTIONS,
  PORTRAIT_HISTORY_LIMIT,
  REWRITE_SYSTEM,
  sectionsFor,
  normalizeSections,
  normalizePortraitEvidence,
  portraitSectionMeta,
  parsePortraitMarkdown,
  renderPortraitMarkdown,
  clampPortraitToBudget,
  renderPortraitInjection,
  renderProfileSections,
  buildRewriteInput,
  parseRewriteResponse,
  diffPortraitSections,
  renderPortraitDiff,
  portraitChangeLine,
};
