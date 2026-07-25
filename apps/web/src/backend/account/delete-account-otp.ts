import { createClient } from "@supabase/supabase-js";
import { readBackendConfig } from "@/backend/config";

/** Ephemeral auth client — no browser session; used only for delete-account OTP. */
function otpClient() {
  const config = readBackendConfig();
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required to send a confirmation code.");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Email a one-time code to confirm account deletion (must already be a user). */
export async function sendDeleteAccountOtp(email: string): Promise<void> {
  const { error } = await otpClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error(error.message);
}

/**
 * Verify the email OTP and return the authenticated user id.
 * Caller must still check that id matches the bearer session.
 */
export async function verifyDeleteAccountOtp(email: string, otp: string): Promise<string> {
  const token = otp.trim();
  if (!/^\d{6,8}$/.test(token)) {
    throw new Error("Enter the 6-digit code from your email.");
  }
  const { data, error } = await otpClient().auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Invalid or expired confirmation code.");
  }
  return data.user.id;
}
