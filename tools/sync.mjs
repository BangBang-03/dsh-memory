/**
 * `git pull` over the GitHub REST API —— 把本地 checkout 对齐到远端所有分支与标签。
 *
 * 本机连不上 github.com:443（只通 api.github.com），`git fetch`/`git clone` 都不可用。
 * 这个脚本按 API 拿到的对象字段逐个重放 blob / tree / commit / tag 对象，
 * 把本地仓库补成与远端**字节一致**的历史（sha 完全相同），再移动本地 ref。
 *
 *   node tools/sync.mjs            # 补齐并对齐 refs（工作区跟随 HEAD）
 *   node tools/sync.mjs --dry      # 只报告还缺什么，不写任何对象
 *
 * token 取 GH_TOKEN 环境变量，否则读本机 git credential store 里 github.com 的凭据。
 * 逐提交按提交时间顺序写对象；任何一步 sha 校验不过就立即停下，不移动 ref。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const repo = "BangBang-03/dsh-memory";
const dir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : process.cwd();
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
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
const gitIn = (args, input) =>
	execFileSync("git", ["-C", dir, ...args], { input, maxBuffer: 1 << 26 }).toString("utf8").trim();
const has = (sha) => {
	try {
		execFileSync("git", ["-C", dir, "cat-file", "-e", sha], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

async function api(path) {
	const response = await fetch("https://api.github.com" + path, {
		headers: {
			authorization: "Bearer " + token,
			accept: "application/vnd.github+json",
			"user-agent": "dsh-memory-sync",
		},
	});
	const text = await response.text();
	if (!response.ok) throw new Error("GET " + path + " -> " + response.status + " " + text.slice(0, 200));
	return JSON.parse(text);
}

/** 写出一个 tree 下所有缺失的 blob 与 tree 对象；逐个校验 sha。 */
async function writeTree(rootTree) {
	if (has(rootTree)) return { blobs: 0, trees: 0, skipped: true };
	const listing = await api(`/repos/${repo}/git/trees/${rootTree}?recursive=1`);
	const entries = listing.tree ?? [];
	let blobs = 0;
	for (const entry of entries) {
		if (entry.type !== "blob" || has(entry.sha)) continue;
		const blob = await api(`/repos/${repo}/git/blobs/${entry.sha}`);
		const written = gitIn(["hash-object", "-w", "-t", "blob", "--stdin"], Buffer.from(blob.content, "base64"));
		if (written !== entry.sha) throw new Error("blob " + entry.path + " 重建为 " + written + "，期望 " + entry.sha);
		blobs += 1;
	}
	// 目录 → 子项，包含因 sparse 而没出现在 recursive 列表里的空目录（这里不存在子模块，够用）
	const dirs = new Map([["", []]]);
	for (const entry of entries) {
		const cut = entry.path.lastIndexOf("/");
		const parent = cut === -1 ? "" : entry.path.slice(0, cut);
		if (!dirs.has(parent)) dirs.set(parent, []);
		dirs.get(parent).push({
			name: cut === -1 ? entry.path : entry.path.slice(cut + 1),
			type: entry.type,
			mode: entry.mode,
			sha: entry.sha,
		});
		if (entry.type === "tree" && !dirs.has(entry.path)) dirs.set(entry.path, []);
	}
	const depth = (path) => (path === "" ? 0 : path.split("/").length);
	let trees = 0;
	for (const path of [...dirs.keys()].sort((left, right) => depth(right) - depth(left))) {
		const sorted = dirs.get(path).slice().sort((left, right) => {
			const keyOf = (entry) => (entry.type === "tree" ? entry.name + "/" : entry.name);
			return Buffer.compare(Buffer.from(keyOf(left), "utf8"), Buffer.from(keyOf(right), "utf8"));
		});
		const parts = [];
		for (const child of sorted) {
			parts.push(Buffer.from((child.type === "tree" ? "40000" : child.mode) + " " + child.name + "\u0000", "utf8"));
			parts.push(Buffer.from(child.sha, "hex"));
		}
		const written = gitIn(["hash-object", "-w", "-t", "tree", "--stdin"], Buffer.concat(parts));
		const expected = path === "" ? rootTree : entries.find((entry) => entry.path === path && entry.type === "tree")?.sha;
		if (expected !== undefined && written !== expected) {
			throw new Error("tree " + (path === "" ? "<root>" : path) + " 重建为 " + written + "，期望 " + expected);
		}
		trees += 1;
	}
	return { blobs, trees, skipped: false };
}

const epoch = (value) => Math.floor(new Date(value).getTime() / 1000);

/** 逐个尝试时区偏移与结尾换行，把 commit 重建到字节一致（API 不返回时区）。 */
function writeCommit(commit) {
	const treeSha = typeof commit.tree === "string" ? commit.tree : commit.tree.sha;
	const header = ["tree " + treeSha, ...commit.parents.map((parent) => "parent " + parent.sha)];
	for (const authorOffset of ["+0800", "+0000"]) {
		for (const committerOffset of ["+0800", "+0000"]) {
			for (const suffix of ["\n", ""]) {
				const text =
					header.join("\n") +
					"\nauthor " +
					commit.author.name +
					" <" +
					commit.author.email +
					"> " +
					epoch(commit.author.date) +
					" " +
					authorOffset +
					"\ncommitter " +
					commit.committer.name +
					" <" +
					commit.committer.email +
					"> " +
					epoch(commit.committer.date) +
					" " +
					committerOffset +
					"\n\n" +
					commit.message +
					suffix;
				const sha = gitIn(["hash-object", "-t", "commit", "--stdin"], Buffer.from(text, "utf8"));
				if (sha === commit.sha) {
					gitIn(["hash-object", "-w", "-t", "commit", "--stdin"], Buffer.from(text, "utf8"));
					return { authorOffset, committerOffset, suffix };
				}
			}
		}
	}
	return null;
}

/** 附注标签同理：tag 对象里也带时区。 */
function writeTag(name, tag) {
	const target = tag.object.sha;
	for (const offset of ["+0800", "+0000"]) {
		for (const suffix of ["\n", ""]) {
			const text =
				"object " +
				target +
				"\ntype " +
				tag.object.type +
				"\ntag " +
				name +
				"\ntagger " +
				tag.tagger.name +
				" <" +
				tag.tagger.email +
				"> " +
				epoch(tag.tagger.date) +
				" " +
				offset +
				"\n\n" +
				tag.message +
				suffix;
			const sha = gitIn(["hash-object", "-t", "tag", "--stdin"], Buffer.from(text, "utf8"));
			if (sha === tag.sha) {
				gitIn(["hash-object", "-w", "-t", "tag", "--stdin"], Buffer.from(text, "utf8"));
				return { offset, suffix };
			}
		}
	}
	return null;
}

// ---- 远端要写的 refs -------------------------------------------------------
const branchRefs = (await api(`/repos/${repo}/git/matching-refs/heads/`)) ?? [];
const tagRefs = (await api(`/repos/${repo}/git/matching-refs/tags/`)) ?? [];
console.log("remote branches :", branchRefs.map((ref) => ref.ref.replace("refs/heads/", "")).join(", ") || "(none)");
console.log("remote tags     :", tagRefs.length + " 个");

// ---- 需要补的提交：从每个分支头往回走，遇到本地已有就停 ----------------------
const missing = new Map(); // sha -> commit
for (const ref of branchRefs) {
	let cursor = ref.object.sha;
	while (cursor && !has(cursor)) {
		const commit = await api(`/repos/${repo}/git/commits/${cursor}`);
		missing.set(commit.sha, commit);
		cursor = commit.parents?.[0]?.sha ?? "";
	}
}
const ordered = [...missing.values()].sort((left, right) => new Date(left.committer.date) - new Date(right.committer.date));
console.log("missing commits :", ordered.length);
for (const commit of ordered.slice(0, 8)) console.log("  " + commit.sha.slice(0, 9) + " " + String(commit.message).split("\n")[0]);
if (ordered.length > 8) console.log("  … 其余 " + (ordered.length - 8) + " 个");

if (DRY) {
	console.log("dry run —— 未写入任何对象");
	process.exit(0);
}

// ---- 写对象（最老先写，父提交已就位） --------------------------------------
for (const commit of ordered) {
	const treeSha = typeof commit.tree === "string" ? commit.tree : commit.tree.sha;
	const written = await writeTree(treeSha);
	const rebuilt = writeCommit(commit);
	if (rebuilt === null) throw new Error("提交 " + commit.sha + " 无法按 API 字段重建为字节一致");
	console.log(
		"wrote " + commit.sha.slice(0, 9) + (written.skipped ? " (tree 已在)" : " (blobs " + written.blobs + ", trees " + written.trees + ")"),
	);
}

// ---- 写附注标签对象 --------------------------------------------------------
const tagTargets = new Map(); // refname -> sha（标签对象或提交）
for (const ref of tagRefs) {
	const name = ref.ref.replace("refs/tags/", "");
	if (ref.object.type === "tag") {
		if (!has(ref.object.sha)) {
			const tag = await api(`/repos/${repo}/git/tags/${ref.object.sha}`);
			if (writeTag(name, tag) === null) throw new Error("附注标签 " + name + " 无法重建");
		}
		tagTargets.set(name, ref.object.sha);
	} else {
		tagTargets.set(name, ref.object.sha);
	}
}

// ---- 移动本地 refs --------------------------------------------------------
let moved = 0;
for (const ref of branchRefs) {
	const name = ref.ref.replace("refs/heads/", "");
	const current = (() => {
		try {
			return git("rev-parse", "--verify", "refs/heads/" + name).trim();
		} catch {
			return "";
		}
	})();
	if (current === ref.object.sha) continue;
	git("update-ref", "refs/heads/" + name, ref.object.sha);
	console.log("branch " + name.padEnd(6) + " -> " + ref.object.sha.slice(0, 9) + (current ? " (was " + current.slice(0, 9) + ")" : " (new)"));
	moved += 1;
}
for (const [name, sha] of tagTargets) {
	const current = (() => {
		try {
			return git("rev-parse", "--verify", "refs/tags/" + name).trim();
		} catch {
			return "";
		}
	})();
	if (current !== sha) {
		git("update-ref", "refs/tags/" + name, sha);
		moved += 1;
	}
}

if (branchRefs.length > 0) {
	const head = branchRefs.find((ref) => ref.ref === "refs/heads/main") ?? branchRefs[0];
	git("update-ref", "HEAD", head === undefined ? "refs/heads/main" : head.ref.replace("refs/", ""));
	// 工作区跟随 HEAD：本地已有全部对象，不需要网络
	git("reset", "--hard", "HEAD");
}

console.log("refs updated    :", moved);
console.log("status          :", git("status", "--short").trim() === "" ? "clean" : "\n" + git("status", "--short"));
console.log("log             : " + git("log", "--oneline", "-3").trim().split("\n").join(" | "));
