import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { formatErrorForResponse, jsonBodyError } from "@/lib/format-error";
import { createLinkedReport, patchLinkedReport, ROW_FIELDS } from "./_reports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const projectId = new URL(request.url).searchParams.get("projectId");
  let query = auth.db.from("overleaf_linked_reports")
    .select(ROW_FIELDS)
    .order("updated_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "overleaf-reports") }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  return createLinkedReport(auth, body);
}

export async function PATCH(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  return patchLinkedReport(auth, body);
}

/** Unlinks the report here. The Overleaf project is untouched. */
export async function DELETE(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Report id required." }, { status: 400 });
  const { error, count } = await auth.db.from("overleaf_linked_reports")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.userId);
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "overleaf-reports") }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
