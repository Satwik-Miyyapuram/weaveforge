#!/usr/bin/env node
/**
 * Fail the build when the generated deployment registry contains a component
 * that the deploy configuration did not select. This is intentionally a
 * source/bundle-surface check: the generated registry is the only composition
 * root allowed to import built-in features, integrations, or MCP executors.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../thesis-tracker.config.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const generatedPath = join(root, "apps/web/src/deployment/generated-registry.ts");
const generated = readFileSync(generatedPath, "utf8");

const expectedMcp = config.mcp?.enabled !== false;
const generatedMcp = /GENERATED_MCP_ENABLED = true/.test(generated);
if (expectedMcp !== generatedMcp) {
  throw new Error("Deployment registry is stale. Run npm run generate:deployment.");
}

if (!expectedMcp && /features\/ai-assistant\/application\/proposal-executors/.test(generated)) {
  throw new Error("MCP proposal executors leaked into a deployment with MCP disabled.");
}

const featureIds = generated.match(/GENERATED_BUILTIN_FEATURE_IDS = \[([^\]]*)\]/s)?.[1] ?? "";
for (const id of config.builtins?.features ?? []) if (!featureIds.includes(JSON.stringify(id))) throw new Error(`No generated feature registry entry found for ${id}.`);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (name === "page.tsx") files.push(path);
  }
  return files;
}

const appRoot = join(root, "apps/web/src/app");
for (const page of walk(appRoot)) {
  const source = readFileSync(page, "utf8");
  const relativePage = page.slice(appRoot.length + 1).replaceAll("\\", "/");
  const registryBackedPages = new Set(["dashboard/page.tsx", "papers/page.tsx", "notes/page.tsx", "graph/page.tsx", "lists/page.tsx", "experiments/page.tsx", "git/page.tsx", "plan/page.tsx", "log/page.tsx", "report/page.tsx", "settings/page.tsx", "supervision/page.tsx", "shared/page.tsx", "ai-review/page.tsx"]);
  if (registryBackedPages.has(relativePage) && source.includes("@/features/")) {
    throw new Error(`Route page ${page} imports a feature directly; use the generated route registry so disabled features stay out of the route bundle.`);
  }
}

// The stdio MCP server the external client talks to declares its own tool
// array by hand. Nothing else cross-validates it, so a tool added to
// AI_TOOL_NAMES without updating that file leaves the client unable to call it
// — with no build or test failure to say so.
const toolNamesSource = readFileSync(
  join(root, "packages/core/src/features/ai-assistant/domain/ai-types.ts"),
  "utf8",
);
const declaredTools = [
  ...(/export const AI_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(toolNamesSource)?.[1] ?? "")
    .matchAll(/"([a-z_]+)"/g),
].map((match) => match[1]);

const pluginServerPath = join(root, "plugins/thesis-tracker-research/mcp-server/index.mjs");
let pluginSource = "";
try {
  pluginSource = readFileSync(pluginServerPath, "utf8");
} catch {
  pluginSource = "";
}

if (pluginSource && declaredTools.length > 0) {
  const missing = declaredTools.filter((tool) => !pluginSource.includes(`"${tool}"`));
  if (missing.length > 0) {
    throw new Error(
      `MCP plugin server is missing tool declarations: ${missing.join(", ")}.\n` +
        `Add them to ${pluginServerPath} — nothing else validates that file against AI_TOOL_NAMES.`,
    );
  }
}

console.log(
  `Deployment surface OK (MCP ${expectedMcp ? "enabled" : "disabled"}, ${declaredTools.length} tools).`,
);
