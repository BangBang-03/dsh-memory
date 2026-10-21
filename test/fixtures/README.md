# test/fixtures

测试数据。目前只有一份：

- `retrieval-hard-60.json` —— 60 条确定性检索评测集，分六组各 10 条：
  同义改写、路径 / 代码、近邻干扰、`related` 多跳、否定 / 纠错、标签 / 关键词。
  每条记忆用 fixture 内的 `key`（`m01`…）互相引用，`gold` 也按 `key` 标注，
  这样不依赖真实存储的自增 id。

由 `test/retrieval.test.mjs` 读取；改动评测集会直接影响检索基线，
`docs/retrieval-eval-2026-10-20.md` 里的数字需要同步复核。
