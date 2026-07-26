import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

function env(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find(Boolean);
}

test("MCP relay and proposal RLS isolate private AI records between authenticated users", async (t) => {
  const url = env("THESIS_TRACKER_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = env("THESIS_TRACKER_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const emailA = env("THESIS_TRACKER_EMAIL", "TT_A_EMAIL", "TEST_ACCOUNT_EMAIL_PRIMARY");
  const emailB = env("THESIS_TRACKER_B_EMAIL", "TT_B_EMAIL", "TEST_ACCOUNT_EMAIL_SECONDARY");
  const passwordA = env("THESIS_TRACKER_PASSWORD", "TT_A_PASSWORD", "E2E_TEST_PASSWORD", "TEST_ACCOUNT_PASSWORD");
  const passwordB = env("THESIS_TRACKER_B_PASSWORD", "TT_B_PASSWORD", "E2E_TEST_PASSWORD", "TEST_ACCOUNT_PASSWORD");
  if (!url || !key || !emailA || !emailB || !passwordA || !passwordB) {
    t.diagnostic("Skipping — configure Supabase URL/key and two disposable test users");
    return;
  }

  const makeClient = () => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  const owner = makeClient();
  const other = makeClient();
  assert.ifError((await owner.auth.signInWithPassword({ email: emailA, password: passwordA })).error);
  assert.ifError((await other.auth.signInWithPassword({ email: emailB, password: passwordB })).error);
  const { data: { session: ownerSession } } = await owner.auth.getSession();
  assert.ok(ownerSession?.access_token);
  const headerAuthenticatedOwner = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${ownerSession.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const relaySessionId = randomUUID();
  const { data: inserted, error: insertError } = await owner.from("ai_mcp_relay_requests").insert({
    session_id: relaySessionId,
    request_enc: { iv: "opaque-test", ciphertext: "opaque-test" },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }).select("id").single();
  assert.ifError(insertError);
  assert.ok(inserted?.id);
  const proposalId = randomUUID();
  const { error: proposalError } = await owner.from("ai_proposals").insert({
    id: proposalId, kind: "append_paper_note", status: "pending", resource_type: "paper_note",
    resource_id: randomUUID(), content: { body: "opaque-test", sourceLinks: [] },
  });
  assert.ifError(proposalError);

  try {
    const { data: claimed, error: claimError } = await owner.rpc("claim_ai_mcp_relay_requests", { p_session_id: relaySessionId, p_limit: 1 });
    assert.ifError(claimError);
    assert.equal(claimed?.[0]?.id, inserted.id, "owners can atomically claim only their pending relay request");

    const headerSessionId = randomUUID();
    const { data: headerInserted, error: headerInsertError } = await headerAuthenticatedOwner.from("ai_mcp_relay_requests").insert({
      session_id: headerSessionId, request_enc: { iv: "opaque-test", ciphertext: "opaque-test" },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select("id").single();
    assert.ifError(headerInsertError);
    const { data: headerClaimed, error: headerClaimError } = await headerAuthenticatedOwner.rpc("claim_ai_mcp_relay_requests", { p_session_id: headerSessionId, p_limit: 1 });
    assert.ifError(headerClaimError);
    assert.equal(headerClaimed?.[0]?.id, headerInserted?.id, "header-authenticated clients can atomically claim their relay request");
    await owner.from("ai_mcp_relay_requests").delete().eq("id", headerInserted?.id ?? "");

    const { data: foreignRead, error: foreignReadError } = await other
      .from("ai_mcp_relay_requests").select("id").eq("id", inserted.id);
    assert.ifError(foreignReadError);
    assert.deepEqual(foreignRead, []);

    const { data: foreignUpdate, error: foreignUpdateError } = await other
      .from("ai_mcp_relay_requests").update({ status: "cancelled" }).eq("id", inserted.id).select("id");
    assert.ifError(foreignUpdateError);
    assert.deepEqual(foreignUpdate, []);

    const { data: foreignProposal, error: foreignProposalError } = await other
      .from("ai_proposals").select("id, content").eq("id", proposalId);
    assert.ifError(foreignProposalError);
    assert.deepEqual(foreignProposal, []);

    const { error: crossOwnerAuditError } = await other.from("ai_audit_records").insert({
      id: randomUUID(), proposal_id: proposalId, action: "rejected", content: { reason: "opaque-test" },
    });
    assert.ok(crossOwnerAuditError, "foreign users must not attach audit records to another user's proposal");
  } finally {
    await owner.from("ai_mcp_relay_requests").delete().eq("id", inserted.id);
    await owner.from("ai_proposals").delete().eq("id", proposalId);
    await owner.auth.signOut();
    await other.auth.signOut();
  }
});
