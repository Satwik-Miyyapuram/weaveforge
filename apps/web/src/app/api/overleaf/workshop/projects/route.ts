import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { listOverleafProjectsWithCookies } from "@/features/overleaf/infrastructure/overleaf-workshop-projects";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { jsonBodyError } from "@/lib/format-error";

export const dynamic = "force-dynamic";

/** Lists the caller's Overleaf projects for a session cookie. The cookie is not stored. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: { cookies?: unknown };
  try { body = await request.json() as typeof body; } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  const cookies = typeof body.cookies === "string" ? body.cookies.trim() : "";
  if (!cookies) return NextResponse.json({ error: "An Overleaf session cookie is required." }, { status: 400 });
  try {
    const result = await listOverleafProjectsWithCookies(cookies);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 });
    return NextResponse.json({ projects: result.projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: safeOverleafError(err, cookies) }, { status: 502 });
  }
}
