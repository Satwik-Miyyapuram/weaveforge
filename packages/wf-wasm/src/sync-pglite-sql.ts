/**
 * SQL-text helpers for the local PGlite client (Rust `sync::pglite_sql`), re-exported from index.ts.
 */
import {
  ident as rawIdent,
  isLiteral as rawIsLiteral,
  pgArray as rawPgArray,
  projection as rawProjection,
  splitTopLevel as rawSplitTopLevel,
} from "../pkg/wf_wasm.js";

/** A Postgres array literal; each value is spelled as `String(value)` first. */
export function pgArray(values: readonly unknown[]): string {
  return rawPgArray(values.map((value) => String(value)));
}

/** A trimmed, double-quoted column name. Throws for a name the local database will not accept. */
export function ident(name: string): string {
  return rawIdent(name);
}

/** The operand of `is`: only `null`, `true` or `false` pass. Throws otherwise. */
export function isLiteral(text: string): "null" | "true" | "false" {
  return rawIsLiteral(text) as "null" | "true" | "false";
}

/** A `select` column list, each name quoted. Throws for a name `ident` refuses. */
export function projection(columns: string): string {
  return rawProjection(columns);
}

/** Top-level comma-separated pieces of a PostgREST expression, trimmed and non-empty. */
export function splitTopLevel(expression: string): string[] {
  return rawSplitTopLevel(expression) as string[];
}
