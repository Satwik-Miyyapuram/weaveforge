import { readyCore, typedCore } from "@/lib/rust-core";
import { type NewPaperInput, type Paper, paperInputWithoutNulls } from "@weaveforge/core";
import type { ZoteroSyncResult } from "../domain/zotero";
import type { ZoteroCredentialsProvider } from "./parts-2";

export type { ZoteroSyncResult } from "../domain/zotero";

// --- zotero-web-api ---
/** Browser-only Zotero Web API helpers. Keep decrypted credentials out of app routes. */
const ZOTERO_API_ORIGIN = "https://api.zotero.org";

export interface ZoteroCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** The item fields WeaveForge reads. Zotero returns many more; these are ours. */
export interface ZoteroItemData {
  key?: string;
  itemType?: string;
  /** Present on child items; the key of the bibliography entry they belong to. */
  parentItem?: string;
  title?: string;
  creators?: ZoteroCreator[];
  publicationTitle?: string;
  date?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  extra?: string;
  tags?: { tag?: string }[];
}

/** True when the item hangs off a paper — an attachment, note or annotation. */
export function isChildItem(d: ZoteroItemData): boolean {
  return typedCore().isZoteroChildItem(d);
}

/**
 * Zotero's own settings page shows a bare user id ("123456"), so that is what
 * people paste. The API needs a library *path*: `users/<id>` or `groups/<id>`.
 * Anything else is `undefined`.
 */
export function normalizeZoteroLibrary(library: string | undefined): string | undefined {
  return typedCore().normalizeZoteroLibrary(library);
}

export function zoteroLibraryUrl(library: string, apiOrigin = ZOTERO_API_ORIGIN): string {
  return typedCore().zoteroLibraryUrl(library, apiOrigin);
}

export function zoteroHeaders(apiKey: string): Record<string, string> {
  return typedCore().zoteroHeaders(apiKey);
}

/** Zotero's maximum page size for item reads. */
const ZOTERO_PAGE = 100;

/**
 * How many page requests are allowed in flight at once.
 *
 * Zotero has no published concurrent-request limit, but it does ask clients to
 * respect `Backoff` and `Retry-After` and to "not make more than a few
 * concurrent requests". Four keeps the fetch comfortably inside that while
 * still turning a 30-page read from thirty round trips into eight.
 */
const CONCURRENCY = 4;

/** Longest a server-requested pause is honoured before giving up on it. */
const MAX_BACKOFF_MS = 30_000;

export interface ZoteroPageRequest {
  /** Library root, e.g. `https://api.zotero.org/users/123`. */
  baseUrl: string;
  headers: Record<string, string>;
  /** Query parameters other than `limit` and `start`. */
  params?: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  /** Used in error messages: "Zotero <label> fetch failed". */
  label?: string;
  /**
   * Path under the library root. Defaults to `/items`, which returns *every*
   * item including attachments, notes and annotations — use `/items/top` when
   * you mean bibliography entries. See {@link zoteroTopLevelPath}.
   */
  path?: string;
}

/**
 * The endpoint that returns bibliography entries and nothing else.
 *
 * `/items` includes child items, and a Zotero PDF attachment carries a title
 * like "Preprint PDF" — indistinguishable from a paper to anything that only
 * checks that a title exists.
 */
export function zoteroTopLevelPath(collection?: string): string {
  return typedCore().zoteroTopLevelPath(collection);
}

/**
 * A shared clock the whole read respects.
 *
 * With requests in flight concurrently, a `Backoff` on one of them is a
 * statement about the library, not about that request — honouring it on only
 * the response that carried it would let the other three keep hammering. This
 * holds a single "not before" instant that every request waits on.
 */
class BackoffGate {
  private until = 0;
  wait(): Promise<void> {
    const ms = this.until - Date.now();
    return ms > 0 ? delay(ms) : Promise.resolve();
  }
  note(res: Response): void {
    const seconds = Number(res.headers.get("Backoff") ?? res.headers.get("Retry-After"));
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const at = Date.now() + Math.min(seconds * 1000, MAX_BACKOFF_MS);
    if (at > this.until) this.until = at;
  }
  /** For a 429 with no usable header — back off by attempt, not by nothing. */
  noteAttempt(attempt: number): void {
    const at = Date.now() + Math.min(1000 * (attempt + 1), MAX_BACKOFF_MS);
    if (at > this.until) this.until = at;
  }
}

function buildUrl(req: ZoteroPageRequest, start: number, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit), start: String(start) });
  for (const [key, value] of Object.entries(req.params ?? {})) {
    if (value != null && value !== "") params.set(key, value);
  }
  return `${req.baseUrl}${req.path ?? "/items"}?${params.toString()}`;
}

async function getPage(
  req: ZoteroPageRequest,
  gate: BackoffGate,
  start: number,
  limit = ZOTERO_PAGE,
): Promise<{ items: unknown[]; total: number | null }> {
  const url = buildUrl(req, start, limit);
  for (let attempt = 0; ; attempt++) {
    await gate.wait();
    const res = await req.fetchFn(url, { headers: req.headers });
    gate.note(res);
    if (res.status === 429 && attempt < 3) {
      gate.noteAttempt(attempt);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Zotero ${req.label ?? "items"} fetch failed (${res.status}). ${detail}`.trim(),
      );
    }
    const items = (await res.json()) as unknown[];
    // `headers.get` yields null when absent, and `Number(null)` is 0 — which is
    // finite. Read naively, a response with no `Total-Results` would claim the
    // library holds zero items and the read would stop after page one, losing
    // everything past the first hundred. That is precisely the failure the
    // serial loop was written to avoid: items that look missing get re-pushed
    // on the next sync, as duplicates.
    const totalHeader = res.headers.get("Total-Results");
    const total = totalHeader == null || totalHeader.trim() === "" ? NaN : Number(totalHeader);
    return { items, total: Number.isFinite(total) ? total : null };
  }
}

/** Run `work` over `inputs`, at most `limit` at a time, preserving order. */
async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  limit: number,
  work: (input: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= inputs.length) return;
      results[index] = await work(inputs[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Every item matching a query, fetched in as few round trips as the API allows.
 *
 * The first page carries `Total-Results`, so the remaining page offsets are
 * known immediately and can be fetched together instead of one after another.
 * That is the whole difference: reading 3,000 annotations used to be thirty
 * sequential requests — thirty times the latency to Zotero, in series, with
 * nothing else happening — and is now the first request plus eight rounds of
 * four.
 *
 * When the header is missing or unparseable it falls back to the old
 * walk-until-a-short-page loop, which is correct but slow, rather than guessing.
 */
export async function fetchAllZoteroItems<T>(req: ZoteroPageRequest): Promise<T[]> {
  const gate = new BackoffGate();
  const first = await getPage(req, gate, 0);
  const total = first.total;

  if (total == null) {
    const all = [...first.items];
    if (first.items.length < ZOTERO_PAGE) return all as T[];
    for (let start = ZOTERO_PAGE; ; start += ZOTERO_PAGE) {
      const page = await getPage(req, gate, start);
      all.push(...page.items);
      if (page.items.length < ZOTERO_PAGE) break;
    }
    return all as T[];
  }

  if (total <= first.items.length) return first.items as T[];

  const starts: number[] = [];
  for (let start = ZOTERO_PAGE; start < total; start += ZOTERO_PAGE) starts.push(start);
  const rest = await mapWithConcurrency(starts, CONCURRENCY, async (start) =>
    (await getPage(req, gate, start)).items,
  );

  return [...first.items, ...rest.flat()] as T[];
}

/**
 * Just the item keys for a query — `format=keys` returns a newline-separated
 * list rather than full item JSON, so scoping a sync to a collection costs one
 * small response instead of paginating every item in it.
 */
export async function fetchZoteroItemKeys(req: ZoteroPageRequest): Promise<Set<string>> {
  const params = new URLSearchParams({ format: "keys" });
  for (const [key, value] of Object.entries(req.params ?? {})) {
    if (value != null && value !== "") params.set(key, value);
  }
  const url = `${req.baseUrl}${req.path ?? "/items"}?${params.toString()}`;
  const res = await req.fetchFn(url, { headers: req.headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Zotero keys fetch failed (${res.status}). ${detail}`.trim());
  }
  const body = await res.text();
  return new Set(
    body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- zotero-sync ---
export interface ZoteroSyncDeps {
  credentials: ZoteroCredentialsProvider;
  listPapers: () => Promise<Paper[]>;
  addPaper: (input: NewPaperInput) => Promise<unknown>;
  /** Persist a paper (used to write back Zotero item keys after a push). */
  savePaper?: (paper: Paper) => Promise<void>;
  /** Delete a local paper (used when its Zotero item was deleted remotely). */
  deletePaper?: (id: string) => Promise<void>;
  /** After pull, sync Zotero item-level tags onto the local paper. */
  onItemTags?: (paper: Paper, remote: ZoteroItemData) => Promise<void>;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export class ZoteroSync {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly deps: ZoteroSyncDeps) {
    this.fetchFn = deps.fetchFn ?? ((...a) => fetch(...a));
    this.baseUrl = deps.baseUrl ?? "https://api.zotero.org";
  }

  /** One read of the remote library, and of the local one to match it against. */
  private async snapshot() {
    const creds = await this.deps.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error("Zotero is not configured. Add your API key and library in Settings.");
    }
    const headers = zoteroHeaders(creds.apiKey);
    const libraryUrl = zoteroLibraryUrl(creds.library, this.baseUrl);
    const col = creds.collection;

    // Read ALL remote items (paginated; scoped to the project's collection).
    // Reading only the first page would make items past the page size look
    // "missing" and get re-pushed every sync → duplicates. Pages after the
    // first go out together — see `fetchAllZoteroItems`.
    const remoteRaw = await fetchAllZoteroItems<{ data?: ZoteroItemData }>({
      baseUrl: libraryUrl,
      // Top-level items only. `/items` also returns attachments, notes and
      // annotations, and a Zotero PDF attachment is titled "Preprint PDF" or
      // "Full Text PDF" — which passed the `has a title` filter below, carried
      // no DOI or arXiv id, and so keyed on its own title and was imported as
      // though it were a paper. That is where the "Preprint PDF" entries in the
      // library came from.
      path: zoteroTopLevelPath(col),
      headers,
      fetchFn: this.fetchFn,
      label: "list",
    });
    const remote = remoteRaw
      .map((r) => r.data)
      .filter((d): d is ZoteroItemData => !!d && !!d.title)
      // Belt and braces: the endpoint should not return these, but importing a
      // child item as a paper is bad enough to be worth refusing twice. A
      // `parentItem` is the same statement from the other side — an item that
      // hangs off a paper is not one, whatever its `itemType` says.
      .filter((d) => !isChildItem(d));

    const local = await this.deps.listPapers();
    // Match if any content key overlaps. Each side emits its DOI + arXiv keys
    // (the same paper can carry a DOI on one side, an arXiv id on the other);
    // title is only a fallback key when a paper has neither id (see contentKeys).
    // So a paper with a DOI/arXiv will NOT match a remote item that has only a title.
    const localKeys = new Set(local.flatMap(keysOfLocal));
    return { remote, local, localKeys, headers, libraryUrl, col };
  }

  /**
   * Remote items not present locally (by any content key) become papers.
   *
   * The tag pass used to re-read the *entire* paper list inside this loop,
   * once per pulled item, to find the row it had just created — so pulling
   * 200 papers meant 200 full reads of a table that was growing as it went.
   * One read afterwards finds all of them.
   */
  private async pullInto(remote: ZoteroItemData[], localKeys: Set<string>): Promise<number> {
    let pulled = 0;
    const pulledItems: ZoteroItemData[] = [];
    for (const d of remote) {
      const ks = keysOfRemote(d);
      if (ks.length === 0 || ks.some((k) => localKeys.has(k))) continue;
      await this.deps.addPaper(paperInputWithoutNulls(readyCore().zoteroRemoteToInput(d)));
      ks.forEach((k) => localKeys.add(k));
      pulled += 1;
      if (this.deps.onItemTags && d.key) pulledItems.push(d);
    }

    if (pulledItems.length > 0 && this.deps.onItemTags) {
      const byZoteroKey = new Map<string, Paper>();
      for (const p of await this.deps.listPapers()) {
        const zk = p.metadata?.["zoteroKey"] as string | undefined;
        if (zk) byZoteroKey.set(zk, p);
      }
      for (const d of pulledItems) {
        const created = d.key ? byZoteroKey.get(d.key) : undefined;
        if (created) await this.deps.onItemTags(created, d);
      }
    }
    return pulled;
  }

  /**
   * Pull only: every remote item not yet in the library becomes a paper, and
   * nothing is sent back or removed. This is the whole of a read from the
   * Zotero on this computer, whose local API answers GETs and nothing else —
   * and the first third of a sync against the cloud one.
   */
  async pull(): Promise<number> {
    const { remote, localKeys } = await this.snapshot();
    return this.pullInto(remote, localKeys);
  }

  async sync(): Promise<ZoteroSyncResult> {
    const { remote, local, localKeys, headers, libraryUrl, col } = await this.snapshot();
    const remoteKeys = new Set(remote.flatMap(keysOfRemote));
    // Zotero item keys still present remotely (for delete-propagation).
    const remoteItemKeys = new Set(remote.map((d) => d.key).filter(Boolean) as string[]);
    const hasRemoteMatch = (p: Paper) => keysOfLocal(p).some((k) => remoteKeys.has(k));

    // Reconcile in a safe order against this one remote snapshot: PULL first
    // (additive), then PUSH (additive), then DELETE (destructive) last.
    const pulled = await this.pullInto(remote, localKeys);

    // --- push: local papers that have never been in Zotero. ---
    //
    // A stored `zoteroKey` means this row came from — or was already pushed to
    // — Zotero, so it is never a push candidate again. Pushing on "key exists
    // but is missing from the remote snapshot" is what re-seeded junk: rows
    // pulled from PDF attachments before the top-level fix carry an attachment
    // key, attachments are (correctly) absent from `/items/top`, and so every
    // sync exported "SAGE PDF Full Text" back to Zotero as a fresh top-level
    // item — which the next pull then imported as a genuine paper, immune to
    // every child-item filter. A key that is gone from the remote snapshot is a
    // delete to propagate, handled below; it is never a reason to push.
    const toPush = local.filter((p) => {
      if (p.metadata?.["zoteroKey"]) return false;
      return keysOfLocal(p).length > 0 && !hasRemoteMatch(p);
    });
    // Zotero takes at most 50 objects per write, and numbers the results by
    // position within that write, so each batch maps back by its own offset.
    // Only the items Zotero accepted count as pushed.
    let pushed = 0;
    for (let start = 0; start < toPush.length; start += ZOTERO_WRITE_LIMIT) {
      const batch = toPush.slice(start, start + ZOTERO_WRITE_LIMIT);
      const items = batch.map((p) => ({
        ...readyCore().toZoteroItem(p),
        ...(col ? { collections: [col] } : {}),
      }));
      const res = await this.fetchFn(`${libraryUrl}/items`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Zotero-Write-Token": crypto.randomUUID().replace(/-/g, "") },
        body: JSON.stringify(items),
      });
      if (!res.ok) {
        const d = await res.text().catch(() => "");
        throw new Error(`Zotero push failed (${res.status}). ${d}`.trim());
      }
      const result = (await res.json()) as {
        successful?: Record<string, { key?: string }>;
      };
      const ok = result.successful ?? {};
      pushed += Object.keys(ok).length;
      // Write back the new Zotero keys so future deletes propagate.
      if (this.deps.savePaper) {
        for (const [idx, created] of Object.entries(ok)) {
          const paper = batch[Number(idx)];
          if (paper && created?.key) {
            await this.deps.savePaper({
              ...paper,
              metadata: { ...paper.metadata, zoteroKey: created.key },
            });
          }
        }
      }
    }

    // --- delete-propagation: only remove a local paper when its Zotero item is
    // truly gone — its stored key is absent AND no remote item still matches it
    // by content. Skip entirely if the remote list came back empty, so a partial
    // or failed read can never mass-delete the library. ---
    let deletedLocal = 0;
    if (this.deps.deletePaper && remote.length > 0) {
      for (const p of local) {
        const zk = p.metadata?.["zoteroKey"] as string | undefined;
        if (zk && !remoteItemKeys.has(zk) && !hasRemoteMatch(p)) {
          await this.deps.deletePaper(p.id);
          deletedLocal += 1;
        }
      }
    }

    return { pushed, pulled, deletedLocal };
  }
}

/** Zotero's limit on objects per write request. */
const ZOTERO_WRITE_LIMIT = 50;

/**
 * Content keys for a paper (Rust `zoteroContentKeys`): match if ANY overlaps. Strong ids
 * (doi, arxiv) are preferred; title is only a fallback when neither exists.
 */
function keysOfLocal(p: Paper): string[] {
  return readyCore().zoteroContentKeys(p.doi, p.arxivId, p.title);
}
function keysOfRemote(d: ZoteroItemData): string[] {
  return readyCore().zoteroContentKeys(d.DOI, readyCore().zoteroArxivId(d), d.title);
}
