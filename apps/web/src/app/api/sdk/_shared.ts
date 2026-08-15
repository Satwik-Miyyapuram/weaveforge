import { NextResponse } from "next/server";
import { createRestClient } from "@/backend/providers/supabase/client";
import { readBackendConfig } from "@/backend/config";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { isApiTokenFormat } from "@/features/settings/infrastructure/api-token-crypto";
import { formatError } from "@/lib/format-error";

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

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

export async function requireSdkUser(request: Request): Promise<
  | { ok: true; db: ReturnType<typeof sdkDbForUserToken>; userId: string }
  | { ok: false; response: NextResponse }
> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  try {
    let accessToken = token;

    if (isApiTokenFormat(token)) {
      const svc = apiTokenService();
      const minted = await svc.resolveSdkAccessToken(token);
      if (!minted) {
        return { ok: false, response: NextResponse.json({ error: "Invalid or expired API token." }, { status: 401 }) };
      }
      accessToken = minted;
    }

    const db = sdkDbForUserToken(accessToken);
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user?.id) {
      return { ok: false, response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
    }
    return { ok: true, db, userId: data.user.id };
  } catch (err) {
    const message = formatError(err);
    const status = message.includes("SUPABASE_JWT_SECRET") ? 503 : 500;
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }
}

/** Relay endpoints accept a normal browser session or a relay-only MCP token. */
export async function requireMcpRelayUser(request: Request): Promise<
  | { ok: true; db: ReturnType<typeof sdkDbForUserToken>; userId: string }
  | { ok: false; response: NextResponse }
> {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!isApiTokenFormat(token)) return requireSdkUser(request);
  try {
    const accessToken = await apiTokenService().resolveMcpRelayAccessToken(token);
    if (!accessToken) return { ok: false, response: NextResponse.json({ error: "Invalid or expired MCP token." }, { status: 401 }) };
    const db = sdkDbForUserToken(accessToken);
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user?.id) return { ok: false, response: NextResponse.json({ error: "Invalid MCP token." }, { status: 401 }) };
    return { ok: true, db, userId: data.user.id };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: formatError(error) }, { status: 503 }) };
  }
}
