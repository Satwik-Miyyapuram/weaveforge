import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { openOverleafToken } from "@/features/overleaf/infrastructure/overleaf-token-crypto";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { readOverleafProject } from "@/features/overleaf/infrastructure/overleaf-git-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const { data: report, error } = await auth.db.from("overleaf_linked_reports")
    .select("id,overleaf_project_id,entry_file,external_url,connection_id")
    .eq("id", context.params.id).eq("user_id", auth.userId).eq("enabled", true).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Linked Overleaf report not found." }, { status: 404 });
  const { data: connection } = await auth.db.from("overleaf_connections")
    .select("token_ciphertext").eq("id", report.connection_id).eq("user_id", auth.userId).eq("enabled", true).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Overleaf connection is unavailable." }, { status: 404 });
  let token: string | undefined;
  try {
    token = openOverleafToken(connection.token_ciphertext);
    const content = await readOverleafProject(report.overleaf_project_id, report.entry_file, token);
    await auth.db.from("overleaf_linked_reports").update({ last_fetched_at: new Date().toISOString(), last_error: null }).eq("id", report.id).eq("user_id", auth.userId);
    return NextResponse.json({ reportId: report.id, ...content }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = safeOverleafError(error, token);
    await auth.db.from("overleaf_linked_reports").update({ last_error: message.slice(0, 500) }).eq("id", report.id).eq("user_id", auth.userId);
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
