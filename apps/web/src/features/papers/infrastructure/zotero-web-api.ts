/** Browser-only Zotero Web API helpers. Keep decrypted credentials out of app routes. */
export const ZOTERO_API_ORIGIN = "https://api.zotero.org";

export function zoteroLibraryUrl(library: string, apiOrigin = ZOTERO_API_ORIGIN): string {
  return `${apiOrigin.replace(/\/$/, "")}/${library.replace(/^\//, "")}`;
}

export function zoteroHeaders(apiKey: string): Record<string, string> {
  return { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" };
}

/** Zotero's maximum page size for item reads. */
export const ZOTERO_PAGE = 100;

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
  return collection
    ? `/collections/${encodeURIComponent(collection)}/items/top`
    : "/items/top";
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
