import type { ICurrentUserProvider } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolves the signed-in user id from a Supabase browser session. */
export class SupabaseSessionProvider implements ICurrentUserProvider {
  private cached: string | null | undefined;
  private inFlight: Promise<string | null> | null = null;
  /**
   * Bumped on every auth change. A lookup started under an older generation
   * belongs to the previous session: its answer is not cached, and it does not
   * clear the lookup that replaced it.
   */
  private generation = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly db: SupabaseClient) {
    // The verified id only changes when the session does; drop the cache then.
    const { data } = this.db.auth.onAuthStateChange(() => {
      this.generation += 1;
      this.cached = undefined;
      this.inFlight = null;
    });
    this.unsubscribe = () => data.subscription.unsubscribe();
  }

  async getCurrentUserId(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached;
    if (this.inFlight) return this.inFlight;

    const generation = this.generation;
    const lookup = this.db.auth
      .getUser()
      .then(({ data, error }) => {
        const id = error || !data.user ? null : data.user.id;
        if (generation === this.generation) this.cached = id;
        return id;
      })
      .finally(() => {
        if (this.inFlight === lookup) this.inFlight = null;
      });
    this.inFlight = lookup;
    return lookup;
  }

  async requireUserId(): Promise<string> {
    const id = await this.getCurrentUserId();
    if (!id) throw new Error("Not signed in.");
    return id;
  }

  /**
   * Stop listening. A provider is built per container on a shared client, so
   * without this every rebuilt container left a listener behind.
   */
  dispose(): void {
    this.unsubscribe();
  }
}
