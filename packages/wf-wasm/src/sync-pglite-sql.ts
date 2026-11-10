/**
 * SQL-text helpers for the local PGlite client (Rust `sync::pglite_sql`), re-exported from index.ts.
 */
import {
  pgArray as rawPgArray,
} from "../pkg/wf_wasm.js";

export {
  ident,
} from "../pkg/wf_wasm.js";

export {
  isLiteral,
  projection,
  splitTopLevel,
} from "../pkg/wf_wasm.js";

/** A Postgres array literal; each value is spelled as `String(value)` first. */
export function pgArray(values: readonly unknown[]): string {
  return rawPgArray(values.map((value) => String(value)));
}

