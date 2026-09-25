"use client";

/**
 * What this copy of the app can actually do.
 *
 * There are two ways to run WeaveForge without a server on the other end: the
 * desktop build, which is compiled without the online-only modules
 * (`isOfflineBuild`), and local mode, which any build can enter at the sign-in
 * screen and which swaps the data layer for the database on this disk
 * (`isLocalMode`). Both leave the same holes, and the holes were being patched
 * one screen at a time — a check here, a hidden button there — which is how the
 * first-run gate ended up asking a copy with no account to pick a lab, with a
 * Continue button whose only implementation is a server call.
 *
 * So the question is asked once, by name, and every screen reads the answer.
 * A new account-only feature declares which capability it needs and is absent
 * without it; nothing new has to be written here for it.
 *
 * `FeatureModule.requiresNetwork` is the same idea one level up: it removes a
 * whole module from the registry. This covers what lives *inside* the modules
 * that stay — a settings tab, a gate, a panel.
 */

import { useEffect, useState } from "react";

import { isLocalMode } from "@/backend/providers/local/local-identity";
import { isOfflineBuild } from "./build-target";

export type Capability =
  /** A sign-in identity: email, password, linked providers, account deletion. */
  | "account"
  /** Labs: creating one, joining one, members, supervision. */
  | "org"
  /** Granting another person read or comment access to an item. */
  | "sharing"
  /** Another device on the other end to reconcile with. */
  | "sync"
  /** Server-issued tokens for the HTTP API. */
  | "apiTokens"
  /**
   * Somebody other than the reader can technically read this data — the
   * premise of the entire privacy disclaimer. False when the database is a
   * file on the reader's own disk.
   */
  | "operatorDisclosure";

/**
 * Every capability above needs either an account or a server, and local mode
 * has neither, so the list is presently all-or-nothing. It is still a list
 * rather than one boolean: the next thing to lose is unlikely to lose
 * everything with it, and callers that already ask by name will not have to
 * change when that happens — `OWN_ROUTE_CAPABILITIES` below is exactly that
 * "next thing", and the callers did not have to change.
 */
const ACCOUNT_CAPABILITIES: readonly Capability[] = [
  "account",
  "org",
  "sharing",
  "sync",
  "apiTokens",
  "operatorDisclosure",
];

/**
 * Whether this copy has an account behind it.
 *
 * Only the runtime choice decides *this* question, because the desktop build can
 * sign in and doing so switches it back to the server wiring. But "has an
 * account" is not the same as "has the routes that account's features are
 * served by", and asking this one for both is what put a Tokens tab and an Org
 * tab on a build that cannot answer either. See `hasServerRoutes`.
 */
export function hasAccount(): boolean {
  return !isLocalMode();
}

/**
 * Whether this deployment can answer its own `/api/*` routes.
 *
 * The desktop app is a static export: `apps/desktop/scripts/build-web.mjs` holds
 * `src/app/api/` aside for that build, so there is no server to answer them and a
 * fetch for one reaches the `app://` file handler instead — a 404 with an empty
 * body. Signing in does not change that: the same window reads the account's
 * data over the network quite happily, and still has no route of its own.
 *
 * This is a build fact, not a session one, which is why it is `isOfflineBuild`
 * and not `isLocalMode`. `registry.ts` already uses the same flag to remove the
 * whole modules a serverless build cannot serve; this covers what lives *inside*
 * the modules that stay.
 */
export function hasServerRoutes(): boolean {
  return !isOfflineBuild();
}

/**
 * Capabilities that need more than an account: they need this deployment to
 * answer its own routes.
 *
 * Both of these issue requests a static export cannot serve — `apiTokens` mints
 * them at `/api/settings/api-tokens`, `org` does everything at `/api/org/*` —
 * so on a signed-in desktop build they answered yes and the screens behind them
 * mounted and failed. A control that can only fail is worse than an absent one,
 * which is the argument this file already makes about a section "a reader opens
 * once and learns to distrust".
 */
const OWN_ROUTE_CAPABILITIES: readonly Capability[] = ["org", "apiTokens"];

/** Whether this copy can do `capability`. Safe before mount: SSR says yes. */
export function can(capability: Capability): boolean {
  if (OWN_ROUTE_CAPABILITIES.includes(capability) && !hasServerRoutes()) return false;
  if (!ACCOUNT_CAPABILITIES.includes(capability)) return true;
  return hasAccount();
}

/**
 * The same answer, read after mount.
 *
 * `isLocalMode` reads `localStorage`, which the server render does not have, so
 * a component that branches on it during render would hydrate against markup
 * built from the other answer. Every hook here starts on the server's answer
 * and corrects itself in an effect, the way the desktop-only settings tab does.
 */
export function useCapability(capability: Capability): boolean {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => setAllowed(can(capability)), [capability]);
  return allowed;
}
