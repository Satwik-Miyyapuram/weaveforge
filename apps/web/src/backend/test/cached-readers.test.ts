import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { wirePostgrestBackend, type BackendParts } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { HttpAccountProvisioner } from "@/features/org/infrastructure/http-account-provisioner";
import { invalidateForWrite, setActiveProjectIdForCache } from "@/lib/cache/project-lww-invalidator";
import type { ProjectContext } from "@/lib/project-context";

/**
 * The shared reader and the member repository are memoized like every other
 * repository. These pin down what clears them: a share change (xapi-05) and
 * an account created beneath you (xapi-06). Neither has a write of its own.
 */

const UID = "user-1";

/** A query builder that answers every chain with `rows[table]` and counts the reads. */
function fakeDb(counts: Map<string, number>, rows: Record<string, unknown[]>): SupabaseClient {
  return {
    from(table: string) {
      counts.set(table, (counts.get(table) ?? 0) + 1);
      const result = { data: rows[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
        maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
        single: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
      };
      for (const method of ["select", "eq", "neq", "gt", "in", "or", "order", "limit", "is"]) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

function wire(counts: Map<string, number>) {
  const db = fakeDb(counts, {
    profiles: [
      {
        user_id: UID,
        email: "a@example.com",
        full_name: "A",
        role: "phd",
        supervisor_id: null,
        org_setup_complete: true,
        active_org_id: null,
      },
    ],
    papers: [{ id: "p1", title: "Shared", status: "to_read", user_id: "owner", metadata: {} }],
  });
  const session = { getCurrentUserId: async () => UID, requireUserId: async () => UID };
  const parts = {
    db,
    session,
    auth: { getAccessToken: async () => "token" },
    blobStore: {},
    settingsRepository: {},
  } as unknown as BackendParts;
  const projectContext = { get: () => "proj-1" } as unknown as ProjectContext;
  return wirePostgrestBackend({} as never, projectContext, () => "proj-1", parts);
}

test("a share change refreshes what the shared reader returns (xapi-05)", async () => {
  setActiveProjectIdForCache(() => "proj-1");
  const counts = new Map<string, number>();
  const backend = wire(counts);

  await backend.sharedReader.read("paper", ["p1"], []);
  await backend.sharedReader.read("paper", ["p1"], []);
  assert.equal(counts.get("papers"), 1, "a repeat read is served from the memo");

  // What a local grant/revoke and a peer's share broadcast both run.
  invalidateForWrite("share");
  await backend.sharedReader.read("paper", ["p1"], []);
  assert.equal(counts.get("papers"), 2, "a share change refetches");
});

test("an unrelated write leaves the shared reader's memo alone", async () => {
  setActiveProjectIdForCache(() => "proj-1");
  const counts = new Map<string, number>();
  const backend = wire(counts);

  await backend.sharedReader.read("paper", ["p1"], []);
  invalidateForWrite("log_entry");
  await backend.sharedReader.read("paper", ["p1"], []);
  assert.equal(counts.get("papers"), 1);
});

test("creating an account clears the cached team (xapi-06)", async (t) => {
  setActiveProjectIdForCache(() => "proj-1");
  const counts = new Map<string, number>();
  const backend = wire(counts);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  await backend.memberRepository.listTeam();
  const before = counts.get("profiles") ?? 0;
  await backend.memberRepository.listTeam();
  assert.equal(counts.get("profiles"), before, "a repeat read is served from the memo");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ member: { userId: "new", email: "n@example.com", role: "masters" } }), {
      status: 200,
    })) as typeof fetch;
  await new HttpAccountProvisioner({ getAccessToken: async () => "token" }).createMember({
    email: "n@example.com",
    password: "secret-pass",
    role: "masters",
  });

  await backend.memberRepository.listTeam();
  assert.ok((counts.get("profiles") ?? 0) > before, "the new member is read, not the memo");
});

test("a refused account creation keeps the cached team", async (t) => {
  setActiveProjectIdForCache(() => "proj-1");
  const counts = new Map<string, number>();
  const backend = wire(counts);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  await backend.memberRepository.listTeam();
  const before = counts.get("profiles") ?? 0;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "nope" }), { status: 403 })) as typeof fetch;
  await assert.rejects(
    new HttpAccountProvisioner({ getAccessToken: async () => "token" }).createMember({
      email: "n@example.com",
      password: "secret-pass",
      role: "masters",
    }),
  );

  await backend.memberRepository.listTeam();
  assert.equal(counts.get("profiles"), before);
});
