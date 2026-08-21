import { NextResponse } from "next/server";
import { sendDeleteAccountOtp } from "@/backend/account/delete-account-otp";
import { resolveDeleteAccountCaller } from "../_shared";

/**
 * Send an email OTP confirming the signed-in user intends to delete their account.
 *
 *   POST /api/account/delete-user/otp
 *   Authorization: Bearer <access token>
 */
export async function POST(request: Request) {
  const caller = await resolveDeleteAccountCaller(request);
  if (!caller.ok) return caller.response;

  try {
    await sendDeleteAccountOtp(caller.email);
    return NextResponse.json({ ok: true, emailHint: maskEmail(caller.email) });
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
