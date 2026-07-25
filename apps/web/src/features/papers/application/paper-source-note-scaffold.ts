/**
 * Light ZotFlow-style scaffold inserted when a paper note is first created.
 * Headings only — no AI-generated prose.
 */
export function paperSourceNoteScaffold(input: {
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  citeKey?: string;
}): string {
  const meta = [
    input.authors?.length ? `- Authors: ${input.authors.join(", ")}` : null,
    input.year != null ? `- Year: ${input.year}` : null,
    input.venue ? `- Venue: ${input.venue}` : null,
    input.doi ? `- DOI: ${input.doi}` : null,
    input.citeKey ? `- Cite key: ${input.citeKey}` : null,
  ].filter(Boolean);

  return [
    "## Summary",
    "",
    "",
    "## Key points",
    "",
    "- ",
    "",
    "## Metadata",
    "",
    ...(meta.length ? meta : ["- "]),
    "",
  ].join("\n");
}
