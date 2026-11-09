/**
 * Postgres identifier quoting (Rust `sync::sql_ident`), re-exported from index.ts.
 */
import { quoteIdent as rawQuoteIdent } from "../pkg/wf_wasm.js";

/** A Postgres identifier in double quotes, any embedded quote doubled. */
export function quoteIdent(name: string): string {
  return rawQuoteIdent(name);
}
