import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseClient, resetSupabaseClientForTests } from "../client";

/**
 * Pointing REST at a self-hosted PostgREST while auth stays on Supabase.
 *
 * This is the whole of the cutover on the client side, so it is worth pinning:
 * data requests must move, and everything else — the token endpoint above all —
 * must not, or nobody can sign in.
 */

const SUPABASE = "https://abcdef.supabase.co";
const DATA = "https://oci.example.com:3000";
const ANON = "anon-key";

function withFetch(run: (seen: string[]) => Promise<void> | void) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return Promise.resolve(run(seen)).finally(() => {
    globalThis.fetch = original;
    resetSupabaseClientForTests();
  });
}

test("table reads go to the data API, with the /rest/v1 prefix dropped", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.from("papers").select("id");

    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.startsWith(`${DATA}/papers`), `went to ${seen[0]}`);
    assert.ok(!seen[0]!.includes("supabase.co"), "no data request reaches Supabase");
    assert.ok(!seen[0]!.includes("/rest/v1"), "PostgREST serves tables at its root");
  });
});

test("the query string survives the rewrite", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.from("papers").select("id").eq("status", "read");

    assert.match(seen[0]!, /status=eq\.read/);
    assert.match(seen[0]!, /select=id/);
  });
});

test("auth still goes to Supabase — the tokens are theirs to issue", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.auth.getUser("some-token").catch(() => {});

    assert.ok(seen.length > 0);
    for (const url of seen) {
      assert.ok(url.startsWith(SUPABASE), `auth call went to ${url} instead of Supabase`);
    }
  });
});

test("with no data URL, nothing moves", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON);
    await db.from("papers").select("id");

    assert.ok(seen[0]!.startsWith(`${SUPABASE}/rest/v1/papers`), `went to ${seen[0]}`);
  });
});

test("a data URL identical to the project URL is not a rewrite", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, SUPABASE);
    await db.from("papers").select("id");

    assert.ok(seen[0]!.startsWith(`${SUPABASE}/rest/v1/papers`));
  });
});

test("a trailing slash on either URL does not produce a doubled one", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, `${DATA}/`);
    await db.from("papers").select("id");

    assert.ok(!seen[0]!.includes("//papers"), `doubled slash in ${seen[0]}`);
    assert.ok(seen[0]!.startsWith(`${DATA}/papers`));
  });
});
