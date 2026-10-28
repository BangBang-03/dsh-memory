# .github/workflows

单一 `main` + `v*` 标签发布模型：`main` 推送只跑测试，`v*` 标签才发正式版。

| 文件 | 触发 | 产物 |
| --- | --- | --- |
| `publish.yml` | push 到 `main`、push `v*` 标签、手动 | `main`：只跑纯逻辑层测试；`v*`：`latest` 正式版 + Release 资产 |
| `publish-npmjs.yml` | push `v*` 标签、手动 | 发到 npmjs 公共源；未配置 `NPM_TOKEN` 时警告并跳过，不判红 |

安装脚本只认一个固定资产名：

- `releases/latest/download/dsh-memory-latest.tgz` —— 正式版

只改文档可在提交信息里写 `[skip ci]`。**推 `main` 会跑测试但不发版**；正式版必须靠 `v*` 标签。
发布前跑 `node test/run-all.mjs`；标签只能打在已经推送并通过测试的 `main` 上（`AGENTS.md` P8）。
