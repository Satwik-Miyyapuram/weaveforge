import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";

import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { formatError } from "@/lib/format-error";
import { randomBytes } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import type { PlanFeedUrls } from "@weaveforge/wasm";

export type { PlanFeedUrls };

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

export interface PlanFeedOptionsInput {
  includeDone?: boolean;
  reminderDays?: number;
}

/** Where the feed is served: this origin on the web, the web deployment elsewhere. */
export function planFeedOrigin(serverRoutes: boolean, here?: string): string {
  return readyCore().planFeedOrigin(serverRoutes, here, process.env.NEXT_PUBLIC_APP_URL);
}

/** The `api_tokens` queries, planned by Rust (`crates/wf-core/src/repos/plan_feed_links.rs`). */
interface PlanFeedLinkStore {
  current(): Promise<PlanFeedLink | null>;
  create(tokenHash: string, tokenPrefix: string): Promise<PlanFeedLink>;
  revoke(): Promise<void>;
}

/** Runs `op`, giving a PostgREST error a readable message. */
async function readable<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (error) {
    throw error instanceof Error ? error : new Error(formatError(error));
  }
}

export class PlanFeedLinks {
  private readonly store: PlanFeedLinkStore;

  constructor(
    db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {
    this.store = rustRepository<PlanFeedLinkStore>(db, "plan_feed_links", ["current", "create", "revoke"], async () => ({
      userId: (await session.getCurrentUserId()) ?? undefined,
    }));
  }

  /** The current link, if there is one. */
  current(): Promise<PlanFeedLink | null> {
    return readable(this.store.current());
  }

  /**
   * A new link, replacing any old one: an old link stops working the moment
   * this returns. The token is returned once and not kept anywhere; only its
   * SHA-256 is stored. Rust inserts first, then removes the others.
   */
  async create(): Promise<{ link: PlanFeedLink; token: string }> {
    await this.session.requireUserId();
    const body = readyCore().encodeBase64(await randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${TOKEN_PREFIX}${body}`;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
    const link = await readable(
      this.store.create(readyCore().encodeBytea(hash), `${token.slice(0, TOKEN_PREFIX.length + 8)}…`),
    );
    return { token, link };
  }

  /** Turn the link off. Calendars subscribed to it get a 404 and stop updating. */
  revoke(): Promise<void> {
    return readable(this.store.revoke());
  }
}
