/**
 * Conflict routing for the outbox pump (Rust `sync::conflict_route`), re-exported from
 * index.ts. Picks the step for an op the server refused as stale. The shapes come from
 * bindings.ts, generated from the Rust types. The op verb is the Rust `OutboxOp`
 * (serialized as "insert" | "update" | "delete").
 */
import { conflictRoute as rawConflictRoute } from "../pkg/wf_wasm.js";
import type { ConflictInput, ConflictRoute } from "./bindings.js";

export type { ConflictInput, ConflictRoute } from "./bindings.js";

/** The route for an op the server refused as stale. */
export function conflictRoute(input: ConflictInput): ConflictRoute {
  return rawConflictRoute(input) as ConflictRoute;
}
