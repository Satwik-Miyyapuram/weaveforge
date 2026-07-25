import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { sealOverleafToken } from "@/features/overleaf/infrastructure/overleaf-token-crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.db.from("overleaf_connections")
    .select("id,name,token_prefix,enabled,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: { name?: string; token?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const name = body.name?.trim();
  const token = body.token?.trim();
  if (!name || !token) return NextResponse.json({ error: "Connection name and token are required." }, { status: 400 });
  try {
    const { data, error } = await auth.db.from("overleaf_connections").insert({
      user_id: auth.userId, name, token_ciphertext: sealOverleafToken(token), token_prefix: token.slice(0, 4),
    }).select("id,name,token_prefix,enabled,created_at,updated_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ connection: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Connection id required." }, { status: 400 });
  const { error } = await auth.db.from("overleaf_connections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
