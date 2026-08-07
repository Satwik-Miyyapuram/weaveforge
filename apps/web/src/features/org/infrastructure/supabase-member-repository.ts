import type { SupabaseClient } from "@supabase/supabase-js";
import {
  filterLabMembers,
  filterTeamMembers,
  type ICurrentUserProvider,
  type IMemberRepository,
  type Member,
  type Role,
} from "@weaveforge/core";
import { singleFlight } from "@/lib/single-flight";

/**
 * Supabase implementation of IMemberRepository. Reads the `profiles` table (the
 * ONLY place it's queried from the client). Since migration 0018 widened the
 * profiles SELECT policy to the whole lab (so you can pick share recipients),
 * `listTeam()` now re-applies the subtree filter client-side, while
 * `listDirectory()` returns the full lab.
 */
interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  supervisor_id: string | null;
  org_setup_complete: boolean | null;
  active_org_id: string | null;
}

const TABLE = "profiles";

export class SupabaseMemberRepository implements IMemberRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getMine(): Promise<Member | null> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return null;
    return singleFlight(`members:mine:${uid}`, async () => {
      const { data, error } = await this.db
        .from(TABLE)
        .select("user_id, email, full_name, role, supervisor_id, org_setup_complete, active_org_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data ? toDomain(data as ProfileRow) : null;
    });
  }

  async listDirectory(): Promise<Member[]> {
    // Team, lab and directory consumers all mount at once; share one round trip.
    return singleFlight("members:directory", async () => {
      const { data, error } = await this.db
        .from(TABLE)
        .select("user_id, email, full_name, role, supervisor_id, org_setup_complete, active_org_id");
      if (error) throw error;
      return (data as ProfileRow[]).map(toDomain).sort(byName);
    });
  }

  async listTeam(): Promise<Member[]> {
    return this.listMembers(filterTeamMembers);
  }

  async listLab(): Promise<Member[]> {
    return this.listMembers(filterLabMembers);
  }

  private async listMembers(
    filter: typeof filterTeamMembers,
  ): Promise<Member[]> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return [];

    // The directory already contains the caller's own row — no second read.
    const all = await this.listDirectory();
    const mine = all.find((member) => member.id === uid) ?? null;
    const explicitOrgId = await this.explicitActiveOrgId(uid, mine?.activeOrgId);
    const inLab = !!explicitOrgId;
    const orgMemberIds = explicitOrgId
      ? await this.orgMemberIds(explicitOrgId)
      : null;

    return filter(uid, all, { inLab, orgMemberIds }).sort(byName);
  }

  /** Active org only counts when explicitly joined or owned (not migration backfill). */
  private async explicitActiveOrgId(
    userId: string,
    activeOrgId?: string,
  ): Promise<string | null> {
    if (!activeOrgId) return null;
    return singleFlight(`members:explicit-org:${userId}:${activeOrgId}`, () =>
      this.loadExplicitActiveOrgId(userId, activeOrgId),
    );
  }

  private async loadExplicitActiveOrgId(
    userId: string,
    activeOrgId: string,
  ): Promise<string | null> {
    const { data: org, error: orgErr } = await this.db
      .from("organizations")
      .select("owner_id")
      .eq("id", activeOrgId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (org?.owner_id === userId) return activeOrgId;

    const { data: membership, error: memErr } = await this.db
      .from("org_memberships")
      .select("joined_via")
      .eq("org_id", activeOrgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return null;

    const joinedVia = (membership as { joined_via?: string }).joined_via;
    return joinedVia === "invite" || joinedVia === "create" ? activeOrgId : null;
  }

  private async orgMemberIds(orgId: string): Promise<Set<string>> {
    return singleFlight(`members:org-member-ids:${orgId}`, async () => {
      const { data, error } = await this.db
        .from("org_memberships")
        .select("user_id")
        .eq("org_id", orgId);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.user_id as string));
    });
  }
}

function byName(a: Member, b: Member): number {
  return (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? "");
}

function toDomain(r: ProfileRow): Member {
  return {
    id: r.user_id,
    email: r.email ?? undefined,
    fullName: r.full_name ?? undefined,
    role: r.role,
    supervisorId: r.supervisor_id ?? undefined,
    orgSetupComplete: r.org_setup_complete ?? false,
    activeOrgId: r.active_org_id ?? undefined,
  };
}
