import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IAdminUserProvisioner,
  ICurrentUserProvider,
  Member,
  ProvisionUserInput,
  Role,
} from "@weaveforge/core";
import { createRestClient } from "../postgrest/parts-1";
import { rustRepository } from "../postgrest/rust-repository";

// --- admin-provisioner ---
/** The profile queries Rust plans (`crates/wf-core/src/repos/account.rs`). */
interface AccountRepository {
  profile(userId: string): Promise<Member | null>;
  saveProfile(input: { userId: string; email: string; fullName?: string; role: Role; supervisorId?: string }): Promise<void>;
  deleteData(userId: string): Promise<void>;
}

function accountRepository(db: SupabaseClient): AccountRepository {
  return rustRepository<AccountRepository>(db, "account", ["profile", "saveProfile", "deleteData"]);
}

/** The database's own message: the sender rejects with the raw PostgREST error object. */
function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  const message = (err as { message?: unknown } | null)?.message;
  return new Error(typeof message === "string" ? message : String(err));
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

    /* A failed read is not "no profile": that would turn an outage into 401/403. */
    return accountRepository(admin as SupabaseClient).profile(caller.user.id).catch((err: unknown) => {
      throw asError(err);
    });
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

    try {
      await accountRepository(admin as SupabaseClient).saveProfile({
        userId: created.user.id,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        supervisorId: input.supervisorId,
      });
    } catch (err) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw asError(err);
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

    await accountRepository(admin as SupabaseClient).deleteData(userId).catch((err: unknown) => {
      throw asError(err);
    });

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
