/**
 * Send verdict and missing-id rules (Rust `sync::send_verdict`), re-exported from index.ts.
 */
import {
  classifySend as rawClassifySend,
  missingIds as rawMissingIds,
} from "../pkg/wf_wasm.js";

export {
  isLinkInsert,
} from "../pkg/wf_wasm.js";

/** What one PostgREST write means for the outbox entry. */
export type SendVerdict =
  | "awaiting_parent"
  | "conflict"
  | "offline"
  | "rls_refused"
  | "refused"
  | "guard_missed"
  | "accepted";

/**
 * The verdict for one write. `errorCode` is the Postgres code from the body, or null.
 * `rows` is how many rows a guarded write returned, or null when the body was not an array.
 */
export function classifySend(status: number, errorCode: string | null, rows: number | null): SendVerdict {
  return rawClassifySend(status, errorCode, rows) as SendVerdict;
}

/** The ids in `chunk` the server did not return and has no tombstone for. */
export function missingIds(
  chunk: readonly string[],
  held: readonly string[],
  tombstoned: readonly string[],
): string[] {
  return rawMissingIds(chunk, held, tombstoned) as string[];
}
