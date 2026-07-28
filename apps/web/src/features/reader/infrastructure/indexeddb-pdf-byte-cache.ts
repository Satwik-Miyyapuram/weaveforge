/**
 * Browser IndexedDB PDF byte cache (ladder step 1).
 * Implements IPdfByteCache; core stays DOM-free.
 */

import type { IPdfByteCache } from "@thesis/core";
import { pickKeysToEvict } from "../application/pdf-cache-eviction";

const DB_NAME = "weaveforge-pdf-cache";
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

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, bytes, updatedAt: Date.now() } satisfies CacheRow);
      const all = (await idbRequest(store.getAll())) as CacheRow[];
      for (const drop of pickKeysToEvict(all, this.maxEntries)) {
        store.delete(drop);
      }
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
