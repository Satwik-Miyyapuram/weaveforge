import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { cookiesForSession } from "@/app/api/overleaf/workshop/_session-store";
import { fetchOverleafPdfWithCookies } from "@/features/overleaf/infrastructure/overleaf-workshop-compile";
import { readWorkshopRequest } from "@/features/overleaf/infrastructure/overleaf-workshop-request";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { jsonBodyError } from "@/lib/format-error";

export const dynamic = "force-dynamic";

/** Compiles an Overleaf project using a stored session and returns output.pdf. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  const parsed = readWorkshopRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const { sessionId, projectId, rootResourcePath } = parsed.value;
  try {
    const cookies = await cookiesForSession(auth, sessionId);
    if (!cookies) return NextResponse.json({ error: "Overleaf session not found. Sign in again." }, { status: 401 });
    const result = await fetchOverleafPdfWithCookies(cookies, projectId, rootResourcePath);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 });
    return new Response(result.pdf as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: safeOverleafError(err) }, { status: 502 });
  }
}
