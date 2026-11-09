/** Types for locus-link. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PdfLocus } from "./pdf-locus.js";

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface LocusLinkFns {
  /** Serialise a locus into a query-param value (raw JSON; encode at the URL layer). */
  encodeLocus(locus: PdfLocus): string;
  /** Parse a locus param back into a `PdfLocus`, or null when malformed. */
  decodeLocus(raw: string | null | undefined): PdfLocus | null;
}
