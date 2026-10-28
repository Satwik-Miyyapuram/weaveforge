import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { pgrestWorkshopSessionStore } from "@/app/api/overleaf/workshop/_session-store";
import { OVERLEAF_BASE_URL } from "@/features/overleaf/infrastructure/overleaf-workshop-projects";
import { createWorkshopSession, deleteWorkshopSession } from "@/features/overleaf/infrastructure/overleaf-workshop-session";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import { BaseAPI } from "@/features/overleaf/vendor/overleaf-workshop/base-api";
import { jsonBodyError } from "@/lib/format-error";

export const dynamic = "force-dynamic";

/** Verifies an Overleaf session cookie, stores it sealed, and returns only an opaque session id. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: { cookies?: unknown };
  try { body = await request.json() as typeof body; } catch (err) { return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 }); }
  const cookies = typeof body.cookies === "string" ? body.cookies.trim() : "";
  if (!cookies) return NextResponse.json({ error: "An Overleaf session cookie is required." }, { status: 400 });
  try {
    const result = await createWorkshopSession(pgrestWorkshopSessionStore(auth.db, auth.userId), cookies, new BaseAPI(OVERLEAF_BASE_URL));
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 401 });
    return NextResponse.json({ sessionId: result.sessionId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: safeOverleafError(err, cookies) }, { status: 502 });
  }
}

/** Forgets a stored session. */
export async function DELETE(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Session id required." }, { status: 400 });
  try {
    await deleteWorkshopSession(pgrestWorkshopSessionStore(auth.db, auth.userId), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: safeOverleafError(err) }, { status: 502 });
  }
}
