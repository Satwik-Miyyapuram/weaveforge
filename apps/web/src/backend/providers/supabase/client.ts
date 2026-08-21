import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import { readBackendConfig } from "@/backend/config";

let client: SupabaseClient | null = null;
/** What the cached singleton was built from, so a different ask is not silently ignored. */
let clientKey: string | null = null;

/**
 * Browser Supabase client (singleton). Used only by the Supabase backend provider.
 *
 * `dataUrl` points the REST calls somewhere other than the Supabase project —
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
export function createSupabaseClient(
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
 * spoke to Supabase's REST endpoint no matter what `NEXT_PUBLIC_DATA_URL` said.
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
 * the database that holds the current rows. Left on Supabase after the data
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
    realtimeClient = createClient(url, anonKey, {
      // This client exists for its socket. It must never try to own a session:
      // the tokens come from the Supabase-backed client that did the sign-in.
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
    void realtimeClient.realtime.setAuth();
  }
  return realtimeClient;
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
 * Send REST traffic to the data API and everything else to Supabase.
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
      throw namedNetworkFailure(error, target);
    }
  };
}

/**
 * Re-throw a network failure with the host it could not reach.
 *
 * A browser reports a request that never left it as a bare
 * `TypeError: Failed to fetch`, carrying no URL. This app talks to two origins
 * — Supabase for auth, a self-hosted PostgREST for data — so that message
 * alone cannot say which half is unreachable, and that is the one fact needed
 * to act on a report of it. Anything that is not a network failure is passed
 * through untouched: a server that answered has its own words.
 */
function namedNetworkFailure(error: unknown, target: string): unknown {
  if (!(error instanceof TypeError)) return error;
  let host = target;
  try {
    host = new URL(target).host;
  } catch {
    // Not a URL that parses — report it as given rather than losing it.
  }
  return Object.assign(new TypeError(`${error.message} (could not reach ${host})`), { cause: error });
}

export function resetSupabaseClientForTests(): void {
  client = null;
  clientKey = null;
  realtimeClient = null;
  realtimeKey = null;
}
