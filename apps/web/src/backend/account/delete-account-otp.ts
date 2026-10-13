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

export function parseOtpOrLink(raw: string): { token?: string; token_hash?: string } {
  const trimmed = raw.trim();
  // 1. Direct 6 to 8 digit numeric OTP code
  if (/^\d{6,8}$/.test(trimmed)) {
    return { token: trimmed };
  }
  // 2. Full URL containing token or token_hash
  try {
    const url = new URL(trimmed);
    const tokenHash = url.searchParams.get("token_hash");
    if (tokenHash) return { token_hash: tokenHash };
    const token = url.searchParams.get("token");
    if (token) {
      if (/^\d{6,8}$/.test(token)) return { token };
      return { token_hash: token };
    }
  } catch {
    // 3. Query string or parameter without host
    if (trimmed.includes("token=") || trimmed.includes("token_hash=")) {
      const q = trimmed.includes("?") ? trimmed.slice(trimmed.indexOf("?")) : `?${trimmed}`;
      const params = new URLSearchParams(q);
      const tokenHash = params.get("token_hash");
      if (tokenHash) return { token_hash: tokenHash };
      const token = params.get("token");
      if (token) {
        if (/^\d{6,8}$/.test(token)) return { token };
        return { token_hash: token };
      }
    }
  }
  // 4. Raw token_hash string
  if (/^[a-zA-Z0-9_\-\.]{16,}$/.test(trimmed)) {
    return { token_hash: trimmed };
  }
  return {};
}

/**
 * Verify the email OTP (or confirmation link) and return the authenticated user id.
 * Caller must still check that id matches the bearer session.
 */
export async function verifyDeleteAccountOtp(email: string, otp: string): Promise<string> {
  const parsed = parseOtpOrLink(otp);
  if (!parsed.token && !parsed.token_hash) {
    throw new Error("Enter the 6-digit code or confirmation link from your email.");
  }
  const client = otpClient();
  const { data, error } = parsed.token
    ? await client.auth.verifyOtp({
        email,
        token: parsed.token,
        type: "email",
      })
    : await client.auth.verifyOtp({
        token_hash: parsed.token_hash!,
        type: "email",
      });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Invalid or expired confirmation code.");
  }
  return data.user.id;
}
