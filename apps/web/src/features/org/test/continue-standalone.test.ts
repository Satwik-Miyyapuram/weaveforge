import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheRepo } from "@/lib/cache/cache-repo";
import {
  invalidateAllRepoCaches,
  registerRepoCacheEntry,
} from "@/lib/cache/project-lww-invalidator";
import { continueStandalone } from "../infrastructure/org-api";
import { stubFetch } from "@/lib/test/stub-fetch";
import type { Member } from "@weaveforge/core";

test("memberRepository in cacheRepo returns stale profile unless invalidated after standalone onboarding", async () => {
  let dbProfile: Member = {
    id: "user-new",
    email: "new@example.com",
    role: "masters",
    orgSetupComplete: false,
  };

  const underlying = {
    getMine: async () => dbProfile,
    listDirectory: async () => [dbProfile],
    listTeam: async () => [dbProfile],
    listLab: async () => [dbProfile],
  };

  const cache = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  registerRepoCacheEntry({ cache, settled });

  const pid = () => null;
  const repo = cacheRepo(
    underlying,
    ["getMine", "listTeam", "listDirectory", "listLab"],
    [],
    pid,
    { sharedCache: cache, sharedSettled: settled },
  );

  // 1. Initial boot: profile read when user hasn't set up org yet
  const initial = await repo.getMine();
  assert.equal(initial?.orgSetupComplete, false);

  // 2. User completes standalone setup in the database
  dbProfile = {
    id: "user-new",
    email: "new@example.com",
    role: "standalone",
    orgSetupComplete: true,
  };

  // Without invalidation, cacheRepo returns the stale cached result
  const stale = await repo.getMine();
  assert.equal(stale?.orgSetupComplete, false, "cacheRepo without invalidation returns stale profile");

  // With invalidation (as triggered by continueStandalone), cacheRepo returns the updated profile
  invalidateAllRepoCaches();
  const fresh = await repo.getMine();
  assert.equal(fresh?.orgSetupComplete, true, "after invalidating repo caches, getMine returns updated profile");
  assert.equal(fresh?.role, "standalone");
});

test("continueStandalone invalidates repository caches on success", async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";

  const { restore } = stubFetch(async (url) => {
    if (url.includes("complete_org_setup")) {
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  try {
    const cache = new Map<string, Promise<unknown>>();
    const settled = new Map<string, unknown>();
    settled.set("stale-key", "stale-value");
    registerRepoCacheEntry({ cache, settled });

    assert.equal(settled.has("stale-key"), true);

    await continueStandalone();

    assert.equal(settled.has("stale-key"), false, "repo cache settled map must be cleared after continueStandalone");
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
    restore();
  }
});
