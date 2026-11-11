/** Types for decode. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** One word as the engine read it: readings best-first, and the dictionary's verdict on each. */
export interface InkWordReadings {
  candidates: readonly string[];
  /** Parallel to `candidates`; absent or null when the machine had no dictionary for the language. */
  known?: readonly boolean[] | null;
  /** This word and the next read as one, when the dictionary knows the joined reading. */
  join?: string | null;
}

/**
 * The most an engine's line may score. `1` is reserved: it marks a line a
 * person corrected, which `recognisePage` keeps through the next run rather
 * than recognising again, so an engine that reported `1` would freeze its own
 * guesses.
 */
export const INK_ENGINE_MAX_CONFIDENCE = 0.95;

/** How much each unsure word costs a line, as a share of its words. */
const UNSURE_PENALTY = 0.5;

/** Line alternatives offered for correction. */
const MAX_LINE_ALTERNATIVES = 4;

interface Chosen {
  text: string;
  sure: boolean;
  /** The engine's own pick was a non-word, even if another reading was kept. */
  doubted?: boolean;
  /** The other readings worth offering, best first. */
  others: string[];
}

