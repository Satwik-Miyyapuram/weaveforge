/**
 * Lab member row mapping (Rust `member_rows`). The row shape stays in the web app, next to the
 * queries that select it.
 */
import { memberRowToDomain as rawMemberRowToDomain } from "../pkg/wf_wasm.js";
import type { Member, ProfileRow } from "./bindings.js";
import type { Role } from "@weaveforge/core";

export type { Member, ProfileRow } from "./bindings.js";

/** A `profiles` row as a lab member. Rust hands the role back as a plain string; the cast to the domain role is made here, once. */
export function memberRowToDomain(row: ProfileRow): Member {
  const raw = rawMemberRowToDomain(row) as Omit<Member, "role"> & { role: string };
  return { ...raw, role: raw.role as Role };
}
