"use client";

import { useMemo } from "react";
import { buildModuleRegistry, type ModuleRegistry } from "@/registry";
import { getContainer } from "@/bootstrap";

/**
 * The module registry, built once per mount instead of once per component.
 *
 * Three shell components — the tab bar, the sub-tab strip and the swipe
 * gesture — each carried the same `useMemo(() => buildModuleRegistry(
 * getContainer().integrationConfig), [])`. The computation is pure and its
 * input cannot change without a reload, so building it three times bought
 * nothing but three copies of the wiring to keep in step; the copy is also how
 * the three would drift if the registry ever needed an argument.
 *
 * The memo has an empty dependency list on purpose, matching what it replaced:
 * `integrationConfig` is fixed at container construction, so it is a constant
 * for the life of the page and re-reading it per render would only add work.
 *
 * `getContainer()` during render is safe by contract here and the contract is
 * worth stating: these components only mount inside `AppShell`, below
 * `PrivacyDisclaimerGate`, which is what calls `ensureContainer()`. Nothing
 * that renders above that gate may call this hook.
 */
export function useModuleRegistry(): ModuleRegistry {
  return useMemo(() => buildModuleRegistry(getContainer().integrationConfig), []);
}

/** The grouped nav items alone, for the components that only read those. */
export function useNavGroups(): ModuleRegistry["navGroups"] {
  return useModuleRegistry().navGroups;
}
