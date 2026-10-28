---
name: docs-sync
description: 本仓库的文档与日志同步流程。用户说「更新文件 / 更新文档 / 同步文档 / 更新日志 / 更新 changelog / 把这次改动写进 README 或 AGENTS」时使用。默认同步 README、AGENTS、docs/REFERENCE、docs/README、CHANGELOG，并追一条 memory journal；只改一个文件不算完成。发版流程另见 skills/release/SKILL.md。
---

# 文档与日志同步

这个 skill 解决的是「代码/配置/发布改了，文档只改了一处」的常见漂移。默认把用户可见入口、agent 路由、完整规格、变更日志和当日工作日志一起对齐；不追求把每份历史快照都改一遍。

## 什么时候用

- 「更新文件」「更新文档」「同步文档」「把这次改动写进 README / AGENTS」。
- 「更新日志」「更新 changelog」「补发版记录」「发版后补日志」。
- 完成一次功能、修复、配置或命名变更后，用户要求收尾。
- 只改代码、只跑测试、只发版时不要套用；发版走 [`skills/release/SKILL.md`](../release/SKILL.md)。

## 默认更新面

| 用户说 | 默认动作 |
| --- | --- |
| 更新文件 / 更新文档 / 同步文档 | `README.md` + `AGENTS.md` + `docs/README.md`；行为/UI/配置变化再加 `docs/REFERENCE.md`；检查链接、版本、包名 |
| 更新日志 / 更新 changelog | `CHANGELOG.md` 的 `[Unreleased]` + `memory` 工具的 `action=journal`；刚发版时补 Release notes |
| 把这次改动写进文档 | 上面全部，再加受影响的 `docs/*.md` 专题 |
| 只改了代码 | README 只在用户可见时改；CHANGELOG 记用户可见变化；journal 必追 |

「更新日志」不是只写一句 commit message：`CHANGELOG.md` 记用户能感知的 Added / Changed / Fixed；`memory` journal 记这次工作本身；Release notes 只在发版时更新。

## 按改动类型选文件

| 改动 | 必须看 |
| --- | --- |
| 安装方式、命令、依赖、包名 | `README.md` 安装段、`AGENTS.md` 的 C1/P7/命令速查、`package.json`、`install.ps1`、`CHANGELOG.md` |
| 配置键、默认值、HTTP 端点 | `README.md` 的「配置」「HTTP 契约」表（C7）、`AGENTS.md` 路由、`test/host.test.mjs`、`CHANGELOG.md` |
| 设置面板 / 交互 / 空态 | `README.md` 功能段、`docs/REFERENCE.md`、`docs/README.md`、`CHANGELOG.md` |
| 画像 / Dream / 检索 / 安全 | `README.md` 摘要、`docs/REFERENCE.md`、对应评测文档、`CHANGELOG.md` |
| 仓库名 / 品牌 / 发布模型 | `README.md`、`AGENTS.md`、`package.json` 的 repository/homepage、`install.ps1`、`tools/*`、workflow、issue 模板、`CHANGELOG.md` |
| 纯文档 | README / AGENTS / docs；不 bump 版本 |
| 正式发版 | 先走 `skills/release/SKILL.md`，再补 CHANGELOG、journal、Release notes |

## 顺序

1. 先看 `git status --short` 和当前分支；只允许在 `main` 上提交。发版场景先读 release skill。
2. 判断改动类型，按上表列出这次要动的文件；不要凭感觉只改 README。
3. 先改 `README.md`：用户 30 秒内要看到安装、能力、边界。完整规格不往这里堆。
4. 改 `AGENTS.md`：只动路由、命令、包名/分支/发布事实和红线；不要把设计说明抄进去。
5. 改 `docs/REFERENCE.md`：行为、UI、配置、HTTP 变化才动；它是完整规格存档，不是第二份发布合同。
6. 新增专题文档时改 `docs/README.md` 的索引；历史快照不要为了「当前状态」重写。
7. 改 `CHANGELOG.md`：用户可见变更放 `[Unreleased]` 的 Added / Changed / Fixed；发版时移到 `[X.Y.Z] - YYYY-MM-DD`。
8. 用 `memory` 工具 `action=journal` 追一条当日工作日志；用户明确要求「记住」时才 `action=save`。
9. 做一致性检查，再提交/推送。

## 一致性检查

- **包名 C1**：`@bangbang-03/dsh-memory` 在 `package.json`、`cordis.patch.yml`、`lib/client.js` 的 `id`、profile 的 dependencies/bundles 四处必须一致。品牌名变了也不改包名。
- **仓库地址**：当前是 `BangBang-03/dsh-memory-portrait`；旧 URL 会重定向，但新文档统一写新地址。npm 包名仍是 `@bangbang-03/dsh-memory`。
- **C7**：改端点 / 配置键 / 默认值，必须同步 README 的「配置」「HTTP 契约」表和 `test/host.test.mjs`。
- **C4**：提到简报时保持「字节稳定 / 会话级冻结 / 只用 `createdAt`」的措辞，别写成按 `useCount` 或 `updatedAt` 排序。
- **版本**：`package.json`、hero 图底部版本、Release 标题、CHANGELOG 不要各说各话；纯文档不改版本号。
- **链接**：相对链接和绝对链接都检查；改仓库名时同步 README 的 badge / raw 图 / Releases / issues / discussions。
- **校验**：`git diff --check`；改 workflow 用 `python -c "import yaml..."` 解析；改 `tools/*.mjs` 跑 `node --check`；改代码跑 `node test/run-all.mjs`。如果本机测试有环境性旧失败，记录具体套件，不要谎报全绿。
- **推送**：只用 `node tools/push.mjs --branch main`（P3），不要用 `git push`；正式标签走 release skill，不用本 skill 打 tag。

## 不要做

- 不要只改 README 就宣布「文档更新完了」；AGENTS 路由和 CHANGELOG 往往才是下一次会踩的坑。
- 不要为纯文档提交 bump 版本号；版本号跟着发布走。
- 不要把「配置 / HTTP 契约」复制到 `docs/REFERENCE.md` 当第二份合同；README 是合同，REFERENCE 是存档。
- 不要改 `docs/market-*`、`docs/competitive-*` 这类带日期的快照来假装是最新状态；新增带日期的文档或在顶部加一句历史注记。
- 不要把品牌名改成 git tag（`vX.Y.Z` 不动）；品牌放 Release 标题和 repo topics。
- 不要在没有验证时写「测试全绿」。
