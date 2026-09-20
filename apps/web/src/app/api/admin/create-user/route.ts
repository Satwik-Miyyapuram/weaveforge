import { NextResponse } from "next/server";
import {
  canCreateRole,
  resolveSupervisorId,
  validateNewMember,
  MemberValidationError,
} from "@weaveforge/core";
import type { Role } from "@weaveforge/core";
import { getAdminProvisioner } from "@/backend/wire-backend";
import { formatError, formatErrorForResponse } from "@/lib/format-error";

/**
 * The auth provider's "that address is taken" wording.
 *
 * A message match, and deliberately a narrow one. `validateNewMember` already
 * rejected every malformed input before `provisionUser` is called, so the only
 * caller-fault failure the provider can still report is a duplicate address —
 * everything else it can say is about the deployment.
 *
 * It is a match rather than a check of the error's `code` because
 * `SupabaseAdminUserProvisioner.provisionUser` reduces the provider's error to
 * `new Error(createErr.message)`, discarding the `code` and `status` that would
 * make this exact. The right fix is a typed error thrown from
 * `apps/web/src/backend/providers/supabase/admin-provisioner.ts`, which this
 * change does not own; until then this is the smallest thing that keeps a
 * duplicate email from being reported as a server fault, and the two patterns
 * it accepts are the two shapes GoTrue uses.
 */
const ALREADY_REGISTERED = [/already (been )?registered/i, /already exists/i];

function isAlreadyRegistered(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return ALREADY_REGISTERED.some((pattern) => pattern.test(message));
}

/**
 * Privileged account provisioning.
 *
 *   POST /api/admin/create-user
 *   Authorization: Bearer <caller access token>
 *   { email, password, fullName?, role, supervisorId? }
 *
 * Two mappings this route had wrong, both of which pointed an operator at the
 * wrong thing:
 *
 *   * `resolveCaller` was called outside a `try`. It reads the caller's profile
 *     through the auth service, so an auth outage or a bad service-role key
 *     threw out of the handler and Next.js answered with its own unhandled-error
 *     page — a 500 with no body, and no log that said which dependency was
 *     down. It is wrapped now, and an infrastructure failure is a `503` with a
 *     message that says so rather than a `500` page.
 *   * Provisioning failures were all `400`. `provisionUser` can fail because
 *     the email is already registered, because the password is too short —
 *     genuine caller mistakes — but also because the service-role key is wrong
 *     or Supabase is unreachable, and those are not the caller's to fix. The
 *     catch now separates the two: a `MemberValidationError` is a `400` with
 *     its own message, anything else is a `502` with the detail logged
 *     server-side and a generic body.
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

  let me: Awaited<ReturnType<typeof provisioner.resolveCaller>>;
  try {
    me = await provisioner.resolveCaller(token);
  } catch (err) {
    // The auth service itself failed. Not a 403: the caller may be perfectly
    // valid and the deployment simply cannot tell.
    return NextResponse.json(
      { error: formatErrorForResponse(err, "admin-create-user") },
      { status: 503 },
    );
  }
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
    role?: Role;
    supervisorId?: string;
  };

  let input;
  try {
    input = validateNewMember({
      email: raw.email ?? "",
      password: raw.password ?? "",
      fullName: raw.fullName,
      role: raw.role as Role,
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
    // A validation error is the caller's to fix and says so plainly.
    if (err instanceof MemberValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // The one caller-fault failure that reaches here from the provider: the
    // address already has an account. See `ALREADY_REGISTERED` for why this is
    // a message match rather than a code.
    if (isAlreadyRegistered(err)) {
      return NextResponse.json(
        { error: "An account with that email address already exists." },
        { status: 409 },
      );
    }
    // Everything else — a bad service-role key, an unreachable auth service —
    // is the deployment's, not the caller's. The detail goes to the log; the
    // caller gets the shape of it rather than a `400` telling them to check
    // input that was already validated above.
    console.error(`[admin-create-user] provisioning failed: ${formatError(err)}`);
    return NextResponse.json({ error: "Could not create the account." }, { status: 502 });
  }
}
