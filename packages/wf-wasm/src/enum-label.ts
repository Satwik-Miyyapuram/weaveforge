/**
 * Human labels for enum values (Rust `enum_label`), re-exported from index.ts.
 */
import {
  enumLabel as rawEnumLabel,
  enumOptions as rawEnumOptions,
  humanise as rawHumanise,
  incomingRelationLabel as rawIncomingRelationLabel,
} from "../pkg/wf_wasm.js";
import type { EnumOption } from "./bindings.js";

export type { EnumOption } from "./bindings.js";

/** The enum kinds that have fixed labels. */
/** Narrowing: pure TS literal union, no Rust enum counterpart. */
export type EnumKind = "paperStatus" | "milestoneStatus" | "experimentStatus" | "relation" | "dependency" | "shareAccess";

/** `made_up_kind` reads `Made up kind`. */
export function humanise(value: string): string {
  return rawHumanise(value);
}

/** The label for `value` under `kind`, humanised when the value has no entry. */
export function enumLabel(kind: EnumKind, value: string): string {
  return rawEnumLabel(kind, value);
}

/** Every value of `kind` with its label, in the fixed order. */
export function enumOptions(kind: EnumKind): EnumOption[] {
  return rawEnumOptions(kind) as EnumOption[];
}

/** How an incoming relation reads from the other paper's side (e.g. `cites` reads `Cited by`). */
export function incomingRelationLabel(value: string): string {
  return rawIncomingRelationLabel(value);
}
