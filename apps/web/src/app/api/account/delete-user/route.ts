import { NextResponse } from "next/server";
import { getAdminProvisioner } from "@/backend/wire-backend";
import { verifyDeleteAccountOtp } from "@/backend/account/delete-account-otp";

const CONFIRMATION = "DELETE_USER";

/**
 * Self-service account deletion.
 *
 *   POST /api/account/delete-user
 *   Authorization: Bearer <access token>
 *   { "confirmation": "DELETE_USER", "otp": "<email code>" }
 */
export async function POST(request: Request) {
  const provisioner = getAdminProvisioner();
  if (!provisioner) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY for account deletion." },
      { status: 500 },
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { confirmation?: string; otp?: string };
  try {
    body = (await request.json()) as { confirmation?: string; otp?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.confirmation !== CONFIRMATION) {
    return NextResponse.json(
      { error: `Type ${CONFIRMATION} to confirm account deletion.` },
      { status: 400 },
    );
  }

  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  if (!otp) {
    return NextResponse.json(
      { error: "Enter the confirmation code emailed to you." },
      { status: 400 },
    );
  }

  try {
    const caller = await provisioner.resolveCaller(token);
    if (!caller) return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    const email = caller.email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "Your account has no email address; contact an administrator to delete it." },
        { status: 400 },
      );
    }

    const otpUserId = await verifyDeleteAccountOtp(email, otp);
    if (otpUserId !== caller.id) {
      return NextResponse.json({ error: "Confirmation code does not match this account." }, { status: 403 });
    }

    await provisioner.deleteOwnAccount(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete account.";
    const status =
      message === "Invalid session."
        ? 401
        : message.startsWith("Forbidden")
          ? 403
          : /invalid|expired|confirmation code|6-digit/i.test(message)
            ? 400
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
