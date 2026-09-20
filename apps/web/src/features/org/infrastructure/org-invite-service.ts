import type { SupabaseClient } from "@supabase/supabase-js";
import { createRestClient } from "@/backend/providers/supabase/client";
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
  OrgNotFoundError,
  OrgPermissionError,
  OrgValidationError,
} from "@weaveforge/core";
import {
  generateOrgInviteCode,
  hashOrgInviteCodeInput,
} from "@weaveforge/core/org-crypto";
import { MEMBERSHIP_ROW_COLUMNS, membershipViewFromRow } from "./membership-row";
import { rows, run } from "@/backend/providers/supabase/row-access";

/**
 * The columns a OrgRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const ORG_COLUMNS = "id,name,owner_id,created_at";

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

/**
 * How many times a code collision is retried.
 *
 * A code is 10 Crockford characters, so a collision is astronomically unlikely
 * and this is really a guard against a broken generator that returns a constant
 * — which should fail after a few tries rather than loop.
 */
const CODE_ATTEMPTS = 5;

/** PostgreSQL unique_violation. The only error worth retrying a code insert for. */
const UNIQUE_VIOLATION = "23505";

/** Server-side org operations (service role). */
export class OrgInviteService {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  private admin(): SupabaseClient {
    return createRestClient(this.url, this.serviceRoleKey, { auth: { persistSession: false } });
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
    await run(admin.from("profiles").upsert(
      {
        user_id: userId,
        email: u.email ?? null,
        full_name: (u.user_metadata?.full_name as string | undefined) ?? u.email ?? null,
        role: "masters",
        org_setup_complete: false,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    ));
  }

  /**
   * Create a lab, its three invite codes, the owner's membership and the
   * owner's profile.
   *
   * One RPC, not four writes in sequence. PostgREST cannot open a transaction,
   * so the old version — insert org, insert three codes, upsert membership,
   * update profile — left a lab whose owner was not in it whenever anything
   * failed in the middle. That lab is invisible: it is in nobody's membership
   * list, `switch_active_org` refuses it, and the only repair is hand-written
   * SQL. `create_organization_atomic` (migration 0125) is one statement, so a
   * failure anywhere rolls all of it back.
   *
   * The codes are still generated here and hashed here — only the hashes travel
   * — and the retry moved up a level with them: a duplicate `code_hash` now
   * aborts the whole call rather than just one insert, which is the same
   * condition, now with the org rolled back instead of orphaned.
   */
  async createOrganization(userId: string, nameInput: string): Promise<{
    organization: Organization;
    codes: OrgInviteCodePlaintext[];
  }> {
    await this.ensureProfile(userId);
    const name = validateOrgName(nameInput);
    const admin = this.admin();

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const codes: OrgInviteCodePlaintext[] = ROLES.map((targetRole) => ({
        targetRole,
        code: generateOrgInviteCode(),
      }));
      const { data, error } = await admin.rpc("create_organization_atomic", {
        p_user_id: userId,
        p_name: name,
        p_codes: codes.map((c) => ({
          target_role: c.targetRole,
          code_hash: hashOrgInviteCodeInput(normalizeOrgInviteCode(c.code)),
        })),
      });
      if (!error && data) return { organization: toOrg(data as OrgRow), codes };
      // Only a code collision is retryable; anything else is a real failure and
      // retrying it would just repeat it.
      if (error && error.code !== UNIQUE_VIOLATION) {
        throw new Error(error.message);
      }
    }
    throw new Error("Could not generate a unique code.");
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
    // A code that points at a lab which no longer exists is a 404, not a bad
    // request: the code the caller holds was valid, and re-typing it cannot
    // help. Typed now so the HTTP mapping can tell the two apart (review-2 F5).
    if (orgErr || !org) throw new OrgNotFoundError("Lab not found.");

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

    // Membership, profile and the code's use count as one statement (migration
    // 0125). Split across three PostgREST calls, a failure after the first left
    // a role in `org_memberships` and a profile that still said `standalone` —
    // two rows that disagree, so every read path trusting one of them is wrong.
    //
    // The role and supervisor are resolved above because that is domain logic
    // with its own tests; what the RPC adds is that the increment is
    // `use_count = use_count + 1` under the row lock rather than a value
    // computed from a read, which is how a code used a thousand times came to
    // read 700. The code row is re-checked inside the function, so a code
    // revoked between the read above and this call cannot be used.
    const { error: joinErr } = await admin.rpc("join_organization_atomic", {
      p_user_id: userId,
      p_org_id: row.org_id,
      p_code_id: row.id,
      p_role: assignment.role,
      p_supervisor_id: assignment.supervisorId ?? null,
    });
    if (joinErr) throw new OrgInviteValidationError(joinErr.message);

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
    return (await rows<OrgRow>(this.admin()
      .from("organizations")
      .select(ORG_COLUMNS)
      .eq("owner_id", userId)
      .order("created_at", { ascending: true }))).map(toOrg);
  }

  async listMemberships(userId: string): Promise<
    { orgId: string; orgName: string; role: OrgInviteRole; joinSource: OrgJoinSource }[]
  > {
    const { data, error } = await this.admin()
      .from("org_memberships")
      .select(MEMBERSHIP_ROW_COLUMNS)
      .eq("user_id", userId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(membershipViewFromRow);
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
    if (!membership) throw new OrgPermissionError("Not a member of this lab.");

    await run(admin
      .from("profiles")
      .update({
        active_org_id: orgId,
        role: membership.role as OrgInviteRole,
        supervisor_id: membership.supervisor_id,
        org_setup_complete: true,
      })
      .eq("user_id", userId));
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
      throw new OrgPermissionError("Only the lab owner can regenerate codes.");
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

  /**
   * Insert one fresh code for a role, retrying on a hash collision.
   *
   * Only `regenerateCode` uses this now: `createOrganization` has to make three
   * codes and the org in one transaction, so its retry lives one level up in
   * `create_organization_atomic`'s caller instead. Both are the same rule — a
   * collision on `org_invite_codes_hash_idx` means try another code, never
   * report a failure — and both share `CODE_ATTEMPTS` and `UNIQUE_VIOLATION`.
   */
  private async insertUniqueCode(
    admin: SupabaseClient,
    orgId: string,
    targetRole: OrgInviteRole,
  ): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const plaintext = generateOrgInviteCode();
      const { error } = await admin.from("org_invite_codes").insert({
        org_id: orgId,
        target_role: targetRole,
        code_hash: hashOrgInviteCodeInput(normalizeOrgInviteCode(plaintext)),
      });
      if (!error) return plaintext;
      if (error.code !== UNIQUE_VIOLATION) throw error;
    }
    throw new Error("Could not generate a unique code.");
  }

  // `upsertMembership` used to live here, as a helper for the create and join
  // flows. Both now perform the membership upsert inside
  // `create_organization_atomic` / `join_organization_atomic` (migration 0125),
  // where it shares a transaction with the profile write it has to agree with —
  // which is the whole point of moving it. The method is gone rather than left
  // unused, so there is one way to write a membership, not two.

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
    if (!org) throw new OrgNotFoundError("Lab not found.");
    if (org.owner_id === userId) {
      throw new OrgPermissionError(
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
    if (!membership) throw new OrgPermissionError("Not a member of this lab.");

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
