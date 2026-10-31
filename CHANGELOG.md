# Changelog

本项目的用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 SemVer；日期用 `Asia/Shanghai`。

## [Unreleased]

- 暂无。

## [0.6.9] - 2026-10-31

### Changed

- 降低记忆插件的 token 成本：`autoCapture` 跳过续跑发言、上次 0 候选后退避 5 分钟；蒸馏输入已有记忆上限 60→24、对白摘录默认 6000→4000 字。
- 轮末召回本会话内去重（同一记忆不重复注入），新增 `turnRecallMaxChars` 默认 800，单条正文截断 300→200 字。
- 压缩 `memory` 工具描述（约 2040→851 字符），减少每次请求的固定 schema token。
- 0.6.9 已发布到 npmjs，安装命令不变。

## [0.6.8] - 2026-10-31

### Added

- 新增 GitHub Pages 落地页：安装命令、画像看点、证据 / 版本 / 审计说明与 GitHub / npm / Discussions 入口。
- 新增前台会话记忆卡：挂在宿主 `shell.overlay` 上的右下角悬浮卡，按会话展示当轮诉求与本会话已沉淀记忆（草稿与归档不可见）；每次内容变化刷新「更新于 HH:MM」；可收起 / 拖拽，位置本地记住；数据走新增的 `GET /session-brief`，不传会话时由宿主用最近活动会话兜底。
- 设置 → 记忆新增「该对话记忆」开关（默认开启）：只控制当前对话的前台会话卡，关闭状态存在本地，不影响长期记忆、其它对话或工作区配置。
- 市场元数据：`dsh.marketplace` 声明 web / desktop、需要重启、桌面端有手动安装步骤；`dsh.permissions` 声明本地读写、无外发网络、仅调用本地 `git` 做工作区身份识别。
- 新增 `tools/check-compat.mjs`：本地核对 README 兼容表与 `package.json`；`--npm` 再核对 npmjs 上已发布的同一版本。CI 在推 `main`、发 GitHub Release、发 npmjs 后各跑一次。

### Changed

- 修正 DSH STORE 契约：入口 ID 改为 `dsh-memory-portrait`；DSH 兼容范围按 0.2 版本线声明为 `>=0.2.0-rc.2 <0.3.0-0`，逐版本测试结论记在 `dsh.compatibility.dshReleases`（`0.2.1-rc.3` / `0.2.1-rc.5` compatible，`0.2.1-rc.4` / `0.2.2-alpha.2` unknown）。
- 安装范围明确为 **web / 桌面**；headless / TUI 尚未做端到端验证，暂不声明（host 半不依赖 `webServer`，但本轮 headless profile 缺模型凭据，无法完成实测）。
- 0.6.8 已发布到 npmjs，安装命令不变。

### Fixed

- 修复 DSH 0.2.1-rc.5 下插件被宿主静默跳过：原范围 `<0.2.1-rc.4` 把当前桌面版排除在外，启动时 bundle 进 `skippedBundles`，市场卡片显示“已安装，与当前 dsh 不兼容”，记忆面板 / `memory` 工具 / `/memory/api` 全部不生效。范围改为 0.2 版本线后，rc.5 启动正常加载；同一提交补了清单声明一致性测试，防止两处范围再次漂移。

## [0.6.7] - 2026-10-28

### Changed

- 品牌更名为 **Memory Portrait / 记忆画像**；GitHub 仓库改为 `BangBang-03/dsh-memory-portrait`，旧 URL 自动重定向。
- npm 包名保持 `@bangbang-03/dsh-memory`，安装命令不变；0.6.7 已发布到 npmjs。
- README 首屏、hero、社交预览、仓库 topics、Release 标题同步更新；Release 标题改为 `v0.6.7 · Memory Portrait`。
- 发布模型收敛为单一 `main` + `v*` 标签；`lab` / `lab-latest` 已删除。
- 新增 CONTRIBUTING、issue 模板、Discussions 入口与发布素材 `docs/launch-copy-2026-10-28.md`。

### Fixed

- 无新增修复；0.6.6 的会话索引脱敏已包含。

## [0.6.6] - 2026-10-27

### Fixed

- `sessionLogAppend` 会话索引落盘前先做密钥脱敏（D3），避免会话原文里的 npm token 落盘。

### Changed

- npm 补发 0.6.6（此前只在 GitHub Release / GitHub Packages）。
