import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ProjectContext } from "@/lib/parts-2";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  IPdfByteCache,
  IReaderAnnotationProjectSource,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
} from "@weaveforge/core";

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

// --- reader-annotation-repository ---
/** The reader annotation store: read, write and Zotero write-back bookkeeping. */
export type ReaderAnnotationRepository = IReaderAnnotationSource &
  IReaderAnnotationSink &
  IReaderAnnotationSyncRecorder &
  IReaderAnnotationProjectSource;

/**
 * `reader_annotations` through the Rust step engine
 * (`crates/wf-core/src/repos/reader_annotations.rs`): Rust plans the queries,
 * normalizes the written fields and maps the rows. Creates stamp the signed-in user.
 */
export function rustReaderAnnotationRepository(
  db: SupabaseClient,
  project: ProjectContext,
  session: ICurrentUserProvider,
): ReaderAnnotationRepository {
  return rustRepository<ReaderAnnotationRepository>(
    db,
    "reader_annotations",
    ["list", "listForProject", "create", "update", "recordZoteroSync", "remove"],
    projectUserCtx(project, session),
  );
}
