import { NextResponse } from "next/server";
import { orgApiErrorResponse, requireOrgApiUser } from "@/app/api/org/_shared";

export async function POST(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { name?: string };
    const result = await auth.svc.createOrganization(auth.userId, body.name ?? "");
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}
