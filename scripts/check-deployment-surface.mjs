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
import config from "../weaveforge.config.ts";

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
  // Generated route pages import their own screen directly, and that is the
  // point: the generator's comment records that routing through a shared map
  // put every screen in one chunk, so each route shipped all of them. The
  // check that used to live here forbade exactly that, so it could never pass
  // — it threw on the first generated page it walked.
  //
  // The invariant that is actually worth holding: a generated page stays
  // generated. Hand-editing one is silently undone by the next `generate:routes`.
  if (source.includes("AUTO-GENERATED") && !source.includes("GeneratedRoutePage")) {
    throw new Error(
      `Route page ${page} is marked auto-generated but no longer looks generated. ` +
        `Edit scripts/generate-deployment-registry.mjs instead; this file is overwritten.`,
    );
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

const pluginServerPath = join(root, "plugins/weaveforge-research/mcp-server/index.mjs");
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
