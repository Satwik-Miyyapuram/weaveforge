import type { BibliographyAnnotation, BibliographyAnnotationPull, Paper } from "@weaveforge/core";
import type { ZoteroAnnotation } from "@weaveforge/wasm";

/**
 * An annotation as cached on a paper (`metadata.annotations`). Older caches may
 * lack `kind` and `tags`. The shape itself is Rust's `ZoteroAnnotation`.
 */
export type StoredZoteroAnnotation = Omit<ZoteroAnnotation, "kind" | "tags"> & {
  kind?: ZoteroAnnotation["kind"];
  tags?: string[];
};

export interface ZoteroSyncResult {
  pushed: number;
  pulled: number;
  deletedLocal: number;
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
  fetchBlob(path: string): Promise<Blob>;
  fetchBlobs(paths: readonly string[]): Promise<Map<string, Blob>>;
}

export interface ZoteroAnnotationPull {
  byPaper: Map<string, ZoteroAnnotation[]>;
  /** Paper key → the PDF attachment its annotations hang off. */
  attachments: Map<string, string>;
}

export interface IZoteroAnnotationPull {
  pull(): Promise<ZoteroAnnotationPull>;
}

/**
 * Zotero's wasm annotation pull (nullable fields) to the core port shape
 * (optional fields). `null` becomes `undefined`; nothing else changes.
 */
export function toBibliographyAnnotationPull(pull: ZoteroAnnotationPull): BibliographyAnnotationPull {
  const byPaper = new Map<string, BibliographyAnnotation[]>();
  for (const [paperKey, annotations] of pull.byPaper) {
    byPaper.set(
      paperKey,
      annotations.map((a) => ({
        key: a.key ?? undefined,
        kind: a.kind,
        text: a.text ?? undefined,
        comment: a.comment ?? undefined,
        color: a.color ?? undefined,
        page: a.page ?? undefined,
        tags: a.tags,
      })),
    );
  }
  return { byPaper, attachments: pull.attachments };
}
