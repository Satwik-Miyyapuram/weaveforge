import { NextResponse } from "next/server";
import { orgApiErrorResponse, readOrgBody, requireOrgApiUser } from "@/app/api/org/_shared";

export async function POST(request: Request) {
  const auth = await requireOrgApiUser(request);
  if (!auth.ok) return auth.response;

  try {
    const read = await readOrgBody(request);
    if (!read.ok) return read.response;
    const body = read.body as {
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
