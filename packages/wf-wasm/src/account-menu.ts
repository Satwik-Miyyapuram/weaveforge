/**
 * Sidebar Inbox links and account-menu attention (Rust `account_menu`),
 * re-exported from index.ts.
 */
import { accountAttention as rawAccountAttention, inboxLinks as rawInboxLinks } from "../pkg/wf_wasm.js";
import type { AccountAttention, AccountAttentionInput, InboxInput, InboxLink } from "./bindings.js";

export type { AccountAttention, AccountAttentionInput, InboxInput, InboxLink } from "./bindings.js";

/** The Inbox rows for this person: AI suggestions, then shared, then supervision. */
export function inboxLinks(input: InboxInput): InboxLink[] {
  return rawInboxLinks(input) as InboxLink[];
}

/** The menu rows and the icon total for the account icon. */
export function accountAttention(input: AccountAttentionInput): AccountAttention {
  return rawAccountAttention(input) as AccountAttention;
}
