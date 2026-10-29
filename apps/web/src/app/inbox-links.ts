/**
 * The sidebar's Inbox group: what the AI or other people sent you (D-04).
 *
 * These were rows of the account menu, so on their own routes no nav item was
 * active and the reader lost their place (DA-85). A plain function, like
 * `accountLinks`, so which entries show for whom is tested in one place.
 */

export interface InboxInput {
  /** Professors and PhDs get the supervisor view; Master's students do not. */
  canSupervise: boolean;
  pendingProposals: number;
  /** No account on this computer: nothing can be shared with it. */
  local: boolean;
}

export interface InboxLink {
  key: string;
  label: string;
  path: string;
  icon: string;
  badge?: number;
}

export function inboxLinks(input: InboxInput): InboxLink[] {
  const links: InboxLink[] = [
    {
      key: "ai-review",
      label: "AI suggestions",
      path: "/ai-review",
      icon: "sparkle",
      ...(input.pendingProposals > 0 ? { badge: input.pendingProposals } : {}),
    },
  ];
  if (input.local) return links;
  links.push({ key: "shared", label: "Shared with you", path: "/shared", icon: "share" });
  if (input.canSupervise) {
    links.push({ key: "supervision", label: "Supervision", path: "/supervision", icon: "people" });
  }
  return links;
}
