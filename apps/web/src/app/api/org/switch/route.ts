import { NextResponse } from "next/server";
import { orgApiErrorResponse, requireOrgApiUser } from "@/app/api/org/_shared";

export async function POST(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { orgId?: string };
    if (!body.orgId) {
      return NextResponse.json({ error: "orgId required" }, { status: 400 });
    }
    await auth.svc.switchActiveOrganization(auth.userId, body.orgId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}
