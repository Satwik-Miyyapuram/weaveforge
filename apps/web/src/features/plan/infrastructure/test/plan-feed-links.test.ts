import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import { PlanFeedLinks, planFeedOrigin, planFeedUrls } from "../plan-feed-links";

test("planFeedUrls builds calendar, https and widget links with options in the query", () => {
  const urls = planFeedUrls("https://app.weaveforge.org", "tt_abc", { includeDone: true, reminderDays: 3 });
  assert.equal(urls.ics, "https://app.weaveforge.org/api/plan/feed/tt_abc/deadlines.ics?done=1&alarm=3");
  assert.equal(urls.webcal, "webcal://app.weaveforge.org/api/plan/feed/tt_abc/deadlines.ics?done=1&alarm=3");
  assert.equal(urls.widget, "https://app.weaveforge.org/api/plan/feed/tt_abc/widget.json?done=1");
  assert.equal(planFeedUrls("https://x.org", "tt_a").ics, "https://x.org/api/plan/feed/tt_a/deadlines.ics");
});

test("planFeedOrigin uses this origin only where the feed route exists", () => {
  assert.equal(planFeedOrigin(true, "https://preview.example.com"), "https://preview.example.com");
  assert.match(planFeedOrigin(false, "app://weaveforge"), /^https:\/\//);
  assert.match(planFeedOrigin(true, "app://weaveforge"), /^https:\/\//);
});

type Call = [method: string, ...args: unknown[]];

/** A PostgREST stand-in: records each query's chain and answers via `answer`. */
function fakeDb(answer: (calls: Call[]) => { data?: unknown; error?: unknown }) {
  const queries: Call[][] = [];
  const db = {
    from(table: string) {
      const calls: Call[] = [["from", table]];
      queries.push(calls);
      const chain: Record<string, unknown> = {
        then(ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null, ...answer(calls) }).then(ok, fail);
        },
      };
      for (const m of ["select", "insert", "delete", "contains", "neq", "order", "limit", "single", "eq"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

const session = { requireUserId: async () => "user-1" } as unknown as ICurrentUserProvider;
const has = (calls: Call[], method: string) => calls.some(([m]) => m === method);
const ROW = { id: "new-id", token_prefix: "tt_abcdefgh…", created_at: "2026-01-01", last_used_at: null };

test("plan feed create: inserts the new link before removing the old one, sparing the new id", async () => {
  const { db, queries } = fakeDb((calls) => (has(calls, "insert") ? { data: ROW } : {}));
  const { link, token } = await new PlanFeedLinks(db, session).create();
  assert.equal(link.id, "new-id");
  assert.match(token, /^tt_/);
  const insertAt = queries.findIndex((q) => has(q, "insert"));
  const deleteAt = queries.findIndex((q) => has(q, "delete"));
  assert.ok(insertAt >= 0 && deleteAt > insertAt, "insert first, then delete");
  assert.deepEqual(queries[deleteAt]!.find(([m]) => m === "neq"), ["neq", "id", "new-id"]);
  assert.ok(queries[deleteAt]!.some(([m, col]) => m === "contains" && col === "scopes"), "only plan_feed rows");
});

test("plan feed create: a failed insert leaves the old link working", async () => {
  const { db, queries } = fakeDb((calls) => (has(calls, "insert") ? { error: { message: "insert failed" } } : {}));
  await assert.rejects(new PlanFeedLinks(db, session).create(), /insert failed/);
  assert.equal(queries.filter((q) => has(q, "delete")).length, 0, "nothing was revoked");
});

test("plan feed revoke: removes every plan_feed link", async () => {
  const { db, queries } = fakeDb(() => ({}));
  await new PlanFeedLinks(db, session).revoke();
  assert.equal(queries.length, 1);
  assert.ok(has(queries[0]!, "delete"));
  assert.ok(!has(queries[0]!, "neq"));
});
