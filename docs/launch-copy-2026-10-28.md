# 发布素材（2026-10-28）

定位一句话：**DSH 的记忆账本——模型记得住项目，但改不掉你的红线。**

三个可发的角度，按渠道选一个，不要同一段群发：

1. **安全审计**：市场 `memory` 分类下载前 20 里，10 个要 shell、13 个要 env、3 个加载动态代码（2026-10-22 快照）；
   这个插件 `dependencies` 为空，不 shell、不 env、不出站，写入前做密钥脱敏与注入隔离。
2. **prompt cache**：简报排序不读 `useCount` / 当前时间，会话级冻结，日期戳只用 `createdAt`；
   记忆更新不会让系统提示逐轮变化、把前缀缓存整段打掉。
3. **治理**：红线逐字置顶、审批队列、版本链、注入审计、派生链——记忆不是“模型随手写的小抄”，是可回滚、可解释的工件。

安装口令（统一用 Release 资产，拿到最新稳定版）：

```powershell
dsh plugin --profile web add "https://github.com/BangBang-03/dsh-memory-portrait/releases/latest/download/dsh-memory-latest.tgz"
```

## V2EX

标题：**给 DSH 做了个「模型改不掉红线」的工作区记忆插件**

正文：

> 开新会话就要重新解释项目，这件事我忍了很久。市面上的记忆插件大多在比“谁记得多”，但真用起来更疼的是“记错了怎么办”：模型把一次临时决定写成长期约定，或者把旧结论和新结论揉在一起。
>
> 所以我做了 dsh-memory：会话开始注入一份索引简报（一行一条，正文按需取），轮末用本地检索召回相关记忆，可选地把对话提炼成结构化记忆。重点在治理：
>
> - 红线逐字置顶，模型不能删改，改稿留历史可回滚；
> - 自动提炼可先进审批队列，草稿不进简报 / 检索 / 镜像 / 导出；
> - 每次真正进 prompt 的内容都有正文 hash、命中的 id、被预算挤掉的条目；
> - 画像 / AGENTS.md 有派生链，源记忆失效会沿链标脏。
>
> 零运行时依赖，不 shell、不 env、不启子进程、不出站；581 条测试。代码：https://github.com/BangBang-03/dsh-memory-portrait
>
> 想听两类反馈：① 你更想要“自动多记”还是“先审后记”；② 面板里哪个信息你最常看。

## 即刻

> 给 DSH 写了个记忆插件，主打一个“模型改不掉你的红线”。
>
> 会话开始注入索引简报，轮末本地召回，自动提炼可以先进审批队列；红线逐字置顶，版本链可回滚，每次注入都有审计。
>
> 零依赖、不出站、581 条测试。https://github.com/BangBang-03/dsh-memory-portrait

## X / Twitter

1/ DSH users: your agent remembers the project, but can it silently rewrite your rules?

I built dsh-memory — long-term workspace memory with redlines, an approval queue, a version chain, and an injection audit.

2/ How it works:
- compact index at session start, bodies fetched on demand
- local recall at turn end (0 model cost)
- optional distillation into an approval queue
- byte-stable briefing so prompt cache survives

3/ The part I care about: memory is a governed artifact.
Redlines are injected verbatim, edits keep history, every injection has a hash + ids, and portraits/AGENTS.md have derivation links.

4/ Zero runtime dependencies. No shell, no env, no outbound requests. 581 tests.
https://github.com/BangBang-03/dsh-memory-portrait

## Reddit r/DeepSeek

Title: **dsh-memory: long-term workspace memory for DSH with redlines, approval queue, and injection audit**

Body:

> I kept re-explaining the same project every session, so I built a memory plugin for DSH. Most memory plugins optimize for "remember more"; I optimized for "what happens when it remembers wrong".
>
> - compact index injected at session start, bodies fetched on demand
> - local recall at turn end (no model cost)
> - optional distillation; draft mode puts candidates in an approval queue
> - redlines injected verbatim, model cannot delete/edit them; edits keep history and can be rolled back
> - every injection audited (body hash, memory ids, dropped entries)
> - portraits and AGENTS.md carry derivation links
>
> Zero runtime dependencies; no shell, no env, no outbound requests. 581 tests.
> Repo: https://github.com/BangBang-03/dsh-memory-portrait
>
> Happy to hear which tradeoff you'd pick: auto-capture by default, or review-first?

## 小红书（6 页提纲）

1. 封面：**开新会话不用再解释项目了**（副标题：DSH 记忆账本）
2. 痛点：每次都要重讲背景 / 模型把临时决定当长期约定
3. 它做什么：索引简报 + 轮末召回 + 可选提炼
4. 治理：红线置顶、审批队列、版本链、注入审计
5. 安装：一条 Release 命令（截图）
6. 结尾：零依赖 / 581 测试 / GitHub 链接；评论区问“你最想让 AI 记住什么”

## 发布纪律

- 一天一个渠道；先发 V2EX / 即刻，再看反馈决定小红书 / X。
- 不写“求 star”；结尾问一个具体问题，评论比 star 更能带来曝光。
- 同一段文字不要跨渠道复制；每个渠道换开头和例子。
- 发布后 24 小时内回完评论；把高频问题补进 README 的 FAQ。
- 记录：渠道、曝光、点击、安装、star、npm 下载；一周后只保留有效的两个渠道。
