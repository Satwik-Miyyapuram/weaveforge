"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProfile } from "@/features/org/ui/profile-provider";
import { AI_PROPOSALS_CHANGED_EVENT } from "@/lib/ai-proposals-changed";
import { inboxLinks, type InboxLink } from "./inbox-links";

/**
 * The Inbox entries for whoever is signed in, kept fresh as AI suggestions
 * arrive, and whether this copy has no account (`local`).
 */
export function useInbox(): { links: InboxLink[]; local: boolean } {
  const { profile } = useProfile();
  const [pendingProposals, setPendingProposals] = useState(0);
  const [local, setLocal] = useState(false);

  useEffect(() => {
    const read = () =>
      void getContainer().aiProposals.pendingCount().then(setPendingProposals).catch(() => setPendingProposals(0));
    // On mount the memoized count is what we want — several copies of this
    // hook mount as the breakpoint settles. On an explicit change event it is
    // exactly what we do not want, so drop it first.
    const refresh = () => {
      getContainer().aiProposals.forgetPending();
      read();
    };
    read();
    // Read through the auth facade rather than the local backend provider: this
    // only needs the answer, and reaching for the provider is how a
    // presentation file ends up knowing which backend a window was built with.
    setLocal(getContainer().auth.isLocalMode());
    window.addEventListener(AI_PROPOSALS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AI_PROPOSALS_CHANGED_EVENT, refresh);
  }, []);

  const canSupervise = !!profile && profile.role !== "masters";
  return { links: inboxLinks({ canSupervise, pendingProposals, local }), local };
}
