/**
 * Whether sharing traffic may run for the open workspace (modes-093 section 5).
 *
 * Signing out pauses sharing; it never lowers the tier. A local tier has no
 * account to guard, so it is always allowed.
 */

export type GuardInput = {
  tier: "local" | "local-web" | "sharing";
  /** The account the workspace was upgraded or signed in with, or null. */
  account: string | null;
  /** The signed-in Supabase user id, or null when signed out. */
  sessionUserId: string | null;
};

export type GuardResult =
  | { allowed: true }
  | { allowed: false; reason: "signed-out" | "account-mismatch" };

export function accountGuard(input: GuardInput): GuardResult {
  if (input.tier !== "sharing") return { allowed: true };
  if (input.sessionUserId === null) return { allowed: false, reason: "signed-out" };
  if (input.account === null || input.account !== input.sessionUserId) {
    return { allowed: false, reason: "account-mismatch" };
  }
  return { allowed: true };
}
