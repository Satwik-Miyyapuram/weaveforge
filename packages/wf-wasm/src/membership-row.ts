/**
 * Org membership row mapping (Rust `membership_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
import { membershipViewFromRow as rawMembershipViewFromRow } from "../pkg/wf_wasm.js";
import type { MembershipRow, OrgMembershipView } from "./bindings.js";
import type { OrgInviteRole } from "@weaveforge/core";

export type { MembershipRow, OrgMembershipView } from "./bindings.js";

/** A membership row as the membership view the app models. Rust hands the role back as a plain string; the cast to the invite role is made here, once. */
export function membershipViewFromRow(row: MembershipRow): OrgMembershipView {
  const raw = rawMembershipViewFromRow(row) as Omit<OrgMembershipView, "role"> & { role: string };
  return { ...raw, role: raw.role as OrgInviteRole };
}
