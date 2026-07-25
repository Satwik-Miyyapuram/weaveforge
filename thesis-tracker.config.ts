import { defineConfig } from "@thesis/core";

/**
 * Deploy-time plugin registry for this Thesis Tracker instance.
 *
 * Add npm packages that export a `ThesisTrackerPlugin` factory:
 *
 *   import mendeley from "@your-lab/thesis-mendeley";
 *   export default defineConfig({ plugins: [mendeley()] });
 *
 * Set matching NEXT_PUBLIC_*_PROVIDER env vars and redeploy.
 */
export default defineConfig({
  // Omit either list to keep every built-in component. Supplying a list makes
  // this deployment expose only those built-ins; plugin packages are additive.
  // This is the first modular boundary. A later build step can use the same
  // manifest to generate a true tree-shaken registry.
  // builtins: {
  //   features: ["dashboard", "papers", "report", "settings"],
  //   integrations: ["zotero", "semantic-scholar"],
  // },
  // mcp: { enabled: false, tools: ["search_workspace", "get_source_excerpt"] },
  plugins: [],
});
