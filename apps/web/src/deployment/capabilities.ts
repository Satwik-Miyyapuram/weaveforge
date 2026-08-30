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
 * change when that happens.
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
 * The build flag is not part of this on purpose: the desktop build can sign in,
 * and doing so switches it back to the server wiring. Only the runtime choice
 * decides. `isOfflineBuild` still removes the modules that a build with no
 * server cannot serve at all, which `registry.ts` handles.
 */
export function hasAccount(): boolean {
  return !isLocalMode();
}

/** Whether this copy can do `capability`. Safe before mount: SSR says yes. */
export function can(capability: Capability): boolean {
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
