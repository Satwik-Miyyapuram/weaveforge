import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
  AuthChangeCallback,
  AuthUser,
  IAuthService,
} from "@weaveforge/core";
import { run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase implementation of IAuthService.
 *
 * The ONLY place the supabase auth SDK is touched. Maps Supabase's `User` to
 * the app's `AuthUser`. No UI, no business rules.
 */
export class SupabaseAuthService implements IAuthService {
  private userRequest: Promise<AuthUser | null> | null = null;

  constructor(private readonly db: SupabaseClient) {}

  getUser(): Promise<AuthUser | null> {
    if (this.userRequest) return this.userRequest;
    this.userRequest = this.db.auth.getUser().then(({ data, error }) => {
      if (error) return null; // not signed in
      return data.user ? toAuthUser(data.user) : null;
    }).finally(() => {
      this.userRequest = null;
    });
    return this.userRequest;
  }

  async getAccessToken(): Promise<string | null> {
    const { data } = await this.db.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    await run(this.db.auth.signInWithPassword({
      email,
      password,
    }));
  }

  async signUpWithPassword(email: string, password: string): Promise<void> {
    await run(this.db.auth.signUp({
      email,
      password,
    }));
  }

  async updatePassword(password: string): Promise<void> {
    await run(this.db.auth.updateUser({ password }));
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    await run(this.db.auth.resetPasswordForEmail(email, {
      redirectTo,
    }));
  }

  async sendEmailOtp(email: string): Promise<void> {
    await run(this.db.auth.signInWithOtp({ email }));
  }

  async verifyEmailOtp(email: string, token: string): Promise<void> {
    await run(this.db.auth.verifyOtp({ email, token, type: "email" }));
  }

  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    await run(this.db.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    }));
  }

  async signInWithGoogle(redirectTo?: string): Promise<void> {
    await run(this.db.auth.signInWithOAuth({
      provider: "google",
      options: redirectTo ? { redirectTo } : undefined,
    }));
  }

  /**
   * Redeems the code a provider sent back.
   *
   * A refusal arrives as `error_description` and is raised as it was written:
   * the provider's own words are what a person can act on, and inventing a
   * message here would hide which of a dozen reasons it actually was.
   */
  async completeOAuth(callbackQuery: string): Promise<void> {
    const params = new URLSearchParams(callbackQuery);
    const refusal = params.get("error_description") ?? params.get("error");
    if (refusal) throw new Error(refusal);
    const code = params.get("code");
    if (!code) throw new Error("The sign-in came back without a code.");
    await run(this.db.auth.exchangeCodeForSession(code));
  }

  async signOut(): Promise<void> {
    await run(this.db.auth.signOut());
  }

  onChange(cb: AuthChangeCallback): () => void {
    const { data } = this.db.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ? toAuthUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }
}

function providersForUser(user: User): string[] {
  // Identities are authoritative: an "email" identity means a real password
  // credential exists. Only fall back to app_metadata when identities are
  // absent, and never assume "email" — defaulting to it wrongly shows the
  // change-password UI to OAuth-only (e.g. Google) accounts.
  const fromIdentities = user.identities?.map((i) => i.provider).filter(Boolean) as string[] | undefined;
  if (fromIdentities && fromIdentities.length > 0) return fromIdentities;

  const meta = user.app_metadata as { providers?: unknown; provider?: unknown } | undefined;
  if (Array.isArray(meta?.providers)) return meta.providers.map(String);
  if (meta?.provider) return [String(meta.provider)];
  return [];
}

function toAuthUser(user: User): AuthUser {
  const providers = providersForUser(user);
  return {
    id: user.id,
    email: user.email ?? undefined,
    emailVerified: Boolean(user.email_confirmed_at),
    providers,
    // Auth identities authenticate the account but are not encryption secrets.
    unlockSecret: null,
    legacyUnlockSecret: legacyUnlockSecretFromIdentities(user),
  };
}

/** Transitional bridge for records created before device-key migration. */
function legacyUnlockSecretFromIdentities(user: User): string | null {
  const google = user.identities?.find((identity) => identity.provider === "google");
  const sub = (google?.identity_data as { sub?: string } | undefined)?.sub;
  return sub ? `google:${sub}` : null;
}

/** Portable KEK input — signing in again with the same provider reproduces this value. */
