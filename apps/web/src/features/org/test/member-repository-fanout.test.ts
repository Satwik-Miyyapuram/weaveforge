import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMemberRepository } from "../infrastructure/supabase-member-repository";

const UID = "user-1";

interface Counts {
  profiles: number;
  organizations: number;
  org_memberships: number;
}

function fakeDb(counts: Counts): SupabaseClient {
  const rows: Record<string, unknown[]> = {
    profiles: [
      {
        user_id: UID,
        email: "a@example.com",
        full_name: "A",
        role: "student",
        supervisor_id: null,
        org_setup_complete: true,
        active_org_id: null,
      },
    ],
    organizations: [],
    org_memberships: [],
  };

  return {
    from(table: keyof Counts) {
      counts[table] += 1;
      const result = { data: rows[table], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
      };
      for (const method of ["select", "eq", "gt", "order"]) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

test("concurrent team + lab + profile load shares its profiles reads", async () => {
  const counts: Counts = { profiles: 0, organizations: 0, org_memberships: 0 };
  const repo = new SupabaseMemberRepository(fakeDb(counts), {
    getCurrentUserId: async () => UID,
    requireUserId: async () => UID,
  });

  await Promise.all([repo.getMine(), repo.listTeam(), repo.listLab()]);

  // One own-profile read + one directory read, whatever the mount order.
  assert.equal(counts.profiles, 2);
});
