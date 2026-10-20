/**
 * dsh-memory —— 客户端半（DSH 设置面板的「记忆」页）。
 *
 * 无构建步骤：模块宿主按包名提供本文件，这里只 require("react")。
 * 页面通过同源 POST /memory/api/* 与宿主半通信（宿主半用 webServer 前缀路由注册）。
 *
 * ⚠️ 这里的 id 必须与 package.json 的 name 逐字一致：模块系统按 manifest 包名认领
 * 浏览器模块，注册成别的 id 只会报 `bundle … loaded without registering "<包名>"
 * via __ModuleLoader__.load`，宿主半天照跑、界面整块消失。0.3.2 把包名改成
 * @bangbang-03/dsh-memory 时漏改这里，0.3.4 修回；test/client.test.mjs 已加断言防回归。
 */
window.__ModuleLoader__.load({
  id: "@bangbang-03/dsh-memory",
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
:root{--dshmem-nav-glyph:${NAV_GLYPH};--dshmem-dim:color-mix(in srgb,currentColor 68%,transparent)}
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
.dshmem_source_path{font-size:12px;color:var(--dshmem-dim);
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
.dshmem_reason{font-size:12px;color:var(--dshmem-dim);margin-top:-2px;border-left:2px solid color-mix(in srgb,currentColor 25%,transparent);padding-left:8px}
.dshmem_body{white-space:pre-wrap;word-break:break-word;line-height:1.55;
  color:var(--dsw-alias-label-secondary,#5b6169);
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.dshmem_meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;
  color:var(--dshmem-dim)}
.dshmem_tag{color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_acts{display:flex;flex-direction:column;gap:6px;flex:none;align-items:flex-end}
/* 分区与分组：范围分区 → 标签分组 → 卡片 */
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
.dshmem_chev{flex:none;width:12px;font-size:10px;color:var(--dshmem-dim)}
.dshmem_sectionTitle{font-weight:600}
.dshmem_count{font-size:11.5px;color:var(--dshmem-dim)}
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
.dshmem_empty{padding:28px 12px;text-align:center;color:var(--dshmem-dim)}
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
.dshmem_hint{font-size:11.5px;color:var(--dshmem-dim);line-height:1.5}
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
.dshmem_swHint{font-size:11.5px;line-height:1.5;color:var(--dshmem-dim)}
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
  color:var(--dshmem-dim)}
.dshmem_docFlat{display:flex;flex-direction:column;gap:10px}
.dshmem_docItem{padding:8px 10px;border-radius:8px}
.dshmem_docItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dshmem_docHeadRow{display:flex;align-items:baseline;gap:8px}
.dshmem_docTitle{font-weight:600;line-height:1.5;word-break:break-word;
  color:var(--dsw-alias-label-primary,#0f1115)}
.dshmem_docFree{flex:none;font-size:11.5px;cursor:pointer;visibility:hidden;
  color:var(--dsw-static-deepseek-450,#4d6bfe)}
.dshmem_docItem:hover .dshmem_docFree{visibility:visible}
.dshmem_tlItem:hover .dshmem_docFree{visibility:visible}
.dshmem_docPara{margin-top:3px;white-space:pre-wrap;word-break:break-word;line-height:1.6;
  color:var(--dsw-alias-label-secondary,#5b6169)}
.dshmem_docFoot{font-size:11.5px;line-height:1.5;color:var(--dshmem-dim)}
/* 「想加记忆就在对话里说」那行：淡蓝底 + 左侧色条，别抢正文的注意力。 */
.dshmem_docAdd{margin-top:8px;padding:5px 9px;border-radius:8px;font-size:12px;line-height:1.5;
  border-left:2px solid var(--dsw-static-deepseek-450,#4d6bfe);
  color:var(--dsw-alias-label-secondary,#5b6169);
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  background:color-mix(in srgb,var(--dsw-static-deepseek-450,#4d6bfe) 8%,transparent)}
.dshmem_area_doc{min-height:220px}
/* 时间线：按日分组的全部记忆（含归档）。 */
.dshmem_tl{display:flex;flex-direction:column;gap:12px;max-height:52vh;overflow:auto;padding-right:2px}
.dshmem_tlDay{display:flex;align-items:center;gap:8px;font-size:11.5px;
  color:var(--dshmem-dim);position:sticky;top:0;
  background:var(--dsw-alias-bg-primary,inherit);padding:4px 0}
.dshmem_tlDay::after{content:"";flex:1;height:1px;
  background:var(--dsw-alias-border-l1,rgba(0,0,0,.07))}
.dshmem_tlItem{display:flex;flex-direction:column;gap:3px;padding:7px 10px;border-radius:8px;cursor:pointer}
.dshmem_tlItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dshmem_tlItem_archived{opacity:.55}
.dshmem_tlHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dshmem_tlTitle{font-weight:600;word-break:break-word}
.dshmem_tlBody{font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;
  color:var(--dsw-alias-label-secondary,#5b6169);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 健康：统计卡 + 问题清单。 */
.dshmem_health{display:flex;flex-direction:column;gap:12px;max-height:52vh;overflow:auto;padding-right:2px}
.dshmem_kpis{display:flex;flex-wrap:wrap;gap:8px}
.dshmem_kpi{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:10px;min-width:110px;
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));
  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.015))}
.dshmem_kpiNum{font-size:18px;font-weight:600;line-height:1.2}
.dshmem_kpiLbl{font-size:11.5px;color:var(--dshmem-dim)}
.dshmem_issue{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.12))}
.dshmem_issueHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshmem_issueBody{font-size:12px;color:var(--dsw-alias-label-secondary,#5b6169);word-break:break-all}
.dshmem_chain{color:var(--dsw-static-deepseek-450,#4d6bfe);font-size:11.5px}
/* 审批队列的草稿卡：左缘蓝条提示「还没生效」。 */
.dshmem_draftCard{border-left:3px solid var(--dsw-static-deepseek-450,#4d6bfe)}
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
      health: (workspace, signal) => request("GET", "/health", { query: { workspace }, signal }),
      healthResolve: (body) => request("POST", "/health/resolve", { body }),
      injections: (workspace, signal, limit = 12) =>
        request("GET", "/injections", { query: { workspace, limit }, signal }),
      dream: (body) => request("POST", "/dream", { body }),
      promote: (body) => request("POST", "/promote", { body }),
      derivations: (workspace, signal) => request("GET", "/derivations", { query: { workspace }, signal }),
      reviews: (workspace, signal, withinDays = 30) =>
        request("GET", "/reviews", { query: { workspace, withinDays }, signal }),
      review: (body) => request("POST", "/review", { body }),
      timeline: (workspace, signal) => request("GET", "/timeline", { query: { workspace }, signal }),
      queue: (workspace, signal) => request("GET", "/queue", { query: { workspace }, signal }),
      approve: (body) => request("POST", "/queue/approve", { body }),
      reject: (body) => request("POST", "/queue/reject", { body }),
      rollback: (body) => request("POST", "/supersede/rollback", { body }),
      briefPreview: (workspace, signal) => request("GET", "/briefing-preview", { query: { workspace }, signal }),
      portrait: (workspace, signal) => request("GET", "/portrait", { query: { workspace }, signal }),
      portraitDiff: (workspace, signal, from = "previous") =>
        request("GET", "/portrait/diff", { query: { workspace, from }, signal }),
      savePortrait: (body) => request("POST", "/portrait/save", { body }),
      rewritePortrait: (body) => request("POST", "/portrait/rewrite", { body }),
      portraitDraft: (workspace, signal) => request("GET", "/portrait/draft", { query: { workspace }, signal }),
      approveDraft: (body) => request("POST", "/portrait/draft/approve", { body }),
      discardDraft: (body) => request("POST", "/portrait/draft/discard", { body }),
      journal: (workspace, query, signal) =>
        request("GET", "/journal", { query: { workspace, ...(query || {}) }, signal }),
      mergeTags: (body) => request("POST", "/tags/merge", { body }),
    };

    /* ---------------------------------------------------------------- *
     * i18n
     * ---------------------------------------------------------------- */

    const NS = "settings.memory";

    const zh = {
      nav: "记忆",
      tabMemories: "记忆库",
      tabMaintain: "维护",
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
      viewList: "列表",
      groupByTag: "按标签分组",
      groupByCategory: "按类型分组",
      groupByNone: "整篇文档",
      groupByTimeline: "时间线（含归档）",
      ungrouped: "未归类",
      consolidate: "整合",
      consolidateHint: "把本组的记忆合并成一条，原条目归档",
      consolidated: "已整合为一条新记忆，原条目已归档（勾选「含已归档」可查看）",
      manageMemory: "管理记忆",
      manageHint: "按标签自动整理，也可整篇查看和编辑。",
      docAddHint: "想加记忆不用在这里填表：直接在对话里说「记住 ……」，这段正文会自己更新。",
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
      chipTainted: "可疑",
      chipTaintedHint: "命中注入模式；非用户来源的记录已被隔离成草稿，等你在待审队列处理。",
      chipRedacted: "已脱敏",
      chipRedactedHint: "写入时命中密钥模式，对应内容已替换为 [REDACTED:*]。",
      chipExternal: "外部来源",
      chipExternalHint: "来自网页/工具输出等外部内容，参考时请先验证。",
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
      sPortraitChars: "画像预算（字数）",
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
      sQualityGate: "低分记忆自动归档",
      sQualityGateHint: "自动提炼 / 模型主动写入的条目，质量分低于 30 直接归档、不进简报；手工与导入的记忆不受影响。",
      sCaptureSub: "子代理会话也参与自动提炼",
      sCaptureSubHint: "默认关闭：派活的中间过程不写成长期记忆。",
      reasonLabel: "理由",
      qualityChip: "质量",
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
      scanImported: "已导入 {n}",
      tlHint: "全部记忆按更新时间排列，含已归档；点条目可直接编辑。",
      tlSearch: "在时间线里过滤…",
      recentTitle: "刚刚记了什么",
      recentHint: "过去 24 小时新增或更新 {n} 条；确认它们值得长期保留，不顺眼的就地归档。",
      recentSummary: "24h 内 +{n} 条",
      recentOpen: "展开",
      recentClose: "收起",
      briefPreviewTitle: "下次会话将注入",
      briefPreviewHint: "{mode} ｜ 注入 {n} / {available} 条{portrait} ｜ ≈{tokens} token / 次请求",
      briefPreviewOff: "简报注入已关闭（设置里可开启）",
      briefPortraitPart: " ｜ 画像 {chars} 字",
      briefSummary: "注入 {n} 条 · ≈{tokens} token",
      briefTailTitle: "尾部注入（不进系统提示）",
      briefTailChip: "尾部 +{n}",
      briefTailHint: "轮末召回 {n} 条 · {chars} 字，跟在用户消息后面进入本轮，不占系统提示前缀",
      briefTailEmpty: "本轮没有尾部召回",
      briefFrozenYes: "已冻结",
      briefFrozenNo: "未冻结",
      portraitTitle: "画像",
      portraitOpen: "展开画像",
      portraitClose: "收起画像",
      portraitDiff: "这次变了什么",
      portraitDiffClose: "收起变化",
      portraitPromote: "写进 AGENTS.md",
      portraitPromoted: "已写入 AGENTS.md（{n} 行；画像改写后这里会被标脏）",
      portraitDiffTitle: "画像变化（上一版 → 当前版）",
      portraitDiffLoading: "正在对比版本…",
      portraitDiffNoPrevious: "只有一版画像，还没有可对比的上一版。",
      portraitDiffEmpty: "这一版没有变化。",
      portraitDiffFrom: "v{from} → v{to}",
      portraitSubtitle: "工作区与全局的「档案摘要」——「现在是什么样」写在这里，「不会过期的知识」才进条目。",
      portraitCharsUnit: "{n} 字",
      portraitWorkspaceLabel: "工作区画像",
      portraitGlobalLabel: "全局画像",
      portraitStored: "portrait.json 维护",
      portraitFromMd: "来自 PORTRAIT.md（首次保存后落盘）",
      portraitEditHint: "按 `**段标题**` 分段：工作背景 / 协作约定（全局版为「个人背景」）/ 当前关注 / 近期动态。",
      portraitSaved: "画像已保存（v{v}）",
      portraitEmptySections: "至少要保留一个带标题的段落",
      portraitEmpty: "还没有画像。点「重写画像」从日志与条目生成一份，也可以在这里手写。",
      portraitRewrite: "重写画像",
      portraitRewritingShort: "重写中…",
      portraitRewriting: "正在重写画像（合并日志与条目，请稍候）…",
      portraitRewritten: "画像已重写并保存",
      portraitDrafted: "重写稿已存入待审",
      portraitDraftHint: "有一份重写稿待批准（批准后生效、旧版留档）",
      portraitDraftView: "预览",
      portraitDraftHide: "收起预览",
      portraitDraftApprove: "批准",
      portraitDraftDiscard: "丢弃",
      portraitDraftApproved: "重写稿已批准，画像已更新",
      portraitDraftDiscarded: "重写稿已丢弃",
      journalTitle: "工作日志",
      journalHint: "完成实质工作后自动追记的流水账",
      journalSummary: "{n} 天",
      journalEmpty: "还没有日志。完成实质工作后，对话里会自动追记一条。",
      briefChip: "简报",
      briefExcluded: "未进简报",
      tagMergeTitle: "标签清理",
      tagMergeHint: "写法不同、意思相同的标签（如 DSH / dsh）合并成一个；大小写不影响检索。",
      tagMergeVariants: "候选：{variants}",
      tagMergeDo: "合并为 {tag}",
      tagMerged: "已合并标签：{n} 条记忆更新",
      healthHint: "重复、过期与断链的体检结果；合并可撤销（原条目归档），归档可恢复。",
      dreamTitle: "Dream · 一键整理",
      dreamHint: "合并重复簇（原条目归档可恢复）、报告过期未用、把画像重写送进待审。只在你点按钮时运行，没有后台任务。",
      dreamRun: "整理一次",
      dreamRunning: "整理中…",
      dreamDone: "Dream 完成",
      dreamSummary: "合并 {merged} 簇 ｜ 过期未用 {stale} 条 ｜ 曝光未用 {unused} 条（均仅报告） ｜ 画像：{portrait}",
      dreamPortraitDrafted: "已进待审",
      dreamPortraitSaved: "已保存",
      dreamPortraitNone: "未触发",
      dreamMergedLine: "合并 {count} 条 → {title}",
      dreamErrors: "{n} 步出错",
      promoteBtn: "晋升到 AGENTS.md",
      promoteHint: "把这条写进工作区 AGENTS.md 的托管块（重复晋升不会产生重复行；块外内容可自由编辑）。",
      promoted: "已晋升进 {file}",
      pathTailHint: "最近一次路径注入 {n} 条 · ≈{tokens} token",
      healthKpiTotal: "记忆总数",
      healthKpiUtil: "被用过",
      healthKpiDrafts: "待审草稿",
      healthToken: "简报注入",
      healthTokenIndex: "索引模式（一行一条）",
      healthTokenFull: "全文模式（标题+摘录）",
      healthTokenLast: "最近一次注入",
      healthTokenEst: "≈ {tokens} token / 次请求（按字符粗估）",
      healthTokenNone: "还没有渲染过简报（会话开始后出现）",
      healthProblems: "体检结果",
      healthDuplicates: "重复记忆",
      healthDuplicatesHint: "内容高度相似，合并成一条；原条目会归档，可恢复。",
      healthStale: "过期未用",
      healthStaleHint: "超过 {days} 天从未被打开或引用且未置顶；确认没用就归档。",
      healthExposedUnused: "曝光未用",
      healthExposedUnusedHint: "被注入或检索到至少 3 次，但从未被显式打开、也未被答案引用；建议复核内容或归档。",
      injectionTitle: "注入审计",
      injectionHint: "每次真正进 prompt 的内容：字节数、hash、带了哪些记忆、谁被预算挤掉。",
      injectionNone: "还没有注入记录。",
      injectionKindBriefing: "简报",
      injectionKindTurnRecall: "尾部召回",
      injectionKindPathRecall: "路径召回",
      injectionDropped: "挤掉 {n} 条",
      derivationTitle: "派生链",
      derivationHint: "记忆 → 画像 → AGENTS.md：每一层记下它是从哪儿抄来的，源失效时这层会被标脏。",
      derivationNone: "还没有派生记录（保存画像或晋升到 AGENTS.md 后出现）。",
      derivationLayerPortrait: "画像",
      derivationLayerAgents: "AGENTS.md",
      derivationFresh: "仍成立",
      derivationDirty: "已失效",
      derivationSources: "源",
      reviewTitle: "复审队列",
      reviewHint: "带失效条件的记忆到期后进这里：回来看一眼「它还成立吗」。",
      reviewNone: "没有到期或即将到期的复审项。",
      reviewDue: "已到期",
      reviewSoon: "即将到期",
      reviewFalsifier: "失效条件",
      reviewDone: "已复审",
      chipFalsifier: "有失效条件",
      chipReviewDue: "待复审",
      portraitEvidence: "参考",
      portraitUntraced: "未溯源",
      healthBroken: "断链",
      healthBrokenHint: "指向不存在记忆的关联，摘掉即可。",
      healthNone: "没有发现问题",
      healthMerge: "合并",
      healthArchive: "归档",
      healthArchiveAll: "全部归档",
      healthUnlink: "摘除断链",
      healthGoQueue: "去审批",
      queueTitle: "待审草稿",
      queueHint: "自动提炼（草稿模式）产出的候选先到这里，批准后才会被注入简报与检索。",
      queueEmpty: "没有待审草稿",
      queueApprove: "批准",
      queueEditApprove: "编辑后批准",
      queueReject: "拒绝",
      queueApproved: "已批准生效",
      queueRejected: "已拒绝",
      queueSupersedes: "批准后推翻旧条",
      confirmReject: "拒绝并删除这条草稿？（草稿从未生效，删除不留档）",
      chainSupersedes: "↩ 推翻了旧条",
      chainSupersededBy: "被新条推翻",
      rollback: "回滚",
      confirmRollback: "回滚这条版本链？旧条会恢复生效，新条归档。",
      supersedeBtn: "推翻",
      supersedesHint: "以新结论替换旧条：旧条归档（可回滚），这条生效。",
      fRelated: "关联记忆 id",
      fRelatedPh: "逗号分隔的记忆 id，允许悬空",
      fSupersedes: "推翻记忆 id",
      fSupersedesPh: "留空表示不推翻任何条目",
      draftChip: "草稿",
      modeIndex: "索引模式（一行一条）",
      modeFull: "全文模式（标题+摘录）",
      modePortrait: "画像模式（画像 + 索引）",
      sBriefMode: "简报注入形态",
      sTurnRecall: "轮末相关召回",
      sTurnRecallHint: "每轮结束后按当轮内容本地检索相关记忆，下一轮随简报注入。纯本地打分，不花模型 token。",
      sTurnRecallLimit: "每轮召回条数",
      sDiscipline: "记忆纪律",
      sDisciplineHint: "在简报里告诉模型何时写什么（含「记住/忘掉/更新记忆」等对话内指令）。",
      sRewriteMode: "画像重写方式",
      rewriteDirect: "直接生效",
      rewriteDraft: "先进待审",
      sJournalDays: "重写读取日志天数",
      sCaptureMode: "提炼写入方式",
      captureDirect: "直接落库",
      captureDraft: "草稿审批",
      sStaleDays: "体检的过期阈值（天）",
    };

    const en = {
      nav: "Memory",
      tabMemories: "Memories",
      tabMaintain: "Maintenance",
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
      viewList: "List",
      groupByTag: "Group by tag",
      groupByCategory: "Group by type",
      groupByNone: "Whole document",
      groupByTimeline: "Timeline (archived included)",
      ungrouped: "Uncategorized",
      consolidate: "Consolidate",
      consolidateHint: "Merge this group into one memory; the sources get archived",
      consolidated: "Consolidated. Sources were archived (enable “Include archived” to see them).",
      manageMemory: "Manage memories",
      manageHint: "Tidy by tag, or view and edit everything as one document.",
      docAddHint: "No form needed to add a memory: just say “remember …” in the conversation and this document updates itself.",
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
      chipTainted: "tainted",
      chipTaintedHint: "Matches injection patterns; quarantined as draft for non-user sources.",
      chipRedacted: "redacted",
      chipRedactedHint: "Secret patterns were replaced with [REDACTED:*] on write.",
      chipExternal: "external",
      chipExternalHint: "From web/tool output — verify before relying on it.",
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
      sPortraitChars: "Portrait budget (chars)",
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
      sQualityGate: "Archive low-quality memories automatically",
      sQualityGateHint: "Memories written by auto-capture or the model itself are archived (and kept out of the briefing) when their quality score is below 30. Manual and imported memories are never hidden.",
      sCaptureSub: "Let subagent sessions auto-capture too",
      sCaptureSubHint: "Off by default: intermediate work of delegated tasks is not turned into long-term memory.",
      reasonLabel: "Why",
      qualityChip: "Quality",
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
      tlHint: "All memories by update time, archived included; click one to edit it.",
      tlSearch: "Filter the timeline…",
      recentTitle: "Just learned",
      recentHint: "{n} memories added or updated in the last 24h; confirm they are worth keeping, archive the rest.",
      recentSummary: "+{n} in 24h",
      recentOpen: "Show",
      recentClose: "Hide",
      briefPreviewTitle: "Next session briefing",
      briefPreviewHint: "{mode} ｜ injecting {n} / {available}{portrait} ｜ ≈{tokens} tokens / request",
      briefPreviewOff: "Briefing is off (enable it in Settings)",
      briefPortraitPart: " ｜ portrait {chars} chars",
      briefSummary: "{n} injected · ≈{tokens} tok",
      briefTailTitle: "Tail injection (not in the system prompt)",
      briefTailChip: "tail +{n}",
      briefTailHint: "{n} recalled at turn end · {chars} chars, delivered right after your message — it never touches the system-prompt prefix",
      briefTailEmpty: "No tail recall this turn",
      briefFrozenYes: "frozen",
      briefFrozenNo: "not frozen",
      portraitTitle: "Portrait",
      portraitOpen: "Show portrait",
      portraitClose: "Hide portrait",
      portraitDiff: "What changed",
      portraitDiffClose: "Hide changes",
      portraitPromote: "Write to AGENTS.md",
      portraitPromoted: "Written to AGENTS.md ({n} lines; it is marked stale when the portrait is rewritten)",
      portraitDiffTitle: "Portrait changes (previous → current)",
      portraitDiffLoading: "Comparing versions…",
      portraitDiffNoPrevious: "Only one version so far — nothing to compare.",
      portraitDiffEmpty: "No changes in this version.",
      portraitDiffFrom: "v{from} → v{to}",
      portraitSubtitle: "A rolling profile of this workspace and of you — \"how things are now\" lives here; only non-expiring knowledge stays as memories below.",
      portraitCharsUnit: "{n} chars",
      portraitWorkspaceLabel: "Workspace portrait",
      portraitGlobalLabel: "Global portrait",
      portraitStored: "stored in portrait.json",
      portraitFromMd: "from PORTRAIT.md (persists on first save)",
      portraitEditHint: "Edit by `**Section**` blocks: Background / Conventions (Profile in the global one) / Focus / Recent.",
      portraitSaved: "Portrait saved (v{v})",
      portraitEmptySections: "Keep at least one titled section",
      portraitEmpty: "No portrait yet. Use “Rewrite portrait” to generate one from the journal and memories, or write it here by hand.",
      portraitRewrite: "Rewrite portrait",
      portraitRewritingShort: "Rewriting…",
      portraitRewriting: "Rewriting the portrait (merging journal & memories)…",
      portraitRewritten: "Portrait rewritten and saved",
      portraitDrafted: "Rewrite saved as a draft for approval",
      portraitDraftHint: "A rewrite is waiting for approval (approve to apply; the old version is archived)",
      portraitDraftView: "Preview",
      portraitDraftHide: "Hide preview",
      portraitDraftApprove: "Approve",
      portraitDraftDiscard: "Discard",
      portraitDraftApproved: "Rewrite approved — portrait updated",
      portraitDraftDiscarded: "Rewrite discarded",
      journalTitle: "Work journal",
      journalHint: "Low-barrier daily log, auto-appended after substantive work",
      journalSummary: "{n} days",
      journalEmpty: "No journal yet. It fills automatically after substantive work.",
      briefChip: "Briefed",
      briefExcluded: "Not briefed",
      tagMergeTitle: "Tag cleanup",
      tagMergeHint: "Merges variants of the same tag (e.g. DSH / dsh) into one; casing never affects search.",
      tagMergeVariants: "Variants: {variants}",
      tagMergeDo: "Merge into {tag}",
      tagMerged: "Tags merged: {n} memories updated",
      healthHint: "Duplicates, stale entries and broken links; merging is reversible (sources get archived), archiving restores.",
      dreamTitle: "Dream · one-click tidy-up",
      dreamHint: "Merge duplicate clusters (sources archived, restorable), report stale entries, and send a portrait rewrite to the approval queue. Runs only when you click — no background jobs.",
      dreamRun: "Tidy up",
      dreamRunning: "Tidying…",
      dreamDone: "Dream finished",
      dreamSummary: "Merged {merged} clusters ｜ stale {stale} ｜ exposed-never-used {unused} (both reported only) ｜ portrait: {portrait}",
      dreamPortraitDrafted: "queued for review",
      dreamPortraitSaved: "saved",
      dreamPortraitNone: "not triggered",
      dreamMergedLine: "merged {count} → {title}",
      dreamErrors: "{n} step(s) failed",
      promoteBtn: "Promote to AGENTS.md",
      promoteHint: "Write this memory into the workspace AGENTS.md managed block (idempotent; edit the rest freely).",
      promoted: "Promoted into {file}",
      pathTailHint: "Last path recall injected {n} · ≈{tokens} tokens",
      healthKpiTotal: "Memories",
      healthKpiUtil: "Ever used",
      healthKpiDrafts: "Pending drafts",
      healthToken: "Briefing injection",
      healthTokenIndex: "Index mode (one line each)",
      healthTokenFull: "Full mode (title + excerpt)",
      healthTokenLast: "Last injection",
      healthTokenEst: "≈ {tokens} tokens / request (rough estimate by characters)",
      healthTokenNone: "No briefing rendered yet (appears once a session starts)",
      healthProblems: "Findings",
      healthDuplicates: "Duplicates",
      healthDuplicatesHint: "Highly similar entries; merge into one. Sources get archived and can be restored.",
      healthStale: "Stale & never used",
      healthStaleHint: "Older than {days} days, never opened or cited, not pinned. Archive them if truly unused.",
      healthExposedUnused: "Exposed, never used",
      healthExposedUnusedHint: "Injected or retrieved at least 3 times, but never opened or cited. Review the content or archive it.",
      injectionTitle: "Injection audit",
      injectionHint: "What actually entered the prompt: size, hash, which memories came along, and what the budget dropped.",
      injectionNone: "No injections recorded yet.",
      injectionKindBriefing: "Briefing",
      injectionKindTurnRecall: "Tail recall",
      injectionKindPathRecall: "Path recall",
      injectionDropped: "{n} dropped",
      derivationTitle: "Derivation chain",
      derivationHint: "Memory → portrait → AGENTS.md: each layer remembers where it was copied from; when the source breaks, the layer is marked stale.",
      derivationNone: "No derivations yet (they appear after saving a portrait or promoting into AGENTS.md).",
      derivationLayerPortrait: "Portrait",
      derivationLayerAgents: "AGENTS.md",
      derivationFresh: "still holds",
      derivationDirty: "stale",
      derivationSources: "sources",
      reviewTitle: "Review queue",
      reviewHint: "Memories with a falsifier land here when due: check whether they still hold.",
      reviewNone: "Nothing due or coming up for review.",
      reviewDue: "due",
      reviewSoon: "coming up",
      reviewFalsifier: "Falsifier",
      reviewDone: "Reviewed",
      chipFalsifier: "has falsifier",
      chipReviewDue: "review due",
      portraitEvidence: "Evidence",
      portraitUntraced: "Untraced",
      healthBroken: "Broken links",
      healthBrokenHint: "Relations pointing at memories that no longer exist; just unlink them.",
      healthNone: "No findings",
      healthMerge: "Merge",
      healthArchive: "Archive",
      healthArchiveAll: "Archive all",
      healthUnlink: "Unlink",
      healthGoQueue: "Review drafts",
      queueTitle: "Pending drafts",
      queueHint: "Candidates from auto-distillation (draft mode) land here first; they only take effect after approval.",
      queueEmpty: "No pending drafts",
      queueApprove: "Approve",
      queueEditApprove: "Edit then approve",
      queueReject: "Reject",
      queueApproved: "Approved and active",
      queueRejected: "Rejected",
      queueSupersedes: "Supersedes the old entry on approval",
      confirmReject: "Reject and delete this draft? (Drafts never took effect; deleting leaves no trace)",
      chainSupersedes: "↩ superseded an older entry",
      chainSupersededBy: "superseded by a newer entry",
      rollback: "Roll back",
      confirmRollback: "Roll back this chain? The old entry becomes active again, the new one is archived.",
      supersedeBtn: "Supersede",
      supersedesHint: "Replace the old entry with a new conclusion: the old one is archived (rollback possible), this one takes effect.",
      fRelated: "Related memory ids",
      fRelatedPh: "Comma separated ids; dangling ones are fine",
      fSupersedes: "Supersedes memory id",
      fSupersedesPh: "Leave empty to supersede nothing",
      draftChip: "Draft",
      modeIndex: "Index mode (one line each)",
      modeFull: "Full mode (title + excerpt)",
      modePortrait: "Portrait mode (portrait + index)",
      sBriefMode: "Briefing style",
      sTurnRecall: "Turn-end related recall",
      sTurnRecallHint: "After each turn, retrieves related memories locally and injects them with the next briefing. Pure local scoring, no model tokens.",
      sTurnRecallLimit: "Memories recalled per turn",
      sDiscipline: "Memory discipline",
      sDisciplineHint: "Tells the model when to write what (including “remember / forget / update memory” in-conversation triggers).",
      sRewriteMode: "Portrait rewrite mode",
      rewriteDirect: "Apply directly",
      rewriteDraft: "Draft & approve",
      sJournalDays: "Journal days for rewrite",
      sCaptureMode: "Distillation write mode",
      captureDirect: "Save directly",
      captureDraft: "Draft & review",
      sStaleDays: "Stale threshold in days (health)",
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
        feedback: "反馈",
        user: "用户",
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
      feedback: "Feedback",
      user: "User",
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

    function Card({ record, t, lang, dense, injected, onEdit, onRemove, onTogglePin, onToggleArchive, onRollback, onSupersede }) {
      const label = lang === "zh"
        ? CatLabels.zh[record.category] || record.category
        : CATEGORY_EN[record.category] || record.category;
      const tags = Array.isArray(record.tags) ? record.tags : [];
      const relatedCount = Array.isArray(record.related) ? record.related.length : 0;
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
          record.reason
            ? h("div", { className: "dshmem_reason" }, `${t("reasonLabel")}：${record.reason}`)
            : null,
          h("div", { className: "dshmem_meta" },
            h("span", { className: "dshmem_chip" }, label),
            injected ? h("span", { className: "dshmem_chain", title: t("briefPreviewTitle") }, `✓ ${t("briefChip")}`) : null,
            record.scope === "global" ? h("span", { className: "dshmem_chip" }, t("globalTag")) : null,
            record.pinned ? h("span", { className: "dshmem_chip dshmem_chip_on" }, t("pinned")) : null,
            record.archived ? h("span", { className: "dshmem_chip" }, t("archived")) : null,
            typeof record.quality === "number" && record.quality < 60
              ? h("span", { className: "dshmem_chip" }, `${t("qualityChip")} ${record.quality}`)
              : null,
            tags.map((tag) => h("span", { key: tag, className: "dshmem_tag" }, `#${tag}`)),
            h("span", null, `${SOURCE_LABEL[record.source] || record.source} · ${when(record.updatedAt)}`),
            record.useCount ? h("span", null, `×${record.useCount}`) : null,
            record.supersedes ? h("span", { className: "dshmem_chain" }, t("chainSupersedes")) : null,
            record.supersededBy ? h("span", { className: "dshmem_chain" }, t("chainSupersededBy")) : null,
            relatedCount ? h("span", { className: "dshmem_chain" }, `⇔ ${relatedCount}`) : null
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
          onSupersede
            ? h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                title: t("supersedesHint"),
                onClick: () => onSupersede(record),
              }, t("supersedeBtn"))
            : null,
          (record.supersedes || record.supersededBy) && onRollback
            ? h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                title: t("confirmRollback"),
                onClick: () => onRollback(record),
              }, t("rollback"))
            : null,
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
        related: Array.isArray(draft?.related) ? draft.related.join(", ") : "",
        supersedes: draft?.supersedes || "",
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
          related: form.related
            .split(/[,，]/)
            .map((id) => id.trim())
            .filter(Boolean),
          supersedes: form.supersedes.trim() || undefined,
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
        h("div", { className: "dshmem_row" },
          h("span", { className: "dshmem_lbl" }, t("fRelated")),
          h("input", {
            className: "dshmem_input",
            value: form.related,
            placeholder: t("fRelatedPh"),
            onChange: (event) => patch("related", event.target.value),
          })
        ),
        form.id
          ? null
          : h("div", { className: "dshmem_row" },
              h("span", { className: "dshmem_lbl" }, t("fSupersedes")),
              h("input", {
                className: "dshmem_input",
                value: form.supersedes,
                placeholder: t("fSupersedesPh"),
                onChange: (event) => patch("supersedes", event.target.value),
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

      /* 分区与分组：范围分区（项目记忆 / 全局记忆）× 标签分组，外加折叠与「整合」来源。 */
      /* 视图默认「档案」：一条条卡片适合管理，但用户平时想看的是一份连续的档案。 */
      const [view, setView] = useState("doc");
      /* 档案视图默认「整篇文档」（一个工作区一份长记忆）；按标签/按类型分组是同一视图的另一种排布。 */
      const [groupBy, setGroupBy] = useState("none");
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

      /* 时间线 / 健康 / 审批：进入对应 tab 或发生写操作后才拉取（detailTick 驱动刷新）。 */
      const [timelineData, setTimelineData] = useState(null);
      const [tlQuery, setTlQuery] = useState("");
      const [healthData, setHealthData] = useState(null);
      const [healthBusy, setHealthBusy] = useState(false);
      /* 注入审计：最近真正进 prompt 的内容（字节、hash、取了什么、挤掉了什么）。 */
      const [injectionData, setInjectionData] = useState(null);
      /* Dream：一键半自动整理的运行态与最近一次报告。 */
      const [dreamBusy, setDreamBusy] = useState(false);
      const [dreamData, setDreamData] = useState(null);
      const [queueData, setQueueData] = useState(null);
      const [queueEdit, setQueueEdit] = useState(null);
      /* 派生链：记忆 → 画像 → AGENTS.md 的源快照与失效状态。 */
      const [derivationData, setDerivationData] = useState(null);
      /* 复审队列：带失效条件、到期该复查的记忆。 */
      const [reviewData, setReviewData] = useState(null);
      const [detailTick, setDetailTick] = useState(0);
      /* 「刚刚记了什么」与「简报预览」：记忆库顶部的两个横幅的数据源。 */
      const [recentData, setRecentData] = useState(null);
      const [recentOpen, setRecentOpen] = useState(false);
      const [briefOpen, setBriefOpen] = useState(false);
      const [briefPreviewData, setBriefPreviewData] = useState(null);
      /* 画像卡：portrait.json / PORTRAIT.md 的展示与编辑（scope: "workspace" | "global"）。 */
      const [portraitData, setPortraitData] = useState(null);
      const [portraitOpen, setPortraitOpen] = useState(false);
      const [portraitEdit, setPortraitEdit] = useState(null);
      const [portraitBusy, setPortraitBusy] = useState(false);
      /* 重写（P1）：按钮忙碌态 + 待审稿预览数据。 */
      const [rewriteBusy, setRewriteBusy] = useState(false);
      const [draftData, setDraftData] = useState(null);
      /* 画像 2.0：上一版 → 当前版的 diff（默认收起，点开才拉）。 */
      const [portraitDiffOpen, setPortraitDiffOpen] = useState(false);
      const [portraitDiffData, setPortraitDiffData] = useState(null);
      const [portraitDiffBusy, setPortraitDiffBusy] = useState(false);
      /* 工作日志条：展开时才拉取。 */
      const [journalOpen, setJournalOpen] = useState(false);
      const [journalData, setJournalData] = useState(null);

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

      /* 列表：筛选条件变化就重拉。时间线排布需要含归档（同一份内容的另一种切法）。 */
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
                archived: archived || groupBy === "timeline" ? "1" : "",
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
        [target, query, category, scope, archived, groupBy, sort],
      );

      useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => reload(controller.signal), query ? 220 : 0);
        return () => {
          window.clearTimeout(timer);
          controller.abort();
        };
      }, [reload, query]);

      /* 时间线数据：档案视图的「时间线」排布与维护页共用（含归档，写操作后重拉）。 */
      useEffect(() => {
        const controller = new AbortController();
        api
          .timeline(target, controller.signal)
          .then((payload) => {
            if (alive.current) setTimelineData(payload);
          })
          .catch((cause) => {
            if (alive.current && cause?.name !== "AbortError") setError(String(cause?.message || cause));
          });
        return () => controller.abort();
      }, [target, detailTick]);

      /* 「刚刚记了什么」：最近更新的 50 条（不受当前筛选影响），前端再按 24h 过滤。 */
      useEffect(() => {
        const controller = new AbortController();
        api
          .list({ workspace: target, sort: "updated", limit: 50 }, controller.signal)
          .then((payload) => {
            if (alive.current) setRecentData(payload);
          })
          .catch(() => {
            /* 横幅取不到不影响主列表 */
          });
        return () => controller.abort();
      }, [target, detailTick]);

      /* 「下次会话将注入」预览：设置变化或写操作后重算。 */
      useEffect(() => {
        const controller = new AbortController();
        api
          .briefPreview(target, controller.signal)
          .then((payload) => {
            if (alive.current) setBriefPreviewData(payload?.preview || null);
          })
          .catch(() => {
            /* 预览取不到不影响主列表 */
          });
        return () => controller.abort();
      }, [target, detailTick, settings?.briefMode, settings?.briefingLimit, settings?.briefingMaxChars]);

      /* 画像：工作区切换或写操作后重拉。 */
      useEffect(() => {
        const controller = new AbortController();
        api
          .portrait(target, controller.signal)
          .then((payload) => {
            if (alive.current) setPortraitData(payload || null);
          })
          .catch(() => {
            /* 画像取不到不影响主列表 */
          });
        return () => controller.abort();
      }, [target, detailTick]);

      /* 健康：同上。 */
      useEffect(() => {
        if (tab !== "maintain") return undefined;
        const controller = new AbortController();
        api
          .health(target, controller.signal)
          .then((payload) => {
            if (alive.current) setHealthData(payload);
          })
          .catch((cause) => {
            if (alive.current && cause?.name !== "AbortError") setError(String(cause?.message || cause));
          });
        return () => controller.abort();
      }, [tab, target, detailTick]);

      /* 注入审计：与健康同在「维护」tab。 */
      useEffect(() => {
        if (tab !== "maintain") return undefined;
        const controller = new AbortController();
        api
          .injections(target, controller.signal, 12)
          .then((payload) => {
            if (alive.current) setInjectionData(payload);
          })
          .catch(() => {
            /* 审计读不到不影响其它区块 */
          });
        return () => controller.abort();
      }, [tab, target, detailTick]);

      /* 审批队列：与健康同在「维护」tab。 */
      useEffect(() => {
        if (tab !== "maintain") return undefined;
        const controller = new AbortController();
        api
          .queue(target, controller.signal)
          .then((payload) => {
            if (alive.current) setQueueData(payload);
          })
          .catch((cause) => {
            if (alive.current && cause?.name !== "AbortError") setError(String(cause?.message || cause));
          });
        return () => controller.abort();
      }, [tab, target, detailTick]);

      /* 派生链与复审队列：同样只在「维护」tab 拉。 */
      useEffect(() => {
        if (tab !== "maintain") return undefined;
        const controller = new AbortController();
        api
          .derivations(target, controller.signal)
          .then((payload) => {
            if (alive.current) setDerivationData(payload);
          })
          .catch(() => {
            /* 派生链读不到不影响其它区块 */
          });
        api
          .reviews(target, controller.signal, 30)
          .then((payload) => {
            if (alive.current) setReviewData(payload);
          })
          .catch(() => {
            /* 复审队列读不到不影响其它区块 */
          });
        return () => controller.abort();
      }, [tab, target, detailTick]);

      /* 写操作后统一刷新状态与列表。 */
      const afterWrite = useCallback(
        (message) => {
          if (message) flash(message);
          setDetailTick((tick) => tick + 1);
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

      /* 分组键：按标签时取第一条标签的归并形式（大小写不敏感，治理 DSH/dsh 漂移），
         按类型时取 category。`mode` 可以显式传入：整理永远按标签算，不受当前排布下拉的影响。 */
      const groupKeyOf = (record, mode = groupBy) => {
        if (mode === "category") return `cat:${record.category || "note"}`;
        const first = Array.isArray(record.tags) && record.tags.length ? String(record.tags[0]) : "";
        return first ? `tag:${first.toLowerCase()}` : UNGROUPED;
      };
      /* 组显示名：标签组取组内出现最多的原始写法（DSH/dsh 混用时显示更常见的那种）。 */
      const groupLabelOf = (key, items = []) => {
        if (key === UNGROUPED) return t("ungrouped");
        if (key === ALL_GROUP) return t("total");
        if (key.startsWith("cat:")) return catLabel(key.slice(4));
        const raw = key.slice(4);
        const tally = new Map();
        for (const record of items) {
          for (const tag of record.tags || []) {
            if (String(tag).toLowerCase() !== raw) continue;
            tally.set(tag, (tally.get(tag) || 0) + 1);
          }
        }
        const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        return `#${best ? best[0] : raw}`;
      };
      const groupRecords = (list, mode = groupBy) => {
        const buckets = new Map();
        for (const record of list) {
          const key = mode === "none" ? ALL_GROUP : groupKeyOf(record, mode);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(record);
        }
        return [...buckets.entries()]
          .map(([key, items]) => ({ key, label: groupLabelOf(key, items), items }))
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
          title: tagged ? group.label.slice(1) : group.label,
          content: group.items
            .map((record) => {
              const body = String(record.content || "").replace(/\s+/g, " ").trim();
              return `- **${record.title}**${body ? ` — ${body}` : ""}`;
            })
            .join("\n"),
          category: top ? top[0] : "note",
          tags: tagged ? [group.label.slice(1)] : [],
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
        setQueueEdit(null);
      };
      const submitDraft = (form) => {
        const sources = mergeIds;
        const pendingQueue = queueEdit;
        closeEditor();
        /* 审批流：草稿「编辑后批准」——编辑字段随批准请求一起提交。 */
        if (pendingQueue) {
          run(api.approve({ workspace: target, id: pendingQueue.id, ...form }), t("queueApproved"));
          return;
        }
        /* 版本链：以新结论推翻旧条（/save 带 supersedes 时走 supersede）。 */
        if (form.supersedes && !form.id) {
          run(api.save({ workspace: target, ...form, source: "manual" }), t("saved"));
          return;
        }
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
          injected: briefIds.has(record.id),
          onEdit: (item) => {
            setMergeIds(null);
            setQueueEdit(null);
            setDraft(item);
          },
          onTogglePin: (item) =>
            run(api.update({ workspace: target, id: item.id, pinned: !item.pinned })),
          onToggleArchive: (item) =>
            run(api.update({ workspace: target, id: item.id, archived: !item.archived })),
          onRemove: (item) => run(api.remove({ workspace: target, id: item.id })),
          onRollback: (item) => {
            if (typeof window !== "undefined" && !window.confirm(t("confirmRollback"))) return;
            run(api.rollback({ workspace: target, id: item.id }), t("saved"));
          },
          onSupersede: (item) => {
            setMergeIds(null);
            setQueueEdit(null);
            /* 推翻 = 以旧条为底稿写新结论：不带 id，带上 supersedes。 */
            setDraft({
              title: item.title,
              content: item.content,
              category: item.category,
              tags: item.tags,
              scope: item.scope,
              supersedes: item.id,
            });
          },
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

      /* ---------------- 记忆库顶部：变化横幅 + 简报预览 ---------------- */

      /* 「刚刚记了什么」：最近更新的 50 条里取 24h 内的变化，不受当前筛选影响。
         横幅本体在 docEntry 之后定义（展开时复用 docEntry 的渲染）。 */
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      const recentItems = (Array.isArray(recentData?.records) ? recentData.records : [])
        .filter((record) => (Date.parse(record.updatedAt) || 0) >= dayAgo);
      const briefIds = new Set(Array.isArray(briefPreviewData?.ids) ? briefPreviewData.ids : []);
      /** 「这条会被注入下次简报」的小标记；卡片与时间线条目共用。 */
      const injectedChip = (record) =>
        briefIds.has(record.id)
          ? h("span", { className: "dshmem_chain", title: t("briefPreviewTitle") }, `✓ ${t("briefChip")}`)
          : null;

      /** 写入安全徽标：taint / 已脱敏 / 外部来源；卡片与时间线条目共用。 */
      const securityChips = (record) => [
        record.taint
          ? h("span", { className: "dshmem_chip", title: t("chipTaintedHint") }, t("chipTainted"))
          : null,
        record.redactions?.length
          ? h("span", { className: "dshmem_chip", title: t("chipRedactedHint") }, t("chipRedacted"))
          : null,
        record.trust === "external"
          ? h("span", { className: "dshmem_chip", title: t("chipExternalHint") }, t("chipExternal"))
          : null,
      ];

      /** 复审徽标：写了失效条件 / 已经到期该复查。 */
      const reviewChips = (record) => [
        record.falsifier
          ? h("span", { className: "dshmem_chip", title: record.falsifier }, t("chipFalsifier"))
          : null,
        record.falsifier && record.reviewAt && Date.parse(record.reviewAt) <= Date.now()
          ? h("span", { className: "dshmem_chip", title: record.falsifier }, t("chipReviewDue"))
          : null,
      ];

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
        for (const group of groupRecords(records.filter((record) => record.scope === section.id), "tag")) {
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

      /* 档案视图 = 一个工作区一份长记忆；同一份内容还能按标签/按类型排成可整理的分组。
         原来「档案」与「记忆空间」是两个视图、内容完全重合，现在合成一个视图的两种排布：
         不分组 → 连续文档；按标签/按类型 → 可折叠、可整合的分组卡片。 */
      /* ZCode 式索引条目：默认「标题 + 一句话钩子」，点击展开全文——索引常驻、正文按需，
         和注入侧的索引式简报同一个心智模型。 */
      const [docExpanded, setDocExpanded] = useState({});
      /* 时间线条目、画像子块（工作区/全局）各自的展开态——「都设计成可展开」的统一折叠语言。 */
      const [tlExpanded, setTlExpanded] = useState({});
      const [portraitSubExpanded, setPortraitSubExpanded] = useState({});
      const docEntry = (record) => {
        const content = String(record.content || "").trim();
        const firstLine = content.split("\n").find((line) => line.trim()) || "";
        const hook = firstLine.length > 96 ? `${firstLine.slice(0, 95)}…` : firstLine;
        const open = Boolean(docExpanded[record.id]);
        return h("div", { className: "dshmem_docItem", key: record.id },
          h("div", { className: "dshmem_docHeadRow" },
            h("span", {
              className: "dshmem_chev",
              style: { cursor: "pointer" },
              onClick: () => setDocExpanded((current) => ({ ...current, [record.id]: !current[record.id] })),
            }, open ? "▾" : "▸"),
            h("span", {
              className: "dshmem_docTitle",
              style: { cursor: "pointer" },
              onClick: () => setDocExpanded((current) => ({ ...current, [record.id]: !current[record.id] })),
            }, record.title || t("untitled")),
            injectedChip(record),
            ...securityChips(record),
            ...reviewChips(record),
            h("span", {
              className: "dshmem_docFree",
              onClick: () => {
                setMergeIds(null);
                setDraft(record);
              },
            }, t("edit"))),
          open
            ? content
              ? h("div", { className: "dshmem_docPara" }, content)
              : null
            : hook
              ? h("div", { className: "dshmem_docPara" }, hook)
              : null);
      };

      const toggleRecent = () => setRecentOpen((value) => !value);
      const recentBox = recentItems.length
        ? h("div", { className: "dshmem_box" },
            h("div", { className: "dshmem_docHeadRow" },
              h("span", { className: "dshmem_chev", style: { cursor: "pointer" }, onClick: toggleRecent },
                recentOpen ? "▾" : "▸"),
              h("span", { className: "dshmem_docTitle", style: { cursor: "pointer" }, onClick: toggleRecent },
                t("recentTitle")),
              h("span", { className: "dshmem_hint" },
                t("recentSummary").replace("{n}", String(recentItems.length))),
              h("div", { style: { flex: 1 } }),
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                onClick: toggleRecent,
              }, recentOpen ? t("recentClose") : t("recentOpen"))),
            recentOpen
              ? h("div", { className: "dshmem" },
                  h("div", { className: "dshmem_hint" }, t("recentHint").replace("{n}", String(recentItems.length))),
                  h("div", { className: "dshmem_docFlat" }, recentItems.map(docEntry)))
              : null)
        : null;

      const toggleBrief = () => setBriefOpen((value) => !value);
      const briefFullHint = !briefPreviewData?.enabled
        ? t("briefPreviewOff")
        : t("briefPreviewHint")
            .replace("{mode}",
              briefPreviewData.mode === "full"
                ? t("modeFull")
                : briefPreviewData.mode === "portrait"
                  ? t("modePortrait")
                  : t("modeIndex"))
            .replace("{n}", String(briefPreviewData.count))
            .replace("{available}", String(briefPreviewData.available))
            .replace("{portrait}",
              briefPreviewData.portrait
                ? t("briefPortraitPart").replace("{chars}", String(briefPreviewData.portrait.chars))
                : "")
            .replace("{tokens}", String(briefPreviewData.estTokens));
      const briefBox = briefPreviewData
        ? h("div", { className: "dshmem_box" },
            h("div", { className: "dshmem_docHeadRow" },
              h("span", {
                className: "dshmem_chev",
                style: { cursor: "pointer" },
                onClick: briefPreviewData.enabled ? toggleBrief : undefined,
              }, briefPreviewData.enabled ? (briefOpen ? "▾" : "▸") : ""),
              h("span", {
                className: "dshmem_docTitle",
                style: { cursor: "pointer" },
                onClick: briefPreviewData.enabled ? toggleBrief : undefined,
              }, t("briefPreviewTitle")),
              briefPreviewData.enabled
                ? h("span", { className: "dshmem_hint" },
                    t("briefSummary")
                      .replace("{n}", String(briefPreviewData.count))
                      .replace("{tokens}", String(briefPreviewData.estTokens)))
                : h("span", { className: "dshmem_hint" }, t("briefPreviewOff")),
              /* 尾部注入是另一条通道（不进系统提示），收起时也给个计数标记。 */
              briefPreviewData.enabled && briefPreviewData.recall?.count
                ? h("span", { className: "dshmem_chain", title: t("briefTailTitle") },
                    t("briefTailChip").replace("{n}", String(briefPreviewData.recall.count)))
                : null,
              h("div", { style: { flex: 1 } }),
              briefPreviewData.enabled && (briefPreviewData.titles?.length || briefPreviewData.recall?.count)
                ? h("button", {
                    type: "button",
                    className: "dshmem_btn dshmem_btn_sm",
                    onClick: toggleBrief,
                  }, briefOpen ? t("recentClose") : t("recentOpen"))
                : null),
            /* 默认收起：完整口径与具体名单都是低频动作，常驻会跟当前筛选打架（搜索/折叠/范围切换时误导）。 */
            briefPreviewData.enabled && briefOpen
              ? h("div", { className: "dshmem" },
                  h("div", { className: "dshmem_hint" }, briefFullHint),
                  briefPreviewData.titles?.length
                    ? h("div", { className: "dshmem_docFlat" },
                        briefPreviewData.titles.map((title, index) =>
                          h("div", { className: "dshmem_docPara", key: `${index}-${title}` }, `· ${title}`)))
                    : null,
                  /* 静态部分是否已冻结：冻结就是「下次请求真的逐字节照发」。 */
                  h("div", { className: "dshmem_hint" },
                    briefPreviewData.frozen ? t("briefFrozenYes") : t("briefFrozenNo")),
                  /* 尾部注入：单独一栏，明确它不在系统提示里。 */
                  h("div", { className: "dshmem_docTitle" }, t("briefTailTitle")),
                  briefPreviewData.recall?.count
                    ? h("div", {},
                        h("div", { className: "dshmem_hint" },
                          t("briefTailHint")
                            .replace("{n}", String(briefPreviewData.recall.count))
                            .replace("{chars}", String(briefPreviewData.recall.chars))),
                        h("div", { className: "dshmem_docFlat" },
                          briefPreviewData.recall.titles.map((title, index) =>
                            h("div", { className: "dshmem_docPara", key: `tail-${index}-${title}` }, `· ${title}`))))
                    : h("div", { className: "dshmem_hint" }, t("briefTailEmpty")))
              : null)
        : null;

      /* ------------- 画像卡：工作区 + 全局两份「全貌」；编辑按 `**段标题**` 分段。 ------------- */

      const portraitTextOf = (portrait) =>
        (portrait?.sections || [])
          .filter((section) => section.text)
          .map((section) => `**${section.title}**\n${section.text}`)
          .join("\n\n");

      const splitPortraitText = (text) => {
        const lines = String(text || "").split(/\r?\n/);
        const out = [];
        let current = null;
        for (const line of lines) {
          const match = line.match(/^\*\*(.+?)\*\*\s*$/);
          if (match) {
            current = { title: match[1].trim(), body: [] };
            out.push(current);
            continue;
          }
          if (current) current.body.push(line);
        }
        return out
          .map((section) => ({ title: section.title, text: section.body.join("\n").trim() }))
          .filter((section) => section.title);
      };

      const beginPortraitEdit = (scope, portrait) => {
        setPortraitEdit({ scope, text: portraitTextOf(portrait) });
      };

      const savePortraitEdit = () => {
        if (!portraitEdit) return;
        const sections = splitPortraitText(portraitEdit.text);
        if (!sections.length) {
          setError(t("portraitEmptySections"));
          return;
        }
        setPortraitBusy(true);
        setError("");
        (async () => {
          try {
            const payload = await api.savePortrait({
              workspace: target,
              scope: portraitEdit.scope,
              sections,
            });
            const next = payload?.portrait || null;
            setPortraitData((prev) => ({
              ...(prev || { workspace: null, global: null, history: [] }),
              [portraitEdit.scope === "global" ? "global" : "workspace"]: next,
            }));
            setPortraitEdit(null);
            flash(t("portraitSaved").replace("{v}", String(next?.version ?? "")));
            setDetailTick((value) => value + 1);
          } catch (cause) {
            setError(String(cause?.message || cause));
          } finally {
            if (alive.current) setPortraitBusy(false);
          }
        })();
      };

      /* 重写画像：LLM 重写式合并（日志 + 条目 → 画像）；draft 模式进待审。 */
      const doPortraitRewrite = () => {
        setRewriteBusy(true);
        setError("");
        flash(t("portraitRewriting"));
        (async () => {
          try {
            const payload = await api.rewritePortrait({ workspace: target, scope: "workspace" });
            flash(payload?.drafted ? t("portraitDrafted") : t("portraitRewritten"));
            setDetailTick((value) => value + 1);
          } catch (cause) {
            setError(String(cause?.message || cause));
          } finally {
            if (alive.current) setRewriteBusy(false);
          }
        })();
      };

      /* 画像 → AGENTS.md：把「协作约定」段写进工作区 AGENTS.md（派生链第二跳）。 */
      const doPortraitPromote = () => {
        setPortraitBusy(true);
        setError("");
        (async () => {
          try {
            const payload = await api.promote({ workspace: target, from: "portrait", section: "preference" });
            flash(t("portraitPromoted").replace("{n}", String((payload?.lines || []).length)));
            setDetailTick((value) => value + 1);
          } catch (cause) {
            setError(String(cause?.message || cause));
          } finally {
            if (alive.current) setPortraitBusy(false);
          }
        })();
      };

      /* 画像 2.0：拉上一版 → 当前版的 diff；点开才请求，失败不清空已有画像。 */
      const loadPortraitDiff = () => {
        setPortraitDiffBusy(true);
        setError("");
        (async () => {
          try {
            const payload = await api.portraitDiff(target);
            setPortraitDiffData(payload || null);
          } catch (cause) {
            setError(String(cause?.message || cause));
          } finally {
            if (alive.current) setPortraitDiffBusy(false);
          }
        })();
      };

      const togglePortraitDiff = () => {
        const next = !portraitDiffOpen;
        setPortraitDiffOpen(next);
        if (next && !portraitDiffData) loadPortraitDiff();
      };

      const loadDraft = () => {
        (async () => {
          try {
            const payload = await api.portraitDraft(target);
            setDraftData(payload?.draft || null);
          } catch (cause) {
            setError(String(cause?.message || cause));
          }
        })();
      };

      const approveDraftNow = () => {
        (async () => {
          try {
            await api.approveDraft({ workspace: target, scope: "workspace" });
            setDraftData(null);
            flash(t("portraitDraftApproved"));
            setDetailTick((value) => value + 1);
          } catch (cause) {
            setError(String(cause?.message || cause));
          }
        })();
      };

      const discardDraftNow = () => {
        (async () => {
          try {
            await api.discardDraft({ workspace: target });
            setDraftData(null);
            flash(t("portraitDraftDiscarded"));
            setDetailTick((value) => value + 1);
          } catch (cause) {
            setError(String(cause?.message || cause));
          }
        })();
      };

      /* 工作日志：展开时拉最近几天（只读）。 */
      const toggleJournal = () => {
        const next = !journalOpen;
        setJournalOpen(next);
        if (next) {
          (async () => {
            try {
              const payload = await api.journal(target, { days: 3 });
              setJournalData(payload || null);
            } catch {
              /* 日志取不到不影响主列表 */
            }
          })();
        }
      };

      /* 画像证据：ref 显示成人能读的标签；没有证据的段标「未溯源」。 */
      const formatEvidenceRef = (ref) => {
        const text = String(ref || "");
        if (text.startsWith("journal:")) return `${text.slice(8)} 日志`;
        if (text.startsWith("mem_")) return `#${text}`;
        if (text.startsWith("session:")) return `会话 ${text.slice(8, 14)}`;
        return text;
      };
      const portraitEvidenceRow = (portraitLike, section) => {
        const refs = Array.isArray(portraitLike?.evidence?.[section.key]) ? portraitLike.evidence[section.key] : [];
        return h("div", { className: "dshmem_row", style: { gap: 4, flexWrap: "wrap" } },
          refs.length
            ? refs.map((ref) => h("span", { className: "dshmem_chip", key: ref }, formatEvidenceRef(ref)))
            : h("span", { className: "dshmem_chip" }, t("portraitUntraced")));
      };

      const portraitSectionOf = (scope, label, portrait) => {
        if (!portrait) return null;
        const editing = portraitEdit && portraitEdit.scope === scope;
        if (editing) {
          return h("div", { className: "dshmem", key: scope, style: { gap: 6 } },
            h("div", { className: "dshmem_docHeadRow" },
              h("span", { className: "dshmem_docTitle" },
                `${label}${portrait.version ? ` v${portrait.version}` : ""}`)),
            h("div", { className: "dshmem_hint" }, t("portraitEditHint")),
            h("textarea", {
              className: "dshmem_area",
              style: { minHeight: 150 },
              value: portraitEdit.text,
              onChange: (event) => setPortraitEdit({ scope, text: event.target.value }),
            }),
            h("div", { className: "dshmem_row" },
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_primary",
                disabled: portraitBusy,
                onClick: savePortraitEdit,
              }, t("save")),
              h("button", {
                type: "button",
                className: "dshmem_btn",
                disabled: portraitBusy,
                onClick: () => setPortraitEdit(null),
              }, t("cancel"))));
        }
        /* 子折叠：默认只占一行（标题 + 字数/来源），点开才铺四段——和档案条目同一个折叠语言。 */
        const subOpen = Boolean(portraitSubExpanded[scope]);
        const chars = portrait.sections.reduce((n, section) => n + String(section.text || "").length, 0);
        const toggle = () => setPortraitSubExpanded((current) => ({ ...current, [scope]: !current[scope] }));
        return h("div", { className: "dshmem", key: scope, style: { gap: 4 } },
          h("div", { className: "dshmem_docHeadRow" },
            h("span", { className: "dshmem_chev", style: { cursor: "pointer" }, onClick: toggle },
              subOpen ? "▾" : "▸"),
            h("span", { className: "dshmem_docTitle", style: { cursor: "pointer" }, onClick: toggle },
              `${label}${portrait.version ? ` v${portrait.version}` : ""}`),
            h("span", { className: "dshmem_hint" },
              `${t("portraitCharsUnit").replace("{n}", String(chars))} · ${
                portrait.persistent ? t("portraitStored") : t("portraitFromMd")
              }`),
            h("div", { style: { flex: 1 } }),
            h("button", {
              type: "button",
              className: "dshmem_btn dshmem_btn_sm",
              disabled: portraitBusy,
              onClick: () => beginPortraitEdit(scope, portrait),
            }, t("editDoc"))),
          subOpen
            ? h("div", { className: "dshmem_docFlat" },
                portrait.sections
                  .filter((section) => section.text)
                  .map((section) =>
                    h("div", { className: "dshmem_docPara", key: section.key },
                      h("span", { style: { fontWeight: 500 } }, `${section.title}：`),
                      section.text,
                      portraitEvidenceRow(portrait, section))))
            : null);
      };

      /* 卡片头收成一行：chevron + 标题 + 短摘要（版本），长说明只在展开态出现。 */
      const portraitParts = [];
      if (portraitData?.workspace) {
        portraitParts.push(`${t("portraitWorkspaceLabel")} v${portraitData.workspace.version}`);
      }
      if (portraitData?.global) {
        portraitParts.push(`${t("portraitGlobalLabel")} v${portraitData.global.version}`);
      }
      const portraitSummary = portraitParts.join(" · ");

      const portraitBox = portraitData
        ? h("div", { className: "dshmem_box" },
            h("div", { className: "dshmem_docHeadRow" },
              h("span", {
                className: "dshmem_chev",
                style: { cursor: "pointer" },
                onClick: () => setPortraitOpen((value) => !value),
              }, portraitOpen ? "▾" : "▸"),
              h("span", {
                className: "dshmem_docTitle",
                style: { cursor: "pointer" },
                onClick: () => setPortraitOpen((value) => !value),
              }, t("portraitTitle")),
              portraitSummary ? h("span", { className: "dshmem_hint" }, portraitSummary) : null,
              h("div", { style: { flex: 1 } }),
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                disabled: portraitDiffBusy,
                onClick: togglePortraitDiff,
              }, portraitDiffOpen ? t("portraitDiffClose") : t("portraitDiff")),
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                disabled: portraitBusy,
                onClick: doPortraitPromote,
              }, t("portraitPromote")),
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                disabled: rewriteBusy,
                onClick: doPortraitRewrite,
              }, rewriteBusy ? t("portraitRewritingShort") : t("portraitRewrite")),
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                onClick: () => setPortraitOpen((value) => !value),
              }, portraitOpen ? t("portraitClose") : t("portraitOpen"))),
            portraitOpen
              ? h("div", { className: "dshmem" },
                  h("div", { className: "dshmem_hint" }, t("portraitSubtitle")),
                  /* 待审重写稿：预览 / 批准 / 丢弃（draft 模式时才有）。 */
                  portraitData.draft
                    ? h("div", { className: "dshmem_box", style: { padding: 8, gap: 6 } },
                        h("div", { className: "dshmem_hint" }, t("portraitDraftHint")),
                        draftData
                          ? h("div", { className: "dshmem_docFlat" },
                              draftData.sections
                                .filter((section) => section.text)
                                .map((section) =>
                                  h("div", { className: "dshmem_docPara", key: section.key },
                                    h("span", { style: { fontWeight: 500 } }, `${section.title}：`),
                                    section.text,
                                    portraitEvidenceRow(draftData, section))))
                          : null,
                        h("div", { className: "dshmem_row" },
                          h("button", {
                            type: "button",
                            className: "dshmem_btn dshmem_btn_sm",
                            onClick: () => (draftData ? setDraftData(null) : loadDraft()),
                          }, draftData ? t("portraitDraftHide") : t("portraitDraftView")),
                          h("button", {
                            type: "button",
                            className: "dshmem_btn dshmem_btn_sm dshmem_btn_primary",
                            onClick: approveDraftNow,
                          }, t("portraitDraftApprove")),
                          h("button", {
                            type: "button",
                            className: "dshmem_btn dshmem_btn_sm",
                            onClick: discardDraftNow,
                          }, t("portraitDraftDiscard"))))
                    : null,
                  /* 画像 2.0：上一版 → 当前版的逐段 diff（只读，点开才拉）。 */
                  portraitDiffOpen
                    ? h("div", { className: "dshmem_box", style: { padding: 8, gap: 6 } },
                        h("div", { className: "dshmem_hint" }, t("portraitDiffTitle")),
                        portraitDiffBusy
                          ? h("div", { className: "dshmem_hint" }, t("portraitDiffLoading"))
                          : !portraitDiffData
                            ? null
                            : !portraitDiffData.diff
                              ? h("div", { className: "dshmem_hint" }, t("portraitDiffNoPrevious"))
                              : h("div", { className: "dshmem" },
                                  h("div", { className: "dshmem_hint" },
                                    t("portraitDiffFrom")
                                      .replace("{from}", String(portraitDiffData.from?.version ?? "?"))
                                      .replace("{to}", String(portraitDiffData.to?.version ?? "?")) +
                                      (portraitDiffData.summary ? ` · ${portraitDiffData.summary}` : "")),
                                  ...((portraitDiffData.diff.changed || []).length
                                    ? (portraitDiffData.diff.changed || []).map((section) =>
                                        h("div", { key: section.key, className: "dshmem_docPara" },
                                          h("div", { style: { fontWeight: 500 } },
                                            `${section.title} +${section.added.length} −${section.removed.length}`),
                                          ...section.removed.map((line, index) =>
                                            h("div", {
                                              key: `r${index}`,
                                              className: "dshmem_hint",
                                              style: { textDecoration: "line-through" },
                                            }, `− ${line}`)),
                                          ...section.added.map((line, index) =>
                                            h("div", { key: `a${index}` }, `+ ${line}`))))
                                    : [h("div", { className: "dshmem_hint" }, t("portraitDiffEmpty"))])))
                    : null,
                  portraitData.workspace || portraitData.global
                    ? [
                        portraitSectionOf("workspace", t("portraitWorkspaceLabel"), portraitData.workspace),
                        portraitSectionOf("global", t("portraitGlobalLabel"), portraitData.global),
                      ]
                    : h("div", { className: "dshmem_hint" }, t("portraitEmpty")))
              : null)
        : null;

      /* 工作日志条（journal）：低门槛流水账，默认收起；展开时才拉最近几天。 */
      const journalBox = h("div", { className: "dshmem_box" },
        h("div", { className: "dshmem_docHeadRow" },
          h("span", { className: "dshmem_chev", style: { cursor: "pointer" }, onClick: toggleJournal },
            journalOpen ? "▾" : "▸"),
          h("span", { className: "dshmem_docTitle", style: { cursor: "pointer" }, onClick: toggleJournal },
            t("journalTitle")),
          h("span", { className: "dshmem_hint" },
            journalData?.dates?.length
              ? t("journalSummary").replace("{n}", String(journalData.dates.length))
              : t("journalHint")),
          h("div", { style: { flex: 1 } }),
          h("button", {
            type: "button",
            className: "dshmem_btn dshmem_btn_sm",
            onClick: toggleJournal,
          }, journalOpen ? t("recentClose") : t("recentOpen"))),
        journalOpen
          ? h("div", { className: "dshmem" },
              journalData?.recent?.length
                ? h("div", { className: "dshmem_docFlat" },
                    journalData.recent.map((item) =>
                      h("div", { key: item.date, style: { marginTop: 4 } },
                        h("div", { className: "dshmem_hint" }, item.date),
                        h("div", { className: "dshmem_docPara" }, String(item.text || "").trim()))))
                : h("div", { className: "dshmem_hint" }, t("journalEmpty")))
          : null);

      /* 时间线排布：同一份记忆按「日」切（含归档），和 Qoder 之外所有竞品都没做的视图。 */
      const timelineByDay = (() => {
        const q = tlQuery.trim().toLowerCase();
        const pool = q
          ? records.filter((record) =>
              String(record.title || "").toLowerCase().includes(q) ||
              String(record.content || "").toLowerCase().includes(q))
          : records;
        const byDay = new Map();
        for (const record of pool) {
          const day = String(record.updatedAt || record.createdAt || "").slice(0, 10) || "—";
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day).push(record);
        }
        return [...byDay.entries()].map(([day, items]) => ({ day, items }));
      })();

      /* 时间线条目与档案条目同一套折叠语言：▸ 标题 + 一句话钩子，点击展开全文；编辑走 hover 小按钮。 */
      const tlEntry = (record) => {
        const content = String(record.content || "").trim();
        const firstLine = content.split("\n").find((line) => line.trim()) || "";
        const hook = firstLine.length > 96 ? `${firstLine.slice(0, 95)}…` : firstLine;
        const open = Boolean(tlExpanded[record.id]);
        const toggle = () => setTlExpanded((current) => ({ ...current, [record.id]: !current[record.id] }));
        const openEditor = () => {
          setMergeIds(null);
          setQueueEdit(null);
          setDraft(record);
        };
        return h("div", {
          className: `dshmem_tlItem${record.archived ? " dshmem_tlItem_archived" : ""}`,
          key: record.id,
        },
          h("div", { className: "dshmem_tlHead" },
            h("span", { className: "dshmem_chev", style: { cursor: "pointer" }, onClick: toggle },
              open ? "▾" : "▸"),
            h("span", { className: "dshmem_chip" }, catLabel(record.category)),
            injectedChip(record),
            ...securityChips(record),
            ...reviewChips(record),
            record.scope === "global" ? h("span", { className: "dshmem_chip" }, t("globalTag")) : null,
            record.archived ? h("span", { className: "dshmem_chip" }, t("archived")) : null,
            h("span", { className: "dshmem_tlTitle", style: { cursor: "pointer" }, onClick: toggle },
              record.title || t("untitled")),
            h("span", { className: "dshmem_hint" },
              `${SOURCE_LABEL[record.source] || record.source} · ${String(record.updatedAt || "").slice(11, 16)}`,
              record.supersedes ? ` ${t("chainSupersedes")}` : ""),
            h("span", { className: "dshmem_docFree", onClick: openEditor }, t("edit"))),
          open
            ? content
              ? h("div", { className: "dshmem_tlBody" }, content)
              : null
            : hook
              ? h("div", { className: "dshmem_docPara" }, hook)
              : null);
      };

      const memorySections = groupBy === "timeline"
        ? h("div", { className: "dshmem_tl" },
            timelineByDay.length
              ? timelineByDay.map((group) =>
                  h("div", { key: group.day },
                    h("div", { className: "dshmem_tlDay" }, group.day),
                    group.items.map(tlEntry)))
              : h("div", { className: "dshmem_empty" }, t("empty")))
        : h("div", { className: "dshmem_space" },
            /* 文档排布只列有内容的分区（免得留下一行空标题）；分组排布保留空分区，好让「这里还没东西」看得见。 */
            (groupBy === "none" ? docSections : scopeSections).map((section) => {
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
                  : groupBy === "none"
                    ? h("div", { className: "dshmem_docFlat" }, items.map(docEntry))
                    : h("div", { className: "dshmem_groups" },
                        groupRecords(items).map((group) => groupNode(section.id, group))));
            }));

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
          /* 「一个工作区一份长记忆」：正文由对话里的记忆工具维护，不需要用户在这里逐条新建。 */
          h("div", { className: "dshmem_docAdd" }, t("docAddHint")),
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
              ? memorySections
              : h("div", { className: "dshmem_empty" },
                  h("div", null, t("empty")),
                  h("div", { className: "dshmem_hint" }, t("emptyHint"))),
          h("div", { className: "dshmem_docFoot" },
            t("docFooter").replace("{path}", docPath || "—"))))
      );

      /* 档案视图就是「一个工作区一份长记忆」：条数、范围 chip、搜索、排序、新建这些都属于
         列表视图，档案页只在最上面留视图切换与排布下拉。 */
      const statsRow = h("div", { className: "dshmem_stats" },
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
        );

      const memoriesTab = h("div", { className: "dshmem" },
        portraitBox,
        recentBox,
        briefBox,
        journalBox,

        view === "doc" ? null : statsRow,

        h("div", { className: "dshmem_bar" },
          view === "doc"
            ? null
            : h("input", {
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
              className: `dshmem_seg_btn${view === "list" ? " dshmem_seg_on" : ""}`,
              onClick: () => setView("list"),
            }, t("viewList"))
          ),
          /* 排布下拉只在档案视图里；整篇文档 / 按标签 / 按类型 / 时间线是同一份内容的四种切法。 */
          view === "doc"
            ? h("select", {
                className: "dshmem_select",
                style: { width: "auto" },
                value: groupBy,
                onChange: (event) => setGroupBy(event.target.value),
              },
                h("option", { value: "none" }, t("groupByNone")),
                h("option", { value: "tag" }, t("groupByTag")),
                h("option", { value: "category" }, t("groupByCategory")),
                h("option", { value: "timeline" }, t("groupByTimeline"))
              )
            : null,
          view === "doc" && groupBy === "timeline"
            ? h("input", {
                className: "dshmem_input",
                style: { width: 180 },
                value: tlQuery,
                placeholder: t("tlSearch"),
                onChange: (event) => setTlQuery(event.target.value),
              })
            : null,
          view === "doc"
            ? null
            : h("select", {
                className: "dshmem_select",
                style: { width: "auto" },
                value: sort,
                onChange: (event) => setSort(event.target.value),
              },
                h("option", { value: "updated" }, t("sortUpdated")),
                h("option", { value: "created" }, t("sortCreated")),
                h("option", { value: "title" }, t("sortTitle"))
              ),
          view === "doc"
            ? null
            : h("label", { className: "dshmem_switch", style: { alignItems: "center" } },
                h("input", {
                  type: "checkbox",
                  checked: archived,
                  onChange: (event) => setArchived(event.target.checked),
                }),
                h("span", null, t("showArchived"))
              ),
          view === "doc"
            ? null
            : h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_primary",
                onClick: () => setDraft({}),
              }, t("newMemory"))
        ),

        view === "doc" ? null : workspaces.length > 1
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

        loading && records.length === 0
          ? h(Spin)
          : view === "doc"
            ? docTab
            : records.length === 0
              ? h("div", { className: "dshmem_empty" },
                  h("div", null, t("empty")),
                  h("div", { className: "dshmem_hint" }, t("emptyHint")))
              : h("div", { className: "dshmem_list" },
                    records.map((record) => cardNode(record, false)))
      );

      /* ---------------- 自动提炼页 ---------------- */

      const updateSetting = (key, value) => {
        setSettings((current) => ({ ...(current || {}), [key]: value }));
        setSettingsDirty(true);
      };

      /* 提炼日志：自动提炼页与健康页共用。 */
      const renderCaptures = () =>
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
                  ))));

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

        renderCaptures()
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
            h("span", { className: "dshmem_lbl" }, t("sBriefMode")),
            h("select", {
              className: "dshmem_select",
              style: { width: "auto" },
              value:
                settings?.briefMode === "full"
                  ? "full"
                  : settings?.briefMode === "portrait"
                    ? "portrait"
                    : "index",
              onChange: (event) => updateSetting("briefMode", event.target.value),
            },
              h("option", { value: "index" }, t("modeIndex")),
              h("option", { value: "full" }, t("modeFull")),
              h("option", { value: "portrait" }, t("modePortrait"))
            )
          ),
          h("div", { className: "dshmem_row" },
            num("briefingLimit", t("sLimit"), 1, 50),
            num("briefingMaxChars", t("sChars"), 200, 20000, 100),
            num("portraitMaxChars", t("sPortraitChars"), 200, 8000, 100)
          ),
          toggle("turnRecall", t("sTurnRecall"), t("sTurnRecallHint")),
          h("div", { className: "dshmem_row" },
            num("turnRecallLimit", t("sTurnRecallLimit"), 1, 10)
          ),
          toggle("discipline", t("sDiscipline"), t("sDisciplineHint")),
          h("div", { className: "dshmem_row" },
            h("span", { className: "dshmem_lbl" }, t("sRewriteMode")),
            h("select", {
              className: "dshmem_select",
              style: { width: "auto" },
              value: settings?.rewriteMode === "draft" ? "draft" : "direct",
              onChange: (event) => updateSetting("rewriteMode", event.target.value),
            },
              h("option", { value: "direct" }, t("rewriteDirect")),
              h("option", { value: "draft" }, t("rewriteDraft"))
            ),
            num("journalDays", t("sJournalDays"), 1, 90)
          ),
          toggle("mirror", t("sMirror"), t("sMirrorHint")),
          toggle("dedupe", t("sDedupe")),
          toggle("qualityGate", t("sQualityGate"), t("sQualityGateHint")),
          toggle("captureSubagents", t("sCaptureSub"), t("sCaptureSubHint"))
        ),
        h("div", { className: "dshmem_box" },
          toggle("autoCapture", t("sAuto"), t("sAutoHint")),
          h("div", { className: "dshmem_row" },
            h("span", { className: "dshmem_lbl" }, t("sCaptureMode")),
            h("select", {
              className: "dshmem_select",
              style: { width: "auto" },
              value: settings?.captureMode === "draft" ? "draft" : "direct",
              onChange: (event) => updateSetting("captureMode", event.target.value),
            },
              h("option", { value: "direct" }, t("captureDirect")),
              h("option", { value: "draft" }, t("captureDraft"))
            )
          ),
          h("div", { className: "dshmem_row" },
            num("autoCaptureMinChars", t("sAutoMin"), 0, 200000, 100),
            num("captureCooldownMs", t("sCooldown"), 0, 3600000, 1000)
          ),
          h("div", { className: "dshmem_row" },
            num("minConfidence", t("sMinConf"), 0, 1, 0.05),
            num("maxPerTurn", t("sMaxTurn"), 1, 20)
          ),
          h("div", { className: "dshmem_row" },
            num("maxTranscriptChars", t("sTranscript"), 500, 60000, 500),
            num("staleDays", t("sStaleDays"), 7, 365)
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

      /* ---------------- 维护页：体检 + 待审队列 + 标签清理 ---------------- */
      /* 时间线不再是独立 tab——它并进了记忆库的排布下拉（同一份内容的按日切法）。 */

      const healthBusyRun = (promise, message) => {
        setHealthBusy(true);
        setError("");
        promise
          .then(() => afterWrite(message))
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setHealthBusy(false);
          });
      };

      const health = healthData?.health || null;
      const healthStats = healthData?.stats || null;
      const briefing = state?.briefing || null;
      const runDream = () => {
        setDreamBusy(true);
        setError("");
        api
          .dream({ workspace: target })
          .then((payload) => {
            setDreamData(payload || null);
            afterWrite(t("dreamDone"));
          })
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setDreamBusy(false);
          });
      };
      const briefModeLabel = settings?.briefMode === "full" ? t("healthTokenFull") : t("healthTokenIndex");
      const estTokens = briefing?.chars ? Math.round(briefing.chars * 0.6) : null;

      const queueRecords = Array.isArray(queueData?.records) ? queueData.records : [];
      /* 注入审计：最近真正进 prompt 的内容。 */
      const injectionEntries = Array.isArray(injectionData?.entries) ? injectionData.entries : [];
      const injectionKindLabel = (kind) =>
        kind === "turn-recall"
          ? t("injectionKindTurnRecall")
          : kind === "path-recall"
            ? t("injectionKindPathRecall")
            : t("injectionKindBriefing");
      /* 派生链：每层派生了什么、源现在还成不成立。 */
      const derivationEntries = Array.isArray(derivationData?.entries) ? derivationData.entries : [];
      const derivationLayerLabel = (layer) =>
        layer === "agents" ? t("derivationLayerAgents") : t("derivationLayerPortrait");
      /* 复审队列：已到期在前。 */
      const reviewItems = [
        ...(Array.isArray(reviewData?.due) ? reviewData.due.map((r) => ({ ...r, due: true })) : []),
        ...(Array.isArray(reviewData?.soon) ? reviewData.soon.map((r) => ({ ...r, due: false })) : []),
      ];

      /* 标签清理候选：小写归并后同组出现多种原始写法的（如 DSH / dsh），目标取计数最多的写法。 */
      const tagVariants = (() => {
        const groups = new Map();
        for (const { tag, count } of tagList) {
          const key = String(tag).toLowerCase();
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ tag, count });
        }
        return [...groups.values()]
          .filter((variants) => new Set(variants.map((v) => v.tag)).size > 1)
          .map((variants) => {
            const sorted = [...variants].sort((a, b) => b.count - a.count);
            return {
              variants: sorted.map((v) => v.tag),
              target: sorted[0].tag,
            };
          });
      })();

      const tagCleanupBox = tagVariants.length
        ? h("div", { className: "dshmem_box" },
            h("div", { className: "dshmem_title" }, t("tagMergeTitle")),
            h("div", { className: "dshmem_hint" }, t("tagMergeHint")),
            tagVariants.map((group) =>
              h("div", { className: "dshmem_issue", key: group.target },
                h("div", { className: "dshmem_issueHead" },
                  h("span", { className: "dshmem_chip" }, group.variants.join(" / ")),
                  h("button", {
                    type: "button",
                    className: "dshmem_btn dshmem_btn_sm",
                    disabled: healthBusy,
                    onClick: () => {
                      setHealthBusy(true);
                      setError("");
                      api
                        .mergeTags({ workspace: target, from: group.variants, to: group.target })
                        .then((payload) => afterWrite(t("tagMerged").replace("{n}", String(payload.affected ?? 0))))
                        .catch((cause) => setError(String(cause?.message || cause)))
                        .finally(() => {
                          if (alive.current) setHealthBusy(false);
                        });
                    },
                  }, t("tagMergeDo").replace("{tag}", group.target))),
                h("div", { className: "dshmem_hint" },
                  t("tagMergeVariants").replace("{variants}", group.variants.join("、"))))))
        : null;

      const maintainTab = h("div", { className: "dshmem" },
        h("div", { className: "dshmem_hint" }, t("healthHint")),
        h("div", { className: "dshmem_kpis" },
          h("div", { className: "dshmem_kpi" },
            h("div", { className: "dshmem_kpiNum" },
              String(healthStats ? healthStats.total + healthStats.global : "—")),
            h("div", { className: "dshmem_kpiLbl" }, t("healthKpiTotal"))),
          h("div", { className: "dshmem_kpi" },
            h("div", { className: "dshmem_kpiNum" },
              healthStats && healthStats.total + healthStats.global
                ? `${Math.round((healthStats.utilization || 0) * 100)}%`
                : "—"),
            h("div", { className: "dshmem_kpiLbl" }, t("healthKpiUtil"))),
          h("div", { className: "dshmem_kpi" },
            h("div", { className: "dshmem_kpiNum" }, String(health?.drafts ?? 0)),
            h("div", { className: "dshmem_kpiLbl" }, t("healthKpiDrafts"))),
          h("div", { className: "dshmem_kpi" },
            h("div", { className: "dshmem_kpiNum" }, briefing?.chars ? String(briefing.chars) : "—"),
            h("div", { className: "dshmem_kpiLbl" }, t("healthToken")),
            h("div", { className: "dshmem_hint" }, briefModeLabel),
            briefing?.chars
              ? h("div", { className: "dshmem_hint" }, t("healthTokenEst").replace("{tokens}", String(estTokens ?? "—")))
              : h("div", { className: "dshmem_hint" }, t("healthTokenNone")),
            briefing?.pathTail?.count
              ? h("div", { className: "dshmem_hint" },
                  t("pathTailHint")
                    .replace("{n}", String(briefing.pathTail.count))
                    .replace("{tokens}", String(Math.round((briefing.pathTail.chars || 0) * 0.6))))
              : null)),
        /* Dream：一键半自动整理（合并重复簇 / 报告过期 / 画像重写进待审）。 */
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("dreamTitle")),
          h("div", { className: "dshmem_hint" }, t("dreamHint")),
          h("div", { className: "dshmem_row" },
            h("button", {
              type: "button",
              className: "dshmem_btn dshmem_btn_sm dshmem_btn_primary",
              disabled: dreamBusy,
              onClick: runDream,
            }, dreamBusy ? t("dreamRunning") : t("dreamRun")),
            dreamData
              ? h("span", { className: "dshmem_hint" },
                  t("dreamSummary")
                    .replace("{merged}", String((dreamData.merged || []).length))
                    .replace("{stale}", String(dreamData.staleReported ?? 0))
                    .replace("{unused}", String(dreamData.exposedUnusedReported ?? 0))
                    .replace(
                      "{portrait}",
                      dreamData.portrait === "drafted"
                        ? t("dreamPortraitDrafted")
                        : dreamData.portrait === "saved"
                          ? t("dreamPortraitSaved")
                          : t("dreamPortraitNone"),
                    ))
              : null),
          dreamData?.merged?.length
            ? h("div", { className: "dshmem_docFlat" },
                dreamData.merged.map((item) =>
                  h("div", { key: item.into, className: "dshmem_hint" },
                    t("dreamMergedLine")
                      .replace("{count}", String(item.count))
                      .replace("{title}", item.title || "—"))))
            : null,
          dreamData?.errors?.length
            ? h("div", { className: "dshmem_hint" }, t("dreamErrors").replace("{n}", String(dreamData.errors.length)))
            : null),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("healthProblems")),
          !health
            ? h(Spin)
            : health.duplicates.length || health.stale.length || (health.exposedButUnused || []).length || health.broken.length
              ? h("div", { className: "dshmem_health" },
                  health.duplicates.map((cluster, index) =>
                    h("div", { className: "dshmem_issue", key: `dup-${index}` },
                      h("div", { className: "dshmem_issueHead" },
                        h("span", { className: "dshmem_chip dshmem_chip_on" }, t("healthDuplicates")),
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm",
                          disabled: healthBusy,
                          onClick: () =>
                            healthBusyRun(
                              api.healthResolve({
                                workspace: target,
                                action: "merge",
                                ids: cluster.map((item) => item.id),
                              }),
                              t("saved"),
                            ),
                        }, t("healthMerge"))),
                      h("div", { className: "dshmem_issueBody" }, cluster.map((item) => item.title).join(" ｜ ")),
                      h("div", { className: "dshmem_hint" }, t("healthDuplicatesHint")))),
                  health.stale.length
                    ? h("div", { className: "dshmem_issue" },
                        h("div", { className: "dshmem_issueHead" },
                          h("span", { className: "dshmem_chip" }, `${t("healthStale")} ${health.stale.length}`),
                          h("button", {
                            type: "button",
                            className: "dshmem_btn dshmem_btn_sm",
                            disabled: healthBusy,
                            onClick: () =>
                              healthBusyRun(
                                api.healthResolve({
                                  workspace: target,
                                  action: "archive",
                                  ids: health.stale.map((item) => item.id),
                                }),
                                t("saved"),
                              ),
                          }, t("healthArchiveAll"))),
                        h("div", { className: "dshmem_issueBody" }, health.stale.map((item) => item.title).join(" ｜ ")),
                        h("div", { className: "dshmem_hint" }, t("healthStaleHint").replace("{days}", String(health.staleDays ?? 60))))
                    : null,
                  (health.exposedButUnused || []).length
                    ? h("div", { className: "dshmem_issue" },
                        h("div", { className: "dshmem_issueHead" },
                          h("span", { className: "dshmem_chip" }, `${t("healthExposedUnused")} ${health.exposedButUnused.length}`)),
                        h("div", { className: "dshmem_issueBody" },
                          health.exposedButUnused
                            .map((item) => `${item.title} ×${item.exposedCount}`)
                            .join(" ｜ ")),
                        h("div", { className: "dshmem_hint" }, t("healthExposedUnusedHint")))
                    : null,
                  health.broken.map((link, index) =>
                    h("div", { className: "dshmem_issue", key: `brk-${index}` },
                      h("div", { className: "dshmem_issueHead" },
                        h("span", { className: "dshmem_chip" }, t("healthBroken")),
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm",
                          disabled: healthBusy,
                          onClick: () =>
                            healthBusyRun(
                              api.healthResolve({ workspace: target, action: "unlink", id: link.id, target: link.target }),
                              t("saved"),
                            ),
                        }, t("healthUnlink"))),
                      h("div", { className: "dshmem_issueBody" }, `${link.field} → ${link.target}`))))
              : h("div", { className: "dshmem_hint" }, t("healthNone"))),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("injectionTitle")),
          h("div", { className: "dshmem_hint" }, t("injectionHint")),
          !injectionData
            ? h(Spin)
            : injectionEntries.length
              ? h("div", { className: "dshmem_health" },
                  injectionEntries.map((entry) =>
                    h("div", { className: "dshmem_issue", key: `${entry.kind}-${entry.at}-${entry.hash}` },
                      h("div", { className: "dshmem_issueHead" },
                        h("span", { className: "dshmem_chip" }, injectionKindLabel(entry.kind)),
                        h("span", { className: "dshmem_hint" },
                          `${entry.chars} 字 ｜ ${(entry.ids || []).length} 条 ｜ #${String(entry.hash || "").slice(0, 8)}${
                            (entry.dropped || []).length
                              ? ` ｜ ${t("injectionDropped").replace("{n}", String(entry.dropped.length))}`
                              : ""
                          }`)),
                      entry.preview
                        ? h("div", { className: "dshmem_issueBody" }, entry.preview)
                        : null)))
              : h("div", { className: "dshmem_hint" }, t("injectionNone"))),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("derivationTitle")),
          h("div", { className: "dshmem_hint" }, t("derivationHint")),
          !derivationData
            ? h(Spin)
            : derivationEntries.length
              ? h("div", { className: "dshmem_health" },
                  derivationEntries.map((entry) =>
                    h("div", { className: "dshmem_issue", key: entry.id },
                      h("div", { className: "dshmem_issueHead" },
                        h("span", { className: "dshmem_chip" }, derivationLayerLabel(entry.layer)),
                        h("span", { className: "dshmem_hint" }, entry.target)),
                      h("div", { className: "dshmem_issueBody" },
                        `${entry.state === "dirty" ? t("derivationDirty") : t("derivationFresh")}${
                          entry.reason ? `：${entry.reason}` : ""
                        }${
                          (entry.sources || []).length
                            ? ` ｜ ${t("derivationSources")}：${entry.sources.map((s) => s.id).join("、")}`
                            : ""
                        }`))))
              : h("div", { className: "dshmem_hint" }, t("derivationNone"))),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("reviewTitle")),
          h("div", { className: "dshmem_hint" }, t("reviewHint")),
          !reviewData
            ? h(Spin)
            : reviewItems.length
              ? h("div", { className: "dshmem_health" },
                  reviewItems.map((item) =>
                    h("div", { className: "dshmem_issue", key: item.id },
                      h("div", { className: "dshmem_issueHead" },
                        h("span", { className: "dshmem_chip" }, item.due ? t("reviewDue") : t("reviewSoon")),
                        h("span", { className: "dshmem_hint" }, String(item.reviewAt || "").slice(0, 10))),
                      h("div", { className: "dshmem_issueBody" },
                        `${item.title || t("untitled")} ｜ ${t("reviewFalsifier")}：${item.falsifier || "—"}`),
                      h("div", { className: "dshmem_acts" },
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm dshmem_btn_primary",
                          disabled: busy,
                          onClick: () => run(api.review({ workspace: target, id: item.id }), t("reviewDone")),
                        }, t("reviewDone"))))))
              : h("div", { className: "dshmem_hint" }, t("reviewNone"))),
        h("div", { className: "dshmem_box" },
          h("div", { className: "dshmem_title" }, t("queueTitle")),
          h("div", { className: "dshmem_hint" }, t("queueHint")),
          !queueData
            ? h(Spin)
            : queueRecords.length
              ? h("div", { className: "dshmem_list" },
                  queueRecords.map((record) =>
                    h("div", { className: "dshmem_card dshmem_draftCard", key: record.id },
                      h("div", { className: "dshmem_main" },
                        h("div", { className: "dshmem_title" }, record.title || t("untitled")),
                        h("div", { className: "dshmem_body" }, record.content),
                        h("div", { className: "dshmem_meta" },
                          h("span", { className: "dshmem_chip dshmem_chip_on" }, t("draftChip")),
                          h("span", { className: "dshmem_chip" }, catLabel(record.category)),
                          (record.tags || []).map((tag) => h("span", { key: tag, className: "dshmem_tag" }, `#${tag}`)),
                          typeof record.confidence === "number" ? h("span", null, record.confidence.toFixed(2)) : null,
                          record.supersedes ? h("span", { className: "dshmem_chain" }, t("queueSupersedes")) : null,
                          h("span", null, when(record.updatedAt)))),
                      h("div", { className: "dshmem_acts" },
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm dshmem_btn_primary",
                          disabled: busy,
                          onClick: () => run(api.approve({ workspace: target, id: record.id }), t("queueApproved")),
                        }, t("queueApprove")),
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm",
                          disabled: busy,
                          onClick: () => {
                            setMergeIds(null);
                            setQueueEdit(record);
                            setDraft(record);
                          },
                        }, t("queueEditApprove")),
                        h("button", {
                          type: "button",
                          className: "dshmem_btn dshmem_btn_sm dshmem_btn_danger",
                          disabled: busy,
                          onClick: () => {
                            if (typeof window !== "undefined" && !window.confirm(t("confirmReject"))) return;
                            run(api.reject({ workspace: target, id: record.id }), t("queueRejected"));
                          },
                        }, t("queueReject"))))))
              : h("div", { className: "dshmem_empty" }, t("queueEmpty"))),
        /* 标签清理：写法不同、意思相同的标签（大小写漂移）一键归并。 */
        tagCleanupBox,
        renderCaptures()
      );

      /* 跨 tab 共享：编辑器（新建/编辑/整合/推翻/审批编辑共用）与提示条。
         时间线与审批页里点条目也要能编辑，所以编辑器不属于任何一个 tab。 */
      /* 程序记忆晋升：编辑已有 convention/decision/preference/feedback 时可一键进 AGENTS.md。 */
      const PROMOTABLE = new Set(["convention", "decision", "preference", "feedback"]);
      const promoteNow = () => {
        if (!draft?.id) return;
        setBusy(true);
        setError("");
        api
          .promote({ workspace: target, id: draft.id })
          .then((payload) => flash(t("promoted").replace("{file}", payload?.file ?? "AGENTS.md")))
          .catch((cause) => setError(String(cause?.message || cause)))
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      };

      const sharedBlocks = h("div", { className: "dshmem" },
        draft && mergeIds ? h("div", { className: "dshmem_hint" }, t("consolidateHint")) : null,
        draft && draft.id && PROMOTABLE.has(draft.category) && draft.scope !== "global"
          ? h("div", { className: "dshmem_row" },
              h("button", {
                type: "button",
                className: "dshmem_btn dshmem_btn_sm",
                disabled: busy,
                onClick: promoteNow,
              }, t("promoteBtn")),
              h("span", { className: "dshmem_hint" }, t("promoteHint")))
          : null,
        draft
          ? h(Editor, {
              key: draft.id || draft.supersedes || "new",
              t,
              lang,
              categories,
              draft,
              busy,
              onCancel: closeEditor,
              onSubmit: submitDraft,
            })
          : null,
        error ? h("div", { className: "dshmem_err" }, error) : null,
        notice ? h("div", { className: "dshmem_ok" }, notice) : null);

      const draftCount = Number(state?.stats?.drafts) || 0;
      const tabs = [
        ["memories", t("tabMemories")],
        ["maintain", `${t("tabMaintain")}${draftCount ? ` ${draftCount}` : ""}`],
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
          : h("div", { className: "dshmem", style: { gap: 12 } },
              sharedBlocks,
              tab === "memories"
                ? memoriesTab
                : tab === "maintain"
                  ? maintainTab
                  : tab === "capture"
                    ? captureTab
                    : settingsTab)
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
