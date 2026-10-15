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
        cur = { key, title, lines: [] };
        if (!found.has(key)) found.set(key, cur);
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
  return { scope: resolved, sections };
}

/** 渲染 PORTRAIT.md 正本（人读）；内容与 portrait.json 同源。 */
export function renderPortraitMarkdown(portrait = {}, { scopeLabel = '' } = {}) {
  const scope = portrait.scope === 'global' ? 'global' : 'workspace';
  const sections = normalizeSections(portrait.sections, { scope });
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
  '',
  'Answer with ONLY a JSON object, no prose, no code fence:',
  '{"sections":[{"key":"background","text":"..."},{"key":"preference","text":"..."},{"key":"focus","text":"..."},{"key":"recent","text":"..."}]}',
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
    ].join('\n'),
  );
  parts.push(`Current profile:\n${renderProfileSections(oldPortrait?.sections, scope)}`);
  if (Array.isArray(journal) && journal.length) {
    parts.push(
      `Journal (newest first):\n${journal
        .map((j) => `## ${j.date}\n${String(j.text || '').trim()}`)
        .join('\n\n')
        .slice(0, 6000)}`,
    );
  }
  if (Array.isArray(records) && records.length) {
    parts.push(
      `Memory entries (title — category — updated):\n${records
        .slice(0, 60)
        .map((r) => `- ${r.title} [${r.category}] ${String(r.updatedAt || '').slice(0, 10)}`)
        .join('\n')}`,
    );
  }
  parts.push(
    `Answer with ONLY a JSON object: {"sections":[${keys
      .map((k) => `{"key":"${k}","text":"..."}`)
      .join(',')}]}`,
  );
  return parts.join('\n\n');
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
  return { ok: true, sections };
}

export default {
  PORTRAIT_SECTIONS,
  PORTRAIT_HISTORY_LIMIT,
  REWRITE_SYSTEM,
  sectionsFor,
  normalizeSections,
  parsePortraitMarkdown,
  renderPortraitMarkdown,
  clampPortraitToBudget,
  renderPortraitInjection,
  renderProfileSections,
  buildRewriteInput,
  parseRewriteResponse,
};
