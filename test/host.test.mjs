/**
 * 宿主半冒烟测试：不启动 DSH，直接 import lib/index.js，验证导出与 Config 行为。
 * 运行：node test/host.test.mjs
 */
import assert from 'node:assert/strict';

let mod;
try {
  mod = await import('../lib/index.js');
} catch (error) {
  console.error('FAIL  无法 import lib/index.js:', error?.message || error);
  console.error(error?.stack);
  process.exit(1);
}

const checks = [];
function check(label, fn) {
  try {
    fn();
    checks.push(['ok', label]);
  } catch (error) {
    checks.push(['fail', label, error?.message || String(error)]);
  }
}

check('导出 name', () => assert.equal(mod.name, 'dsh-memory'));
check('导出 inject 含 tools', () => assert.deepEqual(mod.inject, ['tools']));
check('导出 apply 函数', () => assert.equal(typeof mod.apply, 'function'));
check('导出 Config', () => assert.ok(mod.Config));
check('默认导出完整', () => {
  assert.equal(typeof mod.default.apply, 'function');
  assert.equal(mod.default.name, 'dsh-memory');
});

check('Config 解析空对象得到默认值', () => {
  const value = mod.Config({});
  assert.equal(value.enabled, true);
  assert.equal(value.mirror, true);
  assert.equal(value.briefing, true);
  assert.equal(value.briefingLimit, 12);
  assert.equal(value.briefingMaxChars, 2000);
  assert.equal(value.autoCapture, false);
  assert.equal(value.minConfidence, 0.4);
  assert.equal(value.maxPerTurn, 5);
  assert.equal(value.dedupe, true);
  assert.equal(value.redactSecrets, true);
  assert.equal(value.quarantineTainted, true);
  assert.equal(value.falsifierReviewDays, 90);
  assert.equal(value.sectionOrder, 550);
  assert.equal(value.directory, '');
});

check('Config 接受覆盖值', () => {
  const value = mod.Config({ enabled: false, autoCapture: true, briefingLimit: 5, falsifierReviewDays: 30 });
  assert.equal(value.enabled, false);
  assert.equal(value.autoCapture, true);
  assert.equal(value.briefingLimit, 5);
  assert.equal(value.falsifierReviewDays, 30);
});

check('Config 拒绝越界值', () => {
  assert.throws(() => mod.Config({ briefingLimit: 999 }));
  assert.throws(() => mod.Config({ minConfidence: 5 }));
});

check('API_PREFIX 常量正确', () => assert.equal(mod.API_PREFIX, '/memory/api'));
check('GLOBAL_KEY 常量正确', () => assert.equal(mod.GLOBAL_KEY, '_global'));

let failed = 0;
for (const [state, label, detail] of checks) {
  if (state === 'ok') console.log(`  ok   ${label}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
