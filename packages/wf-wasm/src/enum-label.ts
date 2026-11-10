/**
 * Human labels for enum values (Rust `enum_label`), re-exported from index.ts.
 */
import type {
  EnumOption,
} from "./bindings.js";

export {
  enumLabel,
  enumOptions,
  humanise,
  incomingRelationLabel,
} from "../pkg/wf_wasm.js";

export type { EnumOption } from "./bindings.js";

/** The enum kinds that have fixed labels. */
/** Narrowing: pure TS literal union, no Rust enum counterpart. */
export type EnumKind = "paperStatus" | "milestoneStatus" | "experimentStatus" | "relation" | "dependency" | "shareAccess";

