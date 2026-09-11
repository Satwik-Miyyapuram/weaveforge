import { NextResponse } from "next/server";

import { requireSdkUser } from "../_shared";
import { formatErrorForResponse } from "@/lib/format-error";



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

  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-experiments") }, { status: 500 });

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

  if (readErr) return NextResponse.json({ error: formatErrorForResponse(readErr, "sdk-experiments") }, { status: 500 });



  let name = typeof row.name === "string" ? row.name.trim() : "";

  if (!name && existing?.name) name = String(existing.name);

  if (!name) {

    return NextResponse.json({ error: "Experiment must include id and name." }, { status: 400 });

  }



  // Ownership and bookkeeping columns are the server's; a row that names them
  // is either mistaken or probing.
  const { user_id: _u, created_at: _c, row_version: _v, server_seq: _s, deleted_at: _d, ...fields } = row;
  const upsert = { ...fields, id, name, user_id: user.userId };

  const { data, error } = await user.db.from("experiments").upsert(upsert).select("*").limit(1);

  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-experiments") }, { status: 500 });

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

  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-experiments") }, { status: 500 });

  if (!count) {

    return NextResponse.json({ error: "Experiment not found." }, { status: 404 });

  }

  return NextResponse.json({ ok: true });

}


