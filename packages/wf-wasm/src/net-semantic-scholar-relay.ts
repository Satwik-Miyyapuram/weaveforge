/**
 * Semantic Scholar relay target (Rust `net::semantic_scholar_relay`), re-exported from index.ts.
 * Keeps the signature of apps/web/src/lib/semantic-scholar-relay.ts.
 */
import { semanticScholarTarget as rawSemanticScholarTarget } from "../pkg/wf_wasm.js";

/** The upstream address for a relay path, or `null` when the path is not one. */
export function semanticScholarTarget(pathname: string, search: string): string | null {
  return rawSemanticScholarTarget(pathname, search) ?? null;
}
