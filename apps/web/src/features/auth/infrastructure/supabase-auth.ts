import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
  AuthChangeCallback,
  AuthUser,
  IAuthService,
} from "@weaveforge/core";

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
    const { error } = await this.db.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async signUpWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.db.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.db.auth.updateUser({ password });
    if (error) throw error;
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    const { error } = await this.db.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  }

  async sendEmailOtp(email: string): Promise<void> {
    const { error } = await this.db.auth.signInWithOtp({ email });
    if (error) throw error;
  }

  async verifyEmailOtp(email: string, token: string): Promise<void> {
    const { error } = await this.db.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
  }

  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    const { error } = await this.db.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (error) throw error;
  }

  async signInWithGoogle(redirectTo?: string): Promise<void> {
    const { error } = await this.db.auth.signInWithOAuth({
      provider: "google",
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.db.auth.signOut();
    if (error) throw error;
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
