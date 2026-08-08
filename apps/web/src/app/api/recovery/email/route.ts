import { NextResponse } from "next/server";
import { createRestClient } from "@/backend/providers/supabase/client";
import { missingConfigMessage, readBackendConfig } from "@/backend/config";
import { requireSdkUser } from "@/app/api/sdk/_shared";

export const dynamic = "force-dynamic";

/**
 * Store-on-setup and resend-on-demand for the email-recovery link.
 *
 * With a `secret` in the body (setup, from an unlocked device) the secret is
 * persisted and the link is emailed. Without one (resend, from a locked-out but
 * signed-in device) the stored secret is looked up and re-emailed. The secret
 * is never returned to the client — its only exit is the email to the verified
 * address, which is the security boundary we accept for email recovery.
 */
/** Whether a recovery secret is stored, so the client knows to back-fill one. */
export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const cfg = readBackendConfig();
  const { supabaseUrl: url, supabaseServiceRoleKey: service } = cfg;
  const missing = missingConfigMessage(cfg, ["supabaseUrl", "supabaseServiceRoleKey"]);
  if (missing || !url || !service) {
    return NextResponse.json({ error: missing ?? "Email recovery is not configured on this server." }, { status: 503 });
  }
  const admin = createRestClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("user_email_recovery_secrets")
    .select("user_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configured: Boolean(data) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const cfg = readBackendConfig();
  const { supabaseUrl: url, supabaseAnonKey: anon, supabaseServiceRoleKey: service } = cfg;
  const missingPost = missingConfigMessage(cfg, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]);
  if (missingPost || !url || !anon || !service) {
    return NextResponse.json({ error: missingPost ?? "Email recovery is not configured on this server." }, { status: 503 });
  }

  let body: { secret?: string; send?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Resend carries no body; a malformed one is treated the same way.
  }

  const admin = createRestClient(url, service, { auth: { persistSession: false } });

  // The verified email is the whole boundary, so read it server-side rather
  // than trusting anything the client sends.
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(auth.userId);
  if (userErr || !userData.user?.email) {
    return NextResponse.json({ error: "No email address on file." }, { status: 400 });
  }
  if (!userData.user.email_confirmed_at) {
    return NextResponse.json({ error: "Verify your email address before using email recovery." }, { status: 400 });
  }
  const email = userData.user.email;

  let secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (secret) {
    const { error } = await admin.from("user_email_recovery_secrets").upsert({
      user_id: auth.userId,
      secret,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Back-fill from an unlocked device: store the secret so a future lockout
    // can ask for the link, without mailing anything right now.
    if (body.send === false) {
      return NextResponse.json({ ok: true, sent: false }, { headers: { "Cache-Control": "no-store" } });
    }
  } else {
    const { data, error } = await admin
      .from("user_email_recovery_secrets")
      .select("secret")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "email_recovery_not_set_up" }, { status: 404 });
    secret = data.secret as string;
  }

  // Same-origin fetch, so the browser-set Origin is our own app; never take a
  // redirect target from the request body (that would leak the secret offsite).
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const redirectTo = `${origin}/recover?secret=${encodeURIComponent(secret)}`;

  const sender = createRestClient(url, anon, { auth: { persistSession: false } });
  const { error: sendErr } = await sender.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (sendErr) return NextResponse.json({ error: sendErr.message }, { status: 502 });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
