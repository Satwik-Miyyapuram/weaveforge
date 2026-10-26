import type { FeatureModule, NavItem } from "@weaveforge/core";
import {
  GENERATED_BUILTIN_MODULES,
  GENERATED_BUILTIN_SHELL_MODULES,
} from "@/deployment/generated-registry";
import { getAppConfig } from "@/deployment/app-config";
import { isOfflineBuild } from "@/deployment/build-target";
import { readIntegrationConfig, type IntegrationConfig } from "@/integrations/config";
import type { WebFeatureModule } from "@/plugins/web-feature-module";

const BUILTIN_MODULES = GENERATED_BUILTIN_MODULES as readonly FeatureModule[];
const BUILTIN_SHELL_MODULES = GENERATED_BUILTIN_SHELL_MODULES as readonly FeatureModule[];

/** Nav group display metadata — extend when plugins add new groups. */
const NAV_GROUP_META: Record<string, { label: string; icon: string }> = {
  library: { label: "Library", icon: "book" },
  work: { label: "Work", icon: "flask" },
  write: { label: "Write", icon: "doc" },
};

/** Library is what you have, Work is what you do, Write is what you hand in (DA-92). */
const NAV_GROUP_ORDER = ["library", "work", "write"] as const;

function moduleEnabled(mod: FeatureModule, config: IntegrationConfig): boolean {
  const featureAllowlist = getAppConfig().enabledBuiltinFeatureIds;
  if (featureAllowlist && !featureAllowlist.includes(mod.id)) return false;
  if (mod.requiresNetwork && isOfflineBuild()) return false;
  if (mod.desktopOnly && !isOfflineBuild()) return false;
  if (mod.id === "git") {
    return config.gitRead.length > 0;
  }
  return true;
}

export interface ModuleRegistry {
  modules: readonly FeatureModule[];
  shellModules: readonly FeatureModule[];
  allModules: readonly FeatureModule[];
  navItems: NavItem[];
  homeNavItem: NavItem;
  /** Ungrouped destinations, listed under Home and Search. */
  topNavItems: NavItem[];
  navGroups: NavGroup[];
  webModules: readonly WebFeatureModule[];
}

/**
 * Build the feature module registry from deployment config (env + weaveforge.config.ts).
 */
export function buildModuleRegistry(config: IntegrationConfig = readIntegrationConfig()): ModuleRegistry {
  const pluginModules = getAppConfig().pluginModules;
  const pluginMain = pluginModules.filter((m) => !m.shell);
  const pluginShell = pluginModules.filter((m) => m.shell);
  const modules = [...BUILTIN_MODULES, ...pluginMain].filter((m) => moduleEnabled(m, config));
  const shellModules = [...BUILTIN_SHELL_MODULES, ...pluginShell].filter((m) => {
    if (m.requiresNetwork && isOfflineBuild()) return false;
    const allowlist = getAppConfig().enabledBuiltinFeatureIds;
    return !allowlist || pluginShell.includes(m) || allowlist.includes(m.id);
  });
  const allModules = [...modules, ...shellModules];
  const navItems = modules.flatMap((m) => m.navItems);
  const homeNavItem = modules.find((module) => module.id === "dashboard")?.navItems[0] ?? {
    key: "dashboard",
    label: "Home",
    path: "/dashboard",
    icon: "home",
  };
  const topNavItems = modules
    .filter((m) => !m.navGroup)
    .flatMap((m) => m.navItems)
    .filter((item) => item.key !== homeNavItem.key);
  const navGroups = buildNavGroupsFromModules(modules);
  const webModules = [...modules, ...shellModules] as WebFeatureModule[];
  return { modules, shellModules, allModules, navItems, homeNavItem, topNavItems, navGroups, webModules };
}

export interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

function buildNavGroupsFromModules(modules: readonly FeatureModule[]): NavGroup[] {
  const groupKeys = [
    ...NAV_GROUP_ORDER.filter((key) => modules.some((m) => m.navGroup === key)),
    ...[...new Set(modules.map((m) => m.navGroup).filter(Boolean))].filter(
      (k): k is string => !!k && !NAV_GROUP_ORDER.includes(k as (typeof NAV_GROUP_ORDER)[number]),
    ),
  ];

  return groupKeys
    .map((key) => {
      const meta = NAV_GROUP_META[key] ?? { label: key, icon: "box" };
      const items = modules.filter((m) => m.navGroup === key).flatMap((m) => m.navItems);
      return { key, label: meta.label, icon: meta.icon, items };
    })
    // A group with no nav items is not a section, it is a heading over nothing:
    // a build that disables every member of a group must not draw an empty fold.
    .filter((g) => g.items.length > 0);
}

/** The group whose members include the given path (longest-prefix match). */
export function groupForPath(
  pathname: string | null | undefined,
  groups: NavGroup[] = buildModuleRegistry().navGroups,
): NavGroup | undefined {
  if (!pathname) return undefined;
  return groups.find((g) => g.items.some((it) => pathname.startsWith(it.path)));
}

/** The views a phone shows of a group: the strip's tabs and the swipe's stops. */
export function phoneItems<T extends { mobile?: boolean }>(items: readonly T[]): T[] {
  return items.filter((it) => it.mobile !== false);
}

/** The item a path belongs to: exact or deepest `path/` prefix, so /report/overleaf is not also /report. */
export function activeNavItem<T extends { path: string }>(
  items: readonly T[],
  pathname: string | null | undefined,
): T | undefined {
  if (!pathname) return undefined;
  return items
    .filter((it) => pathname === it.path || pathname.startsWith(`${it.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
