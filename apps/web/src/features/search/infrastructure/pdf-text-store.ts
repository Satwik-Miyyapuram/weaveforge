/**
 * Extracted PDF page text, kept so a document stays searchable after the reader
 * is closed.
 *
 * Written only from the reader's existing extraction pass — opening a PDF
 * already parses every page for the in-document search bar, so recording the
 * result costs one IndexedDB write and no fetching. Nothing here ever pulls a
 * PDF on its own; indexing a library the user has not read would mean
 * downloading every file, which is the one part of search that would put real
 * load on blob storage.
 */

import type { PdfIndexSource } from "@thesis/core";
import { PDF_TEXT_STORE, openAppDb } from "@/lib/app-idb";

/** Guard against one pathological document filling the user's quota. */
const MAX_STORED_CHARS = 2_000_000;

function key(projectId: string | null, paperId: string): string {
  return `${projectId ?? "-"}|${paperId}`;
}

function withinBudget(source: PdfIndexSource): PdfIndexSource {
  let total = 0;
  const pages = [];
  for (const page of source.pages) {
    total += page.text.length;
    if (total > MAX_STORED_CHARS) break;
    pages.push(page);
  }
  return pages.length === source.pages.length ? source : { ...source, pages };
}

export async function savePdfText(projectId: string | null, source: PdfIndexSource): Promise<void> {
  if (typeof indexedDB === "undefined" || source.pages.length === 0) return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PDF_TEXT_STORE, "readwrite");
      tx.objectStore(PDF_TEXT_STORE).put(withinBudget(source), key(projectId, source.paperId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort: losing this costs searchability, never the reader */
  }
}

/** Every stored document for a project, for the index build. */
export async function loadPdfTexts(projectId: string | null): Promise<PdfIndexSource[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openAppDb();
    return await new Promise<PdfIndexSource[]>((resolve, reject) => {
      const tx = db.transaction(PDF_TEXT_STORE, "readonly");
      const store = tx.objectStore(PDF_TEXT_STORE);
      const prefix = `${projectId ?? "-"}|`;
      const out: PdfIndexSource[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) out.push(cursor.value as PdfIndexSource);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

/** Cleared on sign-out: this is full document text on a possibly shared device. */
export async function clearPdfTexts(projectId?: string | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PDF_TEXT_STORE, "readwrite");
      const store = tx.objectStore(PDF_TEXT_STORE);
      if (projectId === undefined) {
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        return;
      }
      const prefix = `${projectId ?? "-"}|`;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
