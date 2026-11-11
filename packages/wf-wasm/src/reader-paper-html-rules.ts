/**
 * Paper HTML relay rules (Rust `reader_paper_html_rules`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/paper-html-rules.ts. Byte decoding and the
 * relay Response stay in TS.
 */
export { declaredCharset, isHtmlContentType } from "../pkg/wf_wasm.js";