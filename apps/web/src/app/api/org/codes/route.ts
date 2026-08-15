import { NextResponse } from "next/server";
import { OrgValidationError } from "@weaveforge/core";
import type { OrgInviteRole } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";
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
    const message = formatError(err);
    const status = err instanceof OrgValidationError ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
