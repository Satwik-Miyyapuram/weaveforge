/**
 * Reference popover notices (Rust `reader_reference_notice`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/reference-notice.ts.
 */
import type {
  ReferenceNotice,
} from "./bindings.js";

export {
  addedNotice,
  noticeFor,
} from "../pkg/wf_wasm.js";

export type { ReferenceNotice } from "./bindings.js";

