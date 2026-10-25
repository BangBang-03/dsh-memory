# dsh-memory

[![Release](https://img.shields.io/github/v/release/BangBang-03/dsh-memory?color=4d6bfe&label=release)](https://github.com/BangBang-03/dsh-memory/releases/latest)
[![License](https://img.shields.io/github/license/BangBang-03/dsh-memory?color=4d6bfe)](https://github.com/BangBang-03/dsh-memory/blob/main/LICENSE)
[![Tests](https://img.shields.io/badge/tests-535%20passed-4d6bfe)](https://github.com/BangBang-03/dsh-memory#测试)

DSH 的**工作区长期记忆**插件。对标 Qoder / WorkBuddy / ZCode 的记忆交互：记忆以当前工作区为单位落库，
会话开始时把最重要的几条以**索引**形式注入系统提示（一行一条，正文按需用 `memory` 工具取，省 token），
模型可以随时读写，轮次结束后把与当轮话题相关的记忆**召回**进下一轮，还可以（可选）自动提炼——
提炼结果可以直接落库，也可以先进**待审队列**由你批准。全部记忆都能在 **设置 → 记忆** 里管理：
记忆库（档案 / 列表）、时间线、健康体检、审批队列。

**哪个 `dsh-memory` 是这个**：`BangBang-03/dsh-memory`（npm 名 `@bangbang-03/dsh-memory`）。市场目录里有十几个同名包，认作者与仓库。

**它要什么权限**：只用 `fs-read` / `fs-write`（读你自己的记忆库）+ 本机回环 HTTP（`/memory/api`，只监听回环地址）。
**不要 shell、不要环境变量、不启子进程、不发出站请求、不加载动态代码**；`dependencies` 为空，`lib/*.js` 只 import
`node:*` 与相对路径——装上就是零依赖、零后台进程、零边际成本。
市场目录（`awesome-dsh-plugin`，2026-10-22 快照：`memory` 分类 272 个插件）的能力审计里本插件 **0 条红线告警**；
同期该分类下载量前 20 名里，**10 个要 shell、13 个要 env、3 个要动态代码、1 个被判「读凭据 + 有网络」**。

三分钟装好（DSH ≥ 0.2.0-rc.2，web / 桌面）：

```powershell
git clone https://github.com/BangBang-03/dsh-memory.git
cd dsh-memory
pwsh -File install.ps1 -DryRun     # 先看一遍要改什么
pwsh -File install.ps1             # 真装
# 重启 DSH 桌面端
```

不想 clone，用**版本无关**的 Release 资产（`/latest/` 天然跳过预发布，永远取最新正式版）：

```powershell
pwsh -File install.ps1 -FromRelease -Channel stable   # 脚本自己下 tarball 并解包到 ~/.dsh/plugins/dsh-memory
# 或显式给 URL（同一个资产）：
pwsh -File install.ps1 -FromUrl https://github.com/BangBang-03/dsh-memory/releases/latest/download/dsh-memory-latest.tgz
```

> 市场目录里的 install 命令是收录当天（2026-10-17）写死的 `v0.5.1` tarball，**不会随发版更新**。
> 按目录那条命令装到的是旧版；以本节的 `/latest/` 写法或 `tools/status.mjs` 报的版本为准。

公共 npm 源随 `v*` 标签自动发布（仓库需一次性配置 `NPM_TOKEN`，见 `.github/workflows/publish-npmjs.yml`）；配好之后也可以直接 `dsh plugin --profile web add @bangbang-03/dsh-memory`。

- 宿主半 `lib/index.js`：系统提示注入（索引/全文双模式）、轮末相关召回、`memory` 工具、`/memory/api` 路由、轮次结束自动提炼。
- 客户端半 `lib/client.js`：设置面板里的「记忆」页，四个 tab——**记忆库**（档案 / 列表两视图；档案有整篇文档（ZCode 式索引）/ 按标签 / 按类型 / 时间线四种排布，顶部带「刚刚记了什么」变化横幅与「下次会话将注入」预览；库为空时换成「怎么开始」的引导卡）、**维护**（体检 + 待审队列 + 派生链 + 注入审计 + 复审队列 + 整库快照 + 标签清理）、自动提炼、设置。
- 纯逻辑层：`lib/store.js`（存储）、`lib/distill.js`（提炼）、`lib/api.js`（HTTP 契约），都不依赖 DSH，可独立测试。

## 新增：对齐市场同类后补的十四处

| 机制 | 怎么用 | 默认 |
| --- | --- | --- |
| 质量分 + 闸门 | 每条记忆按内容算 0–100（过短 / 空标题 / meta 短语扣分，标签与关键词加分）；自动提炼与模型主动写入的**低分条目（<30）直接归档**、不进简报，卡片上标分数 | `qualityGate: true` |
| 为什么记 / 从哪来 | `memory save/update` 新增 `reason` 与 `evidence`（quote / sessionId / turn / url）；卡片与工具输出都显示，自动提炼自动带 `evidence.sessionId` | 建议总是带 `reason` |
| 时效衰减 | 排序乘 `0.5^(天/30)`（半衰期 30 天、地板 0.5；约定/偏好/反馈/用户四类地板 0.75，长期约定不沉底） | 固定参数 |
| git 身份作用域 | 同一仓库的不同克隆 / worktree 共享一份记忆（`git rev-parse --git-common-dir`），探测不到才回落到路径哈希；旧键数据首次访问自动迁移 | 自动 |
| 简报字节稳定 | 会话级冻结 + 稳定排序（不读使用次数/当前时间）；轮末召回走**尾部注入**，系统提示不再逐轮变化 | 自动 |
| 子代理不提炼 | `origin=subagent` 的会话只召回、不写记忆，避免把派活的中间过程写成长期记忆 | `captureSubagents: false` |
| 曝光 / 使用 / 引用三分账 | 简报不计曝光；轮末召回、路径 JIT、`search` 命中只记 `exposedCount`；`get` 记 `openedCount`，答案引用 `#id` 记 `citedCount`；排序只读 `useCount`；体检与 Dream 单独报告「曝光 ≥3 次但从未使用」 | 自动 |
| 同义词查询扩展 | 查询侧按保守同义词组扩展（发版/发布/上线、检查/校验、压缩/裁剪…），接住「换了说法」的查询；索引仍用原文，不改写入内容 | 自动 |
| 画像证据链 | 重写画像时要求模型给每段挂参考（`mem_…` / `journal:YYYY-MM-DD`），落库后每段显示证据标签；没有证据的段标「未溯源」；手工改过正文的段自动清空证据 | 自动 |
| 注入审计 | 每次真正进 prompt 的内容都留一份：正文、sha256 前 16 位、带了哪些记忆 id、谁被预算挤掉；`GET /injections` 可查，维护页有「注入审计」卡 | 自动 |
| 跨层派生链 | 记忆 → 画像 → AGENTS.md 每一层都记下它是从哪些源、哪个版本抄来的（`derivations.json`）；源被删 / 被归档 / 被取代 / 被改写时，**这层派生自动标脏**并沿链向上传递；`GET /derivations` 可查，维护页有「派生链」卡 | 自动 |
| 失效条件与复审 | 记忆可写 `falsifier`（什么情况出现就说明它不再成立，正文里的「失效条件：…」也会被识别）；带失效条件的记忆自动排期复审，到期进复审队列；`GET /reviews` 与 `action=review` 处理 | `falsifierReviewDays: 90` |
| 整库快照（后悔药） | 每天第一次写入、以及每次 Dream 动手前，把整个库复制到 `<库根>/backups/<时间戳>-<原因>/`，轮转只留 7 份；`GET /backups` / `POST /backup` 或维护页「立即备份」。恢复 = 手工把某一份拷回库目录（面板**不会**自动覆盖当前数据）；只写库根，绝不碰工作区 | 自动 |
| 空库引导 | 记忆库为空时，首屏给的是「怎么开始」而不是「这里空」：三条路径（对话里说「记住……」/ 一键开启自动提炼 / 扫别处的记忆）+ 三个按钮，其中「开启自动提炼」直接把 `autoCapture` 打开 | 自动 |

## v0.3.0「百家记忆」：借鉴了谁

| 来源 | 机制 | 本插件的落点 |
| --- | --- | --- |
| ZCode / Qoder | `MEMORY.md` 一行一条索引常驻，正文按需读取 | `briefMode: index`（默认）——简报只注入「日期 + 标题 + 标签 + id」，同样字数预算下能装约 3 倍的条目，注入量降 60–70%；模型用 `memory get/search` 按需取全文 |
| ZCode | 每轮后台召回相关记忆（已召回快照防重复） | `turnRecall`：轮次结束后拿当轮用户消息做本地检索，命中的记忆下一轮随简报注入「相关召回」块；连续两轮不重复，纯本地打分零模型开销 |
| ZCode | 类型体系（feedback/user）+ Why/How to apply | 新增 `feedback`（协作纠正/肯定，提炼时按「规则 + Why + How to apply」组织正文）与 `user`（用户画像，强制全局）类别 |
| ZCode | `[[related]]` 双链（悬空允许）、验证式过期 | 记录可带 `related` 关联；简报页脚固定提示「引用记忆里的路径/函数前先验证还存在」；体检列出待验证项 |
| Qoder | 自动整理沉淀、版本回滚、可控写入 | 体检（重复簇/过期未用/断链）一键处理；`supersedes` 版本链——推翻不删除，旧条归档可一键回滚；`captureMode: draft` 提炼结果先进审批队列 |
| WorkBuddy | 三层记忆（工作/知识/持久）、记忆管理面板 | 全局 / 工作区 / 会话召回三层在 UI 全景呈现；时间线视图 + 健康面板（KPI、token 估算、问题清单） |
| Hindsight | 推翻不删除；引用署名 | supersede 版本链天然满足；简报与工具返回都带 id，模型可标注「（记忆 #id）」 |

## 记忆存在哪

```
~/.dsh/storages/dsh-memory/
  index.json                     工作区索引
  settings.json                  面板里改的设置（cordis config 只是初值）
  workspaces/<目录名>-<hash>/memories.json    每个工作区一个库
  workspaces/<目录名>-<hash>/MEMORY.md        这个库的人读旁车（始终写）
  workspaces/<目录名>-<hash>/portrait.json    工作区画像（版本 + 证据）
  workspaces/<目录名>-<hash>/derivations.json 跨层派生链（画像 / AGENTS.md 的源快照）
  workspaces/<目录名>-<hash>/journal/         每天一个只追加的工作日志
  workspaces/_global/memories.json            跨工作区共享的全局记忆
  backups/<时间戳>-<原因>/                     整库快照（每天一次 + 每次 Dream 前；轮转 7 份）
```

工作区键优先取 **git 身份**（`git rev-parse --git-common-dir` 的 realpath，同仓库不同克隆/worktree 共享），不是 git 仓库才回落到**规范化路径的哈希**——同名但不同位置的目录不会互相污染；旧路径键的数据第一次访问会自动搬到新键目录。
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
  "keywords": ["插件", "安装", "bundle"],
  "related": [],
  "reason": "用户明确要求发布前先跑测试",
  "evidence": { "sessionId": "…", "quote": "以后发版都先跑一遍" },
  "quality": 78,
  "falsifier": "如果 dsh plugin add 不再读 dsh.profile.bundles",
  "reviewAt": "2027-01-08T…",
  "reviewedAt": null,
  "supersedes": null,
  "supersededBy": null,
  "status": "active",
  "scope": "workspace",
  "source": "manual",
  "trust": "user",
  "taint": false,
  "redactions": [],
  "files": [],
  "createdAt": "2026-10-10T…",
  "updatedAt": "2026-10-10T…",
  "lastUsedAt": null,
  "useCount": 0,
  "exposedCount": 0,
  "openedCount": 0,
  "citedCount": 0,
  "lastExposedAt": null,
  "seenCount": 0,
  "pinned": false,
  "archived": false,
  "confidence": 1
}
```

曝光不等于使用：简报索引本身不计曝光；轮末召回、路径 JIT 和 `search` 命中记 `exposedCount`；
只有 `memory get` 记 `openedCount`，答案里显式写 `#id` 记 `citedCount`。排序只读
`openedCount + citedCount`（汇总在 `useCount`），所以一条记忆不会因为「被反复注入」而自动变重要；
体检与 Dream 会单独列出「曝光 ≥3 次但从未打开/引用」的条目。

失效条件与复审：一条记忆可以写 `falsifier`（什么情况出现就说明它不再成立；正文里写
「失效条件：…」也会被识别成这个字段）。带失效条件的记忆自动排期复审（默认 90 天，
`falsifierReviewDays` 可调），到期进复审队列（维护页「复审队列」卡，或 `action=review`），
确认还成立就一键推后一个周期。跨层派生链另存一份：画像与 AGENTS.md 各自记下是从哪些源、
哪个版本抄来的，源被删 / 被归档 / 被取代 / 被改写时这层派生就标脏（`derivations.json`）。

类别：`fact` 事实、`preference` 偏好、`decision` 决策、`convention` 约定、`component` 组件、
`task` 待办、`note` 笔记、`feedback` 反馈（协作纠正/肯定）、`user` 用户画像（强制全局，跟着人走）。
来源：`manual` 手工 / `agent` 模型调用工具 / `auto` 自动提炼 / `import` 导入。
`status: "draft"` 的记忆是待审草稿：不进简报、不进检索、不进镜像，批准后才生效。

写入安全：每条写入路径（含面板与导入）都会扫一遍密钥（`sk-` / `ghp_` / `AKIA` / `AIza` / `xox` /
JWT / 私钥 / `Bearer` / `password: …` 赋值 / 带凭据的数据库 URI），命中就替换成 `[REDACTED:<类型>]`
并在 `redactions` 里记账；再扫一遍注入模式（「忽略之前的指令」「把以下内容写入记忆」「泄露系统提示」等），
命中记 `taint`。**非 user 来源的新建记录一旦 taint 就被隔离成草稿**，批准后才生效——模型不能自封
`user`（`trust` 由写入路径按来源推导）。`POST /security/scan` 可以对任意文本只扫描不落库。

版本链：`save` 带 `supersedes`（或自动提炼识别出「情况已变」）时，新条生效、旧条归档并互指，
面板里可以一键**回滚**——推翻不删除，历史一直在。

## 五条记忆通路

1. **会话开始注入索引**（`briefing`）。系统提示里多一段 `dsh-memory:workspace-briefing`
   （order 550，夹在 PLAN_POLICY 500 与 TEAM_POLICY 600 之间）。默认 `briefMode: index`——
   一行一条「📌 2026-10-20 [类别] 标题 #标签 (id)」，正文不展开；切 `full` 则回到标题+正文摘录的旧形态。
   日期戳取记录的 `createdAt`（不可变），让模型在注入时自己判断新旧；**不用 `updatedAt`**——那个会被
   `markUsed` 刷，一进简报，同一会话的注入字节就逐轮变化，前缀缓存整段作废。
   两种模式都受 `briefingLimit` / `briefingMaxChars` 双重限制，页脚写明「正文按需取 + 引用前先验证」。
   工作区从 `context.agent.session.header.cwd` 现取，切换会话即切换记忆。
2. **`memory` 工具**。模型可以 `save` / `search` / `sessions` / `promote` / `list` / `get` / `update` / `forget` / `stats`。
   `sessions` 搜会话索引里的当轮原话（「上次我们定了什么」）；`promote` 把一条
   convention / decision / preference 写进工作区 `AGENTS.md` 的托管块（幂等，块外内容用户随便改）。
   保存时先做一次相似度探测，超过 0.72 就合并进已有那条（`dedupe` 可关）；带 `supersedes` 时走版本链；
   `related` 把同主题的记忆串起来（允许悬空）；`keywords` 提升检索命中。
3. **轮末相关召回**（`turnRecall`，默认开）。监听 `session/event` 的 `turn/end`，拿当轮最后一条用户消息
   做一次本地打分检索，命中的记忆（排除已在简报与上轮已召回的）下一轮以「相关召回」块注入，并计一次使用。
   纯本地计算，不花模型 token；`turnRecallLimit` 控制每轮条数。
4. **轮次结束自动提炼**（`autoCapture`，默认关）。把最近一段对话交给同一路由的模型归纳成结构化记忆，
   按 `minConfidence` 过滤。`captureMode: direct`（默认）直接落库；`captureMode: draft` 先落草稿进
   **审批队列**，面板批准（可顺手改）后才生效——草稿若挂着 `supersedes`，批准即兑现版本链。
   刻意**不**监听 `agent/turn-stopping` —— 那个事件是串行 await 的，长活在它里面会拖住轮次收尾。
5. **路径 JIT**（`pathRecall`，默认开）。给记忆挂 `files`（`memory save` 新增 `files` 参数），
   工具触达这些文件时（`tools/pre-execute` 只观察不裁决），相关记忆在**下一个 pre-step 以尾部消息注入**——
   「刚触达：`lib/store.js`。以下是挂在这些文件上的记忆……」。匹配强度：全路径 > 目录后缀 > 同名文件；
   简报里已有的、本轮已注入的不重复；同一批触达只注入一次。annkun / Gemini JIT 的文件触达式召回，本地零成本版。

   > **压缩协同**（`compactionSalvage`，默认开）：宿主压缩上下文（`compaction/summary` / `compaction/prune`）时，
   > 把压缩摘要照录进当天工作日志——长会话被压缩，结论也不丢（auto-memory 交接账本的本地轻量版）。
6. **门控：什么时候不记忆**（`autoInject` + `disabledWorkspaces`）。`autoInject: false` 是注入总闸，
   简报 / 轮末召回 / 路径召回一起停，`memory` 工具照常读写——做敏感或一次性任务时用「只用工具」档。
   `disabledWorkspaces` 按**归一后的绝对路径**精确匹配，命中的工作区不注入、也不自动提炼；
   手动工具写入仍放行（显式意图不该被静默拒绝）。
   两道闸都在**入口**拦：简报返回空正文（与「一条记忆都没有」同一条路径），召回连缓冲区都不建。
7. **轮末召回的问题闸**：当轮用户消息若是纯续跑（「继续」「好的，那就继续吧」「下一步」），不再为它跑检索。
   判据是纯本地的——归一后剥掉续跑词与虚词，剩下的实义字符 ≤ 2 才算续跑；长句和带内容的短指令照常召回。

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

2. 在 `~/.dsh/profiles/desktop/package.json` 里加两处（都用**真包名**）：
   - `dsh.profile.bundles` 数组加一项 `@bangbang-03/dsh-memory`
   - `dependencies` 加 `"@bangbang-03/dsh-memory": "link:<$repo 的绝对路径，正斜杠>"`

   进了 `dsh.profile.bundles` 之后，包自己的 `cordis.patch.yml` 会被自动应用，
   **不需要**改 profile 的 `cordis.patch.yml`。写盘走「临时文件 + 替换」，不直接覆写。

   > ⚠️ **依赖键、bundles 项、`cordis.patch.yml` 的 `name`、客户端模块 id 必须是同一个真包名**
   > （= `package.json` 的 `name`）。客户端半的浏览器模块按 manifest 包名认领，写成别名时宿主半
   > 照常工作、设置面板里的界面却**整块消失**（0.3.2 改包名时踩过，0.3.4 修）。`install.ps1`
   > 会自动把 0.3.2 之前的老别名 `dsh-memory` 迁移掉。

3. 建 junction：

   ```powershell
   New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@bangbang-03\dsh-memory" `
     -Target $repo
   ```

4. 重启 DSH 桌面端（新增 loader 行需要重启宿主；之后改客户端半硬刷新即可）。
   卸载脚本只删 junction 与清单项；碰到不是 junction 的同名路径会直接报错退出，不会误删真实目录。

打开 **设置 → 记忆**（导航 order 25）就能看到。宿主路由是 `/memory/api`，客户端一律以
`new URL("memory/api/…", document.baseURI)` 解析，反代目录前缀和 `dsh-app://` 外壳下都能到达。
非回环来源会被 403 拒绝。

## 分支与发布通道

仓库两条线，**默认分支是 `lab`**：

| 分支 | 角色 | 什么时候用 | 推到哪儿 |
| --- | --- | --- | --- |
| `lab` | 实验线（默认） | 平时开发、日常装机 | GitHub Packages 的 `lab` dist-tag + 固定 tag `lab-latest` 的预发布 |
| `main` | 稳定线 | 攒够了、验证过的版本 | `latest` dist-tag + `vX.Y.Z` 正式 Release |

- 往 `lab` 推一次提交，CI 就发一个预发布 `X.Y.(Z+1)-lab.<run_number>`：版本号天然唯一，
  不覆盖 `latest`，正式发 `X.Y.Z` 时又排在所有 `-lab.N` 之上，semver 顺序不会拧。
  同时刷新固定 tag `lab-latest` 的预发布资产 `dsh-memory-lab.tgz`。
- 确认稳定后：把 `lab` 快进到 `main`（`git checkout main && git merge --ff-only lab`）、`package.json` 改成正式版本号，再打 `vX.Y.Z` 标签，
  CI 发 `latest` 并建正式 Release（资产 `dsh-memory-latest.tgz`）。
- 通道切换就是重跑安装命令：`install.ps1 -FromRelease`（默认 lab）/ `-Channel stable`。
  两个通道解包到同一个 `~/.dsh/plugins/dsh-memory`，切换是原地替换。

**日常开发流程**（lab 开发 → 测过 → 本地 main 快进 → 推 GitHub 的 lab 和 main）：

```powershell
git checkout lab                       # 默认分支；平时只在这里动
# …改代码…
node test/run-all.mjs                  # 本机跑一遍：14 个套件 535 条断言
git add -A; git commit -m "feat: …"
git push origin lab                    # 推 lab，CI 立刻发预发布

git checkout main && git merge --ff-only lab   # main 只快进，不在上面直接提交
git push origin main

node tools/status.mjs                  # 两条线的头、lab/stable 通道、最近几次 CI
pwsh -File install.ps1 -FromRelease    # 装刚发出去的实验版

# 攒够一个版本、验证稳定之后（main 上）：package.json 改成正式版本号并提交
git tag vX.Y.Z && git push origin main --tags  # 打标签 → 正式版（Release 资产由 CI 建）
```

`git push` 优先，但本机 `github.com:443` **时通时不通**（2026-10-19 实测：短时可用，几分钟后又连续超时；
每次失败要等约 21 秒）。所以日常用工作区根的 `promote.ps1`：先试 git，失败自动转 REST 兜底
（`tools/push.mjs` / `tools/release.mjs`，`-Channel rest` 跳过探测），最后核对远端 ref。
**两条通道别混用**——REST 重建的提交时区归一到 `+0000`，内容相同但 SHA 不同，混推会让两条线出现平行提交
（本轮就处理过一次）。手动恢复：`git fetch` 后确认 `git diff <本地> <远端>` 为空，再把本地线
`reset --hard` 到远端，之后统一只用一种通道。

`tools/sync.mjs` 是反方向的 `git pull`：按 GitHub API 把远端所有分支与标签逐个对象重建到本地
（git 通道不通或换机器时用）。只在本地仓库损坏时用——它用远端内容覆盖工作区已跟踪的文件。
两条线的完整流程（含「main 只做快进」的理由与推送通道的分叉事故）见工作区根目录
`PLUGIN-WORKFLOW.md`。

## npm 包与远程更新

包以 **`@bangbang-03/dsh-memory`** 发布（`dsh-memory` 裸名在 npmjs 已被他人占用）。发布位置是
**GitHub Packages**（`npm.pkg.github.com`）——npmjs.org 在部分网络环境下不可达，GitHub 这条
通路用现有的 GitHub 凭据即可发布与安装。等 npmjs 可达后，同一份代码 `npm publish --access public`
就能再发一份公共包（`prepublishOnly` 会先跑全量测试）。

### 远程安装 / 更新（不再需要本地克隆）

```powershell
# 方式一：Release 资产直连（公开、零凭据，推荐）。
# 默认走 lab 实验线；换稳定线加 -Channel stable。资产名固定，链接永远是那一个：
pwsh -File install.ps1 -FromRelease                       # lab（默认，实验线）
pwsh -File install.ps1 -FromRelease -Channel stable       # stable（稳定线）
#   lab    -> releases/download/lab-latest/dsh-memory-lab.tgz     （固定 tag 的预发布，每次 lab 推送覆盖）
#   stable -> releases/latest/download/dsh-memory-latest.tgz    （/latest/ 天然跳过预发布）

# 方式二：走 GitHub Packages 的 npm registry（需要带 read:packages 的 PAT）
pwsh -File install.ps1 -FromNpm "@bangbang-03/dsh-memory@lab" `
  -Registry https://npm.pkg.github.com -NpmToken $env:NPM_TOKEN
#   版本位可以是 dist-tag（latest / lab）或具体版本号（如 @0.6.0）
```

`-FromRelease` / `-FromNpm` 都会把包的 tarball 拉下来解包到 `~/.dsh/plugins/dsh-memory`，然后对它执行与
本地安装相同的三步（垫片 / profile 清单 / junction）。**更新就是重跑同一条命令**：脚本会整体替换 plugins
里的旧版本，junction 与 profile 引用的目录名不变，DSH 侧不需要任何动作；想锁版本就在包名后带 `@0.6.0`。
`-DryRun` 只打印计划，不联网不落盘。替换旧版本时脚本会先摘掉目录内的垫片 junction 再删
（PowerShell 5.1 的 `Remove-Item -Recurse` 会跟进 junction 删到共享模块里，这一步是防它的）。

卸载（`uninstall.ps1`）只拆 junction 与 profile 清单项，`~/.dsh/plugins/dsh-memory` 会保留
（想彻底清掉手动删即可），记忆数据依旧只随 `-PurgeStorage` 删。

### 发布新版本（维护者）

发布全在 CI 里做（本机 PAT 没有 `write:packages`），本地只负责推提交和打标签。
两条线怎么分工见上面的「分支与发布通道」。

```powershell
# 实验版：推 lab 就有，不用手动发
git push origin lab

# 稳定版：在 main 上打 v<package.json 版本> 标签
git tag vX.Y.Z; git push origin main --tags
```

git 通道不通时，同样的动作可用 `node tools/push.mjs`（推 lab）与 `node tools/release.mjs`
（推 main + 打标签）走 GitHub REST API 兜底；**别和 git 混用同一条分支**（SHA 会不同，见上面「日常开发流程」的说明）。

CI（`.github/workflows/publish.yml`）在 `lab` 分支推送时发 `-lab.<run_number>` 预发布，
在 `v*` 标签时发 `latest` 正式版；两条线都先跑 5 个纯逻辑层套件，任一套件失败就不发。
`publish-npmjs.yml` 是另一条手动通道（需要仓库密钥 `NPM_TOKEN`），按需点一次即可。

## 档案（默认视图）

面板默认是**档案**视图，形状照着 WorkBuddy 的「记忆与进化」页做。它只有一样东西：
**一个工作区一份长记忆**——正文是连续文档，由对话里的 `memory` 工具维护，用户不需要在这里逐条新建、
也不需要理解「条数」。

同一个视图有四种排布，用右上角的下拉切换（默认是 `整篇文档`）：

| 排布 | 长什么样 | 什么时候用 |
| --- | --- | --- |
| **整篇文档** | ZCode 式索引：一条 `▾ 标题 + 一句话钩子`，点开看全文（索引常驻、正文按需） | 平时看/改「这个工作区记住了我什么」 |
| **按标签分组** | 每个分区里按标签归类成一叠可折叠的组（大小写变体自动归并显示），没有标签的落进「未归类」排在最后 | 散条目多，想按主题收拢 |
| **按类型分组** | 同上，但按 `category`（事实/偏好/决策/约定/组件/待办/笔记）归类 | 想按记忆种类过一遍 |
| **时间线（含归档）** | 全部记忆按更新日期分组、按日排，归档条目半透明；可过滤 | 回答「这条是什么时候、为什么记下的」 |

> v0.3.1 之前这是两个平级视图——「档案」和「记忆空间」——内容完全重合；现在合成一个视图的多种排布。

**记忆库顶部有两块常驻横幅**：

- **刚刚记了什么**：过去 24 小时新增/更新的条目（不受当前筛选影响），默认收起、点「展开」逐条确认——
  解决「自动记忆无感知」（对标 Qoder 的「记忆已更新」chip 深链）。
- **下次会话将注入**：和宿主简报同一套打分的实时预览（注入 N/M 条、≈token 数），
  列表卡片与档案索引行上还会给将注入的条目打 `✓ 简报` 标记——
  回答「我说的那句话它真的会记住并用上吗」。六家同类产品都没有的透明度。

- 档案页只留视图切换（档案 / 列表）、排布下拉、两个开关和正文；**条数统计、范围 chip、搜索框、排序、
  「含已归档」、工作区下拉、「新建记忆」按钮全部只在列表视图里出现**（那些是排查与整理用的）。
- 顶部两行开关，点一下即时落库（`POST /settings` 是 patch 合并，只发这一个键）：
  **对话记忆** → `autoCapture`、**本地记忆与技能** → `mirror`。
- 分区标题带条数与工作区路径（对标 Qoder 设置里的「项目记忆 / 全局记忆」），点一下折叠；
  「按标签分组」时组内超过一条，组头会出现**整合**：把整组合成一条新记忆（标题取标签名，正文按
  `- **标题** — 正文` 逐条列出，类别取组内众数），保存成功后再把原条目批量归档。归档不是删除，
  切到列表视图勾上「含已归档」就能看到并用「归档」按钮逐条恢复。
- 正文上方一行提示：想加记忆就直接在对话里说「记住 ……」。机器侧靠 `memory` 工具的 `save`（先 `search`
  再写，自带去重）和自动提炼落库，人侧靠这里的「编辑」。
- 「管理记忆」卡片右侧三个按钮：
  - **整理** —— 当前范围里每个同标签分组各自合并成一条并归档原条目（跟组头的「整合」同一套逻辑，
    只是不用一组一组点）。它**永远按标签算，跟当前排布无关**；没有任何可整理的组时只提示一句，不发写请求。
  - **编辑** —— 把整个记忆库摊成一篇可编辑文档：每个分区一个 `## 分区名` 小标题，每条记忆一行
    `**标题**` 加正文。保存时按 `分区 + 标题` 匹配：命中就更新正文，没命中就新建；
    **文档里消失的条目会被归档**（不是删除，切到列表视图勾「含已归档」能找回来）。
  - **导入** —— 就地展开文本框，粘贴 `/export` 的 JSON，或直接粘 markdown 文本。
- 正文不截断，鼠标移到某条上才出现「编辑」小按钮；卡片底部一行灰字写明记忆文件落在哪个路径。

> 底下仍然是「一条记忆 = 一条记录」，所以导入 WorkBuddy / Qoder 的既有记忆、按标签整合、搜索、
> 去重这些能力都还在；档案视图只是把它们投影成一篇读得下去的文档，或者一叠分好组的卡片。

## 列表

平铺卡片 + 标签云，适合按标签点着筛。`共 N条` 后面跟着 `全部范围 / 项目记忆 / 全局记忆` 三个可点 chip，
点一下只看其中一类；单条记忆的置顶 / 编辑 / 归档 / 删除、「新建记忆」、工作区下拉也都在这里。

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
| `autoInject` | `true` | 注入总闸：关掉后简报 / 轮末召回 / 路径召回都不再进上下文，`memory` 工具照常读写（「只用工具」档） |
| `directory` | `""` | 数据库位置，空 = `~/.dsh/storages/dsh-memory` |
| `disabledWorkspaces` | `[]` | 停用自动记忆的工作区（绝对路径，归一后精确匹配）：不注入、不自动提炼；工具仍可手动读写。事故排查时也用它把一次性工作区摘出去 |
| `mirror` | `true` | 在工作区写 `.dsh-memory/MEMORY.md` |
| `briefing` | `true` | 会话开始注入记忆简报 |
| `briefMode` | `"index"` | `index` 一行一条索引（省 token）；`full` 标题+正文摘录；`portrait` 画像全量 + 索引清单 |
| `briefingLimit` | `12` | 注入条数上限（1–50） |
| `briefingMaxChars` | `2000` | 注入字数上限（200–20000） |
| `portraitMaxChars` | `1400` | 画像注入的字数预算（工作区 + 全局合计；仅 `briefMode=portrait` 生效，200–8000） |
| `discipline` | `true` | 注入「记忆纪律」一段（何时写什么、对话内指令触发规则） |
| `rewriteMode` | `"direct"` | 画像重写写入方式：`direct` 直接落库；`draft` 先存待审稿，面板批准后才生效 |
| `journalDays` | `14` | 画像重写时读取最近多少天的日志作为原料（1–90） |
| `turnRecall` | `true` | 轮末按当轮内容召回相关记忆进下一轮 |
| `turnRecallLimit` | `3` | 每轮召回条数（1–10） |
| `sectionOrder` | `550` | 注入段落在系统提示里的位置 |
| `autoCapture` | `false` | 轮次结束自动提炼 |
| `captureMode` | `"direct"` | `direct` 直接落库；`draft` 先进待审队列 |
| `staleDays` | `60` | 体检里「过期未用」的判定天数 |
| `autoCaptureMinChars` | `600` | 太短的轮次不提炼 |
| `captureCooldownMs` | `60000` | 两次提炼的最小间隔 |
| `minConfidence` | `0.4` | 提炼结果的最低置信度 |
| `maxPerTurn` | `5` | 每次最多落库条数 |
| `maxTranscriptChars` | `6000` | 送给模型的对白摘录上限 |
| `dedupe` | `true` | 保存时合并相似记忆 |
| `qualityGate` | `true` | 质量闸门：自动提炼 / agent 主动写入的低分条目（<30）直接归档，不进简报 |
| `redactSecrets` | `true` | 写入安全：密钥扫描与脱敏（命中替换为 `[REDACTED:*]` 并记 `redactions`） |
| `quarantineTainted` | `true` | 写入安全：非 user 来源命中注入模式（taint）时自动隔离成草稿 |
| `pathRecall` | `true` | 路径 JIT：工具触达 `files` 挂靠的文件时，相关记忆在下一步尾部注入 |
| `pathRecallLimit` | `3` | 每次路径召回最多注入几条（1–10） |
| `sessionSearch` | `true` | 会话索引：每轮用户发言原文落 `sessions.jsonl`，`action=sessions` 溯源 |
| `compactionSalvage` | `true` | 压缩协同：宿主压缩上下文时把摘要照录进当天工作日志 |
| `captureSubagents` | `false` | 子代理会话（origin=subagent）是否也参与自动提炼；默认否，避免把派活的中间过程写成记忆 |
| `falsifierReviewDays` | `90` | 复审周期（天）：带失效条件的记忆默认多少天后进复审队列（1–3650） |

## HTTP 契约

`/memory/api` 前缀，JSON 信封成功 `{ok:true,…}` / 失败 `{ok:false,error,detail?}`。
请求体超 4MB 回 `413 payload_too_large`；显式传入的 `workspace` 必须是已注册工作区
（当前活动工作区或落过库的工作区），否则回 `400 invalid_workspace`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 版本、工作区、统计、设置、类别、工作区列表、标签、最近提炼、最近简报计量 |
| GET | `/briefing-preview` | 简报预览：按当前设置算「下次会话会注入哪些记忆」，含画像计量与预算挤掉的条目 |
| GET | `/list` | 列表；`q/category/scope/tag/archived/sort/limit/offset`（不含草稿） |
| POST | `/save` | 新建或合并；带 `supersedes` 走版本链（旧条归档、可回滚） |
| POST | `/update` | 改一条（含 `related` / `keywords`） |
| POST | `/bulk` | `delete` / `archive` / `unarchive` / `pin` / `unpin` |
| POST | `/delete` | 删一条 |
| POST | `/settings` | 写设置 |
| GET | `/health` | 体检：重复簇、过期未用、断链、待审草稿数、疑似矛盾对（词法只报告）、files 引用失效、overBudget 超预算信号（只报告） |
| POST | `/health/resolve` | 一键处理：`merge`（合并簇）/ `archive`（归档过期）/ `unlink`（摘除断链） |
| GET | `/timeline` | 全部记忆（含归档、不含草稿）按更新时间倒序 |
| GET | `/portrait` | 当前画像（工作区 + 全局）、版本列表、段落定义 |
| POST | `/portrait/save` | 保存画像（版本 +1，旧版留档） |
| GET | `/portrait/history` | 画像版本列表（降序） |
| GET | `/portrait/diff` | 两个版本的逐段 diff（`from=previous` 默认，返回 `+`/`−` 行与摘要） |
| POST | `/portrait/rewrite` | 触发画像重写（`captureMode` 决定直写或进待审） |
| GET | `/portrait/draft` | 读取待审重写稿（批准前对模型不可见） |
| POST | `/portrait/draft/approve` | 批准重写稿：落库、旧版留档、清待审文件 |
| POST | `/portrait/draft/discard` | 丢弃重写稿 |
| GET | `/queue` | 待审草稿队列 |
| POST | `/queue/approve` | 批准草稿（可带编辑字段；草稿带 `supersedes` 时兑现版本链） |
| POST | `/queue/reject` | 拒绝草稿（默认删除，`mode: archive` 归档留底） |
| POST | `/supersede/rollback` | 版本链回滚：传新条 id 恢复旧条，或传旧条 id 撤销推翻 |
| GET | `/export` | 导出当前工作区与全局**条目**（字段齐全，含 `falsifier` / `reviewAt`）；`?full=1` 连画像 / 派生链 / 最近 30 天日志一起导出，`/import` 自动识别回灌 |
| POST | `/import` | 导入（备份载荷、纯文本，或 `path`/`paths` 指到本机既有记忆文件） |
| GET | `/journal` | 读最近 N 天工作日志（`days`，1-30，默认 3） |
| POST | `/journal` | 写一条工作日志（`date` 可指定，默认当天） |
| GET | `/import-scan` | 扫描本机既有记忆来源（WorkBuddy / Qoder / Claude Code / Codex / Windsurf / 本插件镜像），只读 |
| POST | `/import-scan` | 按来源 id 或路径导入，用户级来源自动进全局库 |
| GET | `/mirror` | 取当前工作区镜像的 Markdown |
| POST | `/capture` | 立刻提炼一次（`captureMode` 决定落库还是进队列） |
| POST | `/dream` | Dream 一键整理：合并重复簇 + 报告过期未用 + 画像重写进待审（只手动触发） |
| GET | `/sessions` | 会话检索（溯源）：按词重叠搜回当轮用户发言原文 + sessionId/turn |
| GET | `/injections` | 注入审计：最近真正进 prompt 的内容（正文预览 + sha256 前 16 位 + id 列表 + 被挤掉的条目；`full=1` 给原文，`kind` 可过滤） |
| GET | `/derivations` | 跨层派生链：每层派生了什么、源现在还成不成立（`state` 为 `fresh` / `dirty`，带失效原因） |
| GET | `/reviews` | 复审队列：带失效条件、到期该复查的记忆（`due` / `soon`） |
| POST | `/review` | 复审一条：记「看过，还成立」，到期时间推后一个周期 |
| POST | `/tags/merge` | 标签归并：把大小写等写法变体合并成目标写法（含全局库与草稿） |
| POST | `/promote` | 程序记忆晋升：把一条记忆写进工作区 AGENTS.md 托管块（幂等）；带 `from=portrait` 则改写画像的某一段 |
| POST | `/distill` | 只返回候选，不落库 |
| GET | `/backups` | 整库快照清单（新的在前，带文件数与字节数）与备份目录路径；没有备份时返回空数组 |
| POST | `/backup` | 立刻做一次整库快照（`reason` 可选）；返回快照名、文件数、字节数与轮转掉的旧快照 |
| POST | `/security/scan` | 写入安全：扫描任意文本的密钥与注入模式，只报告不落库 |
| GET | `/ping` | 存活探测 |

## 维护：体检 / 派生链 / 复审 / 待审 / 整库快照 / 标签清理

时间线已并入记忆库的排布下拉；原「健康」「审批」两个 tab 合成一个**维护** tab：

- **注入审计**：这次真正进 prompt 的字节、hash、带了哪些记忆、谁被预算挤掉（简报 / 尾部召回 / 路径召回分开记，append-only）。
- **派生链**：记忆 → 画像 → AGENTS.md 每一层是从哪些源抄来的、源现在还成不成立。
  源被删 / 被归档 / 被取代 / 被改写，这层就显示「已失效」并给出原因；上游失效会沿链传下去
  （画像的证据没了，从它抄进 AGENTS.md 的那几行也跟着标脏）。只报告，不自动改任何东西。
- **复审队列**：带 `falsifier`（失效条件）的记忆到期后进这里，一行显示「到期时间 + 失效条件」，
  确认还成立就点「已复审」，到期时间按周期推后（默认 90 天，`falsifierReviewDays` 可调）。
- **整库快照**：每天第一次写入、以及每次 Dream 动手前自动整库复制一份，轮转只留 7 份；
  卡上显示真路径与每份的体积/文件数，点「立即备份」可当场再留一份。
  恢复是手工作业：把某一份目录拷回库目录即可，**面板不会自动覆盖当前数据**。
- **体检**：KPI 卡（总数、利用率、待审草稿、最近一次简报注入的字符数与 token 粗估）+
  问题清单——重复簇（一键合并，源条目归档可恢复）、过期未用（一键归档）、
  断链（`related`/`supersedes` 指向不存在的记录，一键摘除）。
  `GET /health` 同时返回 `derivations`（失效的派生条目）与 `reviewDue`（到期未复审的条目），
  这两类在上面的派生链 / 复审队列两张卡里各自处理。
- **待审队列**：`captureMode: draft` 时自动提炼的候选先进这里；每张草稿卡可**批准**、
  **编辑后批准**（编辑字段随批准请求一起提交）、**拒绝**（默认删除，草稿从未生效）。
  草稿不进简报、不进检索、不进镜像——批准之前对模型完全不可见。tab 上带数量徽标。
- **标签清理**：写法不同、意思相同的标签（`DSH` / `dsh` 这类大小写漂移）列成候选，
  一键合并为最常见的写法（后端 `POST /tags/merge`，含全局库与草稿）。
  档案「按标签分组」排布的显示名也会自动归并大小写变体。
- **Dream**：一键半自动整理（对标 meow / mneme / prime 的 dream，但只手动触发）——
  合并重复簇（原条目归档可恢复）、报告过期未用（只报告不归档，由人决定）、
  把画像重写送进待审。没有后台常驻任务；报告一行显示「合并几簇 / 过期几条 / 画像是否进待审」。
  记录卡与时间线带写入安全徽标：`可疑`（taint）/ `已脱敏`（redactions）/ `外部来源`（trust=external），
  以及复审徽标：`有失效条件` / `待复审`（到期未复查）。

## 导入本机既有的记忆

对标 Qoder / WorkBuddy / Claude Code / Codex / Windsurf：用户机器上往往**已经有**它们的记忆文件，插件要能直接吸进来。
`lib/markdown.js` 是纯函数解析层（无 DSH 依赖，可单测），识别四种形态；扫描落点
（`GET /import-scan`）覆盖 `~/.workbuddy/memory`、`~/.qoder/memory`、
`~/.claude/projects/*/memory/**`（剔除 MEMORY.md 索引页）、`~/.codex/memories`、
`~/.codeium/windsurf/memories/**` 与本插件自己的工作区镜像；按来源导入时自动打
`claude` / `codex` / `windsurf` 标签，来源在面板与导出里可见。

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

14 个套件、535 项：

- `store` 143 项 —— 工作区分库、去重合并、检索打分（带 query 只返回真命中）、镜像（含真在工作区落盘 / 关开关撤回 /
  工作区不存在时不造目录）、导入导出、并发写；v0.3.0：版本链 supersede/rollback、user 类别强制全局与跨库迁移、
  草稿四不可见、重复簇聚类与合并、体检（重复/过期/断链/草稿）、索引简报预算、镜像版本链线索、keywords 加权、unlink；
  v0.5.0：日志层 journal（按天 `journal/YYYY-MM-DD.md`、只追加，是画像重写的上游原料）、画像的读写与草稿；
  v0.5.1：曝光 / 打开 / 引用三分账（曝光不抬排序）、曝光未用体检与 Dream 报告。
- `retrieval` 14 项 —— 检索层：BM25F（字段权重 / IDF / 长度归一）、精确短语、related 一跳、同义词查询扩展、
  `search` / `list` 集成、`recallByFiles` 路径召回（全路径 > 后缀 > 同名、limit / excludeIds / 盘符归一），
  20 条记忆 × 10 条查询的冒烟评测，以及 54 条记忆 × 60 条查询的硬评测（同义改写 / 路径代码 / 近邻干扰 /
  多跳 / 否定 / 标签各 10 条）。硬评测自测：Recall@5 1.000、MRR@10 0.930；词重叠基线 0.967 / 0.907；
  基线失败的 3 条硬样例上 1.000 vs 0.333。自测口径：静态集自建、本地离线打分、同一查询集上对比
  词重叠基线，无人工标注与外部基准。详见 `docs/retrieval-eval-2026-10-20.md`。
- `security` 16 项 —— 写入安全：100 条密钥样本全部脱敏（原文零泄漏）、20 条注入样本全部命中、
  20 条正常文本零误报、trust 分级（manual→user，模型不能自封）、非 user 来源的注入内容自动隔离成草稿、
  批准后不被反复打回。
- `derivation` 14 项 —— 跨层派生链：画像层记下它引用了哪些记忆、源被归档 / 被改写 / 被删时标脏；
  记忆晋升进 AGENTS.md 后源改写即标脏；画像段改写 → 从它派生的 AGENTS.md 跟着失效（链式传递）；
  重复晋升幂等；体检列出失效的派生条目。
- `verification` 12 项 —— 可执行校验：显式 `falsifier` 与正文里「失效条件：…」的提取、显式空串清除、
  默认 90 天排期与可配置 TTL、复审队列（到期 / 即将到期）、复审后推后到期时间、体检列出到期项。
- `portrait` 39 项 —— 画像层：段落模型与预算截断、Markdown 渲染与解析、重写输入的拼装、
  模型输出的容错解析、工作区 / 全局两份注入渲染；v0.6：版本 diff（行级 LCS、+/- 渲染、一行摘要）。
- `markdown` 41 项 —— WorkBuddy 笔记/日报、Qoder frontmatter、纯文本、格式识别、粗体子标题
  再切一层、Qoder 索引页剔除、本机扫描只读；v0.6：来源扩到 Claude Code / Codex / Windsurf
  （递归扫 `~/.claude/projects/*/memory`、`~/.codex/memories`、`~/.codeium/windsurf/memories`，
  Claude 的索引页剔除）。
- `distill` 41 项 —— 摘录裁剪、模型输出解析容错、触发条件、显式提示词识别；v0.3.0：
  keywords/supersedes 解析、user 类别强制 global、提示词 v2 指引、existingRecords 带 id。
- `api` 77 项 —— 42 个端点（40 条路径）、错误码、参数校验、按路径/文本导入与来源扫描；v0.3.0：
  /health 与 /health/resolve、/timeline、草稿队列（批准带编辑 / 拒绝 / 带 supersedes 的批准兑现版本链）、
  /save 带 supersedes 与 /supersede/rollback；v0.6：`GET /portrait/diff`（上一版 → 当前版的逐段 diff）。
- `host` 12 项 —— 导出形状、Config 默认值与越界校验。
- `activate` 47 项 —— 假装自己是 cordis，把 `apply()` 真跑一遍（走真实 store 并落盘）：
  工具 save/search/get/forget、全文简报装不下时明说「只列了 N / M 条」、`/memory/api/*` 路由真的应答
  且守好 403/404、手动提炼端到端、面板保存落到工作区镜像、既有记忆扫描导入、数据目录不可用不炸外壳；
  v0.3.0：索引简报（带 id 不展开正文 + full 模式对照）、轮末召回（召回块出现、连续两轮不重复）、
  captureMode=draft 全流程（进队列 → 不进列表 → 日志 drafted → 批准生效）、
  工具 save 带 supersedes（旧条归档、get 展示版本链）；v0.5.0：`action=journal` 写入回读与空文本拒绝、
  journal API（写 / 读 / 日期校验）、画像重写（draft 进待审、direct 直接落库）、提示段里的写入纪律。
- `briefing-stability` 15 项 —— 会话级冻结快照、确定性排序、轮末召回的尾部注入与去重；
  改检索算法时用它守住「系统提示字节稳定」。
- `client` 48 项 —— 客户端半的模块格式、槽位注册、导航项标记与卸载，以及**真的把设置页渲染出来**
  接到真实 `store` + `api` 上驱动交互（列表 / 搜索 / 新建 / 删除 / 置顶 / 中英文切换 / 后端报错）；
  档案视图的分区与两种排布（整篇文档 / 按标签分组 / 按类型分组、分区与分组折叠、组头「整合」、
  整篇编辑、整理永远按标签算、开关即时落库；v0.3.1：档案与记忆空间合并成同一个视图）；v0.3.3：变化横幅与注入预览（/briefing-preview 被调用、✓ 简报标记、横幅展开）、时间线并入档案排布
  （下拉切换、含归档）、维护 tab 合并（体检 KPI + 待审队列批准/拒绝/徽标）；v0.5.0：画像卡（展开两份画像、
  编辑保存走 `/portrait/save`、重写走草稿或直写）。
- `install` 16 项 —— 在临时目录里搭假 DSH 主目录，真跑 `install.ps1` / `uninstall.ps1`：
  备份内容与原始一致、幂等、`-DryRun` 不落盘、卸载还原、`-PurgeStorage` 才删数据、
  0.3.2 之前的老别名安装会被自动迁移（清 bundles / dependencies 条目 + 摘旧 junction）、
  `-FromNpm` / `-FromUrl` 对着假 registry 真跑 HTTP 全流程（含 token 头与重跑即更新），
  以及两种抵赖（包根不对 / junction 位置是真实目录时拒绝删除）。测试对控制台编码自适应
  （中文 Windows 的 GBK 代码页下 pwsh 输出按 GBK 解码，英文环境按 UTF-8）。

`test/mini-react.mjs` 是为最后一个套件写的极小 hook 运行时（`createElement` + 5 个 hook +
先序 fiber 复用），本机没有 React，也不需要 DSH 就能跑。

## 边界

- **普通导出只覆盖条目，`?full=1` 才连画像 / 派生链 / 日志**：`GET /export` 默认载荷只有 `records`
  （条目字段含 `falsifier` / `reviewAt` 都会原样回灌）；`GET /export?full=1` 额外并入当前画像、
  派生链与最近 30 天工作日志，`POST /import` 自动识别 full 载荷分流回灌（画像空不覆盖既有、
  派生链按 `updatedAt` 合并、日志去重追加；注入审计不在任何载荷里——它是 append-only 运维凭据）。
  实测 round-trip：导出 → 空库导入后 `portrait()` 与 `derivationList()` 均非空。
- **派生链只审源端，不审目标端**：它回答的是「这层派生所依据的记忆现在还成不成立」，
  不回答「AGENTS.md 里那几行还在不在」。手工把晋升行或整个托管块删掉，链上仍显示 `fresh`
  （已用脚本实测确认）。要做目标端完整性需要另加一步「块内容回读比对」，目前未实现。
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

