/**
 * Which account entries the sidebar and the overflow menu show.
 *
 * A plain function rather than JSX so the rules are testable: the sidebar is
 * the app's most permanently visible chrome, and what it does *not* contain is
 * as deliberate as what it does. Two of these rules were bugs.
 */

export const DOCS_URL = "https://www.weaveforge.org/docs/";

export type AccountLinkId =
  | "projects"
  | "supervise"
  | "shared"
  | "ai-review"
  | "settings"
  | "docs"
  | "signout"
  | "signin";

export interface AccountLink {
  id: AccountLinkId;
  label: string;
  /** Absent for entries that run an action rather than navigate. */
  href?: string;
  /** External links open in a new tab. */
  external?: boolean;
  badge?: number;
}

export interface AccountLinksInput {
  /** Professors and PhDs get the supervisor view; Master's students do not. */
  canSupervise: boolean;
  /**
   * Whether a project is currently selected — i.e. whether `ProjectSwitcher` is
   * on screen. It hides itself when nothing is selected.
   */
  hasProject: boolean;
  pendingProposals: number;
  /**
   * Whether this copy is working on this computer with no account. There is no
   * session to end, so "Sign out" would be a lie: the offer is the opposite one.
   */
  local?: boolean;
}

/**
 * There is deliberately no GitHub entry. A link to the source repository is not
 * something anyone needs from inside the app, and it cost a permanent row in
 * the most valuable chrome there is. It stays on the public pitch page, which
 * is where someone looking for the source actually is.
 *
 * Documentation *is* here, and not tucked inside Settings: someone looking for
 * the docs is usually already stuck, and asking them to go hunting is asking
 * them to hunt while stuck.
 */
export function accountLinks(input: AccountLinksInput): AccountLink[] {
  const links: AccountLink[] = [];

  // Only when the project switcher is not showing. With a project selected the
  // switcher sits directly above this and its menu already offers "New / all
  // projects" — two controls, two shapes, one action. This one exists purely as
  // the escape hatch for the case the switcher hides itself: an account route
  // with no project selected, where it is the only way back to the picker.
  if (!input.hasProject) {
    links.push({ id: "projects", label: "Projects" });
  }

  if (input.canSupervise) {
    links.push({ id: "supervise", label: "Supervise", href: "/supervision" });
  }

  links.push({ id: "shared", label: "Shared", href: "/shared" });

  if (input.pendingProposals > 0) {
    links.push({
      id: "ai-review",
      label: "Review AI",
      href: "/ai-review",
      badge: input.pendingProposals,
    });
  }

  links.push({ id: "settings", label: "Settings", href: "/settings" });
  links.push({ id: "docs", label: "Help & docs", href: DOCS_URL, external: true });
  // Always last, and always present: it is the one control a signed-in user
  // must be able to find. Without an account there is nothing to sign out of,
  // so the same slot offers the way in rather than a way out.
  links.push(input.local ? { id: "signin", label: "Sign in" } : { id: "signout", label: "Sign out" });

  return links;
}
