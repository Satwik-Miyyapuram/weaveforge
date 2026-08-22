import { NextResponse } from "next/server";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { bearerToken } from "@/app/api/sdk/_shared";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";
import { formatError } from "@/lib/format-error";

function disabled() {
  return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Report a failure as what it is.
 *
 * The service throws before it ever looks at the caller's token when the
 * deployment is missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_JWT_SECRET.
 * Returning 401 for that told the reader their session was rejected and sent
 * them to sign in again, on a server that would answer the same way forever.
 */
function failed(error: unknown) {
  const message = formatError(error);
  const misconfigured = message.startsWith("Missing server config");
  return NextResponse.json({ error: message }, { status: misconfigured ? 503 : 401 });
}

export async function POST(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try { return NextResponse.json(await apiTokenService().createMcpRelayToken(accessToken, "Codex MCP connection")); }
  catch (error) { return failed(error); }
}

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try { return NextResponse.json({ tokens: await apiTokenService().listMcpRelayTokens(accessToken) }); }
  catch (error) { return failed(error); }
}

export async function DELETE(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const accessToken = bearerToken(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!accessToken) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!id) return NextResponse.json({ error: "Token id required." }, { status: 400 });
  try {
    await apiTokenService().revokeToken(accessToken, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return failed(error); }
}
