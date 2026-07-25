import type { Paper } from "@thesis/core";

/** Zotero PDF annotation kinds from the Web API `annotationType` field. */
export type ZoteroAnnotationType = "highlight" | "underline" | "note" | "image" | "ink";

/**
 * Parsed `annotationPosition` JSON from Zotero.
 * `pageIndex` is zero-based and must not be conflated with `page` (display label).
 */
export interface ZoteroAnnotationPosition {
  pageIndex: number;
  rects?: number[][];
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
