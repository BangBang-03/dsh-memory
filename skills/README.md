# 项目级 skills

本目录只放本仓库自己的 skill，不安装到 Qoder 用户目录。入口在 `AGENTS.md` 的「2.4 项目级 skills」。

| skill | 用途 |
| --- | --- |
| [`release/SKILL.md`](release/SKILL.md) | 正式发版、同步 `main`、打 `v*` 标签、核对 Release |

新增 skill 的约定：

- 目录名与 frontmatter 的 `name` 一致，用 kebab-case。
- `SKILL.md` 必须带 `name` 与 `description`；`description` 写清触发场景，不能只写「发版」。
- 可执行脚本放在 `scripts/`，只依赖 `node:*` 与仓库相对路径（AGENTS P7）。
- 新增后在 `AGENTS.md` 2.4 加一行路由，不要只靠目录名被发现。
