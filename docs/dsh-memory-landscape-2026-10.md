# DSH 记忆插件全景（2026-10-18 快照）

配套主报告：`docs/market-scan-2026-10.md`

- 数据源：`awesome-dsh-plugin.com/plugins.json` 与 `readmes.json`
- 快照：2026-10-18，全量 5,945 个插件，其中 `memory` 分类 263 个
- 下载量：2026-09-18 ~ 2026-10-17 的 30 天窗口
- 口径提醒：下载量受收录时间、包名解析、是否发布到公共 npm 影响；`null` 不等于零使用。README 中的自测数据均为作者口径，未独立复现。

---

## 1. 市场密度：263 个插件，前 10 名拿走一半下载

| 指标 | 数值 |
| --- | --- |
| 全量插件 | 5,945 |
| `memory` 分类 | 263（占 4.4%） |
| 有可解析下载量 | 129 |
| 30 天下载总量 | 442,197 |
| 前 3 名下载量 | 138,099（31.2%） |
| 前 10 名下载量 | 220,175（49.8%） |
| 中位下载量 | 1,387 |
| 新增节奏 | 8 月 133 个、9 月 70 个、10 月 60 个 |

结论：**这是一个「头部通吃 + 长尾极长」的市场。** 263 个插件里，大多数月下载不到 1,400；前 10 名拿走一半流量。功能数量不是胜负手，**定位 + 分发 + 一个记得住的机制**才是。

---

## 2. 头部 15 名

| # | 插件 | 作者 | 30 天下载 | Stars | 上架 | 它占的格子 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `hindsight#coding-agents` | vectorize-io | 55,776 | 50,996 | 08-15 | 外部记忆服务接入：自动召回/保存、知识页、反思、按仓库隔离 |
| 2 | `dsh-mnemon` | omdsh-dev | 44,560 | 579 | 08-13 | 平台化：Sources / Strategies / Providers，多后端可插 |
| 3 | `OpenViking#dsh-memory-plugin` | volcengine | 37,763 | 40,218 | 08-16 | 企业记忆服务：pre-step 召回、画像注入、`viking://` URI |
| 4 | `dsh-prime-memory` | drscrewdriver | 17,248 | 5 | 09-18 | L0–L3 蒸馏 + 成本看板 + 自建 benchmark |
| 5 | `dsh-auto-memory` | Aik358 | 13,376 | 135 | 08-15 | 主动联想 + 交接账本 + 技能固化 |
| 6 | `dsh-tiddlywiki` | bbqisbbq | 12,893 | 6 | 09-03 | 个人 wiki（邻接，不是纯记忆） |
| 7 | `mneme#dsh-mneme` | slow-stack | 10,110 | 157 | 08-14 | 做梦式巩固 + 冲突冻结 + 四路召回 |
| 8 | `memory-eternal` | EternalNight996 | 9,728 | 20 | 09-09 | SQLite + 审核守卫 + 审计日志 + 跨 Agent 共享 |
| 9 | `StrataGate-AgentMemory` | diqierjia | 9,486 | 127 | 09-04 | 六层时间衰减 + 当前状态图谱 + 证据门 |
| 10 | `dsh-meow-memory` | Phant0Meow | 9,235 | 210 | 08-14 | 七层 SQLite + 按窗口 dream + 缓存友好 |
| 11 | `Veyra` | LoveDoLove | 8,921 | 1 | 10-15 | 证据感知 + 项目隔离 + 记忆/RAG 混合搜索 |
| 12 | `dsh-memory` | annkun | 7,451 | 2 | 10-16 | Claude Code 模型：纯文件、双域、子目录按需注入 |
| 13 | `sage-mem` | gezi-wen | 5,897 | 12 | 08-17 | 纯 Markdown、CLAUDE.md 兼容、可手工迁移 |
| 14 | `MisakaNet` | Ikalus1988 | 5,734 | 528 | 08-15 | 失败恢复记忆库：BM25 + 语义 RAG |
| 15 | `dsh-memento` | PerryLink | 5,637 | 136 | 08-14 | 服务层审批门 + 审计链 + `dsh-memory-protocol v1` |

> 本插件 `BangBang-03/dsh-memory` 在目录中的位置：`memory` 分类第 **143** 名，`★1`，`downloads: null`，`version: null`，上架 2026-10-17。这更像「发行元数据没有被目录解析」，而不是「零使用」；但它确实说明**目录里几乎没有可见度**。

---

## 3. 十二个值得逐条拆的插件

### 3.1 `dsh-memento`：把「审批」做成服务层，而不是工具层

- 提供类型安全的 `ctx.memory` 服务；本地 `node:sqlite`（WAL、0600），冻结快照注入系统提示。
- **每条写路径都强制经过服务内部审批 waterfall**（`add` / `replace` / `remove` / `seed`），不是工具层自愿调用；被拒的写也落审计行。
- 两条轨道 × 两个层级 × 按 `agentPreset` 隔离：`user` 轨（关于用户）与 `agent` 轨（环境/约定），各自再分 `user-global` 与 `workspace`。
- 每轨每层**硬字符预算**（默认 user 2000 / agent 4000）；写满返回结构化错误（用量 + 上限），**绝不截断、绝不自动压缩**。
- `/memory audit` 可重建审计链；模型可见 ⟺ 已记录。
- 定义 `dsh-memory-protocol v1`：适配器注册表 + 一致性套件 + MCP server。

**可借**：把审批从「工具调用时检查」下沉到「store 写入时强制」；预算用「拒绝 + 报数」而不是「静默截断」；审计链与协议适配器。
**它比我们强在**：写入不可绕过、审计可重建、协议可被别的插件实现。

### 3.2 `dsh-prime-memory`：把「记忆效果」做成可复现的数字

- 后台 L0 捕获 → L1 原子记忆 → L2 场景整合 → L3 画像蒸馏；`agent/pre-step` 注入一条合成消息，会话流里显示「上下文注入 · memory」。
- 同会话去重；注入有长度预算与时间预算，超限截断/超时跳过，不拖慢对话。
- 检索默认纯 FTS，向量可选；三策略 keyword / embedding / hybrid（RRF k=60），降级链保证不阻塞宿主。
- 成本看板：每次蒸馏调用的 token 成本按 `provider/model` 记账，默认保留 365 天。
- 自建 DSH-MemBench：20 场景 × 10 题型 × 3 次 = 420 题；工作流赛道带真实工具沙箱；公开缓存命中率基线 89.1%，主张「记忆注入不伤缓存」。

**可借**：L0–L3 的分层命名与产物；注入可见化；成本看板；**一套能复现的评测**。
**它比我们强在**：有 benchmark、有成本账、有缓存命中证据；我们只有单元测试。

### 3.3 `dsh-meow-memory`：七层 + dream + 静态 guide

- 七层：`soul` / `user` / `project`（含 `subcategory`）/ `fact` / `lesson` / `topic` / `rules`；每层一张 SQLite 表。
- 静态 `meow-memory:guide` section 只注册一次，文本恒定，不破坏 KV 缓存。
- 按窗口 dream：空闲 ≥3 小时，由该窗口主 agent 分三轮整理（原子记忆 / topic / 项目总结）；峰时抑制（北京时间 09:00–12:00、14:00–18:00）；`/dream` 手动触发。
- `memory_search` 用 BM25 × 近期权重，支持 level/project/status/days 过滤；`memory_find_similar` 做查重与冲突检测。
- 228 项逻辑测试；零运行时依赖，`node:sqlite` + 自包含产物。

**可借**：`lesson` / `topic` 两个层；dream 的空闲触发 + 峰时抑制；静态 guide 的缓存友好写法。
**它比我们强在**：分层更细、dream 是产品化的、测试覆盖到 dream。

### 3.4 `dsh-memoir`：Hot Memory 预算 + 可解释冲突

- JSON 单一事实源 + `PROJECT_MEMORY.md`；Hot Memory 只放高价值记忆，受 token 预算硬限制；同一会话冻结前缀。
- 长尾用本地 BM25 召回；中文短语、英文关键词、代码标识符、路径都可检索；标题 2.5× 加权，另有精确短语、分类、时间权重；查询走 LRU 缓存。
- 写入前返回「相似/冲突候选」，插件只提示、不替调用者判断；调用者必须选择。
- 无 embedding / 向量库 / 云端；零运行时依赖；四种 Agent 语言；快照恢复与降级有明确说明。

**可借**：Hot Memory 的 token 预算；BM25 标题加权；冲突候选「只提示不裁决」的产品语言；查询缓存。
**它比我们强在**：检索参数更细、缓存更完整、冲突处理更克制。

### 3.5 `StrataGate`：证据门 + 采用才强化

- 近期对话保留细节，远期逐渐简化，需要时可展开原文；长期信息整理成 Event（带时间、范围、来源），知识图谱表达「当前状态」，主题目录帮助查找。
- **证据门**：检索结果相关 ≠ 足以回答；Agent 判断证据是否充分，不足时继续搜索/展开，仍不确定就明说。
- **只有最终答案实际采用的 Event 才强化**；搜索命中、自动带入、浏览目录都不强化。采用越多，之后衰减越慢。
- 自动召回最多 4 条 Event + 4 个图谱节点，约 900 token；主题目录约 400 token。
- 支持从其他 AI 导入记忆，导入内容转成可追溯事件。

**可借**：证据门；「采用才强化」而不是「召回即强化」；Event + 当前状态图谱 + 主题目录的三层组织；明确的 token 预算。
**它比我们强在**：记忆权重与「是否真的有用」挂钩；我们的 `useCount` 只记「被取用」。

### 3.6 `dsh-auto-memory`（Aik358）：主动联想 + 交接账本 + 技能固化

- Host 侧联想中间件：不靠模型主动调用检索，而是在对话进行时持续观察情境，相关记忆在模型开口前被检索、决策、注入下一环节；固定边界注入，前缀缓存不失效。
- 每次激活决策带证据链，唤起回顾页可复核打分。
- 多次观察到纠正或重复流程后，**流程固化成技能**；技能可审批、置顶。
- 上下文将满时不做「压成一段摘要」，而是四段式交接笔记跨窗口续命，全量历史归档可搜。
- 外部记忆继承：WorkBuddy / CodeBuddy / Claude Code / Codex 可扫描、导入、按源管理；凭证/密钥段永远过滤在提示词之外。
- 每轮结束由小型子代理判断「要不要记」；失败进队列，每 5 分钟重试；每日写入有预算，超限先合并去重。

**可借**：主动联想的产品表述；交接账本（比单纯 compaction 更可读）；技能固化；密钥过滤；写入预算 + 重试队列。
**它比我们强在**：程序记忆是正式产物；跨窗口交接是产品化的；外部记忆导入更宽。

### 3.7 `dsh-memory`（annkun）：Claude Code 模型 + 文件触达即注入

- 纯 Markdown、零依赖、双域（用户级 + 项目级，项目记忆随 git 共享）。
- `MEMORY.md` 索引启动注入；**项目记忆带子目录标签**：会话 cwd 在子目录内，或会话触达该目录（`read` / `edit` / `write` / `grep` / `glob` / `bash` / `pwsh`）时注入。
- 每条写入路径都拒绝 secrets（包括面板）；原子写；面板 API 有跨源与方法门；id 防穿越；`$HOME`、盘根、tmp 不可作为记忆根。
- 「强证据门」：保存前模型自问「一个月后还重要吗」，不确定就跳过。
- 设置页是完整管理器：双域一屏可搜、工作区树、子文件夹分组、护栏仪表（行数/KB/文件数）。

**可借**：子目录标签 + 文件触达即注入（我们已有 `files` 字段，但只参与检索，不触达）；每条写入路径拒绝 secrets；强证据门；工作区树。
**它比我们强在**：路径作用域是自动的；写入安全是管线级的；零依赖 + 纯文件的可迁移性。

### 3.8 `deja-vu`：把 41 个编程 Agent 的会话变成可检索记忆

- 索引 41 个编程 Agent 的会话文件（Claude Code、Codex、Cursor、Copilot Chat、OpenCode、OpenClaw、Hermes、Kimi、Cline、Zed 等），包括安装之前的历史。
- 工具：`deja_recall`（按错误串/函数名/文件路径/flag 搜会话）、`deja_session`、`deja_blame`（某个文件被谁讨论过）、`deja_fix`、`deja_how`、`deja_remember`；`/deja` 命令。
- 在模型 edit/write 之前，把过去会话关于该文件的内容注入。
- 纯本地 BM25，无 LLM、无 embedding。

**可借**：会话考古的入口设计（`blame` 先于编辑）；跨 Agent 的会话索引；用错误串/文件路径做检索键。
**它比我们强在**：跨工具历史记忆的覆盖面；「编辑前先看历史」的时机。

### 3.9 `dsh-project-memory`：任务 ↔ 文件 ↔ 记忆

- TaskBridge：会话内任务清单与触碰过的文件持久化为项目任务实体；新会话 `list_tasks` → `select_task` 续接；委派给子代理的工作不建档。
- 「读到即记忆」：文件在模型实际读取的瞬间被索引；从未读过的文件不会被记忆；后台轮询只重记变更文件。
- 文档（PDF/Markdown/txt）与代码符号写入工作区；同一实体贯穿任务、项目、全局三级；近重复合并/强化，提升是更换归属而非复制。
- 混合召回：文档、符号、经验、insight 排序；可选 LLM 查询扩展；`leanvec` 可选，缺省退回纯词法；CJK 短语加分、同义词表。
- 分层 insight：教训 / 决策 / 流程；任务面板可拖拽、可编辑、可隐藏。

**可借**：任务 ↔ 文件关联；「读到即索引」；代码符号/文档分层；insight 的教训/决策/流程三分。
**它比我们强在**：与开发工作流绑定得更紧；任务续接是核心，不是附属。

### 3.10 `memory-eternal`：审核中心 + 回收中心 + 跨 Agent 共享

- SQLite 持久存储，数据库层审核守卫 `enforceAudit`，审计日志。
- 对话结束自动沉淀知识卡；`memory_recall` 按需召回；知识卡 / 知识图谱 / 用量 / 审核中心 / 回收中心 / 记忆配置六个入口。
- 一个记忆库所有 Agent 共享：DSH、Claude Code、Codex/Cursor、浏览器；零外部依赖。

**可借**：审核中心 + 回收中心的产品化；一个库多 Agent 共享；用量页。
**它比我们强在**：跨宿主共享；审核/回收是独立入口，不是藏在设置里。

### 3.11 `dsh-mnemon`：平台化，把「记忆」拆成 Source / Strategy / Provider

- Sources 拥有记忆与操作：Runtime memory（`USER.md` / `MEMORY.md`）、Project Documents、Memory Spaces。
- Strategy 决定哪些 Source 常驻、哪些可检索、用哪些工具与预算；Enhancements 通过标准插槽补充。
- Memory Spaces 的 Provider 可换：Mnemon Native、OpenViking、Honcho、Mem0、Hindsight、Holographic、RetainDB、ByteRover、Supermemory。
- 同一套公共契约服务官方插件与外部仓库；扩展 SDK + Provider SDK。

**可借**：Source / Strategy / Provider 的分层命名；「主策略一次只跑一个」的产品约束。
**它比我们强在**：可扩展性；能把外部记忆后端接进来。但这也是它复杂度高的原因。

### 3.12 `mneme`：做梦式巩固 + 冲突冻结

- 跨会话记忆：SQLite + 可人工编辑的 Markdown 镜像；空闲时 `autoDream` 自动巩固；冲突记忆先冻结待裁决；全程可回放审计。
- 四路召回：关键词、向量、BM25、实体图谱；10 个模型工具、MCP 服务端、外部 API、CLI。
- 摘要与巩固走宿主模型；嵌入可换本地模型。

**可借**：冲突「先冻结待裁决」；autoDream 的命名与审计；四路召回中的实体图谱。
**它比我们强在**：巩固是自动的、冲突是显式的、召回是多路的。

---

## 4. 机制覆盖率：不是一个技术栈，而是六个生态位

### 4.1 263 个插件的关键词覆盖率（描述层，属下限）

| 机制 | 命中数 | 占比 |
| --- | --- | --- |
| 文件 / 路径 | 74 | 28.1% |
| 向量 / embedding | 37 | 14.1% |
| SQLite / FTS | 30 | 11.4% |
| 技能 / skill | 28 | 10.6% |
| 画像 / profile / soul | 26 | 9.9% |
| 审批 / 审计 | 23 | 8.7% |
| 导入 / 迁移 | 21 | 8.0% |
| dream / 巩固 / 反思 | 20 | 7.6% |
| 知识图谱 | 20 | 7.6% |
| 跨 Agent / 共享 | 20 | 7.6% |
| BM25 | 19 | 7.2% |
| 衰减 / 遗忘 | 19 | 7.2% |
| MCP | 17 | 6.5% |
| 任务 / task | 15 | 5.7% |
| 缓存 / 冻结 | 7 | 2.7% |
| AGENTS.md | 5 | 1.9% |

### 4.2 头部 10 名的机制分布

| 机制 | 头部 10 名命中 |
| --- | --- |
| dream / 巩固 | 4/10 |
| 知识图谱 | 4/10 |
| SQLite / FTS | 3/10 |
| 向量 | 3/10 |
| 缓存 / 冻结 | 3/10 |
| 审批 / 审计 | 2/10 |
| 画像 / profile | 2/10 |
| 跨 Agent / 共享 | 2/10 |
| BM25 | 1/10 |
| 技能 | 1/10 |
| 导入 | 1/10 |
| 任务 | 0/10 |
| AGENTS.md | 0/10 |

**读法**：头部不是靠同一套技术栈赢的，而是各自占一个生态位。**「全都有」不如「有一个记得住的」**。

### 4.3 六个生态位

| 生态位 | 代表 | 它优化什么 | 空位 |
| --- | --- | --- | --- |
| 通用跨会话记忆 | mnemon、memento、meow、memoir、annkun | 记得住、找得到、可控 | 极度拥挤 |
| 蒸馏 / 画像 | prime-memory、meow（soul/user）、dsh-soul-md、本插件 portrait | 从流水账提炼出「现在是什么样」 | **缺少「画像版本 + 证据链 + 变更解释」** |
| 项目 / 任务记忆 | dsh-project-memory、dsh-engram、MisakaNet | 任务续接、文件/符号、失败教训 | 与通用记忆的结合仍少 |
| 治理 / 协议 | memento、memory-eternal、本插件版本链 | 审批、审计、预算、互操作 | 协议层刚起步 |
| 跨 Agent / 会话考古 | deja-vu、auto-memory、memory-eternal | 把别的工具的历史变成自己的记忆 | 覆盖面与隐私边界 |
| 平台 / Provider | mnemon | 可插拔、多后端 | 复杂度高，适合平台方 |

**本插件最合适的空位：画像型记忆 + 治理。** 不是「又一个通用记忆库」，而是「一个有版本、有证据、能解释变化的项目画像」。

---

## 5. 本插件 vs 头部：差在哪

| 维度 | 本插件 | 头部最佳 | 差距判断 |
| --- | --- | --- | --- |
| 存储 | 每工作区 JSON + Markdown 镜像 | SQLite + FTS5（meow、memento、memory-eternal） | 可接受；数据量上来后检索会吃力 |
| 检索 | 字段加权词重叠 + 使用/衰减/质量 | BM25 + 向量 + RRF（prime、memoir、mneme） | 缺 IDF/长度归一/融合/评测 |
| 分层 | 条目 / 画像 / 日志 | 七层（meow）、L0–L3（prime）、事件/图谱/目录（StrataGate） | 概念不差，粒度不够 |
| 整合 | 体检手动合并 + 画像重写 | dream 自动巩固（meow、mneme、prime） | 缺自动/半自动 consolidation |
| 治理 | 版本链 / 回滚 / 草稿 / 体检 | 服务层审批 + 审计链 + 协议（memento） | 审批在工具层，可被绕过；缺审计链 |
| 注入 | 索引简报 + 尾部召回 + 冻结 + 预览 | 冻结快照（meow/memento/memoir）+ 可见注入（prime） | 预览是独门；但注入可见性不如 prime |
| 程序记忆 | `convention` 类别 + 提示词纪律 | 技能固化（auto-memory）、`skills/`（Codex） | 缺「记忆 → 规则/技能」的晋升通道 |
| 路径作用域 | `files` 参与检索 | 子目录标签 + 文件触达即注入（annkun） | 有字段，没触发 |
| 跨工具 | WorkBuddy / Qoder 导入 | 41 个 Agent（deja-vu）、多宿主共享（memory-eternal） | 覆盖面窄 |
| 分发 | 目录 `downloads/version` 为 null，#143 | 公共 npm + 目录可解析 | **最紧急的短板** |

---

## 6. 可借鉴清单（按落地位置）

| # | 借什么 | 从哪借 | 落到哪 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 服务层审批门，不可绕过 | memento | `store.save/update/remove` 内部统一审批 | P0 |
| 2 | 硬预算 + 结构化拒绝，不静默截断 | memento | 简报/画像/单条正文预算 | P0 |
| 3 | 审计链：模型可见 ⟺ 已记录 | memento / memory-eternal | `audit.jsonl` + `/audit` | P0 |
| 4 | 密钥/注入模式写入扫描 | annkun / auto-memory | 写入管线 + 面板 API | P0 |
| 5 | BM25F（字段加权 + IDF + 长度归一） | memoir / prime | `scoreRecord` 升级 | P0 |
| 6 | 查询 LRU + 标题加权 + 精确短语 | memoir | 检索层 | P1 |
| 7 | 多路召回 + RRF | prime / mneme | 词法 + 标签 + `related` + `files` | P1 |
| 8 | 证据门（检索 ≠ 足够） | StrataGate | 注入前/回答前的置信判断 | P1 |
| 9 | 采用才强化 | StrataGate | 记录「被答案采用」而不只是 `useCount` | P1 |
| 10 | 七层分类（soul/user/project/fact/lesson/topic/rules） | meow | 现有 9 类映射；新增 `lesson` / `topic` | P1 |
| 11 | 按窗口 dream + 峰时抑制 | meow | 画像重写 + 日志蒸馏 | P1 |
| 12 | L0–L3 蒸馏命名与产物 | prime | 日志 → 条目 → 场景 → 画像 | P1 |
| 13 | 注入可见化（会话流显示「记忆注入」） | prime | 尾部召回块已可见；再加系统提示简报的 UI 标记 | P1 |
| 14 | 成本看板 | prime / dsh-cost-meter | 复用宿主成本数据，不自己记账 | P1 |
| 15 | 自建记忆 benchmark | prime（DSH-MemBench） | 60–100 条 fixture + Recall@5/MRR | P0 |
| 16 | 子目录标签 + 文件触达即注入 | annkun | `files` 字段 + 工具调用事件 | P1 |
| 17 | 技能固化 / 程序记忆 | auto-memory / Codex | `convention` → `AGENTS.md` / Skill | P1 |
| 18 | 交接账本（四段式） | auto-memory | 压缩前写 journal + 画像 | P1 |
| 19 | 跨 Agent 会话索引 | deja-vu | `memory search --sessions` | P2 |
| 20 | 任务 ↔ 文件关联 | project-memory | `scope: task` + 任务续接 | P2 |
| 21 | 协议 + 适配器 + 一致性套件 | memento | `dsh-memory-protocol` 兼容层 | P2 |
| 22 | Source / Strategy / Provider | mnemon | 不建议现在做；等主线稳定 | P3 |

---

## 7. 一句话结论

**DSH 记忆市场已经不缺「记忆」，缺的是「一个能被记住的定位」。**

头部十家各自占一个格子：Hindsight 占外部服务、mnemon 占平台、OpenViking 占企业、prime 占蒸馏与评测、auto-memory 占主动联想、mneme 占 dream、memory-eternal 占跨宿主、StrataGate 占证据与衰减、meow 占七层、memento 占治理与协议。

本插件最合适的格子是：**画像型记忆 + 可审计治理**——把「这个项目/这个人现在是什么样、为什么变成这样、下次会注入什么」讲清楚。这比再做一个通用记忆库更难被替代。
