/**
 * Open-access and WebDAV PDF ladder trim rules (Rust `reader::pdf_resolver_rules`),
 * re-exported from index.ts. Fetch and URL building stay in TS.
 */
export {
  openAccessSupports,
  trimmedOrNone,
  webdavSupports,
} from "../pkg/wf_wasm.js";
