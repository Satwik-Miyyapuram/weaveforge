import { NextResponse } from "next/server";
import { createRestClient } from "@/backend/providers/supabase/client";
import { readBackendConfig } from "@/backend/config";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { hashApiToken, isApiTokenFormat } from "@/features/settings/infrastructure/api-token-crypto";
import { encodeBytea } from "@/lib/bytea";
import { formatError } from "@/lib/format-error";
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
 * themselves (migrations 0072 and 0130); this exists because a `create or
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
async function apiTokenScopes(token: string): Promise<string[]> {
  const cfg = readBackendConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error("Missing server config for API token scope resolution.");
  }
  const admin = createRestClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.rpc("api_token_scopes", {
    p_token_hash: encodeBytea(hashApiToken(token)),
  });
  // Thrown rather than treated as "no scopes": an unreachable database is an
  // outage (500/503), not an invalid token (401), and conflating them would
  // tell a caller with a perfectly good token to go and mint another one.
  if (error) throw error;
  return Array.isArray(data) ? (data as string[]) : [];
}

/**
 * 401 for anything the SDK surface will not accept.
 *
 * One wording for every reason — unknown token, expired token, wrong scope —
 * so a caller holding a relay token learns nothing about *why* it was refused
 * here. The scope is not a secret the holder lacks: it is in their own token
 * list. The body is the same anyway, and one response is one thing to keep
 * consistent.
 */
function refusedApiToken(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: "Invalid or expired API token." }, { status: 401 }),
  };
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

export async function requireSdkUser(request: Request): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  try {
    let accessToken = token;

    if (isApiTokenFormat(token)) {
      const scopes = await apiTokenScopes(token);
      if (!scopes.includes(SDK_SCOPE)) return refusedApiToken();

      const svc = apiTokenService();
      const minted = await svc.resolveSdkAccessToken(token);
      if (!minted) return refusedApiToken();
      accessToken = minted;
    } else if (!looksLikeJwt(token)) {
      // Not an API token and not a JWT: no session could ever match it, and
      // asking Supabase would only turn a bad credential into a server error.
      return { ok: false, response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
    }

    const db = sdkDbForUserToken(accessToken);
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user?.id) {
      return { ok: false, response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
    }
    return { ok: true, db, userId: data.user.id, accessToken };
  } catch (err) {
    const message = formatError(err);
    const status = message.includes("SUPABASE_JWT_SECRET") ? 503 : 500;
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }
}

/** Relay endpoints accept a normal browser session or a relay-only MCP token. */
export async function requireMcpRelayUser(request: Request): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!isApiTokenFormat(token)) return requireSdkUser(request);
  try {
    // The mirror of the check in `requireSdkUser`: a browser session is not an
    // API token and never reaches here, so an SDK token must not be accepted
    // for relay work either. `resolve_mcp_relay_token` already filters on this
    // scope; this is the same second check on the other side of the seam.
    const scopes = await apiTokenScopes(token);
    if (!scopes.includes(MCP_RELAY_SCOPE)) {
      return { ok: false, response: NextResponse.json({ error: "Invalid or expired MCP token." }, { status: 401 }) };
    }

    const accessToken = await apiTokenService().resolveMcpRelayAccessToken(token);
    if (!accessToken) return { ok: false, response: NextResponse.json({ error: "Invalid or expired MCP token." }, { status: 401 }) };
    const db = sdkDbForUserToken(accessToken);
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user?.id) return { ok: false, response: NextResponse.json({ error: "Invalid MCP token." }, { status: 401 }) };
    return { ok: true, db, userId: data.user.id, accessToken };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: formatError(error) }, { status: 503 }) };
  }
}
