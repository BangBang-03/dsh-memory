/**
 * dsh-memory —— 客户端半（DSH 设置面板的「记忆」页）。
 *
 * 无构建步骤：模块宿主按包名提供本文件，这里只 require("react")。
 * 页面通过同源 POST /memory/api/* 与宿主半通信（宿主半用 webServer 前缀路由注册）。
 */
window.__ModuleLoader__.load({
  id: "dsh-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { useCallback, useEffect, useMemo, useRef, useState } = react;
    const h = react.createElement;

    /** 导入时的格式选择（与 lib/markdown.js 的 IMPORT_FORMATS 对齐）。 */
    const IMPORT_FORMAT_OPTIONS = ["auto", "workbuddy", "qoder", "daily", "text"];

    /* ---------------------------------------------------------------- *
     * 样式
     * ---------------------------------------------------------------- */

    /**
     * 「记忆卡片」字形：设置导航项自带的齿轮图标由外壳补齐，这里用同尺寸的
     * 字形把它换掉（见文件末尾 syncNavMarker 的说明）。data URI 只含
     * encodeURIComponent 转义后的字符，放进 url("…") 是安全的。
     */
    const NAV_GLYPH = (() => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 3.75h12A1.25 1.25 0 0 1 19.25 5v14A1.25 1.25 0 0 1 18 20.25H6A1.25 1.25 0 0 1 4.75 19V5A1.25 1.25 0 0 1 6 3.75Z"/>' +
        '<path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>';
      return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    })();

    const css = `
:root{--dshmem-nav-glyph:${NAV_GLYPH}}
/* 该 :root 变量供下面的导航字形使用；外壳的设置导航在本页面子树之外。 */
[role="dialog"] nav button[data-dshmem-nav] svg:first-child{display:none!important}
[role="dialog"] nav button[data-dshmem-nav]::before{content:"";flex:none;width:16px;height:16px;
  background-color:currentColor;
  -webkit-mask:var(--dshmem-nav-glyph) center/contain no-repeat;
  mask:var(--dshmem-nav-glyph) center/contain no-repeat}
.dshmem{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2329)}
.dshmem *{box-sizing:border-box}
.dshmem_bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dshmem_grow{flex:1;min-width:120px}
.dshmem_input,.dshmem_select,.dshmem_area{width:100%;padding:6px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;outline:none}
.dshmem_input:focus,.dshmem_select:focus,.dshmem_area:focus{border-color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_area{min-height:96px;resize:vertical;line-height:1.55;font-family:inherit}
.dshmem_btn{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;
  border-radius:8px;cursor:pointer;font:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  background:transparent;color:var(--dsw-alias-label-primary,#1f2329)}
.dshmem_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshmem_btn:disabled{opacity:.5;cursor:default}
.dshmem_btn_primary{border-color:transparent;background:var(--dsw-static-deepseek-450,#4d6bfe);color:#fff}
.dshmem_btn_primary:hover{background:var(--dsw-static-deepseek-500,#4176e6)}
.dshmem_btn_sm{height:24px;padding:0 8px;font-size:12px}
.dshmem_btn_danger:hover{color:var(--dsw-alias-state-error-primary,#d54941);
  border-color:var(--dsw-alias-state-error-primary,#d54941)}
.dshmem_tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.dshmem_tab{position:relative;padding:6px 10px;border:0;background:transparent;cursor:pointer;
  font:inherit;color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_tab_on{color:var(--dsw-static-deepseek-450,#4d6bfe);font-weight:600}
.dshmem_tab_on::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;
  border-radius:2px;background:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_stats{display:flex;flex-wrap:wrap;gap:6px}
.dshmem_chip{padding:3px 9px;border-radius:999px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02));
  color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_chip_click{cursor:pointer}
.dshmem_chip_on{border-color:var(--dsw-static-deepseek-450,#4d6bfe);
  color:var(--dsw-static-deepseek-450,#4d6bfe);
  /* --dsw-static-* 在浅色/深色里是同一个值，直接拿 deepseek-50 当底会在深色下糊出一块近白的色块；
     用半透明蓝叠加当前底色，两种主题都成立（不支持 color-mix 时退回中性层）。 */
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  background:color-mix(in srgb,var(--dsw-static-deepseek-450,#4d6bfe) 16%,transparent)}
.dshmem_sources{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.dshmem_source{padding:8px 10px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015));
  display:flex;flex-direction:column;gap:5px}
.dshmem_source_head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshmem_source_name{font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.dshmem_source_path{font-size:12px;color:var(--dsw-alias-label-dimmed,#8b9098);
  word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshmem_list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto;
  padding-right:2px}
.dshmem_card{display:flex;gap:10px;padding:10px 12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015))}
.dshmem_card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dshmem_card_pin{border-color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dshmem_title{font-weight:600;line-height:1.4;word-break:break-word}
.dshmem_body{white-space:pre-wrap;word-break:break-word;line-height:1.55;
  color:var(--dsw-alias-label-secondary,#5b6169);
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.dshmem_meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;
  color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_tag{color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_acts{display:flex;flex-direction:column;gap:6px;flex:none;align-items:flex-end}
/* 记忆空间：范围分区 → 标签分组 → 卡片 */
.dshmem_seg{display:inline-flex;gap:2px;padding:2px;border-radius:9px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02))}
.dshmem_seg_btn{height:24px;padding:0 10px;border:0;border-radius:7px;background:transparent;
  cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_seg_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
/* 同 .dshmem_chip_on：static token 不随主题变，用半透明蓝叠加当前底色。 */
.dshmem_seg_on{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  background:color-mix(in srgb,var(--dsw-static-deepseek-450,#4d6bfe) 16%,transparent);
  color:var(--dsw-static-deepseek-450,#4d6bfe);font-weight:600}
.dshmem_space{display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow:auto;
  padding-right:2px}
.dshmem_section{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015))}
.dshmem_sectionHead{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.dshmem_chev{flex:none;width:12px;font-size:10px;color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_sectionTitle{font-weight:600}
.dshmem_count{font-size:11.5px;color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_groups{display:flex;flex-direction:column;gap:12px}
.dshmem_group{display:flex;flex-direction:column;gap:6px}
.dshmem_groupHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshmem_groupTitle{font-size:12px;font-weight:600;cursor:pointer;user-select:none;
  color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_groupTitle_plain{color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_groupItems{display:flex;flex-direction:column;gap:6px;
  border-left:2px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));padding-left:8px}
.dshmem_card_dense{padding:8px 10px}
.dshmem_card_dense .dshmem_body{-webkit-line-clamp:2}
.dshmem_empty{padding:28px 12px;text-align:center;color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_err{padding:8px 10px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  color:var(--dsw-alias-state-error-primary,#d54941)}
.dshmem_ok{padding:8px 10px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_box{padding:12px;border-radius:10px;display:flex;flex-direction:column;gap:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015))}
.dshmem_row{display:flex;gap:8px;align-items:center}
.dshmem_lbl{flex:none;width:150px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_switch{display:flex;gap:8px;align-items:flex-start;cursor:pointer}
.dshmem_switch input{margin-top:2px;flex:none}
.dshmem_hint{font-size:11.5px;color:var(--dsw-alias-label-dimmed,#8a9099);line-height:1.5}
.dshmem_pick{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.dshmem_path{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all;
  color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_mirror{max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.5;
  padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03))}
/* 档案视图：照 WorkBuddy 的「记忆与进化」——两行开关 + 一份连续文档。 */
.dshmem_swRow{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015))}
.dshmem_swMain{display:flex;flex-direction:column;gap:3px;min-width:0}
.dshmem_swTitle{font-weight:600;line-height:1.4}
.dshmem_swHint{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_tgl{flex:none;position:relative;width:40px;height:22px;padding:0;border-radius:11px;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));cursor:pointer;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06))}
.dshmem_tgl::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}
.dshmem_tgl[data-on="1"]{background:var(--dsw-static-deepseek-500,#4176e6);
  border-color:var(--dsw-static-deepseek-500,#4176e6)}
.dshmem_tgl[data-on="1"]::after{left:20px}
.dshmem_docCardHead{display:flex;align-items:flex-start;justify-content:space-between;
  gap:14px;flex-wrap:wrap}
.dshmem_docMain{display:flex;flex-direction:column;gap:3px;min-width:0}
.dshmem_doc{display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow:auto;
  padding-right:2px}
.dshmem_docSec{font-size:11.5px;letter-spacing:.03em;
  color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_docItem{padding:8px 10px;border-radius:8px}
.dshmem_docItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dshmem_docHeadRow{display:flex;align-items:baseline;gap:8px}
.dshmem_docTitle{font-weight:600;line-height:1.5;word-break:break-word;
  color:var(--dsw-alias-label-primary,#0f1115)}
.dshmem_docFree{flex:none;font-size:11.5px;cursor:pointer;visibility:hidden;
  color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_docItem:hover .dshmem_docFree{visibility:visible}
.dshmem_docPara{margin-top:3px;white-space:pre-wrap;word-break:break-word;line-height:1.6;
  color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_docFoot{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-dimmed,#8a9099)}
.dshmem_area_doc{min-height:220px}
`;

    const CSS_TAG = "dsh-memory/Memory.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-memory";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /* ---------------------------------------------------------------- *
     * 宿主通信
     * ---------------------------------------------------------------- */

    // 文档相对：反代目录前缀与 dsh-app:// 外壳下同样可用。
    const baseUri = () =>
      (typeof document !== "undefined" && document.baseURI) || "http://127.0.0.1/";

    function url(path) {
      return new URL(String(path).replace(/^\/+/, ""), baseUri()).href;
    }

    async function request(method, path, { query, body, signal } = {}) {
      let target = url(`memory/api${path}`);
      if (query) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
          if (value === undefined || value === null || value === "") continue;
          params.set(key, String(value));
        }
        const qs = params.toString();
        if (qs) target += `?${qs}`;
      }
      const init = { method, signal, headers: {} };
      if (method !== "GET") {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(body ?? {});
      }
      const response = await fetch(target, init);
      const parsed = await response.json().catch(() => null);
      if (!response.ok || parsed === null || parsed.ok !== true) {
        const code = parsed?.error ? String(parsed.error) : `HTTP_${response.status}`;
        const detail = parsed?.detail?.message ? ` — ${parsed.detail.message}` : "";
        const error = new Error(`${code}${detail}`);
        error.code = code;
        throw error;
      }
      return parsed;
    }

    const api = {
      state: (workspace, signal) => request("GET", "/state", { query: { workspace }, signal }),
      list: (params, signal) => request("GET", "/list", { query: params, signal }),
      save: (body) => request("POST", "/save", { body }),
      update: (body) => request("POST", "/update", { body }),
      bulk: (body) => request("POST", "/bulk", { body }),
      remove: (body) => request("POST", "/delete", { body }),
      settings: (settings) => request("POST", "/settings", { body: { settings } }),
      mirror: (workspace) => request("GET", "/mirror", { query: { workspace } }),
      exportAll: (workspace) => request("GET", "/export", { query: { workspace } }),
      importAll: (body) => request("POST", "/import", { body }),
      importScan: (workspace) => request("GET", "/import-scan", { query: { workspace } }),
      importFromScan: (body) => request("POST", "/import-scan", { body }),
      capture: (workspace) => request("POST", "/capture", { body: { workspace } }),
      distill: (workspace, text) => request("POST", "/distill", { body: { workspace, text } }),
    };

    /* ---------------------------------------------------------------- *
     * i18n
     * ---------------------------------------------------------------- */

    const NS = "settings.memory";

    const zh = {
      nav: "记忆",
      tabMemories: "记忆",
      tabCapture: "自动提炼",
      tabSettings: "设置",
      search: "搜索记忆…",
      allCategories: "全部",
      scopeAll: "全部范围",
      scopeWorkspace: "本工作区",
      scopeGlobal: "全局",
      showArchived: "含已归档",
      scopeProject: "项目记忆",
      scopeGlobalFull: "全局记忆",
      viewDoc: "档案",
      viewSpace: "记忆空间",
      viewList: "列表",
      groupByTag: "按标签",
      groupByCategory: "按类型",
      groupByNone: "不分组",
      ungrouped: "未归类",
      consolidate: "整合",
      consolidateHint: "把本组的记忆合并成一条，原条目归档",
      consolidated: "已整合为一条新记忆，原条目已归档（勾选「含已归档」可查看）",
      manageMemory: "管理记忆",
      manageHint: "按标签自动整理，也可整篇查看和编辑。",
      tidy: "整理",
      tidyNothing: "没有可整理的标签分组（同一标签下至少两条才会合并）",
      tidied: "已整理 {n} 组，合并稿入库、原条目归档",
      editDoc: "编辑",
      docEditHint: "整篇编辑：`## 分区` 起一段，`**标题**` 起一条，正文跟在标题后面。删掉整条会把它归档（不删除）。",
      docSaved: "已保存：写入/更新 {n} 条，归档 {a} 条",
      docFooter: "记忆保存在 {path}，仅保存在你的设备上",
      docAuto: "对话记忆",
      docAutoHint: "记住对话中的重要信息，让后续回答更贴合你。",
      docLocal: "本地记忆与技能",
      docLocalHint: "自动记录工作过程，并镜像一份到工作区的 .dsh-memory/MEMORY.md，数据仅保存在你的设备上。",
      untitled: "（未命名）",
      sort: "排序",
      sortUpdated: "最近更新",
      sortCreated: "最近创建",
      sortTitle: "标题",
      refresh: "刷新",
      newMemory: "新建记忆",
      pinned: "置顶",
      archived: "已归档",
      globalTag: "全局",
      empty: "这个工作区还没有记忆",
      emptyHint: "会话中模型调用 memory 工具保存，或在这里手工新建。",
      loading: "读取中…",
      workspace: "工作区",
      total: "共",
      unit: "条",
      pinnedCount: "置顶",
      globalCount: "全局",
      edit: "编辑",
      pin: "置顶",
      unpin: "取消置顶",
      archive: "归档",
      unarchive: "取消归档",
      remove: "删除",
      confirmRemove: "确定删除这条记忆？",
      save: "保存",
      cancel: "取消",
      formNew: "新建记忆",
      formEdit: "编辑记忆",
      fTitle: "标题",
      fTitlePh: "一句话说清这条记忆是什么",
      fContent: "内容",
      fContentPh: "事实本身，以及让它有用的原因或证据",
      fCategory: "类别",
      fTags: "标签",
      fTagsPh: "用逗号分隔",
      fScope: "范围",
      fPinned: "置顶（总是优先注入）",
      errTitle: "标题和内容至少要填一个",
      sBriefing: "会话开始时注入记忆摘要",
      sBriefingHint: "把本工作区最重要的记忆放进系统提示，模型一开场就知道。",
      sLimit: "注入条数上限",
      sChars: "注入字数上限",
      sAuto: "轮次结束时自动提炼",
      sAutoHint: "每轮对话结束后用模型归纳出值得长期保留的事实。会消耗额外 token。",
      sAutoMin: "最短对话长度",
      sCooldown: "提炼最小间隔（毫秒）",
      sMinConf: "最低置信度",
      sMaxTurn: "每次最多落库条数",
      sTranscript: "对话摘录字数上限",
      sMirror: "在工作区生成 .dsh-memory/MEMORY.md",
      sMirrorHint: "人类可读的镜像文件，方便直接看和提交。主库始终在 ~/.dsh/storages/dsh-memory。",
      sDedupe: "自动合并高度相似的记忆",
      sEnabled: "启用记忆系统",
      saved: "已保存设置",
      captureNow: "提炼当前会话",
      capturing: "提炼中…",
      captureLog: "最近提炼记录",
      captureEmpty: "还没有提炼记录",
      distillTitle: "粘贴一段文本做提炼",
      distillPh: "把一段对话、日志或笔记粘进来，模型会抽出值得长期保留的记忆。",
      distill: "提炼",
      distilling: "提炼中…",
      candidates: "候选记忆",
      adopt: "全部保存",
      adopted: "已保存",
      noCandidates: "没有抽到值得保留的内容",
      mirrorTitle: "镜像文件",
      mirrorEmpty: "还没有生成镜像文件（保存一条记忆后就会出现）",
      mirrorLoading: "正在读取镜像内容…",
      mirrorPresent: "已生成",
      mirrorAbsent: "未生成",
      mirrorStorage: "主库旁车",
      mirrorGlobal: "（全局记忆没有工作区镜像）",
      copy: "复制",
      copied: "已复制",
      exportTitle: "备份与迁移",
      exportDo: "导出 JSON",
      importDo: "导入 JSON",
      importPh: "粘贴导出内容或纯文本（空行分段，首行为标题）",
      imported: "导入完成",
      formatLabel: "文本格式",
      formatDetected: "识别为 {f}",
      format_auto: "自动识别",
      format_workbuddy: "WorkBuddy 笔记",
      format_qoder: "Qoder 记忆",
      format_daily: "每日日志",
      format_text: "纯文本",
      scanTitle: "从本机既有记忆导入",
      scanHint: "扫描 Qoder、WorkBuddy 与本插件镜像留下的记忆文件，按「一条记忆」拆好再入库；只读来源，不会改动原文件。",
      scanDo: "扫描本机",
      scanning: "扫描中…",
      scanAll: "全部导入",
      scanOne: "导入这个来源",
      scanFiles: "{n} 个文件",
      scanAbsent: "未找到",
      scanGlobal: "用户级",
      scanWorkspace: "工作区级",
      scanNothing: "没有扫描到可导入的记忆文件",
      scanImported: "已导入 {n} 条",
    };

    const en = {
      nav: "Memory",
      tabMemories: "Memories",
      tabCapture: "Distillation",
      tabSettings: "Settings",
      search: "Search memories…",
      allCategories: "All",
      scopeAll: "Any scope",
      scopeWorkspace: "This workspace",
      scopeGlobal: "Global",
      showArchived: "Include archived",
      scopeProject: "Project memory",
      scopeGlobalFull: "Global memory",
      viewDoc: "Profile",
      viewSpace: "Memory space",
      viewList: "List",
      groupByTag: "By tag",
      groupByCategory: "By type",
      groupByNone: "Flat",
      ungrouped: "Uncategorized",
      consolidate: "Consolidate",
      consolidateHint: "Merge this group into one memory; the sources get archived",
      consolidated: "Consolidated. Sources were archived (enable “Include archived” to see them).",
      manageMemory: "Manage memories",
      manageHint: "Tidy by tag, or view and edit everything as one document.",
      tidy: "Tidy up",
      tidyNothing: "Nothing to tidy (a tag needs at least two entries to be merged)",
      tidied: "Tidied {n} group(s): merged entry saved, sources archived",
      editDoc: "Edit",
      docEditHint: "Whole-document editing: `## section` starts a section, `**Title**` starts an entry, body follows the title. Deleting an entry archives it (never deletes).",
      docSaved: "Saved: {n} written/updated, {a} archived",
      docFooter: "Memories are stored in {path}, on your device only",
      docAuto: "Conversation memory",
      docAutoHint: "Remember what matters from your conversations so later answers fit you better.",
      docLocal: "Local memory & skills",
      docLocalHint: "Tracks how you work and mirrors a copy to .dsh-memory/MEMORY.md in the workspace. Data stays on your device.",
      untitled: "(untitled)",
      sort: "Sort",
      sortUpdated: "Recently updated",
      sortCreated: "Recently created",
      sortTitle: "Title",
      refresh: "Refresh",
      newMemory: "New memory",
      pinned: "Pinned",
      archived: "Archived",
      globalTag: "Global",
      empty: "No memories in this workspace yet",
      emptyHint: "The agent saves them through the memory tool, or create one here.",
      loading: "Loading…",
      workspace: "Workspace",
      total: "Total",
      unit: "",
      pinnedCount: "Pinned",
      globalCount: "Global",
      edit: "Edit",
      pin: "Pin",
      unpin: "Unpin",
      archive: "Archive",
      unarchive: "Unarchive",
      remove: "Delete",
      confirmRemove: "Delete this memory?",
      save: "Save",
      cancel: "Cancel",
      formNew: "New memory",
      formEdit: "Edit memory",
      fTitle: "Title",
      fTitlePh: "One line saying what this memory is",
      fContent: "Content",
      fContentPh: "The fact itself, plus the reasoning or evidence that makes it useful",
      fCategory: "Category",
      fTags: "Tags",
      fTagsPh: "Comma separated",
      fScope: "Scope",
      fPinned: "Pinned (always injected first)",
      errTitle: "Fill in a title or some content",
      sBriefing: "Inject a memory briefing at session start",
      sBriefingHint: "Puts the most important memories of this workspace into the system prompt.",
      sLimit: "Max memories injected",
      sChars: "Max characters injected",
      sAuto: "Auto-distill at turn end",
      sAutoHint: "Summarises durable facts after each turn using the model. Costs extra tokens.",
      sAutoMin: "Minimum transcript length",
      sCooldown: "Minimum interval (ms)",
      sMinConf: "Minimum confidence",
      sMaxTurn: "Max memories per turn",
      sTranscript: "Max transcript characters",
      sMirror: "Write .dsh-memory/MEMORY.md into the workspace",
      sMirrorHint: "A human-readable mirror you can read and commit. The main store stays in ~/.dsh/storages/dsh-memory.",
      sDedupe: "Merge highly similar memories automatically",
      sEnabled: "Enable the memory system",
      saved: "Settings saved",
      captureNow: "Distill current session",
      capturing: "Distilling…",
      captureLog: "Recent distillations",
      captureEmpty: "Nothing distilled yet",
      distillTitle: "Distill pasted text",
      distillPh: "Paste a conversation, log or note and the model extracts durable memories.",
      distill: "Distill",
      distilling: "Distilling…",
      candidates: "Candidate memories",
      adopt: "Save all",
      adopted: "Saved",
      noCandidates: "Nothing worth keeping was found",
      mirrorTitle: "Mirror file",
      mirrorEmpty: "No mirror file yet (save one memory and it appears)",
      mirrorLoading: "Loading mirror content…",
      mirrorPresent: "written",
      mirrorAbsent: "not written",
      mirrorStorage: "Storage copy",
      mirrorGlobal: "(global memory has no workspace mirror)",
      copy: "Copy",
      copied: "Copied",
      exportTitle: "Backup and migration",
      exportDo: "Export JSON",
      importDo: "Import JSON",
      importPh: "Paste an export or plain text (blank line separated, first line is the title)",
      imported: "Import finished",
      formatLabel: "Text format",
      formatDetected: "Detected as {f}",
      format_auto: "Auto detect",
      format_workbuddy: "WorkBuddy note",
      format_qoder: "Qoder memory",
      format_daily: "Daily log",
      format_text: "Plain text",
      scanTitle: "Import existing memories from this machine",
      scanHint: "Scans memory files left by Qoder, WorkBuddy and this plugin's mirror, splits them into memories and stores them. Sources are read-only.",
      scanDo: "Scan machine",
      scanning: "Scanning…",
      scanAll: "Import all",
      scanOne: "Import this source",
      scanFiles: "{n} files",
      scanAbsent: "Not found",
      scanGlobal: "User level",
      scanWorkspace: "Workspace level",
      scanNothing: "No importable memory files found",
      scanImported: "Imported {n}",
    };

    /* ---------------------------------------------------------------- *
     * 分组显示名（英文态）
     * ---------------------------------------------------------------- */

    /** 中文类别标签（与宿主 lib/store.js 的 CATEGORY_LABELS 保持一致）。 */
    const CatLabels = {
      zh: {
        fact: "事实",
        preference: "偏好",
        decision: "决策",
        convention: "约定",
        component: "组件",
        task: "待办",
        note: "笔记",
      },
    };

    const CATEGORY_EN = {
      fact: "Fact",
      preference: "Preference",
      decision: "Decision",
      convention: "Convention",
      component: "Component",
      task: "Task",
      note: "Note",
    };

    const SOURCE_LABEL = {
      manual: "manual",
      agent: "agent",
      auto: "auto",
      import: "import",
    };

    /* ---------------------------------------------------------------- *
     * 小工具
     * ---------------------------------------------------------------- */

    function when(iso) {
      if (!iso) return "";
      const at = Date.parse(iso);
      if (!Number.isFinite(at)) return String(iso);
      const diff = Date.now() - at;
      const min = Math.round(diff / 60000);
      if (min < 1) return "just now";
      if (min < 60) return `${min}m`;
      const hours = Math.round(min / 60);
      if (hours < 24) return `${hours}h`;
      const days = Math.round(hours / 24);
      if (days < 30) return `${days}d`;
      return new Date(at).toISOString().slice(0, 10);
    }

    function baseName(root) {
      const clean = String(root || "").replace(/[\\/]+$/, "");
      const parts = clean.split(/[\\/]/);
      return parts[parts.length - 1] || clean;
    }

    function Spin() {
      return h("div", { className: "dshmem_empty" }, "…");
    }

    /* ---------------------------------------------------------------- *
     * 记忆卡片
     * ---------------------------------------------------------------- */

    function Card({ record, t, lang, dense, onEdit, onRemove, onTogglePin, onToggleArchive }) {
      const label = lang === "zh"
        ? CatLabels.zh[record.category] || record.category
        : CATEGORY_EN[record.category] || record.category;
      const tags = Array.isArray(record.tags) ? record.tags : [];
      return h("div", {
        className: `dshmem_card${record.pinned ? " dshmem_card_pin" : ""}${
          dense ? " dshmem_card_dense" : ""
        }`,
      },
        h("div", { className: "dshmem_main" },
          h("div", { className: "dshmem_title" }, record.title),
          record.content
            ? h("div", { className: "dshmem_body" }, record.content)
            : null,
          h("div", { className: "dshmem_meta" },
            h("span", { className: "dshmem_chip" }, label),
            record.scope === "global" ? h("span", { className: "dshmem_chip" }, t("globalTag")) : null,
            record.pinned ? h("span", { className: "dshmem_chip dshmem_chip_on" }, t("pinned")) : null,
            record.archived ? h("span", { className: "dshmem_chip" }, t("archived")) : null,
            tags.map((tag) => h("span", { key: tag, className: "dshmem_tag" }, `#${tag}`)),
            h("span", null, `${SOURCE_LABEL[record.source] || record.source} · ${when(record.updatedAt)}`),
            record.useCount ? h("span", null, `×${record.useCount}`) : null
          )
        ),
        h("div", { className: "dshmem_acts" },
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_sm",
            onClick: () => onEdit(record),
          }, t("edit")),
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_sm",
            onClick: () => onTogglePin(record),
          }, record.pinned ? t("unpin") : t("pin")),
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_sm",
            onClick: () => onToggleArchive(record),
          }, record.archived ? t("unarchive") : t("archive")),
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_sm dshmem_btn_danger",
            onClick: () => {
              if (typeof window !== "undefined" && !window.confirm(t("confirmRemove"))) return;
              onRemove(record);
            },
          }, t("remove"))
        )
      );
    }

    /* ---------------------------------------------------------------- *
     * 编辑 / 新建表单
     * ---------------------------------------------------------------- */

    function Editor({ t, lang, categories, draft, busy, onCancel, onSubmit }) {
      const [form, setForm] = useState(() => ({
        id: draft?.id || "",
        title: draft?.title || "",
        content: draft?.content || "",
        category: draft?.category || "note",
        tags: Array.isArray(draft?.tags) ? draft.tags.join(", ") : "",
        scope: draft?.scope || "workspace",
        pinned: Boolean(draft?.pinned),
      }));
      const [error, setError] = useState("");
      const patch = (key, value) => setForm((current) => ({ ...current, [key]: value }));

      const submit = () => {
        if (!form.title.trim() && !form.content.trim()) {
          setError(t("errTitle"));
          return;
        }
        setError("");
        onSubmit({
          id: form.id || undefined,
          title: form.title.trim(),
          content: form.content.trim(),
          category: form.category,
          tags: form.tags
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          scope: form.scope,
          pinned: form.pinned,
        });
      };

      return h("div", { className: "dshmem_box" },
        h("div", { className: "dshmem_title" }, form.id ? t("formEdit") : t("formNew")),
        h("input", {
          className: "dshmem_input",
          value: form.title,
          placeholder: t("fTitlePh"),
          onChange: (event) => patch("title", event.target.value),
        }),
        h("textarea", {
          className: "dshmem_area",
          value: form.content,
          placeholder: t("fContentPh"),
          onChange: (event) => patch("content", event.target.value),
        }),
        h("div", { className: "dshmem_row" },
          h("span", { className: "dshmem_lbl" }, t("fCategory")),
          h("select", {
            className: "dshmem_select",
            value: form.category,
            onChange: (event) => patch("category", event.target.value),
          }, categories.map((item) =>
            h("option", { key: item.id, value: item.id }, lang === "zh" ? item.label : CATEGORY_EN[item.id] || item.id))),
          h("span", { className: "dshmem_lbl" }, t("fScope")),
          h("select", {
            className: "dshmem_select",
            value: form.scope,
            onChange: (event) => patch("scope", event.target.value),
          },
            h("option", { value: "workspace" }, t("scopeWorkspace")),
            h("option", { value: "global" }, t("scopeGlobal"))
          )
        ),
        h("div", { className: "dshmem_row" },
          h("span", { className: "dshmem_lbl" }, t("fTags")),
          h("input", {
            className: "dshmem_input",
            value: form.tags,
            placeholder: t("fTagsPh"),
            onChange: (event) => patch("tags", event.target.value),
          })
        ),
        h("label", { className: "dshmem_switch" },
          h("input", {
            type: "checkbox",
            checked: form.pinned,
            onChange: (event) => patch("pinned", event.target.checked),
          }),
          h("span", null, t("fPinned"))
        ),
        error ? h("div", { className: "dshmem_err" }, error) : null,
        h("div", { className: "dshmem_row" },
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_primary",
            disabled: busy,
            onClick: submit,
          }, t("save")),
          h("button", { type: "button", className: "dshmem_btn", onClick: onCancel }, t("cancel"))
        )
      );
    }

    /* ---------------------------------------------------------------- *
     * 设置页
     * ---------------------------------------------------------------- */

    function MemorySection(props) {
      const t = props.t;
      // inject 面提供的 hook：语言切换时 revision 变化 → 重算 lang。
      const localeRevision = props.useMemoryLocale
        ? props.useMemoryLocale((snapshot) => snapshot?.revision ?? 0)
        : 0;
      const lang = useMemo(() => {
        try {
          return t("nav") === "记忆" ? "zh" : "en";
        } catch {
          return "zh";
        }
      }, [t, localeRevision]);

      const [tab, setTab] = useState("memories");
      const [state, setState] = useState(null);
      const [records, setRecords] = useState([]);
      const [total, setTotal] = useState(0);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");

      const [query, setQuery] = useState("");
      const [category, setCategory] = useState("");
      const [scope, setScope] = useState("");
      const [archived, setArchived] = useState(false);
      const [sort, setSort] = useState("updated");
      const [workspace, setWorkspace] = useState("");
      const [manualRoot, setManualRoot] = useState("");

      /* 记忆空间：范围分区（项目记忆 / 全局记忆）× 标签分组，外加折叠与「整合」来源。 */
      /* 视图默认「档案」：一条条卡片适合管理，但用户平时想看的是一份连续的档案。 */
      const [view, setView] = useState("doc");
      const [groupBy, setGroupBy] = useState("tag");
      const [collapsed, setCollapsed] = useState({});
      const [mergeIds, setMergeIds] = useState(null);
      const [docDraft, setDocDraft] = useState(null);
      const [docImport, setDocImport] = useState(false);

      const [draft, setDraft] = useState(null);
      const [busy, setBusy] = useState(false);

      const [settings, setSettings] = useState(null);
      const [settingsDirty, setSettingsDirty] = useState(false);

      const [captures, setCaptures] = useState([]);
      const [capturing, setCapturing] = useState(false);
      const [distillText, setDistillText] = useState("");
      const [distilling, setDistilling] = useState(false);
      const [candidates, setCandidates] = useState(null);
      const [importText, setImportText] = useState("");
      const [importFormat, setImportFormat] = useState("auto");
      const [scan, setScan] = useState(null);
      const [scanning, setScanning] = useState(false);
      const [scanBusy, setScanBusy] = useState("");

      const alive = useRef(true);
      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const target = workspace || manualRoot || "";

      const flash = useCallback((message) => {
        setNotice(message);
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            if (alive.current) setNotice("");
          }, 2600);
        }
      }, []);

      /* 首屏 / 工作区切换：拉 state。 */
      useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        api
          .state(target, controller.signal)
          .then((payload) => {
            if (!alive.current) return;
            setState(payload);
            setCaptures(Array.isArray(payload.captures) ? payload.captures : []);
            setSettings((current) => current || payload.settings || null);
            if (!workspace && payload.workspace?.root) setWorkspace(payload.workspace.root);
            setError("");
          })
          .catch((cause) => {
            if (cause?.name === "AbortError" || !alive.current) return;
            setError(String(cause?.message || cause));
          })
          .finally(() => {
            if (alive.current) setLoading(false);
          });
        return () => controller.abort();
      }, [target]);

      /* 镜像预览：文件已经存在就自动取一次内容，免得旁边写着「已生成」而这里空着。 */
      useEffect(() => {
        const exists = Boolean(state?.mirror?.workspaceExists || state?.mirror?.storageExists);
        if (!exists || state?.mirror?.markdown) return undefined;
        let cancelled = false;
        api
          .mirror(target)
          .then((payload) => {
            if (cancelled || !alive.current) return;
            setState((current) => ({ ...(current || {}), mirror: payload.mirror }));
          })
          .catch(() => {
            /* 预览取不到不影响其它区块 */
          });
        return () => {
          cancelled = true;
        };
      }, [target, state?.mirror?.workspaceExists, state?.mirror?.storageExists, state?.mirror?.markdown]);

      /* 列表：筛选条件变化就重拉。 */
      const reload = useCallback(
        (signal) => {
          setLoading(true);
          return api
            .list(
              {
                workspace: target,
                q: query.trim(),
                category,
                scope,
                archived: archived ? "1" : "",
                sort,
                limit: 300,
              },
              signal,
            )
            .then((payload) => {
              if (!alive.current) return;
              setRecords(Array.isArray(payload.records) ? payload.records : []);
              setTotal(Number(payload.total) || 0);
              setError("");
            })
            .catch((cause) => {
              if (cause?.name === "AbortError" || !alive.current) return;
              setError(String(cause?.message || cause));
            })
            .finally(() => {
              if (alive.current) setLoading(false);
            });
        },
        [target, query, category, scope, archived, sort],
      );

      useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => reload(controller.signal), query ? 220 : 0);
        return () => {
          window.clearTimeout(timer);
          controller.abort();
        };
      }, [reload, query]);

      /* 写操作后统一刷新状态与列表。 */
      const afterWrite = useCallback(
        (message) => {
          if (message) flash(message);
          return api
            .state(target)
            .then((payload) => {
              if (!alive.current) return;
              setState(payload);
              setCaptures(Array.isArray(payload.captures) ? payload.captures : []);
            })
            .catch(() => {})
            .then(() => reload());
        },
        [target, flash, reload],
      );

      const run = useCallback(
        (promise, message) => {
          setBusy(true);
          setError("");
          return promise
            .then(() => afterWrite(message))
            .catch((cause) => setError(String(cause?.message || cause)))
            .finally(() => setBusy(false));
        },
        [afterWrite],
      );

      const stats = state?.stats || { total: 0, pinned: 0, global: 0, byCategory: {} };
      /* 顶部的「共 N 条」要跟当前范围筛选对上，否则会和列表里的卡片数打架。 */
      const scopeTotal =
        scope === "global" ? stats.global : scope === "workspace" ? stats.total : stats.total + stats.global;
      const categories = state?.categories || [];
      const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const tagList = Array.isArray(state?.tags) ? state.tags : [];
      const catLabel = (id) =>
        lang === "zh" ? CatLabels.zh[id] || id : CATEGORY_EN[id] || id;

      /* ---------------- 记忆页 ---------------- */

      const UNGROUPED = "__none__";
      const ALL_GROUP = "__all__";
      const unitSuffix = lang === "zh" ? t("unit") : "";

      /* 分组键：按标签时取第一条标签（一条记忆只落一组），按类型时取 category。 */
      const groupKeyOf = (record) => {
        if (groupBy === "category") return `cat:${record.category || "note"}`;
        const first = Array.isArray(record.tags) && record.tags.length ? String(record.tags[0]) : "";
        return first ? `tag:${first}` : UNGROUPED;
      };
      const groupLabelOf = (key) => {
        if (key === UNGROUPED) return t("ungrouped");
        if (key === ALL_GROUP) return t("total");
        if (key.startsWith("cat:")) return catLabel(key.slice(4));
        return `#${key.slice(4)}`;
      };
      const groupRecords = (list) => {
        const buckets = new Map();
        for (const record of list) {
          const key = groupBy === "none" ? ALL_GROUP : groupKeyOf(record);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(record);
        }
        return [...buckets.entries()]
          .map(([key, items]) => ({ key, label: groupLabelOf(key), items }))
          .sort((a, b) => {
            if (a.key === UNGROUPED) return 1;
            if (b.key === UNGROUPED) return -1;
            return b.items.length - a.items.length || a.label.localeCompare(b.label);
          });
      };

      const isFolded = (key) => Boolean(collapsed[key]);
      const toggleFolded = (key) =>
        setCollapsed((current) => ({ ...current, [key]: !current[key] }));

      /* 整合：把一组记忆合并成一条新记忆，原条目走 /bulk 归档（可取消归档恢复）。 */
      const consolidateDraft = (scopeId, group) => {
        const tally = new Map();
        for (const record of group.items) {
          tally.set(record.category, (tally.get(record.category) || 0) + 1);
        }
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        const tagged = group.key.startsWith("tag:");
        return {
          title: tagged ? group.key.slice(4) : group.label,
          content: group.items
            .map((record) => {
              const body = String(record.content || "").replace(/\s+/g, " ").trim();
              return `- **${record.title}**${body ? ` — ${body}` : ""}`;
            })
            .join("\n"),
          category: top ? top[0] : "note",
          tags: tagged ? [group.key.slice(4)] : [],
          scope: scopeId,
        };
      };
      const startConsolidate = (scopeId, group) => {
        setMergeIds(group.items.map((record) => record.id));
        setDraft(consolidateDraft(scopeId, group));
      };
      const closeEditor = () => {
        setDraft(null);
        setMergeIds(null);
      };
      const submitDraft = (form) => {
        const sources = mergeIds;
        closeEditor();
        if (form.id) {
          run(api.update({ workspace: target, ...form }), t("saved"));
          return;
        }
        const saving = api.save({ workspace: target, ...form, source: "manual" });
        run(
          sources && sources.length
            ? saving.then(() => api.bulk({ workspace: target, action: "archive", ids: sources }))
            : saving,
          sources && sources.length ? t("consolidated") : t("saved"),
        );
      };

      const cardNode = (record, dense) =>
        h(Card, {
          key: record.id,
          record,
          t,
          lang,
          dense,
          onEdit: (item) => {
            setMergeIds(null);
            setDraft(item);
          },
          onTogglePin: (item) =>
            run(api.update({ workspace: target, id: item.id, pinned: !item.pinned })),
          onToggleArchive: (item) =>
            run(api.update({ workspace: target, id: item.id, archived: !item.archived })),
          onRemove: (item) => run(api.remove({ workspace: target, id: item.id })),
        });

      const groupNode = (scopeId, group) => {
        const key = `${scopeId}:${group.key}`;
        const folded = isFolded(key);
        return h("div", { className: "dshmem_group", key: group.key },
          h("div", { className: "dshmem_groupHead" },
            h("span", {
              className: `dshmem_groupTitle${group.key.startsWith("tag:") ? "" : " dshmem_groupTitle_plain"}`,
              onClick: () => toggleFolded(key),
            }, `${folded ? "▸" : "▾"} ${group.label}`),
            h("span", { className: "dshmem_count" }, `${group.items.length}${unitSuffix}`),
            group.items.length > 1
              ? h("button", {
                  type: "button",
                  className: "dshmem_btn dshmem_btn_sm",
                  title: t("consolidateHint"),
                  onClick: () => startConsolidate(scopeId, group),
                }, t("consolidate"))
              : null
          ),
          folded
            ? null
            : h("div", { className: "dshmem_groupItems" },
                group.items.map((record) => cardNode(record, true)))
        );
      };

      /* 范围分区：项目记忆（本工作区）与全局记忆分开放，和 Qoder 的划分一致。 */
      const scopeSections = [
        { id: "workspace", label: t("scopeProject"), hint: state?.workspace?.root || target || "" },
        { id: "global", label: t("scopeGlobalFull"), hint: "" },
      ].filter((section) => scope === "" || scope === section.id);

      const spaceTab = h("div", { className: "dshmem_space" },
        scopeSections.map((section) => {
          const items = records.filter((record) => record.scope === section.id);
          const key = `section:${section.id}`;
          const folded = isFolded(key);
          return h("div", { className: "dshmem_section", key: section.id },
            h("div", { className: "dshmem_sectionHead", onClick: () => toggleFolded(key) },
              h("span", { className: "dshmem_chev" }, folded ? "▸" : "▾"),
              h("span", { className: "dshmem_sectionTitle" }, section.label),
              h("span", { className: "dshmem_count" }, `${items.length}${unitSuffix}`),
              section.hint ? h("span", { className: "dshmem_hint dshmem_path" }, section.hint) : null
            ),
            folded || !items.length
              ? null
              : h("div", { className: "dshmem_groups" },
                  groupRecords(items).map((group) => groupNode(section.id, group)))
          );
        })
      );

      /* ---------------- 档案视图：照 WorkBuddy 的「记忆与进化」 ---------------- */

      /* 文档里按分区出现顺序排；没有内容的分区不出现，免得留下一行空标题。 */
      const docSections = scopeSections.filter((section) =>
        records.some((record) => record.scope === section.id));

      const docText = () =>
        docSections
          .map((section) => {
            const blocks = records
              .filter((record) => record.scope === section.id)
              .map((record) => `**${record.title || t("untitled")}**\n${String(record.content || "").trim()}`);
            return [`## ${section.label}`, ...blocks].join("\n");
          })
          .join("\n\n");

      /* 解析整篇文档：`## 分区` 换区，`**标题**` 起一条，其余非空行并入正文。 */
      const parseDoc = (text) => {
        const out = [];
        let scopeId = docSections[0]?.id || "workspace";
        let current = null;
        for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
          const line = raw.trim();
          const heading = /^##\s+(.+)$/.exec(line);
          if (heading) {
            const hit = scopeSections.find((section) => section.label === heading[1].trim());
            if (hit) scopeId = hit.id;
            current = null;
            continue;
          }
          const bold = /^\*\*(.+?)\*\*$/.exec(line);
          if (bold) {
            current = { scope: scopeId, title: bold[1].trim(), lines: [] };
            out.push(current);
            continue;
          }
          if (!line) {
            if (current) current.lines.push("");
            continue;
          }
          if (!current) {
            current = { scope: scopeId, title: "", lines: [] };
            out.push(current);
          }
          current.lines.push(line);
        }
        return out
          .map((item) => {
            if (item.title) {
              return { scope: item.scope, title: item.title, content: item.lines.join("\n").trim() };
            }
            /* 没写粗体标题的，首行当标题、其余当正文。 */
            const at = item.lines.findIndex((line) => line.trim());
            return {
              scope: item.scope,
              title: String(item.lines[at] || "").trim().slice(0, 60),
              content: item.lines.slice(at + 1).join("\n").trim(),
            };
          })
          .filter((item) => item.title || item.content);
      };

      /* 回写整篇：同名同区的更新正文，没命中的新建，文档里消失的归档（不删除）。 */
      const applyDoc = () => {
        const blocks = parseDoc(docDraft);
        const known = new Map(records.map((record) => [`${record.scope}\u0000${record.title}`, record]));
        const kept = new Set();
        setBusy(true);
        setError("");
        (async () => {
          let written = 0;
          let archived = 0;
          for (const block of blocks) {
            const hit = known.get(`${block.scope}\u0000${block.title}`);
            if (hit) {
              kept.add(hit.id);
              if (String(hit.content || "").trim() !== block.content) {
                await api.update({ workspace: target, id: hit.id, content: block.content });
                written += 1;
              }
              continue;
            }
            await api.save({
              workspace: target,
              source: "manual",
              title: block.title,
              content: block.content,
              scope: block.scope,
            });
            written += 1;
          }
          const gone = records
            .filter((record) => !kept.has(record.id) && !record.archived)
            .map((record) => record.id);
          if (gone.length) {
            await api.bulk({ workspace: target, action: "archive", ids: gone });
            archived = gone.length;
          }
          return { written, archived };
        })()
          .then((counts) => {
            setDocDraft(null);
            return afterWrite(
              t("docSaved").replace("{n}", String(counts.written)).replace("{a}", String(counts.archived)),
            );
          })
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      };

      /* 「整理」＝每个同标签分组各自合并成一条，原条目归档；没有可整理的组就直说。 */
      const tidyJobs = [];
      for (const section of scopeSections) {
        for (const group of groupRecords(records.filter((record) => record.scope === section.id))) {
          if (group.key.startsWith("tag:") && group.items.length > 1) tidyJobs.push({ section, group });
        }
      }
      const tidyAll = () => {
        if (!tidyJobs.length) {
          flash(t("tidyNothing"));
          return;
        }
        setBusy(true);
        setError("");
        (async () => {
          for (const job of tidyJobs) {
            await api.save({ workspace: target, source: "manual", ...consolidateDraft(job.section.id, job.group) });
            await api.bulk({
              workspace: target,
              action: "archive",
              ids: job.group.items.map((record) => record.id),
            });
          }
          return tidyJobs.length;
        })()
          .then((count) => afterWrite(t("tidied").replace("{n}", String(count))))
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      };

      /* 开关行：点一下即时落库（POST /settings 是 patch 合并，只发这一个键）。 */
      const flipSetting = (key) => {
        const next = !(settings ? settings[key] : false);
        setSettings((current) => ({ ...(current || {}), [key]: next }));
        setSettingsDirty(false);
        setBusy(true);
        setError("");
        api
          .settings({ [key]: next })
          .then((payload) => {
            if (!alive.current) return;
            if (payload?.settings) setSettings(payload.settings);
            flash(t("saved"));
          })
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      };

      /* 导入：设置页与档案页共用一份（JSON 走结构化，其余按文本 + 格式解析）。 */
      const doImport = () => {
        setBusy(true);
        setError("");
        let payload;
        try {
          payload = JSON.parse(importText);
        } catch {
          payload = { text: importText, format: importFormat };
        }
        api
          .importAll({ workspace: target, mode: "merge", ...payload })
          .then((result) => {
            if (result?.detectedFormat) {
              flash(t("formatDetected").replace("{f}", result.formatLabel || result.detectedFormat));
            }
            setDocImport(false);
            return afterWrite(t("imported"));
          })
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      };

      const switchRow = (key, title, hint) => {
        const on = Boolean(settings ? settings[key] : false);
        return h("div", { className: "dshmem_swRow", key },
          h("div", { className: "dshmem_swMain" },
            h("div", { className: "dshmem_swTitle" }, title),
            h("div", { className: "dshmem_swHint" }, hint)),
          h("button", {
            type: "button",
            role: "switch",
            "aria-checked": on ? "true" : "false",
            "data-on": on ? "1" : "0",
            className: "dshmem_tgl",
            title,
            disabled: busy,
            onClick: () => flipSetting(key),
          }));
      };

      const docItems = [];
      for (const section of docSections) {
        docItems.push(h("div", { className: "dshmem_docSec", key: `sec:${section.id}` }, section.label));
        for (const record of records.filter((item) => item.scope === section.id)) {
          docItems.push(h("div", { className: "dshmem_docItem", key: record.id },
            h("div", { className: "dshmem_docHeadRow" },
              h("span", { className: "dshmem_docTitle" }, record.title || t("untitled")),
              h("span", {
                className: "dshmem_docFree",
                onClick: () => {
                  setMergeIds(null);
                  setDraft(record);
                },
              }, t("edit"))),
            String(record.content || "").trim()
              ? h("div", { className: "dshmem_docPara" }, String(record.content).trim())
              : null));
        }
      }

      const docPath = state?.mirror?.storageFile || state?.workspace?.dataFile || "";
      const docTab = h("div", { className: "dshmem" },
        h("div", { className: "dshmem_box" },
          switchRow("autoCapture", t("docAuto"), t("docAutoHint")),
          switchRow("mirror", t("docLocal"), t("docLocalHint"))),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_docCardHead" },
            h("div", { className: "dshmem_docMain" },
              h("div", { className: "dshmem_title" }, t("manageMemory")),
              h("div", { className: "dshmem_hint" }, t("manageHint"))),
            h("div", { className: "dshmem_row" },
              h("button", {
                type: "button",
                className: "dshmem_btn",
                disabled: busy,
                onClick: tidyAll,
              }, t("tidy")),
              h("button", {
                type: "button",
                className: "dshmem_btn",
                disabled: busy || docDraft !== null,
                onClick: () => {
                  setDocImport(false);
                  setDocDraft(docText());
                },
              }, t("editDoc")),
              h("button", {
                type: "button",
                className: "dshmem_btn",
                disabled: busy,
                onClick: () => {
                  setDocDraft(null);
                  setDocImport((value) => !value);
                },
              }, t("importDo"))),
          /* 导入框紧贴按钮：文档区是可滚动的（46vh），放到文档后面会出现「点了没反应」的错觉。 */
          docImport
            ? h("div", { className: "dshmem" },
                h("textarea", {
                  className: "dshmem_area",
                  value: importText,
                  placeholder: t("importPh"),
                  onChange: (event) => setImportText(event.target.value),
                }),
                h("div", { className: "dshmem_row" },
                  h("button", {
                    type: "button",
                    className: "dshmem_btn dshmem_btn_primary",
                    disabled: busy || !importText.trim(),
                    onClick: doImport,
                  }, t("importDo")),
                  h("button", {
                    type: "button",
                    className: "dshmem_btn",
                    disabled: busy,
                    onClick: () => setDocImport(false),
                  }, t("cancel"))))
            : null,
          docDraft !== null
            ? h("div", { className: "dshmem" },
                h("div", { className: "dshmem_hint" }, t("docEditHint")),
                h("textarea", {
                  className: "dshmem_area dshmem_area_doc",
                  value: docDraft,
                  onChange: (event) => setDocDraft(event.target.value),
                }),
                h("div", { className: "dshmem_row" },
                  h("button", {
                    type: "button",
                    className: "dshmem_btn dshmem_btn_primary",
                    disabled: busy,
                    onClick: applyDoc,
                  }, t("save")),
                  h("button", {
                    type: "button",
                    className: "dshmem_btn",
                    disabled: busy,
                    onClick: () => setDocDraft(null),
                  }, t("cancel"))))
            : records.length
              ? h("div", { className: "dshmem_doc" }, docItems)
              : h("div", { className: "dshmem_empty" },
                  h("div", null, t("empty")),
                  h("div", { className: "dshmem_hint" }, t("emptyHint"))),
          h("div", { className: "dshmem_docFoot" },
            t("docFooter").replace("{path}", docPath || "—"))))
      );

      const memoriesTab = h("div", { className: "dshmem" },
        h("div", { className: "dshmem_stats" },
          h("span", { className: "dshmem_chip" }, `${t("total")} ${scopeTotal}${unitSuffix}`),
          h("span", {
            className: `dshmem_chip dshmem_chip_click${scope === "" ? " dshmem_chip_on" : ""}`,
            onClick: () => setScope(""),
          }, `${t("scopeAll")} ${stats.total + stats.global}`),
          h("span", {
            className: `dshmem_chip dshmem_chip_click${scope === "workspace" ? " dshmem_chip_on" : ""}`,
            onClick: () => setScope("workspace"),
          }, `${t("scopeProject")} ${stats.total}`),
          h("span", {
            className: `dshmem_chip dshmem_chip_click${scope === "global" ? " dshmem_chip_on" : ""}`,
            onClick: () => setScope("global"),
          }, `${t("scopeGlobalFull")} ${stats.global}`),
          stats.pinned
            ? h("span", { className: "dshmem_chip dshmem_chip_on" }, `${t("pinnedCount")} ${stats.pinned}`)
            : null,
          Object.entries(stats.byCategory || {})
            .sort((a, b) => b[1] - a[1])
            .map(([id, count]) =>
              h("span", {
                key: id,
                className: `dshmem_chip dshmem_chip_click${category === id ? " dshmem_chip_on" : ""}`,
                onClick: () => setCategory(category === id ? "" : id),
              }, `${catLabel(id)} ${count}`))
        ),

        h("div", { className: "dshmem_bar" },
          h("input", {
            className: "dshmem_input dshmem_grow",
            value: query,
            placeholder: t("search"),
            onChange: (event) => setQuery(event.target.value),
          }),
          h("div", { className: "dshmem_seg" },
            h("button", {
              type: "button",
              className: `dshmem_seg_btn${view === "doc" ? " dshmem_seg_on" : ""}`,
              onClick: () => setView("doc"),
            }, t("viewDoc")),
            h("button", {
              type: "button",
              className: `dshmem_seg_btn${view === "space" ? " dshmem_seg_on" : ""}`,
              onClick: () => setView("space"),
            }, t("viewSpace")),
            h("button", {
              type: "button",
              className: `dshmem_seg_btn${view === "list" ? " dshmem_seg_on" : ""}`,
              onClick: () => setView("list"),
            }, t("viewList"))
          ),
          view === "space"
            ? h("select", {
                className: "dshmem_select",
                style: { width: "auto" },
                value: groupBy,
                onChange: (event) => setGroupBy(event.target.value),
              },
                h("option", { value: "tag" }, t("groupByTag")),
                h("option", { value: "category" }, t("groupByCategory")),
                h("option", { value: "none" }, t("groupByNone"))
              )
            : null,
          h("select", {
            className: "dshmem_select",
            style: { width: "auto" },
            value: sort,
            onChange: (event) => setSort(event.target.value),
          },
            h("option", { value: "updated" }, t("sortUpdated")),
            h("option", { value: "created" }, t("sortCreated")),
            h("option", { value: "title" }, t("sortTitle"))
          ),
          h("label", { className: "dshmem_switch", style: { alignItems: "center" } },
            h("input", {
              type: "checkbox",
              checked: archived,
              onChange: (event) => setArchived(event.target.checked),
            }),
            h("span", null, t("showArchived"))
          ),
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_primary",
            onClick: () => setDraft({}),
          }, t("newMemory"))
        ),

        workspaces.length > 1
          ? h("div", { className: "dshmem_bar" },
              h("span", { className: "dshmem_lbl" }, t("workspace")),
              h("select", {
                className: "dshmem_select",
                value: workspace,
                onChange: (event) => {
                  setWorkspace(event.target.value);
                  setManualRoot("");
                  setDraft(null);
                },
              }, workspaces.map((item) =>
                h("option", { key: item.key, value: item.root },
                  `${baseName(item.root) || item.root}${item.active ? " ★" : ""}${
                    lang === "zh" ? `（${item.count} 条）` : ` (${item.count})`
                  }`))),
              h("span", { className: "dshmem_hint" }, state?.workspace?.root || target)
            )
          : h("div", { className: "dshmem_bar" },
              h("span", { className: "dshmem_hint dshmem_path" }, state?.workspace?.root || target || "—")
            ),

        tagList.length && view === "list"
          ? h("div", { className: "dshmem_stats" },
              tagList.slice(0, 14).map((item) =>
                h("span", {
                  key: item.tag,
                  className: "dshmem_chip dshmem_chip_click",
                  onClick: () => setQuery(item.tag),
                }, `#${item.tag} ${item.count}`)))
          : null,

        draft && mergeIds ? h("div", { className: "dshmem_hint" }, t("consolidateHint")) : null,

        draft ? h(Editor, {
          key: draft.id || "new",
          t,
          lang,
          categories,
          draft,
          busy,
          onCancel: closeEditor,
          onSubmit: submitDraft,
        }) : null,

        error ? h("div", { className: "dshmem_err" }, error) : null,
        notice ? h("div", { className: "dshmem_ok" }, notice) : null,

        loading && records.length === 0
          ? h(Spin)
          : view === "doc"
            ? docTab
            : records.length === 0
              ? h("div", { className: "dshmem_empty" },
                  h("div", null, t("empty")),
                  h("div", { className: "dshmem_hint" }, t("emptyHint")))
              : view === "space"
                ? spaceTab
                : h("div", { className: "dshmem_list" },
                    records.map((record) => cardNode(record, false)))
      );

      /* ---------------- 自动提炼页 ---------------- */

      const updateSetting = (key, value) => {
        setSettings((current) => ({ ...(current || {}), [key]: value }));
        setSettingsDirty(true);
      };

      const captureTab = h("div", { className: "dshmem" },
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn dshmem_btn_primary",
              disabled: capturing,
              onClick: () => {
                setCapturing(true);
                setError("");
                api
                  .capture(target)
                  .then((payload) => {
                    const done = payload?.capture;
                    flash(
                      done?.ok
                        ? `${t("candidates")}: ${done.saved ?? 0}`
                        : `→ ${done?.reason || "no-op"}`,
                    );
                    if (alive.current) setCaptures(Array.isArray(payload?.captures) ? payload.captures : captures);
                    return api.state(target).then((next) => {
                      if (!alive.current) return;
                      setState(next);
                      setCaptures(Array.isArray(next.captures) ? next.captures : []);
                    });
                  })
                  .then(() => reload())
                  .catch((cause) => setError(String(cause?.message || cause)))
                  .finally(() => {
                    if (alive.current) setCapturing(false);
                  });
              },
            }, capturing ? t("capturing") : t("captureNow")),
            h("span", { className: "dshmem_hint" }, `${t("workspace")}: ${target || "—"}`)
          ),
          h("div", { className: "dshmem_hint" }, t("sAutoHint")),
          h("div", { className: "dshmem_meta" },
            h("span", null, `${t("sAuto")}: ${(state?.settings?.autoCapture ?? settings?.autoCapture) ? "on" : "off"}`),
            h("span", null, `${t("sLimit")}: ${settings?.briefingLimit ?? "—"}`)
          )
        ),

        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("distillTitle")),
          h("textarea", {
            className: "dshmem_area",
            value: distillText,
            placeholder: t("distillPh"),
            onChange: (event) => setDistillText(event.target.value),
          }),
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn",
              disabled: distilling || !distillText.trim(),
              onClick: () => {
                setDistilling(true);
                setError("");
                api
                  .distill(target, distillText)
                  .then((payload) => {
                    if (!alive.current) return;
                    setCandidates(Array.isArray(payload.candidates) ? payload.candidates : []);
                  })
                  .catch((cause) => setError(String(cause?.message || cause)))
                  .finally(() => {
                    if (alive.current) setDistilling(false);
                  });
              },
            }, distilling ? t("distilling") : t("distill")),
            candidates && candidates.length
              ? h("button", {
                  type: "button",
                  className: "dshmem_btn dshmem_btn_primary",
                  disabled: busy,
                  onClick: () => {
                    setBusy(true);
                    Promise.all(
                      candidates.map((item) =>
                        api.save({
                          workspace: target,
                          title: item.title,
                          content: item.content,
                          category: item.category,
                          tags: item.tags,
                          scope: "workspace",
                          source: "auto",
                          confidence: item.confidence,
                          dedupe: true,
                        }),
                      ),
                    )
                      .then(() => {
                        setCandidates(null);
                        setDistillText("");
                        return afterWrite(t("adopted"));
                      })
                      .catch((cause) => setError(String(cause?.message || cause)))
                      .finally(() => {
                        if (alive.current) setBusy(false);
                      });
                  },
                }, t("adopt"))
              : null
          ),
          candidates
            ? candidates.length === 0
              ? h("div", { className: "dshmem_hint" }, t("noCandidates"))
              : h("div", { className: "dshmem_list" },
                  candidates.map((item, index) =>
                    h("div", { className: "dshmem_card", key: `${index}-${item.title}` },
                      h("div", { className: "dshmem_main" },
                        h("div", { className: "dshmem_title" }, item.title),
                        h("div", { className: "dshmem_body" }, item.content),
                        h("div", { className: "dshmem_meta" },
                          h("span", { className: "dshmem_chip" }, catLabel(item.category)),
                          typeof item.confidence === "number"
                            ? h("span", null, `${item.confidence.toFixed(2)}`)
                            : null,
                          (item.tags || []).map((tag) => h("span", { key: tag, className: "dshmem_tag" }, `#${tag}`))
                        )
                      )
                    )))
            : null
        ),

        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("captureLog")),
          captures.length === 0
            ? h("div", { className: "dshmem_hint" }, t("captureEmpty"))
            : h("div", { className: "dshmem_list" },
                captures.map((item, index) =>
                  h("div", { className: "dshmem_meta", key: `${item.at}-${index}` },
                    h("span", { className: "dshmem_chip" }, item.reason || "?"),
                    h("span", null, `${item.saved ?? 0} / ${item.candidates ?? 0}`),
                    h("span", null, when(item.at)),
                    item.titles && item.titles.length
                      ? h("span", { className: "dshmem_hint" }, item.titles.join(" · "))
                      : null,
                    item.error ? h("span", { className: "dshmem_err" }, item.error) : null
                  )))
        )
      );

      /* ---------------- 设置页 ---------------- */

      const num = (key, label, min, max, step) =>
        h("div", { className: "dshmem_row" },
          h("span", { className: "dshmem_lbl" }, label),
          h("input", {
            className: "dshmem_input",
            style: { width: 140 },
            type: "number",
            min,
            max,
            step: step || 1,
            value: settings?.[key] ?? "",
            onChange: (event) => updateSetting(key, Number(event.target.value)),
          })
        );

      const toggle = (key, label, hint) =>
        h("label", { className: "dshmem_switch" },
          h("input", {
            type: "checkbox",
            checked: Boolean(settings?.[key]),
            onChange: (event) => updateSetting(key, event.target.checked),
          }),
          h("span", null,
            h("div", null, label),
            hint ? h("div", { className: "dshmem_hint" }, hint) : null)
        );

      const settingsTab = h("div", { className: "dshmem" },
        h("div", { className: "dshmem_box" },
          toggle("enabled", t("sEnabled")),
          toggle("briefing", t("sBriefing"), t("sBriefingHint")),
          h("div", { className: "dshmem_row" },
            num("briefingLimit", t("sLimit"), 1, 50),
            num("briefingMaxChars", t("sChars"), 200, 20000, 100)
          ),
          toggle("mirror", t("sMirror"), t("sMirrorHint")),
          toggle("dedupe", t("sDedupe"))
        ),
        h("div", { className: "dshmem_box" },
          toggle("autoCapture", t("sAuto"), t("sAutoHint")),
          h("div", { className: "dshmem_row" },
            num("autoCaptureMinChars", t("sAutoMin"), 0, 200000, 100),
            num("captureCooldownMs", t("sCooldown"), 0, 3600000, 1000)
          ),
          h("div", { className: "dshmem_row" },
            num("minConfidence", t("sMinConf"), 0, 1, 0.05),
            num("maxPerTurn", t("sMaxTurn"), 1, 20)
          ),
          h("div", { className: "dshmem_row" },
            num("maxTranscriptChars", t("sTranscript"), 500, 60000, 500)
          )
        ),
        h("div", { className: "dshmem_row" },
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_primary",
            disabled: busy || !settingsDirty,
            onClick: () => {
              setBusy(true);
              setError("");
              api
                .settings(settings)
                .then((payload) => {
                  if (!alive.current) return;
                  setSettings(payload.settings);
                  setSettingsDirty(false);
                  flash(t("saved"));
                  return api.state(target).then((next) => {
                    if (alive.current) setState(next);
                  });
                })
                .catch((cause) => setError(String(cause?.message || cause)))
                .finally(() => {
                  if (alive.current) setBusy(false);
                });
            },
          }, t("save")),
          h("button", {
            type: "button",
            className: "dshmem_btn",
            onClick: () => {
              setSettings(state?.settings || settings);
              setSettingsDirty(false);
            },
          }, t("cancel"))
        ),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("mirrorTitle")),
          h("div", { className: "dshmem_meta" },
            h("span", { className: "dshmem_path" }, state?.mirror?.workspaceFile || t("mirrorGlobal")),
            state?.mirror?.workspaceFile
              ? h("span", {
                  className: `dshmem_chip${state?.mirror?.workspaceExists ? " dshmem_chip_on" : ""}`,
                }, state?.mirror?.workspaceExists ? t("mirrorPresent") : t("mirrorAbsent"))
              : null
          ),
          h("div", { className: "dshmem_meta" },
            h("span", { className: "dshmem_hint" }, t("mirrorStorage")),
            h("span", { className: "dshmem_path" }, state?.mirror?.storageFile || state?.workspace?.dataFile || "—")
          ),
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn dshmem_btn_sm",
              onClick: () => {
                setBusy(true);
                api
                  .mirror(target)
                  .then((payload) => {
                    if (!alive.current) return;
                    setState((current) => ({ ...(current || {}), mirror: payload.mirror }));
                  })
                  .catch((cause) => setError(String(cause?.message || cause)))
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              },
            }, t("refresh")),
            state?.mirror?.markdown
              ? h("button", {
                  type: "button",
                  className: "dshmem_btn dshmem_btn_sm",
                  onClick: () => {
                    try {
                      navigator.clipboard.writeText(state.mirror.markdown);
                      flash(t("copied"));
                    } catch {
                      /* 剪贴板不可用就忽略 */
                    }
                  },
                }, t("copy"))
              : null
          ),
          state?.mirror?.markdown
            ? h("div", { className: "dshmem_mirror" }, state.mirror.markdown)
            : h("div", { className: "dshmem_hint" },
                state?.mirror?.workspaceExists || state?.mirror?.storageExists
                  ? t("mirrorLoading")
                  : t("mirrorEmpty"))
        ),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("scanTitle")),
          h("div", { className: "dshmem_hint" }, t("scanHint")),
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn dshmem_btn_primary",
              disabled: scanning,
              onClick: () => {
                setScanning(true);
                api
                  .importScan(target)
                  .then((payload) => setScan(payload.scan))
                  .catch((cause) => setError(String(cause?.message || cause)))
                  .finally(() => {
                    if (alive.current) setScanning(false);
                  });
              },
            }, scanning ? t("scanning") : t("scanDo")),
            scan
              ? h("button", {
                  type: "button",
                  className: "dshmem_btn",
                  disabled: Boolean(scanBusy),
                  onClick: () => {
                    const ids = scan.sources.filter((source) => source.exists && source.files.length).map((source) => source.id);
                    if (!ids.length) return flash(t("scanNothing"));
                    setScanBusy("__all__");
                    api
                      .importFromScan({ workspace: target, mode: "merge", sources: ids })
                      .then((payload) => {
                        const n = payload.imported?.added ?? 0;
                        flash(t("scanImported").replace("{n}", String(n)));
                        return api.importScan(target).then((next) => setScan(next.scan));
                      })
                      .then(() => afterWrite())
                      .catch((cause) => setError(String(cause?.message || cause)))
                      .finally(() => {
                        if (alive.current) setScanBusy("");
                      });
                  },
                }, t("scanAll"))
              : null
          ),
          scan
            ? h("div", { className: "dshmem_sources" },
                scan.sources.map((source) =>
                  h("div", { className: "dshmem_source", key: source.id },
                    h("div", { className: "dshmem_source_head" },
                      h("span", { className: "dshmem_source_name" }, source.label),
                      h("span", {
                        className: `dshmem_chip${source.exists ? " dshmem_chip_on" : ""}`,
                      }, source.exists ? t("scanFiles").replace("{n}", String(source.files.length)) : t("scanAbsent")),
                      h("span", { className: "dshmem_meta" }, source.scope === "global" ? t("scanGlobal") : t("scanWorkspace"))
                    ),
                    source.exists
                      ? h("div", { className: "dshmem_source_path" }, source.dir)
                      : null,
                    source.exists && source.files.length
                      ? source.files.map((file) =>
                          h("div", { className: "dshmem_meta", key: file.path },
                            `${file.name} · ${file.format} · ${file.records}`)
                        )
                      : null,
                    source.exists && source.files.length
                      ? h("div", { className: "dshmem_row" },
                          h("button", {
                            type: "button",
                            className: "dshmem_btn",
                            disabled: Boolean(scanBusy),
                            onClick: () => {
                              setScanBusy(source.id);
                              api
                                .importFromScan({ workspace: target, mode: "merge", sources: [source.id] })
                                .then((payload) => {
                                  const n = payload.imported?.added ?? 0;
                                  flash(t("scanImported").replace("{n}", String(n)));
                                  return api.importScan(target).then((next) => setScan(next.scan));
                                })
                                .then(() => afterWrite())
                                .catch((cause) => setError(String(cause?.message || cause)))
                                .finally(() => {
                                  if (alive.current) setScanBusy("");
                                });
                            },
                          }, scanBusy === source.id ? t("scanning") : t("scanOne"))
                        )
                      : null
                  )
                )
              )
            : null
        ),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("exportTitle")),
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn",
              onClick: () => {
                api
                  .exportAll(target)
                  .then((payload) => {
                    const text = JSON.stringify(payload.export, null, 2);
                    setImportText(text);
                    try {
                      navigator.clipboard.writeText(text);
                      flash(t("copied"));
                    } catch {
                      /* 忽略 */
                    }
                  })
                  .catch((cause) => setError(String(cause?.message || cause)));
              },
            }, t("exportDo")),
            h("button", {
              type: "button",
              className: "dshmem_btn",
              disabled: busy || !importText.trim(),
              onClick: doImport,
            }, t("importDo"))
          ),
          h("div", { className: "dshmem_row" },
            h("span", { className: "dshmem_meta" }, t("formatLabel")),
            h("select", {
              className: "dshmem_select",
              value: importFormat,
              onChange: (event) => setImportFormat(event.target.value),
            }, IMPORT_FORMAT_OPTIONS.map((value) =>
              h("option", { value, key: value }, t(`format_${value}`))
            ))
          ),
          h("textarea", {
            className: "dshmem_area",
            value: importText,
            placeholder: t("importPh"),
            onChange: (event) => setImportText(event.target.value),
          }),
          h("div", { className: "dshmem_meta" },
            h("span", null, `dsh-memory ${state?.version || ""}`),
            h("span", null, state?.api || "/memory/api")
          )
        )
      );

      const tabs = [
        ["memories", t("tabMemories")],
        ["capture", t("tabCapture")],
        ["settings", t("tabSettings")],
      ];

      return h("div", { className: "dshmem", style: { gap: 12 } },
        h("div", { className: "dshmem_tabs" },
          tabs.map(([id, label]) =>
            h("button", {
              key: id,
              type: "button",
              className: `dshmem_tab${tab === id ? " dshmem_tab_on" : ""}`,
              onClick: () => setTab(id),
            }, label))
        ),
        !state && error
          ? h("div", { className: "dshmem_err" }, error)
          : tab === "memories"
            ? memoriesTab
            : tab === "capture"
              ? captureTab
              : settingsTab
      );
    }

    /* ---------------------------------------------------------------- *
     * 插件入口
     * ---------------------------------------------------------------- */

    const name = "dsh-memory";
    const inject = ["slots", "locale"];

    /** 极小的快照 store，只为把 locale 变化推进页面（官方 inject-hook 惯例）。 */
    function makeStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        set(next) {
          value = next;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    const NAV_MARKER = "data-dshmem-nav";

    /**
     * DSH 0.2.0 的设置导航只投影注册项的 id / order / label（`dsh-client-ui-settings-general`
     * 的 nav 渲染），图标由外壳内部一张封闭的 id 表决定，未知 id 一律回落到齿轮——注册项
     * 没有 icon 字段可用。在公开契约长出该字段之前，只认出「文本等于本插件当前本地化标题」
     * 的那一行并打上标记，交给上面的样式换成记忆卡片字形（`dsh-better-sidebar` 的
     * settings-nav-icon 是同源做法）。标记不拥有任何外壳结构，卸载时全部撤掉。
     *
     * MutationObserver 观察 body 子树：会话流式输出会持续触发变更，所以用 rAF 合并成帧。
     */
    function syncNavMarker(label) {
      if (typeof document === "undefined") return () => {};
      let disposed = false;
      let frame = 0;
      const sync = () => {
        frame = 0;
        if (disposed) return;
        const want = String(label() ?? "").trim();
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          if (want.length > 0 && (button.textContent ?? "").trim() === want) {
            button.setAttribute(NAV_MARKER, "");
          } else {
            button.removeAttribute(NAV_MARKER);
          }
        }
      };
      const schedule = () => {
        if (disposed || frame) return;
        frame = typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(sync)
          : setTimeout(sync, 16);
      };
      sync();
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      return () => {
        disposed = true;
        if (frame) {
          if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
          else clearTimeout(frame);
          frame = 0;
        }
        observer.disconnect();
        for (const node of document.querySelectorAll("[" + NAV_MARKER + "]")) {
          node.removeAttribute(NAV_MARKER);
        }
      };
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-memory: 设置页词典");
      ctx.effect(() => syncNavMarker(() => t("nav")), "dsh-memory: 设置导航图标");

      // 语言切换时让页面重渲染（label 是 thunk，但组件自身不会自动跟随）。
      const localeStore = makeStore({ revision: ctx.locale.getSnapshot?.()?.revision ?? 0 });
      ctx.effect(
        () =>
          ctx.locale.subscribe(() => {
            localeStore.set({ revision: ctx.locale.getSnapshot?.()?.revision ?? 0 });
          }),
        "dsh-memory: locale 订阅",
      );

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "memory",
            order: 25,
            label: () => t("nav"),
            locale: NS,
            inject: () => ({ hooks: { memoryLocale: localeStore } }),
          },
          MemorySection,
        ),
      );
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
