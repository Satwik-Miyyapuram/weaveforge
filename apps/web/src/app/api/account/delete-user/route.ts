import { NextResponse } from "next/server";
import { verifyDeleteAccountOtp } from "@/backend/account/delete-account-otp";
import { resolveDeleteAccountCaller } from "./_shared";

const CONFIRMATION = "DELETE_USER";

/**
 * Self-service account deletion.
 *
 *   POST /api/account/delete-user
 *   Authorization: Bearer <access token>
 *   { "confirmation": "DELETE_USER", "otp": "<email code>" }
 */
export async function POST(request: Request) {
  const caller = await resolveDeleteAccountCaller(request);
  if (!caller.ok) return caller.response;

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
    const otpUserId = await verifyDeleteAccountOtp(caller.email, otp);
    if (otpUserId !== caller.callerId) {
      return NextResponse.json(
        { error: "Confirmation code does not match this account." },
        { status: 403 },
      );
    }

    await caller.provisioner.deleteOwnAccount(caller.token);
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
