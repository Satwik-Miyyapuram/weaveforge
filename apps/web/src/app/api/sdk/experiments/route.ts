import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";

export async function GET(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing experiment id." }, { status: 400 });
  }

  const { data, error } = await user.db
    .from("experiments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ experiment: data ?? null });
}

export async function POST(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const row = body as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "Experiment must include id." }, { status: 400 });
  }

  const { data: existing, error: readErr } = await user.db
    .from("experiments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  let name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name && existing?.name) name = String(existing.name);
  if (!name) {
    return NextResponse.json({ error: "Experiment must include id and name." }, { status: 400 });
  }

  const upsert = { ...row, id, name, user_id: user.userId };
  const { data, error } = await user.db.from("experiments").upsert(upsert).select("*").limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const saved = (data ?? [])[0] ?? null;
  return NextResponse.json({ experiment: saved });
}

export async function DELETE(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing experiment id." }, { status: 400 });
  }

  const { error, count } = await user.db
    .from("experiments")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) {
    return NextResponse.json({ error: "Experiment not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
