import { createClient } from "@supabase/supabase-js";
import type { IAdminUserProvisioner, Member, ProvisionUserInput, Role } from "@thesis/core";

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
  ) {}

  private admin() {
    return createClient(this.url, this.serviceRoleKey, { auth: { persistSession: false } });
  }

  async resolveCaller(accessToken: string): Promise<Member | null> {
    const admin = this.admin();
    const { data: caller, error: callerErr } = await admin.auth.getUser(accessToken);
    if (callerErr || !caller.user) return null;

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("user_id, email, full_name, role, supervisor_id")
      .eq("user_id", caller.user.id)
      .maybeSingle();
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
