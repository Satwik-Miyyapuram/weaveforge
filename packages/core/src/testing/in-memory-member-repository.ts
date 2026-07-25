import {
  filterLabMembers,
  filterTeamMembers,
  type Member,
} from "../features/org/domain/member.js";
import type { IMemberRepository } from "../features/org/domain/member-repository.js";

/**
 * In-memory {@link IMemberRepository} for tests. A fixed `currentId` stands in
 * for the signed-in user; `listTeam` applies the same subtree-visibility rule
 * the SQL policy enforces in production (LSP: same observable behavior).
 */
export class InMemoryMemberRepository implements IMemberRepository {
  private readonly store = new Map<string, Member>();
  constructor(
    private currentId: string | null = null,
    seed: readonly Member[] = [],
  ) {
    for (const m of seed) this.store.set(m.id, { ...m });
  }

  setCurrent(id: string | null): void {
    this.currentId = id;
  }
  upsert(member: Member): void {
    this.store.set(member.id, { ...member });
  }

  async getMine(): Promise<Member | null> {
    if (!this.currentId) return null;
    return this.store.get(this.currentId) ?? null;
  }

  async listTeam(): Promise<Member[]> {
    if (!this.currentId) return [];
    const all = [...this.store.values()];
    const orgMemberIds = new Set(all.map((m) => m.id));
    return this.byName(
      filterTeamMembers(this.currentId, all, { inLab: true, orgMemberIds }),
    );
  }

  async listLab(): Promise<Member[]> {
    if (!this.currentId) return [];
    const all = [...this.store.values()];
    const orgMemberIds = new Set(all.map((m) => m.id));
    return this.byName(
      filterLabMembers(this.currentId, all, { inLab: true, orgMemberIds }),
    );
  }

  /** The whole seeded set stands in for "the lab" in tests. */
  async listDirectory(): Promise<Member[]> {
    if (!this.currentId) return [];
    return this.byName([...this.store.values()]);
  }

  private byName(members: Member[]): Member[] {
    return members.sort((a, b) =>
      (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? ""),
    );
  }
}
