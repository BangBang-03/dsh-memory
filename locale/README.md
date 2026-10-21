# locale

随包发布的界面语言元数据，`zh.json` / `en.json` 各一份，键必须对齐。

- `meta.title`：插件在 DSH 里的显示名（记忆 / Memory）。
- `meta.description`：一句话说明。
- 通过 `package.json` 的 `exports` 暴露为 `./locale/*.json`；改文件名要同步那里。

设置面板运行时用的完整词典（`nav`、各 tab、按钮、提示等）内联在 `lib/client.js` 的
`zh` / `en` 对象里，由 `ctx.locale.register("settings.memory", …)` 注册；
`test/client.test.mjs` 会断言两边键集合一致。改文案时两处一起改。
