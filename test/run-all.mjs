/**
 * 一次跑完 dsh-memory 的全部测试套件。
 *   node test/run-all.mjs
 * 任一子套件失败即 exit 1。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const suites = [
  ['store', '存储层：工作区分库、去重合并、检索、镜像、导入导出'],
  ['markdown', '既有记忆解析：WorkBuddy 笔记/日报、Qoder frontmatter、纯文本、本机扫描'],
  ['distill', '提炼层：对话摘录、模型输出解析、触发条件'],
  ['api', 'HTTP 契约：15 个端点（含既有记忆扫描导入）、错误码、参数校验'],
  ['host', '宿主半：导出、Config 默认值与校验'],
  ['activate', '宿主半激活：假 cordis 跑 apply()，工具 / 提示段 / 路由真的能用'],
  ['client', '客户端半：模块格式、槽位注册、渲染与交互（端到端）'],
  ['install', '安装脚本：备份、幂等、dry run、卸载还原与拒绝误删'],
];

let failed = 0;

for (const [name, description] of suites) {
  console.log(`\n=== ${name} — ${description} ===`);
  const result = spawnSync(process.execPath, [path.join(here, `${name}.test.mjs`)], {
    stdio: 'inherit',
    cwd: path.resolve(here, '..'),
  });
  if (result.status !== 0) failed += 1;
}

console.log('');
if (failed > 0) {
  console.log(`${failed} 个套件失败`);
  process.exit(1);
}
console.log(`全部 ${suites.length} 个套件通过`);
