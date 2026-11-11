/** Types for line-reconstruction. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PageTextItem } from "./analysis-types.js";

/** One reconstructed line, with offsets into its page's text. */
export interface TextLine {
  page: number;
  /** Left edge and baseline of the first run, PDF user space. */
  x: number;
  y: number;
  /** Right edge of the last run. */
  right: number;
  text: string;
  /** Largest run on the line — headings stand out by size. */
  fontSize: number;
  /** Any run set in a bold/Black/Heavy face. */
  bold: boolean;
  /** Offsets into the page text, `end` exclusive of a trailing newline. */
  start: number;
  end: number;
}

/** Fraction of each page's text extent, on every side, treated as margin. */
export const FURNITURE_MARGIN = 0.06;

interface Run {
  item: PageTextItem;
  start: number;
  end: number;
  fontSize: number;
  x: number;
  y: number;
  right: number;
}

interface Joined {
  text: string;
  x: number;
  y: number;
  right: number;
  fontSize: number;
  bold: boolean;
  start: number;
  end: number;
  /** Baseline spread of the joined runs — a fused pair of lines shows here. */
  spread: number;
}

