import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAuthService } from "../infrastructure/supabase-auth.js";

test("Supabase auth updates a login password through the auth provider", async () => {
  let received: string | undefined;
  const db = {
    auth: {
      updateUser: async ({ password }: { password: string }) => {
        received = password;
        return { data: {}, error: null };
      },
    },
  } as never;
  await new SupabaseAuthService(db).updatePassword("new-password-123");
  assert.equal(received, "new-password-123");
});

test("Supabase auth sends password reset links to the dedicated reset route", async () => {
  let request: { email?: string; redirectTo?: string } | undefined;
  const db = {
    auth: {
      resetPasswordForEmail: async (email: string, options: { redirectTo?: string }) => {
        request = { email, redirectTo: options.redirectTo };
        return { data: {}, error: null };
      },
    },
  } as never;
  await new SupabaseAuthService(db).sendPasswordReset("researcher@example.com", "https://app.test/reset-password");
  assert.deepEqual(request, { email: "researcher@example.com", redirectTo: "https://app.test/reset-password" });
});

test("Supabase auth propagates password-management errors", async () => {
  const db = {
    auth: {
      updateUser: async () => ({ data: {}, error: new Error("password rejected") }),
      resetPasswordForEmail: async () => ({ data: {}, error: new Error("email unavailable") }),
    },
  } as never;
  await assert.rejects(() => new SupabaseAuthService(db).updatePassword("bad"), /password rejected/);
  await assert.rejects(() => new SupabaseAuthService(db).sendPasswordReset("a@b.test"), /email unavailable/);
});

test("Supabase auth sends and verifies an email OTP", async () => {
  let sentEmail: string | undefined;
  let verified: { email?: string; token?: string; type?: string } | undefined;
  const db = {
    auth: {
      signInWithOtp: async ({ email }: { email: string }) => {
        sentEmail = email;
        return { data: {}, error: null };
      },
      verifyOtp: async (input: { email: string; token: string; type: string }) => {
        verified = input;
        return { data: {}, error: null };
      },
    },
  } as never;
  const auth = new SupabaseAuthService(db);
  await auth.sendEmailOtp("researcher@example.com");
  await auth.verifyEmailOtp("researcher@example.com", "123456");
  assert.equal(sentEmail, "researcher@example.com");
  assert.deepEqual(verified, { email: "researcher@example.com", token: "123456", type: "email" });
});

function googleDb() {
  const calls: { method: string; input: unknown }[] = [];
  const db = {
    auth: {
      signInWithIdToken: async (input: unknown) => {
        calls.push({ method: "idToken", input });
        return { data: {}, error: null };
      },
      signInWithOAuth: async (input: unknown) => {
        calls.push({ method: "oauth", input });
        return { data: {}, error: null };
      },
    },
  } as never;
  return { db, calls };
}

test("Google sign-in on Android redeems the picked account's ID token with its nonce", async () => {
  const { db, calls } = googleDb();
  const native = async () => ({ kind: "signed-in" as const, idToken: "h.p.s", nonce: "n1" });
  await new SupabaseAuthService(db, native).signInWithGoogle("https://app.test/");
  assert.deepEqual(calls, [{ method: "idToken", input: { provider: "google", token: "h.p.s", nonce: "n1" } }]);
});

test("Google sign-in does nothing when the account picker is closed", async () => {
  const { db, calls } = googleDb();
  await new SupabaseAuthService(db, async () => ({ kind: "cancelled" as const })).signInWithGoogle();
  assert.deepEqual(calls, []);
});

test("Google sign-in falls back to the web redirect without a picker", async () => {
  const { db, calls } = googleDb();
  await new SupabaseAuthService(db, async () => ({ kind: "unavailable" as const })).signInWithGoogle("https://app.test/");
  assert.deepEqual(calls, [{ method: "oauth", input: { provider: "google", options: { redirectTo: "https://app.test/" } } }]);
});

test("a rejected ID token is raised, not retried through the redirect", async () => {
  const db = {
    auth: {
      signInWithIdToken: async () => ({ data: {}, error: new Error("nonce mismatch") }),
      signInWithOAuth: async () => assert.fail("must not redirect"),
    },
  } as never;
  const native = async () => ({ kind: "signed-in" as const, idToken: "t", nonce: "n" });
  await assert.rejects(() => new SupabaseAuthService(db, native).signInWithGoogle(), /nonce mismatch/);
});
