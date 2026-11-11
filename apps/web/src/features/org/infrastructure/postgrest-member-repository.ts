import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { singleFlight } from "@/lib/cache/parts";
import { type RustCore, typedCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider, IMemberRepository, Member } from "@weaveforge/core";

// --- postgrest-member-repository ---
/**
 * IMemberRepository over the `profiles` table. Rust plans the queries and maps the rows
 * (`crates/wf-core/src/repos/members.rs`). Since migration 0018 widened the profiles
 * SELECT policy to the whole lab (so you can pick share recipients), `listTeam()`
 * re-applies the subtree filter client-side, while `listDirectory()` returns the full lab.
 *
 * Team, lab and profile consumers all mount at once, so each read is single-flighted.
 */

/** Whether the caller is in their active lab, and who else is in it. */
interface LabContext {
  inLab: boolean;
  orgMemberIds: string[] | null;
}

/** The methods Rust runs for this repository. */
interface MemberSteps {
  getMine(): Promise<Member | null>;
  listDirectory(): Promise<Member[]>;
  labContext(activeOrgId: string): Promise<LabContext>;
}

const OUTSIDE_LAB: LabContext = { inLab: false, orgMemberIds: null };

export function memberRepository(db: SupabaseClient, session: ICurrentUserProvider): IMemberRepository {
  const rust = rustRepository<MemberSteps>(db, "members", ["getMine", "listDirectory", "labContext"], async () => ({
    userId: (await session.getCurrentUserId()) ?? undefined,
  }));

  const listDirectory = () => singleFlight("members:directory", () => rust.listDirectory());

  async function listMembers(filter: RustCore["filterTeamMembers"]): Promise<Member[]> {
    const uid = await session.getCurrentUserId();
    if (!uid) return [];
    // The directory already contains the caller's own row — no second read.
    const all = await listDirectory();
    const orgId = all.find((member) => member.id === uid)?.activeOrgId;
    const lab = orgId
      ? await singleFlight(`members:lab:${uid}:${orgId}`, () => rust.labContext(orgId))
      : OUTSIDE_LAB;
    const orgMemberIds = lab.orgMemberIds && new Set(lab.orgMemberIds);
    // The directory is sorted by name and the filters keep its order.
    return filter(uid, all, { inLab: lab.inLab, orgMemberIds });
  }

  return {
    async getMine() {
      const uid = await session.getCurrentUserId();
      if (!uid) return null;
      return singleFlight(`members:mine:${uid}`, () => rust.getMine());
    },
    listDirectory,
    listTeam: () => listMembers(typedCore().filterTeamMembers),
    listLab: () => listMembers(typedCore().filterLabMembers),
  };
}
