/**
 * Current-user session port for persistence adapters.
 * Repositories use this instead of calling a vendor auth SDK directly.
 */
export interface ICurrentUserProvider {
  getCurrentUserId(): Promise<string | null>;
  /** Throws when no user is signed in. */
  requireUserId(): Promise<string>;
}
