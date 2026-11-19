/**
 * The open workspace's sharing tier (modes-093 section 1), mirrored in this
 * window's storage so the wiring, which is built once at start, can read it
 * synchronously. The desktop shell's `settings.json` is the truth; this is a
 * copy the page refreshes from it.
 */
import { readStored, removeStored, writeStored } from "@/lib/safe-storage";

export type Tier = "local" | "local-web" | "sharing";

/** The storage key of the mirrored tier. */
export const OPEN_TIER_KEY = "weaveforge.open-tier";

const TIERS: readonly Tier[] = ["local", "local-web", "sharing"];

/** Whether `value` names a tier exactly as `settings.json` spells it. */
export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The mirrored tier, or null when none is stored or the stored text is not a tier. */
export function storedTier(): Tier | null {
  const raw = readStored(OPEN_TIER_KEY);
  return isTier(raw) ? raw : null;
}

/** Mirror `tier`. Reloading is the caller's job: the wiring is built once. */
export function rememberTier(tier: Tier): void {
  writeStored(OPEN_TIER_KEY, tier);
}

/** Drop the mirror (no folder open). */
export function forgetTier(): void {
  removeStored(OPEN_TIER_KEY);
}

/** Ranks tiers: local < local-web < sharing. */
export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
