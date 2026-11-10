/**
 * Deep-link locus (de)serialisation for jump-to-source (Rust `crates/wf-core/src/reader/locus.rs`),
 * backed by Rust. Re-exported from index.ts.
 */
import { encodeLocus as rawEncodeLocus, decodeLocus as rawDecodeLocus } from "../pkg/wf_wasm.js";
import type { AnchorPdfLocus } from "./bindings.js";

/** Serialise a locus into a query-param value (raw JSON; encode at the URL layer) (Rust `encode_locus`). */
export function encodeLocus(locus: AnchorPdfLocus): string {
  return rawEncodeLocus(locus);
}

/** Parse a locus param back into a locus, or `null` when malformed (Rust `decode_locus`). */
export function decodeLocus(raw: string | null | undefined): AnchorPdfLocus | null {
  return rawDecodeLocus(raw ?? undefined) as AnchorPdfLocus | null;
}
