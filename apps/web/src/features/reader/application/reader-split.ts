export type ReaderSplitPane = "report" | "vault" | null;

export function parseReaderSplitPane(raw: string | null): ReaderSplitPane {
  if (raw === "report" || raw === "vault") return raw;
  return null;
}

export function buildReaderSplitHref(input: {
  paperId?: string | null;
  pdf?: string | null;
  pane: Exclude<ReaderSplitPane, null>;
  sectionId?: string | null;
  noteId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.paperId) params.set("paper", input.paperId);
  if (input.pdf) params.set("pdf", input.pdf);
  params.set("pane", input.pane);
  if (input.pane === "report" && input.sectionId) params.set("section", input.sectionId);
  if (input.pane === "vault" && input.noteId) params.set("note", input.noteId);
  return `/reader?${params.toString()}`;
}
