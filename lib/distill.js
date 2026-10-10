/**
 * dsh-memory — 轮次内容 → 长期记忆候选（提炼层）。
 *
 * 纯函数，不依赖 DSH：给定一段对话文本，构造提炼提示词、解析模型返回、
 * 以及判断「这一轮值不值得提炼」。测试见 test/distill.test.mjs。
 */

import { CATEGORIES } from './store.js';

/** 提炼提示词（系统侧）。要求模型只输出 JSON。 */
export const DISTILL_SYSTEM = [
  'You maintain a coding agent\'s long-term memory for ONE workspace.',
  'Read the conversation excerpt and extract only DURABLE knowledge that stays true beyond this session.',
  '',
  'Extract when it is:',
  '- a user preference or working style ("always answer in Chinese", "prefer pnpm over npm")',
  '- a project convention or architecture decision and its reason',
  '- a stable fact about the codebase, environment, tooling or paths',
  '- a reusable gotcha, workaround, or hard-won lesson',
  '- an open commitment or TODO that outlives the session',
  '',
  'Do NOT extract:',
  '- what the agent did in this turn (edits, commands, file reads)',
  '- transient state, one-off debugging output, or anything already resolved',
  '- secrets, tokens, credentials, personal data',
  '- restatements of the conversation itself',
  '',
  'Rules:',
  '- Never invent facts. If the excerpt holds nothing durable, return an empty list.',
  '- One fact per entry. Prefer 0-4 entries; fewer and sharper beats many and vague.',
  '- Write each entry in the SAME language the user used.',
  '- "title" is one short line (<= 60 chars). "content" is the standalone fact with enough',
  '  context that it is still useful months later, without the conversation.',
  `- "category" is exactly one of: ${CATEGORIES.join(', ')}.`,
  '- "confidence" is 0..1: how sure you are this is durable and correct.',
  '',
  'Answer with ONLY a JSON object, no prose, no code fence:',
  '{"memories":[{"title":"...","content":"...","category":"fact","tags":["..."],"confidence":0.8}]}',
].join('\n');

/**
 * 构造用户侧输入。用 JSON 包裹，防止对话里的文字破坏结构分隔符。
 * 已有记忆标题一并给出，要求模型不要重复。
 */
export function buildDistillInput({ workspace = '', transcript = '', existingTitles = [] } = {}) {
  const parts = [];
  parts.push(`Workspace: ${workspace || '(unknown)'}`);
  if (existingTitles.length) {
    parts.push(
      `Already stored (do NOT repeat these, and do not restate them in different words):\n${existingTitles
        .slice(0, 60)
        .map((t) => `- ${t}`)
        .join('\n')}`,
    );
  }
  parts.push(`Conversation excerpt (JSON array of {role, text}):\n${transcript}`);
  parts.push('Return the JSON object now.');
  return parts.join('\n\n');
}

/**
 * 从模型的自由文本里抽出 JSON 对象。
 * 容忍 ```json 围栏、前后解释性文字、以及尾部截断。
 */
export function extractJson(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(raw);

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}

/**
 * 把模型输出解析成记忆候选数组。永远返回数组，绝不抛错。
 * 每条候选都会被裁剪到合理长度；非法类别回落到 note；置信度过低会被丢弃。
 */
export function parseDistillResponse(text, { minConfidence = 0.35, max = 8 } = {}) {
  const parsed = extractJson(text);
  if (!parsed) return [];

  let list = parsed.memories ?? parsed.memory ?? parsed.items ?? parsed;
  if (!Array.isArray(list)) list = [list];

  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const title = String(item.title ?? item.name ?? '').trim();
    const content = String(item.content ?? item.text ?? item.detail ?? '').trim();
    if (!title && !content) continue;

    let confidence = Number(item.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.7;
    confidence = Math.min(1, Math.max(0, confidence));
    if (confidence < minConfidence) continue;

    const category = CATEGORIES.includes(item.category) ? item.category : 'note';
    const tags = Array.isArray(item.tags)
      ? item.tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 6)
      : typeof item.tags === 'string' && item.tags.trim()
        ? [item.tags.trim()]
        : [];

    out.push({
      title: (title || content).slice(0, 160),
      content: (content || title).slice(0, 4000),
      category,
      tags,
      confidence,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 渲染一条派生消息为纯文本；非文本块被忽略。 */
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const chunks = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') chunks.push(block.text);
    else if (block.type === 'tool-call' && block.name) chunks.push(`[tool ${block.name}]`);
    else if (block.type === 'tool-result' || block.type === 'tool_result') chunks.push('[tool result]');
  }
  return chunks.join('\n');
}

/**
 * 取派生消息尾部的对话内容，渲染成 `{role, text}` 的 JSON。
 * 预算不够时从头部裁剪，保留最近的对话。
 */
export function selectTranscript(messages = [], { maxChars = 6000, maxMessages = 40 } = {}) {
  if (!Array.isArray(messages)) return '[]';
  const normalized = [];
  for (const message of messages) {
    const role = message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = messageText(message).trim();
    if (!text) continue;
    normalized.push({ role, text });
  }

  const tail = normalized.slice(-maxMessages);
  const kept = [];
  let used = 0;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const item = tail[i];
    const cost = item.text.length;
    if (used + cost > maxChars && kept.length > 0) break;
    kept.unshift(item);
    used += cost;
  }
  return JSON.stringify(kept);
}

/**
 * 判断这一轮是否值得花一次模型调用去提炼。
 * 目的：避免在「跑个命令看看」这种琐碎轮次上浪费 token。
 */
export function shouldDistill(messages = [], { minChars = 600, minUserChars = 40 } = {}) {
  if (!Array.isArray(messages)) return { distill: false, total: 0, userChars: 0 };
  let total = 0;
  let userChars = 0;
  for (const message of messages) {
    const text = messageText(message).trim();
    if (!text) continue;
    total += text.length;
    if (message?.role === 'user') userChars += text.length;
  }
  return { distill: total >= minChars && userChars >= minUserChars, total, userChars };
}

/** 从对话文本里粗提「可能是长期事实」的显式信号词，用于给 UI 提示。 */
export const EXPLICIT_HINTS = [
  '记住',
  '牢记',
  '以后都',
  '以后请',
  '从现在起',
  '不要再',
  '总是',
  '永远',
  '我的偏好',
  '我们的约定',
  'remember',
  'always',
  'never',
  'from now on',
  'keep in mind',
  "don't forget",
];

export function hasExplicitHint(text) {
  const lower = String(text == null ? '' : text).toLowerCase();
  return EXPLICIT_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

export default {
  DISTILL_SYSTEM,
  buildDistillInput,
  extractJson,
  parseDistillResponse,
  selectTranscript,
  shouldDistill,
  hasExplicitHint,
};
