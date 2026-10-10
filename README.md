# dsh-memory

[![Release](https://img.shields.io/github/v/release/BangBang-03/dsh-memory?color=4d6bfe&label=release)](https://github.com/BangBang-03/dsh-memory/releases/latest)
[![License](https://img.shields.io/github/license/BangBang-03/dsh-memory?color=4d6bfe)](https://github.com/BangBang-03/dsh-memory/blob/main/LICENSE)
[![Tests](https://img.shields.io/badge/tests-274%20passed-4d6bfe)](https://github.com/BangBang-03/dsh-memory#测试)

DSH 的**工作区长期记忆**插件。对标 Qoder / WorkBuddy 的记忆交互：记忆以当前工作区为单位落库，
会话开始时把最重要的几条注入系统提示，模型可以随时用 `memory` 工具读写，轮次结束时（可选）
自动提炼，全部记忆都能在 **设置 → 记忆** 里查看和管理。

- 宿主半 `lib/index.js`：系统提示注入、`memory` 工具、`/memory/api` 路由、轮次结束自动提炼。
- 客户端半 `lib/client.js`：设置面板里的「记忆」页，三种视图可切——**档案**（默认，一整篇可编辑的记忆文档 + 两个行为开关）/ **记忆空间**（按项目·全局分区、组内按标签归类）/ **列表**（平铺 + 标签云）；另有搜索、新建、编辑、置顶、归档、删除、整合、整理、导入导出、提炼、扫描本机既有记忆。
- 纯逻辑层：`lib/store.js`（存储）、`lib/distill.js`（提炼）、`lib/api.js`（HTTP 契约），都不依赖 DSH，可独立测试。

## 记忆存在哪

```
~/.dsh/storages/dsh-memory/
  index.json                     工作区索引
  settings.json                  面板里改的设置（cordis config 只是初值）
  workspaces/<目录名>-<hash>/memories.json    每个工作区一个库
  workspaces/<目录名>-<hash>/MEMORY.md        这个库的人读旁车（始终写）
  workspaces/_global/memories.json            跨工作区共享的全局记忆
```

工作区目录名带 8 位 hash（`workspaceKey()` 取规范化路径的哈希），所以同名目录不会互相污染。
记忆默认**不落在仓库里**，不随 git 外泄；需要人类可读的副本时打开 `mirror`，会在工作区写
`<工作区>/.dsh-memory/MEMORY.md`（Markdown，可以直接提交也可以 `.gitignore` 掉）。工作区目录
不存在时这一份会被跳过，绝不凭空造目录；把 `mirror` 关掉会把已生成的那份撤掉（空目录一并收走）。

一条记忆长这样：

```json
{
  "id": "…",
  "title": "插件安装方式",
  "content": "package 进入 dsh.profile.bundles 后，其 cordis.patch.yml 会被自动应用。",
  "category": "convention",
  "tags": ["dsh", "plugin"],
  "scope": "workspace",
  "source": "manual",
  "files": [],
  "createdAt": "2026-10-10T…",
  "updatedAt": "2026-10-10T…",
  "lastUsedAt": null,
  "useCount": 0,
  "seenCount": 0,
  "pinned": false,
  "archived": false,
  "confidence": 1
}
```

类别：`fact` 事实、`preference` 偏好、`decision` 决策、`convention` 约定、`component` 组件、
`task` 待办、`note` 笔记。来源：`manual` 手工 / `agent` 模型调用工具 / `auto` 自动提炼 / `import` 导入。

## 三条记忆通路

1. **会话开始注入摘要**（`briefing`）。系统提示里多一段 `dsh-memory:workspace-briefing`
   （order 550，夹在 PLAN_POLICY 500 与 TEAM_POLICY 600 之间），内容是当前工作区按
   「置顶 → 最近使用 → 最近更新」排序的前 N 条，受 `briefingLimit` / `briefingMaxChars` 双重限制。
   工作区从 `context.agent.session.header.cwd` 现取，切换会话即切换记忆。
2. **`memory` 工具**。模型可以 `save` / `search` / `list` / `get` / `update` / `forget` / `stats`。
   保存时先做一次相似度探测，超过 0.72 就合并进已有那条（`dedupe` 可关）。
3. **轮次结束自动提炼**（`autoCapture`，默认关）。监听 `session/event` 的 `turn/end`，
   把最近一段对话交给同一路由的模型归纳成结构化记忆，按 `minConfidence` 过滤后落库。
   刻意**不**监听 `agent/turn-stopping` —— 那个事件是串行 await 的，长活在它里面会拖住轮次收尾。

## 安装

`dsh plugin --profile desktop …` 会被拒绝（`profile "desktop" is managed exclusively by the
Electron application`），所以手工装。**改 profile 文件前先备份** —— 脚本已经帮你备份（带秒级
时间戳，同一秒内多次改动往后编号，绝不覆盖旧备份）。

```powershell
cd <克隆下来的 dsh-memory 目录>
pwsh -File install.ps1 -DryRun     # 先看一眼要改什么
pwsh -File install.ps1             # 真装
# 重启 DSH 桌面端
```

不想 clone 也可以直接下 [Releases](https://github.com/BangBang-03/dsh-memory/releases/latest)
里的 `Source code (zip)`，解压后同一个目录结构、同样跑 `install.ps1`。

回滚：

```powershell
pwsh -File uninstall.ps1                 # 卸插件，记忆数据保留
pwsh -File uninstall.ps1 -PurgeStorage   # 连 ~/.dsh/storages/dsh-memory 一起删
```

脚本做的三步（也就是手工安装的三步）：

1. 包放进能解析 `@deepseek-ai/*` 的位置。用 junction 挂载时 Node 会按 realpath 解析，
   源码目录向上找不到 profile 的 `node_modules`，因此包内需要一层垫片：

   ```powershell
   # $repo = 你克隆下来的 dsh-memory 目录
   New-Item -ItemType Junction -Path "$repo\node_modules\@deepseek-ai" `
     -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
   ```

2. 在 `~/.dsh/profiles/desktop/package.json` 里加两处：
   - `dsh.profile.bundles` 数组加一项 `dsh-memory`
   - `dependencies` 加 `"dsh-memory": "link:<$repo 的绝对路径，正斜杠>"`

   进了 `dsh.profile.bundles` 之后，包自己的 `cordis.patch.yml` 会被自动应用，
   **不需要**改 profile 的 `cordis.patch.yml`。写盘走「临时文件 + 替换」，不直接覆写。

3. 建 junction：

   ```powershell
   New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-memory" `
     -Target $repo
   ```

4. 重启 DSH 桌面端（新增 loader 行需要重启宿主；之后改客户端半硬刷新即可）。
   卸载脚本只删 junction 与清单项；碰到不是 junction 的同名路径会直接报错退出，不会误删真实目录。

打开 **设置 → 记忆**（导航 order 25）就能看到。宿主路由是 `/memory/api`，客户端一律以
`new URL("memory/api/…", document.baseURI)` 解析，反代目录前缀和 `dsh-app://` 外壳下都能到达。
非回环来源会被 403 拒绝。

## 档案（默认视图）

面板默认是**档案**视图，形状照着 WorkBuddy 的「记忆与进化」页做：

- 顶部两行开关，点一下即时落库（`POST /settings` 是 patch 合并，只发这一个键）：
  **对话记忆** → `autoCapture`、**本地记忆与技能** → `mirror`。
- 「管理记忆」卡片右侧三个按钮：
  - **整理** —— 当前范围里每个同标签分组各自合并成一条并归档原条目（跟记忆空间里的「整合」同一套逻辑，
    只是不用一组一组点）。没有任何可整理的组时只提示一句，不发写请求。
  - **编辑** —— 把整个记忆库摊成一篇可编辑文档：每个分区一个 `## 分区名` 小标题，每条记忆一行
    `**标题**` 加正文。保存时按 `分区 + 标题` 匹配：命中就更新正文，没命中就新建；
    **文档里消失的条目会被归档**（不是删除，勾「含已归档」能找回来）。
  - **导入** —— 就地展开文本框，粘贴 `/export` 的 JSON，或直接粘 markdown 文本。
- 正文是连续文档：粗体标题 + 整段正文，不截断、不折叠，鼠标移到某条上才出现「编辑」小按钮。
- 卡片底部一行灰字写明记忆文件落在这台机器的哪个路径。

## 记忆空间

**记忆空间**视图按标签把记忆归类：先把记忆按 **项目记忆（当前工作区）/ 全局记忆** 分成两个分区
（对标 Qoder 设置里的「项目记忆 / 全局记忆」），再在每个分区里按标签（或按类型、或不分组）
归类成一叠可折叠的组，没有标签的记忆落进「未归类」并排在最后。顶部的 `共 N条` 后面跟着
`全部范围 / 项目记忆 / 全局记忆` 三个可点 chip，点一下只看其中一类。

一叠里超过一条时组头会出现**整合**：把整组合成一条新记忆（标题取标签名，正文按
`- **标题** — 正文` 逐条列出，类别取组内众数），保存成功后再把原条目批量归档。归档不是删除，
勾上「含已归档」就能看到并用「归档」按钮逐条恢复。

切到**列表**视图则是原来的平铺 + 标签云，适合按标签点着筛。

为什么不是纯平铺：调研过的 C 端记忆（Kimi 记忆空间、ChatGPT、Claude）几乎都是一句话流水账、
界面层没有分组也没有检索；只有开发者向的产品（mem0 的 user/agent/app/run scope、Letta 的
memory blocks）才做分区。文件派的做法（basic-memory 的 `- [category] 内容 #tag`、
obsidian-second-brain 的「folder 定类型、tag 定检索、type 定实体」）则说明分组维度不该只有一个。
这里取的是两边的最小交集：**分区定归属、标签定主题、整合把散条目收成一条**。

## 配置

面板里能改的都落在 `~/.dsh/storages/dsh-memory/settings.json`；`cordis.patch.yml` 里的 config 只是初值。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `directory` | `""` | 数据库位置，空 = `~/.dsh/storages/dsh-memory` |
| `mirror` | `true` | 在工作区写 `.dsh-memory/MEMORY.md` |
| `briefing` | `true` | 会话开始注入摘要 |
| `briefingLimit` | `12` | 注入条数上限（1–50） |
| `briefingMaxChars` | `2000` | 注入字数上限（200–20000） |
| `sectionOrder` | `550` | 注入段落在系统提示里的位置 |
| `autoCapture` | `false` | 轮次结束自动提炼 |
| `autoCaptureMinChars` | `600` | 太短的轮次不提炼 |
| `captureCooldownMs` | `60000` | 两次提炼的最小间隔 |
| `minConfidence` | `0.4` | 提炼结果的最低置信度 |
| `maxPerTurn` | `5` | 每次最多落库条数 |
| `maxTranscriptChars` | `6000` | 送给模型的对白摘录上限 |
| `dedupe` | `true` | 保存时合并相似记忆 |

## HTTP 契约

`/memory/api` 前缀，JSON 信封成功 `{ok:true,…}` / 失败 `{ok:false,error,detail?}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 版本、工作区、统计、设置、类别、工作区列表、标签、最近提炼 |
| GET | `/list` | 列表；`q/category/scope/tag/archived/sort/limit/offset` |
| POST | `/save` | 新建或合并 |
| POST | `/update` | 改一条 |
| POST | `/bulk` | `delete` / `archive` / `unarchive` / `pin` / `unpin` |
| POST | `/delete` | 删一条 |
| POST | `/settings` | 写设置 |
| GET | `/export` / POST `/import` | 导出 / 导入（备份载荷、纯文本，或 `path`/`paths` 指到本机既有记忆文件） |
| GET | `/import-scan` | 扫描本机既有记忆来源（Qoder / WorkBuddy / 本插件镜像），只读 |
| POST | `/import-scan` | 按来源 id 或路径导入，用户级来源自动进全局库 |
| GET | `/mirror` | 取当前工作区镜像的 Markdown |
| POST | `/capture` | 立刻提炼一次 |
| POST | `/distill` | 只返回候选，不落库 |
| GET | `/ping` | 存活探测 |

## 导入本机既有的记忆

对标 Qoder / WorkBuddy 的最后一块：用户机器上往往**已经有**它们的记忆文件，插件要能直接吸进来。
`lib/markdown.js` 是纯函数解析层（无 DSH 依赖，可单测），识别四种形态：

| 格式 | 识别依据 | 切条方式 |
| --- | --- | --- |
| `workbuddy` | 有 `#`/`##` 标题 | 文档 H1 当前言，每个 `##` 小节一条 |
| `daily` | H1 是 `YYYY-MM-DD` | 同上，并给每条打 `log` + 日期标签 |
| `qoder` | 开头是 `---` + `name:` frontmatter | 每条一个文件，`description` 当标题，`metadata.type` 映射类别 |
| `text` | 连标题都没有 | 空行分段、首行当标题 |

未知格式会用 `detectFormat()` 自动判断，设置面板里也能手动指定。已知落点（`memorySourceSpecs()`）：

| 来源 | 路径 | 导入到 |
| --- | --- | --- |
| WorkBuddy 工作区记忆 | `<工作区>/.workbuddy/memory` | 本工作区库 |
| WorkBuddy 用户级记忆 | `~/.workbuddy/memory` | 全局库 |
| Qoder 记忆 | `~/.qoder/memory` | 全局库 |
| 本插件镜像 | `<工作区>/.dsh-memory` | 本工作区库（换机/重装时回灌） |

设置页「从本机既有记忆导入」→ **扫描本机** → 每个来源显示文件数、格式与可拆出的条数 → 单独导入或**全部导入**。
扫描本身**只读**：不改动来源文件（有测试守着）。空正文的小节会被丢掉，不留空记忆。

## 测试

```powershell
cd <克隆下来的 dsh-memory 目录>
npm test          # 或 node test/run-all.mjs
```

8 个套件、274 项：

- `store` 80 项 —— 工作区分库、去重合并、检索打分、镜像（含真在工作区落盘 / 关开关撤回 /
  工作区不存在时不造目录）、导入导出、并发写。
- `markdown` 39 项 —— WorkBuddy 笔记/日报、Qoder frontmatter、纯文本、格式识别、粗体子标题
  再切一层、Qoder 索引页剔除、本机扫描只读。
- `distill` 37 项 —— 摘录裁剪、模型输出解析容错、触发条件、显式提示词识别。
- `api` 50 项 —— 15 个端点、错误码、参数校验、按路径/文本导入与来源扫描。
- `host` 10 项 —— 导出形状、Config 默认值与越界校验。
- `activate` 20 项 —— 假装自己是 cordis，把 `apply()` 真跑一遍：注册出来的工具能 save/search/get/
  forget（走真实 store 并落盘）、系统提示段真的产出带记忆的简报（装不下时会明说「只列了 N / M 条」
  而不是假装列全）、`/memory/api/*` 路由真的应答
  且守好 403/404、手动提炼走假 LLM 端到端（候选预览不落库 / 提炼当前会话真落库 / 没接 LLM 时
  给可读错误并留痕）、**轮次结束的自动提炼**（默认关着不烧 token / 开着时后台真落库并记进提炼日志 /
  对话太短直接跳过 / LLM 卡住时轮次收尾照样立刻返回 / LLM 报错只记 `reason=error` 不影响读写）、
  面板保存的记忆真落到工作区镜像且关掉开关当场撤回、既有记忆扫描导入端到端
  （造出假的 `.workbuddy` 与 `~/.qoder` 落点，导入后工作区级进本库、用户级进全局库、来源文件不变）、
  数据目录不可用时只告警不抛错（**单个 bundle 激活失败会让整个 DSH 外壳起不来，这一条是专门防它的**）。
- `client` 29 项 —— 客户端半的模块格式、槽位注册、导航项标记与卸载，以及**真的把设置页渲染出来**
  接到真实 `store` + `api` 上驱动交互（列表 / 搜索 / 新建 / 删除 / 置顶 / 中英文切换 / 后端报错）；
  记忆空间另有 4 项：项目/全局分区且互不串、组内按标签归类、未归类排最后、折叠展开、
  **整合**（预填合并稿 → 保存 → 新条目落库且原条目 `archived: true`）、视图互切与范围 chip 过滤；
  档案视图 5 项：默认打开时是分区小标题 + 粗体标题 + 整段正文（且没有卡片/分组那些类名）、
  **整篇编辑**（改正文 + 添条目 + 文档里消失的归档）、**整理**（多组各自合并、原条目归档）、
  没有可整理的组时只提示不发写请求、两个行为开关即时写进 `/settings` 并在 `/state` 里读得回来。
- `install` 9 项 —— 在临时目录里搭假 DSH 主目录，真跑 `install.ps1` / `uninstall.ps1`：
  备份内容与原始一致、幂等、`-DryRun` 不落盘、卸载还原、`-PurgeStorage` 才删数据、
  以及两种抵赖（包根不对 / junction 位置是真实目录时拒绝删除）。

`test/mini-react.mjs` 是为最后一个套件写的极小 hook 运行时（`createElement` + 5 个 hook +
先序 fiber 复用），本机没有 React，也不需要 DSH 就能跑。

## 边界

- 记忆是**工件**不是指令：自动提炼结果一律标记来源，注入时也用「背景资料」措辞框住，
  避免把历史对话里的内容当成当前任务。
- 非回环页面拿不到持久设置，所以管理界面走自定义路由而不是 `configForms`。
- 导航图标：DSH 0.2.0 的 `settings.section` 只投影 `id / order / label`，图标由外壳内部一张
  封闭的 id 表决定，未知 id 一律回落到齿轮——注册项没有 icon 字段可用。所以 `lib/client.js`
  里 `syncNavMarker()` 只认出「文本等于本插件当前本地化标题」的那一行并打上 `data-dshmem-nav`，
  由同样式表里的 `svg:first-child{display:none}` + `::before` 掩码字形换成记忆卡片图标
  （`dsh-better-sidebar` 的 settings-nav-icon 是同源做法，差异是这里用 rAF 合并了
  MutationObserver 的高频变更）。外壳改结构时最坏结果是退回齿轮，不会影响导航本身。

## 对标：Qoder 与 WorkBuddy 的记忆模型

设计前把两台机器上的竞品拆开看过（`D:\Qoder` 是 VS Code 分支，`D:\WorkBuddy` 是 Electron 应用），
两家的模型不一样，这里取的是交集 + 各自最好的那一处：

| | Qoder | WorkBuddy | dsh-memory |
| --- | --- | --- | --- |
| 作域 | 用户级 `~/.qoder/memory/` | 用户级 `MEMORY.md` + 工作区 `.workbuddy/memory/` | 主库按工作区分库，另有 `scope: global` 的跨工作区层 |
| 磁盘格式 | 每条记忆一个 `.md`（YAML frontmatter）+ `MEMORY.md` 索引 | `MEMORY.md` + 每日 `YYYY-MM-DD.md` 日志（append-only） | 每工作区 `memories.json` + 人类可读 `MEMORY.md` 镜像 |
| 注入 | 会话开始隐式带上 | `<memory>` 块注入画像；工作区记忆按需读文件 | 会话开始注入简报段（`order 550`，受条数/字数上限控制） |
| 写入 | 模型自己判断 | **规则化**：做完实质工作必须追一条日志 | `memory` 工具显式保存 + 轮次结束（可选）自动提炼 |
| 检索 | QMind MCP（RAG，7 个工具） | 读本地日志 + `conversation_search` 跨会话检索 | `memory search` 本地打分检索（不需要后端） |
| 维护 | — | 30 天以上日报蒸馏进 `MEMORY.md` 后删旧文件 | 归档 + 提炼日志 + 导出/导入 JSON |
| 上限 | — | 用户级 4,000 字符 / 会话，工作区 3,000 字符 / 会话 | 注入 12 条 / 2,000 字（面板可改） |

沿用过来的两条最重要的设计：

1. **记忆是人读文件，也是模型工具**——WorkBuddy 的 `MEMORY.md` / Qoder 的 frontmatter 都说明
   记忆要能被 `read`/`grep` 直接看。所以 `mirror` 打开时会在工作区真的写
   `<工作区>/.dsh-memory/MEMORY.md`，`git diff` 里看得见，也能被 DSH 自己的文件工具读到。
2. **记忆是补充，不是指令**——WorkBuddy 提示词里明确写了「工作区记忆不替代正常回复与交付物」，
   这里同样把注入内容框成「背景资料」，并给每条记忆标来源（`manual` / `auto` / `import`）。
