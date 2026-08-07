import type { FeatureModule } from "@weaveforge/core";

export const vaultModule: FeatureModule = {
  id: "vault",
  title: "Notes",
  navGroup: "library",
  navItems: [{ key: "vault", label: "Notes", path: "/notes", icon: "notes" }],
  routes: [{ path: "/notes", component: "vault/VaultPage" }],
  migrations: ["0027_vault_pages.sql"],
};
