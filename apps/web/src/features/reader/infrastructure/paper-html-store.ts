/**
 * Where a paper kept as a web page lives: the workspace folder when one is
 * open (`papers/html/<paperId>.html`, beside the PDFs, so it syncs and reads
 * offline), and IndexedDB otherwise — the same split the PDF bytes use.
 *
 * Reading back from the folder sanitises again: the file is the person's and
 * may have been edited by hand, and nothing unsanitised reaches the frame.
 */

import { PAPER_HTML_DIR, paperHtmlPath, type IWorkspaceFs } from "@weaveforge/core";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import {
  buildPaperHtmlDocument,
  parsePaperHtmlDocument,
  type PaperHtmlPage,
} from "../application/paper-html";
import { sanitizePaperHtml } from "./sanitize-paper-html";

export interface PaperHtmlStore {
  get(paperId: string): Promise<PaperHtmlPage | null>;
  set(page: PaperHtmlPage): Promise<void>;
  remove(paperId: string): Promise<void>;
}

class FolderPaperHtmlStore implements PaperHtmlStore {
  constructor(private readonly fs: IWorkspaceFs) {}

  async get(paperId: string): Promise<PaperHtmlPage | null> {
    const path = paperHtmlPath(paperId);
    if (!(await this.fs.stat(path))) return null;
    const page = parsePaperHtmlDocument(paperId, await this.fs.readText(path));
    if (!page) return null;
    return { ...page, html: sanitizePaperHtml(page.html, page.url).html };
  }

  async set(page: PaperHtmlPage): Promise<void> {
    await this.fs.mkdirp(PAPER_HTML_DIR);
    await this.fs.writeFile(paperHtmlPath(page.paperId), buildPaperHtmlDocument(page));
  }

  async remove(paperId: string): Promise<void> {
    const path = paperHtmlPath(paperId);
    if (await this.fs.stat(path)) await this.fs.remove(path);
  }
}

const DB_NAME = "weaveforge-paper-html";
const STORE = "pages";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "paperId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      let result: T;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

class IndexedDbPaperHtmlStore implements PaperHtmlStore {
  async get(paperId: string): Promise<PaperHtmlPage | null> {
    const row = await withStore<PaperHtmlPage | undefined>("readonly", (store) => store.get(paperId));
    return row ?? null;
  }

  async set(page: PaperHtmlPage): Promise<void> {
    await withStore("readwrite", (store) => store.put(page));
  }

  async remove(paperId: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(paperId));
  }
}

/** Decided per call: a folder can open or close mid-session. */
export function paperHtmlStore(): PaperHtmlStore | null {
  const fs = activeWorkspaceFs();
  if (fs) return new FolderPaperHtmlStore(fs);
  if (typeof indexedDB === "undefined") return null;
  return new IndexedDbPaperHtmlStore();
}
