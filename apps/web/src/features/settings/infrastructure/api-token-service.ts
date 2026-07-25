import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { missingConfigMessage, readBackendConfig } from "@/backend/config";
import { encodeBytea } from "@/lib/bytea";
import {
  expiryFromDays,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
} from "./api-token-crypto";
import { signSupabaseAccessJwt } from "./sign-supabase-jwt";
import { formatError } from "@/lib/format-error";

export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  scopes: readonly string[];
}

interface ApiTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  scopes: string[] | null;
}

function mapRow(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    scopes: row.scopes ?? [],
  };
}

/** Server-side token management (session + service role). */
export class ApiTokenService {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly serviceRoleKey: string,
    private readonly jwtSecret?: string,
  ) {}

  private admin(): SupabaseClient {
    return createClient(this.url, this.serviceRoleKey, { auth: { persistSession: false } });
  }

  private userClient(accessToken: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  async resolveUserId(accessToken: string): Promise<string | null> {
    const { data, error } = await this.admin().auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user.id;
  }

  async listTokens(accessToken: string): Promise<ApiTokenRecord[]> {
    const userId = await this.resolveUserId(accessToken);
    if (!userId) throw new Error("Invalid session.");

    const { data, error } = await this.userClient(accessToken)
      .from("api_tokens")
      .select("id, name, token_prefix, expires_at, last_used_at, created_at, scopes")
      .order("created_at", { ascending: false });
    if (error) throw new Error(formatError(error));
    return (data ?? []).map((row) => mapRow(row as ApiTokenRow));
  }

  async createToken(
    accessToken: string,
    name: string,
    expiresInDays?: number | null,
  ): Promise<{ record: ApiTokenRecord; plaintext: string }> {
    const userId = await this.resolveUserId(accessToken);
    if (!userId) throw new Error("Invalid session.");

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Token name is required.");

    const generated = generateApiToken();
    const expiresAt = expiryFromDays(expiresInDays);

    const { data, error } = await this.userClient(accessToken)
      .from("api_tokens")
      .insert({
        user_id: userId,
        name: trimmed,
        token_hash: encodeBytea(generated.hash),
        token_prefix: generated.prefix,
        expires_at: expiresAt,
        scopes: ["sdk"],
      })
      .select("id, name, token_prefix, expires_at, last_used_at, created_at, scopes")
      .single();
    if (error) throw new Error(formatError(error));
    return { record: mapRow(data as ApiTokenRow), plaintext: generated.plaintext };
  }

  async createMcpRelayToken(accessToken: string, name: string): Promise<{ record: ApiTokenRecord; plaintext: string }> {
    const userId = await this.resolveUserId(accessToken);
    if (!userId) throw new Error("Invalid session.");
    const generated = generateApiToken();
    const { data, error } = await this.userClient(accessToken).from("api_tokens").insert({
      user_id: userId, name: name.trim() || "Codex MCP connection", token_hash: encodeBytea(generated.hash),
      token_prefix: generated.prefix, scopes: ["mcp_relay"], expires_at: null,
    }).select("id, name, token_prefix, expires_at, last_used_at, created_at, scopes").single();
    if (error) throw new Error(formatError(error));
    return { record: mapRow(data as ApiTokenRow), plaintext: generated.plaintext };
  }

  async listMcpRelayTokens(accessToken: string): Promise<ApiTokenRecord[]> {
    const tokens = await this.listTokens(accessToken);
    return tokens.filter((token) => token.scopes.length === 1 && token.scopes[0] === "mcp_relay");
  }

  async revokeToken(accessToken: string, tokenId: string): Promise<void> {
    const userId = await this.resolveUserId(accessToken);
    if (!userId) throw new Error("Invalid session.");

    const { error, count } = await this.userClient(accessToken)
      .from("api_tokens")
      .delete({ count: "exact" })
      .eq("id", tokenId);
    if (error) throw new Error(formatError(error));
    if (!count) throw new Error("Token not found.");
  }

  /** Resolve personal access token → short-lived Supabase JWT for SDK routes. */
  async resolveSdkAccessToken(apiToken: string): Promise<string | null> {
    if (!isApiTokenFormat(apiToken)) return null;
    if (!this.jwtSecret) {
      throw new Error("Server is missing SUPABASE_JWT_SECRET for API token auth.");
    }

    const hash = hashApiToken(apiToken);
    const { data, error } = await this.admin().rpc("resolve_api_token", {
      p_token_hash: encodeBytea(hash),
    });
    if (error) throw new Error(formatError(error));
    const userId = typeof data === "string" ? data : null;
    if (!userId) return null;
    return signSupabaseAccessJwt(userId, this.jwtSecret);
  }

  async resolveMcpRelayAccessToken(apiToken: string): Promise<string | null> {
    if (!isApiTokenFormat(apiToken) || !this.jwtSecret) return null;
    const { data, error } = await this.admin().rpc("resolve_mcp_relay_token", { p_token_hash: encodeBytea(hashApiToken(apiToken)) });
    if (error) throw new Error(formatError(error));
    return typeof data === "string" ? signSupabaseAccessJwt(data, this.jwtSecret) : null;
  }
}

export function apiTokenService(): ApiTokenService {
  const cfg = readBackendConfig();
  const missing = missingConfigMessage(cfg, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]);
  if (missing || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.supabaseServiceRoleKey) {
    throw new Error(missing ?? "Missing server config.");
  }
  return new ApiTokenService(
    cfg.supabaseUrl,
    cfg.supabaseAnonKey,
    cfg.supabaseServiceRoleKey,
    cfg.supabaseJwtSecret,
  );
}
