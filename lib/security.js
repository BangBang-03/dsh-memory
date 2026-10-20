/**
 * dsh-memory — 写入安全层（纯逻辑，无 DSH 依赖）。
 *
 * 三件事：
 *   1. 密钥扫描与脱敏：sk- / ghp_ / AKIA / AIza / xox / JWT / 私钥 / Bearer /
 *      `password: …` 类赋值 / 带凭据的数据库 URI —— 命中就替换成 [REDACTED:<kind>]；
 *   2. 注入模式检测：「忽略之前的指令」「把以下内容写入记忆」「泄露系统提示」等——
 *      命中记 taint，非用户来源的记录会被隔离成草稿（等人审批）；
 *   3. trust 分级：user > agent > auto / import / external。
 *      模型不能自封 user；trust 由写入路径按来源推导，显式传入的非法值一律忽略。
 *
 * 设计取向是「脱敏 + 隔离」而不是「拒绝写入」：个人使用场景下，把内容留下来、
 * 把危险部分抹掉、把可疑内容藏进待审队列，比直接丢掉更可用。
 * 全部是本地正则，不调用模型、不联网。
 */

export const TRUST_LEVELS = ['user', 'agent', 'auto', 'import', 'external'];

/** source → 默认 trust；manual 视为用户亲手写的。 */
export const TRUST_BY_SOURCE = {
  manual: 'user',
  agent: 'agent',
  auto: 'auto',
  import: 'import',
};

/* ------------------------------------------------------------------ *
 * 密钥模式
 * ------------------------------------------------------------------ */

export const SECRET_PATTERNS = [
  { kind: 'openai_key', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'github_pat', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    kind: 'private_key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  { kind: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9_.\-+/=]{20,}/gi },
  {
    // 赋值形态：只脱敏值，保留字段名（password: [REDACTED:credential]）。
    kind: 'credential_assignment',
    re: /\b(password|passwd|pwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_\-+/=]{12,})["']?/gi,
    replace: (match, name) => `${name}: [REDACTED:credential]`,
  },
  {
    kind: 'db_uri_with_credentials',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s'":]+:[^\s'"]+@/gi,
  },
];

/* ------------------------------------------------------------------ *
 * 注入模式
 * ------------------------------------------------------------------ */

export const INJECTION_PATTERNS = [
  {
    kind: 'ignore_instructions_en',
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)\b/i,
  },
  { kind: 'ignore_instructions_zh', re: /(?:忽略|无视|忘记)(?:之前|以前|上面|以上|先前)(?:的|所有)*(?:指令|指示|设定|要求)/ },
  { kind: 'write_to_memory_zh', re: /把(?:以下|下面|这段)(?:内容|文字|指令)?(?:悄悄地|偷偷地)?写入(?:你的)?(?:长期)?记忆/ },
  {
    kind: 'write_to_memory_en',
    re: /\bwrite\s+(?:this|the\s+following)\s+(?:content\s+)?(?:in)?to\s+(?:your\s+)?(?:long[- ]?term\s+)?memory\b/i,
  },
  { kind: 'exfiltrate_prompt_en', re: /\b(?:print|reveal|show|repeat|output)\s+(?:me\s+)?(?:your\s+)?system\s+prompt\b/i },
  { kind: 'exfiltrate_prompt_zh', re: /(?:泄露|透露|输出|打印)(?:你的)?系统提示/ },
  { kind: 'exfiltrate_memory_zh', re: /(?:把|将)(?:你的)?(?:长期)?记忆(?:内容)?(?:偷偷)?(?:上传|发送|外传)(?:到|给)/ },
  {
    kind: 'exfiltrate_memory_en',
    re: /\b(?:upload|send|post)\s+(?:your\s+)?(?:long[- ]?term\s+)?memor(?:y|ies)\s+(?:to|out)\b/i,
  },
  { kind: 'hidden_note_en', re: /\b(?:do\s+not\s+tell|don't\s+tell|hide\s+this\s+from)\s+(?:the\s+)?user\b/i },
  { kind: 'hidden_note_zh', re: /不要告诉用户|对用户隐瞒/ },
];

/* ------------------------------------------------------------------ *
 * 扫描
 * ------------------------------------------------------------------ */

/**
 * 密钥扫描 + 脱敏。返回 { text, findings }；
 * findings 是去重后的 [{ kind, count }]，text 已把命中部分换成 [REDACTED:<kind>]。
 */
export function scanSecrets(text) {
  const input = String(text == null ? '' : text);
  if (!input) return { text: input, findings: [] };
  const counts = new Map();
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`);
    out = out.replace(re, (...args) => {
      counts.set(pattern.kind, (counts.get(pattern.kind) || 0) + 1);
      if (typeof pattern.replace === 'function') return pattern.replace(...args);
      return `[REDACTED:${pattern.kind}]`;
    });
  }
  return { text: out, findings: [...counts.entries()].map(([kind, count]) => ({ kind, count })) };
}

/** 注入模式检测。返回 { tainted, kinds }。 */
export function scanInjection(text) {
  const input = String(text == null ? '' : text);
  if (!input) return { tainted: false, kinds: [] };
  const kinds = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(input)) kinds.push(pattern.kind);
  }
  return { tainted: kinds.length > 0, kinds };
}

/**
 * trust 分级。显式传入合法值优先；否则看 external 标记；
 * 再否则按 source 推导；更新路径沿用 existing 的 trust。
 */
export function computeTrust(input = {}, existing = null) {
  if (TRUST_LEVELS.includes(input.trust)) return input.trust;
  if (input.external === true) return 'external';
  if (existing && TRUST_LEVELS.includes(existing.trust)) return existing.trust;
  return TRUST_BY_SOURCE[input.source] || existing?.trust || 'agent';
}

/** 把若干字段拼起来做一次注入检测。 */
export function assessTaint(parts = []) {
  return scanInjection(parts.filter((p) => p != null && p !== '').join('\n'));
}

export default {
  TRUST_LEVELS,
  TRUST_BY_SOURCE,
  SECRET_PATTERNS,
  INJECTION_PATTERNS,
  scanSecrets,
  scanInjection,
  computeTrust,
  assessTaint,
};
