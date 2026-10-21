# tools

维护仓库两条线（`lab` 开发 / `main` 备份与发版）的脚本。全部走 **GitHub REST API**：
本机连不上 `github.com:443`，只通 `api.github.com`，所以 `git push` / `git fetch` 不可用。

| 脚本 | 干什么 |
| --- | --- |
| `push.mjs` | 用 REST 把本地提交逐个在远端重建并推当前分支；tree sha 对不上就中止，不做强推 |
| `sync.mjs` | 用 REST 补齐远端对象并把本地 refs / 标签对齐到远端（等价 `git pull`），`--dry` 只看缺什么 |
| `release.mjs` | 在 `main` 上推代码并打 `v<package.json 版本>` 标签，触发正式发版；`--dry` 只检查 |
| `status.mjs` | 只读：默认分支、各分支头、最近 CI、lab 预发布与最新正式版 |

```powershell
node tools/status.mjs                 # 先看状态
node tools/push.mjs [--branch lab] [--dry]
node tools/sync.mjs [--dry]
node tools/release.mjs [--dry]        # 仅在 main 上、版本号已 bump 后
```

- token：优先 `GH_TOKEN` 环境变量，否则读本机 git credential store 里 `github.com` 的凭据。
- **不要把 git 推送与 REST 推送混用**：REST 重建的提交时区归一成 `+0000`，同树不同 SHA，混推会分叉（`AGENTS.md` P3）。
- 完整发版顺序与事故复盘见工作区根 `PLUGIN-WORKFLOW.md`。
