import type { CitationFormat } from "@/features/overleaf/application/build-overleaf-export";
import { readyCore } from "@/lib/rust-core";

/** Editor cite insert modes — `wikilink` is the historical default. */
export type EditorCitationFormat = CitationFormat | "wikilink";

export const EDITOR_CITATION_FORMATS: readonly EditorCitationFormat[] = [
  "wikilink",
  "latex",
  "pandoc",
  "footnote",
  "raw",
] as const;

export const EDITOR_CITATION_FORMAT_LABELS: Record<EditorCitationFormat, string> = {
  wikilink: "[[Title]]",
  latex: "LaTeX \\cite{}",
  pandoc: "Pandoc [@key]",
  footnote: "Footnote [^key]",
  raw: "Raw cite key",
};

export function citationFormatStorageKey(projectId: string | null | undefined): string {
  return readyCore().citationFormatStorageKey(projectId ?? undefined);
}

export function parseEditorCitationFormat(raw: unknown): EditorCitationFormat {
  return readyCore().parseEditorCitationFormat(typeof raw === "string" ? raw : undefined) as EditorCitationFormat;
}
