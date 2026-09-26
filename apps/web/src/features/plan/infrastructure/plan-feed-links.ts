import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import { encodeBase64, encodeBytea } from "@/lib/bytea";
import { formatError } from "@/lib/format-error";
import { randomBytes } from "@/lib/system";

/**
 * The link a calendar subscribes to and a widget reads: one per account.
 *
 * Minted here, in the client, rather than by an API route, because the desktop
 * app has no API routes. That is safe for the same reason the server can mint
 * one: the row goes in through the owner's own session and the
 * `api_tokens_owner_all` policy, only the SHA-256 of the token is stored, and
 * the scope `plan_feed` is the only thing `resolve_plan_feed_token` (0137)
 * answers for. The plaintext exists once, in the value `create` returns.
 *
 * The feed itself is served by the web deployment, so on the desktop the link
 * points there rather than at this window's own origin.
 */

export const PLAN_FEED_SCOPE = "plan_feed";

/** Same shape as the server's `generateApiToken`: `tt_` + 32 random bytes, base64url. */
const TOKEN_PREFIX = "tt_";

export interface PlanFeedLink {
  id: string;
  /** First characters of the token, for recognising it; never the token. */
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PlanFeedUrls {
  /** Opens straight in a calendar app. */
  webcal: string;
  /** The same feed over https, for calendars that ask for a URL. */
  ics: string;
  /** Widget data. */
  widget: string;
}

export interface PlanFeedOptionsInput {
  includeDone?: boolean;
  reminderDays?: number;
}

const DEFAULT_FEED_ORIGIN = "https://app.weaveforge.org";

/** Where the feed is served: this origin on the web, the web deployment elsewhere. */
export function planFeedOrigin(serverRoutes: boolean, here?: string): string {
  if (serverRoutes && here && /^https?:\/\//.test(here)) return here;
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  try {
    return configured ? new URL(configured).origin : DEFAULT_FEED_ORIGIN;
  } catch {
    return DEFAULT_FEED_ORIGIN;
  }
}

export function planFeedUrls(origin: string, token: string, options: PlanFeedOptionsInput = {}): PlanFeedUrls {
  const base = `${origin}/api/plan/feed/${encodeURIComponent(token)}`;
  const query = new URLSearchParams();
  if (options.includeDone) query.set("done", "1");
  if (options.reminderDays && options.reminderDays > 0) query.set("alarm", String(Math.floor(options.reminderDays)));
  const suffix = query.toString() ? `?${query}` : "";
  const ics = `${base}/deadlines.ics${suffix}`;
  return {
    ics,
    webcal: ics.replace(/^https?:/, "webcal:"),
    widget: `${base}/widget.json${options.includeDone ? "?done=1" : ""}`,
  };
}

interface Row {
  id: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export class PlanFeedLinks {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  /** The current link, if there is one. */
  async current(): Promise<PlanFeedLink | null> {
    const { data, error } = await this.db
      .from("api_tokens")
      .select("id,token_prefix,created_at,last_used_at")
      .contains("scopes", [PLAN_FEED_SCOPE])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(formatError(error));
    const row = (data as Row[] | null)?.[0];
    return row
      ? { id: row.id, tokenPrefix: row.token_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at }
      : null;
  }

  /**
   * A new link, replacing any old one: an old link stops working the moment
   * this returns. The token is returned once and not kept anywhere.
   */
  async create(): Promise<{ link: PlanFeedLink; token: string }> {
    const userId = await this.session.requireUserId();
    const body = encodeBase64(await randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${TOKEN_PREFIX}${body}`;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
    await this.revoke();
    const { data, error } = await this.db
      .from("api_tokens")
      .insert({
        user_id: userId,
        name: "Calendar and widget link",
        token_hash: encodeBytea(hash),
        token_prefix: `${token.slice(0, TOKEN_PREFIX.length + 8)}…`,
        scopes: [PLAN_FEED_SCOPE],
        expires_at: null,
      })
      .select("id,token_prefix,created_at,last_used_at")
      .single();
    if (error) throw new Error(formatError(error));
    const row = data as Row;
    return {
      token,
      link: { id: row.id, tokenPrefix: row.token_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at },
    };
  }

  /** Turn the link off. Calendars subscribed to it get a 404 and stop updating. */
  async revoke(): Promise<void> {
    const { error } = await this.db.from("api_tokens").delete().contains("scopes", [PLAN_FEED_SCOPE]);
    if (error) throw new Error(formatError(error));
  }
}
