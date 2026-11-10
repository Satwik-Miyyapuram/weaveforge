/**
 * SQL-text helpers for the local PGlite client (Rust `sync::pglite_sql`), re-exported from index.ts.
 */
import {
  ident as rawIdent,
  pgArray as rawPgArray,
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

/** A trimmed, double-quoted column name. Throws for a name the local database will not accept. */
export function ident(name: string): string {
  return rawIdent(name);
}

