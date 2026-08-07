import { NextResponse } from "next/server";
import {
  canCreateRole,
  resolveSupervisorId,
  validateNewMember,
  MemberValidationError,
} from "@weaveforge/core";
import { getAdminProvisioner } from "@/backend/wire-backend";

/**
 * Privileged account provisioning.
 *
 *   POST /api/admin/create-user
 *   Authorization: Bearer <caller access token>
 *   { email, password, fullName?, role, supervisorId? }
 */
export async function POST(request: Request) {
  const provisioner = getAdminProvisioner();
  if (!provisioner) {
    return NextResponse.json(
      { error: "Server is missing admin provisioner config (SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 500 },
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const me = await provisioner.resolveCaller(token);
  if (!me) {
    return NextResponse.json({ error: "Invalid session or missing member profile." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = body as {
    email?: string;
    password?: string;
    fullName?: string;
    role?: import("@weaveforge/core").Role;
    supervisorId?: string;
  };

  let input;
  try {
    input = validateNewMember({
      email: raw.email ?? "",
      password: raw.password ?? "",
      fullName: raw.fullName,
      role: raw.role as import("@weaveforge/core").Role,
      supervisorId: raw.supervisorId,
    });
  } catch (err) {
    const message = err instanceof MemberValidationError ? err.message : "Invalid input.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!canCreateRole(me.role, input.role)) {
    return NextResponse.json(
      { error: `A ${me.role} cannot create a ${input.role} account.` },
      { status: 403 },
    );
  }

  const supervisorId = resolveSupervisorId(me, input);

  try {
    const member = await provisioner.provisionUser({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
      role: input.role,
      supervisorId,
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create user.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
