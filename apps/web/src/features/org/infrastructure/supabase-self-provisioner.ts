import type { SupabaseClient } from "@supabase/supabase-js";
import { type ISelfProvisioner } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";

/**
 * Users already known to be provisioned, for this tab's lifetime.
 *
 * Startup calls `ensureProvisioned()` on every boot, and once it has succeeded
 * the answer cannot change. Paying a round trip to re-learn it would undo the
 * point of running the call in parallel with the settings read.
 */
const provisioned = new Set<string>();

/**
 * Materialises the signed-in user's identity rows via a single RPC.
 *
 * `ensure_user_provisioned()` is `security definer` and derives everything from
 * `auth.uid()`, so this call carries no arguments — there is deliberately no
 * way for a client to ask for anyone else's rows.
 */
export class SupabaseSelfProvisioner implements ISelfProvisioner {
  constructor(private readonly db: SupabaseClient) {}

  async ensureProvisioned(): Promise<void> {
    const { data } = await this.db.auth.getSession();
    const userId = data.session?.user.id;
    // No session means nothing to provision; the caller is on the login screen.
    if (!userId || provisioned.has(userId)) return;

    const { error } = await this.db.rpc("ensure_user_provisioned");
    if (error) throw new Error(`Could not set up your account: ${formatError(error)}`);
    provisioned.add(userId);
  }
}

/** Test seam — the memo outlives any one instance. */
export function resetSelfProvisioningMemoForTests(): void {
  provisioned.clear();
}
