# 头部 LLM Agent 记忆系统增量扫描（2026-10-24）

> 这是 `docs/competitive-delta-2026-10-20.md` 的增量。上一次扫的是 **DSH 生态内**的头部插件；这一轮把视野扩到
> **通用 LLM Agent 记忆系统**（mem0 / Letta / Zep / LangMem / Cognee / Claude Code / ChatGPT / Cursor / Gemini /
> kernel-memory / MIRIX / MCP 生态），机制层面对比取长补短。框架与结论不重复前几份，读它们。
> 数据口径：全部来自公开网页（官方博客 / GitHub / 文档 / HN / 对比站），厂商自测分数均标注「厂商口径」，未独立复现。

---

## 0. 一页结论

1. **「记忆污染」是 2026 下半年社群的头号痛点，而头部平台普遍没有解药。** HN「Agent memory as a file format」
   （2026-09）的共识：一行被污染的记忆会污染下游一切、错误信念（"heresies"）长期驻留、人工修剪不可或缺。
   mem0 自己在 2026-10-10 的《State of AI Agent Memory 2026》里承认「高频高相关记忆会 confidently wrong，
   衰减机制不足以解决」。**我们的 `falsifier` + 到期复审 + taint 隔离正是针对这个问题的，头部平台基本没有。**
2. **OpenAI 用 "Dreaming"（2026-06）验证了后台巩固的方向，也示范了透明度的反面**：记忆不完全可见、删聊天不删记忆、
   不进数据导出，用户直接开骂。我们的注入审计 + `/briefing-preview` 事前预览正好是对照优势。
3. **Cursor 在 v2.1（2025-11）移除了原生 Memories**，生态转向 Rules + AGENTS.md + MCP 记忆服务——
   「带审批的记忆写入」在 IDE 生态反而变稀缺了。我们的草稿四不可见 + 审批队列是差异点。
4. **GitHub trending 的新头部是「压缩管线派」**：claude-mem（~96k stars，hook 捕获 → 10:1~100:1 语义压缩 →
   SQLite-vec → 索引式检索）与 agentmemory（29.8k stars，四层记忆 + BM25/向量/图 RRF + Ebbinghaus 衰减 +
   审计溯源）。后者的机制覆盖面是本轮对手里最全的，多项与我们重合。
5. **13 个 memory MCP server 的对比里，没有一个有写入审批或 prompt-injection 扫描**（来源：mnemoverse 对比表，
   单一来源）；agentmemory 有「存储前剥密钥」但没有 taint 隔离 / trust 分级 / 审批。**写入安全三件套仍是我们的独有带**。

一句话：**通用平台在拼「记得多、找得快」（多路检索 + RRF + 重排），社群在骂「记错了没法管」——
治理与可信度这一格，头部通用玩家还是空的，与 10-20 在 DSH 生态内看到的「竞争焦点转向控制权」互相印证。**

---

## 1. 扫描范围与方法

- 日期：2026-10-24（快照日）。搜索窗口覆盖 2025-11 ~ 2026-10，重点是 2026 年的动作。
- 方法：WebSearch 广撒网（每家至少一轮「产品名 + 2026 + 机制」），命中后 WebFetch 官方博客 / GitHub / 文档取细节；
  被拦的站（coddykit 403、Anthropic platform docs 区域拦截、Reddit ECONNRESET）改用搜索摘要或替代源，**来源类型如实标注**。
- 核心深扫 14 家：mem0、Letta、Zep/Graphiti、LangMem、Cognee、Claude Code（Anthropic）、ChatGPT（OpenAI）、
  Cursor、Gemini CLI（Google）、Microsoft kernel-memory、MIRIX、claude-mem、agentmemory（rohitg00）、Supermemory。
- 对比列表带过 10 家：basic-memory、OpenMemory、mcp-memory-service（doobidoo）、MemPalace、Engram、
  memento-mcp、server-memory（官方参考实现）、Mnemoverse、Memori、Hindsight（Vectorize）。
- 社群信号：HN 两个讨论帖（Agent memory as a file format；Rate Your Agent's Memory——后者无评论内容，弃用）。

### 主要来源清单

| 来源 | 类型 |
| --- | --- |
| https://mem0.ai/blog/state-of-ai-agent-memory-2026 | 官方博客（2026-10-10） |
| https://github.com/mem0ai/mem0 | GitHub |
| https://www.letta.com/blog/towards-agents-that-learn | 官方博客（2026-06-25） |
| https://www.letta.com/blog/sleep-time-compute | 官方博客（2025-04） |
| https://arxiv.org/abs/2501.13956 | Zep 论文 |
| https://github.com/getzep/graphiti | GitHub |
| https://baeseokjae.github.io/posts/zep-ai-agent-memory-review-2026 | 第三方 review（2026-05） |
| https://langchain-ai.github.io/langmem + https://www.langchain.com/blog/langmem-sdk-launch | 官方（2025-02 发布后无大版本） |
| https://www.reddit.com/r/LangChain/comments/1toabbw/ | 社群（fetch 失败，经搜索摘要转述） |
| https://www.cognee.ai/cognee-review-2026-graphrag-knowledge-graphs-and-agent-memory | 官方 review（2026-09-28） |
| https://code.claude.com/docs/en/memory | 官方文档 |
| https://openai.com/index/chatgpt-memory-dreaming | 官方（2026-06-04） |
| https://help.openai.com/en/articles/8590148-memory-in-chatgpt | 官方帮助页 |
| https://cursor.com/docs/rules + https://recallium.ai/cursor | 官方 + 第三方 |
| https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html | 官方文档 |
| https://github.com/microsoft/kernel-memory/releases | GitHub releases |
| https://arxiv.org/html/2507.07957v1 | MIRIX 论文（2025-07） |
| https://github.com/Mirix-AI/MIRIX | GitHub |
| https://docs.claude-mem.ai/architecture/overview | 官方文档 |
| https://github.com/rohitg00/agentmemory | GitHub（29.8k stars，页面口径） |
| https://mnemoverse.com/docs/library/memory-mcp-servers-compared | 第三方对比（单一来源，注意口径） |
| https://news.ycombinator.com/item?id=49508317 | HN 讨论（2026-09） |
| https://hjarni.com/blog/best-mcp-memory-server | 第三方对比（2026-06） |
| https://www.coddykit.com/pages/blog-detail?id=5129957&slug=github-trending-october-2026-from-persistent-agent-memory-to-open-source-capcut- | 403 被拦，仅经搜索摘要转述 |

---

## 2. 头部玩家一页表

| 名字 | 形态 | 最新动态（日期） | 核心机制一句话 |
| --- | --- | --- | --- |
| **mem0** | 托管记忆平台 + 开源库 | 《State of AI Agent Memory 2026》博客（2026-10-10）；OpenMemory 本地路径 2026-07 从 monorepo 移除（mnemoverse 口径，单一来源） | single-pass ADD-only 提取 + 语义/BM25/实体三路融合；「不删除、读时排序」；LoCoMo 92.5 / LongMemEval 94.4（厂商口径） |
| **Letta**（原 MemGPT） | Agent 框架 + 记忆 API | 《Memory Models: Towards Agents That Learn》（2026-06-25）；Letta Code 发布（时间未确认） | memory blocks + sleep-time compute（空闲时后台改写记忆）；主张「记忆将比单个模型更有价值」 |
| **Zep / Graphiti** | 时序知识图谱服务 | 论文持续被引（arXiv 2501.13956）；2026-05 第三方 review | bi-temporal（事件时间 vs 摄取时间）双时间轴；边失效不删除；语义+全文+BM25 混合检索 |
| **LangMem** | LangChain 官方 SDK | 2025-02 SDK 发布后无大版本动作；2026 只有第三方对比与社群复盘 | LLM 驱动的记忆提取/热路径冷路径分治；社群结论「深潜 LangGraph 才值得用」 |
| **Cognee** | 开源记忆平台（Python） | 官方 review（2026-09-28）；$7.5M 种子轮 | ECL（Extract-Contextualize-Load）管线把文档/对话变成知识图谱 + 向量 + 关系三路检索 |
| **Claude Code**（Anthropic） | IDE Agent | auto memory research preview（2026 上半年）；`/doctor prompt-audit`、path-scoped rules、AGENTS.md 默认支持 | CLAUDE.md 静态规则 + auto memory（MEMORY.md，四类型 frontmatter）双轨；索引超限返回显式错误 |
| **ChatGPT**（OpenAI） | 消费级助手 | "Dreaming" 记忆巩固（2026-06-04，默认开启，有争议） | saved memories + reference chat history 双轨；后台「做梦」式巩固；不可见部分引发透明度批评 |
| **Cursor** | IDE | **v2.1（2025-11）移除原生 Memories**；2026-10 现状 = Rules + AGENTS.md + Projects beta | 记忆职能让位给版本化规则文件与 MCP 生态；「Rules 而非 Memories」路线 |
| **Gemini CLI**（Google） | CLI Agent | `/memory show/refresh`、SaveMemory 工具（2026-03 文档） | 分层 GEMINI.md + SaveMemory 持久事实工具 + `/compress` 管 1M 窗口 |
| **kernel-memory**（Microsoft） | .NET RAG 框架 | **无 2026 release**，最新 0.98.250508.3（2025-05）——项目低活动 | RAG 管线为主，非交互记忆；本口径下来自 GitHub releases 页 |
| **MIRIX** | 开源多 agent 记忆系统 | 论文 2025-07；repo 活跃（搜索当日仍在更新） | 六种记忆类型（Core/Episodic/Semantic/Procedural/Resource/Knowledge Vault）各由专职 agent 管理，主动+被动检索 |
| **claude-mem** | Claude Code 插件 | GitHub trending 2026-10 常客，~96k stars（coddykit 摘要口径） | 5 阶段 hook 捕获工具观察 → 语义压缩（10:1~100:1）→ SQLite+sqlite-vec → 4 个 MCP 工具索引式检索 |
| **agentmemory**（rohitg00） | 本地记忆服务器 | 29.8k stars，支持 20+ agent（GitHub 页面口径） | 四层记忆（Working→Episodic→Semantic→Procedural）+ BM25/向量/图 RRF(k=60) + Ebbinghaus 衰减 + 审计溯源（memory_verify） |
| **Supermemory** | 托管 MCP 记忆 | 2026-06 对比文收录 | 自动抽取事实 + 构建用户画像 + **矛盾解决** + 选择性遗忘；按 project 头隔离 |

---

## 3. 逐项机制对比（八维度）

### 3.1 数据完整性：损坏容错、备份/恢复、迁移

| 对方怎么做 | 来源 |
| --- | --- |
| claude-mem：SQLite（bun:sqlite）+ sqlite-vec 向量列，单文件库 | https://docs.claude-mem.ai/architecture/database |
| memoryfield（HN 帖主提案）：markdown 进 git，SQLite 向量索引 gitignore 掉、**当可重建缓存**——索引坏了重建即可，真相源只有文本 | https://news.ycombinator.com/item?id=49508317 |
| Engram：单 Go 二进制 + SQLite FTS5，git 同步 | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| basic-memory：Markdown 文件为唯一真相源，兼容 Obsidian | 同上 |
| mem0：生产建议含异步写入默认开、结构化异常 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |

**我们现状**：原子写（tmp+rename，EPERM 退避 6 次重试）、`backups/` 整库快照轮转 7 份（每天首写 + Dream 前）、
导入/导出、旧键自动迁移。MEMORY.md 镜像是人读旁车。

**差距/优势**：方向一致甚至更细（竞品极少明确写「备份轮转策略」）。真差距是已知边界——`/export` 载荷不含画像/
派生链/日志/注入审计，换机恢复不完整。memoryfield 的「索引是可重建缓存」哲学我们天然满足（MEMORY.md 可从
memories.json 重生）。

**值不值得抄**：把 export 载荷补全（或提供「一键整库导出 tar」）值得，中成本。见 §4-E。

### 3.2 信任与审批：写入来源分级、草稿队列、防注入

| 对方怎么做 | 来源 |
| --- | --- |
| Claude Code：auto memory 的外部 symlink 导入需**按项目一次性批准**；网络路径 symlink 不跟随 | https://code.claude.com/docs/en/memory |
| Cursor（历史）：后台生成 Memories 需批准——但原生 Memories 已于 v2.1（2025-11）移除 | https://recallium.ai/cursor |
| OpenAI Dreaming：后台巩固**默认开启**、记忆不完全可见——被用户当反面教材批评 | https://openai.com/index/chatgpt-memory-dreaming ；https://medium.com/@adi_leviim/chatgpt-is-writing-a-profile-of-you-openai-says-you-cannot-see-all-of-it-2026-47dcfabf9e76 |
| 13 个 memory MCP server 对比：**无一个具备写入审批或安全扫描**（单一来源） | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| agentmemory：有审计日志与溯源，但无审批队列描述 | https://github.com/rohitg00/agentmemory |

**我们现状**：`trust` 五级由写入来源推导（模型不能自封 user）、`status: draft` 四不可见、审批队列（面板批准/编辑批准/
拒绝）、taint 自动隔离成草稿、工具 action 枚举里没有 approve。

**差距/优势**：**这一格我们领先**。通用生态要么不做（MCP 13 家），要么做了引火烧身（OpenAI 默认后台巩固不可见）。
Claude Code 的「按项目批准一次外部导入」是唯一同向设计，粒度比我们的 per-draft 审批粗。

**值不值得抄**：无需抄；反过来应把「写入安全三件套」写进 README 宣传段（§5）。

### 3.3 安全：密钥脱敏、prompt injection 防护

| 对方怎么做 | 来源 |
| --- | --- |
| agentmemory：**存储前隐私过滤器**剥离 API key / 密钥 / `<private>` 标签 | https://github.com/rohitg00/agentmemory |
| Hindsight：MCP 端点**默认无鉴权**（反面） | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| mem0：把「隐私/同意/删除治理」列为开放问题，交给应用层 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |
| HN 共识：记忆污染是头号痛点；「do not let it write comments. Ever.」这类极端防御提议 | https://news.ycombinator.com/item?id=49508317 |
| Claude Code：网络 symlink 不跟随（路径安全） | https://code.claude.com/docs/en/memory |

**我们现状**：密钥脱敏（10 类模式，100 样本零泄漏自测）+ 注入模式检测（20 样本全命中）+ taint 隔离 +
`POST /security/scan` 只扫不写 + 回环 403。

**差距/优势**：agentmemory 的「存储前剥密钥」与我们同族但更粗（只剥不记账、无 taint、无分级）。
**没有任何一家做「注入内容隔离成草稿」**——这是我们的独有机制。

**值不值得抄**：无需抄主体。可抄一个小点：agentmemory 的 `<private>` 标签思路（用户显式圈定「这段别记」），
对我们是「导入时尊重来源标记」，价值低，不抄。

### 3.4 检索：混合检索、图、重排、时间感知

| 对方怎么做 | 来源 |
| --- | --- |
| mem0 新算法（2026-04）：语义 + BM25 + 实体匹配三路并行融合；实体链接内嵌（`{collection}_entities` 平行集合）替代外置图；生产建议 reranking 二次排序 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |
| Zep/Graphiti：语义 + 全文 + BM25 混合；bi-temporal 双时间轴参与检索 | https://github.com/getzep/graphiti |
| agentmemory：BM25 + 向量余弦 + 图遍历，RRF(k=60)；无 key 模式纯 BM25；LongMemEval-S R@5 95.2%（厂商口径） | https://github.com/rohitg00/agentmemory |
| Hindsight：4 路检索 + RRF + 交叉编码器重排 | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| claude-mem：FTS5 关键词 + 向量混合；`search` 返回**索引**再逐条展开（progressive disclosure） | https://docs.claude-mem.ai/architecture/overview |
| Claude Code：auto memory 按标题相关度读 topic 文件；MEMORY.md 索引常驻 | https://code.claude.com/docs/en/memory |

**我们现状**：BM25F（字段权重/IDF/长度归一）+ 精确短语 + related 一跳 + 同义词查询扩展 + 路径召回；
硬评测自测 Recall@5 1.000 / MRR@10 0.930；索引式简报与 claude-mem 的 progressive disclosure 同思路。

**差距/优势**：词法侧我们对齐；差的是**第二路信号（向量/图）与重排**。但 P7（零依赖）不许引入 embedding 运行时，
mem0 的实体链接轻量版（同实体归并加分）倒是可以用纯词法近似——不过收益边际（keywords/related 已覆盖大半）。

**值不值得抄**：**rerank 不抄**（要么上模型要么上交叉编码器，违反零模型开销）；**时间感知检索不抄**
（索引行带 createdAt 日期戳已让模型自己判新旧，Zep 的 bi-temporal 对单机个人库是过度设计）。

### 3.5 遗忘与衰减：decay、复审、冲突合并

| 对方怎么做 | 来源 |
| --- | --- |
| mem0：明确承认「**衰减机制不足以解决 confidently wrong**」——高频高相关记忆即使过时也会被高频检索强化 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |
| OpenAI Dreaming：后台巩固（「做梦」），自动整理已知信息 | https://openai.com/index/chatgpt-memory-dreaming |
| agentmemory：全家桶——`/forget`、TTL 过期、**矛盾检测**、重要性驱逐、**Ebbinghaus 遗忘曲线**、stale 自动清除、带审计的 `memory_governance_delete` | https://github.com/rohitg00/agentmemory |
| Supermemory：选择性遗忘 + 矛盾解决 | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| mcp-memory-service：自动巩固（consolidation）为核心特性 | 同上 |
| HN：用 frontmatter created/updated 排序，删数月未动条目 | https://news.ycombinator.com/item?id=49508317 |
| Letta：sleep-time compute——空闲时由专职 agent 重写记忆（「agent dreaming」） | https://www.letta.com/blog/sleep-time-compute |

**我们现状**：半衰期 30 天时间衰减（四类地板 0.75）+ `falsifier` 语义失效条件 + 90 天到期复审队列 +
supersede 版本链（推翻不删除）+ Dream 手动整理。

**差距/优势**：时间衰减是全场标配（Ebbinghaus 曲线与半衰期同族）。**我们独有的是语义级失效（falsifier）**——
这恰好是 mem0 承认自己缺的那块。真差距是**矛盾检测**：agentmemory / Supermemory 都有「新记忆与旧记忆矛盾时
显式处理」，我们只有重复簇合并，没有「相反断言」检测。

**值不值得抄**：**矛盾检测值得**（纯词法可做：同主题高词重叠 + 否定词/反义线索 → 体检列「疑似矛盾对」，只报告），
见 §4-A。OpenAI/Letta 的后台自动巩固不抄（C5/D 红线 + 用户拒绝常驻后台）。

### 3.6 性能：写放大、增量写、索引

| 对方怎么做 | 来源 |
| --- | --- |
| mem0：single-pass 提取（一次 LLM 调用完成抽取，token-efficient，2026-04 发布）；异步写入默认开 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |
| claude-mem：压缩比 10:1~100:1（厂商口径）；Stop hook 收尾时才做会话级总结 | https://docs.claude-mem.ai/architecture/overview |
| agentmemory：hooks 静默记录，会话启动注入默认 2000 token 预算 | https://github.com/rohitg00/agentmemory |
| Letta：非阻塞 sleep-time 整理，主对话不等待 | https://www.letta.com/blog/agent-memory |

**我们现状**：轮末召回/路径 JIT 纯本地零模型调用；索引简报比 full 模式省 60-70% 注入量；提炼走同一路由、
`captureCooldownMs` 限频；刻意不挂 `agent/turn-stopping`（C5）。

**差距/优势**：我们的优势恰恰是「零模型开销路径」比他们都多。single-pass 提炼对我们无感（distill 本来就是单次调用）。
无差距，不抄。

### 3.7 多工作区/项目隔离与共享

| 对方怎么做 | 来源 |
| --- | --- |
| Claude Code：记忆按 git 仓库身份共享（跨 worktree）；子代理有**独立** auto memory 目录；外部导入按项目批准 | https://code.claude.com/docs/en/memory |
| Supermemory：`x-sm-project` 请求头做项目隔离 | https://mnemoverse.com/docs/library/memory-mcp-servers-compared |
| Hindsight：per-bank 多租户隔离 | 同上 |
| Mnemoverse：Rooms 共享空间 + 跨账户成员校验 | 同上 |
| agentmemory：一台机器所有编码 agent 共享单一服务器 | https://github.com/rohitg00/agentmemory |
| mem0：user_id / agent_id / run_id / app_id 四级 scope 为默认 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |

**我们现状**：git 身份作用域（同仓库跨克隆/worktree 共享）+ 全局层（`scope: global`，user 类强制全局）+
`disabledWorkspaces` 停用名单 + 子代理不提炼。

**差距/优势**：对齐。mem0 的 org/run 级是平台需求，个人插件不需要。子代理策略我们更保守（他们隔离但允许写，
我们直接不写）——各有道理，保持。

**值不值得抄**：不抄。

### 3.8 可解释性：审计日志、注入可视化

| 对方怎么做 | 来源 |
| --- | --- |
| Claude Code：`/memory` 显示每个活跃指令文件的路径与行数；`/doctor prompt-audit` 审计指令文件——**过期指令、互相矛盾、引用不存在的文件** | https://code.claude.com/docs/en/memory |
| agentmemory：memory_audit 审计日志 + memory_verify 溯源到原始观察 | https://github.com/rohitg00/agentmemory |
| TraceMem（Show HN）：记录每个 AI 动作背后的 reasoning / authority / context | https://news.ycombinator.com/item?id=46594366 |
| mem0：异步写入带 actor 归因 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 |
| OpenAI Dreaming（反面）：记忆不进数据导出、部分不可见 | https://medium.com/@adi_leviim/chatgpt-is-writing-a-profile-of-you-openai-says-you-cannot-see-all-of-it-2026-47dcfabf9e76 |

**我们现状**：注入审计（进 prompt 的字节 + sha256 前 16 位 + 带了哪些 id + 谁被预算挤掉，append-only）、
`/briefing-preview` 事前预览（面板说的就是模型看的）、画像证据链、派生链、evidence/sessionId 溯源。

**差距/优势**：审计粒度全场最细（竞品的审计多在「写侧」，我们在「读/注入侧」也记）。
真差距是 Claude Code 的 `/doctor prompt-audit` 式**语义体检**：过期、矛盾、引用失效三类它都查，我们体检只有
重复簇/过期未用/断链/派生失效/待复审——**没有「互相矛盾」和「引用的文件已不存在」**。

**值不值得抄**：值得，两条都是纯本地词法/文件系统检查。见 §4-A/B。

---

## 4. 可抄清单（只列我们还没有的，按优先级）

> 成本口径：低 = 一两个函数 + 断言；中 = 动 store/api 或 UI 一个面；高 = 新层或新依赖。
> 每条都对照红线检查过。

### A. 体检加「疑似矛盾对」检测 —— 中低成本，P0 —— ✅ 已落地（2026-10-24，倒排共现 + 否定句词法，只报告，每库上限 10 对）

- **对方**：agentmemory / Supermemory 有矛盾检测（来源：GitHub README / mnemoverse）；Claude Code
  `/doctor prompt-audit` 查「互相矛盾的指令」；HN 共识「记忆污染是头号痛点」。
- **我们**：体检只有重复簇（高相似=同一件事说两遍），查不出「同一主题、相反断言」（如「用 pnpm」vs「用 npm」）。
- **最小实现**：`lib/store.js` 的 health 里加一步——同标签或标题/正文高词重叠（复用 BM25F 打分）的两条之间，
  若否定词/反义线索命中（「不要/禁用/改用/不再」+对方关键词）则列为「疑似矛盾对」；**只报告**，处理动作给
  `supersede`（正中版本链能力）。每库上限列 10 对防刷屏。
- **红线检查**：只读体检，无写路径风险；不调模型，纯词法。
- **验收**：构造「pnpm vs npm」fixture 命中；正常无矛盾库零误报；`store` 套件加 2-3 条断言。

### B. 体检加「files 引用失效」检测（轻量版 Veyra，10-20 就提过，仍未做）—— 低成本，P0 —— ✅ 已落地（2026-10-24，health 加 deadFiles，全失效才报）

- **对方**：Claude Code `/doctor prompt-audit` 查「引用不存在的文件」；10-20 扫描里 Veyra 的「代码变更监视、
  证据指向的文件被删就降权」。
- **我们**：`files` 字段只用于路径召回，指向的文件被删/改名后毫无知觉——路径 JIT 也在给幽灵文件做召回。
- **最小实现**：体检时对 `files` 非空的条目做 `fs.existsSync`（工作区路径需存当前 cwd 或相对 git 根，注意多克隆
  场景只报告不裁决）；列出「引用失效」条目，建议动作是编辑 `files` 或归档。
- **红线检查**：只读；不造目录（D2 精神）；扫描失败静默跳过。
- **验收**：删掉 fixture 文件后体检列出该条目；文件在时零误报。

### C. 索引/注入超限的显式信号升级 —— 低成本，P1 —— ✅ 已落地（2026-10-24，health 加 overBudget + 建议文案，×5 阈值）

- **对方**：Claude Code 的 MEMORY.md 超 200 行/25KB 时**写入仍成功但返回错误**，明令模型重写索引——
  「显式错误」优于「静默截断」。
- **我们**：简报被预算挤掉时页脚写「只列了 N / M 条」（已有），但**体检 KPI 与面板横幅没有把「库规模 vs 注入
  预算」当成一个健康指标**——用户不知道自己的库已经大到简报装不下了。
- **最小实现**：`GET /health` 加一项 `overBudget`（active 条数 > briefingLimit 的倍数阈值，或 M/N 持续 < 50%），
  体检问题清单给建议（合并同标签组/归档过期/调高预算）。不需要动注入路径（C4 字节稳定不受影响）。
- **验收**：构造超限库体检亮黄；正常库不亮；`api` 套件加断言。

### D. 评测方法声明（mem0 的「数字纪律」）—— 极低成本（纯文档），P1 —— ✅ 已落地（2026-10-24，README 检索一节补自测口径一行）

- **对方**：mem0 博客列出导致 benchmark 分数差异的 12 个变量（数据集版本、top-k、reranker、judge 模型…），
  明说「A number without a stated method is a claim, not a result」；评估框架开源。
- **我们**：`docs/retrieval-eval-2026-10-20.md` 有数字有 fixture，但 README 顶部的「Recall@5 1.000 / MRR 0.930」
  没带方法口径（多容易被当成厂商吹水）。
- **最小实现**：README 检索一节补一行评测方法（fixture 规模/查询构造方式/是否含同义改写/打分函数），
  链到评测文档。零代码。
- **验收**：纯文档，无需测试。

### E. `/export` 载荷补全（或一键整库导出）—— 中成本，P1 —— ✅ 已落地（2026-10-24，`?full=1` + import 自动回灌，round-trip 有断言）

- **对方**：OpenAI Dreaming 因「记忆不进数据导出」被用户当透明度反面教材骂——导出完整性已经是用户敏感点。
- **我们**：README「边界」一节自己承认 export 只有条目，画像/派生链/日志/注入审计都不在载荷里，换机恢复靠手工
  拷 `backups/`。
- **最小实现**：`GET /export` 加 `?full=1`——载荷并入当前画像 JSON、derivations.json、最近 N 天 journal
  （注入审计可选）；`POST /import` 识别 full 载荷分流回灌。体量控制：journal 限 30 天。
- **红线检查**：不落仓库（D1）；导入路径仍过 security 门（D3）。
- **验收**：round-trip 测试——导出→空库导入→`portrait()` 与 `derivationList()` 非空。

### F. 压缩后尾部召回补偿（10-20 的 P1-1，仍未做，维持原判）—— 低成本，P2

- 对方动态无变化（meow / soul-md 的回注仍是消息派补丁）；我们的处境仍优于他们（简报在 system prompt 段）。
- 实现方案 10-20 那份已写好（sessionSeen + compaction 标记 + 一次性尾部），不赘述。本轮无新增理由提升优先级。

### 明确不抄（本轮新增理由）

| 不抄 | 谁在做 | 为什么 |
| --- | --- | --- |
| memory models / memory-native RL | Letta（2026-06 论文） | 研究前沿，要训练专用模型；插件层做不到也不该做 |
| sleep-time compute / 常驻后台巩固 | Letta、OpenAI Dreaming | C5/D 红线 + 用户明确拒绝常驻后台；OpenAI 的默认开启还被骂透明度 |
| 向量/图第二路检索 + RRF + 重排 | mem0、agentmemory、Hindsight | P7 零依赖红线；BM25F 硬评测 1.000/0.930 尚未见顶，等评测证明词法到顶再议 |
| bi-temporal 双时间轴 | Zep/Graphiti | 索引行 createdAt 日期戳 + 半衰期已覆盖「让模型判断新旧」；双时间轴是平台级需求 |
| Ebbinghaus 遗忘曲线 | agentmemory | 与我们半衰期 30 天同族，换个曲线名字没有增量 |
| 跨 agent 单服务器共享 | agentmemory（20+ agent） | 我们绑定 DSH 宿主是定位选择；跨宿主共享是 memory-eternal 的格子 |
| `<private>` 标签显式圈禁 | agentmemory | 与 D3 全路径扫描重叠，加标记语法增加心智负担 |
| onboarding 测验（让 agent 学完仓库考试） | HN 评论（nzach） | 有趣但需模型调用与判定标准，价值/成本比差 |

---

## 5. 我们独有、对方没有的优势确认（README 宣传点候选）

> 判定口径：本轮扫过的 14 家核心 + 10 家对比列表里**没有找到等价机制**；单一来源无法确证的表述已降级或标注。

1. **写入安全三件套：密钥脱敏 + taint 隔离成草稿 + trust 来源分级（模型不能自封 user）**。
   13 个 MCP 记忆服务无一个有审批或注入扫描（mnemoverse，单一来源）；agentmemory 只有「存储前剥密钥」；
   mem0 把治理列为开放问题。**没有任何一家做「注入内容隔离成草稿」。**
2. **falsifier 语义失效 + 到期复审队列**。mem0 自己承认「衰减解决不了 confidently wrong」；
   agentmemory 有 TTL/重要性驱逐但没有「什么情况出现就说明这条不再成立」的显式声明机制。
3. **注入侧审计**：进 prompt 的字节 + hash + 被预算挤掉的清单（append-only）。竞品审计集中在写侧
   （agentmemory memory_audit / mem0 actor 归因）；OpenAI Dreaming 的不可见性是反面教材。
   `/briefing-preview` 的「面板说的就是模型看的」事前预览仍是全场独一份。
4. **跨层派生链**（记忆 → 画像 → AGENTS.md，源失效沿链标脏）。本轮未见任何等价物；Claude Code 的
   `/doctor prompt-audit` 只审单层文件，不做跨层传递。
5. **草稿四不可见 + 审批队列**。Cursor 移除原生 Memories 后，IDE 生态带审批的记忆写入反而稀缺了。
6. **曝光 / 使用 / 引用三分账**（曝光不抬排序）。agentmemory 的 memory_verify 溯源最近，但「被注入 ≠ 被使用」
   的区分仍是我们独有（StrataGate 的「采用才强化」是 DSH 生态内最接近的，基线已知）。
7. **零依赖纯 Node + 目录能力审计 0 红线告警**（awesome-dsh-plugin 2026-10-22 快照，README 已载）。
   本轮对比列表里多家要 Docker / Neo4j / OpenAI key / 托管端点（memento-mcp 已弃维护还挂着 Neo4j 依赖）。

---

## 6. 与 2026-10-20 那份的增量差异

**先说结论：2026-10-20 ~ 10-24 这 4 天窗口内，未发现头部玩家的重大新发布**（各家最新动作分别是
mem0 2026-10-10 博客、Cognee 2026-09-28 review、Cursor 2025-11 移除 Memories、OpenAI/Letta 2026-06）。
本轮价值不在「这 4 天的新动作」，而在**补扫了上次三份文档未覆盖的通用玩家**，修正了两处基线事实：

| # | 增量 | 性质 |
| --- | --- | --- |
| 1 | mem0《State of AI Agent Memory 2026》（2026-10-10，早于上次扫描但未被覆盖）：新算法细节（single-pass、实体链接）、BEAM/DolphinBench/STATE-Bench 新基准、「衰减解决不了 confidently wrong」的官方承认 | **补扫** |
| 2 | OpenAI "Dreaming"（2026-06-04）：后台巩固默认开启 + 透明度争议（不可见/不进导出/删聊天不删记忆） | **补扫**（透明度争议可直接用于我们 README 对照宣传） |
| 3 | Claude Code 文档细节：`/doctor prompt-audit`（过期/矛盾/引用失效三类体检）、path-scoped rules、auto memory 四类型与 modified 戳、外部导入按项目批准、retention sweep 豁免 memory | **补扫** |
| 4 | **Cursor v2.1（2025-11）已移除原生 Memories**——与 `docs/market-scan-2026-10.md` §3 中「Cursor Memories：后台生成需批准」的描述冲突；本轮多源（cursor.com/docs、recallium.ai）指向已移除，**建议下次修订 market-scan 时核实并更正** | **事实修正** |
| 5 | GitHub trending 新头部：claude-mem（~96k stars，压缩管线）与 agentmemory（29.8k stars，四层+RRF+审计）——两者都走「hook 静默捕获 + 压缩 + 混合检索」，且 agentmemory 的机制覆盖面（审计/溯源/遗忘/矛盾检测）是通用生态里最接近我们的 | **新玩家** |
| 6 | OpenMemory 本地路径 2026-07 从 mem0 monorepo 移除（mnemoverse，单一来源，未二次确认）；memento-mcp 已弃维护（2025-05 最后提交） | **生态变化**（单一来源标注） |
| 7 | LangMem 2026 无大版本动作；社群复盘结论「深潜 LangGraph 才值得用」——验证「记忆层与宿主生态强绑定」是普遍规律，我们绑定 DSH 不是劣势 | **补扫** |
| 8 | Microsoft kernel-memory 无 2026 release（最新 2025-05），低活动——RAG 框架派在交互记忆赛道缺位 | **补扫** |

**上一份可抄清单的落地对账**（10-20 列的五条）：P0-1 索引日期、P0-2 门控、P1-2 问题闸、P1-3 整库快照均已落地
（README 已载）；**P1-1 压缩补偿仍有效未做**，本轮无新理由升降级，维持 P2 观察。

---

## 7. 建议顺序

| 批次 | 做什么 | 成本 |
| --- | --- | --- |
| **本周** | §4-B files 引用失效体检（一条 fs 检查 + 体检项） | 低 |
| **本周** | §4-A 矛盾对检测（BM25F 复用 + 否定词线索，只报告） | 中低 |
| **随手** | §4-D 评测方法声明（README 一行 + 链接）；README 宣传段补「写入安全三件套 / falsifier / 注入审计」三个独有标签（§5 素材） | 极低 |
| **下周** | §4-C 超限显式信号；§4-E export 补全 | 低 / 中 |
| **待定** | §4-F 压缩补偿（10-20 P1-1 原案） | 低 |
