/**
 * 跨层派生链：记忆 → 画像 → AGENTS.md。
 *
 * 每一层都是「从别处抄来的」：派生时不只抄内容，还记下它是从哪些源、哪个版本抄来的
 * （sources 快照）。之后每次读派生链，都拿当前库里的真实状态跟快照对账：
 * 源被删、被归档、被取代或被改写，这层派生就标脏——把「证据失效」反向传回派生层，
 * 而不是等人自己发现。
 *
 * 纯函数：不碰磁盘。读写由 store.js 负责。
 */

import crypto from 'node:crypto';

export const DERIVATION_LAYERS = ['portrait', 'agents'];

/** 求值顺序：上游层先算，下游层才拿得到它的状态。 */
const LAYER_ORDER = { portrait: 0, agents: 1 };

/** 内容指纹：sha256 前 16 位。 */
export function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);
}

/** 派生条目的稳定 id：同一条派生路径反复写入只更新同一条记录。 */
export function derivationId(layer, target) {
  return `drv_${fingerprint(`${layer}|${target}`).slice(0, 12)}`;
}

/** 记忆条目作为源：快照它的正文指纹。 */
export function memorySource(record, { section = '' } = {}) {
  return {
    id: String(record?.id || ''),
    kind: 'memory',
    hash: fingerprint(`${record?.title || ''}\n${record?.content || ''}`),
    section: section || '',
    title: String(record?.title || '').slice(0, 80),
  };
}

/**
 * 画像某一段作为源：快照段落正文指纹。
 * 指纹只取正文、不取版本号——画像重写但那段没变，不算失效。
 */
export function portraitSource(sectionKey, portrait) {
  const section = (portrait?.sections || []).find((s) => s.key === sectionKey);
  return {
    id: `portrait:${sectionKey}`,
    kind: 'portrait',
    section: sectionKey,
    hash: fingerprint(section?.text || ''),
    title: String(section?.title || sectionKey),
  };
}

/** 归一化一个源条目：只认两种 kind，其余当无效（对账时直接判失效）。 */
export function normalizeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const kind = source.kind === 'portrait' ? 'portrait' : 'memory';
  return {
    id: String(source.id || ''),
    kind,
    section: String(source.section || ''),
    hash: String(source.hash || ''),
    title: String(source.title || '').slice(0, 80),
  };
}

/**
 * 对账单个派生条目：拿快照跟当前真实状态比。
 * ctx.records 是 id → 记忆条目的 Map（含归档与草稿）；ctx.portrait 是当前画像。
 */
export function evaluateEntry(entry, { records = new Map(), portrait = null, parents = new Map() } = {}) {
  const problems = [];
  for (const source of entry.sources || []) {
    if (source.kind === 'portrait') {
      const section = (portrait?.sections || []).find((s) => s.key === source.section);
      if (!portrait) {
        problems.push({ source: source.id, reason: '上游画像不存在' });
      } else if (!section || !section.text) {
        problems.push({ source: source.id, reason: `画像「${source.title}」段已不存在` });
      } else if (fingerprint(section.text) !== source.hash) {
        problems.push({ source: source.id, reason: `画像「${source.title}」段已改写` });
      }
      continue;
    }
    const record = records.get(source.id);
    if (!record) {
      problems.push({ source: source.id, reason: '源记忆已不存在' });
      continue;
    }
    if (record.archived) {
      problems.push({ source: source.id, reason: '源记忆已归档' });
    } else if (record.supersededBy) {
      problems.push({ source: source.id, reason: `源记忆已被 ${record.supersededBy} 取代` });
    } else if (fingerprint(`${record.title || ''}\n${record.content || ''}`) !== source.hash) {
      problems.push({ source: source.id, reason: '源记忆内容已改' });
    }
  }
  // 上游派生层自身失效时，本层跟着失效：证据失效沿链反向传下去。
  if (entry.parent) {
    const parent = parents.get(entry.parent);
    if (!parent) {
      problems.push({ source: entry.parent, reason: '上游派生层已删除' });
    } else if (parent.state === 'dirty') {
      problems.push({ source: entry.parent, reason: `上游失效：${parent.reason}` });
    }
  }
  return {
    ...entry,
    state: problems.length ? 'dirty' : 'fresh',
    reason: problems.length ? problems[0].reason : null,
    problems,
  };
}

/**
 * 对账全部条目。按层序（画像在前、AGENTS.md 在后）依次求值，
 * 这样下游条目能读到上游条目刚算出来的状态——不依赖条目写入的先后。
 */
export function evaluateEntries(entries = [], ctx = {}) {
  const byId = new Map();
  const out = [];
  const ordered = [...entries].sort(
    (a, b) => (LAYER_ORDER[a.layer] ?? 9) - (LAYER_ORDER[b.layer] ?? 9),
  );
  for (const entry of ordered) {
    const evaluated = evaluateEntry(entry, { ...ctx, parents: byId });
    out.push(evaluated);
    byId.set(entry.id, evaluated);
  }
  return out;
}

/** 汇总：总数、失效数、按层分布。 */
export function derivationSummary(entries = []) {
  const layers = {};
  let dirty = 0;
  for (const entry of entries) {
    layers[entry.layer] = (layers[entry.layer] || 0) + 1;
    if (entry.state === 'dirty') dirty += 1;
  }
  return { total: entries.length, dirty, fresh: entries.length - dirty, layers };
}

export default {
  DERIVATION_LAYERS,
  fingerprint,
  derivationId,
  memorySource,
  portraitSource,
  normalizeSource,
  evaluateEntry,
  evaluateEntries,
  derivationSummary,
};
