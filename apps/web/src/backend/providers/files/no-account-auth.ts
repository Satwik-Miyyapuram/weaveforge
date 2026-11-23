import { LOCAL_USER_ID, type AuthChangeCallback, type AuthUser, type IAuthService } from "@weaveforge/core";
import { setLocalMode } from "@/backend/providers/files/no-account-mode";

export const NO_ACCOUNT_USER: AuthUser = {
  id: LOCAL_USER_ID,
  email: "you@this-computer",
  emailVerified: false,
  providers: ["local"],
};

const NEEDS_ACCOUNT =
  "This copy is working on your computer, with no account. Sign in to use that.";

/**
 * Auth for "work on this computer" in 0.9.8. There is no server to sign in to,
 * so every sign-in path refuses with the same message; nothing here reads or
 * writes a database.
 */
export class NoAccountAuthService implements IAuthService {
  constructor(
    private readonly leave: { forget: () => void; reload: () => void } = {
      forget: () => setLocalMode(false),
      reload: () => window.location.reload(),
    },
  ) {}

  async getUser(): Promise<AuthUser | null> {
    return NO_ACCOUNT_USER;
  }

  /** No server, so no token. Callers already treat null as "do not send one". */
  async getAccessToken(): Promise<string | null> {
    return null;
  }

  async signInWithPassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async signUpWithPassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async updatePassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendPasswordReset(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendEmailOtp(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async verifyEmailOtp(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendMagicLink(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async signInWithGoogle(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async completeOAuth(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }

  /**
   * Leaving "work on this computer" is the only sign-out there is. The files
   * stay. onChange never answers again, so the reload is what shows the sign-in
   * screen: the wiring is rebuilt without the flag.
   */
  async signOut(): Promise<void> {
    this.leave.forget();
    this.leave.reload();
  }

  /**
   * Answers once, immediately, and never again.
   *
   * The provider waits for the first callback before it stops showing a loader,
   * and nothing here can change afterwards.
   */
  onChange(cb: AuthChangeCallback): () => void {
    const timer = setTimeout(() => cb(NO_ACCOUNT_USER), 0);
    return () => clearTimeout(timer);
  }
}
