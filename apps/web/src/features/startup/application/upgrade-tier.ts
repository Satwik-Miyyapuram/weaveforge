import { rememberTier, type Tier } from "@/deployment/open-tier";
import { localFirstAccount } from "@/backend/providers/local/local-first-marker";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";
import { readStored, writeStored } from "@/lib/safe-storage";

/**
 * The first 0.9.4 start gives the open workspace a tier from the flags 0.9.2
 * kept in the page's storage (modes-093 section 12). It runs once: the done
 * key stops a second run, so a later start never moves the tier again.
 */

export const TIER_UPGRADED_KEY = "weaveforge.tier-upgraded";

/** An account this copy was signed in to before tiers, if any. */
export interface OldAccount {
  id: string | null;
}

export interface UpgradeTierDeps {
  done(): boolean;
  markDone(): void;
  /** The old `weaveforge.local-mode` flag: "1" when the person chose local. */
  localModeFlag(): string | null;
  /** A Supabase session or a local-first account marker, or null for neither. */
  oldAccount(): OldAccount | null;
  /** Writes the tier to `settings.json` and the page's mirror. */
  setTier(tier: Tier, account: string | null): Promise<void>;
  /** Moves the old session into the keychain (Lane L); absent until then. */
  moveSession?(): Promise<void>;
}

export type UpgradeTierOutcome =
  | { ran: false }
  | { ran: true; tier: Tier; freshInstall: boolean };

/** The section 12 mapping, kept pure so each case is easy to test. */
export function tierFromOldFlags(
  localModeFlag: string | null,
  account: OldAccount | null,
): { tier: Tier; freshInstall: boolean } {
  if (localModeFlag === "1") return { tier: "local", freshInstall: false };
  if (account) return { tier: "sharing", freshInstall: false };
  return { tier: "local", freshInstall: true };
}

export async function upgradeTier(deps: UpgradeTierDeps): Promise<UpgradeTierOutcome> {
  if (deps.done()) return { ran: false };
  const account = deps.oldAccount();
  const { tier, freshInstall } = tierFromOldFlags(deps.localModeFlag(), account);
  if (tier === "sharing") await deps.moveSession?.();
  // The old flag stays: a 0.9.2 build opened on this folder still finds its local mode.
  // A failed write leaves the done key alone, so the next start retries.
  await deps.setTier(tier, tier === "sharing" ? (account?.id ?? null) : null);
  deps.markDone();
  return { ran: true, tier, freshInstall };
}

/** Supabase keeps its session under `sb-<project>-auth-token`. */
function hasSupabaseSession(): boolean {
  try {
    const storage = globalThis.window?.localStorage;
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) {
      if (/^sb-.+-auth-token$/.test(storage.key(i) ?? "")) return true;
    }
  } catch {
    // Storage denied: no session to find.
  }
  return false;
}

/** The real dependencies: page storage and the desktop shell. */
export function browserUpgradeDeps(): UpgradeTierDeps {
  const localModeKey = (): string => readyCore().localModeKey();
  return {
    done: () => readStored(TIER_UPGRADED_KEY) === "1",
    markDone: () => writeStored(TIER_UPGRADED_KEY, "1"),
    localModeFlag: () => readStored(localModeKey()),
    oldAccount: () => {
      const marker = localFirstAccount();
      if (marker) return { id: marker.id };
      return hasSupabaseSession() ? { id: null } : null;
    },
    setTier: async (tier, account) => {
      await desktop()?.setWorkspaceTier?.(tier, account, null);
      rememberTier(tier);
    },
  };
}
