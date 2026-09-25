import { searchRevision, type SearchDoc } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { SemanticIndex, type EmbedProgress } from "./semantic-index";
import { WorkerEmbedder, supportsLocalEmbedding } from "../infrastructure/worker-embedder";
import { vectorStore } from "../infrastructure/vector-store";
import { planEmbeddingStart, targetEmbeddingModel } from "../infrastructure/embedding-models";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { onFolderConnected } from "@/features/workspace/application/workspace-folder";
import { SEMANTIC_CHANGED_EVENT } from "./semantic-events";

/**
 * Turning semantic search on and off.
 *
 * Opt-in, and the preference is the only thing persisted eagerly. Nothing is
 * downloaded, embedded, or stored until someone asks: a model is tens of
 * megabytes and a corpus is minutes of arithmetic, and neither is a cost to
 * impose on a user who never wanted the feature.
 */

const ENABLED_KEY = "thesis.search.semantic";

let embedder: WorkerEmbedder | null = null;
let semantic: SemanticIndex | null = null;
let building: Promise<void> | null = null;
/** The project the attached vectors describe; a switch must not keep them. */
let semanticProject: string | null | undefined;
/** A newer encoder embedding in the background while the old one serves. */
let upgrade: { controller: AbortController; embedder: WorkerEmbedder } | null = null;

/**
 * What the semantic arm is doing, for anyone who wants to show it.
 *
 * Module state rather than component state. The arm is usually attached by a
 * background restore, not by the settings toggle, and a status that lived in
 * the toggle only ever described the toggle's own call: after a reload the
 * panel said nothing at all, and while the model loaded or a stored index was
 * checked it sat on "Downloading the model — 100%" with no sign of what came
 * next or whether it had worked.
 */
export type SemanticStatus =
  | { phase: "off" }
  | { phase: "downloading"; loaded: number; total: number }
  | { phase: "loading" }
  | { phase: "embedding"; done: number; total: number }
  | {
      phase: "ready";
      passages: number;
      model: string;
      /** A newer model is embedding in the background; this one keeps answering until it is done. */
      upgrading?: { to: string; done: number; total: number };
    }
  | { phase: "error"; message: string };

let status: SemanticStatus = { phase: "off" };
const statusListeners = new Set<() => void>();

function setStatus(next: SemanticStatus): void {
  status = next;
  for (const listener of statusListeners) listener();
}

export function semanticStatus(): SemanticStatus {
  return status;
}

/** For `useSyncExternalStore`. */
export function subscribeSemanticStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** The encoder's short name, for status copy. */
function modelName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function semanticSupported(): boolean {
  return supportsLocalEmbedding();
}

export function semanticEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage disabled; the session still works, it just will not persist */
  }
}

export interface EnableOptions {
  onProgress?(progress: EmbedProgress): void;
  signal?: AbortSignal;
}

/**
 * Download the encoder, embed the corpus, and attach it to search.
 *
 * A stored index is reused when the model and the corpus fingerprint both
 * match. Either differing means the vectors describe something other than what
 * is on screen, and re-embedding is the only honest response — vectors from a
 * different encoder are not merely stale, they are meaningless.
 */
export async function enableSemanticSearch(options: EnableOptions = {}): Promise<void> {
  if (building) return building;
  building = run(options)
    .catch((error: unknown) => {
      setStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      throw error;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

async function run(options: EnableOptions): Promise<void> {
  const container = getContainer();
  const projectId = container.projects.context.projectId;

  await container.search.ensure();
  // Projected now rather than taken from a copy the build kept: that copy went
  // stale on any incremental refresh, and the revision below is derived from it,
  // so a note added after the build could never be found by this arm.
  const docs: readonly SearchDoc[] = await container.search.projectionForSemantic();
  const revision = searchRevision(docs);

  // The embedder outlives this call, so its download callback reads the
  // current caller's options rather than capturing the first one's.
  downloadListener = options.onProgress ?? null;
  setStatus({ phase: "loading" });

  const target = targetEmbeddingModel();
  const stored = await vectorStore().get(projectId);
  // Vectors from a model the app has since moved on from still answer while
  // the new one embeds: an upgrade should never be minutes of search by
  // meaning going dark. See `planEmbeddingStart`.
  if (stored && planEmbeddingStart(stored.model, target.id) === "swap") {
    if (await serveWhileUpgrading(stored, docs, revision, projectId, target.id)) return;
  }

  if (embedder && embedder.id !== target.id) {
    embedder.dispose();
    embedder = null;
  }
  embedder ??= new WorkerEmbedder({
    model: target.id,
    onProgress: (loaded, total) => {
      // A cached model reports its "download" too, instantly; past 100% the
      // wait is the runtime starting, which is loading, not downloading.
      setStatus(loaded >= total ? { phase: "loading" } : { phase: "downloading", loaded, total });
      downloadListener?.({ done: 0, total: 0, download: { loaded, total } });
    },
  });
  await embedder.load();

  semantic = new SemanticIndex(embedder);
  semanticProject = projectId;

  // Stored vectors are reused whenever the encoder matches, even if the
  // corpus moved on while the app was closed: the per-document hashes stored
  // with them let `sync` re-embed only what changed. It used to demand an exact
  // corpus match, so one edited note re-embedded the whole workspace.
  const reused =
    stored !== null &&
    semantic.load(
      {
        model: stored.model,
        dimensions: stored.dimensions,
        ids: stored.ids,
        vectors: stored.vectors,
        hashes: stored.hashes,
      },
      // Without hashes (an older store) the docs can seed the comparison only
      // when they are the corpus the vectors were built from.
      stored.hashes || stored.revision === revision ? docs : [],
    ) &&
    (stored.hashes !== undefined || stored.revision === revision);

  if (reused) {
    // Serve what is stored at once and catch up behind it. The arm used to
    // stay detached until every changed document was re-embedded, and opening
    // a few PDFs adds hundreds of page documents: minutes of search and
    // "related" by meaning going dark for text the vectors mostly already had.
    // `sync` edits the live index, which is what incremental updates do anyway.
    const current = semantic;
    attach(projectId);
    const changed = await current.sync(docs, () => true, (done, total) => {
      setStatus({ phase: "embedding", done, total });
    });
    if (current !== semantic) return;
    if (changed || !stored.hashes) persistNow(projectId, revision);
    // Views asked while it caught up; the newly embedded documents may change
    // their answers, so tell them to ask again.
    attach(projectId);
    return;
  } else {
    setStatus({ phase: "embedding", done: 0, total: 0 });
    await semantic.build(docs, {
      onProgress: (progress) => {
        setStatus({ phase: "embedding", done: progress.done, total: progress.total });
        options.onProgress?.(progress);
      },
      signal: options.signal,
    });
    persistNow(projectId, revision);
  }

  attach(projectId);
}

/** Hand the current `semantic` to search and say so. */
function attach(projectId: string | null): void {
  const container = getContainer();
  semanticProject = projectId;
  container.search.setSemanticIndex(semantic);
  container.search.onSemanticChanged = persistAfterSync;
  announceSemanticChange();
  serveRankingRequests();
  rememberPreference(true);
  setStatus({ phase: "ready", passages: semantic?.size ?? 0, model: modelName(embedder?.id ?? "") });
}

type StoredVectors = NonNullable<Awaited<ReturnType<ReturnType<typeof vectorStore>["get"]>>>;

/**
 * Attach the stored vectors with the encoder that made them, then start the
 * upgrade behind them. False when they cannot be served (no hashes and a moved
 * corpus, or the old encoder will not load); the caller rebuilds instead.
 */
async function serveWhileUpgrading(
  stored: StoredVectors,
  docs: readonly SearchDoc[],
  revision: string,
  projectId: string | null,
  targetId: string,
): Promise<boolean> {
  if (stored.hashes === undefined && stored.revision !== revision) return false;
  const previous = new WorkerEmbedder({ model: stored.model });
  try {
    await previous.load();
    const old = new SemanticIndex(previous);
    const loaded = old.load(
      { model: stored.model, dimensions: stored.dimensions, ids: stored.ids, vectors: stored.vectors, hashes: stored.hashes },
      docs,
    );
    if (!loaded) throw new Error("The stored vectors could not be read.");
    // Edits made while the app was closed, so the old arm is current too.
    if (await old.sync(docs, () => true)) persistVectors(old, projectId, revision);

    embedder?.dispose();
    embedder = previous;
    semantic = old;
    attach(projectId);
    void upgradeInBackground(projectId, targetId, previous);
    return true;
  } catch {
    previous.dispose();
    return false;
  }
}

/**
 * Embed the corpus with the target encoder while the old one serves, then swap.
 *
 * The swap is one assignment: search asks whichever index is attached, so
 * there is no moment with neither. Vectors are persisted only after it, so a
 * crash mid-upgrade leaves the old store intact and the next start serves from
 * it again and retries. Edits made during the build are caught by the sync
 * after the swap, which re-embeds only what changed.
 */
async function upgradeInBackground(projectId: string | null, targetId: string, previous: WorkerEmbedder): Promise<void> {
  const controller = new AbortController();
  const next = new WorkerEmbedder({ model: targetId });
  upgrade = { controller, embedder: next };
  const showProgress = (done: number, total: number) => {
    if (status.phase !== "ready" || upgrade?.embedder !== next) return;
    setStatus({ ...status, upgrading: { to: modelName(targetId), done, total } });
  };
  try {
    showProgress(0, 0);
    await next.load();
    const fresh = new SemanticIndex(next);
    const container = getContainer();
    await fresh.build(await container.search.projectionForSemantic(), {
      onProgress: (progress) => showProgress(progress.done, progress.total),
      signal: controller.signal,
    });
    const stillOurs =
      !controller.signal.aborted &&
      semantic !== null &&
      embedder === previous &&
      container.projects.context.projectId === projectId;
    if (!stillOurs) throw new Error("The upgrade was superseded.");

    const retired = semantic;
    semantic = fresh;
    embedder = next;
    upgrade = null;
    attach(projectId);
    retired?.clear();
    previous.dispose();

    const latest = await container.search.projectionForSemantic();
    await fresh.sync(latest, () => true);
    persistVectors(fresh, projectId, searchRevision(latest));
    if (semantic === fresh) setStatus({ phase: "ready", passages: fresh.size, model: modelName(targetId) });
  } catch {
    // The old arm is still attached and still right; the next start retries.
    if (embedder !== next) next.dispose();
    if (status.phase === "ready" && status.upgrading) setStatus({ ...status, upgrading: undefined });
  } finally {
    if (upgrade?.embedder === next) upgrade = null;
  }
}

function persistVectors(index: SemanticIndex, projectId: string | null, revision: string): void {
  const packed = index.serialize();
  if (packed) void vectorStore().set(projectId, { ...packed, revision });
}

let downloadListener: EnableOptions["onProgress"] | null = null;

// The arm usually attaches before the remembered folder reconnects at launch,
// so its first save lands only in the app's own store. Copy it into the folder
// as soon as there is one.
onFolderConnected(() => {
  if (!semantic?.ready) return;
  void getContainer()
    .search.projectionForSemantic()
    .then((docs) => persistNow(semanticProject ?? null, searchRevision(docs)))
    .catch(() => undefined);
});

function persistNow(projectId: string | null, revision: string): void {
  if (semantic) persistVectors(semantic, projectId, revision);
}

/** Fired when the arm attaches or detaches, so open views can re-query. */
export { SEMANTIC_CHANGED_EVENT };

function announceSemanticChange(): void {
  try {
    globalThis.dispatchEvent?.(new Event(SEMANTIC_CHANGED_EVENT));
  } catch {
    /* no event target outside a browser */
  }
}

/**
 * Re-attach the arm after a reload, when the reader had it on.
 *
 * The preference was persisted and nothing read it back: the settings toggle
 * showed "on", the vectors sat in storage, and every query after a reload was
 * keyword-only until someone opened settings and toggled it. This is the read.
 *
 * Silent and best-effort — it runs in the background from the first search, and
 * a failure leaves keyword search, which is what the reader had anyway.
 */
export function restoreSemanticSearch(): Promise<void> | null {
  if (!semanticEnabled() || !semanticSupported()) return null;
  const current = getContainer().projects.context.projectId;
  if (semantic?.ready && semanticProject === current) return null;
  return enableSemanticSearch().catch(() => undefined);
}

/**
 * Store the vectors after an incremental re-embed, tagged with the revision of
 * the corpus they now describe — otherwise the next load sees a stale revision
 * and re-embeds everything to catch up with one edit. Debounced: typing in a
 * note refreshes on every save.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistAfterSync(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const index = semantic;
    if (!index?.ready) return;
    void (async () => {
      const container = getContainer();
      const docs = await container.search.projectionForSemantic();
      const packed = index.serialize();
      if (packed && index === semantic) {
        await vectorStore().set(container.projects.context.projectId, { ...packed, revision: searchRevision(docs) });
      }
    })().catch(() => undefined);
  }, 5_000);
}

/**
 * Detach it and forget the vectors.
 *
 * The model itself is left in the browser's HTTP cache: turning the feature
 * back on should not re-download tens of megabytes, and the cache is the
 * browser's to evict.
 */
export async function disableSemanticSearch(): Promise<void> {
  stopServingRankingRequests?.();
  stopServingRankingRequests = null;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  upgrade?.controller.abort();
  upgrade?.embedder.dispose();
  upgrade = null;
  getContainer().search.onSemanticChanged = null;
  getContainer().search.setSemanticIndex(null);
  announceSemanticChange();
  semantic?.clear();
  semantic = null;
  embedder?.dispose();
  embedder = null;
  rememberPreference(false);
  setStatus({ phase: "off" });
  await vectorStore().clear();
}

/** Passages currently embedded, for the settings panel. */
export function semanticSize(): number {
  return semantic?.size ?? 0;
}

/**
 * Answer the local MCP server's ranking requests while this window is open.
 *
 * The server searches the workspace folder by word, then asks here whether the
 * files it found have a better order. That is the whole of "semantic search in
 * the MCP tool": the encoder is loaded once, in this window, and lending it out
 * is cheaper than a second copy in the shell.
 *
 * The candidates are file paths and the index is keyed by document id, so a
 * name the index does not know is dropped from the ranking rather than guessed
 * at -- the server keeps unranked files in the order it already had.
 */
let stopServingRankingRequests: (() => void) | null = null;

function serveRankingRequests(): void {
  const bridge = desktop();
  if (!bridge || typeof bridge.onSemanticRank !== "function" || stopServingRankingRequests) return;

  stopServingRankingRequests = bridge.onSemanticRank(async (query, candidates) => {
    const index = semantic;
    if (!index || !index.ready) return null;

    const hits = await index.search(query, candidates.length);
    const byId = new Map(hits.map((hit) => [hit.id, hit.score]));
    const scored = candidates
      .map((name) => ({ name, score: byId.get(documentIdOfPath(name)) }))
      .filter((entry): entry is { name: string; score: number } => entry.score !== undefined)
      .sort((a, b) => b.score - a.score);
    return scored.length ? scored.map((entry) => entry.name) : null;
  });
}

/**
 * The document id behind a workspace file name.
 *
 * The folder writes one file per entry, named for its id, so the id is the
 * base name with the extension taken off.
 */
function documentIdOfPath(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
