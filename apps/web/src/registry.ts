import type { FeatureModule, NavItem } from "@thesis/core";
import {
  GENERATED_BUILTIN_MODULES,
  GENERATED_BUILTIN_SHELL_MODULES,
} from "@/deployment/generated-registry";
import { getAppConfig } from "@/deployment/app-config";
import { readIntegrationConfig, type IntegrationConfig } from "@/integrations/config";
import type { WebFeatureModule } from "@/plugins/web-feature-module";

const BUILTIN_MODULES = GENERATED_BUILTIN_MODULES as readonly FeatureModule[];
const BUILTIN_SHELL_MODULES = GENERATED_BUILTIN_SHELL_MODULES as readonly FeatureModule[];

/** Nav group display metadata — extend when plugins add new groups. */
const NAV_GROUP_META: Record<string, { label: string; icon: string }> = {
  library: { label: "Library", icon: "book" },
  experiments: { label: "Experiments", icon: "flask" },
  plan: { label: "Plan", icon: "flag" },
  report: { label: "Report", icon: "doc" },
};

const NAV_GROUP_ORDER = ["library", "experiments", "plan", "report"] as const;

function moduleEnabled(mod: FeatureModule, config: IntegrationConfig): boolean {
  const featureAllowlist = getAppConfig().enabledBuiltinFeatureIds;
  if (featureAllowlist && !featureAllowlist.includes(mod.id)) return false;
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
  navGroups: NavGroup[];
  webModules: readonly WebFeatureModule[];
}

export function allBuiltinModules(): readonly FeatureModule[] {
  const allowlist = getAppConfig().enabledBuiltinFeatureIds;
  if (!allowlist) return [...BUILTIN_MODULES, ...BUILTIN_SHELL_MODULES];
  return [...BUILTIN_MODULES, ...BUILTIN_SHELL_MODULES].filter((m) => allowlist.includes(m.id));
}

/**
 * Build the feature module registry from deployment config (env + thesis-tracker.config.ts).
 */
export function buildModuleRegistry(config: IntegrationConfig = readIntegrationConfig()): ModuleRegistry {
  const pluginModules = getAppConfig().pluginModules;
  const pluginMain = pluginModules.filter((m) => !m.shell);
  const pluginShell = pluginModules.filter((m) => m.shell);
  const modules = [...BUILTIN_MODULES, ...pluginMain].filter((m) => moduleEnabled(m, config));
  const shellModules = [...BUILTIN_SHELL_MODULES, ...pluginShell].filter((m) => {
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
  const navGroups = buildNavGroupsFromModules(modules);
  const webModules = [...modules, ...shellModules] as WebFeatureModule[];
  return { modules, shellModules, allModules, navItems, homeNavItem, navGroups, webModules };
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
    .filter((g) => g.items.length > 0);
}

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const modules: readonly FeatureModule[] = BUILTIN_MODULES;

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const shellModules: readonly FeatureModule[] = BUILTIN_SHELL_MODULES;

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const allModules: readonly FeatureModule[] = [...BUILTIN_MODULES, ...BUILTIN_SHELL_MODULES];

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const navItems = BUILTIN_MODULES.flatMap((m) => m.navItems);

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const homeNavItem: NavItem =
  BUILTIN_MODULES.find((module) => module.id === "dashboard")?.navItems[0] ?? {
    key: "dashboard",
    label: "Home",
    path: "/dashboard",
    icon: "home",
  };

/** @deprecated Use {@link buildModuleRegistry} for env-aware nav. */
export const navGroups: NavGroup[] = buildNavGroupsFromModules(BUILTIN_MODULES);

/** The group whose members include the given path (longest-prefix match). */
export function groupForPath(
  pathname: string | null | undefined,
  groups: NavGroup[] = buildModuleRegistry().navGroups,
): NavGroup | undefined {
  if (!pathname) return undefined;
  return groups.find((g) => g.items.some((it) => pathname.startsWith(it.path)));
}
