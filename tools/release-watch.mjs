/**
 * 正式版验收：等 v<version> 标签触发的发布工作流跑完，并核对 Release。
 *
 *   node tools/release-watch.mjs
 *   node tools/release-watch.mjs --version 0.6.4 --timeout 600 --interval 10
 *
 * 只读：不推代码、不改标签。退出码 0 表示正式版验收通过。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = "BangBang-03/dsh-memory";
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1] ?? fallback;
};

const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));
const version = String(flag("--version", pkg.version)).replace(/^v/u, "");
const tag = "v" + version;
const timeoutMs = Math.max(30, Number(flag("--timeout", 600)) || 600) * 1000;
let intervalMs = Math.max(5, Number(flag("--interval", 10)) || 10) * 1000;

function fail(message) {
	console.error("FAIL " + message);
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/u.test(version)) fail("版本号必须是 X.Y.Z 正式号，当前是 " + version);

function resolveToken() {
	if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
	try {
		const out = execFileSync("git", ["credential", "fill"], {
			cwd: here,
			input: "protocol=https\nhost=github.com\n\n",
			encoding: "utf8",
		});
		return /^password=(.+)$/mu.exec(out)?.[1]?.trim() || "";
	} catch {
		return "";
	}
}

const token = resolveToken();
if (!token) {
	console.log("warn     没有拿到 GitHub token，改用匿名 API；轮询间隔至少 30 秒");
	intervalMs = Math.max(intervalMs, 30000);
}

const baseHeaders = {
	accept: "application/vnd.github+json",
	"user-agent": "dsh-memory-release-watch",
	...(token ? { authorization: "Bearer " + token } : {}),
};

async function api(apiPath) {
	const response = await fetch("https://api.github.com" + apiPath, { headers: baseHeaders });
	const text = await response.text();
	if (!response.ok) throw new Error(apiPath + " -> " + response.status + " " + text.slice(0, 200));
	return text === "" ? null : JSON.parse(text);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let tagRef;
try {
	tagRef = await api(`/repos/${repo}/git/ref/tags/${tag}`);
} catch (error) {
	fail("远端没有标签 " + tag + "：" + error.message);
}
let sha = tagRef.object.sha;
if (tagRef.object.type === "tag") {
	const annotated = await api(`/repos/${repo}/git/tags/${sha}`);
	sha = annotated.object.sha;
}

const mainRef = await api(`/repos/${repo}/git/ref/heads/main`);
if (mainRef.object.sha !== sha) {
	console.log("warn     main 头 " + mainRef.object.sha.slice(0, 9) + " 与标签 " + sha.slice(0, 9) + " 不同（发版后 main 又前进了？）");
}

console.log("release-watch  " + tag + " @ " + sha.slice(0, 9));

const startedAt = Date.now();
let runs = [];
let settledSince = 0;
let lastLine = "";
while (Date.now() - startedAt < timeoutMs) {
	const data = await api(`/repos/${repo}/actions/runs?per_page=50`);
	runs = (data.workflow_runs || []).filter((run) => run.head_sha === sha);
	const line = runs.map((run) => `${run.name}=${run.status}/${run.conclusion ?? "-"}`).join(", ") || "等待触发";
	if (line !== lastLine) {
		console.log("[" + new Date().toISOString().slice(11, 19) + "] " + line);
		lastLine = line;
	}
	const publish = runs.find((run) => run.name === "publish");
	if (publish && runs.every((run) => run.status === "completed")) {
		// 给同标签的其它工作流留出触发时间，避免 publish 先完成就提前收工
		if (!settledSince) settledSince = Date.now();
		if (Date.now() - settledSince >= 20000) {
			const finalData = await api(`/repos/${repo}/actions/runs?per_page=50`);
			const finalRuns = (finalData.workflow_runs || []).filter((run) => run.head_sha === sha);
			if (finalRuns.every((run) => run.status === "completed")) {
				runs = finalRuns;
				break;
			}
			runs = finalRuns;
			settledSince = 0;
			continue;
		}
	} else {
		settledSince = 0;
	}
	await sleep(intervalMs);
}

const publish = runs.find((run) => run.name === "publish");
if (!publish) fail("超时：没有找到标签触发的 publish 工作流；检查标签是否真的推到了远端");
if (runs.some((run) => run.status !== "completed")) fail("超时：仍有工作流未完成；先看 " + publish.html_url);
if (publish.conclusion !== "success") fail("publish 工作流失败：" + publish.html_url);
for (const run of runs) {
	if (run.name === "publish") continue;
	if (run.conclusion !== "success" && run.conclusion !== "skipped") {
		fail(run.name + " 失败：" + run.html_url);
	}
}

let release;
try {
	release = await api(`/repos/${repo}/releases/tags/${tag}`);
} catch (error) {
	fail("Release " + tag + " 不存在：" + error.message);
}
if (release.draft) fail("Release 还是 draft：" + release.html_url);
if (release.prerelease) fail("Release 还是 prerelease：" + release.html_url);

const assets = (release.assets || []).map((asset) => asset.name);
if (!assets.includes("dsh-memory-latest.tgz")) fail("Release 缺 dsh-memory-latest.tgz：" + release.html_url);
if (!assets.some((name) => name.endsWith("-" + version + ".tgz"))) {
	fail("Release 缺版本号资产 *-" + version + ".tgz：" + release.html_url);
}

const latest = await api(`/repos/${repo}/releases/latest`);
if (latest.tag_name !== tag) fail("GitHub Latest 仍指向 " + latest.tag_name + "，不是 " + tag);

let npmjs = "未触发";
const npmRun = runs.find((run) => run.name === "Publish to npmjs");
if (npmRun) {
	const jobs = await api(`/repos/${repo}/actions/runs/${npmRun.id}/jobs`);
	const publishStep = (jobs.jobs || [])
		.flatMap((job) => job.steps || [])
		.find((step) => step.name === "Publish");
	if (publishStep?.conclusion === "success") npmjs = "已发布";
	else if (publishStep?.conclusion === "skipped") npmjs = "跳过（未配置 NPM_TOKEN）";
	else npmjs = "结果 " + (publishStep?.conclusion ?? "未知");
}

console.log("");
console.log("正式版验收通过");
console.log("version   " + version);
console.log("tag       " + tag + " -> " + sha.slice(0, 9));
console.log("main      " + mainRef.object.sha.slice(0, 9));
console.log("release   " + release.html_url);
console.log("assets    " + assets.join(", "));
console.log("npmjs     " + npmjs);
console.log("actions   " + publish.html_url);
