import { NextResponse } from "next/server";
import type { OrgInviteRole } from "@weaveforge/core";
import {
  orgApiErrorResponse,
  requireOrgApiUser,
} from "@/app/api/org/_shared";

export async function GET(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code.trim()) return NextResponse.json({ error: "code required" }, { status: 400 });
  try {
    const preview = await auth.svc.previewCode(code);
    if (!preview) return NextResponse.json({ error: "Invalid code." }, { status: 404 });
    return NextResponse.json(preview);
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { orgId?: string; targetRole?: OrgInviteRole };
    if (!body.orgId || !body.targetRole) {
      return NextResponse.json({ error: "orgId and targetRole required." }, { status: 400 });
    }
    const code = await auth.svc.regenerateCode(auth.userId, body.orgId, body.targetRole);
    return NextResponse.json(code);
  } catch (err) {
    // Same helper as GET, so both verbs answer identically for the same
    // condition. This used to answer 403 for every `OrgValidationError`,
    // including "Lab not found." and the plain input errors — while the shared
    // helper answered 400 for the same class (review-2 F5). "Only the lab owner
    // can regenerate codes" belongs on a PermissionError, which maps to 403
    // here without a special case.
    return orgApiErrorResponse(err);
  }
}
