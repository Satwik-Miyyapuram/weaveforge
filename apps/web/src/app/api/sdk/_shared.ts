import { NextResponse } from "next/server";
import { createRestClient } from "@/backend/providers/supabase/client";
import { readBackendConfig } from "@/backend/config";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { hashApiToken, isApiTokenFormat } from "@/features/settings/infrastructure/api-token-crypto";
import { encodeBytea } from "@/lib/bytea";
import { formatError, formatErrorForResponse } from "@/lib/format-error";
import { bearerToken } from "@/lib/bearer-token";

/**
 * The two scopes this API mints, and the only two it knows about.
 *
 * `api_tokens.scopes` is a `text[]`, so nothing in the database stops a third
 * value existing; the routes are what decide which value a given surface
 * accepts. Named here rather than left as string literals at the call sites so
 * the SDK surface and the relay surface cannot drift onto different spellings.
 */
const SDK_SCOPE = "sdk";
const MCP_RELAY_SCOPE = "mcp_relay";

export function sdkDbForUserToken(token: string) {
  const cfg = readBackendConfig();
  const url = cfg.supabaseUrl;
  const anonKey = cfg.supabaseAnonKey;
  if (!url || !anonKey) throw new Error("Missing Supabase URL or anon key.");
  return createRestClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // API routes are stateless. Prevent supabase-js from attempting to restore
    // or refresh an unrelated server-side session instead of this request's
    // verified bearer token.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * The scopes stored against an API token, read before any JWT is minted for it.
 *
 * This is the application half of the scope check. The database half is
 * `resolve_api_token` / `resolve_mcp_relay_token`, which filter on scope
 * themselves (migrations 0072 and 0129); this exists because a `create or
 * replace` swaps a function's whole body, so a future edit that drops the
 * `scopes` predicate would re-open the seam silently — and the symptom is a
 * relay token, handed to third-party MCP software by design, also
 * authenticating `GET /api/settings/credentials` and the SDK routes. A
 * regression like that produces no failing test and no error; it just works,
 * for the wrong caller.
 *
 * Read first, deliberately: a token of the wrong scope never gets a JWT, never
 * updates `last_used_at` and never touches a route's database handle. The cost
 * is one indexed lookup on a route that is about to make at least two more.
 *
 * `api_token_scopes()` rather than a table read because a `bytea` hash is
 * resolved through an RPC everywhere in this schema; it is a function of its
 * own so that one edit cannot weaken both halves of the check at once.
 */
/**
 * The service-role client, built once per configuration.
 *
 * `createRestClient` sets up auth state, a realtime channel map and a fetch
 * wrapper. Building one per request is wasted work on a route that is in front
 * of every SDK call, and the Python SDK's metric flush pays it each time.
 *
 * Keyed to the URL and key it was built from rather than cached unconditionally:
 * `client.ts` documents that these clients carry per-request credentials and are
 * not singletons, and the tests point the environment at a stub per case — a
 * cache that ignored the config would keep talking to whichever database was
 * configured first.
 */
let cachedAdmin: { key: string; client: ReturnType<typeof createRestClient> } | null = null;

function adminClientFor(cfg: { supabaseUrl?: string; supabaseServiceRoleKey?: string }) {
  const key = `${cfg.supabaseUrl}\u0000${cfg.supabaseServiceRoleKey}`;
  if (cachedAdmin?.key !== key) {
    cachedAdmin = {
      key,
      client: createRestClient(cfg.supabaseUrl!, cfg.supabaseServiceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return cachedAdmin.client;
}

async function apiTokenScopes(token: string): Promise<string[]> {
  const cfg = readBackendConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error("Missing server config for API token scope resolution.");
  }
  const { data, error } = await adminClientFor(cfg).rpc("api_token_scopes", {
    p_token_hash: encodeBytea(hashApiToken(token)),
  });
  // Thrown rather than treated as "no scopes": an unreachable database is an
  // outage (500/503), not an invalid token (401), and conflating them would
  // tell a caller with a perfectly good token to go and mint another one.
  if (error) throw error;
  return Array.isArray(data) ? (data as string[]) : [];
}

/**
 * The one authenticated-caller shape every API route in this app uses.
 *
 * `accessToken` is the JWT to hand to Supabase — the caller's own bearer token
 * when they brought a session, or the short-lived one minted for an API token.
 * It is *not* the value from the header: an `tt_…` API token is not a JWT and
 * passing it on would fail at the first query. Routes that call a Supabase
 * helper directly (the storage layer builds its client from a token) need this,
 * which is why it is part of the result rather than reconstructed per route.
 */
export interface ApiCaller {
  db: ReturnType<typeof sdkDbForUserToken>;
  userId: string;
  accessToken: string;
}

export type ApiAuthResult = ({ ok: true } & ApiCaller) | { ok: false; response: NextResponse };

/**
 * 401 for anything a surface will not accept.
 *
 * One wording for every reason — unknown token, expired token, wrong scope — so
 * a caller holding a token for the *other* surface learns nothing about why it
 * was refused. The scope is not a secret the holder lacks: it is in their own
 * token list. One response is also one thing to keep consistent.
 */
const API_TOKEN_REFUSED = "Invalid or expired API token.";
const MCP_RELAY_REFUSED = "Invalid or expired MCP token.";
const SESSION_REFUSED = "Invalid session.";

function refused(message: string): ApiAuthResult {
  return { ok: false, response: NextResponse.json({ error: message }, { status: 401 }) };
}

/**
 * Whether a credential could be a Supabase session JWT.
 *
 * An access token is a JWT: three dot-separated base64url segments. Anything
 * else cannot be one, so it is refused here rather than handed to
 * `auth.getUser()`.
 *
 * That is not only an optimisation. On a deployment with no Supabase URL
 * configured, building the client throws and the caller is answered `500` —
 * which reports "your credential is unusable" as "our server is broken". Those
 * are different problems with different fixes, and `fetch-url`'s own test
 * pins the distinction: an unusable token is a `401`, a configuration fault is
 * not. Deciding the shape locally keeps `401` meaning "this credential cannot
 * work" and `500`/`503` meaning "we cannot check anything right now".
 *
 * A shape test, not a signature check: verifying the signature is Supabase's
 * job, and a well-formed but forged token still fails there.
 */
function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

/**
 * The second half of both flows: mint if needed, verify, or refuse.
 *
 * The two surfaces differ in which credential they accept and which scope it
 * must carry; they do not differ in what happens next, and that next part was
 * written out twice — mint, build the client from the minted token, ask Supabase
 * who it is, answer in the caller shape. Two copies of a security-relevant
 * sequence is one copy that can be edited and one that cannot: the relay's had
 * already drifted on the failure status below.
 */
async function verifyCaller(
  token: string,
  mint: (token: string) => Promise<string | null>,
  refusal: string,
): Promise<ApiAuthResult> {
  const accessToken = await mint(token);
  if (!accessToken) return refused(refusal);

  const db = sdkDbForUserToken(accessToken);
  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data.user?.id) return refused(refusal);
  return { ok: true, db, userId: data.user.id, accessToken };
}

/**
 * A failure that is not the caller's fault: an outage, or a bug of ours.
 *
 * The distinction is read from the error itself, but the *body* is not: a route
 * response is not a log line, and `formatError` is the display formatter — for a
 * PostgREST error it joins `message — details — hint (code)`, which names tables,
 * constraints and SQLSTATEs to whoever holds a token. `formatErrorForResponse`
 * keeps that detail in the server log and answers with stable wording, which is
 * the convention every other route follows.
 *
 * One policy for both surfaces. The relay surface used to answer `503` for
 * *every* failure, so a bug of ours — a null dereference, a bad RPC name —
 * reached clients as "try again later", which is the one answer that will not
 * help them. `SUPABASE_JWT_SECRET` missing is still an outage; everything else is
 * a `500`.
 */
function authFailure(error: unknown, surface: "api-auth" | "mcp-relay-auth"): ApiAuthResult {
  const status = formatError(error).includes("SUPABASE_JWT_SECRET") ? 503 : 500;
  return {
    ok: false,
    response: NextResponse.json({ error: formatErrorForResponse(error, surface) }, { status }),
  };
}

export async function requireSdkUser(request: Request): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) return refused("Not authenticated.");
  try {
    if (isApiTokenFormat(token)) {
      // Read first, deliberately: a token of the wrong scope never gets a JWT,
      // never updates `last_used_at` and never touches a route's database handle.
      const scopes = await apiTokenScopes(token);
      if (!scopes.includes(SDK_SCOPE)) return refused(API_TOKEN_REFUSED);
      return await verifyCaller(
        token,
        (value) => apiTokenService().resolveSdkAccessToken(value),
        API_TOKEN_REFUSED,
      );
    }
    // Not an API token and not a JWT: no session could ever match it, and asking
    // Supabase would only turn a bad credential into a server error.
    if (!looksLikeJwt(token)) return refused(SESSION_REFUSED);
    // A session is already its own access token; there is nothing to mint.
    return await verifyCaller(token, async (value) => value, SESSION_REFUSED);
  } catch (err) {
    return authFailure(err, "api-auth");
  }
}

/** Relay endpoints accept a normal browser session or a relay-only MCP token. */
export async function requireMcpRelayUser(request: Request): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) return refused("Not authenticated.");
  // A browser session is not an API token, and the SDK path already knows how to
  // check one — including the JWT shape test that keeps a bad credential a 401.
  if (!isApiTokenFormat(token)) return requireSdkUser(request);
  try {
    // The mirror of the check in `requireSdkUser`: a browser session never
    // reaches here, so an SDK token must not be accepted for relay work either.
    // `resolve_mcp_relay_token` already filters on this scope; this is the same
    // second check on the other side of the seam.
    const scopes = await apiTokenScopes(token);
    if (!scopes.includes(MCP_RELAY_SCOPE)) return refused(MCP_RELAY_REFUSED);
    return await verifyCaller(
      token,
      (value) => apiTokenService().resolveMcpRelayAccessToken(value),
      MCP_RELAY_REFUSED,
    );
  } catch (error) {
    return authFailure(error, "mcp-relay-auth");
  }
}
