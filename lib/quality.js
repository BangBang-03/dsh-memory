/**
 * 记忆质量分（纯函数，零依赖）。
 *
 * 借 `mneme` 的质量分思路：0–100 的确定性打分，只用来做三件事——
 *   1. 自动提炼 / agent 主动写入的低分条目（< 30）直接归档，不进简报；
 *   2. 30–60 分的条目保留，但在排序里降权；
 *   3. 面板与导出里带上扣分理由，人能看懂它为什么被降权。
 *
 * 设计约束：
 *   - 只读 record 的字段，不读时间、不读外部状态（同一份输入永远同一分数）；
 *   - 手工 / 导入的记忆不因低分被归档（见 store 的 AUTO_SOURCES 判断）；
 *   - 置顶条目直接 100 分，不参与淘汰。
 */

/** 归档线 / 降权线。 */
export const QUALITY_THRESHOLDS = { archive: 30, downweight: 60 };

const META_PATTERNS = [
  /本条记忆/,
  /这条记忆/,
  /记住(这|这条|一下)/,
  /(测试|试验)(用|一下)?(的)?记忆/,
  /^(test|testing|asdf|foo|bar|hello world|todo)[\s:：]/i,
  /^\s*(todo|fixme)\s*$/i,
];

/**
 * 占位判定收窄：命中 META_PATTERNS 且整条很短（标题 + 正文合计 ≤ 40 字符）
 * 才算占位。「Test: 新框架迁移约定」这类正常技术记忆开头 + 长正文不该被扣
 * 「meta」分——只有「todo」「本条记忆」这种写完标题就没下文的才是真占位。
 */
const META_PLACEHOLDER_MAX_CHARS = 40;
const isPlaceholder = (title, content) =>
  title.length + content.length <= META_PLACEHOLDER_MAX_CHARS &&
  META_PATTERNS.some((re) => re.test(`${title} ${content}`));

function clampScore(value) {
  if (!Number.isFinite(value)) return 60;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 给一条记忆打分。
 * @param {object} record 记忆记录（title/content/category/tags/keywords/related/files/confidence/seenCount/pinned）
 * @returns {{ score: number, reasons: string[] }} reasons 是稳定的小写短语，便于面板翻译与测试断言。
 */
export function scoreQuality(record = {}) {
  const reasons = [];
  const title = String(record.title || '').trim();
  const content = String(record.content || '').trim();
  const length = content.length;
  const tags = Array.isArray(record.tags) ? record.tags : [];
  const keywords = Array.isArray(record.keywords) ? record.keywords : [];
  const related = Array.isArray(record.related) ? record.related : [];
  const files = Array.isArray(record.files) ? record.files : [];

  if (record.pinned) return { score: 100, reasons: ['pinned'] };

  let score = 60;

  if (length < 8) {
    score -= 40;
    reasons.push('too-short');
  } else if (length < 20) {
    score -= 20;
    reasons.push('short');
  } else if (length >= 120) {
    score += 8;
    reasons.push('substantive');
  }

  if (title.length < 4) {
    score -= 10;
    reasons.push('title-short');
  }

  if (isPlaceholder(title, content)) {
    score -= 35;
    reasons.push('meta');
  }

  if (record.category === 'task' && length < 40) {
    score -= 10;
    reasons.push('task-fragment');
  }
  if (record.category === 'note' && tags.length === 0 && length < 60) {
    score -= 8;
    reasons.push('thin-note');
  }

  if (tags.length) {
    score += Math.min(6, tags.length * 3);
    reasons.push('tagged');
  }
  if (keywords.length) {
    score += Math.min(8, keywords.length * 4);
    reasons.push('keyworded');
  }
  if (related.length) score += 4;
  if (files.length) score += 3;

  const confidence = typeof record.confidence === 'number' ? record.confidence : 0.8;
  score += Math.round((confidence - 0.6) * 30);
  if ((record.seenCount || 0) >= 2) score += 3;

  return { score: clampScore(score), reasons: [...new Set(reasons)] };
}

/**
 * 排序用的质量系数：60 分及以上不惩罚（1.0），60 以下线性下探到 0.6。
 * 与「归档线 30」不冲突：30 分以下的自动记忆根本不会进简报。
 */
export function qualityFactor(quality) {
  if (!Number.isFinite(quality)) return 1;
  const q = Math.max(0, Math.min(100, quality));
  if (q >= QUALITY_THRESHOLDS.downweight) return 1;
  const span = QUALITY_THRESHOLDS.downweight - QUALITY_THRESHOLDS.archive;
  const t = Math.max(0, q - QUALITY_THRESHOLDS.archive) / span;
  return 0.6 + 0.4 * t;
}
