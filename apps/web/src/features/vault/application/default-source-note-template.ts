/**
 * Default source-note template (Phase C1 / P0).
 *
 * Generated regions refresh on explicit re-render; editable regions and any
 * unmarked text the researcher adds are preserved by `applyTemplate`.
 *
 * The region markers are spelled out here (the same text `wrapRegion` in
 * wf-core `vault::template` produces), because a module-scope constant cannot
 * call the wasm core, which loads asynchronously.
 */
export const DEFAULT_SOURCE_NOTE_TEMPLATE = [
  "<!-- wf:generated:metadata -->" +
    "# {{title}}\n\n- Authors: {{authors}}\n- Year: {{year}}\n- Venue: {{venue}}\n- DOI: {{doi}}\n- Cite key: {{citeKey}}\n" +
    "<!-- /wf:generated:metadata -->",
  "## Summary",
  "",
  "<!-- wf:editable:summary -->\nWrite a short summary.\n<!-- /wf:editable:summary -->",
  "## Key points",
  "",
  "<!-- wf:editable:key-points -->\n- \n<!-- /wf:editable:key-points -->",
  "## Notes",
  "",
  "<!-- wf:editable:notes -->\nYour notes stay here across re-renders.\n<!-- /wf:editable:notes -->",
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
