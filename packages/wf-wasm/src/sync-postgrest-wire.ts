/**
 * PostgREST wire rules for the sync transport (Rust `sync::postgrest_wire`): which columns a
 * write may name, and what an error body says. The HTTP and retries stay in the web app.
 */
import {
  postgrestErrorInfo as rawPostgrestErrorInfo,
  postgrestWritable as rawPostgrestWritable,
} from "../pkg/wf_wasm.js";
import type { ErrorInfo } from "./bindings.js";

export type { ErrorInfo } from "./bindings.js";

/** The payload minus the table's generated columns. A missing payload is empty. */
export function postgrestWritable(
  table: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  return rawPostgrestWritable(table, payload) as Record<string, unknown>;
}

/** An error body's Postgres `code` (when JSON) and the reason to keep. */
export function postgrestErrorInfo(body: string): ErrorInfo {
  return rawPostgrestErrorInfo(body) as ErrorInfo;
}