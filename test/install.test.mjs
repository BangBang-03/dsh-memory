/**
 * dsh-memory 安装脚本测试：在临时目录里搭一个假的 DSH 主目录，真跑 install.ps1 / uninstall.ps1。
 *   node test/install.test.mjs
 *
 * 只碰临时目录：包根是复制出来的假包，profile 是造的，跑完删干净。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err && err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-install-'));
const fakeHome = path.join(tmp, 'dshhome');
const fakePkg = path.join(tmp, 'pkg');
const profileDir = path.join(fakeHome, 'profiles', 'desktop');
const profileJson = path.join(profileDir, 'package.json');

const ORIGINAL_PROFILE = {
  name: 'dsh-profile-desktop',
  private: true,
  dependencies: {
    'dsh-context': '0.66.1',
    'dsh-cost-meter': '1.8.19',
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-context'],
    },
  },
};

function seed() {
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.mkdirSync(path.join(fakeHome, 'profiles', 'node_modules', '@deepseek-ai'), { recursive: true });
  fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(profileJson, `${JSON.stringify(ORIGINAL_PROFILE, null, 2)}\n`, 'utf8');

  fs.rmSync(fakePkg, { recursive: true, force: true });
  fs.mkdirSync(path.join(fakePkg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(fakePkg, 'cordis.patch.yml'), '- insert:\n    - id: dsh-memory\n      name: dsh-memory\n', 'utf8');
  fs.writeFileSync(path.join(fakePkg, 'package.json'), '{"name":"dsh-memory","version":"0.1.0"}\n', 'utf8');
  fs.writeFileSync(path.join(fakePkg, 'lib', 'index.js'), 'export function apply() {}\n', 'utf8');
}

/**
 * pwsh 的管道输出编码跟着控制台代码页走：中文 Windows（CP936）上它吐 GBK 字节，
 * 英文环境/强制 UTF-8 的机器上则是 UTF-8。先按 UTF-8 解，出现替换符再按 GBK 重解，
 * 断言在两种机器上都成立。
 */
function decodeConsole(buffer) {
  const utf8 = Buffer.from(buffer).toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return utf8;
  }
}

/** 跑脚本；返回 { status, stdout, stderr }。 */
function runScript(script, args) {
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', path.join(pkgRoot, script), ...args],
    { encoding: 'buffer' },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ? decodeConsole(result.stdout) : '',
    stderr: result.stderr ? decodeConsole(result.stderr) : '',
  };
}

const install = (extra = []) => runScript('install.ps1', ['-Profile', 'desktop', '-DshHome', fakeHome, '-PackageRoot', fakePkg, ...extra]);
const uninstall = (extra = []) => runScript('uninstall.ps1', ['-Profile', 'desktop', '-DshHome', fakeHome, ...extra]);

const readProfile = () => JSON.parse(fs.readFileSync(profileJson, 'utf8'));
const backups = () => fs.readdirSync(profileDir).filter((name) => name.startsWith('package.json.bak-')).sort();

/** junction 在 Node 里是 symlink；readlink 会带回 \\?\ 前缀。 */
function linkTarget(target) {
  const raw = fs.readlinkSync(target);
  return raw.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '');
}

const shimPath = path.join(fakePkg, 'node_modules', '@deepseek-ai');
const profileLink = path.join(profileDir, 'node_modules', 'dsh-memory');
const sharedModules = path.join(fakeHome, 'profiles', 'node_modules', '@deepseek-ai');
const storageDir = path.join(fakeHome, 'storages', 'dsh-memory');

/* ------------------------------------------------------------------ *
 * 测试
 * ------------------------------------------------------------------ */

console.log('dsh-memory install / uninstall');

await test('install.ps1 把包挂进 bundles、dependencies 与 junction，并先备份', () => {
  seed();
  const before = fs.readFileSync(profileJson, 'utf8');
  const result = install();
  assert.equal(result.status, 0, `install.ps1 退出码 ${result.status}\n${result.stdout}\n${result.stderr}`);

  const profile = readProfile();
  assert.deepEqual(
    profile.dsh.profile.bundles,
    [...ORIGINAL_PROFILE.dsh.profile.bundles, 'dsh-memory'],
    'bundles 没有正确追加（应追加到末尾，且保留原有顺序）',
  );
  assert.equal(profile.dependencies['dsh-memory'], `link:${fakePkg.replace(/\\/g, '/')}`);
  assert.equal(profile.dependencies['dsh-context'], '0.66.1', '原有依赖被改动了');
  assert.equal(profile.name, 'dsh-profile-desktop', '原有字段丢失');

  const bak = backups();
  assert.equal(bak.length, 1, `应恰好一个备份，实际 ${bak.length}`);
  assert.equal(fs.readFileSync(path.join(profileDir, bak[0]), 'utf8'), before, '备份内容与改动前不一致');

  assert.ok(fs.lstatSync(shimPath).isSymbolicLink(), '包内垫片没建');
  assert.equal(linkTarget(shimPath), sharedModules);
  assert.ok(fs.lstatSync(profileLink).isSymbolicLink(), 'profile junction 没建');
  assert.equal(linkTarget(profileLink), fakePkg);
});

await test('install.ps1 是幂等的：再跑一次不重复追加、不再备份', () => {
  const before = fs.readFileSync(profileJson, 'utf8');
  const result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(profileJson, 'utf8'), before, '第二次运行改动了 package.json');
  assert.equal(backups().length, 1, '第二次运行又备份了一次');
  assert.match(result.stdout, /已经是目标状态/);
});

await test('install.ps1 -DryRun 不落盘', () => {
  seed();
  const before = fs.readFileSync(profileJson, 'utf8');
  const result = install(['-DryRun']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(profileJson, 'utf8'), before, 'dry run 改了 package.json');
  assert.equal(backups().length, 0, 'dry run 产生了备份');
  assert.equal(fs.existsSync(shimPath), false, 'dry run 建了垫片');
  assert.equal(fs.existsSync(profileLink), false, 'dry run 建了 junction');
});

await test('install.ps1 抵赖：包根不对就报错退出', () => {
  seed();
  fs.rmSync(path.join(fakePkg, 'cordis.patch.yml'));
  const result = install();
  assert.notEqual(result.status, 0, '缺 cordis.patch.yml 时竟然成功了');
  assert.match(`${result.stdout}${result.stderr}`, /不是 dsh-memory 包根目录/);
});

await test('install.ps1 抵赖：profile 目录不存在就报错退出', () => {
  seed();
  const result = runScript('install.ps1', ['-Profile', 'nope', '-DshHome', fakeHome, '-PackageRoot', fakePkg]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /找不到 profile/);
});

await test('uninstall.ps1 还原 bundles / dependencies，删掉 junction，但保留记忆数据', () => {
  seed();
  assert.equal(install().status, 0);
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(path.join(storageDir, 'settings.json'), '{"briefingLimit":12}\n', 'utf8');

  const result = uninstall();
  assert.equal(result.status, 0, `uninstall.ps1 退出码 ${result.status}\n${result.stdout}\n${result.stderr}`);

  const profile = readProfile();
  assert.deepEqual(profile.dsh.profile.bundles, ORIGINAL_PROFILE.dsh.profile.bundles);
  assert.equal('dsh-memory' in profile.dependencies, false);
  assert.equal(profile.dependencies['dsh-cost-meter'], '1.8.19', '原依赖被误删');
  assert.equal(fs.existsSync(profileLink), false, 'profile junction 没删掉');
  assert.ok(fs.existsSync(shimPath), '垫片被删了（应该保留）');
  assert.ok(fs.existsSync(path.join(storageDir, 'settings.json')), '记忆数据被误删');
  assert.equal(backups().length, 2, '卸载前应再备份一次');
});

await test('uninstall.ps1 -PurgeStorage 才删记忆数据', () => {
  seed();
  assert.equal(install().status, 0);
  fs.mkdirSync(storageDir, { recursive: true });
  assert.equal(uninstall(['-PurgeStorage']).status, 0);
  assert.equal(fs.existsSync(storageDir), false, '-PurgeStorage 没有删掉数据目录');
  assert.ok(fs.existsSync(fakePkg), '包目录被误删');
  assert.ok(fs.existsSync(path.join(fakePkg, 'lib', 'index.js')), '包内容被误删');
});

await test('uninstall.ps1 抵赖：junction 位置是真实目录时拒绝删除', () => {
  seed();
  assert.equal(install().status, 0);
  fs.rmSync(profileLink);
  fs.mkdirSync(profileLink);
  fs.writeFileSync(path.join(profileLink, 'important.txt'), 'do not delete\n', 'utf8');

  const result = uninstall();
  assert.notEqual(result.status, 0, '真实目录竟然被删了');
  assert.ok(fs.existsSync(path.join(profileLink, 'important.txt')), '真实目录内容被删了');
});

await test('uninstall.ps1 在没装过的 profile 上是无害的空操作', () => {
  seed();
  const before = fs.readFileSync(profileJson, 'utf8');
  const result = uninstall();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(profileJson, 'utf8'), before, '空操作也改了 package.json');
  assert.equal(backups().length, 0, '空操作产生备份');
  assert.match(result.stdout, /没有 dsh-memory/);
});

/* ------------------------------------------------------------------ */

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
