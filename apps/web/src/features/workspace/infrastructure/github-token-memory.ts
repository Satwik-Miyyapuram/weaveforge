/**
 * The web app's GitHub token (D-1a).
 *
 * The 8-hour access token lives in this closure and nowhere else: not in
 * localStorage, sessionStorage, IndexedDB or a cookie. Only the server keeps
 * the long-lived refresh token, so `refresh` is a call to the server. A token
 * with less than `earlyMs` left is refreshed before use; asks that land during
 * a refresh share it. A 401 from GitHub refreshes once and retries once.
 *
 * When the server says the user revoked the app, `onReconnect` runs once (the
 * "Reconnect GitHub" prompt) and every ask fails until a refresh succeeds.
 */

export interface GithubTokenGrant {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** The server could not refresh: the user revoked the app or the grant ran out. */
export class GithubRevokedError extends Error {
  override readonly name = "GithubRevokedError";
  constructor() {
    super("GitHub access was revoked. Reconnect GitHub to sync.");
  }
}

export interface GithubTokenOptions {
  refresh(): Promise<GithubTokenGrant>;
  now(): number;
  onReconnect(): void;
  earlyMs?: number;
}

export interface GithubToken {
  token(): Promise<string>;
  /** Run a GitHub call; on 401 refresh once and run it again. */
  withToken<R extends { status: number }>(call: (token: string) => Promise<R>): Promise<R>;
  /** Drop the token (sign-out). */
  forget(): void;
}

export function createGithubToken({ refresh, now, onReconnect, earlyMs = 5 * 60_000 }: GithubTokenOptions): GithubToken {
  let grant: GithubTokenGrant | null = null;
  let pending: Promise<string> | null = null;
  let revoked = false;

  const renew = (): Promise<string> => {
    pending ??= (async () => {
      try {
        grant = await refresh();
        revoked = false;
        return grant.token;
      } catch (error) {
        grant = null;
        if (error instanceof GithubRevokedError && !revoked) {
          revoked = true;
          onReconnect();
        }
        throw error;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const token = async (): Promise<string> => {
    if (grant && grant.expiresAt - now() > earlyMs) return grant.token;
    return renew();
  };

  return {
    token,
    async withToken(call) {
      const first = await call(await token());
      if (first.status !== 401) return first;
      grant = null;
      return call(await renew());
    },
    forget() {
      grant = null;
    },
  };
}
