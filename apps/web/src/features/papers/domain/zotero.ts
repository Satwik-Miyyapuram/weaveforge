import type { Paper } from "@thesis/core";

/** Zotero PDF annotation kinds from the Web API `annotationType` field. */
export type ZoteroAnnotationType = "highlight" | "underline" | "note" | "image" | "ink";

/**
 * Parsed `annotationPosition` JSON from Zotero.
 * `pageIndex` is zero-based and must not be conflated with `page` (display label).
 *
 * Shape verified against `zotero/reader` `src/common/types.ts` (`PDFPosition`).
 * Rects are PDF user space with a bottom-left origin, never screen pixels.
 */
export interface ZoteroAnnotationPosition {
  pageIndex: number;
  /** `[x1, y1, x2, y2]` per line box, on `pageIndex`. */
  rects?: number[][];
  /**
   * Tail of a highlight that crosses a page break, living on `pageIndex + 1`.
   * A renderer that reads only `rects` silently truncates such an annotation.
   */
  nextPageRects?: number[][];
  /** Ink strokes. Distinct geometry from `rects` — needs a polyline, not a box. */
  paths?: number[][];
}

export interface ZoteroAnnotation {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  page?: string;
  tags: string[];
  annotationType?: ZoteroAnnotationType;
  annotationPosition?: ZoteroAnnotationPosition;
  annotationSortIndex?: string;
}

export interface ZoteroSyncResult {
  pushed: number;
  pulled: number;
  deletedLocal: number;
}

export interface ZoteroCollection {
  key: string;
  name: string;
}

export interface IZoteroLibrarySync {
  sync(): Promise<ZoteroSyncResult>;
}

export interface IZoteroExporter {
  save(paper: Paper): Promise<string | undefined>;
  remove(zoteroKey: string): Promise<void>;
}

export interface IPaperImageStore {
  upload(paperId: string, blob: Blob, ext: string): Promise<string>;
  remove(path: string): Promise<void>;
  signedUrls(paths: string[]): Promise<(string | null)[]>;
  fetchDecrypted(path: string): Promise<Blob>;
  fetchDecryptedMany?(paths: readonly string[]): Promise<Map<string, Blob>>;
}

export interface IZoteroAnnotationPull {
  pullAll(): Promise<Map<string, ZoteroAnnotation[]>>;
}
