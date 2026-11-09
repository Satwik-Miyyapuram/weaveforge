/** Types for prisma-figure. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PrismaCounts } from "../../reading-lists/domain/screening.js";

export interface PrismaFigureOptions {
  /** `\label{...}`, so the prose can `\ref` it. */
  label?: string;
  caption?: string;
  /** Exclusion reasons, as `exclusionReasons` returns them. */
  reasons?: readonly { reason: string; count: number }[];
  /** The database or register the records came from, if it is worth naming. */
  source?: string;
}

/** The packages the figure needs, for a preamble that does not have them yet. */
export const PRISMA_FIGURE_PACKAGES: readonly string[] = ["tikz", "float"];

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PrismaFigureFns {
  /**
 * The figure, as a string to write beside the report's other sources.
 *
 * Returned rather than written: the caller decides whether it becomes a file in
 * an Overleaf export, a block in the editor, or something to show and discard.
 */
  prismaFigureTex(counts: PrismaCounts, options?: PrismaFigureOptions): string;
  /**
 * What is not yet settled, in a sentence, or null when everything is.
 *
 * Shown next to the figure rather than folded into it. A diagram whose boxes
 * quietly omit forty undecided papers is worse than no diagram: it reads as
 * finished, and the reader has no way to tell that it is not.
 */
  prismaCaveat(counts: PrismaCounts): string | null;
}
