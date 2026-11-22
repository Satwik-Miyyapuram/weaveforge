/** One personal row as PostgREST returns it. */
export type Row = Record<string, unknown>;

/** A blob the server knows about, with the sha256 the server recorded for it. */
export type BlobRef = { bucket: string; path: string; sha256: string };

/** Server side of the export. Real PostgREST wiring is a later step; tests use fakes. */
export interface ServerSource {
  listRows(kind: string): Promise<Row[]>;
  /** Raw server count for the kind (HEAD, Prefer: count=exact). Cross-checks listRows. */
  countRows(kind: string): Promise<number>;
  /** Unflushed local writes. Non-zero means the export must refuse to run. */
  pendingOutbox(): Promise<number>;
  /** Rows whose content_enc fails to decrypt. Each one blocks verified. */
  undecryptable(kind: string): Promise<number>;
  listBlobs(): Promise<BlobRef[]>;
  fetchBlob(ref: BlobRef): Promise<Uint8Array>;
  /** Sets profiles.exported_097_at. Called only after a verified export. */
  markExported(at: string): Promise<void>;
}

/** Row <-> file mapping. The real one wraps the wf-wasm entity codecs. */
export interface FileCodec {
  supports(kind: string): boolean;
  toFile(kind: string, row: Row): { path: string; text: string };
  /** Returns null when the file is not an entity of this kind. */
  toRow(kind: string, path: string, text: string): Row | null;
}

/** Folder-shaped target. The OPFS backend implements the same shape. */
export interface FileSink {
  write(path: string, data: string | Uint8Array): Promise<void>;
  list(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}
