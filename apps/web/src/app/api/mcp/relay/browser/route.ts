import { NextResponse } from "next/server";
import { requireMcpRelayUser } from "@/app/api/sdk/_shared";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  // `for update skip locked` inside the RPC claims the batch atomically in one
  // statement, so concurrent tabs never take the same request and a poll costs
  // a single round trip. RLS still applies — the function is security invoker.
  const { data, error } = await auth.db.rpc("claim_ai_mcp_relay_requests", {
    p_session_id: sessionId,
    p_limit: 5,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
