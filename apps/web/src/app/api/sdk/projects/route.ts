import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";

export async function GET(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "Missing project name." }, { status: 400 });

  const { data, error } = await user.db
    .from("projects")
    .select("id,name")
    .eq("name", name)
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = (data ?? [])[0] ?? null;
  return NextResponse.json({ projectId: row?.id ?? null });
}

