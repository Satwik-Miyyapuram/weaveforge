import type { Member, OrgMembershipView } from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { shouldSyncStandalone } from "./org-profile-state";

/** Where a profile refresh reads from. */
export interface ProfileSources {
  org: {
    loadProfile(): Promise<Member | null>;
    loadTeam(): Promise<Member[]>;
    loadLab(): Promise<Member[]>;
  };
  fetchMemberships(): Promise<OrgMembershipView[]>;
  continueStandalone(): Promise<unknown>;
  invalidateCaches(): void;
}

/** What a profile refresh shows. `memberships` is null when they did not load. */
export interface ProfileBundle {
  profile: Member | null;
  team: Member[];
  labMembers: Member[];
  memberships: OrgMembershipView[] | null;
}

function warn(message: string, error: unknown): void {
  logToApp({ level: "warn", source: "profile", message, detail: formatError(error) });
}

/**
 * Read the signed-in user's profile, team, lab and memberships, syncing a
 * standalone user's role when it is out of step. A failed profile read
 * rejects; a failed memberships read or sync is logged and the rest shown.
 */
export async function loadProfileBundle(src: ProfileSources): Promise<ProfileBundle> {
  const [mine, members, lab, labs] = await Promise.all([
    src.org.loadProfile(),
    src.org.loadTeam(),
    src.org.loadLab(),
    // null, not []: a failed read is not "no labs" (see shouldSyncStandalone).
    src.fetchMemberships().catch((err: unknown) => {
      warn("Memberships did not load.", err);
      return null;
    }),
  ]);

  if (!shouldSyncStandalone(mine, labs)) {
    return { profile: mine, team: members, labMembers: lab, memberships: labs };
  }
  try {
    await src.continueStandalone();
    src.invalidateCaches();
    const profile = await src.org.loadProfile();
    const team = await src.org.loadTeam();
    const labMembers = await src.org.loadLab();
    return { profile, team, labMembers, memberships: labs };
  } catch (err) {
    // The display layer still resolves the standalone role.
    warn("Standalone sync failed.", err);
    return { profile: mine, team: members, labMembers: lab, memberships: labs };
  }
}

/**
 * Lets only the latest of overlapping requests apply its answer. `begin` is
 * called when a request starts; the check it returns is true until a later
 * request begins.
 */
export function latestGate(): { begin(): () => boolean } {
  let seq = 0;
  return {
    begin() {
      const mine = (seq += 1);
      return () => mine === seq;
    },
  };
}
