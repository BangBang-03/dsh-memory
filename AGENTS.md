# AGENTS.md

DSH 的工作区长期记忆插件（真包名 `@bangbang-03/dsh-memory`）。本文件只放两样东西：**改代码不能踩的红线**、
**改什么该动哪个文件的路由表**。设计取舍、竞品对标、机制说明在 `README.md`，不要往这里抄。

结构一句话：宿主半 `lib/index.js`（简报注入 / `memory` 工具 / `/memory/api` 路由 / 轮末召回）+
客户端半 `lib/client.js`（设置面板「记忆」页）+ 其余 `lib/*.js` 纯 Node 逻辑层（不 import 任何 DSH 运行时，可脱离宿主单测）。

分支一句话：GitHub 默认分支是 **`lab`**（开发线，永远领先）；**`main` 只是备份线**，只在快进时动。
推 `main` 不触发任何 CI —— `.github/workflows/publish.yml` 只监听 `lab` 与 `v*` 标签。

---

## 1. 红线

### 1.1 契约红线（改了就静默坏，不一定会红测试）

| # | 红线 | 违反了会怎样 |
| --- | --- | --- |
| **C1** | 真包名 `@bangbang-03/dsh-memory` 必须逐字一致地出现在四处：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`lib/client.js` 的 `id`、profile 的 `dependencies` 键与 `dsh.profile.bundles` 项 | 写成别名时宿主半照常工作、设置面板**整块消失**（0.3.2 踩过，0.3.4 修）。`test/client.test.mjs` 有断言守着 |
| **C2** | 客户端访问后端一律 `new URL("memory/api/…", document.baseURI)`，不写死 `/memory/api`，不用以 `/` 开头的绝对路径 | 反代目录前缀 / `dsh-app://` 外壳下请求打不到宿主，面板一片 404 |
| **C3** | 注入段默认 `sectionOrder: 550`，不要挪 | 它夹在 PLAN_POLICY(500) 与 TEAM_POLICY(600) 之间；挪了会跟别的段抢位置 |
| **C4** | 简报必须**字节稳定**：会话级冻结 + 确定性排序，排序与行内字段不得读 `useCount` / 曝光次数 / 当前时间；行内日期戳只能用 `createdAt`（不可变），**不能用 `updatedAt` / `lastUsedAt`**（`markUsed` 会刷） | `briefing-stability` 会红；真放出去是系统提示逐轮变化、缓存命中率整体下降 |
| **C5** | 只监听 `session/event` 的 `turn/end`。**不要**挂 `agent/turn-stopping` | 那个事件是串行 await，长活会拖住整个轮次收尾 |
| **C6** | `status: draft` 四不可见：不进简报、不进检索、不进镜像、不进导出 | 待审队列形同虚设，没被批准的模型产出直接生效 |
| **C7** | 加端点 / 加配置键 / 改默认值 → 同步三处：`cordis.patch.yml`、README 的「配置」与「HTTP 契约」表、`test/host.test.mjs` 的默认值断言 | README 是发布合同；默认值只改代码不改 patch，用户装上去还是旧值 |
| **C8** | 红线（`category: constraint`）的治理链不得松动：`store.remove` / `patchRecord` 默认拒绝（`redline_protected`），`overrideRedline` **只能**从面板确认（`POST /delete` 显式传）进来，`memory` 工具的 forget / HTTP 默认路径永不透传；简报里红线先于预算挑选、措辞逐字渲染（不经 LLM 重写软化） | 模型一句话删掉用户的绝对禁令，或禁令被画像重写悄悄改写措辞 |

### 1.2 数据与隐私红线

| # | 红线 | 违反了会怎样 |
| --- | --- | --- |
| **D1** | 主库只落 `~/.dsh/storages/dsh-memory`，**永不进仓库**；仓库里唯一的记忆文件是 `.dsh-memory/MEMORY.md` 镜像 | 记忆随 git 外泄给所有人 |
| **D2** | 工作区镜像只在 `mirror: true` **且工作区目录真实存在**时写 `<ws>/.dsh-memory/MEMORY.md`；关开关要能撤回；不许凭空造目录 | 用户删了工作区却被插件重建；关开关后残留 |
| **D3** | 每条写入路径（工具、面板、导入、晋升、自动提炼）都必须过 `lib/security.js`：密钥脱敏 + 注入模式 taint | 密钥落盘、taint 内容被当指令执行 |
| **D4** | `trust` 只能由写入来源推导，模型**不能自封** `user`；非 user 来源命中 taint 一律隔离成草稿 | 提权：模型自己给自己写「用户指令」 |
| **D5** | `lib/index.js` 的 `route()` 里 `isTrusted()` 必须是第一道门，非回环来源一律 403 | 局域网内任意网页能读写你的全部记忆 |
| **D6** | 注入措辞必须框成「背景资料」，自动提炼结果必须标来源 | 记忆变指令：三个月前的对话被当成当前任务 |
| **D7** | 归档 / `supersedes` 而不是删除；推翻要能回滚 | 历史没了，用户改错一次就永久丢数据 |

### 1.3 流程红线（发布 / 安装）

| # | 红线 | 违反了会怎样 |
| --- | --- | --- |
| **P1** | 只在 `lab` 上提交，**`lab` 必须领先 `main`**；`main` 是备份线，只 `merge --ff-only`，不在上面直接提交、不产生 merge commit | 快进失败 = 两线已分叉，**停下来查清**，不要用 rebase / force 掩盖；`main` 落后就等于备份里没有最新代码 |
| **P2** | 已推送的 `lab` 不 amend、不 rebase、不 force push | 远端已开 `allow_force_pushes=false`；改写历史会造平行提交，CI 与其它 clone 全对不上 |
| **P3** | git 与 REST 两条推送通道**不要混用** | REST 重建的提交时区归一成 `+0000`，同树不同 SHA，混推就是分叉 |
| **P4** | 改 `~/.dsh/profiles/**` 前必须备份（`install.ps1` 自带秒级时间戳备份，手工改也要先备份） | 把用户的 DSH 装坏且无从回滚 |
| **P5** | 卸载 / 替换只动 junction 与清单项；碰到同名**真实目录**直接报错退出，不许 `Remove-Item -Recurse` | PowerShell 5.1 会跟进 junction 删到共享的 `@deepseek-ai/*`（脚本里已专门防这一步） |
| **P6** | 改完跑 `node test/run-all.mjs`（14 套件 / 538 断言）**全绿**才算改完；纯文档提交可跳过 | `store` / `api` / `briefing` 三套守的是数据完整性与注入稳定性 |
| **P7** | 不加运行时依赖：`dependencies` 保持空，`peerDependencies` 全 optional，`lib/*.js` 只许 import `node:*` 与相对路径 | 插件要在用户机器上零安装；加依赖等于要求所有人重装 |
| **P8** | 正式版只在 `main` 打 `v*` 标签——**打之前先把 `main` 快进到 `lab`**，且 `package.json` 不许是 `-lab.N` 预发布号；不手改远端保护设置 | 标签挂在落后的 `main` 上，`/releases/latest` 发出去的就是旧代码；预发布号漏上去再也升不回来 |

---

## 2. 路由表

### 2.1 改什么 → 动哪

| 你要改什么 | 主文件 | 一起看 | 必须跑 |
| --- | --- | --- | --- |
| 记录模型、去重合并、版本链、镜像、导入导出、体检、画像存取 | `lib/store.js` | `lib/quality.js`、`lib/text.js` | `store` |
| 检索打分（BM25F / 精确短语 / related 一跳 / 同义词扩展） | `lib/retrieval.js` | `test/fixtures/retrieval-hard-60.json`、`docs/retrieval-eval-2026-10-20.md` | `retrieval` |
| 简报注入、`memory` 工具、轮末召回、路径 JIT、路由挂载、Config schema | `lib/index.js` | `lib/portrait.js`、`lib/api.js` | `activate` + `briefing-stability` + `host` |
| HTTP 端点、错误码、参数校验 | `lib/api.js` | README「HTTP 契约」表 | `api` |
| 设置面板 UI（四个 tab、档案视图、维护页、图标标记） | `lib/client.js` | `test/mini-react.mjs`、`locale/*.json` | `client` |
| 提炼提示词、模型输出容错、触发条件 | `lib/distill.js` | `lib/index.js` 里的 capture 流程 | `distill` |
| 画像段落、渲染 / 解析、预算截断、版本 diff | `lib/portrait.js` | `lib/store.js` 的 portrait 段 | `portrait` |
| 派生链（记忆 → 画像 → AGENTS.md 的源快照与标脏） | `lib/derivation.js` | `lib/store.js` 的 `promoteToAgents` | `derivation` |
| 失效条件（`falsifier`）与到期复审 | `lib/store.js` + `lib/api.js` | — | `verification` |
| 整库快照（`backups/` 轮转、`GET /backups`、`POST /backup`、Dream 前预备份） | `lib/store.js`（`snapshotLibrary` / `snapshots` / `mutate` 里的 `dailySnapshot`） | `lib/api.js` 的 `POST /dream`、`lib/client.js` 维护页「整库快照」卡 | `store` + `api` + `client` |
| 密钥脱敏 / taint 检测 / trust 分级 | `lib/security.js` | `lib/store.js` 的全部写入路径 | `security` |
| 质量分与低分闸门 | `lib/quality.js` | `lib/store.js` 的 `qualityFields` | `store` |
| 既有记忆解析（WorkBuddy / Qoder / Claude Code / Codex / Windsurf） | `lib/markdown.js` | 扫描落点 `memorySourceSpecs()` | `markdown` |
| 安装 / 卸载 / 远程安装 / 通道切换 | `install.ps1`、`uninstall.ps1` | `cordis.patch.yml` | `install` |
| 推送、发版、远端同步 | `tools/push.mjs`、`tools/release.mjs`、`tools/sync.mjs`、`tools/status.mjs` | 工作区根 `promote.ps1`、`PLUGIN-WORKFLOW.md` | 见 P6 |

### 2.2 症状 → 先去哪

| 现象 | 先查 |
| --- | --- |
| 设置面板整块不见，宿主半照常工作 | **C1**：包名 / 模块 `id` 不一致 |
| 面板请求全 404，或只在外壳 / 反代下坏 | **C2**：客户端 URL 拼接 |
| 系统提示每轮都在变、缓存命中率掉 | **C4** + `briefing-stability`：排序里混进了 `useCount` / 时间 |
| 同一条记忆出现两份、列表有重复 | `install.ps1` 的老别名迁移没跑；或 `dedupe` 被关 |
| `dsh plugin --profile desktop add …` 被拒 | 正常：desktop profile 由桌面端独占，走 `install.ps1` |
| 该进简报的记忆没进 | `GET /briefing-preview` 看它是不是被预算挤掉（`briefingLimit` / `briefingMaxChars`） |
| 自动提炼写了不该写的东西 | 先看 `captureMode` 是不是 `direct`；`draft` 会进待审队列 |
| 库被误删 / 面板点了清空 | 看 `<库根>/backups/`：每天第一次写入 + 每次 Dream 前各留一份，轮转 7 份；拷回目录即恢复（面板不做自动覆盖） |
| 改完代码界面没变 | 宿主半（`lib/index.js` 等）改动要**重启 DSH**；纯客户端改动 `Ctrl+Shift+R` 硬刷新即可 |

### 2.3 文档路由

| 想了解 | 读 |
| --- | --- |
| 全部机制、配置表、HTTP 契约、边界 | `README.md` |
| 分支 / 发版 / 推送通道与事故复盘 | 工作区根 `PLUGIN-WORKFLOW.md` |
| 检索方案与基线数字 | `docs/retrieval-eval-2026-10-20.md` |
| 简报为什么必须字节稳定 | `docs/briefing-cache-safety.md` |
| 与 WorkBuddy 个人记忆的差距 | `docs/personal-memory-parity.md` |
| 市场同类扫描、插件自查与竞品 | `docs/market-scan-2026-10.md`、`docs/dsh-memory-landscape-2026-10.md` |
| 头部这一个月的新机制、可抄清单与优先级 | `docs/competitive-delta-2026-10-20.md` |

---

## 3. 命令速查

```powershell
node test/run-all.mjs                  # 14 套件 / 538 断言，改完必跑（P6）
node test/store.test.mjs               # 单套件：把 store 换成 retrieval / api / client …

pwsh -File install.ps1 -DryRun         # 只看要改什么，不落盘
pwsh -File install.ps1                 # 本地装（junction + profile 清单）
pwsh -File install.ps1 -FromRelease    # 远程装 lab；加 -Channel stable 换稳定线
pwsh -File uninstall.ps1 [-PurgeStorage]

node tools/status.mjs                  # 两条线的头、lab/stable 通道、最近 CI
```

```bash
git push origin lab                             # 平时只推这一条：触发 CI 发 -lab.<run> 预发布
git checkout main && git merge --ff-only lab    # 同步备份线：main 上唯一允许的动作（不发布任何东西）
git push origin main                            # 备份上线；publish.yml 不监听 main，静默
git checkout lab                                # 同步完回开发线
git tag vX.Y.Z && git push origin main --tags   # 正式版：先快进 main 到 lab，再 bump 版本、打标签
```

---

## 4. 已知坑（是设计边界，别顺手「修」）

1. **普通 `GET /export` 只覆盖条目；`?full=1` 连画像 / 派生链 / 日志（注入审计任何载荷都不含）**。
   full 载荷经 `POST /import` 自动回灌（画像空不覆盖、派生链按 `updatedAt` 合并、日志去重追加）。
   要字节级整库搬运用 `backups/` 快照，但**恢复是手工的**：面板只列清单与路径，不替你覆盖当前数据。
2. **派生链只审源端**：它回答「这条记忆现在还成不成立」，不回答「AGENTS.md 里那行还在不在」。手删晋升行，链上仍是 `fresh`。
3. **Windows 上 rename 偶发 `EPERM`**：杀软 / 索引器短时占住文件所致。`store.js` 的原子写已做**退避重试**
   （6 次、8–40ms 递增），彻底失败会先擦掉 `.tmp` 再抛。所以再红就是真问题——**别再习惯性「重跑一下」**。
4. **导航图标是 CSS 掩码贴上去的**：DSH 的 `settings.section` 不投影 icon，`syncNavMarker()` 靠「文本等于本插件本地化标题」认行。
   外壳改结构最坏结果是退回齿轮，不影响导航本身——不要为它去改 `configForms`。

---

## 5. 托管块（不要手改块内）

下面的 `dsh-memory:promoted` 块由插件自己维护：`POST /promote`、面板「晋升到 AGENTS.md」、`memory` 工具的 `promote`
都会往块里追加 `- **标题** — 正文` 行（幂等，重复晋升不产生重复行）。块外内容随便改。

<!-- dsh-memory:promoted 开始（由 dsh-memory 维护，请勿手工编辑本块） -->
<!-- dsh-memory:promoted 结束 -->

