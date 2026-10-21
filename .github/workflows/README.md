# .github/workflows

两条发布线各一个工作流，互不干扰。

| 文件 | 触发 | 产物 |
| --- | --- | --- |
| `publish.yml` | push 到 `lab`、push `v*` 标签、手动 | `lab`：`<下一补丁号>-lab.<run>` 预发布，tarball 挂到固定 tag `lab-latest`；`v*`：`latest` 正式版 + Release 资产 |
| `publish-npmjs.yml` | push `v*` 标签、手动 | 发到 npmjs 公共源；未配置 `NPM_TOKEN` 时警告并跳过，不判红 |

安装脚本只认两个固定资产名：

- `releases/latest/download/dsh-memory-latest.tgz` —— 稳定版
- `releases/download/lab-latest/dsh-memory-lab.tgz` —— 实验版

只改文档可在提交信息里写 `[skip ci]`。**推 `main` 不触发任何 CI**，正式版必须靠 `v*` 标签。
发布前跑 `node test/run-all.mjs`；标签只能打在已经快进到 `lab` 的 `main` 上（`AGENTS.md` P8）。
