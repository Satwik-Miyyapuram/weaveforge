/**
 * Which account entries the sidebar and overflow menu show (Rust `account_links`),
 * re-exported from index.ts.
 */
import type {
  AccountLink,
  AccountLinksInput,
} from "./bindings.js";

export {
  accountLinks,
} from "../pkg/wf_wasm.js";

export type { AccountLink, AccountLinkId, AccountLinksInput } from "./bindings.js";

