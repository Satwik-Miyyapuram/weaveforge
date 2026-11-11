/** Types for prisma-figure. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

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

