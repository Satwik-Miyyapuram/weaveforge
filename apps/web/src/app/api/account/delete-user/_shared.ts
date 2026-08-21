import { NextResponse } from "next/server";
import { getAdminProvisioner } from "@/backend/wire-backend";

type Provisioner = NonNullable<ReturnType<typeof getAdminProvisioner>>;

export type DeleteAccountCaller =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      provisioner: Provisioner;
      /** The bearer token, still needed to delete the account it belongs to. */
      token: string;
      callerId: string;
      email: string;
    };

/**
 * What both deletion steps need before they can do anything: a service-role
 * provisioner, a bearer token, the account it resolves to, and an address to
 * send the code to.
 *
 * Shared because the two routes are two halves of one flow — sending the code
 * and spending it — and a precondition that differs between them is a way in.
 */
export async function resolveDeleteAccountCaller(request: Request): Promise<DeleteAccountCaller> {
  const provisioner = getAdminProvisioner();
  if (!provisioner) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY for account deletion." },
        { status: 500 },
      ),
    };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  // `resolveCaller` rejects on a bad token as readily as it returns null, and
  // both mean the same thing to a caller, so the throw is answered rather than
  // left to surface as an opaque 500.
  let caller: Awaited<ReturnType<Provisioner["resolveCaller"]>>;
  try {
    caller = await provisioner.resolveCaller(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid session.";
    const status = message.startsWith("Forbidden") ? 403 : 401;
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }
  if (!caller) {
    return { ok: false, response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const email = caller.email?.trim();
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your account has no email address; contact an administrator to delete it." },
        { status: 400 },
      ),
    };
  }

  return { ok: true, provisioner, token, callerId: caller.id, email };
}
