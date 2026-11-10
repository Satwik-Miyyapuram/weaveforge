/**
 * Sidebar Inbox links and account-menu attention (Rust `account_menu`),
 * re-exported from index.ts.
 */
import type {
  AccountAttention,
  AccountAttentionInput,
  InboxInput,
  InboxLink,
} from "./bindings.js";

export {
  accountAttention,
  inboxLinks,
} from "../pkg/wf_wasm.js";

export type { AccountAttention, AccountAttentionInput, InboxInput, InboxLink } from "./bindings.js";

