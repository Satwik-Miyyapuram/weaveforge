/** One personal row as PostgREST returns it. */
export type Row = Record<string, unknown>;

/** A blob the server knows about. The server records size only; the sha256 is computed locally. */
export type BlobRef = { bucket: string; path: string; sizeBytes: number };

/** Server side of the export. Real PostgREST wiring is a later step; tests use fakes. */
export interface ServerSource {
  listRows(kind: string): Promise<Row[]>;
  /** Raw rows with deleted_at set. Never dropped: the export writes each one to trash/. */
  listTrashed(kind: string): Promise<Row[]>;
  /** Raw server count for the kind (HEAD, Prefer: count=exact). Cross-checks listRows. */
  countRows(kind: string): Promise<number>;
  /** Providers whose secret the owner has set on the server (see SECRET_TABLES). Throws when unreadable. Names only, never a secret. */
  secretProviders(): Promise<string[]>;
  /** Unflushed local writes. Non-zero means the export must refuse to run. */
  pendingOutbox(): Promise<number>;
  /** Rows whose content_enc fails to decrypt. Each one blocks verified. */
  undecryptable(kind: string): Promise<number>;
  listBlobs(): Promise<BlobRef[]>;
  fetchBlob(ref: BlobRef): Promise<Uint8Array>;
  /** Sets profiles.exported_097_at. Called only after a verified export. */
  markExported097(): Promise<void>;
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
  /**
   * Files under `dir` ("" = all) with their sizes, from one listing. Optional: without it a caller lists the whole
   * sink and reads each file for its size.
   */
  entries?(dir: string): Promise<{ path: string; size: number }[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Stat-style presence check, true when the file is there. It throws when the check itself fails. */
  exists(path: string): Promise<boolean>;
  /** Atomic move within the sink, replacing any existing target. */
  rename(from: string, to: string): Promise<void>;
  /** Removes one file; a missing file is an error. */
  remove(path: string): Promise<void>;
  /**
   * Compare-and-set: writes `text` only while the file still reads `expected`. Returns false, with nothing
   * written, on a mismatch or a missing file. The caller re-reads and retries.
   */
  writeIf(path: string, text: string, expected: string): Promise<boolean>;
}
