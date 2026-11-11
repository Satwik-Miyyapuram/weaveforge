import type { SupabaseClient } from "@supabase/supabase-js";
import { type ICurrentUserProvider, type IMemberRepository, type Member, type Role } from "@weaveforge/core";
import { singleFlight } from "@/lib/cache/single-flight";
import {
  PROFILE_COLUMNS,
  type ProfileRow,
  byName,
} from "./member-rows";
import { one } from "@/backend/providers/postgrest/row-access";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { RustCore } from "@/lib/rust-core";

/**
 * PostgREST implementation of IMemberRepository. Reads the `profiles` table (the
 * ONLY place it's queried from the client). Since migration 0018 widened the
 * profiles SELECT policy to the whole lab (so you can pick share recipients),
 * `listTeam()` now re-applies the subtree filter client-side, while
 * `listDirectory()` returns the full lab.
 */

const TABLE = "profiles";

/** Rust keeps role as String; the DB check constraint limits it to Role. */
const toRole = (role: string): Role => role as Role;

const toDomain = (r: ProfileRow): Member => {
  const m = typedCore().memberRowToDomain(r);
  return {
    id: m.id,
    email: m.email ?? undefined,
    fullName: m.fullName ?? undefined,
    role: toRole(m.role),
    supervisorId: m.supervisorId ?? undefined,
    orgSetupComplete: m.orgSetupComplete,
    activeOrgId: m.activeOrgId ?? undefined,
  };
};

export class PostgrestMemberRepository implements IMemberRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getMine(): Promise<Member | null> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return null;
    return singleFlight(`members:mine:${uid}`, async () => {
      const row = await one<ProfileRow>(this.db
        .from(TABLE)
        .select(PROFILE_COLUMNS)
        .eq("user_id", uid)
        .maybeSingle());
      return row ? toDomain(row) : null;
    });
  }

  async listDirectory(): Promise<Member[]> {
    // Team, lab and directory consumers all mount at once; share one round trip.
    return singleFlight("members:directory", async () => {
      const { data, error } = await this.db
        .from(TABLE)
        .select(PROFILE_COLUMNS);
      if (error) throw error;
      return (data as ProfileRow[]).map(toDomain).sort(byName);
    });
  }

  async listTeam(): Promise<Member[]> {
    return this.listMembers(typedCore().filterTeamMembers);
  }

  async listLab(): Promise<Member[]> {
    return this.listMembers(typedCore().filterLabMembers);
  }

  private async listMembers(
    filter: RustCore["filterTeamMembers"],
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

    // Explicit join/create vs. migration backfill is decided in Rust (`is_explicit_lab_membership`).
    const joinedVia = (membership as { joined_via?: string }).joined_via;
    return readyCore().isExplicitLabMembership({ orgId: activeOrgId, joinSource: joinedVia ?? null })
      ? activeOrgId
      : null;
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

