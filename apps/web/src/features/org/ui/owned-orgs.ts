import { logToApp } from "@/lib/error-report/app-log";

export interface OwnedOrg {
  id: string;
  name: string;
  ownerId: string;
}

/**
 * The labs a professor owns, or none with a reason. Without them the invite
 * code panels are hidden, so a failed read is said, not passed off as owning
 * nothing.
 */
export async function ownedOrgsOrError(
  fetchOwned: () => Promise<OwnedOrg[]>,
): Promise<{ orgs: OwnedOrg[]; error: string | null }> {
  try {
    return { orgs: await fetchOwned(), error: null };
  } catch (err) {
    logToApp({
      level: "warn",
      source: "org",
      message: "The labs you own could not load",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { orgs: [], error: "The labs you own could not load, so their invite codes are hidden." };
  }
}
