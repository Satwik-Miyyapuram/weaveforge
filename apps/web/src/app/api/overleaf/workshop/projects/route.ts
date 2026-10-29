import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { cookiesForSession } from "@/app/api/overleaf/workshop/_session-store";
import { listOverleafProjectsWithCookies } from "@/features/overleaf/infrastructure/overleaf-workshop-projects";
import { readWorkshopSessionId } from "@/features/overleaf/infrastructure/overleaf-workshop-request";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { jsonBodyError } from "@/lib/format-error";

export const dynamic = "force-dynamic";

/** Lists the caller's Overleaf projects for a stored session. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  const parsed = readWorkshopSessionId(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  let cookies: string | null = null;
  try {
    cookies = await cookiesForSession(auth, parsed.value);
    if (!cookies) return NextResponse.json({ error: "Overleaf session not found. Sign in again." }, { status: 401 });
    const result = await listOverleafProjectsWithCookies(cookies);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 });
    return NextResponse.json({ projects: result.projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: safeOverleafError(err, cookies ?? undefined) }, { status: 502 });
  }
}
