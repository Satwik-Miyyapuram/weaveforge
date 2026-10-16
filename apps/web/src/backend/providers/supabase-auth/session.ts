import type { ICurrentUserProvider } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolves the signed-in user id from a Supabase browser session. */
export class SupabaseSessionProvider implements ICurrentUserProvider {
  private cached: string | null | undefined;
  private inFlight: Promise<string | null> | null = null;

  constructor(private readonly db: SupabaseClient) {
    // The verified id only changes when the session does; drop the cache then.
    this.db.auth.onAuthStateChange(() => {
      this.cached = undefined;
      this.inFlight = null;
    });
  }

  async getCurrentUserId(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.db.auth
      .getUser()
      .then(({ data, error }) => {
        const id = error || !data.user ? null : data.user.id;
        this.cached = id;
        return id;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async requireUserId(): Promise<string> {
    const id = await this.getCurrentUserId();
    if (!id) throw new Error("Not signed in.");
    return id;
  }
}
