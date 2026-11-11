import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IAdminUserProvisioner,
  ICurrentUserProvider,
  Member,
  ProvisionUserInput,
  Role,
} from "@weaveforge/core";
import { createRestClient } from "../postgrest/parts-1";

// --- admin-provisioner ---
interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  supervisor_id: string | null;
}

function toMember(row: ProfileRow): Member {
  return {
    id: row.user_id,
    email: row.email ?? undefined,
    fullName: row.full_name ?? undefined,
    role: row.role,
    supervisorId: row.supervisor_id ?? undefined,
  };
}

/** Supabase Admin API implementation of {@link IAdminUserProvisioner}. */
export class SupabaseAdminUserProvisioner implements IAdminUserProvisioner {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    /* Injected by tests; production builds a service-role REST client. */
    private readonly makeClient: () => ReturnType<typeof createRestClient> = () =>
      createRestClient(this.url, this.serviceRoleKey, { auth: { persistSession: false } }),
  ) {}

  private admin() {
    return this.makeClient();
  }

  async resolveCaller(accessToken: string): Promise<Member | null> {
    const admin = this.admin();
    const { data: caller, error: callerErr } = await admin.auth.getUser(accessToken);
    if (callerErr || !caller.user) return null;

    const { data: callerProfile, error: profileErr } = await admin
      .from("profiles")
      .select("user_id, email, full_name, role, supervisor_id")
      .eq("user_id", caller.user.id)
      .maybeSingle();
    /* A failed read is not "no profile": that would turn an outage into 401/403. */
    if (profileErr) throw new Error(profileErr.message);
    if (!callerProfile) return null;
    return toMember(callerProfile as ProfileRow);
  }

  async provisionUser(input: ProvisionUserInput): Promise<Member> {
    const admin = this.admin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: input.fullName ? { full_name: input.fullName } : undefined,
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Failed to create user.");
    }

    const { error: profileErr } = await admin.from("profiles").upsert({
      user_id: created.user.id,
      email: input.email,
      full_name: input.fullName ?? null,
      role: input.role,
      supervisor_id: input.supervisorId ?? null,
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(profileErr.message);
    }

    return {
      id: created.user.id,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      supervisorId: input.supervisorId,
    };
  }

  async deleteOwnAccount(accessToken: string): Promise<void> {
    const admin = this.admin();
    const { data: caller, error: callerErr } = await admin.auth.getUser(accessToken);
    if (callerErr || !caller.user) {
      throw new Error("Invalid session.");
    }
    const userId = caller.user.id;

    const { purgeUserBlobs } = await import("@/backend/account/purge-user-blobs");
    await purgeUserBlobs(admin, userId);

    const { error: rpcErr } = await admin.rpc("delete_user_account_data", { p_user_id: userId });
    if (rpcErr) throw new Error(rpcErr.message);

    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) throw new Error(deleteErr.message);
  }
}

// --- session ---
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
