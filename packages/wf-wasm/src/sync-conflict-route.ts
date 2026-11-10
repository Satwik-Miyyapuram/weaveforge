/**
 * Conflict routing for the outbox pump (Rust `sync::conflict_route`), re-exported from
 * index.ts. Picks the step for an op the server refused as stale. The shapes come from
 * bindings.ts, generated from the Rust types. The op verb is the Rust `OutboxOp`
 * (serialized as "insert" | "update" | "delete").
 */
import type {
  ConflictInput,
  ConflictRoute,
} from "./bindings.js";

export {
  conflictRoute,
} from "../pkg/wf_wasm.js";

export type { ConflictInput, ConflictRoute } from "./bindings.js";

