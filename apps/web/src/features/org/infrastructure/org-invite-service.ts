import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeOrgInviteCode,
  resolveOrgJoinAssignment,
  validateOrgName,
  type JoinOrgInput,
  type OrgInviteCodePlaintext,
  type OrgInviteRole,
  type OrgJoinSource,
  type Organization,
  OrgInviteValidationError,
  OrgValidationError,
} from "@thesis/core";
import {
  generateOrgInviteCode,
  hashOrgInviteCodeInput,
} from "@thesis/core/org-crypto";

interface CodeRow {
  id: string;
  org_id: string;
  target_role: OrgInviteRole;
  code_hash: string;
  revoked_at: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

interface MembershipRow {
  org_id: string;
  user_id: string;
  role: OrgInviteRole;
}

const ROLES: OrgInviteRole[] = ["professor", "phd", "masters"];

/** Server-side org operations (service role). */
export class OrgInviteService {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  private admin(): SupabaseClient {
    return createClient(this.url, this.serviceRoleKey, { auth: { persistSession: false } });
  }

  async resolveUserId(accessToken: string): Promise<string | null> {
    const { data, error } = await this.admin().auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user.id;
  }

  /** Ensure a profiles row exists (legacy users may predate auto-provisioning). */
  async ensureProfile(userId: string): Promise<void> {
    const admin = this.admin();
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser.user) {
      throw new OrgValidationError(authErr?.message ?? "User not found.");
    }
    const u = authUser.user;
    const { error } = await admin.from("profiles").upsert(
      {
        user_id: userId,
        email: u.email ?? null,
        full_name: (u.user_metadata?.full_name as string | undefined) ?? u.email ?? null,
        role: "masters",
        org_setup_complete: false,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async createOrganization(userId: string, nameInput: string): Promise<{
    organization: Organization;
    codes: OrgInviteCodePlaintext[];
  }> {
    await this.ensureProfile(userId);
    const name = validateOrgName(nameInput);
    const admin = this.admin();

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name, owner_id: userId })
      .select("*")
      .single();
    if (orgErr || !org) throw new OrgValidationError(orgErr?.message ?? "Failed to create lab.");

    const codes: OrgInviteCodePlaintext[] = [];
    for (const targetRole of ROLES) {
      const plaintext = await this.insertUniqueCode(admin, org.id, targetRole);
      codes.push({ targetRole, code: plaintext });
    }

    await this.upsertMembership(admin, {
      orgId: org.id,
      userId,
      role: "professor",
      supervisorId: null,
      joinedVia: "create",
    });

    await admin
      .from("profiles")
      .update({
        role: "professor",
        supervisor_id: null,
        active_org_id: org.id,
        org_setup_complete: true,
      })
      .eq("user_id", userId);

    return {
      organization: toOrg(org as OrgRow),
      codes,
    };
  }

  async joinOrganization(userId: string, input: JoinOrgInput): Promise<{ orgId: string }> {
    await this.ensureProfile(userId);
    const normalized = normalizeOrgInviteCode(input.code);
    if (!normalized) throw new OrgInviteValidationError("Enter a join code.");

    const admin = this.admin();
    const hash = hashOrgInviteCodeInput(normalized);
    const { data: codeRow, error: codeErr } = await admin
      .from("org_invite_codes")
      .select("*")
      .eq("code_hash", hash)
      .is("revoked_at", null)
      .maybeSingle();
    if (codeErr) throw codeErr;
    if (!codeRow) throw new OrgInviteValidationError("Invalid or expired join code.");

    const row = codeRow as CodeRow;
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("*")
      .eq("id", row.org_id)
      .single();
    if (orgErr || !org) throw new OrgInviteValidationError("Lab not found.");

    const { data: existing } = await admin
      .from("org_memberships")
      .select("id, joined_via")
      .eq("org_id", row.org_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing && (existing as { joined_via?: string }).joined_via !== "legacy") {
      throw new OrgInviteValidationError("You are already in this lab.");
    }

    const professors = await this.memberIdsForRole(admin, row.org_id, "professor");
    const phds = await this.memberIdsForRole(admin, row.org_id, "phd");
    if (professors.length === 0) professors.push((org as OrgRow).owner_id);

    const assignment = resolveOrgJoinAssignment(
      {
        targetRole: row.target_role,
        orgOwnerId: (org as OrgRow).owner_id,
        professorIds: professors,
        phdIds: phds,
      },
      input,
    );

    await this.upsertMembership(admin, {
      orgId: row.org_id,
      userId,
      role: assignment.role,
      supervisorId: assignment.supervisorId ?? null,
      joinedVia: "invite",
    });

    await admin
      .from("profiles")
      .update({
        role: assignment.role,
        supervisor_id: assignment.supervisorId ?? null,
        active_org_id: row.org_id,
        org_setup_complete: true,
      })
      .eq("user_id", userId);

    await admin
      .from("org_invite_codes")
      .update({
        use_count: ((codeRow as CodeRow & { use_count?: number }).use_count ?? 0) + 1,
      })
      .eq("id", row.id);

    return { orgId: row.org_id };
  }

  async previewCode(codeInput: string) {
    const normalized = normalizeOrgInviteCode(codeInput);
    const admin = this.admin();
    const { data: codeRow } = await admin
      .from("org_invite_codes")
      .select("org_id, target_role")
      .eq("code_hash", hashOrgInviteCodeInput(normalized))
      .is("revoked_at", null)
      .maybeSingle();
    if (!codeRow) return null;

    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", codeRow.org_id)
      .single();
    if (!org) return null;

    const professors = await this.memberIdsForRole(admin, codeRow.org_id, "professor");
    const phds = await this.memberIdsForRole(admin, codeRow.org_id, "phd");

    const names = async (ids: string[]) => {
      if (!ids.length) return [];
      const { data } = await admin
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", ids);
      return (data ?? []).map((p) => ({
        id: p.user_id as string,
        label: (p.full_name as string | null) ?? (p.email as string) ?? "Member",
      }));
    };

    return {
      orgName: org.name as string,
      targetRole: codeRow.target_role as OrgInviteRole,
      professors: codeRow.target_role === "phd" && professors.length > 1
        ? await names(professors)
        : undefined,
      phds: codeRow.target_role === "masters" ? await names(phds) : undefined,
    };
  }

  async listOwnedOrganizations(userId: string): Promise<Organization[]> {
    const { data, error } = await this.admin()
      .from("organizations")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as OrgRow[]).map(toOrg);
  }

  async listMemberships(userId: string): Promise<
    { orgId: string; orgName: string; role: OrgInviteRole; joinSource: OrgJoinSource }[]
  > {
    const { data, error } = await this.admin()
      .from("org_memberships")
      .select("org_id, role, joined_via, organizations(name)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => {
      const org = row.organizations as { name: string } | { name: string }[] | null;
      const name = Array.isArray(org) ? org[0]?.name : org?.name;
      const joinedVia = (row as { joined_via?: string }).joined_via;
      return {
        orgId: row.org_id as string,
        orgName: name ?? "Lab",
        role: row.role as OrgInviteRole,
        joinSource: joinedVia === "invite" || joinedVia === "create" ? joinedVia : "legacy",
      };
    });
  }

  async switchActiveOrganization(userId: string, orgId: string): Promise<void> {
    await this.ensureProfile(userId);
    const admin = this.admin();
    const { data: membership, error: memErr } = await admin
      .from("org_memberships")
      .select("role, supervisor_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) throw new OrgValidationError("Not a member of this lab.");

    const { error } = await admin
      .from("profiles")
      .update({
        active_org_id: orgId,
        role: membership.role as OrgInviteRole,
        supervisor_id: membership.supervisor_id,
        org_setup_complete: true,
      })
      .eq("user_id", userId);
    if (error) throw error;
  }

  async regenerateCode(
    userId: string,
    orgId: string,
    targetRole: OrgInviteRole,
  ): Promise<OrgInviteCodePlaintext> {
    const admin = this.admin();
    const { data: org } = await admin
      .from("organizations")
      .select("owner_id")
      .eq("id", orgId)
      .single();
    if (!org || org.owner_id !== userId) {
      throw new OrgValidationError("Only the lab owner can regenerate codes.");
    }

    await admin
      .from("org_invite_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("target_role", targetRole)
      .is("revoked_at", null);

    const code = await this.insertUniqueCode(admin, orgId, targetRole);
    return { targetRole, code };
  }

  private async insertUniqueCode(
    admin: SupabaseClient,
    orgId: string,
    targetRole: OrgInviteRole,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const plaintext = generateOrgInviteCode();
      const { error } = await admin.from("org_invite_codes").insert({
        org_id: orgId,
        target_role: targetRole,
        code_hash: hashOrgInviteCodeInput(normalizeOrgInviteCode(plaintext)),
      });
      if (!error) return plaintext;
      if (error.code !== "23505") throw error;
    }
    throw new OrgValidationError("Could not generate a unique code.");
  }

  private async upsertMembership(
    admin: SupabaseClient,
    input: {
      orgId: string;
      userId: string;
      role: OrgInviteRole;
      supervisorId: string | null;
      joinedVia: "create" | "invite";
    },
  ) {
    const { error } = await admin.from("org_memberships").upsert(
      {
        org_id: input.orgId,
        user_id: input.userId,
        role: input.role,
        supervisor_id: input.supervisorId,
        joined_via: input.joinedVia,
      },
      { onConflict: "org_id,user_id" },
    );
    if (error) throw error;
  }

  private async memberIdsForRole(
    admin: SupabaseClient,
    orgId: string,
    role: OrgInviteRole,
  ): Promise<string[]> {
    const { data } = await admin
      .from("org_memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("role", role);
    return (data as MembershipRow[] | null)?.map((r) => r.user_id) ?? [];
  }

  async leaveOrganization(userId: string, orgId: string): Promise<void> {
    await this.ensureProfile(userId);
    const admin = this.admin();

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("owner_id")
      .eq("id", orgId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org) throw new OrgValidationError("Lab not found.");
    if (org.owner_id === userId) {
      throw new OrgValidationError(
        "Lab owners cannot leave — delete the lab or transfer ownership first.",
      );
    }

    const { data: membership, error: memErr } = await admin
      .from("org_memberships")
      .select("role, supervisor_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) throw new OrgValidationError("Not a member of this lab.");

    const { error: delErr } = await admin
      .from("org_memberships")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId);
    if (delErr) throw delErr;

    const { data: profile } = await admin
      .from("profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profile?.active_org_id !== orgId) return;

    const { data: nextMembership } = await admin
      .from("org_memberships")
      .select("org_id, role, supervisor_id")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (nextMembership) {
      const { error: updErr } = await admin
        .from("profiles")
        .update({
          active_org_id: nextMembership.org_id,
          role: nextMembership.role,
          supervisor_id: nextMembership.supervisor_id,
          org_setup_complete: true,
        })
        .eq("user_id", userId);
      if (updErr) throw updErr;
      return;
    }

    const { error: standaloneErr } = await admin
      .from("profiles")
      .update({
        active_org_id: null,
        supervisor_id: null,
        role: "standalone",
        org_setup_complete: true,
      })
      .eq("user_id", userId);
    if (standaloneErr) throw standaloneErr;
  }
}

function toOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}
