import { NextResponse } from "next/server";
import { getAdminProvisioner } from "@/backend/wire-backend";
import { sendDeleteAccountOtp } from "@/backend/account/delete-account-otp";

/**
 * Send an email OTP confirming the signed-in user intends to delete their account.
 *
 *   POST /api/account/delete-user/otp
 *   Authorization: Bearer <access token>
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
    await sendDeleteAccountOtp(email);
    return NextResponse.json({ ok: true, emailHint: maskEmail(email) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send confirmation code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
