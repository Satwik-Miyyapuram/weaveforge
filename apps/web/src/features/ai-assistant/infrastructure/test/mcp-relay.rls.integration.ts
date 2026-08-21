import assert from "node:assert/strict";
import test from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * The relay's own policies, against the real migrations.
 *
 * This used to need a live Supabase project and two disposable accounts, so
 * without secrets it skipped and proved nothing. It now runs on an in-process
 * Postgres with the shipped SQL applied — see backend/test/pg-test-db.ts for
 * what that does and does not stand in for.
 */

test("MCP relay and proposal RLS isolate private AI records between authenticated users", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const other = await db.createUser();
  const sessionId = crypto.randomUUID();

  const [inserted] = await db.as(owner).sql<{ id: string; user_id: string }>(
    `insert into ai_mcp_relay_requests (session_id, request_enc, expires_at)
     values ($1, $2, now() + interval '60 seconds') returning id, user_id`,
    [sessionId, JSON.stringify({ iv: "opaque-test", ciphertext: "opaque-test" })],
  );
  assert.equal(inserted!.user_id, owner, "user_id must come from auth.uid(), not the client");

  const proposalId = crypto.randomUUID();
  await db.as(owner).sql(
    `insert into ai_proposals (id, kind, status, resource_type, resource_id, content)
     values ($1, 'append_paper_note', 'pending', 'paper_note', $2, $3)`,
    [proposalId, crypto.randomUUID(), JSON.stringify({ body: "opaque-test", sourceLinks: [] })],
  );

  const claimed = await db.as(owner).sql<{ id: string }>(
    "select id from claim_ai_mcp_relay_requests($1, 1)", [sessionId],
  );
  assert.deepEqual(claimed.map((row) => row.id), [inserted!.id], "an owner atomically claims their own pending request");
  assert.deepEqual(
    await db.as(owner).sql("select id from claim_ai_mcp_relay_requests($1, 1)", [sessionId]),
    [], "a claimed request is never handed out twice",
  );

  // Everything below is the other user, who owns none of it.
  assert.deepEqual(
    await db.as(other).sql("select id from ai_mcp_relay_requests where id = $1", [inserted!.id]),
    [], "relay envelopes must not be readable across users",
  );
  assert.deepEqual(
    await db.as(other).sql("update ai_mcp_relay_requests set status = 'cancelled' where id = $1 returning id", [inserted!.id]),
    [], "a foreign user must not cancel someone's relay request",
  );
  assert.deepEqual(
    await db.as(other).sql("select id from ai_proposals where id = $1", [proposalId]),
    [], "pending proposals must not be readable across users",
  );
  assert.deepEqual(
    await db.as(other).sql("select id from claim_ai_mcp_relay_requests($1, 5)", [sessionId]),
    [], "the claim function is security invoker, so it claims nothing for a stranger",
  );
  await assert.rejects(
    () => db.as(other).sql(
      `insert into ai_audit_records (id, proposal_id, action, content) values ($1, $2, 'rejected', $3)`,
      [crypto.randomUUID(), proposalId, JSON.stringify({ reason: "opaque-test" })],
    ),
    "a foreign user must not attach audit records to another user's proposal",
  );

  // Untouched by all of that.
  const [survivor] = await db.as(owner).sql<{ status: string }>(
    "select status from ai_mcp_relay_requests where id = $1", [inserted!.id],
  );
  assert.equal(survivor!.status, "claimed");
});
