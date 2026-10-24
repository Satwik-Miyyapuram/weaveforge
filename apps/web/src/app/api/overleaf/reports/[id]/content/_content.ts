import { NextResponse } from "next/server";
import type { ApiCaller } from "@/app/api/sdk/_shared";
import { formatErrorForResponse } from "@/lib/format-error";
import { openOverleafToken } from "@/features/overleaf/infrastructure/overleaf-token-crypto";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { readOverleafProject } from "@/features/overleaf/infrastructure/overleaf-git-reader";

/**
 * Reads one linked report's sources for its owner. Kept out of `route.ts` so the
 * status contract can be tested without a signed-in caller: 404 only when a row
 * is missing, 500 when the database cannot say, 502 when Overleaf fails.
 */
export async function linkedReportContent(
  caller: Pick<ApiCaller, "db" | "userId">,
  id: string,
  read: typeof readOverleafProject = readOverleafProject,
): Promise<NextResponse> {
  const { db, userId } = caller;
  const { data: report, error } = await db.from("overleaf_linked_reports")
    .select("id,overleaf_project_id,entry_file,external_url,connection_id")
    .eq("id", id).eq("user_id", userId).eq("enabled", true).maybeSingle();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "overleaf-content") }, { status: 500 });
  if (!report) return NextResponse.json({ error: "Linked Overleaf report not found." }, { status: 404 });
  const { data: connection, error: connectionError } = await db.from("overleaf_connections")
    .select("token_ciphertext").eq("id", report.connection_id).eq("user_id", userId).eq("enabled", true).maybeSingle();
  if (connectionError) {
    return NextResponse.json({ error: formatErrorForResponse(connectionError, "overleaf-content") }, { status: 500 });
  }
  if (!connection) return NextResponse.json({ error: "Overleaf connection is unavailable." }, { status: 404 });
  let token: string | undefined;
  try {
    token = openOverleafToken(connection.token_ciphertext);
    const content = await read(report.overleaf_project_id, report.entry_file, token);
    await db.from("overleaf_linked_reports").update({ last_fetched_at: new Date().toISOString(), last_error: null }).eq("id", report.id).eq("user_id", userId);
    return NextResponse.json({ reportId: report.id, ...content }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = safeOverleafError(error, token);
    await db.from("overleaf_linked_reports").update({ last_error: message.slice(0, 500) }).eq("id", report.id).eq("user_id", userId);
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
