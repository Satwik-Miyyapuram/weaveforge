import { isLocalMode } from "@/backend/providers/local/local-identity";
import { getContainer } from "@/bootstrap";
import { activeProjectRoot } from "@/features/workspace/application/parts";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { relayPath, relayUrl } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import {
  errorMessage,
  GitHubRepoPdfResolver,
  type GitHubRepoPdfResolverOptions,
  type IPdfByteCache,
  type IPdfSourceResolver,
  type IReaderAnnotationSource,
  type IReaderAnnotationSyncRecorder,
  OpenAccessPdfResolver,
  type Paper,
  PdfByteCacheResolver,
  type PdfSourcePaper,
  type PdfSourceResolution,
  type ReaderAnnotation,
  resolvePdfSource,
  WebDavPdfResolver,
} from "@weaveforge/core";
import type { PdfSourceKind } from "@weaveforge/wasm";
import { IndexedDbPdfByteCache } from "../infrastructure/parts-1";
import { RoutedPdfByteCache, WorkspacePdfStore } from "../infrastructure/parts-2";
import type { ZoteroAnnotationWriteResult } from "../infrastructure/parts-2";
import { pdfProxyNeedsToken } from "./parts";

// --- resolve-paper-pdf-source ---
/**
 * Build the PDF source ladder for the web reader.
 * Composition root lives here so core stays free of web allowlists.
 */
export function paperToPdfSourcePaper(input: {
  id: string;
  url?: string | null;
  arxivId?: string | null;
  doi?: string | null;
  pdfPath?: string | null;
  metadata?: Record<string, unknown>;
}): PdfSourcePaper {
  return {
    id: input.id,
    url: input.url ?? undefined,
    arxivId: input.arxivId ?? undefined,
    doi: input.doi ?? undefined,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.pdfPath ? { pdfPath: input.pdfPath } : {}),
    },
  };
}

const openAccessResolver = new OpenAccessPdfResolver({
  resolveUrl: (paper) =>
    readyCore().resolvePaperPdfUrl({
      url: paper.url,
      arxivId: paper.arxivId,
      openAccessPdf:
        typeof paper.metadata?.["openAccessPdf"] === "string" ? paper.metadata["openAccessPdf"] : null,
    }),
});

const webDavResolver = new WebDavPdfResolver({
  // No sealed WebDAV proxy route yet — refuse rather than return a 404 URL.
  buildProxiedUrl: () => null,
});

/** Remote copies the caller can reach; each step is skipped when absent. */
export interface RemotePdfSources {
  /** URL for a file in the workspace's GitHub repo, or null when none is set up. */
  githubFileUrl?: GitHubRepoPdfResolverOptions["buildFileUrl"];
}

/** The desktop shell's route for a file in the sync repo (`apps/shell/src/github_file.rs`). */
const GITHUB_FILE_ROUTE = "/api/github-file";
const GITHUB_PROBE_MS = 60_000;
let githubProbe: { at: number; set: boolean } | null = null;

/**
 * The GitHub step's source: in the desktop shell, when its sync remote is on
 * GitHub. The shell holds the token and fetches the file; the page only names
 * the repo path. The answer is kept a minute so a library sweep asks once.
 */
export async function githubRemotePdfSources(
  deps: { isDesktop?: boolean; fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<RemotePdfSources> {
  const isDesktop = deps.isDesktop ?? desktop() !== null;
  if (!isDesktop) return {};
  const now = (deps.now ?? Date.now)();
  if (!githubProbe || now - githubProbe.at >= GITHUB_PROBE_MS) {
    let set = false;
    try {
      set = (await (deps.fetchFn ?? fetch)(GITHUB_FILE_ROUTE)).status === 204;
    } catch {
      set = false;
    }
    githubProbe = { at: now, set };
  }
  if (!githubProbe.set) return {};
  return { githubFileUrl: (path) => `${GITHUB_FILE_ROUTE}?path=${encodeURIComponent(path)}` };
}

/**
 * Resolvers in priority order: cache, open access, GitHub repo, WebDAV. The order
 * is Rust's (`reader::pdf_source_ladder`); this only binds each kind to its resolver.
 * PDFs are never stored on our server, so there is no our-storage step.
 */
function defaultPdfSourceResolvers(
  cache?: IPdfByteCache,
  remote: RemotePdfSources = {},
): readonly IPdfSourceResolver[] {
  const byKind: Partial<Record<PdfSourceKind, IPdfSourceResolver>> = {
    openAccess: openAccessResolver,
    webDav: webDavResolver,
  };
  if (cache) byKind.cache = new PdfByteCacheResolver(cache);
  if (remote.githubFileUrl) {
    byKind.githubRepo = new GitHubRepoPdfResolver({ buildFileUrl: remote.githubFileUrl });
  }
  const order = readyCore().pdfSourceResolverOrder(!!cache, !!remote.githubFileUrl);
  return order.flatMap((kind) => {
    const resolver = byKind[kind];
    return resolver ? [resolver] : [];
  });
}

export function resolvePaperPdfSource(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  cache?: IPdfByteCache,
  remote?: RemotePdfSources,
): Promise<PdfSourceResolution> {
  return resolvePdfSource(paperToPdfSourcePaper(paper), defaultPdfSourceResolvers(cache, remote));
}

// --- resolve-paper-pdf-for-reader ---
/**
 * Resolve a PDF via the ladder and materialise `cache://` hits into blob URLs
 * pdf.js can open. Also seeds the cache when a network URL wins.
 */
const CACHE_CAP = 64;
let sharedCache: IPdfByteCache | null = null;

/**
 * Where a paper's bytes are kept between opens. With a workspace folder open
 * — the desktop build, once set up — that is the folder itself, `papers/pdf/`,
 * so the PDF is fetched once and read from disk after, offline included. In a
 * browser it is IndexedDB, a bounded cache, and the network when that is
 * cold: the web build fetches online, the desktop build does not have to.
 */
export function getReaderPdfByteCache(): IPdfByteCache | undefined {
  const hasBrowser = typeof indexedDB !== "undefined";
  if (!hasBrowser && !activeWorkspaceFs()) return undefined;
  if (!sharedCache) {
    const browser = hasBrowser ? new IndexedDbPdfByteCache(CACHE_CAP) : null;
    const folder = new WorkspacePdfStore(activeWorkspaceFs, activeProjectRoot);
    sharedCache = new RoutedPdfByteCache(() =>
      activeWorkspaceFs() ? folder : (browser ?? folder),
    );
  }
  return sharedCache;
}

export function isCachePdfUrl(url: string): boolean {
  return url.startsWith("cache://");
}

/** A URL the reader answers from this app's own store, with no network hop. */
export function isStoredPdfUrl(url: string): boolean {
  return url.startsWith("blob:") || isCachePdfUrl(url);
}

/**
 * The bytes behind a `cache://` URL, for pdf.js to take as `data`.
 *
 * The bundled app cannot go through a blob URL: on its `app://` origin a
 * `blob:` fetch fails with status 0, from the page and from pdf.js alike, so
 * the reader is handed the URL unmaterialised and asks here instead.
 */
export async function readStoredPdfBytes(url: string): Promise<ArrayBuffer | null> {
  const cache = getReaderPdfByteCache();
  if (!cache || !isCachePdfUrl(url)) return null;
  const bytes = await cache.get(decodeURIComponent(url.slice("cache://".length)));
  return bytes && bytes.byteLength > 0 ? bytes : null;
}

/**
 * The bytes behind whatever the resolver returned, from either place they live.
 *
 * **This exists because the two halves were split and the indexer only knew one.**
 * A resolved source is either a `cache://` reference — bytes already on this
 * device, which the desktop reader reads through `readStoredPdfBytes` — or a
 * remote URL, which goes through the proxy in `fetchPdfBytesForCache`. The reader
 * handles both because it is handed the URL and asks itself what it is.
 *
 * The library indexer called only `fetchPdfBytesForCache`, so every paper whose
 * bytes were **already cached** failed: `fetch` on `cache://…` cannot succeed,
 * and the ranking read
 *
 *     13 × "the proxy produced no bytes for cache://<uuid>"
 *
 * which reads like a network problem and is the opposite of one — those papers
 * were the ones already downloaded, and the cheapest to index. One caller knowing
 * half the answer is the kind of bug that looks like the network being broken.
 */
export async function pdfBytesForSource(url: string): Promise<ArrayBuffer | null> {
  if (isCachePdfUrl(url)) return readStoredPdfBytes(url);
  return fetchPdfBytesForCache(url);
}

async function materializeCachePdfUrl(
  url: string,
  cache: IPdfByteCache,
): Promise<string | null> {
  if (!isCachePdfUrl(url)) return url;
  const key = decodeURIComponent(url.slice("cache://".length));
  const bytes = await cache.get(key);
  if (!bytes || bytes.byteLength === 0) return null;
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/**
 * Drop a paper's cached bytes.
 *
 * Used when the cached copy fails to open: a truncated or evicted entry would
 * otherwise be re-served on every future visit, so the reader would stay broken
 * for that paper until storage was cleared by hand.
 */
export async function evictReaderPdfCache(paperId: string): Promise<void> {
  const cache = getReaderPdfByteCache();
  if (!cache) return;
  try {
    await cache.remove(paperId);
  } catch {
    // Best-effort: the fallback fetch matters, the eviction is housekeeping.
  }
}

/**
 * Resolve + materialise; populate cache when a remote URL wins.
 *
 * `skipCache` bypasses the cache tier entirely, so the ladder resolves to a
 * network URL. That is the retry path when a cached blob will not open.
 */
export async function resolvePaperPdfSourceForReader(
  paper: Parameters<typeof paperToPdfSourcePaper>[0],
  options: { skipCache?: boolean } = {},
): Promise<PdfSourceResolution & { revokeUrl?: string }> {
  const cache = options.skipCache ? undefined : getReaderPdfByteCache();
  const resolution = await resolvePaperPdfSource(paper, cache, await githubRemotePdfSources());
  if (!resolution.ok) return resolution;

  // The desktop shell's origin cannot fetch a blob URL; its reader takes the
  // `cache://` URL as it is and reads the bytes itself (`readStoredPdfBytes`).
  if (isCachePdfUrl(resolution.hit.url) && cache && desktop()) return resolution;

  if (isCachePdfUrl(resolution.hit.url) && cache) {
    const blobUrl = await materializeCachePdfUrl(resolution.hit.url, cache);
    if (!blobUrl) return { ok: false, reason: "no_source" };
    return {
      ok: true,
      hit: { url: blobUrl, contentHash: resolution.hit.contentHash },
      resolverId: resolution.resolverId,
      revokeUrl: blobUrl,
    };
  }

  // Best-effort: seed cache from a successful remote resolve. Not from the
  // no-account copy, which asks first and then fetches on purpose — see
  // `downloadPaperPdfToCache`.
  const remote =
    /^https?:\/\//i.test(resolution.hit.url) || resolution.hit.url.startsWith("/");
  if (cache && paper.id && remote && !isLocalMode()) {
    void seedCacheFromUrl(cache, paper.id, resolution.hit.url);
  }

  return resolution;
}

/**
 * Rewrite a cross-origin PDF URL through the same-origin proxy before fetching
 * it. Fetching the publisher directly is blocked by CORS on every allowlisted
 * host, so the seed silently failed for arXiv and OpenReview — which is every
 * source the ladder can actually resolve — leaving the cache permanently empty.
 * The proxy is the same hop pdf.js is given, and it needs the same bearer token.
 */
export async function fetchPdfBytesForCache(
  url: string,
  /** Injected so the proxy hop can be tested without a container. */
  getAccessToken: () => Promise<string | null> = () =>
    getContainer().auth.auth.getAccessToken(),
): Promise<ArrayBuffer | null> {
  const proxyPath = relayPath(url).startsWith("/") ? null : readyCore().pdfProxyPath(url);
  const target = proxyPath === null ? url : relayUrl(proxyPath);
  // Still cross-origin after the rewrite — an unallowlisted host. CORS would
  // reject it, so do not spend a request on it.
  if (!relayPath(target).startsWith("/")) return null;

  const headers: Record<string, string> = {};
  if (relayPath(target).startsWith("/api/pdf-proxy?") && pdfProxyNeedsToken()) {
    const token = await getAccessToken();
    if (!token) return null;
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(target, Object.keys(headers).length ? { headers } : undefined);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return bytes.byteLength > 0 ? bytes : null;
}

/**
 * Fetch a paper's PDF into the cache on request — the no-account copy's way
 * of getting a document, after the person has said yes. False when the
 * source did not answer with a PDF.
 */
export async function downloadPaperPdfToCache(paperId: string, url: string): Promise<boolean> {
  const cache = getReaderPdfByteCache();
  if (!cache) return false;
  const bytes = await fetchPdfBytesForCache(url);
  if (!bytes) return false;
  await cache.set(paperId, bytes);
  return true;
}

/**
 * Fetch a PDF from an address the person typed, into the cache under the
 * paper's id.
 *
 * An allowlisted host goes through the proxy like any other. Any other
 * https host: the desktop shell's proxy fetches it (`typed=1`, see
 * the pdf proxy in `apps/shell/src`); a browser has no such relay — the web
 * server's proxy is deliberately allowlisted — so it asks the host directly
 * and gets the PDF only if the host sends CORS headers, which repositories
 * often do and publishers mostly do not. The answer says which it was, so
 * the pane can suggest the file route when the address one is closed.
 */
export async function fetchTypedPdfToCache(
  paperId: string,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: "no-cache" | "not-pdf" | "blocked" | "failed" }> {
  const cache = getReaderPdfByteCache();
  if (!cache) return { ok: false, reason: "no-cache" };
  let bytes: ArrayBuffer | null = null;
  if (readyCore().isAllowedPdfProxyUrl(url)) {
    bytes = await fetchPdfBytesForCache(url);
    // Null here is the proxy refusing, no token, or an empty body: a failed
    // fetch. Whether the bytes are a PDF is checked below.
    if (!bytes) return { ok: false, reason: "failed" };
  } else if (desktop() !== null) {
    const res = await fetchFn(relayUrl(`/api/pdf-proxy?url=${encodeURIComponent(url)}&typed=1`));
    if (!res.ok) return { ok: false, reason: res.status === 415 ? "not-pdf" : "failed" };
    bytes = await res.arrayBuffer();
  } else {
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { accept: "application/pdf" } });
    } catch {
      // A network error on a cross-origin fetch is what CORS looks like.
      return { ok: false, reason: "blocked" };
    }
    if (!res.ok) return { ok: false, reason: "failed" };
    bytes = await res.arrayBuffer();
  }
  if (!bytes || !looksLikePdfBytes(bytes)) return { ok: false, reason: "not-pdf" };
  await cache.set(paperId, bytes);
  return { ok: true };
}

/** `%PDF` somewhere in the first kilobyte (Rust `has_pdf_magic`). */
export function looksLikePdfBytes(bytes: ArrayBuffer): boolean {
  return readyCore().hasPdfMagic(new Uint8Array(bytes));
}

async function seedCacheFromUrl(cache: IPdfByteCache, key: string, url: string): Promise<void> {
  try {
    // Only the first open of a paper pays for a second download; afterwards the
    // ladder resolves `cache://` before it ever reaches a network step. pdf.js
    // keeps its own URL so it can still range-request and paint page one early.
    if (await cache.has(key)) return;
    const bytes = await fetchPdfBytesForCache(url);
    if (bytes) await cache.set(key, bytes);
  } catch {
    /* cache seed is best-effort */
  }
}

// --- write-back-zotero-annotations ---
/**
 * Send the annotations made in this app to Zotero, and remember what Zotero
 * answered.
 *
 * This is the half of annotation sync that was missing: the pull brought
 * Zotero's highlights in, but nothing ever sent ours back, so a highlight made
 * here never reached the Zotero reader.
 *
 * What goes:
 * - a local annotation Zotero has never seen (`zoteroKey` null) is created;
 * - one edited here since its last sync (`pending`) is updated, under a
 *   version guard, so an edit made in Zotero meanwhile comes back `conflict`
 *   rather than being overwritten.
 *
 * What stays: annotations that came *from* Zotero (pushing them back is how a
 * round trip turns into a duplicate), rows already `synced`, rows in
 * `conflict` (they wait for the reader to resolve them), and whatever
 * `zoteroWriteBackAnnotations` leaves out (ink, marks with no PDF page).
 */

export interface ZoteroAnnotationPusher {
  push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options: { live: true },
  ): Promise<{ results: ZoteroAnnotationWriteResult[] }>;
}

export interface ZoteroAnnotationWriteBackSummary {
  created: number;
  updated: number;
  conflicts: number;
  failed: number;
  /** The first failure's reason, so the screen can say why. */
  firstError?: string;
}

/** The local annotations a write-back owes Zotero. */
export function annotationsOwedToZotero(annotations: readonly ReaderAnnotation[]): ReaderAnnotation[] {
  return readyCore().zoteroWriteBackAnnotations(
    annotations.filter(
      (a) => a.origin === "local" && (a.zoteroKey == null || a.syncState === "pending"),
    ),
  );
}

export async function writeBackZoteroAnnotations(deps: {
  papers: readonly Paper[];
  /** Paper → the Zotero PDF attachment to write under, or undefined. */
  attachmentOf: (paper: Paper) => string | undefined;
  annotations: IReaderAnnotationSource & IReaderAnnotationSyncRecorder;
  pusher: ZoteroAnnotationPusher;
}): Promise<ZoteroAnnotationWriteBackSummary> {
  const summary: ZoteroAnnotationWriteBackSummary = { created: 0, updated: 0, conflicts: 0, failed: 0 };
  const fail = (reason: string | undefined, count = 1) => {
    summary.failed += count;
    summary.firstError ??= reason;
  };

  for (const paper of deps.papers) {
    const attachment = deps.attachmentOf(paper);
    if (!attachment) continue;
    // One paper's failure is counted and the walk goes on; a throw here used
    // to drop every later paper and the summary with them.
    let owed: ReaderAnnotation[];
    try {
      owed = annotationsOwedToZotero(await deps.annotations.list(paper.id));
    } catch (err) {
      fail(errorMessage(err));
      continue;
    }
    if (owed.length === 0) continue;

    let results: ZoteroAnnotationWriteResult[];
    try {
      ({ results } = await deps.pusher.push(attachment, owed, { live: true }));
    } catch (err) {
      fail(errorMessage(err), owed.length);
      continue;
    }

    for (const r of results) {
      if (r.outcome === "failed" || !r.zoteroKey) {
        fail(r.reason);
        continue;
      }
      const syncState = r.outcome === "conflict" ? "conflict" : "synced";
      const prior = owed.find((a) => a.id === r.id);
      try {
        await deps.annotations.recordZoteroSync(r.id, {
          zoteroKey: r.zoteroKey,
          zoteroVersion: r.zoteroVersion ?? prior?.zoteroVersion ?? null,
          syncState,
        });
      } catch (err) {
        fail(errorMessage(err));
        continue;
      }
      if (r.outcome === "created") summary.created += 1;
      else if (r.outcome === "updated") summary.updated += 1;
      else summary.conflicts += 1;
    }
  }
  return summary;
}
