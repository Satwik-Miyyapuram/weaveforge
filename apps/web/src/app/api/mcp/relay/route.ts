import { NextResponse } from "next/server";
import { requireMcpRelayUser } from "@/app/api/sdk/_shared";
import { formatErrorForResponse } from "@/lib/format-error";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";
import {
  exceedsDeclaredLimit,
  isUuid,
  validEnvelope,
} from "./relay-request";

export const dynamic = "force-dynamic";

const MAX_TTL_MS = 10 * 60_000;

/**
 * One relay request, from one already-authenticated session.
 *
 * Auth runs before the body is touched, and the size cap runs before the body
 * is parsed. Both orders matter: `request.json()` buffers the whole request, so
 * a caller who has not yet proved who they are must not be able to make the
 * server hold bytes for them, and a caller who has must not be able to make it
 * hold more than an envelope can hold. The envelope itself was capped from the
 * start — but only after `json()` had already read it into memory.
 */
export async function POST(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  if (exceedsDeclaredLimit(request.headers.get("content-length"))) {
    return NextResponse.json({ error: "Relay body is too large." }, { status: 413 });
  }
  let body: { sessionId?: unknown; envelope?: unknown; ttlMs?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body.sessionId || !validEnvelope(body.envelope)) return NextResponse.json({ error: "sessionId and encrypted envelope are required." }, { status: 400 });
  // A `uuid` column, so free text is not a smaller version of the right value —
  // it is a 22P02 that would otherwise surface as a 500.
  if (!isUuid(body.sessionId)) {
    return NextResponse.json({ error: "sessionId must be a UUID." }, { status: 400 });
  }
  const ttl = Math.max(15_000, Math.min(Number(body.ttlMs) || 90_000, MAX_TTL_MS));
  const { data, error } = await auth.db.from("ai_mcp_relay_requests").insert({
    user_id: auth.userId, session_id: body.sessionId, request_enc: body.envelope,
    expires_at: new Date(Date.now() + ttl).toISOString(),
  }).select("id, status, expires_at").single();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "mcp-relay") }, { status: 500 });
  return NextResponse.json({ request: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  // Checked rather than handed to the query: a non-UUID is a client mistake, and
  // PostgREST's 22P02 for it is not "not found".
  if (!isUuid(id)) return NextResponse.json({ error: "id must be a UUID." }, { status: 400 });
  const { data, error } = await auth.db.from("ai_mcp_relay_requests")
    .select("id, status, response_enc, expires_at").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Relay request not found." }, { status: 404 });
  if (Date.parse(data.expires_at) <= Date.now() && data.status === "pending") return NextResponse.json({ request: { ...data, status: "expired" } }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ request: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  if (exceedsDeclaredLimit(request.headers.get("content-length"))) {
    return NextResponse.json({ error: "Relay body is too large." }, { status: 413 });
  }
  let body: { id?: unknown; envelope?: unknown; status?: "complete" | "cancelled" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body.id || (body.status !== "cancelled" && !validEnvelope(body.envelope))) return NextResponse.json({ error: "id and encrypted response are required." }, { status: 400 });
  if (!isUuid(body.id)) return NextResponse.json({ error: "id must be a UUID." }, { status: 400 });
  const { data, error } = await auth.db.from("ai_mcp_relay_requests").update({
    status: body.status ?? "complete", response_enc: body.status === "cancelled" ? null : body.envelope, completed_at: new Date().toISOString(),
  }).eq("id", body.id).eq("status", "claimed").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "mcp-relay") }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Relay request is no longer claimable." }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function disabled() {
  return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
