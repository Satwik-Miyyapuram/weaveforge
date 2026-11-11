import type { AiToolName } from "../features/ai-assistant/domain/ai-types.js";
import type { FeatureModule } from "../shared/parts.js";

// --- plugin ---
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

// --- define-config ---
/**
 * Optional deploy-time allowlists. Omit a list to keep the default built-ins;
 * provide one to expose only the named components in that category.
 */
export interface BuiltinSelection {
  readonly features?: readonly string[];
  readonly integrations?: readonly string[];
}

export interface McpSelection {
  /** Set false to omit the MCP routes, tools, and browser proposal executors. */
  readonly enabled?: boolean;
  /** Optional compile-time allowlist for the generated MCP manifest. */
  readonly tools?: readonly AiToolName[];
}

export interface WeaveForgeConfig {
  readonly plugins?: readonly WeaveForgePlugin[];
  readonly builtins?: BuiltinSelection;
  readonly mcp?: McpSelection;
}

/** Root config helper for `weaveforge.config.ts`. */
export function defineConfig(config: WeaveForgeConfig): WeaveForgeConfig {
  return config;
}
