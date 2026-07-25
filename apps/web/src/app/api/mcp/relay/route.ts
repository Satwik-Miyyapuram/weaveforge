import { NextResponse } from "next/server";
import { requireMcpRelayUser } from "@/app/api/sdk/_shared";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";

export const dynamic = "force-dynamic";

const MAX_ENVELOPE_BYTES = 64_000;
const MAX_TTL_MS = 10 * 60_000;

type Envelope = { iv: string; ciphertext: string };

function validEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Envelope;
  if (typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string") return false;
  // Both fields are base64, so one char is one byte on the wire. Measuring the
  // payload directly avoids serialising the envelope only to count UTF-16
  // units, which under-counts the real size by up to 3x.
  return envelope.iv.length + envelope.ciphertext.length <= MAX_ENVELOPE_BYTES;
}

export async function POST(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  let body: { sessionId?: string; envelope?: unknown; ttlMs?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body.sessionId || !validEnvelope(body.envelope)) return NextResponse.json({ error: "sessionId and encrypted envelope are required." }, { status: 400 });
  const ttl = Math.max(15_000, Math.min(Number(body.ttlMs) || 90_000, MAX_TTL_MS));
  const { data, error } = await auth.db.from("ai_mcp_relay_requests").insert({
    user_id: auth.userId, session_id: body.sessionId, request_enc: body.envelope,
    expires_at: new Date(Date.now() + ttl).toISOString(),
  }).select("id, status, expires_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!GENERATED_MCP_ENABLED) return disabled();
  const auth = await requireMcpRelayUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
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
  let body: { id?: string; envelope?: unknown; status?: "complete" | "cancelled" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body.id || (body.status !== "cancelled" && !validEnvelope(body.envelope))) return NextResponse.json({ error: "id and encrypted response are required." }, { status: 400 });
  const { data, error } = await auth.db.from("ai_mcp_relay_requests").update({
    status: body.status ?? "complete", response_enc: body.status === "cancelled" ? null : body.envelope, completed_at: new Date().toISOString(),
  }).eq("id", body.id).eq("status", "claimed").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Relay request is no longer claimable." }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function disabled() {
  return NextResponse.json({ error: "mcp_disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
