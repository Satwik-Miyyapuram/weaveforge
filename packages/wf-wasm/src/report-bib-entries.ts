/**
 * Bib entry parsing (Rust `report::bib_entries`), re-exported from index.ts. Keeps the signature of
 * packages/core/src/features/report/domain/bib-entries.ts. Rust sends each entry's fields as an
 * ordered `{ name, value }` list; this wrapper rebuilds the `fields` record in that order.
 */
import { parseBibEntries as rawParseBibEntries } from "../pkg/wf_wasm.js";
import type { BibEntry, BibParseResult, BibWarning, LatexSourceFile } from "./bindings.js";

/**
 * Parses every `.bib` among `files`; non-`.bib` files are ignored. Bad entries become warnings.
 * Each entry's `fields` is a record in source order.
 */
export function parseBibEntries(files: readonly LatexSourceFile[]): {
  entries: (Omit<BibEntry, "fields"> & { fields: Record<string, string> })[];
  warnings: BibWarning[];
} {
  const raw = rawParseBibEntries(files) as BibParseResult;
  return {
    entries: raw.entries.map((entry) => ({
      type: entry.type,
      key: entry.key,
      fields: Object.fromEntries(entry.fields.map((field) => [field.name, field.value])),
      file: entry.file,
      line: entry.line,
    })),
    warnings: raw.warnings,
  };
}
