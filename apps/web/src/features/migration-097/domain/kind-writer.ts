import type { Row } from "./ports";

/**
 * Async per-kind writer over the FILES repos. Replaces the sync FileCodec path
 * for the kinds it covers: `write` saves one PostgREST row through the repo's
 * own save(), and `readBack` lists the kind's rows again as PostgREST-shaped
 * rows so the verify gate can compare them field by field.
 */
export interface KindWriter {
  /** Kinds this writer owns. */
  readonly kinds: readonly string[];
  write(kind: string, row: Row): Promise<void>;
  readBack(kind: string): Promise<Row[]>;
}
