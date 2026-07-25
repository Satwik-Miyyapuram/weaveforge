import { NextResponse } from "next/server";
import { orgApiErrorResponse, requireOrgApiUser } from "@/app/api/org/_shared";

export async function POST(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      code?: string;
      phdSupervisorId?: string;
      professorSupervisorId?: string;
    };
    const result = await auth.svc.joinOrganization(auth.userId, {
      code: body.code ?? "",
      phdSupervisorId: body.phdSupervisorId,
      professorSupervisorId: body.professorSupervisorId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return orgApiErrorResponse(err);
  }
}
