import { NextResponse } from "next/server";
import { orgApiErrorResponse, requireOrgApiUser } from "@/app/api/org/_shared";

export async function GET(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const memberships = await auth.svc.listMemberships(auth.userId);
    return NextResponse.json({ memberships });
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}
