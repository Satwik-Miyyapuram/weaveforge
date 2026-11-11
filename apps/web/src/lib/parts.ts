import { readBackendConfig } from "@/backend/config";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { localBackendParts } from "@/backend/providers/local/parts";
import { createDataClient } from "@/backend/providers/postgrest/client";
import type { CitationFormat } from "@/features/overleaf/application/build-overleaf-export";
import { hasScreenCacheData, screenCacheKey } from "@/lib/cache/screen-cache";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { type AppLogInput, logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";
import { readStored, writeStored } from "@/lib/safe-storage";
import type {
  Clock,
  IdGenerator,
  QuotationType,
  VaultPage,
  VaultPageSummary,
} from "@weaveforge/core";

// --- ai-proposals-changed ---
/** Fired after anything changes the AI review queue. */
export const AI_PROPOSALS_CHANGED_EVENT = "ai-proposals-changed";

/**
 * Say the review queue changed. The pending memo goes first, so whichever
 * listener reads next gets the new queue, not the cached one.
 */
export function announceAiProposalsChanged(proposals: { forgetPending(): void }): void {
  proposals.forgetPending();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_PROPOSALS_CHANGED_EVENT));
}

// --- best-effort ---
/**
 * Run a service-worker side task whose failure must not affect startup, and
 * log the failure so it is not silent.
 */
export async function bestEffort(
  message: string,
  task: () => Promise<unknown> | unknown,
  log: (input: AppLogInput) => void = logToApp,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    log({
      level: "warn",
      source: "service-worker",
      message,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

// --- blob-output ---
/**
 * Handing a file to the user: a download, or a data URL to embed.
 *
 * Small things that several features need and none of them owns.
 */
/** Triggers a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Zip bytes (as fflate returns them) as an `application/zip` Blob.
 *
 * The bytes are copied into a fresh ArrayBuffer-backed view, so a view onto a
 * larger or shared buffer still types as a BlobPart and carries only itself.
 */
export function zipToBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: "application/zip" });
}

/**
 * A blob as a `data:` URL.
 *
 * What an exported document needs when it embeds a picture: a `blob:` URL dies
 * with the page that made it, so a saved SVG would open with a hole in it.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });
}

// --- breakpoints ---
/**
 * App-wide mobile ↔ desktop layout breakpoint.
 * Keep in sync with `@media (min-width: 900px)` in styles/nav.css (nav sidebar, shell).
 */
export const DESKTOP_BREAKPOINT_PX = 900;

/**
 * Below this width the desktop sidebar *starts* collapsed, as the icon rail.
 *
 * The 216px sidebar earns its width when there is room for it. Between the 900px
 * layout breakpoint and here there is not: measured on the installed app, a
 * 900px window left a 596px content column and a 960px one 651px, against 1200px
 * on a wide display — and both of those widths are real tablets in landscape.
 *
 * The rail is not a new layout: it is the state `/workspace` already opens in and
 * the hamburger already toggles (`.layout.nav-collapsed`, nav.css). This only
 * changes which state a tablet-sized window *starts* in, and expanding it again
 * is one tap.
 *
 * Keep in sync with the media query in `hooks/use-layout-breakpoint.ts`.
 */
export const RAIL_COLLAPSE_BELOW_PX = 1100;

// --- cache-storage ---
/**
 * Drops every Cache Storage entry for this origin (the service worker's
 * precache and runtime caches). Best-effort: a browser without Cache Storage,
 * or one that refuses, is left as it is.
 *
 * A leaf on purpose: the crash-recovery path imports it, and must not pull in
 * the feature modules the device wipe needs.
 */
export async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* best-effort */
  }
}

// --- citation-format-preference ---
/** Editor cite insert modes — `wikilink` is the historical default. */
export type EditorCitationFormat = CitationFormat | "wikilink";

export const EDITOR_CITATION_FORMATS: readonly EditorCitationFormat[] = [
  "wikilink",
  "latex",
  "pandoc",
  "footnote",
  "raw",
] as const;

export const EDITOR_CITATION_FORMAT_LABELS: Record<EditorCitationFormat, string> = {
  wikilink: "[[Title]]",
  latex: "LaTeX \\cite{}",
  pandoc: "Pandoc [@key]",
  footnote: "Footnote [^key]",
  raw: "Raw cite key",
};

export function citationFormatStorageKey(projectId: string | null | undefined): string {
  return readyCore().citationFormatStorageKey(projectId ?? undefined);
}

export function parseEditorCitationFormat(raw: unknown): EditorCitationFormat {
  return readyCore().parseEditorCitationFormat(typeof raw === "string" ? raw : undefined) as EditorCitationFormat;
}

// --- clipboard ---
/**
 * Copy text to the clipboard and answer whether it got there.
 *
 * The clipboard can be missing (an insecure page, an old webview) or refuse
 * (no permission, the window lost focus). Callers show "Copied" only on true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip?.writeText) return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// --- commit-enter ---
/**
 * An Enter that commits a field: not the one that confirms an IME composition
 * (`isComposing`, or keyCode 229 on older engines). Without this, a Japanese or
 * Chinese word saves half-typed the moment its characters are confirmed.
 */
export function isCommitEnter(event: {
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  return readyCore().isCommitEnter(event.key, event.keyCode, !!event.nativeEvent?.isComposing);
}

// --- create-note-from-query ---
export type CreateNoteResult<P> = { ok: true; page: P } | { ok: false; error: string };

/**
 * Create a note titled by a search query. A failure comes back as a message to
 * show, and is logged; it never rejects, since the palette calls it unawaited.
 * Returns null for a blank query.
 */
export async function createNoteFromQuery<P>(
  query: string,
  add: (input: { title: string }) => Promise<P>,
): Promise<CreateNoteResult<P> | null> {
  const title = query.trim();
  if (!title) return null;
  try {
    return { ok: true, page: await add({ title }) };
  } catch (err) {
    const detail = formatError(err);
    logToApp({ level: "warn", source: "jump-to", message: "Creating a note from search failed.", detail });
    return { ok: false, error: `Could not create the note: ${detail}` };
  }
}

// --- data-client ---
/**
 * @deprecated Prefer wireBackend() from @/backend/wire-backend.
 * Browser data client singleton for legacy call sites.
 */
export function getDataClient() {
  // The legacy call sites reach for the client directly rather than through
  // the container, so this is where a copy working on this computer has to be
  // answered too — otherwise those few screens alone would go to the network.
  if (isLocalMode()) return localBackendParts().db;

  const config = readBackendConfig();
  const url = config.supabaseUrl;
  const key = config.supabaseAnonKey;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy apps/web/.env.local.example to .env.local and fill it in.",
    );
  }
  return createDataClient(url, key, config.dataUrl);
}

// --- empty ---
/** Stable empty collections for hook dependency arrays (react-hooks-cleanup-plan Class A). */
const EMPTY_ARR: readonly never[] = [];
const EMPTY_MAP = new Map() as unknown as ReadonlyMap<string, never>;
const EMPTY_SET = new Set() as unknown as ReadonlySet<never>;

export function emptyArray<T>(): T[] {
  return EMPTY_ARR as unknown as T[];
}

export function emptyMap<K, V>(): Map<K, V> {
  return EMPTY_MAP as unknown as Map<K, V>;
}

export function emptySet<T>(): Set<T> {
  return EMPTY_SET as unknown as Set<T>;
}

// --- go-to-route ---
/**
 * Go to an app route. A route with a `#hash` on the page already open only
 * changes the hash, since a router push there fires no `hashchange` and the
 * page (Settings picks its tab by hash) would not notice.
 */
export function goToRoute(
  route: string,
  push: (route: string) => void,
  location: Pick<Location, "pathname" | "hash"> = window.location,
): void {
  const at = route.indexOf("#");
  const path = at < 0 ? route : route.slice(0, at);
  if (at >= 0 && location.pathname.replace(/\/$/, "") === path) {
    location.hash = route.slice(at + 1);
    return;
  }
  push(route);
}

// --- ink-haptics-preference ---
/**
 * Whether the pen's haptics play while drawing, where the OS has them.
 *
 * On by default. A per-device preference, stored like the editor's others:
 * the pen is this machine's, not the workspace's.
 */
const STORAGE_KEY = "thesis.inkHaptics";

export function parseInkHapticsOn(raw: unknown): boolean {
  return readyCore().inkHapticsOn(typeof raw === "string" ? raw : undefined);
}

export function readInkHapticsOn(): boolean {
  return parseInkHapticsOn(readStored(STORAGE_KEY));
}

export function writeInkHapticsOn(on: boolean): void {
  writeStored(STORAGE_KEY, on ? "on" : "off");
}

// --- latest-gate ---
/**
 * Drops answers from requests a newer one has replaced. Call the gate when a
 * request starts; the check it returns is true only while no later request
 * has started, so a slow, older answer cannot overwrite a newer one.
 */
export function latestGate(): () => () => boolean {
  let seq = 0;
  return () => {
    const mine = ++seq;
    return () => mine === seq;
  };
}

// --- notify-each ---
/**
 * Tell every listener, in order. One that throws is logged under `area` and
 * passed over: its failure is its own, and must neither stop the others
 * hearing nor reach whatever made the announcement.
 *
 * The listeners are copied first, so one that subscribes or unsubscribes
 * while being told changes who hears next time, not this time.
 */
export function notifyEach<A extends unknown[]>(
  listeners: Iterable<(...args: A) => void>,
  area: string,
  ...args: A
): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.warn(`[${area}] a listener failed:`, error);
    }
  }
}

// --- page-text ---
/**
 * The body text a card, a backlink scan or a hashtag scan can see.
 *
 * Lives here rather than beside `NoteCard` because more than one feature needs
 * it: the notes screen scans the list it renders, and the editor workspace
 * indexes the same list into its document set. A helper that two features share
 * cannot sit under either one's `ui/`, or the second import is a cross-feature
 * `ui/` import and fails `check:solid`.
 *
 * The list holds summaries (title and `bodyPreview`); opening a note replaces
 * its entry with the full page, which is what makes backlinks and transclusion
 * work for the note you are reading. So this takes either shape and prefers the
 * full body when the entry has been hydrated.
 *
 * Written with `in` rather than `page.body || page.bodyPreview` because the
 * declared type no longer promises a `body`: reading one off a summary is how a
 * card edit came to persist an empty body over a real note (review-2 F6). The
 * property test is also what keeps an intentionally empty body (`body: ""`)
 * distinguishable from an unhydrated summary.
 */
export function noteBodyText(page: VaultPageSummary | VaultPage): string {
  const full = "body" in page && typeof page.body === "string" ? page.body : undefined;
  const preview = "bodyPreview" in page && typeof page.bodyPreview === "string" ? page.bodyPreview : undefined;
  if (fitsIndexCap(full) && fitsIndexCap(preview)) {
    return readyCore().noteBodyText(full, preview);
  }
  // Above the 16Mi UTF-16 cap the Rust rule is not used: keep the original TS rule.
  return full || preview || "";
}

/**
 * Whether a body or preview is within the index cap, the limit the wasm rules enforce. A text
 * above it keeps the original TS rule rather than failing the call.
 */
function fitsIndexCap(text: string | undefined): boolean {
  return text === undefined || readyCore().textWithinCap(text);
}

/**
 * Whether an entry in a screen's list carries its full body yet.
 *
 * The guard callers need before handing an entry to an editor: an editor that
 * seeds its draft from `page.body` would start on `undefined` for a summary, and
 * the first save would then write that emptiness back over the note.
 */
export function isHydratedPage(page: VaultPageSummary | VaultPage): page is VaultPage {
  // `"body" in page` alone is not enough: the repositories' `listSummaries`
  // rows carry `body: ""` beside their `bodyPreview` (`toSummaryDomain`), so
  // the property test alone called every summary hydrated and no tab ever
  // fetched its full text. A preview is the mark of a summary — `VaultPage`
  // keeps it empty on a full page precisely so this can tell them apart.
  if (!("body" in page) || typeof page.body !== "string") return false;
  const rawPreview: unknown = "bodyPreview" in page ? page.bodyPreview : undefined;
  // A truthy preview that is not a string is not a usable stand-in: the page is a summary (TS rule).
  if (rawPreview && typeof rawPreview !== "string") return false;
  const body = page.body;
  const preview = typeof rawPreview === "string" ? rawPreview : undefined;
  if (!fitsIndexCap(body) || !fitsIndexCap(preview)) {
    // Above the cap the Rust rule is not used: keep the original TS rule.
    return !preview;
  }
  return readyCore().isHydratedPage(body, preview);
}

// --- pdf-lib ---
/**
 * Loading pdf.js.
 *
 * Two features want it — the reader, and the ink editor's PDF page backgrounds
 * — and each must not reach into the other for it, so it lives in `lib` rather
 * than under either one (CONTRIBUTING § SOLID boundaries). The loader itself is
 * shared state on purpose: the bundle is a megabyte, and whichever feature asks
 * first is the one that pays for it.
 */
export type PdfLib = typeof import("pdfjs-dist");

/** The pdf.js bundle is a megabyte; it is fetched once, on the first open. */
let pdfLibPromise: Promise<PdfLib> | null = null;

export async function loadPdfLib(
  importPdfJs: () => Promise<PdfLib> = () => import("pdfjs-dist"),
): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = importPdfJs().then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
    // A failed load is retried on the next open, not kept until a reload.
    pdfLibPromise.catch(() => {
      pdfLibPromise = null;
    });
  }
  return pdfLibPromise;
}

// --- perf ---
/**
 * Dev-only timings for responsive UI work. Values deliberately contain
 * no user content, IDs, or URLs so they remain safe to inspect in DevTools.
 *
 * Common keys: screen.{id}.memory_cache_hit, screen.{id}.idb_ms,
 * screen.{id}.fetch_ms, nav.overlay_skipped, nav.cache_hit, nav.route_ms
 */
type PerfTimings = Record<string, number>;

declare global {
  interface Window {
    __thesisPerf?: PerfTimings;
  }
}

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

export function recordPerf(name: string, valueMs: number): void {
  if (!enabled()) return;
  const store = (window.__thesisPerf ??= {});
  store[name] = Math.round(valueMs * 10) / 10;
}

export function perfNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function recordPerfSince(name: string, startedAt: number): void {
  recordPerf(name, perfNow() - startedAt);
}

// --- quotation-types ---
/** Quotation types in the order the pickers list them. */
export const QUOTATION_TYPES: readonly QuotationType[] = ["direct", "paraphrase", "summary"];

/** Display label for each quotation type, shared by the paper and reader annotation lists. */
export const QUOTATION_TYPE_LABELS: Record<QuotationType, string> = {
  direct: "Direct",
  paraphrase: "Paraphrase",
  summary: "Summary",
};

// --- relay-url ---
/**
 * Where the hosted page reaches a relay route (`/api/arxiv`, `/api/pdf-proxy`, …).
 *
 * With `NEXT_PUBLIC_RELAY_URL` set, a browser goes to the axum relay
 * (`apps/relay`); unset, it stays on the Next routes of its own origin. The
 * shells always keep their in-process relay, so the bare path is theirs.
 */
export function relayUrl(path: string): string {
  return readyCore().relayUrl(relayBase(), path);
}

/** The relay route path inside `url`, so same-origin checks also accept a relay URL. */
export function relayPath(url: string): string {
  return readyCore().relayPath(relayBase(), url);
}

function relayBase(): string | null {
  // Spelled out in full so Next inlines it into the client bundle.
  const base = process.env.NEXT_PUBLIC_RELAY_URL?.trim().replace(/\/+$/, "");
  return base && desktop() === null ? base : null;
}

// --- run-reported ---
/**
 * Run a screen action and show its failure instead of leaving it unhandled:
 * an error goes to `onError` as a message. `settle` runs either way, e.g. to
 * clear a busy flag or reload. Resolves whether the action succeeded.
 */
export async function runReported(
  action: () => Promise<unknown>,
  onError: (message: string) => void,
  settle?: () => void,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    onError(formatError(err));
    return false;
  } finally {
    settle?.();
  }
}

// --- screens ---
/**
 * Every screen that keeps a `useScreenData` cache, named once.
 *
 * Three lists used to spell these names independently — the route table
 * (`screen-for-path.ts`), the invalidation map (`wf-core` `cache_invalidation`) and
 * the prefetch switch (`prefetch-screen.ts`) — and they had already drifted
 * apart in both directions, which is the failure this prevents rather than
 * tidies:
 *
 *   * the invalidation map named `dashboard`, which no screen caches (the
 *     dashboard has its own facade), and `notes`, which is the vault's route —
 *     so every write deleted two dozen cache keys that were never written;
 *   * `/report/overleaf` is a real route with a real cache key, and it was in
 *     none of the three, so hovering its tab warmed nothing and navigating to it
 *     skipped the nav overlay.
 *
 * The list is seeded from the `useScreenData` call sites, because that call is
 * the only thing that creates a screen cache: a name no screen passes is a name
 * nothing writes, and a name a screen passes but this list lacks is a cache that
 * is never cleared on a write or warmed on a hover.
 */
export const SCREEN_IDS = [
  "papers",
  "vault",
  "graph",
  "lists",
  "experiments",
  "plan",
  "logbook",
  "report",
  "report-overleaf",
  "shared-with-me",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

// --- screen-for-path ---
/** Skip nav overlay when cached data exists (show stale content while revalidating). */
export function hasScreenCacheForPath(pathname: string, projectId: string | null): boolean {
  const screen = (readyCore().screenForPath(pathname) ?? null) as ScreenId | null;
  if (!screen) return false;
  return hasScreenCacheData(screenCacheKey(projectId, screen));
}

// --- session-lost ---
/**
 * Whether this window's account sign-in was lost while the app stayed open.
 *
 * Set by the auth provider on the desktop, where an ended session keeps the
 * workspace on screen rather than dropping to the sign-in page. Until the
 * person signs back in, every request to the account's server goes out without
 * a sign-in and the server refuses it — "permission denied for table projects"
 * on every card. That wording is true and useless: nothing is broken except the
 * sign-in, so while this is set the refusal is shown as what it means.
 *
 * Module state rather than context because `formatError` is called from
 * everywhere, including code with no React tree above it.
 */
let lost = false;

export function setSessionLost(value: boolean): void {
  lost = value;
}

export function isSessionLost(): boolean {
  return lost;
}

export const SESSION_LOST_MESSAGE = "You're signed out. Sign in to load this.";

/** A server refusal that, with no sign-in, means "sign in" rather than "not allowed". */
export function isSignedOutRefusal(message: string, code: string | null): boolean {
  // formatError calls this too, and it can run before the wasm core loads (or
  // in a test with no preload). When the core is not ready, report no refusal
  // rather than throw back into the formatter.
  try {
    return readyCore().isSignedOutRefusal(message, code);
  } catch {
    return false;
  }
}

// --- shortcut-label ---
/**
 * Whether the page runs on a Mac. The shortcut label rules (`keyLabel`,
 * `shortcutLabel`) live in Rust (`wf-core` `shortcut_label`) and are called
 * through `readyCore()`; only the browser check stays in TypeScript.
 */
/** Whether this is a Mac. Without a navigator (prerender) it is not. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

// --- system ---
/**
 * The three ways the application touches something it cannot control: the
 * clock, the id generator, and random bytes.
 *
 * They live together, and outside any one feature, because they are what every
 * feature's tests have to replace and no feature owns them. `randomBytes` was
 * the odd one out: two of these were extracted into a module under
 * `features/papers/infrastructure/` — a directory about papers — while the
 * third was written inline at the composition root, so the same decision (inject
 * the non-deterministic edge) was made two different ways in one file.
 */

/** Concrete system Clock — injected so domain/use-cases stay pure & testable. */
export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};

/** UUID generator backed by the platform crypto. */
export const uuidIds: IdGenerator = {
  newId: () => crypto.randomUUID(),
};

/**
 * `n` cryptographically random bytes.
 *
 * Async to match the port that takes it (`CreateShareLinkUseCase`), which is
 * shaped that way because a non-browser caller may have to await a source of
 * randomness. A test double is one line; a test that reaches for `crypto`
 * instead is not.
 */
export const randomBytes: (n: number) => Promise<Uint8Array> = async (n) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};

// --- workspace-changes ---
/**
 * One place that says the workspace changed.
 *
 * Deliberately not a general event bus. It carries a table name and nothing
 * else, because the things listening -- the folder mirror today, the local HTTP
 * surface and the MCP server in `interop-surface.md` -- all re-read what they
 * need anyway. A richer event would be a second description of the data that
 * has to be kept true alongside the first.
 *
 * Module-level rather than held in the container: the container is rebuilt when
 * the project changes, and a listener that had to be re-registered each time
 * would go quiet exactly when the workspace is busiest.
 */
export type WorkspaceChangeListener = (table: string) => void;

const listeners = new Set<WorkspaceChangeListener>();

/** Listen. Returns the unsubscribe, which callers should actually call. */
export function onWorkspaceChange(listener: WorkspaceChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce a change.
 *
 * One listener throwing must not stop the others hearing about it, and must
 * not reach the write that triggered this; it is logged instead.
 */
export function notifyWorkspaceChange(table: string): void {
  notifyEach(listeners, "workspace-changes", table);
}

/** Drop every listener. For tests, which should not leak into each other. */
export function resetWorkspaceChangeListeners(): void {
  listeners.clear();
}
