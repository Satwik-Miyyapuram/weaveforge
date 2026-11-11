import {
  oneRow,
  ProjectScopedPostgrestRepository,
  rows,
  run,
} from "@/backend/providers/postgrest/parts-1";
import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import type {
  DocumentAnalysis,
  IPdfByteCache,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
  NewReaderAnnotation,
  PdfLink,
  ReaderAnnotation,
  ReaderAnnotationPatch,
  ReaderAnnotationSyncRecord,
  ReaderOutlineItem,
  WorkspaceAnnotation,
} from "@weaveforge/core";
import type { CombinedPdfAnchor, PageTextItem } from "@weaveforge/wasm";
import { DEFAULT_ANNOTATION_COLOR } from "../application/parts";

// --- local-cache-names ---
/**
 * Names of the reader's IndexedDB databases, kept apart from the stores.
 *
 * A sign-out deletes them (`clearLocalDeviceData`), and that code is reached
 * from the app layout. Importing a name from the store module itself would
 * ship the whole store to every page.
 */
export const PDF_CACHE_DB_NAME = "weaveforge-pdf-cache";
export const PAPER_HTML_DB_NAME = "weaveforge-paper-html";

// --- indexeddb-pdf-byte-cache ---
/**
 * Browser IndexedDB PDF byte cache (ladder step 1).
 * Implements IPdfByteCache; core stays DOM-free.
 */
const DB_NAME = PDF_CACHE_DB_NAME;
const STORE = "pdfs";
const DB_VERSION = 1;

interface CacheRow {
  key: string;
  bytes: ArrayBuffer;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
}

/** Each row's key and age, walking a cursor so one row is in memory at a time. */
function readAges(store: IDBObjectStore): Promise<{ key: string; updatedAt: number }[]> {
  return new Promise((resolve, reject) => {
    const ages: { key: string; updatedAt: number }[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(ages);
        return;
      }
      const row = cursor.value as CacheRow;
      ages.push({ key: row.key, updatedAt: row.updatedAt });
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("indexedDB cursor failed"));
  });
}

export class IndexedDbPdfByteCache implements IPdfByteCache {
  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("IndexedDbPdfByteCache maxEntries must be a positive integer");
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const row = (await idbRequest(store.get(key))) as CacheRow | undefined;
      if (!row) {
        await waitForTransaction(tx);
        return null;
      }
      row.updatedAt = Date.now();
      store.put(row);
      await waitForTransaction(tx);
      return row.bytes;
    } finally {
      db.close();
    }
  }

  /** The key alone, so the row's bytes stay on disk. Callers only store fetched, non-empty bytes. */
  async has(key: string): Promise<boolean> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const found = await idbRequest(tx.objectStore(STORE).getKey(key));
      await waitForTransaction(tx);
      return found !== undefined;
    } finally {
      db.close();
    }
  }

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, bytes, updatedAt: Date.now() } satisfies CacheRow);
      // Count first: reading every row would load every cached PDF (22-04).
      const count = await idbRequest(store.count());
      if (count > this.maxEntries) {
        const ages = await readAges(store);
        for (const drop of readyCore().pickKeysToEvict(ages, this.maxEntries)) {
          store.delete(drop);
        }
      }
      await waitForTransaction(tx);
    } finally {
      db.close();
    }
  }

  async remove(key: string): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      await waitForTransaction(tx);
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await waitForTransaction(tx);
    } finally {
      db.close();
    }
  }

  async size(): Promise<number> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const count = await idbRequest(tx.objectStore(STORE).count());
      await waitForTransaction(tx);
      return count;
    } finally {
      db.close();
    }
  }
}

// --- postgrest-reader-annotation-repository ---
// --- reader-annotation-rows ---
/**
 * How reader annotation rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 * The mapping itself is Rust (`reader::annotation_rows`), reached through wasm.
 */

export interface ReaderAnnotationRow {
  id: string;
  paper_id: string;
  origin: "local" | "zotero";
  zotero_key: string | null;
  type: string;
  color: string;
  text: string;
  comment: string;
  tags: string[] | null;
  anchor: CombinedPdfAnchor;
  page_index: number;
  sort_index: string;
  sync_state?: string | null;
  zotero_version?: number | null;
  created_at: string;
  updated_at: string;
}

export function toDomain(row: ReaderAnnotationRow): ReaderAnnotation {
  return readyCore().annotationRowToDomain({
    ...row,
    sync_state: row.sync_state ?? null,
    zotero_version: row.zotero_version ?? null,
  }) as ReaderAnnotation; // Rust keeps the row's origin and type, which the row type already narrows.
}

// --- postgrest-reader-annotation-repository ---
/**
 * The columns a ReaderAnnotationRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const READER_ANNOTATION_COLUMNS = "id,paper_id,origin,zotero_key,type,color,text,comment,tags,anchor,page_index,sort_index,sync_state,zotero_version,created_at,updated_at";

const TABLE = "reader_annotations";

export class PostgrestReaderAnnotationRepository extends ProjectScopedPostgrestRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink, IReaderAnnotationSyncRecorder {
  protected readonly action = "managing reader annotations";

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    return (await rows<ReaderAnnotationRow>(this.db
      .from(TABLE)
      .select(READER_ANNOTATION_COLUMNS)
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .order("sort_index", { ascending: true }))).map(toDomain);
  }

  /**
   * Every annotation in the project, for the search index.
   *
   * Separate from `list` because that one answers "what is on this paper" and
   * the caller already knows the paper; here the paper and page have to travel
   * with each row or a hit cannot open where it came from.
   */
  async listForProject(): Promise<WorkspaceAnnotation[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select(READER_ANNOTATION_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_index", { ascending: true });
    if (error) throw error;
    return (data as ReaderAnnotationRow[]).map((row) => ({
      ...toDomain(row),
      paperId: row.paper_id,
      pageIndex: row.page_index,
    }));
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    if (!typedCore().isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    const userId = await this.session.requireUserId();
    const sortIndex =
      draft.sortIndex?.trim() || typedCore().buildAnnotationSortIndex(draft.pageIndex, 0, 0);
    const dbRow = await oneRow<ReaderAnnotationRow>(this.db
      .from(TABLE)
      .insert({
        ...(draft.id ? { id: draft.id } : {}),
        user_id: userId,
        project_id: this.projectId,
        paper_id: paperId,
        origin: "local",
        type: draft.type,
        color: draft.color.trim() || DEFAULT_ANNOTATION_COLOR,
        text: draft.text?.trim() ?? "",
        comment: draft.comment?.trim() ?? "",
        tags: draft.tags ?? [],
        anchor: draft.anchor,
        page_index: draft.pageIndex,
        sort_index: sortIndex,
        sync_state: "local",
      })
      .select(READER_ANNOTATION_COLUMNS)
      .single());
    return toDomain(dbRow);
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const updates: Record<string, unknown> = {};
    if (patch.color !== undefined) updates.color = patch.color.trim() || DEFAULT_ANNOTATION_COLOR;
    if (patch.text !== undefined) updates.text = patch.text.trim();
    if (patch.comment !== undefined) updates.comment = patch.comment.trim();
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.anchor !== undefined) updates.anchor = patch.anchor;
    if (patch.sortIndex !== undefined) updates.sort_index = patch.sortIndex;

    const projectId = this.projectId;
    // `pending` means "diverged from Zotero and owing a write-back". A row with
    // no Zotero counterpart can never owe one, so it stays `local` — marking it
    // pending would surface a sync state the user can never clear. Each path is
    // one write: an edit stored with a second, failed flag write would leave the
    // row `synced`, and write-back would never send the edit.
    const { data: flagged, error: flagError } = await this.db
      .from(TABLE)
      .update({ ...updates, sync_state: "pending" })
      .eq("id", id)
      .eq("project_id", projectId)
      .not("zotero_key", "is", null)
      .select(READER_ANNOTATION_COLUMNS)
      .maybeSingle();
    if (flagError) throw flagError;
    if (flagged) return toDomain(flagged as ReaderAnnotationRow);

    const { data, error } = await this.db
      .from(TABLE)
      .update(updates)
      .eq("id", id)
      .eq("project_id", projectId)
      .select(READER_ANNOTATION_COLUMNS)
      .single();
    if (error) throw error;
    return toDomain(data as ReaderAnnotationRow);
  }

  /** Write-back bookkeeping only; see `IReaderAnnotationSyncRecorder`. */
  async recordZoteroSync(id: string, record: ReaderAnnotationSyncRecord): Promise<void> {
    await run(this.db
      .from(TABLE)
      .update({
        zotero_key: record.zoteroKey,
        zotero_version: record.zoteroVersion,
        sync_state: record.syncState,
      })
      .eq("id", id)
      .eq("project_id", this.projectId));
  }

  async remove(id: string): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("id", id)
      .eq("project_id", this.projectId));
  }
}
