# Changelog

本项目的用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 SemVer；日期用 `Asia/Shanghai`。

## [Unreleased]

### Added

- 暂无。

### Changed

- 暂无。

### Fixed

- 暂无。

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
