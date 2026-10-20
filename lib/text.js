/**
 * dsh-memory — 文本工具（无 DSH 依赖）。
 *
 * 英文按词、中文按「字 + 二元组」切分；相似度用 Jaccard。
 * 这里从 lib/store.js 抽出来，是为了让检索层（lib/retrieval.js）也能复用，
 * 同时 store.js 继续 re-export，老测试与外部引用不需要改。
 */

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

/** 去重后的 token；空值安全。 */
export function uniqueTokens(text) {
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

export default { tokenize, uniqueTokens, similarity };
