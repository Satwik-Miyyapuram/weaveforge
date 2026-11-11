import { readBackendConfig } from "@/backend/parts";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import type { ProjectContext } from "@/lib/parts-2";
import { readyCore } from "@/lib/rust-core";
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";

// --- client ---
let client: SupabaseClient | null = null;
/** What the cached singleton was built from, so a different ask is not silently ignored. */
let clientKey: string | null = null;

/**
 * Browser data client (singleton). Used only by the PostgREST backend provider.
 *
 * `dataUrl` points the REST calls somewhere other than the auth project —
 * a self-hosted PostgREST in front of your own Postgres. Auth, realtime and
 * storage stay on `url`, because those are Supabase services and only the data
 * API has a drop-in replacement.
 *
 * The session is unaffected: the token Supabase Auth issues is sent to whichever
 * REST endpoint is configured, and a PostgREST holding the same JWT secret
 * accepts it. That is what makes the switch a URL rather than a rewrite.
 *
 * `dataUrl` defaults to the configured one rather than to "none". It used to
 * default to none, and three of the four callers omitted it — including
 * `wire-light-backend`, which runs first at startup and therefore *won* the
 * singleton. Setting `NEXT_PUBLIC_DATA_URL` then changed nothing at all: the
 * cached client had no rewrite, and every later caller got that client back.
 */
export function createDataClient(
  url: string,
  anonKey: string,
  dataUrl: string | undefined = readBackendConfig().dataUrl,
): SupabaseClient {
  const key = `${url}|${anonKey}|${dataUrl ?? ""}`;
  // A second ask with different parameters is a wiring bug, not a cache hit:
  // returning the existing client would send traffic to the wrong backend.
  if (client && clientKey === key) return client;
  client = createClient(url, anonKey, dataApiOptions(url, dataUrl));
  clientKey = key;
  return client;
}

/**
 * A client for one request, with the data-API rewrite applied.
 *
 * Server routes each built their own `createClient(url, anonKey, …)` and so
 * spoke to the auth project's REST endpoint no matter what `NEXT_PUBLIC_DATA_URL` said.
 * That is invisible until the cutover, at which point the browser reads the new
 * database and every API route keeps reading the old one — the worst shape a
 * migration bug can take, because both halves work.
 *
 * Not a singleton: these carry per-request credentials.
 */
export function createRestClient(
  url: string,
  key: string,
  options?: SupabaseClientOptions<"public">,
  dataUrl: string | undefined = readBackendConfig().dataUrl,
): SupabaseClient {
  const rewrite = dataApiOptions(url, dataUrl);
  return createClient(url, key, {
    ...options,
    global: { ...options?.global, ...rewrite.global },
  });
}

let realtimeClient: SupabaseClient | null = null;
let realtimeKey: string | null = null;

/**
 * The client whose websocket carries broadcast channels.
 *
 * `supabase-js` derives the realtime endpoint from the base URL it was
 * constructed with, so pointing realtime elsewhere cannot be a fetch override
 * the way the data API is — it needs its own client.
 *
 * Why it needs to move at all: a private broadcast channel is authorized by RLS
 * on `realtime.messages`, and those policies call `can_view_resource`, which
 * reads `vault_pages`, `papers` and `shares`. That check is only meaningful in
 * the database that holds the current rows. Left on the auth project after the data
 * moved, it would authorize against a frozen copy: documents that existed
 * before the cutover keep syncing, anything created after is denied, and the
 * editor gives no sign of it.
 *
 * When `realtimeUrl` is unset this returns the main client, so nothing changes
 * for a deployment that has not moved its data.
 */
/**
 * Encode every outgoing socket frame as Phoenix's plain-JSON tuple.
 *
 * `realtime-js` binary-encodes *all* `broadcast` pushes — see `Serializer.encode`,
 * which takes the binary "user broadcast push" branch for any broadcast whose
 * payload carries an `event`, whatever the payload's type. The self-hosted
 * Realtime on OCI does not speak that frame kind: it answers by tearing the
 * whole websocket down with a 1011, taking the co-editing channel *and* the
 * project-wide cache-invalidation channel with it.
 *
 * The failure is invisible from the app's side — the join succeeds, the client
 * reconnects, and the next send kills it again — so co-editing looked like it
 * had no transport at all while every `phx_join` reported `SUBSCRIBED`.
 *
 * JSON frames are what the joins already use and what the server has always
 * understood, so pinning the encoder to them costs nothing but the binary
 * fast path for ArrayBuffer payloads, which this app does not send: CRDT
 * updates go over the wire base64-encoded.
 */
export function encodeRealtimeMessageAsJson(
  msg: { join_ref?: string | null; ref?: string | null; topic: string; event: string; payload: unknown },
  callback: (result: string) => void,
): void {
  callback(JSON.stringify([msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload]));
}

export function getRealtimeClient(main: SupabaseClient): SupabaseClient {
  const config = readBackendConfig();
  const url = config.realtimeUrl;
  const anonKey = config.supabaseAnonKey;
  if (!url || !anonKey || url === config.supabaseUrl) return main;

  const key = `${url}|${anonKey}`;
  if (!realtimeClient || realtimeKey !== key) {
    // A config change replaces the client: close the old socket first, or it
    // keeps reconnecting with nothing left to read it.
    closeRealtimeClient();
    realtimeClient = createClient(url, anonKey, {
      // This client exists for its socket. It must never try to own a session:
      // the tokens come from the client that did the sign-in.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // Pulled per join rather than pushed on sign-in.
      //
      // Pushing it — `setAuth` from an auth-state listener — loses a race that
      // only shows up against a private channel: the screen mounts and
      // subscribes before the first session read resolves, the join goes out
      // with no token, and the policy refuses an anonymous caller. The client
      // then retries forever, so the log fills with `Unauthorized` for a
      // resource the user plainly owns.
      accessToken: async () => (await main.auth.getSession()).data.session?.access_token ?? null,
      realtime: { encode: encodeRealtimeMessageAsJson },
    });
    realtimeKey = key;
    // Prime the socket's token immediately. `setAuth()` with no argument
    // resolves through the `accessToken` callback above; doing it here means
    // the first `subscribe()` — which a screen can fire on its very first
    // render — already has a token to send rather than joining anonymously.
    realtimeClient.realtime
      .setAuth()
      .catch((err: unknown) =>
        logToApp({ level: "warn", source: "realtime", message: "Realtime auth failed", detail: formatError(err) }),
      );
  }
  return realtimeClient;
}

function closeRealtimeClient(): void {
  void realtimeClient?.realtime.disconnect();
  realtimeClient = null;
  realtimeKey = null;
}

/** The `global.fetch` override: the data-API rewrite, and a failure that names its target. */
function dataApiOptions(url: string, dataUrl: string | undefined): SupabaseClientOptions<"public"> {
  const rewrite = dataUrl && dataUrl !== url ? dataApiRewriter(url, dataUrl) : (href: string) => href;
  return { global: { fetch: routedFetch(rewrite) }, ...desktopAuthOptions() };
}

/**
 * In the desktop app, finish sign-in with an authorization code rather than a
 * token in the URL.
 *
 * The implicit flow puts the session in the fragment, and a fragment is never
 * sent to a server — so the loopback listener the desktop shell runs would
 * receive an empty request and the sign-in would end in the browser. PKCE
 * returns a `code` in the query string instead, which does reach the listener,
 * and the verifier that redeems it stays in this renderer where it was made.
 *
 * A browser is untouched: it keeps the flow it has always used.
 */
function desktopAuthOptions(): SupabaseClientOptions<"public"> {
  // Read off `window` rather than through `lib/desktop-bridge`, which is a
  // client module; this file is built for the server too.
  if (typeof window === "undefined" || !window.weaveforge) return {};
  return { auth: { flowType: "pkce" } };
}

/**
 * Send REST traffic to the data API and everything else to the auth project.
 *
 * supabase-js builds one base URL and appends `/rest/v1`, `/auth/v1`,
 * `/storage/v1` and so on. Rewriting at the fetch layer is what lets one client
 * serve both without maintaining a second client and a second session.
 */
function dataApiRewriter(supabaseUrl: string, dataUrl: string): (href: string) => string {
  const restPrefix = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const dataBase = dataUrl.replace(/\/$/, "");
  // PostgREST serves the tables at its root, so `/rest/v1` is dropped.
  return (href) => (href.startsWith(restPrefix) ? `${dataBase}${href.slice(restPrefix.length)}` : href);
}

/**
 * One fetch for every request the client makes: it moves the ones that belong
 * to the data API, and makes a failure say where it was going.
 */
function routedFetch(rewrite: (href: string) => string): typeof fetch {
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = rewrite(href);
    try {
      if (target === href) return await fetch(input, init);
      // Never let a framework cache stand in front of the database.
      //
      // Next.js patches the global `fetch`, and a route handler's fetches are
      // cached unless they opt out. Every database read through this rewrite was
      // therefore eligible, and the MCP relay showed what that costs: the browser
      // starts polling for work *before* any work exists, the first claim caches
      // an empty batch for that session, and every later poll is served that same
      // empty answer — so a live relay never sees a single request, while a
      // one-off claim on a fresh session succeeds because it misses the cache.
      // These are database calls; none of them are cacheable, ever.
      const uncached: RequestInit = { cache: "no-store" };
      if (typeof input === "string" || input instanceof URL) {
        return await fetch(target, { ...init, ...uncached });
      }
      // A Request carries its own body and headers; rebuild it around the new URL
      // rather than passing it as `init`, so the opt-out actually applies.
      return await fetch(new Request(target, input), uncached);
    } catch (error) {
      // Only on a failing path, so the probe it may run costs nothing normally.
      throw await namedNetworkFailure(error, target);
    }
  };
}

/**
 * How long the reachability probe may take.
 *
 * Short on purpose, and the reason matters: an unreachable host does not fail fast.
 * A refused connection is immediate, but a name that does not resolve hangs for the
 * platform's DNS timeout — measured at about seven seconds here — and a probe that
 * waited that out would put seven seconds between a failure and the message
 * explaining it, on the one path where the reader is already having a bad time. Two
 * and a half seconds is far longer than a server that is up needs to answer a
 * `HEAD`, so the only case that reaches the ceiling is the one where "unreachable"
 * was the right answer anyway.
 */
const PROBE_TIMEOUT_MS = 2500;

/**
 * Whether the host answers when the browser does not apply CORS to the request.
 *
 * ## What this can and cannot tell you
 *
 * A CORS refusal and a dead network are the same event at the fetch layer: the
 * browser fails with a bare `TypeError: Failed to fetch` and no status. The API's
 * Caddy config answers a preflight from an origin it does not list with `403` and
 * no `Access-Control-Allow-Origin`, so a request can be refused *by a server that
 * is running perfectly*.
 *
 * `mode: "no-cors"` is what makes the request legal from a browser without the
 * response being readable: it resolves opaquely for **any** response — `200`,
 * `401`, even `404` — and rejects only on a transport failure, a timeout, or a
 * refusal that the *server* made. That is the yes/no worth having, and it is also
 * the limit of it: this answers "did the host answer at all", not "did the host
 * like our origin".
 *
 * **Conflating those two is a bug that shipped, and it sent a person to edit a
 * Caddyfile that was correct.** The old version of this function was documented
 * as asking whether the host is reachable and was then read, by its caller, as
 * proving an origin refusal — a non-sequitur, since a host being up says nothing
 * about its allow-list. `mode: "no-cors"` resolves on `401` exactly as it does on
 * `200`, so "reachable" was true for almost any reply. The caller now says only
 * what this actually observed.
 *
 * Two smaller faults in the old version, kept in mind here:
 *
 * - It probed the **bare origin** (`https://api.weaveforge.org/`), which
 *   PostgREST answers with a `404`. The comment claimed that URL returns 200.
 * - It ran in the renderer, where the desktop shell has already rewritten
 *   `Origin` to `https://app.weaveforge.org` — so it was not even testing the
 *   origin the resulting message named.
 *
 * The probe now asks a path the data API actually serves, so a `no-cors` resolve
 * means "the API answered something", which is the strongest statement available
 * from here.
 */
export async function hostAnswersWithoutOrigin(target: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(target);
    // `/rest/v1/` rather than the root: the root is a 404 from PostgREST, and a
    // probe that is answered by a 404 is barely evidence of anything. When the
    // target already carries the REST prefix, the root `404` is unavoidable —
    // `no-cors` mode hides statuses either way, so the distinction is about
    // asking a real question rather than about reading the answer.
    const base = url.pathname.startsWith("/rest/")
      ? `${url.protocol}//${url.host}/rest/v1/`
      : `${url.protocol}//${url.host}/`;
    const probe = fetch(base, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS);
    });
    await Promise.race([probe, expired]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Re-throw a network failure with the host it could not reach, and — when the
 * host turns out to answer — the observation that it is up.
 *
 * A browser reports a request that never left it as a bare
 * `TypeError: Failed to fetch`, carrying no URL. This app talks to two origins
 * — Supabase for auth, a self-hosted PostgREST for data — so that message alone
 * cannot say which half is unreachable, and that is the one fact needed to act on
 * a report of it. Anything that is not a network failure is passed through
 * untouched: a server that answered has its own words.
 *
 * **The marker is deliberately not a conclusion.** It used to read
 * `(origin refused by <host>)`, which asserted a CORS verdict from evidence that
 * cannot support one, and `format-error.ts` turned that into a paragraph naming
 * `CORS_ALLOWED_ORIGINS`. The honest reading of "the probe resolved" is that the
 * host is up, so that — and the original error text, which was being discarded —
 * is what travels now. A reader who is told the host is up and what the browser
 * said has somewhere to go; a reader told "this is a CORS problem" when it is not
 * has a server to go and misconfigure.
 */
export async function namedNetworkFailure(error: unknown, target: string): Promise<unknown> {
  if (!(error instanceof TypeError)) return error;
  let host = target;
  try {
    host = new URL(target).host;
  } catch {
    // Not a URL that parses — report it as given rather than losing it.
  }
  const answered = await hostAnswersWithoutOrigin(target);
  // `(host answered)` rather than a CORS verdict, and the browser's own words are
  // carried in the message rather than dropped — they were being discarded, which
  // is why every failure read identically. `format-error.ts` reads both.
  const marker = answered ? ` (host answered) (browser said: ${error.message})` : "";
  return Object.assign(new TypeError(`${error.message} (could not reach ${host})${marker}`), {
    cause: error,
  });
}

export function resetDataClientForTests(): void {
  client = null;
  clientKey = null;
  closeRealtimeClient();
}

// --- project-scoped-repository ---
/**
 * The two things every project-scoped PostgREST repository is built from: the
 * client and the project the user has selected. Nine repositories spelled out
 * the same constructor and the same `pid` getter, so it lives here now.
 */
export abstract class ProjectRepository {
  constructor(
    protected readonly db: SupabaseClient,
    protected readonly ctx: ProjectContext,
  ) {}

  /** The selected project id, unchecked — reads simply filter by it. */
  protected get pid() {
    return this.ctx.projectId;
  }

  /**
   * Apply the project filter, when a project is selected.
   *
   * Every read in every project-scoped repository has to remember this, and the
   * one that forgot it returned other projects' rows wherever RLS is not what
   * is standing in the way — a self-hosted Postgres, or the local backend.
   * Naming the rule makes it one line at the call site instead of a two-line
   * `if` that is easy to leave out, and it reads as "this query is scoped"
   * rather than as a filter that happens to be there.
   *
   * Writes are different: they go through `ProjectScopedPostgrestRepository`,
   * which refuses to run at all without a project.
   */
  protected scoped<Q>(query: Q): Q {
    const pid = this.ctx.projectId;
    if (!pid) return query;
    // Deliberately unconstrained, with one cast right here.
    //
    // `.eq()` does return the same builder, but expressing that as a constraint
    // on `Q` (`Q extends { eq(column: string, value: string): Q }`) makes the
    // compiler relate the whole Postgrest builder type to itself at every call
    // site, and it gives up with TS2589 — "type instantiation is excessively
    // deep". Leaving `Q` free keeps each caller's inferred row type intact and
    // confines the single cast to this method.
    const filterable = query as unknown as { eq(column: string, value: string): Q };
    return filterable.eq("project_id", pid);
  }
}

/**
 * The three things every project-scoped PostgREST repository is built from, and
 * the one rule they all share: writing to a project-scoped table without a
 * project selected is a bug, and the message has to name what the user was
 * doing or it reads as a crash.
 *
 * Subclasses say what that was in `action` and get `projectId` for free.
 */
export abstract class ProjectScopedPostgrestRepository extends ProjectRepository {
  constructor(
    db: SupabaseClient,
    ctx: ProjectContext,
    protected readonly session: ICurrentUserProvider,
  ) {
    super(db, ctx);
  }

  /** Completes "Select a project before …" — e.g. `"pinning items"`. */
  protected abstract readonly action: string;

  protected get projectId(): string {
    const id = this.ctx.projectId;
    if (!id) throw new Error(`Select a project before ${this.action}.`);
    return id;
  }
}

// --- row-access ---
/**
 * The two queries every by-id repository writes the same way.
 *
 * Nine repositories each spelled out "select the row whose id matches, throw
 * the PostgREST error, hand back null when there is none" and "delete the row
 * whose id matches". The table and the row type differ; the query does not.
 */
export async function rowById<R>(
  db: SupabaseClient,
  table: string,
  id: string,
  columns = "*",
): Promise<R | null> {
  const { data, error } = await db.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as R | null) ?? null;
}

export async function deleteRowById(
  db: SupabaseClient,
  table: string,
  id: string,
): Promise<void> {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}

/**
 * The shape every PostgREST builder resolves to: rows, or an error to throw.
 *
 * Awaiting a supabase-js query builder gives back `{ data, error }`, and roughly
 * two hundred call sites destructured it, tested `error`, threw it, and cast
 * `data`. The two helpers below do that once so a query reads as the query.
 */
interface Resolved<T> {
  data: T | null;
  error: unknown;
}

export async function rows<R>(query: PromiseLike<Resolved<unknown>>): Promise<R[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as R[] | null) ?? [];
}

export async function run(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

export async function one<R>(query: PromiseLike<Resolved<unknown>>): Promise<R | null> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as R | null) ?? null;
}

/**
 * A row with its top-level `Date` values written as ISO text.
 *
 * The local PGlite client returns `timestamptz` columns as `Date` objects, while
 * PostgREST returns them as strings. The Rust mappers take the string form, so
 * a caller that hands a local row to one converts it first.
 */
export function timestampsAsText<R extends object>(row: R): R {
  const out: Record<string, unknown> = { ...(row as object) };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (value instanceof Date) out[key] = value.toISOString();
  }
  return out as R;
}

/** How many ids one `in` filter carries; the list travels in the URL. */
export const ID_CHUNK = 200;

/**
 * Rows by id, in chunks requested together.
 *
 * Chunked because an `in` list travels in the URL and a few thousand ids pass
 * the server's line-length limit; issued concurrently because sequential round
 * trips buy nothing. Results are concatenated in chunk order. No ids, no request.
 */
export async function inChunks<R>(
  ids: readonly string[],
  fetch: (chunk: string[]) => Promise<R[]>,
  size = ID_CHUNK,
): Promise<R[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size));
  }
  return (await Promise.all(chunks.map(fetch))).flat();
}

/**
 * The row an insert or upsert with `.select().single()` is guaranteed to return.
 *
 * PostgREST types `data` as nullable there even though a successful single-row
 * write always has one, so every caller repeated the same cast. Cast it once.
 */
export async function oneRow<R>(query: PromiseLike<Resolved<unknown>>): Promise<R> {
  const { data, error } = await query;
  if (error) throw error;
  return data as R;
}

// --- spec-repository ---
/*
 * Generic PostgREST repositories driven by Rust specs (`crates/wf-core/src/postgrest_spec.rs`).
 * Rust names the table, columns, project scope, order and filters; this file runs them.
 * Specs are looked up when a method runs, not at construction, so the core need not be loaded yet.
 */

type Core = ReturnType<typeof readyCore>;
export type RowSpec = NonNullable<ReturnType<Core["postgrestRowSpec"]>>;
export type KeyedColumnSpec = NonNullable<ReturnType<Core["postgrestKeyedColumnSpec"]>>;

/** The row spec named `name`. Throws when Rust has none, since that is a code error. */
export function requireRowSpec(name: string): RowSpec {
  const spec = readyCore().postgrestRowSpec(name);
  if (!spec) throw new Error(`No PostgREST row spec named ${name}`);
  return spec;
}

function requireKeyedColumnSpec(name: string): KeyedColumnSpec {
  const spec = readyCore().postgrestKeyedColumnSpec(name);
  if (!spec) throw new Error(`No PostgREST keyed-column spec named ${name}`);
  return spec;
}

/** Converts between a stored row and the domain entity, for what Rust does not own. */
export interface RowMapper<D, R> {
  toDomain(row: R): D;
  toRow(entity: D): Record<string, unknown>;
}

/**
 * A table of rows read and written by id. `F` is the list filter type; only the keys the spec
 * names as `eqFilters` are applied, so any other filter field is ignored, as the repositories it
 * replaces ignored it.
 */
export class SpecRepository<D, R, F extends object = object> extends ProjectRepository {
  constructor(
    db: SupabaseClient,
    ctx: ProjectContext,
    private readonly specName: string,
    private readonly mapper: RowMapper<D, R>,
  ) {
    super(db, ctx);
  }

  async getById(id: string): Promise<D | null> {
    const spec = requireRowSpec(this.specName);
    const row = await rowById<R>(this.db, spec.table, id);
    return row ? this.mapper.toDomain(row) : null;
  }

  async list(filter?: F): Promise<D[]> {
    const spec = requireRowSpec(this.specName);
    const pid = this.pid;
    if (spec.projectScoped && !pid) return [];
    let q = this.db.from(spec.table).select(spec.columns);
    if (spec.projectScoped && pid) q = q.eq("project_id", pid);
    const values = (filter ?? {}) as unknown as Record<string, unknown>;
    for (const key of spec.eqFilters) {
      const value = values[key];
      if (value) q = q.eq(key, value as string);
    }
    if (spec.order) {
      q = q.order(spec.order.column, { ascending: spec.order.ascending, nullsFirst: spec.order.nullsFirst });
    }
    return (await rows<R>(q)).map((row) => this.mapper.toDomain(row));
  }

  async save(entity: D): Promise<void> {
    const spec = requireRowSpec(this.specName);
    const row = this.mapper.toRow(entity);
    const pid = this.pid;
    if (spec.projectScoped && pid) row.project_id = pid;
    await run(this.db.from(spec.table).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, requireRowSpec(this.specName).table, id);
  }
}

/**
 * One JSON column of a row keyed by id, read as a parsed value and written whole. `parse` turns
 * the stored JSON into the domain value, or `null` when Rust rejects it.
 */
export class KeyedColumnRepository<T> {
  constructor(
    private readonly db: SupabaseClient,
    private readonly specName: string,
    private readonly parse: (raw: unknown) => T | null,
  ) {}

  async get(projectId: string): Promise<T | null> {
    const { table, column } = requireKeyedColumnSpec(this.specName);
    const row = await rowById<Record<string, unknown>>(this.db, table, projectId, column);
    const raw = row?.[column];
    if (!raw) return null;
    return this.parse(raw);
  }

  async save(projectId: string, value: T): Promise<void> {
    const { table, column } = requireKeyedColumnSpec(this.specName);
    await run(this.db.from(table).update({ [column]: value }).eq("id", projectId));
  }
}
