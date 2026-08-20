import {
  filterLabMembers,
  filterTeamMembers,
  type ICurrentUserProvider,
  type IMemberRepository,
  type Member,
  type Role,
} from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";
import {
  type ProfileRow,
  byName,
  toDomain,
} from "@/features/org/infrastructure/member-rows";

export class PostgresMemberRepository implements IMemberRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getMine(): Promise<Member | null> {
    const uid = await this.session.getCurrentUserId();
    if (!uid) return null;
    const row = await this.pg.queryOne<ProfileRow>(
      "select user_id, email, full_name, role, supervisor_id, org_setup_complete, active_org_id from profiles where user_id = $1",
      [uid],
    );
    return row ? toDomain(row) : null;
  }

  async listDirectory(): Promise<Member[]> {
    const rows = await this.pg.query<ProfileRow>(
      "select user_id, email, full_name, role, supervisor_id, org_setup_complete, active_org_id from profiles",
    );
    return rows.map(toDomain).sort(byName);
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

    const mine = await this.getMine();
    const all = await this.listDirectory();
    const explicitOrgId = await this.explicitActiveOrgId(uid, mine?.activeOrgId);
    const inLab = !!explicitOrgId;
    const orgMemberIds = explicitOrgId
      ? await this.orgMemberIds(explicitOrgId)
      : null;

    return filter(uid, all, { inLab, orgMemberIds }).sort(byName);
  }

  private async explicitActiveOrgId(
    userId: string,
    activeOrgId?: string,
  ): Promise<string | null> {
    if (!activeOrgId) return null;

    const owner = await this.pg.queryOne<{ owner_id: string }>(
      "select owner_id from organizations where id = $1",
      [activeOrgId],
    );
    if (owner?.owner_id === userId) return activeOrgId;

    const membership = await this.pg.queryOne<{ joined_via: string }>(
      "select joined_via from org_memberships where org_id = $1 and user_id = $2",
      [activeOrgId, userId],
    );
    if (!membership) return null;
    return membership.joined_via === "invite" || membership.joined_via === "create"
      ? activeOrgId
      : null;
  }

  private async orgMemberIds(orgId: string): Promise<Set<string>> {
    const rows = await this.pg.query<{ user_id: string }>(
      "select user_id from org_memberships where org_id = $1",
      [orgId],
    );
    return new Set(rows.map((r) => r.user_id));
  }
}

