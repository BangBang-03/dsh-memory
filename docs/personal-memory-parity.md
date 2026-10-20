# 个人使用版记忆对齐与画像 2.0

- 日期：2026-10-19
- 前提：主要使用者是你自己，单机、本地优先、零外部服务；不追团队/多租户/平台化。
- 配套：`docs/market-scan-2026-10.md`（市场与优先级）、`docs/dsh-memory-landscape-2026-10.md`（DSH 263 个插件拆解）
- 已落地（个人版对齐完成）：BM25F 检索 + 短语 + related 一跳 + 同义词查询扩展 + 20×10 冒烟与 60 条硬评测（自测 Recall@5 1.000 / MRR@10 0.930）、画像版本 diff（逻辑 + API + 面板）、写入安全第一层（脱敏 / 隔离 / trust，可配置，面板徽标）、Dream v0、路径 JIT、会话索引与溯源（`sessions` 动作 + `GET /sessions`）、外部导入（Claude Code / Codex / Windsurf，来源打标签）、程序记忆晋升（`promote` 动作 + `POST /promote` + 面板按钮，AGENTS.md 托管块幂等）、压缩协同（compaction 摘要照录日志）、注入成本可见化（pathTail 计量进 KPI）、画像证据链（每段挂参考、缺证据标未溯源）、注入审计（每次进 prompt 的字节 + hash + 取舍）；**跨层派生链**（记忆 → 画像 → AGENTS.md 每层留源 id/版本，源失效反向标脏、沿链向上传递）与**可执行校验**（`falsifier` 字段 + 到期复审队列）也已落地；14 个套件 / 493 条断言全绿。

---

## 0. 结论

1. **个人使用不需要对齐「平台能力」，需要对齐「三类体验」**：找得到（检索）、记得干净（巩固/衰减）、用得安全（写入扫描/可回滚）。
2. **画像 2.0 不是加分类，而是加三样东西**：每句有证据、每次有 diff、每段有新鲜度。再加一个「首次使用就能生成画像」的引导。
3. **记忆主干下一批按顺序做**：写入安全 → dream 巩固 → 路径 JIT → 会话检索 → 导入扩展 → 程序记忆晋升 → 压缩协同 → 注入成本。
4. **向量库/知识图谱先不做**。当前 BM25F + 短语 + related 一跳已经覆盖大部分个人场景；等评测证明词法到顶，再考虑可选 embedding。

---

## 1. 对齐谁、不对齐谁

| 类别 | 对齐对象 | 个人版要不要 | 理由 |
| --- | --- | --- | --- |
| 词法检索 | memoir / prime / meow / annkun | **要** | 记忆一多，词重叠排序会明显退化 |
| 巩固/做梦 | meow / mneme / prime | **要** | 个人使用也会积累重复与过期，手动整理不可持续 |
| 写入安全 | annkun / memento / auto-memory | **要** | 网页/工具输出可能把密钥或指令写进记忆 |
| 路径 JIT | annkun / Gemini CLI | **要** | 打开某个文件时，相关约定应该自己出现 |
| 会话检索 | deja-vu / native-memory | **要** | 「上次那个方案」比「记一条新记忆」更常用 |
| 外部导入 | auto-memory / deja-vu | **要** | 你已经在用 WorkBuddy / Qoder / Claude Code / Codex |
| 程序记忆 | auto-memory / Codex Skills | **要** | 约定只有变成规则/技能，才会每次生效 |
| 压缩协同 | auto-memory / billion-context | **要** | 长会话压缩前不抢救，决策会丢 |
| 注入成本 | prime / dsh-context / dsh-cost-meter | **要** | 你关心缓存命中与 token 成本 |
| 向量召回 | prime / mneme | 可选 | 先看词法评测；不够再加，默认关闭 |
| 知识图谱 | StrataGate / mneme | 可选 | 个人记忆量级下，related 一跳通常够 |
| 平台/Provider | mnemon | 不要 | 复杂度和维护成本远超个人收益 |
| 协议/适配器 | memento | 不要 | 没有外部插件生态诉求 |
| 团队/多租户 | memory-eternal 等 | 不要 | 单机单用户，权限系统是负担 |
| 26 小类 taxonomy | Qoder | 不要 | 9 类 + tags 够用，分类是维护债 |

---

## 2. 个人使用版对齐清单

| 能力 | 头部参照 | 优先级 | 最小实现 | 状态 |
| --- | --- | --- | --- | --- |
| BM25F + 字段权重 + IDF | memoir / prime | P0 | `lib/retrieval.js`，标题 3.2×、标签/关键词 2.4×、文件 1.8×、正文 1× | 已落地 |
| 精确短语 / 路径 / 代码标识符 | memoir | P0 | `exactPhraseBoost`：标题 1.0、标签 0.8、路径 0.7、正文 0.5 | 已落地 |
| related 一跳扩展 | StrataGate / mneme | P0 | `relatedBoostMap`：正向 + 反向，归一后 6 分权重 | 已落地 |
| 检索评测基线 | prime（DSH-MemBench） | P0 | 20 条记忆 × 10 条查询冒烟 + 54 条记忆 × 60 条查询硬评测（同义 / 路径 / 近邻 / 多跳 / 否定 / 标签），Recall@5 / MRR | 已落地（1.000 / 0.930） |
| 画像版本 diff | memento / Letta | P0 | 行级 LCS；`+`/`−` 渲染；一行摘要；`GET /portrait/diff` | 已落地（纯逻辑 + API + 面板入口） |
| 写入密钥扫描 + trust | annkun / memento / auto-memory | P0 | 10 类密钥模式脱敏 + 10 类注入模式 + trust 五级；非 user 来源 taint 自动进草稿；`redactSecrets` / `quarantineTainted` 设置可关；面板 `可疑` / `已脱敏` / `外部来源` 徽标 | 已落地（第一层） |
| dream / 半自动巩固 | meow / mneme / prime | P1 | `POST /dream` + 维护页「整理一次」：合并重复簇（可恢复）、报告过期、画像重写进待审；只手动触发，无后台任务 | 已落地（v0） |
| 路径 JIT | annkun / Gemini | P1 | `tools/pre-execute` 只观察收集路径，下一个 pre-step 尾部注入；`memory save` 新增 `files` | 已落地 |
| 会话检索 / 溯源 | deja-vu / native-memory | P1 | 每轮用户发言原文落 `sessions.jsonl`（上限 2000 行）；`memory sessions` / `GET /sessions` 返回原话 + turn | 已落地（v0） |
| 外部记忆导入 | auto-memory / deja-vu | P1 | 扫描 + 导入 Claude Code / Codex / Windsurf；按来源自动打 `claude` / `codex` / `windsurf` 标签 | 已落地 |
| 程序记忆晋升 | auto-memory / Codex | P1 | `memory promote` / `POST /promote` / 面板按钮 → 工作区 AGENTS.md 托管块（幂等，global 拒绝） | 已落地 |
| 压缩协同 | auto-memory / billion-context | P1 | 监听 `compaction/summary` / `compaction/prune`，摘要照录进当天工作日志（`compactionSalvage` 可关） | 已落地（v0） |
| 注入可见化 / 成本 | prime / dsh-context / cost-meter | P1 | 简报 KPI 显示最近路径注入条数与 token 粗估；`/state` 带 `pathTail` 计量 | 已落地（v0） |
| 画像证据链 | prime L3 / memento | P0 | 重写时要求每段挂 `mem_…` / `journal:YYYY-MM-DD`；落库 `evidence` + `sectionMeta`；手工改动段自动清空证据 | 已落地 |
| 注入审计 | 无直接同类（自提护城河） | P0 | 每次进 prompt 记正文 + sha256 前 16 位 + id 列表 + 被预算挤掉的条目；`GET /injections` + 维护页卡片 | 已落地 |
| 跨层派生链 | Veyra（只做 code→memory）/ akasha（修订链 + 复审留痕） | P0 | `lib/derivation.js` 纯函数 + `derivations.json`：每层记下源 id 与内容指纹；源被删 / 归档 / 取代 / 改写时该层标脏，并沿链向上传递；`GET /derivations` + 维护页卡片 + 体检 `derivations` | 已落地 |
| 可执行校验（falsifier + 到期复审） | akasha-book（trust×age 复审到期） | P0 | 记忆带 `falsifier`（含正文「失效条件：…」提取）+ `reviewAt`；默认 90 天 TTL（`falsifierReviewDays` 可调）；到期进复审队列，`GET /reviews` / `POST /review` / `action=review` + 维护页卡片 + 体检 `reviewDue` | 已落地 |
| 向量召回 | prime / mneme | P2 | 可选本地 embedding，默认关闭 | 不做（暂缓） |
| 知识图谱 | StrataGate / mneme | P2 | 实体/关系；先看 related 一跳是否够 | 不做（暂缓） |

---

## 3. 画像 2.0：从「一段文字」到「可解释的现状」

### 3.1 现状与缺口

现在画像有：

- 固定四段：工作背景 / 协作约定（全局版「个人背景」）/ 当前关注 / 近期动态；
- 版本 +1、旧版快照、待审重写稿、工作区与全局两份注入；
- 面板可编辑、可重写、可批准草稿。

缺口：

| 缺口 | 用户会怎么感知 |
| --- | --- |
| 没有证据链 | 「这句话是哪来的？是不是它编的？」 |
| 没有 diff | 版本历史只有 v1/v2/v3，不知道改了什么 |
| 没有新鲜度 | 三个月前的「当前关注」和今天的看起来一样可信 |
| 没有首次引导 | 新工作区画像是空的，要先点「重写」才有内容 |
| 没有「现在 vs 过去」 | 看不出自己的关注/约定在漂移 |

### 3.2 数据模型（向后兼容）

保留现有 `sections`（注入与 Markdown 正本不变），新增可选字段：

```json
{
  "version": 3,
  "sections": [
    { "key": "background", "title": "工作背景", "text": "..." }
  ],
  "evidence": {
    "background": ["mem_ab12", "journal:2026-10-18"],
    "preference": ["mem_cd34"],
    "focus": ["mem_ef56", "journal:2026-10-19"],
    "recent": ["journal:2026-10-19"]
  },
  "sectionMeta": {
    "background": { "updatedAt": "2026-10-10T...", "evidenceCount": 2, "stale": false },
    "focus": { "updatedAt": "2026-09-01T...", "evidenceCount": 1, "stale": true }
  },
  "change": { "from": 2, "added": 2, "removed": 1, "summary": "协作约定 +2 −1" }
}
```

- `evidence` 的 id 可以是记忆 id，也可以是 `journal:YYYY-MM-DD`。
- `sectionMeta` 由工程侧计算：最后证据时间、证据数、是否超过 `staleDays`。
- `change` 在保存新版本时写入历史快照；当前版也可以带，方便横幅直接读。
- 旧数据没有这些字段时，一律按「无证据 / 未知新鲜度」处理，不阻塞读取。

### 3.3 四个新能力

#### 能力 1：证据链（已落地）

- 重写提示词要求模型在每段末尾附 `参考: mem_x, journal:2026-10-18`，工程侧解析成 `evidence`。
- 面板每条画像句子下面显示小 chip：`#mem_x`、`10-18 日志`；点开跳到对应记忆/日志。
- 没有证据的句子标 `未溯源`，不阻止注入，但在面板里可见——让「画像是否可信」变成可检查的。

#### 能力 2：版本 diff

- 已落地 `diffPortraitSections` / `renderPortraitDiff` / `portraitChangeLine` 与 `GET /portrait/diff`。
- 面板加一个「这次变了什么」按钮：默认 `from=previous`，展开显示 `+`/`−` 行与逐段计数。
- 回滚前先看 diff：知道会失去什么，再点回滚。
- 历史版本列表的每一项显示 `v3 · +2 −1`，而不是只有版本号。

#### 能力 3：新鲜度

- 每段计算 `lastEvidenceAt`；超过 `staleDays`（默认 60）标「可能过期」。
- 注入时在画像尾部加一行：`画像更新于 3 天前；当前关注 12 天未更新。`——只一行，不破坏缓存（会话冻结）。
- 体检新增「画像过期段」：列出过期段与最后证据，建议重写。
- 新鲜度不是删除依据；它只是让模型和人都知道「这条可能旧了」。

#### 能力 4：首次引导

- 新工作区画像为空时，面板显示 5 个问题：你的角色 / 这个项目是什么 / 技术栈 / 协作偏好 / 当前关注。
- 回答后生成一份 `portrait.draft`，走现有待审队列；批准后落库。
- 这样新用户第一次打开就有画像，不用先理解「重写画像」是什么。

#### 能力 5：Now / Then

- 选两个版本（默认当前 vs 30 天前），生成「关注漂移」摘要：新增了什么、消失了什么。
- 只读，不落库；可以一键把「漂移」写成一条 `decision` 或 `feedback` 记忆。
- 这对个人使用很有价值：你能看到自己最近在追什么、放弃了什么。

#### 能力 6：矛盾检查

- 新记忆保存时，与画像段落做一次轻量比对（共享关键词 + 否定/反义线索）；命中则提示「可能与画像冲突」。
- 不自动改画像；进入重写草稿或待审队列，由你决定。
- 与现有 `supersedes` 版本链配合：条目层用版本链，画像层用重写 + diff。

### 3.4 注入策略：画像优先，但不膨胀

- `briefMode: portrait` 保持：画像进系统提示，条目索引让位。
- 画像注入只放「当前画像 + 一行新鲜度」，不放证据链（证据给面板看，不给模型看，省 token）。
- 画像仍然会话级冻结；重写后下一次请求重算一次，然后重新冻结——保持前缀缓存友好。
- 如果画像超过预算，优先保留「当前关注」与「协作约定」，压缩「工作背景」与「近期动态」；页脚明说截断。

### 3.5 面板形态

```
画像  v3 · 更新于 3 天前        [这次变了什么] [重写] [编辑]
────────────────────────────────────────────
工作背景
  独立开发者，兼职量化交易；DSH 插件维护者。   #mem_ab12  #10-18 日志
协作约定
  发版前先跑测试；中文回答；表格优先。         #mem_cd34
当前关注
  记忆插件对齐；画像 2.0；1h 策略迁移。        #mem_ef56  ⚠ 12 天未更新
近期动态
  完成 BM25F 与画像 diff；下一步写入安全。      #10-19 日志
────────────────────────────────────────────
[展开证据] [查看 v2 → v3 变化]
```

---

## 4. 记忆主干：下一批实现顺序

| 顺序 | 项目 | 为什么在这个位置 | 验收 |
| --- | --- | --- | --- |
| 1 | ~~写入安全 + trust~~ | **已落地**（密钥脱敏 + 注入隔离 + trust 五级；`redactSecrets` / `quarantineTainted` 可关；面板徽标） | 100 条密钥 0 泄漏；20 条注入全隔离；20 条正常文本零误报 |
| 2 | ~~dream / 半自动巩固~~ | **已落地 v0**（`POST /dream` + 维护页按钮；合并重复簇可恢复、过期只报告、画像进待审） | 重复簇合并后条数 -1；报告含过期数；画像 drafted |
| 3 | ~~路径 JIT~~ | **已落地**（`tools/pre-execute` 观察 + pre-step 尾部注入；`pathRecall` / `pathRecallLimit` 可关） | 打开 `lib/store.js` 能召回挂靠约定；系统提示字节不变；同一次触达只注入一次 |
| 4 | ~~会话检索~~ | **已落地 v0**（`sessions` 动作 + `GET /sessions`；每轮原话落 `sessions.jsonl`） | 原话可搜、带 turn；词重叠零成本 |
| 5 | ~~外部导入~~ | **已落地**（Claude Code / Codex / Windsurf 扫描 + 导入 + 来源标签） | 扫描只读；导入后来源可辨 |
| 6 | ~~程序记忆晋升~~ | **已落地**（`promote` 动作 / API / 面板按钮 → AGENTS.md 托管块，幂等） | 晋升后 AGENTS.md 可见；重复不重复；global 拒绝 |
| 7 | ~~压缩协同~~ | **已落地 v0**（compaction 摘要照录日志；`compactionSalvage` 可关） | 压缩后日志有摘要；零模型调用 |
| 8 | ~~注入可见化 / 成本~~ | **已落地 v0**（pathTail 计量进 `/state` 与维护页 KPI） | KPI 能看到路径注入条数与 token 粗估 |

---

## 5. 验收指标

| 指标 | 现在 | 目标 |
| --- | --- | --- |
| 检索 Recall@5 | 20×10 冒烟 1.00（fixture 偏易） | 扩到 60 条含同义改写/路径/否定查询，≥ 0.90 |
| 检索 MRR@10 | 冒烟 1.00 | ≥ 0.75 |
| 画像证据覆盖 | 0%（还没有 evidence 字段） | ≥ 80% 句子有 refs；无证据句标「未溯源」 |
| 画像首次可用 | 空画像，需要手动重写 | 5 问引导后 3 轮内可用 |
| 记忆卫生 | 体检手动 | 重复率 < 5%；过期段可见；dream 前后有 diff |
| 注入成本 | 简报 ≤ 2,000 字符 | 画像 + 简报 ≤ 当前 +10% |

---

## 6. 已落地的代码

| 文件 | 改动 |
| --- | --- |
| `lib/text.js` | 从 `store.js` 抽出 `tokenize` / `uniqueTokens` / `similarity`，供检索层复用；`store.js` 继续 re-export |
| `lib/retrieval.js` | BM25F（字段权重 + IDF + 长度归一）、`exactPhraseBoost`、`relatedBoostMap` |
| `lib/store.js` | `rankRecords` / `list({query})` 接入 BM25F；置顶/类别/使用/衰减/质量策略不变；简报稳定路径不变 |
| `lib/portrait.js` | `diffPortraitSections`、`renderPortraitDiff`、`portraitChangeLine` |
| `lib/store.js` | `portraitVersion(root, version)` 读取任意历史版本 |
| `lib/api.js` | `GET /portrait/diff`（`from=previous` 默认，返回逐段 diff + 摘要）；`POST /security/scan`（只报告不落库） |
| `lib/security.js` | 密钥扫描与脱敏（10 类模式）、注入检测（10 类模式）、trust 五级分级 |
| `lib/client.js` | 画像卡「这次变了什么」入口；维护页 Dream 卡（整理一次 + 报告）；记录卡 / 时间线的写入安全徽标（`可疑` / `已脱敏` / `外部来源`） |
| `lib/index.js` | Config 新增 `redactSecrets` / `quarantineTainted` / `pathRecall` / `pathRecallLimit`（getter 接入 store.security）；`tools/pre-execute` 收集文件触达；`injectPathRecall` 在 pre-step 尾部注入（锚点排在轮末召回之后）；`memory save` 支持 `files` |
| `lib/store.js` | `security` 选项（redact / quarantine，支持 getter）；创建路径统一走 `applySecurityGate`；`recallByFiles` 路径召回（全路径 > 后缀 > 同名，excludeIds / limit） |
| `test/retrieval.test.mjs` | 9 项：BM25F、IDF、短语、related、search/list 集成、20×10 评测 |
| `test/security.test.mjs` | 9 项：100 条密钥零泄漏、20 条注入全命中、20 条零误报、trust、store 隔离与批准 |
| `test/portrait.test.mjs` | +4 项：diff 行级、无变化、渲染、全局段标题 |
| `test/api.test.mjs` | +4 项：`/portrait/diff` ×2、`/security/scan` ×2 |
| `test/client.test.mjs` | +1 项：diff 入口调用与渲染 |
| `test/run-all.mjs` | 新增 `retrieval` / `security` 套件；12 个套件 / 419 条断言 |

### 第二批护城河：跨层派生链 + 可执行校验（2026-10-20）

| 文件 | 改动 |
| --- | --- |
| `lib/derivation.js` | 纯函数：内容指纹、稳定派生 id、`memorySource` / `portraitSource`、`evaluateEntry` / `evaluateEntries`（含链式传递）、`derivationSummary` |
| `lib/store.js` | `derivations.json` 读写；`derivationList` / `derivationSummary`（状态实时对账，不靠事件）；`savePortrait` 记画像层派生；`promoteToAgents` 记记忆→AGENTS.md 派生；`promotePortraitToAgents` 记画像→AGENTS.md 派生；`reviewQueue` / `markReviewed`；体检加 `derivations` 与 `reviewDue` |
| `lib/api.js` | `GET /derivations`、`GET /reviews`、`POST /review`；`POST /promote` 支持 `from=portrait` |
| `lib/index.js` | Config 加 `falsifierReviewDays`；工具加 `derivations` / `review` 两个动作、`promote from=portrait`；`memory save/update` 支持 `falsifier` / `reviewAt` |
| `lib/client.js` | 维护页加「派生链」卡与「复审队列」卡；画像卡加「写进 AGENTS.md」按钮；记录卡 / 时间线加复审徽标 |
| `test/derivation.test.mjs` | 14 项：指纹与 id、画像层源失效（归档 / 改写 / 删除）、AGENTS.md 派生失效、画像段改写 → 下游失效、链式传递、幂等、体检暴露；旧数据补排期从今天起算 |
| `test/verification.test.mjs` | 12 项：falsifier 显式 / 提取 / 清除、默认与可配置排期、复审队列、复审推后、体检暴露；旧数据补排期从今天起算 |
| `lib/index.js` | 修正全局画像重写的作用域：`list({workspace:'', includeGlobal:false})` 此前返回 0 条，全局条目一条都进不了提示词；改为 `includeGlobal: scope === 'global'` |
| `test/run-all.mjs` | 新增 `derivation` / `verification` 套件；14 个套件 / 493 条断言 |

### 自查暴露的既有边界（不是这批改出来的，但会影响这两个新层）

| 事实 | 实测方式 | 影响 |
| --- | --- | --- |
| `export` 载荷只含条目，画像与派生链不在内 | 建库 → 写画像 + 晋升 → `export({workspace})` → 导入新库：`portrait()` 返回 null、`derivationList()` 为 0 条 | 换机/重装后画像需重写；整库快照（市场扫描里列的 P2）是这两层的共同前置 |
| 派生链只比对源端 | 手工删掉 AGENTS.md 的晋升行 / 整个文件 → 链上仍 `fresh`；改源条目正文 → 立刻 `dirty:源记忆内容已改` | 「AGENTS.md 那几行还在不在」需要目标端回读比对，未实现 |

跑一遍：

```powershell
node test/run-all.mjs
```

---

## 7. 一句话

**记忆主干对齐「找得到、记得干净、用得安全」；画像 2.0 对齐「有证据、有 diff、有新鲜度」。** 这两件事合起来，才是个人使用版真正需要的「越用越懂你」，而不是「越记越多」。
