import { defineConfig } from "@weaveforge/core";

/**
 * Deploy-time plugin registry for this WeaveForge instance.
 *
 * Add npm packages that export a `WeaveForgePlugin` factory:
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
  //
  // Billing is off unless "billing" is listed in builtins.features — a
  // self-hosted instance ships no Stripe code, no quotas, and no prices.
  // `pricingUi` is the separate, narrower switch: keep quota and usage
  // working, but hide every price, plan comparison, and upgrade prompt.
  // Users holding a complimentary lifetime grant never see pricing
  // regardless of this flag. See docs/internal/future-work/billing-and-quota-plan.md §9.
  // billing: { pricingUi: false },
  plugins: [],
});
