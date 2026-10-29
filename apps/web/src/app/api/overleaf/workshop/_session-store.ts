import type { ApiCaller } from "@/app/api/sdk/_shared";
import { loadWorkshopSessionCookies, type WorkshopSessionStore } from "@/features/overleaf/infrastructure/overleaf-workshop-session";

const TABLE = "overleaf_workshop_sessions";

/**
 * Postgres-backed session store. Runs as the signed-in user (RLS applies) and
 * also filters by user_id. Errors are generic so no database text reaches the client.
 */
export function pgrestWorkshopSessionStore(db: ApiCaller["db"], userId: string): WorkshopSessionStore {
  return {
    async save(cookieCiphertext) {
      const { data, error } = await db.from(TABLE)
        .insert({ user_id: userId, cookie_ciphertext: cookieCiphertext })
        .select("id").single();
      if (error || !data) throw new Error("Could not save the Overleaf session.");
      return data.id as string;
    },
    async loadCiphertext(sessionId) {
      const { data, error } = await db.from(TABLE)
        .select("cookie_ciphertext").eq("id", sessionId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error("Could not load the Overleaf session.");
      return data ? (data.cookie_ciphertext as string) : null;
    },
    async remove(sessionId) {
      const { error } = await db.from(TABLE).delete().eq("id", sessionId).eq("user_id", userId);
      if (error) throw new Error("Could not remove the Overleaf session.");
    },
  };
}

/** Resolves a session id to its decrypted cookie for this user, or null when none matches. */
export function cookiesForSession(auth: ApiCaller, sessionId: string): Promise<string | null> {
  return loadWorkshopSessionCookies(pgrestWorkshopSessionStore(auth.db, auth.userId), sessionId);
}
