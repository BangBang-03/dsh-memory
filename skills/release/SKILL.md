---
name: release
description: DSH 记忆插件的推送、备份线维护与正式发版流程。默认每次只推 lab：推完后用 push.mjs 输出的 base（远端旧头在本地的对应提交）把 main 追到上一版，所以 lab 永远比 main 新一版。只有用户明确说「一起推 main」或「发版」时才让 main 追平当前 lab。用户说「发版 / 发布正式版 / release / 推 main / 同步 main / 打标签 / 核对 Release」时使用。按 AGENTS P1/P2/P3/P6/P8 执行；禁止用 git push 直连、禁止在 lab 打正式标签、禁止混用两条推送通道。
---

# DSH 记忆插件：推送与正式发版

## 适用场景

- 用户说「发版」「发布正式版」「release」「打 vX.Y.Z」：走完整正式版流程，`main` 追平 `lab` 并打标签。
- 用户说「推 main」「同步 main」但没有说要追平：默认把 `main` 追到 `push.mjs` 输出的 `base`（上一版在本地的对应提交），不打标签。
- 用户明确说「一起推 main」「把 main 推到最新」：`main` 追平当前 `lab`，不打标签。
- 发布后核对 Release 资产、CI 结论、`latest` 指向：直接跑 `tools/release-watch.mjs`。

## 先读

- `AGENTS.md` 的 P1 / P2 / P3 / P6 / P8：分支、推送通道、测试与标签的硬约束。
- `tools/release.mjs`：推 `main` + 建标签的现有实现；它现在只拒绝**已跟踪改动**，未跟踪文件（如 `.probe/`）不会阻塞发版。
- `tools/release-watch.mjs`：等待标签触发的 Actions，并核对 Release 是否成为 Latest、资产是否齐全。

## 不可违反

1. **lab 是唯一提交线，默认比 `main` 新一版**。推 lab 后用 `tools/push.mjs` 输出的 `base`（远端旧头在本地的对应提交）把 `main` 快进到上一版。只有正式发版或用户明确说「一起推 main」时，才让 `main` 追平当前 `lab`。`main` 上只允许 ff，不在上面直接提交。
2. **正式标签只在 `main` 头**。不在 `lab` 上打 `v*`；标签提交必须与 `main` 同一提交。
3. **只用 REST 通道**。所有推送走 `node tools/push.mjs` / `node tools/release.mjs`；不要用 `git push`，也不要在同一条分支上混用两种通道（P3）。
4. **版本号必须是正式号**。`package.json` 不能带 `-lab.N`；标签 `vX.Y.Z` 必须与它逐字对应。
5. **全量测试全绿才发**。`node test/run-all.mjs` 必须 14 套件 / 580 断言通过；纯文档改动可跳过，但发版提交包含 `package.json`，不能跳过。
6. **不改写历史**。已推送的 `lab` 不 amend、不 rebase、不 force push（P2）；`main` 快进失败就停下来查分叉（P1）。
7. **不发布未跟踪内容**。`.probe/`、本地审计材料等未跟踪文件不进入发布提交；不要为了发版把它们 `git add` 进去。

## 默认推送策略：lab 永远比 main 新一版

日常改完、推 lab 时，按这个顺序做；不要顺手把 `main` 追平当前 `lab`。

```bash
set -e
out=$(node tools/push.mjs --branch lab)
printf '%s\n' "$out"
if printf '%s\n' "$out" | grep -q '^synced   yes'; then
	echo "没有新提交，main 不动"
else
	base=$(printf '%s\n' "$out" | awk '/^base /{print $2; exit}')
	git checkout main
	[ -z "$base" ] || git merge --ff-only "$base"
	node tools/push.mjs --branch main
	git checkout lab
fi
```

- `base` 是**推 lab 之前**的远端旧 lab 头在**本地**的对应提交（tree 相同、SHA 可能不同）。REST 会归一化提交时区，
  所以不能直接 merge 远端旧 SHA；`push.mjs` 已经把本地对应提交算好并打印出来。
- 输出是 `synced   yes`（「已经同步，没有要推的提交」）时，不要动 `main`；没有新版本就没有上一版可追。
- 如果 `main` 已经在 `base`，merge 是空操作，正常。
- 如果 `base` 为空（远端还没有 lab 分支），`main` 保持不动。
- 推 `main` 不触发 CI（`publish.yml` 不监听 `main`），这一步只是把上一版 lab 备份到 `main`。
- `push.mjs` 找不到内容基点会直接报错，不会推送；按报错提示先对齐远端，不要绕开。

## 流程

### 0. 预检

在 `lab` 上确认起点：

```bash
git branch --show-current                       # 必须是 lab
git status --porcelain --untracked-files=no     # 必须为空（已跟踪改动不能带进发版）
node -p "require('./package.json').version"     # 当前版本，例如 0.6.4
git ls-remote origin refs/heads/lab refs/heads/main 'refs/tags/v*'
node tools/status.mjs                           # 两条线的头、通道与最近 CI
```

选下一个正式版号：默认是当前补丁号 +1（`0.6.4` → `0.6.5`）。如果用户指定了版本，按用户指定的来。确认目标标签在本地和远端都不存在；存在就说明这个版本已经发过，换下一个补丁号。

### 1. 提升版本并跑全量测试

把 `package.json` 的 `version` 改成目标正式版本号，然后：

```bash
node test/run-all.mjs
```

必须看到「全部 14 个套件通过」且断言数为 580。测试红就停在 `lab` 修，不要提交发版号、不要打标签。

### 2. 提交并推送 lab

发版提交只包含 `package.json`：

```bash
git add package.json
git commit -m "chore(release): X.Y.Z"
node tools/push.mjs --branch lab
```

`lab` 推送会触发 CI 的 lab 任务，自动发一个 `X.Y.(Z+1)-lab.<run>` 预发布并更新 `lab-latest`。这是实验线，不是正式版，属于预期行为。

### 3. 快进 main 并正式发布

```bash
git checkout main
git merge --ff-only lab
node tools/release.mjs
```

`git merge --ff-only lab` 是默认「落后一版」策略的例外：发版或用户明确说「一起推 main」时，才允许把 `main` 追平当前 `lab`。

`release.mjs` 会依次检查：当前在 `main`、已跟踪工作区干净、版本号不是预发布、目标标签不存在；然后用 REST 推 `main`，在远端 `main` 头创建 `vX.Y.Z` 标签，并在本地打同名标签。

如果 `merge --ff-only` 失败，说明 `main` 与 `lab` 已分叉：**停下来查清**，不要 rebase、不要 force、不要在 `main` 上手工合并提交。先用 `git diff main lab` 与 `node tools/status.mjs` 对照远端，再决定是同步还是修复。

### 4. 等 CI 并验收

```bash
node tools/release-watch.mjs
```

默认读取 `package.json` 的版本，也可以显式传入：

```bash
node tools/release-watch.mjs --version X.Y.Z
```

脚本会等待该标签触发的 `publish` 与 `Publish to npmjs` 工作流结束，并核对：

- `publish` 的 stable 任务成功；
- Release `vX.Y.Z` 存在、非 prerelease、非 draft；
- Release 是 GitHub Latest；
- 资产包含 `dsh-memory-latest.tgz` 和 `*-X.Y.Z.tgz`；
- npmjs 通道是「已发布」还是「跳过（未配置 NPM_TOKEN）」。

只有退出码为 0 才算正式版完成。CI 失败时先打开运行链接定位，不要手工改 Release 资产掩盖失败。

### 5. 收尾

```bash
git checkout lab
node tools/status.mjs
```

向用户汇报：版本号、标签提交、`lab` / `main` / 标签三者的远端 SHA、CI 结论、Release 链接、npmjs 通道状态、`lab-latest` 的新版本。本地必须回到 `lab`。

## 只同步 main，不发正式版

### 默认：main 只追上一版

用户说「同步 main」但没有说「一起」时，不 bump、不打标签，`main` 只追到上一版 lab。默认流程必须在推 lab 的同一轮执行：`push.mjs` 会输出 `base`；如果 lab 已经推完，再跑一次会显示 `synced   yes`（已经同步），此时 `base` 是当前 lab，不是上一版。遇到这种情况先停下核对边界，不要把 `main` 推到当前 lab 头。

### 明确一起推 main：main 追平 lab

只有用户明确说「一起推 main / 把 main 推到最新」时：

```bash
git checkout main
git merge --ff-only lab
node tools/push.mjs --branch main
git checkout lab
```

这条路径不打标签、不发正式版；`publish.yml` 不监听 `main`，不会触发 CI。

## 失败处理

| 现象 | 处理 |
| --- | --- |
| 全量测试红 | 停在 `lab` 修复；不要提交发版号或打标签 |
| `push.mjs` 认证失败 / 网络失败 | 检查 `GH_TOKEN` 或 git credential store；重跑同一个 REST 工具，不要改用 `git push` |
| `main` 快进失败 | 两线已分叉；停下对照 `git diff main lab`，不要 rebase / force / 在 main 上提交 |
| `push.mjs` 报「找不到与远端头内容一致的本地提交」 | 本地与远端 lab 历史不一致；按提示先用 `node tools/sync.mjs` 对齐，不要绕开强推 |
| `base` 为空但远端本来有 lab | 远端 lab 被删或本地历史不完整；停下核对，不要把 `main` 推到新 lab 头 |
| `main` 被提前追平到新 lab | 默认策略违规；不要 reset / force，先对照远端 `main`、旧标签与 `lab` 的提交边界 |
| 标签已存在 | 该版本已发过；换下一个补丁号，绝不移动或复用旧标签 |
| `publish` CI 失败 | 打开运行链接定位；修复后在 `lab` 用新的补丁号重走流程 |
| Release 不是 Latest / 缺资产 | 看 stable 任务日志；先确认工作流是否失败，不要手工补资产掩盖问题 |
| npmjs 跳过 | 仓库未配置 `NPM_TOKEN`，属于设计行为；GitHub Release 与 GitHub Packages 不受影响 |

## 验收清单

### 默认推 lab（不追平 main）

- [ ] `main` = `base`（上一版 lab 在本地的对应提交）
- [ ] `main` 是 `lab` 的祖先，`lab` 比 `main` 新一版
- [ ] 已回到 `lab`

### 正式发版（明确一起推 main）

- [ ] `package.json` 版本 = 标签版本 = Release 标题
- [ ] `node test/run-all.mjs`：14 套件 / 580 断言全绿
- [ ] 远端 `lab`、`main`、`vX.Y.Z` 指向同一提交或内容等价的提交
- [ ] `publish` 的 stable 任务成功
- [ ] Release 是 Latest、非 prerelease、资产齐全
- [ ] npmjs 状态已记录（发布或跳过）
- [ ] 本地已回到 `lab`，没有 amend / rebase / force
