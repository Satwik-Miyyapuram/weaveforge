import { NextResponse } from "next/server";
import { orgApiErrorResponse, requireOrgApiUser } from "@/app/api/org/_shared";

export async function GET(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const organizations = await auth.svc.listOwnedOrganizations(auth.userId);
    return NextResponse.json({ organizations });
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}
