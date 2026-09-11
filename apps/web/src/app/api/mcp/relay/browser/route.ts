import { NextResponse } from "next/server";
import { requireMcpRelayUser } from "@/app/api/sdk/_shared";
import { formatErrorForResponse } from "@/lib/format-error";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";
import { isUuid } from "../relay-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  // `p_session_id` is a `uuid`, so free text is a 22P02 from Postgres rather
  // than an empty claim batch. Checked here so the caller is told what is wrong
  // with the request instead of being handed the database's own words.
  if (!isUuid(sessionId)) return NextResponse.json({ error: "sessionId must be a UUID." }, { status: 400 });
  // `for update skip locked` inside the RPC claims the batch atomically in one
  // statement, so concurrent tabs never take the same request and a poll costs
  // a single round trip. RLS still applies — the function is security invoker.
  const { data, error } = await auth.db.rpc("claim_ai_mcp_relay_requests", {
    p_session_id: sessionId,
    p_limit: 5,
  });
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "mcp-relay-browser") }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
