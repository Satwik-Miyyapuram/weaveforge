import type { Member, Role } from "../features/org/domain/member.js";

// --- admin-provisioner ---
export interface ProvisionUserInput {
  email: string;
  password: string;
  fullName?: string;
  role: Role;
  supervisorId?: string;
}

/**
 * Privileged account creation (service-role / admin API).
 * Used by POST /api/admin/create-user — never exposed to the browser SDK.
 */
export interface IAdminUserProvisioner {
  /** Resolve the caller from a bearer access token. */
  resolveCaller(accessToken: string): Promise<Member | null>;
  /** Create auth account + member profile. Rolls back on profile failure. */
  provisionUser(input: ProvisionUserInput): Promise<Member>;
  /** Delete caller's account and all app data (requires service role). */
  deleteOwnAccount(accessToken: string): Promise<void>;
}

// --- auth-ports ---
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

// --- session-ports ---
/**
 * Current-user session port for persistence adapters.
 * Repositories use this instead of calling a vendor auth SDK directly.
 */
export interface ICurrentUserProvider {
  getCurrentUserId(): Promise<string | null>;
  /** Throws when no user is signed in. */
  requireUserId(): Promise<string>;
}
