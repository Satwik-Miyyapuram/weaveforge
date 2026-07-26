import { wrapRegion } from "./note-template-engine";

/**
 * Default source-note template (Phase C1 / P0).
 *
 * Generated regions refresh on explicit re-render; editable regions and any
 * unmarked text the researcher adds are preserved by {@link applyTemplate}.
 */
export const DEFAULT_SOURCE_NOTE_TEMPLATE = [
  "# {{title}}",
  "",
  wrapRegion(
    "generated",
    "metadata",
    [
      "- Authors: {{authors}}",
      "- Year: {{year}}",
      "- Venue: {{venue}}",
      "- DOI: {{doi}}",
      "- Cite key: {{citeKey}}",
      "",
    ].join("\n"),
  ),
  "## Summary",
  "",
  wrapRegion("editable", "summary", ["", "Write a short summary.", ""].join("\n")),
  "## Key points",
  "",
  wrapRegion("editable", "key-points", ["", "- ", ""].join("\n")),
  "## Notes",
  "",
  wrapRegion("editable", "notes", ["", "Your notes stay here across re-renders.", ""].join("\n")),
  "",
].join("\n");

/** Context shape expected by {@link DEFAULT_SOURCE_NOTE_TEMPLATE}. */
export function sourceNoteTemplateContext(input: {
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  citeKey?: string;
}): Record<string, unknown> {
  return {
    title: input.title,
    authors: input.authors?.length ? input.authors.join(", ") : "",
    year: input.year ?? "",
    venue: input.venue ?? "",
    doi: input.doi ?? "",
    citeKey: input.citeKey ?? "",
  };
}
