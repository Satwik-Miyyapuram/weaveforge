import type { Paper } from "@thesis/core";

export interface ZoteroAnnotation {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  page?: string;
  tags: string[];
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
