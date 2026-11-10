/**
 * Which account entries the sidebar and overflow menu show (Rust `account_links`),
 * re-exported from index.ts.
 */
import { accountLinks as rawAccountLinks } from "../pkg/wf_wasm.js";
import type { AccountLink, AccountLinksInput } from "./bindings.js";

export type { AccountLink, AccountLinkId, AccountLinksInput } from "./bindings.js";

/** The account block's rows, in display order. */
export function accountLinks(input: AccountLinksInput): AccountLink[] {
  return rawAccountLinks(input) as AccountLink[];
}
