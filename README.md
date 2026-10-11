# dsh-memory

[![Release](https://img.shields.io/github/v/release/BangBang-03/dsh-memory?color=4d6bfe&label=release)](https://github.com/BangBang-03/dsh-memory/releases/latest)
[![License](https://img.shields.io/github/license/BangBang-03/dsh-memory?color=4d6bfe)](https://github.com/BangBang-03/dsh-memory/blob/main/LICENSE)
[![Tests](https://img.shields.io/badge/tests-300%20passed-4d6bfe)](https://github.com/BangBang-03/dsh-memory#测试)

DSH 的**工作区长期记忆**插件。对标 Qoder / WorkBuddy / ZCode 的记忆交互：记忆以当前工作区为单位落库，
会话开始时把最重要的几条以**索引**形式注入系统提示（一行一条，正文按需用 `memory` 工具取，省 token），
模型可以随时读写，轮次结束后把与当轮话题相关的记忆**召回**进下一轮，还可以（可选）自动提炼——
提炼结果可以直接落库，也可以先进**待审队列**由你批准。全部记忆都能在 **设置 → 记忆** 里管理：
记忆库（档案 / 列表）、时间线、健康体检、审批队列。

- 宿主半 `lib/index.js`：系统提示注入（索引/全文双模式）、轮末相关召回、`memory` 工具、`/memory/api` 路由、轮次结束自动提炼。
- 客户端半 `lib/client.js`：设置面板里的「记忆」页，五个 tab——**记忆库**（档案 / 列表两视图，档案里还能整篇/分组两种排布）、**时间线**、**健康**、**审批**（有草稿才出现）、自动提炼、设置。
- 纯逻辑层：`lib/store.js`（存储）、`lib/distill.js`（提炼）、`lib/api.js`（HTTP 契约），都不依赖 DSH，可独立测试。

## v0.3.0「百家记忆」：借鉴了谁

| 来源 | 机制 | 本插件的落点 |
| --- | --- | --- |
| ZCode / Qoder | `MEMORY.md` 一行一条索引常驻，正文按需读取 | `briefMode: index`（默认）——简报只注入「标题 + 标签 + id」，同样字数预算下能装约 3 倍的条目，注入量降 60–70%；模型用 `memory get/search` 按需取全文 |
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
  "keywords": ["插件", "安装", "bundle"],
  "related": [],
  "supersedes": null,
  "supersededBy": null,
  "status": "active",
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
`task` 待办、`note` 笔记、`feedback` 反馈（协作纠正/肯定）、`user` 用户画像（强制全局，跟着人走）。
来源：`manual` 手工 / `agent` 模型调用工具 / `auto` 自动提炼 / `import` 导入。
`status: "draft"` 的记忆是待审草稿：不进简报、不进检索、不进镜像，批准后才生效。

版本链：`save` 带 `supersedes`（或自动提炼识别出「情况已变」）时，新条生效、旧条归档并互指，
面板里可以一键**回滚**——推翻不删除，历史一直在。

## 四条记忆通路

1. **会话开始注入索引**（`briefing`）。系统提示里多一段 `dsh-memory:workspace-briefing`
   （order 550，夹在 PLAN_POLICY 500 与 TEAM_POLICY 600 之间）。默认 `briefMode: index`——
   一行一条「📌 [类别] 标题 #标签 (id)」，正文不展开；切 `full` 则回到标题+正文摘录的旧形态。
   两种模式都受 `briefingLimit` / `briefingMaxChars` 双重限制，页脚写明「正文按需取 + 引用前先验证」。
   工作区从 `context.agent.session.header.cwd` 现取，切换会话即切换记忆。
2. **`memory` 工具**。模型可以 `save` / `search` / `list` / `get` / `update` / `forget` / `stats`。
   保存时先做一次相似度探测，超过 0.72 就合并进已有那条（`dedupe` 可关）；带 `supersedes` 时走版本链；
   `related` 把同主题的记忆串起来（允许悬空）；`keywords` 提升检索命中。
3. **轮末相关召回**（`turnRecall`，默认开）。监听 `session/event` 的 `turn/end`，拿当轮最后一条用户消息
   做一次本地打分检索，命中的记忆（排除已在简报与上轮已召回的）下一轮以「相关召回」块注入，并计一次使用。
   纯本地计算，不花模型 token；`turnRecallLimit` 控制每轮条数。
4. **轮次结束自动提炼**（`autoCapture`，默认关）。把最近一段对话交给同一路由的模型归纳成结构化记忆，
   按 `minConfidence` 过滤。`captureMode: direct`（默认）直接落库；`captureMode: draft` 先落草稿进
   **审批队列**，面板批准（可顺手改）后才生效——草稿若挂着 `supersedes`，批准即兑现版本链。
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

## npm 包与远程更新

包以 **`@bangbang-03/dsh-memory`** 发布（`dsh-memory` 裸名在 npmjs 已被他人占用）。发布位置是
**GitHub Packages**（`npm.pkg.github.com`）——npmjs.org 在部分网络环境下不可达，GitHub 这条
通路用现有的 GitHub 凭据即可发布与安装。等 npmjs 可达后，同一份代码 `npm publish --access public`
就能再发一份公共包（`prepublishOnly` 会先跑全量测试）。

### 远程安装 / 更新（不再需要本地克隆）

```powershell
# 方式一：Release 资产直连（公开、零凭据，推荐）。
# 每次发版都会上传固定名资产 dsh-memory-latest.tgz，/latest/download/ 永远指向最新版：
pwsh -File install.ps1 -FromUrl "https://github.com/BangBang-03/dsh-memory/releases/latest/download/dsh-memory-latest.tgz"

# 方式二：走 GitHub Packages 的 npm registry（需要带 read:packages 的 PAT）
pwsh -File install.ps1 -FromNpm "@bangbang-03/dsh-memory" `
  -Registry https://npm.pkg.github.com -NpmToken $env:NPM_TOKEN

# 锁版本用 -FromNpm "@bangbang-03/dsh-memory@0.3.2"；-DryRun 只打印计划，不联网不落盘
```

`-FromNpm` 会把包的 tarball 拉下来解包到 `~/.dsh/plugins/dsh-memory`，然后对它执行与本地安装相同的
三步（垫片 / profile 清单 / junction）。**更新就是重跑同一条命令**：脚本会整体替换 plugins 里的旧版本，
junction 与 profile 引用的目录名不变，DSH 侧不需要任何动作；想锁版本就在包名后带 `@0.3.1`。
`-DryRun` 只打印计划，不联网不落盘。替换旧版本时脚本会先摘掉目录内的垫片 junction 再删
（PowerShell 5.1 的 `Remove-Item -Recurse` 会跟进 junction 删到共享模块里，这一步是防它的）。

卸载（`uninstall.ps1`）只拆 junction 与 profile 清单项，`~/.dsh/plugins/dsh-memory` 会保留
（想彻底清掉手动删即可），记忆数据依旧只随 `-PurgeStorage` 删。

### 发布新版本（维护者）

```powershell
npm publish --registry https://npm.pkg.github.com --access public
# 凭据：把带 write:packages 的 PAT 写进 ~/.npmrc 的 //npm.pkg.github.com/:_authToken，
# 或临时用环境变量注入，不要把 token 提交进仓库。
```

## 档案（默认视图）

面板默认是**档案**视图，形状照着 WorkBuddy 的「记忆与进化」页做。它只有一样东西：
**一个工作区一份长记忆**——正文是连续文档，由对话里的 `memory` 工具维护，用户不需要在这里逐条新建、
也不需要理解「条数」。

同一个视图有第二种排布，用右上角的下拉切换（默认是 `整篇文档`）：

| 排布 | 长什么样 | 什么时候用 |
| --- | --- | --- |
| **整篇文档** | 一条接一条的 `**标题**` + 正文，读起来是一篇文档 | 平时看/改「这个工作区记住了我什么」 |
| **按标签分组** | 每个分区里按标签归类成一叠可折叠的组，没有标签的落进「未归类」排在最后 | 散条目多，想按主题收拢 |
| **按类型分组** | 同上，但按 `category`（事实/偏好/决策/约定/组件/待办/笔记）归类 | 想按记忆种类过一遍 |

> v0.3.1 之前这是两个平级视图——「档案」和「记忆空间」——内容完全重合；现在合成一个视图的两种排布。

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
| `directory` | `""` | 数据库位置，空 = `~/.dsh/storages/dsh-memory` |
| `mirror` | `true` | 在工作区写 `.dsh-memory/MEMORY.md` |
| `briefing` | `true` | 会话开始注入记忆简报 |
| `briefMode` | `"index"` | `index` 一行一条索引（省 token）；`full` 标题+正文摘录 |
| `briefingLimit` | `12` | 注入条数上限（1–50） |
| `briefingMaxChars` | `2000` | 注入字数上限（200–20000） |
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

## HTTP 契约

`/memory/api` 前缀，JSON 信封成功 `{ok:true,…}` / 失败 `{ok:false,error,detail?}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 版本、工作区、统计、设置、类别、工作区列表、标签、最近提炼、最近简报计量 |
| GET | `/list` | 列表；`q/category/scope/tag/archived/sort/limit/offset`（不含草稿） |
| POST | `/save` | 新建或合并；带 `supersedes` 走版本链（旧条归档、可回滚） |
| POST | `/update` | 改一条（含 `related` / `keywords`） |
| POST | `/bulk` | `delete` / `archive` / `unarchive` / `pin` / `unpin` |
| POST | `/delete` | 删一条 |
| POST | `/settings` | 写设置 |
| GET | `/health` | 体检：重复簇、过期未用、断链、待审草稿数（只报告） |
| POST | `/health/resolve` | 一键处理：`merge`（合并簇）/ `archive`（归档过期）/ `unlink`（摘除断链） |
| GET | `/timeline` | 全部记忆（含归档、不含草稿）按更新时间倒序 |
| GET | `/queue` | 待审草稿队列 |
| POST | `/queue/approve` | 批准草稿（可带编辑字段；草稿带 `supersedes` 时兑现版本链） |
| POST | `/queue/reject` | 拒绝草稿（默认删除，`mode: archive` 归档留底） |
| POST | `/supersede/rollback` | 版本链回滚：传新条 id 恢复旧条，或传旧条 id 撤销推翻 |
| GET | `/export` / POST `/import` | 导出 / 导入（备份载荷、纯文本，或 `path`/`paths` 指到本机既有记忆文件） |
| GET | `/import-scan` | 扫描本机既有记忆来源（Qoder / WorkBuddy / 本插件镜像），只读 |
| POST | `/import-scan` | 按来源 id 或路径导入，用户级来源自动进全局库 |
| GET | `/mirror` | 取当前工作区镜像的 Markdown |
| POST | `/capture` | 立刻提炼一次（`captureMode` 决定落库还是进队列） |
| POST | `/distill` | 只返回候选，不落库 |
| GET | `/ping` | 存活探测 |

## 时间线 / 健康 / 审批

- **时间线**：全部记忆（含归档）按更新时间倒序、按日分组，类别色签 + 来源 + 时刻，支持过滤；
  点条目直接打开编辑器。回答「这条记忆是什么时候、为什么记下的」。
- **健康**：KPI 卡（总数、利用率、待审草稿、最近一次简报注入的字符数与 token 粗估）+
  体检问题清单——重复簇（一键合并，源条目归档可恢复）、过期未用（一键归档）、
  断链（`related`/`supersedes` 指向不存在的记录，一键摘除）。
- **审批**：`captureMode: draft` 时自动提炼的候选先进这里；每张草稿卡可**批准**、
  **编辑后批准**（编辑字段随批准请求一起提交）、**拒绝**（默认删除，草稿从未生效）。
  草稿不进简报、不进检索、不进镜像——批准之前对模型完全不可见。

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

8 个套件、300 项：

- `store` 90 项 —— 工作区分库、去重合并、检索打分（带 query 只返回真命中）、镜像（含真在工作区落盘 / 关开关撤回 /
  工作区不存在时不造目录）、导入导出、并发写；v0.3.0：版本链 supersede/rollback、user 类别强制全局与跨库迁移、
  草稿四不可见、重复簇聚类与合并、体检（重复/过期/断链/草稿）、索引简报预算、镜像版本链线索、keywords 加权、unlink。
- `markdown` 39 项 —— WorkBuddy 笔记/日报、Qoder frontmatter、纯文本、格式识别、粗体子标题
  再切一层、Qoder 索引页剔除、本机扫描只读。
- `distill` 41 项 —— 摘录裁剪、模型输出解析容错、触发条件、显式提示词识别；v0.3.0：
  keywords/supersedes 解析、user 类别强制 global、提示词 v2 指引、existingRecords 带 id。
- `api` 55 项 —— 22 个端点、错误码、参数校验、按路径/文本导入与来源扫描；v0.3.0：
  /health 与 /health/resolve、/timeline、草稿队列（批准带编辑 / 拒绝 / 带 supersedes 的批准兑现版本链）、
  /save 带 supersedes 与 /supersede/rollback。
- `host` 10 项 —— 导出形状、Config 默认值与越界校验。
- `activate` 24 项 —— 假装自己是 cordis，把 `apply()` 真跑一遍（走真实 store 并落盘）：
  工具 save/search/get/forget、全文简报装不下时明说「只列了 N / M 条」、`/memory/api/*` 路由真的应答
  且守好 403/404、手动提炼端到端、面板保存落到工作区镜像、既有记忆扫描导入、数据目录不可用不炸外壳；
  v0.3.0：索引简报（带 id 不展开正文 + full 模式对照）、轮末召回（召回块出现、连续两轮不重复）、
  captureMode=draft 全流程（进队列 → 不进列表 → 日志 drafted → 批准生效）、
  工具 save 带 supersedes（旧条归档、get 展示版本链）。
- `client` 32 项 —— 客户端半的模块格式、槽位注册、导航项标记与卸载，以及**真的把设置页渲染出来**
  接到真实 `store` + `api` 上驱动交互（列表 / 搜索 / 新建 / 删除 / 置顶 / 中英文切换 / 后端报错）；
  档案视图的分区与两种排布（整篇文档 / 按标签分组 / 按类型分组、分区与分组折叠、组头「整合」、
  整篇编辑、整理永远按标签算、开关即时落库；v0.3.1：档案与记忆空间合并成同一个视图）；v0.3.0：
  时间线 tab（含归档、点条目开编辑器）、健康 tab（KPI 与体检结果）、审批 tab（批准转正 / 拒绝删除 /
  数量徽标 / 无草稿时 tab 消失）。
- `install` 9 项 —— 在临时目录里搭假 DSH 主目录，真跑 `install.ps1` / `uninstall.ps1`：
  备份内容与原始一致、幂等、`-DryRun` 不落盘、卸载还原、`-PurgeStorage` 才删数据、
  以及两种抵赖（包根不对 / junction 位置是真实目录时拒绝删除）。测试对控制台编码自适应
  （中文 Windows 的 GBK 代码页下 pwsh 输出按 GBK 解码，英文环境按 UTF-8）。

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
