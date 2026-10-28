/**
 * 稳定版发版：把 main 推上去，并在 main 头上打 `v<package.json 版本>` 标签。
 * 标签一推，GitHub Actions 的 stable 任务就发 `latest` 并建正式 Release
 * （资产 dsh-memory-latest.tgz，安装脚本 -Channel stable 认的就是它）。
 *
 *   node tools/release.mjs          # 在 main 上执行
 *   node tools/release.mjs --dry    # 只做检查，不推不打标签
 *
 * 前置：main 上的代码已通过全量测试，package.json 的版本号已经改成这次要发的号。
 * 正常顺序是：
 *   git checkout main && …改代码、跑测试… && git commit
 *   node tools/push.mjs                    # 推 main（CI 只跑测试，不发版）
 *   node tools/release.mjs                 # 推 main + 打标签 → 正式版
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = "BangBang-03/dsh-memory";
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

function resolveToken() {
	if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
	const out = execFileSync("git", ["credential", "fill"], {
		input: "protocol=https\nhost=github.com\n\n",
		encoding: "utf8",
	});
	const match = /^password=(.+)$/mu.exec(out);
	if (match) return match[1].trim();
	throw new Error("拿不到 token：设置 GH_TOKEN，或在凭据管理器里存好 github.com 凭据");
}

const token = resolveToken();
const git = (...args) => execFileSync("git", ["-C", here, ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();

async function api(method, apiPath, payload) {
	const response = await fetch("https://api.github.com" + apiPath, {
		method,
		headers: {
			authorization: "Bearer " + token,
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			"user-agent": "dsh-memory-release",
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(method + " " + apiPath + " -> " + response.status + " " + text.slice(0, 300));
	return text === "" ? null : JSON.parse(text);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const version = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")).version;
const tag = "v" + version;

console.log("branch  " + branch);
console.log("version " + version + "  ->  tag " + tag);

if (branch !== "main") throw new Error("稳定版只能在 main 上发（当前在 " + branch + "）；先把 lab 合进 main");
// 未跟踪文件不会进入发布提交或标签树（如 .probe/ 审计材料），不阻塞发版；
// 已跟踪改动仍必须清干净，否则发布内容与工作区不一致。
const dirty = git("status", "--porcelain", "--untracked-files=no");
if (dirty !== "") throw new Error("工作区有未提交的已跟踪改动，先提交或清干净：\n" + dirty);
if (version.includes("-")) throw new Error("package.json 版本还是预发布号（" + version + "），稳定版要写正式版本号");

const existing = await api("GET", `/repos/${repo}/git/ref/tags/${tag}`).catch((error) => {
	if (String(error.message).includes("-> 404")) return null;
	throw error;
});
if (existing) throw new Error("远端已经有标签 " + tag + "，改版本号后再发");

if (DRY) {
	console.log("dry run —— 检查通过，未推未打标签");
} else {
	// 1) 推 main（内部逐提交重建，tree 不一致会自行中止）
	execFileSync(process.execPath, [path.join(here, "tools/push.mjs"), "--branch", "main"], { stdio: "inherit" });

	// 2) 远端 main 头 = 本地 HEAD 才打标签
	const head = await api("GET", `/repos/${repo}/git/ref/heads/main`);
	const localHead = git("rev-parse", "HEAD");
	if (head.object.sha !== localHead) {
		console.log("note    远端 main " + head.object.sha.slice(0, 9) + " 与本地 " + localHead.slice(0, 9) + " sha 不同（API 建的提交字节可能不同），按远端头打标签");
	}

	// 3) 建标签引用（触发 Actions 的 stable 任务）
	await api("POST", `/repos/${repo}/git/refs`, { ref: "refs/tags/" + tag, sha: head.object.sha });
	try {
		git("tag", tag, localHead);
	} catch {
		// 本地已有同名标签就重指
		git("tag", "-f", tag, localHead);
	}

	// 4) 读回 + 提示
	const ref = await api("GET", `/repos/${repo}/git/ref/tags/${tag}`);
	console.log("tag      " + tag + " -> " + ref.object.sha.slice(0, 9));
	console.log("actions  https://github.com/" + repo + "/actions");
	console.log("release  https://github.com/" + repo + "/releases/tag/" + tag);
}
