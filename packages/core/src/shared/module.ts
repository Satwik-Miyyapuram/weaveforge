/**
 * Feature module descriptor.
 *
 * Each tracked concern (papers, experiments, logbook, report, meetings) exposes
 * one of these. The app shell collects descriptors from a registry and builds
 * navigation and routing dynamically, so adding a feature does NOT require
 * editing the shell (Open/Closed Principle).
 *
 * This type is intentionally UI-framework-agnostic: it references components and
 * routes by opaque handles so `packages/core` need not depend on React/Next.
 * The web app provides concrete handle types.
 */

export interface NavItem {
  /** Stable key, usually the module id. */
  readonly key: string;
  /** Human label shown in the nav/tab bar. */
  readonly label: string;
  /** Route path this nav item links to. */
  readonly path: string;
  /** Optional icon handle, resolved by the UI layer. */
  readonly icon?: string;
}

export interface RouteDef {
  readonly path: string;
  /** Opaque handle to a component, resolved by the UI layer. */
  readonly component: string;
}

export interface FeatureModule {
  /** Unique, stable id, e.g. "papers". */
  readonly id: string;
  /** Display title, e.g. "Papers". */
  readonly title: string;
  /** Sub-nav bucket key (library, plan, report, experiments, …). Omit for top-level (e.g. dashboard). */
  readonly navGroup?: string;
  /** Settings / org / shared inbox — not in primary tab groups. */
  readonly shell?: boolean;
  /** Nav/tab-bar entries this module contributes. */
  readonly navItems: readonly NavItem[];
  /** Routes this module contributes. */
  readonly routes: readonly RouteDef[];
  /**
   * The module has nothing to show without a server, so a build that has no
   * server leaves it out entirely rather than shipping a screen that explains
   * itself. Sharing, supervision and anything that reads another account's
   * data is in this category; see the offline-first plan, D3 and D10.
   */
  readonly requiresNetwork?: boolean;
  /** Migration file names this module owns (documentation/ordering aid). */
  readonly migrations?: readonly string[];
}
