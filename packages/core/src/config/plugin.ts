import type { FeatureModule } from "../shared/module.js";

/**
 * Integration plugin metadata — wire factories live in the web app
 * (`apps/web/src/integrations/manifests/`) because they need composition-root deps.
 */
export interface IntegrationPluginRegistration {
  readonly id: string;
  readonly kind: "bibliography" | "citation" | "notification" | "logSync" | "gitRead";
}

/**
 * A deploy-time plugin package exports a factory returning this shape.
 * Register via `weaveforge.config.ts` → `plugins: [myPlugin()]`.
 */
export interface WeaveForgePlugin {
  readonly id: string;
  readonly integrations?: readonly IntegrationPluginRegistration[];
  readonly modules?: readonly FeatureModule[];
}
