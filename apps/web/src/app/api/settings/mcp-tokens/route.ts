import { NextResponse } from "next/server";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { bearerToken } from "@/app/api/sdk/_shared";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";

function disabled() {
  return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try { return NextResponse.json(await apiTokenService().createMcpRelayToken(accessToken, "Codex MCP connection")); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 }); }
}

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try { return NextResponse.json({ tokens: await apiTokenService().listMcpRelayTokens(accessToken) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 }); }
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
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 }); }
}
