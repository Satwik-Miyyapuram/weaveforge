#!/usr/bin/env node
/**
 * Generate the static built-in registry used by the web bundle.
 * Run through `npm run generate:deployment` before build/dev.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import userConfig from "../thesis-tracker.config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "apps/web/src/deployment/generated-registry.ts");

const features = [
  ["dashboard", "@/features/dashboard/module", "dashboardModule", false],
  ["papers", "@/features/papers/module", "papersModule", false],
  ["vault", "@/features/vault/module", "vaultModule", false],
  ["graph", "@/features/relations/module", "graphModule", false],
  ["reading-lists", "@/features/reading-lists/module", "readingListsModule", false],
  ["experiments", "@/features/experiments/module", "experimentsModule", false],
  ["git", "@/features/sync/module", "gitModule", false],
  ["plan", "@/features/plan/module", "planModule", false],
  ["logbook", "@/features/logbook/module", "logbookModule", false],
  ["report", "@/features/report/module", "reportModule", false],
  ["settings", "@/features/settings/module", "settingsModule", true],
  ["sharing", "@/features/sharing/module", "sharingModule", true],
  ["org", "@/features/org/module", "orgModule", true],
];

const integrations = [
  ["zotero", "@/integrations/manifests/zotero", "zoteroBibliographyManifest"],
  ["semantic-scholar", "@/integrations/manifests/semantic-scholar", "semanticScholarCitationManifest"],
  ["mattermost", "@/integrations/manifests/mattermost", "mattermostNotificationManifest"],
  ["gitlab-log-sync", "@/integrations/manifests/gitlab-log", "gitlabLogSyncManifest"],
  ["github", "@/integrations/manifests/git-read", "githubGitReadManifest"],
  ["gitlab", "@/integrations/manifests/git-read", "gitlabGitReadManifest"],
];

const mcpTools = [
  "search_workspace",
  "get_source_excerpt",
  "get_workspace_outline",
  "propose_append_paper_note",
  "propose_create_vault_note",
  "propose_create_log_entry",
  "propose_paper_update",
  "propose_paper_field_value",
  "propose_reading_list_change",
  "propose_relation",
  "propose_zotero_import",
  "propose_milestone_follow_up",
  "propose_experiment_follow_up",
];

const routeComponents = {
  dashboard: ["/dashboard", "@/features/dashboard", "DashboardScreen", "DashboardScreen"],
  papers: ["/papers", "@/features/papers", "PapersScreen", "PapersScreen"],
  vault: ["/notes", "@/features/vault", "VaultScreen", "VaultScreen"],
  graph: ["/graph", "@/features/relations", "GraphScreen", "GraphScreen"],
  "reading-lists": ["/lists", "@/features/reading-lists", "ListsScreen", "ListsScreen"],
  experiments: ["/experiments", "@/features/experiments", "ExperimentsScreen", "ExperimentsScreen"],
  git: ["/git", "@/features/sync", "GitScreen", "GitScreen"],
  plan: ["/plan", "@/features/plan", "PlanScreen", "PlanScreen"],
  logbook: ["/log", "@/features/logbook", "LogbookScreen", "LogbookScreen"],
  report: [
    ["/report", "@/features/report", "ReportScreen", "ReportScreen"],
    ["/report/overleaf", "@/features/report", "ReportOverleafScreen", "ReportOverleafScreen"],
  ],
  settings: ["/settings", "@/features/settings", "SettingsScreen", "SettingsScreen"],
  sharing: ["/shared", "@/features/sharing/ui/shared-with-me-screen", "SharedWithMeScreen", "SharedWithMeScreen"],
  org: ["/supervision", "@/features/org", "SupervisionScreen", "SupervisionScreen"],
};

const generatedRoutePages = {
  "/dashboard": "apps/web/src/app/dashboard/page.tsx",
  "/papers": "apps/web/src/app/papers/page.tsx",
  "/notes": "apps/web/src/app/notes/page.tsx",
  "/graph": "apps/web/src/app/graph/page.tsx",
  "/lists": "apps/web/src/app/lists/page.tsx",
  "/experiments": "apps/web/src/app/experiments/page.tsx",
  "/git": "apps/web/src/app/git/page.tsx",
  "/plan": "apps/web/src/app/plan/page.tsx",
  "/log": "apps/web/src/app/log/page.tsx",
  "/report": "apps/web/src/app/report/page.tsx",
  "/report/overleaf": "apps/web/src/app/report/overleaf/page.tsx",
  "/settings": "apps/web/src/app/settings/page.tsx",
  "/shared": "apps/web/src/app/shared/page.tsx",
  "/supervision": "apps/web/src/app/supervision/page.tsx",
  "/ai-review": "apps/web/src/app/ai-review/page.tsx",
};

function select(entries, allowlist, label) {
  if (allowlist === undefined) return entries;
  const known = new Set(entries.map(([id]) => id));
  const unknown = allowlist.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown ${label} id(s): ${unknown.join(", ")}`);
  return entries.filter(([id]) => allowlist.includes(id));
}

const selectedFeatures = select(features, userConfig.builtins?.features, "feature");
const selectedIntegrations = select(integrations, userConfig.builtins?.integrations, "integration");
const mcpEnabled = userConfig.mcp?.enabled !== false;
const selectedMcpTools = select(mcpTools.map((id) => [id]), userConfig.mcp?.tools, "MCP tool").map(([id]) => id);

const imports = [];
for (const [, source, name] of [...selectedFeatures, ...selectedIntegrations]) {
  if (!imports.some((entry) => entry.source === source && entry.name === name)) imports.push({ source, name });
}

const importLines = imports.map(({ source, name }) => `import { ${name} } from "${source}";`).join("\n");
const mcpImport = mcpEnabled
  ? `import { createAiProposalExecutors } from "@/features/ai-assistant/application/proposal-executors";`
  : "";
const mainNames = selectedFeatures.filter((entry) => !entry[3]).map((entry) => entry[2]);
const shellNames = selectedFeatures.filter((entry) => entry[3]).map((entry) => entry[2]);
const manifestNames = selectedIntegrations.map((entry) => entry[2]);
const selectedRoutes = selectedFeatures.flatMap(([id]) => {
  const entry = routeComponents[id];
  if (!entry) return [];
  return Array.isArray(entry[0]) ? entry : [entry];
});
if (mcpEnabled) selectedRoutes.push(["/ai-review", "@/features/ai-assistant/ui/ai-proposal-review-screen", "AiProposalReviewScreen", "AiProposalReviewScreen"]);
const featureIds = selectedFeatures.map(([id]) => JSON.stringify(id));
const integrationIds = selectedIntegrations.map(([id]) => JSON.stringify(id));

const output = `// AUTO-GENERATED by scripts/generate-deployment-registry.mjs — do not edit.\n${importLines}${mcpImport ? `\n${mcpImport}` : ""}\n\nexport const GENERATED_BUILTIN_FEATURE_IDS = [${featureIds.join(", ")}] as const;\nexport const GENERATED_BUILTIN_INTEGRATION_IDS = [${integrationIds.join(", ")}] as const;\nexport const GENERATED_BUILTIN_MODULES = [${mainNames.join(", ")}] as const;\nexport const GENERATED_BUILTIN_SHELL_MODULES = [${shellNames.join(", ")}] as const;\nexport const GENERATED_BUILTIN_INTEGRATION_MANIFESTS = [${manifestNames.join(", ")}] as const;\nexport const GENERATED_MCP_ENABLED = ${mcpEnabled} as const;\nexport const GENERATED_MCP_TOOL_NAMES = [${selectedMcpTools.map((name) => JSON.stringify(name)).join(", ")}] as const;\nexport const GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY = ${mcpEnabled ? "createAiProposalExecutors" : "null"};\n`;

const selectedRoutePaths = new Set(selectedRoutes.map(([path]) => path));
for (const [routePath, relativeTarget] of Object.entries(generatedRoutePages)) {
  const target = join(ROOT, relativeTarget);
  if (selectedRoutePaths.has(routePath)) {
    mkdirSync(dirname(target), { recursive: true });
    // Each page imports only its own screen. Routing through a shared map put
    // every screen in one chunk, so each route shipped all of them.
    const route = selectedRoutes.find(([path]) => path === routePath);
    const [, source, exportName] = route;
    // Static, not next/dynamic. The page is already its own entry point, so
    // importing one screen here splits the bundle just as well — while a
    // dynamic import cannot be requested until the screen renders, which the
    // shell's gates block. That produced a third JS wave starting 2.2s into
    // the load, after every gate had already resolved.
    writeFileSync(
      target,
      `// AUTO-GENERATED by scripts/generate-deployment-registry.mjs — do not edit.\n` +
        `"use client";\n\n` +
        `import { ${exportName} } from ${JSON.stringify(source)};\n\n` +
        `export default function GeneratedRoutePage() {\n  return <${exportName} />;\n}\n`,
      "utf8",
    );
  } else if (existsSync(target) && readFileForRouteMarker(target)) {
    unlinkSync(target);
  }
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, output, "utf8");
console.log(`Generated ${OUTPUT}`);

function readFileForRouteMarker(path) {
  try { return readFileSync(path, "utf8").includes("AUTO-GENERATED by scripts/generate-deployment-registry.mjs"); }
  catch { return false; }
}
