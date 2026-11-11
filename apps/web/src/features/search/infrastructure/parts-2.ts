import { openAppDb, PDF_TEXT_STORE } from "@/lib/cache/parts-1";
import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { warnOnce } from "@/lib/error-report/parts";
import type { PdfIndexSource } from "@weaveforge/wasm";
import type { EmbedRequest, IEmbedder } from "../application/parts";
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelProfile,
  embeddingProfile,
} from "./parts-1";

// --- native-embedder ---
/**
 * `IEmbedder` over the desktop shell's native encoder.
 *
 * The shell runs the model through its own commands, so there is no worker and
 * no weight download here. Same surface as `WorkerEmbedder`, so the search code
 * above does not care which one it got.
 */

export type NativeEmbedBridge = Required<Pick<DesktopBridge, "embedLoad" | "embedTexts">> &
  Pick<DesktopBridge, "onEmbedProgress" | "embedUnload">;

export interface NativeEmbedderOptions {
  /** Model repository id, as for `WorkerEmbedder`. */
  model?: string;
  /** Model files ready so far out of the model's total, for the settings panel. */
  onProgress?(loaded: number, total: number): void;
}

/** The shell's error code when the model was dropped while idle (apps/shell/src/embed.rs `NOT_LOADED_CODE`). */
export const NOT_LOADED_CODE = "NOT_LOADED";

/** The shell's encoder, when this build has one; null in the browser. */
export function nativeEmbedBridge(bridge: DesktopBridge | null = desktop()): NativeEmbedBridge | null {
  return bridge && typeof bridge.embedLoad === "function" && typeof bridge.embedTexts === "function"
    ? (bridge as NativeEmbedBridge)
    : null;
}

/**
 * Embedders holding each model, per bridge: the shell keeps one copy of a model,
 * so it is unloaded only when the last embedder using it is disposed.
 */
const holders = new WeakMap<NativeEmbedBridge, Map<string, number>>();

function holdersOf(bridge: NativeEmbedBridge): Map<string, number> {
  let counts = holders.get(bridge);
  if (!counts) {
    counts = new Map();
    holders.set(bridge, counts);
  }
  return counts;
}

export class NativeEmbedder implements IEmbedder {
  readonly id: string;
  dimensions = 0;
  /** Where "related" starts on this model's cosine scale. */
  readonly minScore: number;
  private readonly profile: EmbeddingModelProfile;
  private ready: Promise<void> | null = null;
  /** Counted in `holders` since the first load and until `dispose`. */
  private held = false;

  constructor(
    private readonly bridge: NativeEmbedBridge,
    private readonly options: NativeEmbedderOptions = {},
  ) {
    this.profile = options.model ? embeddingProfile(options.model) : DEFAULT_EMBEDDING_MODEL;
    this.id = this.profile.id;
    this.minScore = this.profile.minScore;
  }

  /**
   * Load the shell's model once, shared by every caller. A failure clears the
   * promise so the next call retries, as `WorkerEmbedder` does.
   */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    if (!this.held) {
      this.held = true;
      const counts = holdersOf(this.bridge);
      counts.set(this.profile.id, (counts.get(this.profile.id) ?? 0) + 1);
    }
    const ready = this.start();
    this.ready = ready;
    // Clear only our own promise: a later load must not be dropped by an older failure.
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  async embed(request: EmbedRequest): Promise<Float32Array[]> {
    if (request.signal?.aborted) throw abortReason(request.signal);
    if (request.texts.length === 0) return [];
    await this.load();
    const rows = await this.embedLoaded([...request.texts], request.kind);
    if (request.signal?.aborted) throw abortReason(request.signal);
    if (rows.length !== request.texts.length)
      throw new Error("The encoder returned the wrong number of vectors.");
    return rows.map((row) => new Float32Array(row));
  }

  /**
   * Release the shell's copy of this model now instead of when it goes idle, once
   * no other embedder of the same model still uses it.
   */
  dispose(): void {
    this.ready = null;
    if (!this.held) return;
    this.held = false;
    const counts = holdersOf(this.bridge);
    const left = (counts.get(this.profile.id) ?? 1) - 1;
    if (left > 0) {
      counts.set(this.profile.id, left);
      return;
    }
    counts.delete(this.profile.id);
    this.bridge.embedUnload?.(this.profile.id).catch(() => {});
  }

  /** Embed, reloading once when the shell dropped the model while it sat idle. */
  private async embedLoaded(texts: string[], kind: EmbedRequest["kind"]): Promise<number[][]> {
    try {
      return await this.bridge.embedTexts(this.profile.id, texts, kind);
    } catch (error) {
      if (!isNotLoaded(error)) throw error;
      this.ready = null;
      await this.load();
      return this.bridge.embedTexts(this.profile.id, texts, kind);
    }
  }

  private async start(): Promise<void> {
    // Subscribed before `embedLoad` so progress from the first file is not lost.
    const unsubscribe = this.bridge.onEmbedProgress?.((loaded, total, model) => {
      if (model === this.profile.id) this.options.onProgress?.(loaded, total);
    });
    try {
      const { dimensions } = await this.bridge.embedLoad(this.profile.id);
      this.dimensions = dimensions;
    } finally {
      unsubscribe?.();
    }
  }
}

function isNotLoaded(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === NOT_LOADED_CODE;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The request was aborted.", "AbortError");
}

// --- pdf-text-store ---
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
/** Guard against one pathological document filling the user's quota. */
const MAX_STORED_CHARS = 2_000_000;

function key(projectId: string | null, paperId: string): string {
  return `${projectId ?? "-"}|${paperId}`;
}

/** Every key of one project: `key()` puts the project first, so it is a prefix range. */
function projectRange(projectId: string | null): IDBKeyRange {
  const prefix = `${projectId ?? "-"}|`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
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
  } catch (err) {
    warnOnce("search", "PDF text was not saved for search.", err);
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
      const out: PdfIndexSource[] = [];
      const req = store.openCursor(projectRange(projectId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        out.push(cursor.value as PdfIndexSource);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

/**
 * Drop stored text for papers that no longer exist.
 *
 * The store is keyed by paper id and nothing deletes from it when a paper is
 * removed, so without this a deleted paper keeps answering searches with page
 * hits that lead nowhere.
 */
export async function removePdfTexts(
  projectId: string | null,
  paperIds: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined" || paperIds.length === 0) return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PDF_TEXT_STORE, "readwrite");
      const store = tx.objectStore(PDF_TEXT_STORE);
      for (const paperId of paperIds) store.delete(key(projectId, paperId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "Stale PDF text was not removed from search.", err);
    /* best-effort: the index filters these out regardless */
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
      const req = store.openCursor(projectRange(projectId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    warnOnce("search", "PDF text was not cleared from search.", err);
    /* ignore */
  }
}
