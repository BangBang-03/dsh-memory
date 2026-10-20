# Agent 记忆市场扫描与 dsh-memory 取长补短（2026-10，v2）

- 日期：2026-10-19
- 配套数据：`docs/dsh-memory-landscape-2026-10.md`（DSH 263 个记忆插件的全量分层、头部拆解与可借鉴清单）
- 口径：DSH 数据来自 `awesome-dsh-plugin.com` 2026-10-18 快照（5,945 个插件、263 个 `memory`、30 天下载窗口 2026-09-18~10-17）；厂商自测分数均标注「厂商口径」，未独立复现。

---

## 0. 一页结论

1. **DSH 记忆市场不是蓝海，是「头部通吃」的红海。** 263 个记忆插件，前 3 名拿走 31.2% 下载、前 10 名拿走 49.8%，中位数只有 1,387 次/30 天；10 月还在新增 60 个。功能数量已经不是胜负手。
2. **本插件在目录里几乎没有可见度。** `BangBang-03/dsh-memory` 在 `memory` 分类排第 143，`★1`，`downloads` 与 `version` 都是 `null`。这更像发行元数据没被目录解析，而不是零使用；但它说明「先能被看见」本身就是 P0。
3. **单点能力正在被抹平。** 冻结快照有 meow / memento / memoir；审批与审计有 memento / memory-eternal；BM25 有 memoir / prime / meow / annkun；dream 有 meow / mneme / prime；技能固化有 auto-memory；跨 Agent 有 deja-vu / memory-eternal。再拿任何一条当唯一卖点都不够。
4. **头部十家各占一个生态位**：Hindsight 占外部服务、mnemon 占平台、OpenViking 占企业、prime 占蒸馏与评测、auto-memory 占主动联想、mneme 占 dream、memory-eternal 占跨宿主、StrataGate 占证据与衰减、meow 占七层、memento 占治理与协议。
5. **本插件最合适的空位是「画像型记忆 + 可审计治理」**：把「这个项目/这个人现在是什么样、为什么变成这样、下次会注入什么」讲清楚。这比再做一个通用记忆库更难被替代，也最贴合现有的 `portrait` / `journal` / 版本链资产。
6. **优先级要改。** 先补分发（P0-0），再补安全（P0-1）与检索评估（P0-2），然后把「画像优先」做成产品（P0-3）。程序记忆、dream、路径 JIT、压缩协同放 P1；协议、图、团队共享放 P2。

一句话战略：**不要再比「谁记得多」，去比「谁把记忆的变化讲得最清楚」。**

---

## 1. 框架：五类记忆 × 六步循环

### 1.1 五类记忆

| 类型 | 回答什么 | 本插件对应 | 状态 |
| --- | --- | --- | --- |
| 工作记忆 | 当前任务进行到哪 | 无显式层，依赖宿主会话 | 缺 |
| 情景记忆 | 哪天做了什么、为什么 | `journal/YYYY-MM-DD.md` | 有 |
| 语义记忆 | 项目事实、约定、决策 | `memories.json` + `MEMORY.md` | 有 |
| 程序记忆 | 以后遇到同类事怎么做 | `convention` 类别 + 提示词纪律 | 半有 |
| 画像记忆 | 用户/项目现在是什么样 | `portrait.json` + `PORTRAIT.md` | 有 |

市场已经证明：**「记忆插件」不等于「长期事实库」**。prime-memory 的 L3、meow 的 `soul` / `user`、memento 的 `user` 轨都在做画像；但大多数只做「结构化档案」，没有做「叙事 + 版本 + 证据」。

### 1.2 六步循环

| 步骤 | 本插件现状 | 判断 |
| --- | --- | --- |
| 捕获 | `memory save` + 轮末 `autoCapture`（默认关） | 偏弱：压缩前不抢救 |
| 提炼 | `lib/distill.js`，质量分、去重、版本链 | 强 |
| 整合 | 体检手动合并、标签清理、画像重写 | 中：缺自动/半自动 consolidation |
| 检索 | 字段加权词重叠 + 使用/衰减/质量 | 中：缺 IDF、多跳、融合、评测 |
| 注入 | 索引简报 + 轮末尾部召回 + 冻结 | 强：字节稳定、可预览 |
| 反思 | 画像重写；`useCount` 计数 | 弱：没有「是否真的有用」的反馈 |

**结论：强在提炼与注入，弱在捕获、整合、反思。** 这与头部插件的差距正好对应：prime 强在捕获/蒸馏/评测，meow 强在 dream，StrataGate 强在「采用才强化」，memento 强在治理。

---

## 2. DSH 生态：三个数字与六个格子

详细拆解见配套文档 `docs/dsh-memory-landscape-2026-10.md`，这里只留结论。

### 2.1 三个数字

| 数字 | 含义 |
| --- | --- |
| **263** | `memory` 分类插件数；10 月还在新增 60 个 |
| **49.8%** | 前 10 名拿走的 30 天下载份额；中位数只有 1,387 |
| **#143** | 本插件在 `memory` 分类的下载排名；`downloads/version` 为 `null` |

### 2.2 头部十家，各占一格

| 插件 | 它占的格子 | 最值得借的一招 |
| --- | --- | --- |
| Hindsight | 外部记忆服务 | 自动召回/保存、知识页、反思、按仓库隔离 |
| dsh-mnemon | 平台化 | Source / Strategy / Provider 分层 |
| OpenViking | 企业记忆服务 | pre-step 召回、画像注入、URI 防护 |
| dsh-prime-memory | 蒸馏与评测 | L0–L3、成本看板、DSH-MemBench、缓存命中 89.1% |
| dsh-auto-memory | 主动联想 | Host 侧唤起、交接账本、技能固化、密钥过滤 |
| mneme | 做梦式巩固 | autoDream、冲突冻结待裁决、四路召回 |
| memory-eternal | 跨宿主共享 | 一个记忆库多 Agent 共享、审核/回收中心 |
| StrataGate | 证据与衰减 | 证据门、采用才强化、事件 + 当前状态图谱 |
| dsh-meow-memory | 七层 | soul/user/project/fact/lesson/topic/rules + 按窗口 dream |
| dsh-memento | 治理与协议 | 服务层审批门、审计链、硬预算、`dsh-memory-protocol v1` |

### 2.3 六个生态位与本插件的空位

| 生态位 | 代表 | 拥挤度 | 本插件机会 |
| --- | --- | --- | --- |
| 通用跨会话记忆 | mnemon、memento、meow、memoir、annkun | 极高 | 不进 |
| 蒸馏 / 画像 | prime、meow、dsh-soul-md、本插件 | 中 | **主攻** |
| 项目 / 任务记忆 | project-memory、engram、MisakaNet | 中 | 可作为画像的证据来源 |
| 治理 / 协议 | memento、memory-eternal、本插件 | 中低 | 作为支撑，不做协议平台 |
| 跨 Agent / 会话考古 | deja-vu、auto-memory、memory-eternal | 中 | P2 互操作 |
| 平台 / Provider | mnemon | 低（但重） | 不做 |

**空位判断**：画像型记忆是唯一一个「头部有相关内容、但没有人把版本、证据、变更解释做透」的格子。prime 有 L3 画像，meow 有 soul/user，WorkBuddy 有云端画像，但都没有做到「每一句画像可追溯到证据、每次重写有 diff、可回滚、可预览下次注入」。这正是本插件现有的 `portrait` + `journal` + 版本链能拼出来的东西。

---

## 3. 通用 Agent 工具：八家的记忆机制

| 工具 | 记忆载体 | 写入 | 检索/注入 | 最值得抄的一招 |
| --- | --- | --- | --- | --- |
| **Claude Code** | `CLAUDE.md` + 每仓库 auto memory；worktree 共享 | 用户写规则；模型自动记纠正 | 启动加载 `MEMORY.md` 前 200 行或 25KB；主题文件按需读；subagent 不继承 | 索引 + 主题文件的极简分层；subagent 隔离 |
| **Codex CLI** | `AGENTS.md` + `~/.codex/memories/`（`MEMORY.md`、`memory_summary.md`、`skills/`） | 默认关；空闲 6h+ 两阶段提取/合并 | 启动读约 5,000 token 摘要；其余 grep 按需 | 两阶段异步管道；提炼结果产出 Skills |
| **Cursor** | `.cursor/rules/*.mdc` + Memories（项目级、个人） | 后台生成需批准；可显式「记住」 | Rules 按 always/智能/glob/手动；Memories 自动召回 | 「Memory 晋升为 Rule」；后台生成必须批准 |
| **Windsurf** | `~/.codeium/windsurf/memories/` + Rules + `AGENTS.md` | 自动生成或用户口令；本地、按 workspace | 模型判断相关性后召回 | 官方明确：自动记忆只记一次性事实，长期知识放 Rules |
| **Gemini CLI** | `GEMINI.md` 分层 + `@import` | 用户写；`/memory add` | 分层拼接；JIT：工具访问文件时才加载该目录 | 按文件访问触发的 JIT 加载 |
| **Qoder** | 全局 + 项目记忆；Repo Wiki、知识库分开 | 5 个触发点；七步流水线 | 意图识别 + 六路召回 + 记忆网络 + 主题树 + 重排 | 完整生命周期 + 自建评测（厂商口径 85/40/28） |
| **WorkBuddy** | 云端画像 + 用户 `MEMORY.md` + 工作区日志/`MEMORY.md` | 云端自动总结；用户规则；日志 append-only | 画像注入；`conversation_search` | 三层分工 + 30 天日志蒸馏 |
| **Kimi Code** | 会话持久化 + `AGENTS.md` + Skills/Subagents/Hooks | 无独立长期记忆库 | 会话恢复 / `/compact` / `/export` / `/import` | 上下文工程干净；长期记忆交给生态 |

**四条最值得细看的机制**：

- **Claude Code 的「索引超限」是显式错误**：`MEMORY.md` 超过 200 行/25KB 会提示模型重写索引。我们目前是截断 + 页脚说明，应该改成「索引已满，请合并或归档」的显式信号。
- **Codex 的提炼产物是 Skills**：程序记忆是正式输出，不是副产品。我们的 `convention` 只停在「记一条约定」，缺下一步。
- **Cursor 的「Memory → Rule」晋升轨道**：个人记忆可以晋升为团队可见、可版本控制的规则。对应我们的「工作区记忆 → AGENTS.md」。
- **Qoder 的主动式记忆**：让记忆在对话间隙自己浮现。我们的轮末召回是同一目标的轻量版，方向对，但还没有做到「模型开口前就到位」。

**两个反面教材**：

- **Windsurf 官方劝退自动记忆**：自动记忆只适合一次性事实，长期知识请写 Rules。这提醒我们：不要把「自动记忆」当成「长期规则」。
- **Kimi Code 没有独立长期记忆库**：宿主把上下文工程做好，记忆交给生态。我们的生态位不是替代宿主，而是补宿主不愿做的「跨会话、可审计、可迁移」。

---

## 4. 记忆基础设施：七家值得抄的机制

| 项目 | 核心机制 | 公开数据（厂商口径） | 对本插件的意义 |
| --- | --- | --- | --- |
| **Mem0** | ADD-only 提取；语义 + BM25 + 实体 + 时态混合；user/agent/run/org 多 scope | LoCoMo 91.6、LongMemEval 93.4 | 「不删除、读时排序」；我们的 supersede 更适合要回滚的场景 |
| **Letta** | Core blocks / Archival / Recall；Agent 自编辑；共享 block；sleep-time；Context Repositories | 无统一公开分 | 共享 block；整库 Git 快照；离线整合 |
| **Zep / Graphiti** | 双时间轴；事实失效不删除；Episode 级溯源；图 + BM25 + 向量 | LoCoMo 94.7、LongMemEval 90.2、P95 155ms | 给记录加 `validFrom/validTo` 与 `observedAt` |
| **Hindsight** | 语义/关键词/图/时态四路召回 + `reflect`；MIT | LongMemEval 94.6 | `reflect` 可做成按需命令 |
| **basic-memory** | Markdown + wikilink + SQLite；MCP | 无 | 可迁移性；`[[链接]]` 比裸 id 更人读 |
| **Cognee** | 文档/代码/多模态 → 知识图谱；ECL；30+ 连接器 | 无 LongMemEval | 面向机构知识，不是交互记忆；不建议引入 |
| **AgentMemory** | 四层（working/episodic/semantic/procedural）；12 个捕获钩子；秘密剥离 | 92% token 缩减、Recall@10 64.1% | 四层映射与「写入前剥离秘密」 |

**三条共同趋势**：检索从「向量相似」转向「多信号融合」；记忆从「覆盖写」转向「只增不删 + 读时排序」；治理从「事后删除」转向「来源 + 有效期 + 审批」。这三条都能以低成本部分吸收，不需要引入向量库或图库。

---

## 5. 能力矩阵（定性）

| 产品 | 本地零依赖 | 检索 | 分层 | 整合 | 治理 | 注入透明 | 程序记忆 | 跨工具 | 分发 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **dsh-memory（本插件）** | ● | ◐ | ◐ | ◐ | ● | ● | ◐ | ◐ | ○ |
| dsh-memento | ● | ◐ | ● | ◐ | ● | ● | ○ | ◐ | ● |
| dsh-prime-memory | ● | ● | ● | ● | ◐ | ● | ◐ | ○ | ● |
| dsh-meow-memory | ● | ● | ● | ● | ◐ | ◐ | ◐ | ○ | ● |
| dsh-memoir | ● | ● | ◐ | ◐ | ● | ● | ◐ | ○ | ● |
| StrataGate | ● | ● | ● | ● | ◐ | ◐ | ○ | ◐ | ● |
| annkun/dsh-memory | ● | ● | ◐ | ◐ | ● | ◐ | ○ | ◐ | ● |
| dsh-mnemon | ● | ◐ | ● | ◐ | ◐ | ◐ | ◐ | ● | ● |
| Qoder | ○ | ● | ● | ● | ● | ● | ◐ | ○ | — |
| Codex CLI | ● | ◐ | ● | ● | ● | ◐ | ● | ◐ | — |

读法：
- 本插件在「治理 / 注入透明」仍是满格，但这两项 memento / memoir / prime 已经追平或接近。
- 最空的格子是「分发」：不是产品能力，是可见度。
- 「程序记忆」是全场共识的下一步：auto-memory 技能固化、Codex `skills/`、Cursor Rule、Gemini Skills。我们只有 `convention` 标签。
- 「整合」是第二空的格子：dream 已经是头部标配之一。

---

## 6. 哪些设计被验证了，哪些不再独特

### 6.1 被验证，继续做

| 设计 | 证据 | 结论 |
| --- | --- | --- |
| 索引式简报，正文按需取 | Claude Code 200 行/25KB；Codex 5,000 token 摘要 | 保持，不要退回全文注入 |
| 会话级冻结 + 尾部注入 | meow 静态 guide；memento 冻结快照；memoir 会话快照 | 方向正确；我们的指纹 + 会话冻结更细 |
| 草稿审批 | Cursor 后台记忆必须批准；memento 服务层审批 | 保持，并下沉到 store 写入路径 |
| 子代理不写记忆 | Claude Code 主记忆不加载进 subagent | 保持 |
| git 身份作用域 | Claude Code 同仓库跨 worktree 共享 | 保持 |
| 版本链 / 回滚 | Zep 失效不删除；Letta Context Repositories | 保持，可再补整库快照 |
| 记忆是背景资料 | 所有产品的共同措辞；OWASP ASI06 | 保持，并从措辞升级为机制 |

### 6.2 不再独特，别再当卖点

| 曾经的优势 | 现在谁也有 |
| --- | --- |
| 冻结快照 / 缓存友好 | meow、memento、memoir、prime |
| 审批队列 | memento（更强：服务层不可绕过）、annkun |
| BM25 / 中文检索 | memoir、prime、meow、annkun、Max-Null |
| 画像 / 用户档案 | prime L3、meow soul/user、dsh-soul-md、WorkBuddy |
| 跨工具导入 | auto-memory（WorkBuddy/CodeBuddy/Claude Code/Codex）、deja-vu（41 个 Agent） |
| 版本链 / supersede | memoir、memento、Zep |
| 健康面板 | memory-eternal 审核/回收中心、prime 成本看板 |

### 6.3 仍然稀缺，值得做深

- **下次会话注入预览 + ✓ 简报标记 + 冻结字节**：头部没有同样的「面板说的就是模型看的」透明度。
- **画像版本 + 变更解释 + 证据链**：prime 有 L3，但没有把「为什么变」讲清楚；meow 有 soul/user，但没有版本叙事。
- **版本链 + 回滚 + 审批 + 体检的一体化面板**：memento 强在服务层，memoir 强在检索，二者都没有把「可审计」做成日常面板。
- **WorkBuddy / Qoder 记忆导入**：deja-vu 覆盖更广，但中文产品记忆的迁移仍是我们的差异点。
- **中文优先的叙事型画像**：多数头部是英文或结构化档案；中文叙事画像仍是空位。

---

## 7. 优先级补充

### 7.1 排序原则

**先能被看见 → 再值得信任 → 再找得到 → 最后才是个性化。**

- 看不见：目录 `downloads/version` 为 null，排名 #143。
- 不值得信任：写入无扫描、无信任分级、审批在工具层可绕过。
- 找不到：检索是词重叠，没有评测。
- 个性化：画像有，但没有版本 diff、证据链、首次引导。

### 7.2 P0：四件事

| 优先级 | 项目 | 为什么现在 | 借鉴 | 最小实现 | 验收 |
| --- | --- | --- | --- | --- | --- |
| **P0-0** | 分发与度量 | 目录里 `downloads/version` 为 null、#143；前 10 名拿走 49.8% | 头部插件的 npm 发布与安装命令一致性 | 双发 npmjs + GitHub Packages；确保目录能解析版本；README 安装命令与包名一致；提交目录收录 | 目录显示版本与下载量；干净 profile 一条命令装成功 |
| **P0-1** | 写入安全与信任分级 | 23/263 有审批/审计；annkun 每条写入拒绝 secrets；memento 服务层审批；OWASP ASI06 | memento 服务层门、annkun 密钥拒绝、auto-memory 密钥过滤 | `trust/taint` 字段；密钥正则；外部来源进草稿/隔离；`audit.jsonl`；面板徽标 | 20 条注入样本全拦截；100 条密钥 0 泄漏；误杀 <5%；审计可重建 |
| **P0-2** | 检索升级与评估基线 | 19/263 提 BM25；头部用 BM25/向量/RRF；我们只有词重叠 | memoir 标题 2.5×、prime RRF、StrataGate 证据门 | BM25F + 标签/关键词/`files`/`related` + RRF；60 条 fixture；CI 阈值；分数拆解 | Recall@5 相对 +10%；MRR@10 ≥ 0.75；注入字符 +≤10%；392 断言全绿 |
| **P0-3** | 画像优先的产品重定位 | 六个生态位里「画像」最空；现有 `portrait`/`journal`/版本链是底子 | prime L3、meow soul/user、WorkBuddy 画像、memento 版本化 | 画像作为默认首页；版本 diff 时间线；每句画像挂证据（记录/日志 id）；首次使用引导；「这次变了什么」横幅 | 新用户 3 轮内得到可用画像；每句可追溯；diff/回滚可用；注入预览含画像 |

> P0-3 不是「再加一个功能」，而是把产品从「记忆库」重新定位成「项目/个人画像」——记录与日志是证据，画像是主视图，版本链是差异化的骨架。

> 落地进度（2026-10-19）：P0-2 的 BM25F + 精确短语 + related 一跳 + 检索冒烟评测已进代码；P0-3 的画像版本 diff 与 `GET /portrait/diff` 已进代码。实现细节、个人使用版对齐清单与画像 2.0 数据模型见 `docs/personal-memory-parity.md`。

### 7.3 P1：六个增强

| 优先级 | 项目 | 借鉴 | 最小实现 | 验收 |
| --- | --- | --- | --- | --- |
| P1-1 | dream / 半自动 consolidation | meow 按窗口 dream、mneme autoDream、prime L2/L3 | 手动 + 空闲触发；峰时抑制；合并重复、重写画像、清理过期，生成 diff 进审批 | 重复率下降；画像刷新可审；不自动改库 |
| P1-2 | 程序记忆晋升 | auto-memory 技能固化、Codex `skills/`、Cursor Rule | `memory promote` → `AGENTS.md` / 全局约定 / Skill 草稿；diff + 版本守卫 + 回滚 | 晋升后新会话可见；重复晋升不重复；可回滚 |
| P1-3 | 路径作用域 / JIT | annkun 子目录标签 + 文件触达；Gemini JIT | 复用 `files` 字段；工具读取/编辑文件时召回匹配记忆，走尾部注入 | 打开 `store.js` 能召回存储层约定；系统提示字节不变 |
| P1-4 | 压缩协同 | auto-memory 交接账本、billion-context、dsh-argp | 监听 `session/event` 的 `compaction/summary` / `compaction/prune`，把本轮决策写入 journal 或草稿 | 压缩后关键决策仍可检索；不增加每轮模型调用 |
| P1-5 | 会话检索 / 溯源 | deja-vu 41 个 Agent、memory-eternal 跨宿主 | 本地 FTS 索引会话日志；`memory search --sessions` 返回原话 + `sessionId/seq` | 「上次那个方案」能搜到原话；可跳回会话 |
| P1-6 | 注入可见化与成本 | prime 会话流「记忆注入」、dsh-context 上下文事件、dsh-cost-meter | 在会话流/面板显示本次注入了哪些记忆、字符数、估算 token；复用宿主成本数据 | 用户能回答「这次它为什么记得」；成本可核对 |

### 7.4 Quick wins 与 big bets

**Quick wins（低复杂度、高信号，适合先做）**

1. 修目录发行元数据（P0-0）。
2. 写入密钥扫描 + `trust` 字段（P0-1 的最小版）。
3. BM25 标题加权 + 60 条 fixture（P0-2 的最小版）。
4. `files` 触达即召回（P1-3 的最小版）。
5. 画像版本 diff 视图（P0-3 的最小版）。
6. 用 dsh-context / dsh-cost-meter 显示注入成本（P1-6 的最小版）。

**Big bets（需要连续投入，决定产品形态）**

1. 画像优先的完整重写：默认首页、证据链、变更解释、首次引导。
2. dream / consolidation：让记忆自己变干净，而不是靠用户点「整理」。
3. 程序记忆：记忆 → 规则 → 技能。
4. 跨 Agent 会话索引 / 协议适配：从插件变成记忆层。

### 7.5 明确不做（至少现在）

| 不做 | 原因 |
| --- | --- |
| 向量库 / 图数据库作为核心 | 头部已经证明可选；引入会破坏本地零依赖与零边际成本 |
| 26 小类 taxonomy | 9 类 + tags 够用；分类是维护债 |
| 平台 / Provider / 策略插槽 | mnemon 已经占位；我们做不过平台方 |
| 团队 / 多租户共享 | 需要权限系统与后端，偏离本地零配置 |
| 常驻后台 daemon | 用户明确拒绝过监控脚本；dream 用「手动 + 空闲 + 峰时抑制」 |
| 自动提炼默认直写 | Cursor / Windsurf / memento 三家独立结论一致：默认要审批 |

---

## 8. 路线图：三批走

| 批次 | 范围 | 判断标准 |
| --- | --- | --- |
| **第一批（v0.6）** | P0-0 分发 + P0-1 安全 + P0-2 检索评估 | 目录能解析版本；注入样本全拦截；有可复现的 Recall/MRR |
| **第二批（v0.7）** | P0-3 画像优先 + P1-1 dream + P1-2 程序记忆 | 画像成为默认视图；每句有证据；记忆能晋升为规则 |
| **第三批（v0.8）** | P1-3 路径 JIT + P1-4 压缩协同 + P1-5 会话检索 + P1-6 注入可见化 | 记忆在「对的文件、对的时刻、对的成本」出现 |
| **v1.0（可选）** | P2 协议 / 跨 Agent / 整库快照 | 有外部插件愿意接；有用户真的需要跨工具 |

---

## 9. 评估：四个指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 检索质量 | 60 条合成查询，Recall@5 / MRR@10 | 相对基线 +10%，MRR ≥ 0.75 |
| 注入成本 | 简报字符数 / 估算 token、尾部召回条数 | 不高于当前 +10% |
| 记忆卫生 | 重复率、过期未用率、断链数、草稿积压 | 每次发布体检不恶化 |
| 安全 | 注入样本拦截率、密钥泄漏率、误杀率 | 拦截 100%、泄漏 0、误杀 <5% |

---

## 10. 附录：主要来源

- DSH 插件目录快照：`https://awesome-dsh-plugin.com/plugins.json`（2026-10-18，5,945 条）
- 本插件在目录中的条目：`https://awesome-dsh-plugin.com/p/BangBang-03/dsh-memory/`
- dsh-memento：`https://github.com/PerryLink/dsh-memento`
- dsh-prime-memory：`https://github.com/drscrewdriver/dsh-prime-memory`
- dsh-meow-memory：`https://github.com/Phant0Meow/dsh-meow-memory`
- dsh-memoir：`https://github.com/Qinling-Melon-Farmers/dsh-memoir`
- StrataGate：`https://github.com/diqierjia/StrataGate-AgentMemory`
- dsh-auto-memory（Aik358）：`https://github.com/Aik358/dsh-auto-memory`
- annkun/dsh-memory：`https://github.com/annkun/dsh-memory`
- deja-vu：`https://github.com/vshulcz/deja-vu/tree/main/extensions/dsh`
- dsh-project-memory：`https://github.com/00080000/dsh-project-memory`
- memory-eternal：`https://github.com/EternalNight996/memory-eternal`
- dsh-mnemon：`https://github.com/omdsh-dev/dsh-mnemon`
- Qoder 记忆文档：`https://docs.qoder.com/zh/qoder/memory`
- Qoder 记忆系统博客：`https://qoder.com/zh/blog/qoder-memory-evolution`
- Claude Code memory：`https://code.claude.com/docs/en/memory`
- Codex memory：`https://aiagentmemory.org/articles/codex-memory`
- Cursor Memories：`https://localskills.sh/blog/cursor-memories-guide`
- Windsurf Memories：`https://docs.windsurf.com/windsurf/cascade/memories`
- Gemini CLI 上下文：`https://geminicli.com/docs/cli/gemini-md`
- Kimi Code 会话：`https://www.kimi.com/code/docs/kimi-code-cli/guides/sessions`
- Mem0 新算法：`https://docs.mem0.ai/platform/features/graph-threshold`
- Letta 架构：`https://hivebook.wiki/wiki/letta-stateful-agent-server-with-memory-blocks-sleep-time-compute`
- Zep 时序知识图谱：`https://www.getzep.com/ai-agents/temporal-knowledge-graph/`
- 开源记忆系统对比：`https://aiagentmemory.org/articles/best-open-source-llm-memory`
- 记忆注入论文：`https://arxiv-troller.com/paper/3228280`
- InjecMEM 报道：`https://blacktree.nl?p=3014/`
