import type { ReaderAnnotation } from "@thesis/core";

/** Pin / quotation-type key: Zotero key when present, else local id. */
export function annotationPinKey(ann: Pick<ReaderAnnotation, "id" | "zoteroKey">): string {
  return ann.zoteroKey?.trim() || ann.id;
}

export const READER_ANNOTATION_COLORS = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
] as const;

export type ReaderCreateTool = "select" | "ink" | "image" | "text";
