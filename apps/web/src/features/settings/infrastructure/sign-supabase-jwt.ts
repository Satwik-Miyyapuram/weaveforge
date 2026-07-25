import { createHmac } from "node:crypto";

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Mint a short-lived Supabase-compatible access JWT for RLS-scoped SDK calls. */
export function signSupabaseAccessJwt(
  userId: string,
  jwtSecret: string,
  expiresInSec = 3600,
): string {
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlJson({
    aud: "authenticated",
    exp: now + expiresInSec,
    iat: now,
    sub: userId,
    role: "authenticated",
  });
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", jwtSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}
