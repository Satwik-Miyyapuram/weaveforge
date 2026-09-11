import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";
import { formatErrorForResponse } from "@/lib/format-error";

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
  // A PostgREST failure carries the raw Postgres message, which names tables,
  // columns and constraint indexes. The detail goes to the log; the caller gets
  // the SQLSTATE's safe wording plus the code.
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-projects") }, { status: 500 });
  const row = (data ?? [])[0] ?? null;
  return NextResponse.json({ projectId: row?.id ?? null });
}
