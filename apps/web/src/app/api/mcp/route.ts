import { NextResponse } from "next/server";
import { AiBrowserPairingRequiredError, aiMcpToolManifest } from "@thesis/core";
import { GENERATED_MCP_ENABLED, GENERATED_MCP_TOOL_NAMES } from "@/deployment/generated-registry";

export const dynamic = "force-dynamic";

/**
 * Direct `/api/mcp` stays fail-closed. Live access goes through the browser
 * relay (`/api/mcp/relay`) with an MCP token from Settings → AI & MCP, gated by
 * the user's `aiAccess` ruleset and an active browser session grant.
 */
export async function GET() {
  if (!GENERATED_MCP_ENABLED) return disabled();
  return unavailable();
}

export async function POST() {
  if (!GENERATED_MCP_ENABLED) return disabled();
  return unavailable();
}

function disabled() {
  return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function unavailable() {
  const error = new AiBrowserPairingRequiredError();
  return NextResponse.json(
    { error: error.code, message: error.message, tools: aiMcpToolManifest().filter((tool) => GENERATED_MCP_TOOL_NAMES.includes(tool.name)) },
    { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
