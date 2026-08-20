/** Signed-in user identity (provider-agnostic). */
export interface AuthUser {
  id: string;
  email?: string;
  /** Whether the identity provider has confirmed the account email. */
  emailVerified?: boolean;
  /** Linked sign-in providers, e.g. `email`, `google`. */
  providers: readonly string[];
  /**
   * Stable secret derived from linked OAuth / email identity for E2EE unlock
   * when no login password is available (Google, magic link).
   */
  unlockSecret?: string | null;
  /** Transitional only: old Google-derived setup secret, never used for new keys. */
  legacyUnlockSecret?: string | null;
}

export type AuthChangeCallback = (user: AuthUser | null) => void;

/**
 * Authentication port — sign-in/out, session, access tokens.
 * Implementations: Supabase Auth, Auth0, Cloudflare Access, custom JWT, etc.
 */
export interface IAuthService {
  getUser(): Promise<AuthUser | null>;
  getAccessToken(): Promise<string | null>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUpWithPassword(email: string, password: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  sendPasswordReset(email: string, redirectTo?: string): Promise<void>;
  sendEmailOtp(email: string): Promise<void>;
  verifyEmailOtp(email: string, token: string): Promise<void>;
  sendMagicLink(email: string, redirectTo?: string): Promise<void>;
  signInWithGoogle(redirectTo?: string): Promise<void>;
  /**
   * Finishes a sign-in that came back as an authorization code.
   *
   * Takes the callback's whole query string rather than the code alone: which
   * parameters matter is the provider's business, not the caller's, and the
   * desktop shell that receives this has no reason to learn them.
   */
  completeOAuth(callbackQuery: string): Promise<void>;
  signOut(): Promise<void>;
  onChange(cb: AuthChangeCallback): () => void;
}
