export type ReaderSplitPane = "report" | "vault" | null;

export function parseReaderSplitPane(raw: string | null): ReaderSplitPane {
  if (raw === "report" || raw === "vault") return raw;
  return null;
}
