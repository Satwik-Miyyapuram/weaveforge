/**
 * Tokens were made in four places: Settings › Access tokens (desktop and cloud
 * SDK), the AI access dialog (MCP), and the Experiments "Python SDK token"
 * modal. Each kept its own list, so a reader looking for a token to revoke had
 * to know which screen had issued it (design D21, DA-132, D-12). Access tokens
 * is now the one page that lists every kind; the other places link to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");
const screen = read("features/settings/ui/settings-screen.tsx");
const aiAccess = read("features/settings/ui/ai-access-panel.tsx");
const localApi = read("features/settings/ui/local-api-panel.tsx");
const experiments = read("features/experiments/ui/experiments-screen.tsx");

test("the Access tokens tab lists MCP tokens beside the SDK ones", () => {
  assert.ok(existsSync(path("features/settings/ui/mcp-tokens-panel.tsx")), "MCP tokens have a panel of their own");
  const panel = read("features/settings/ui/mcp-tokens-panel.tsx");
  for (const call of ["mcpTokens.list", "mcpTokens.create", "mcpTokens.revoke"]) assert.match(panel, new RegExp(call.replace(".", "\\.")));
  assert.match(screen, /tab === "tokens"[^\n]*<McpTokensPanel/);
  assert.match(screen, /<LocalApiPanel purpose="sdk"/);
  assert.match(screen, /<ApiTokensPanel/);
});

test("the tab shows wherever any kind of token can be made", () => {
  assert.match(screen, /if \(t\.id === "tokens"\) return hasApiTokens \|\| isDesktop \|\| mcpTokensServed;/);
  // A static web build has no MCP routes, so no MCP list there.
  assert.match(screen, /const mcpTokensServed = GENERATED_MCP_ENABLED && hasServerRoutes\(\);/);
});

test("the AI access dialog sends the reader to Access tokens instead of minting its own", () => {
  assert.doesNotMatch(aiAccess, /mcpTokens\.(create|revoke|list)/);
  assert.doesNotMatch(aiAccess, /Revoke this MCP token/);
  assert.match(aiAccess, /onManageTokens/);
  // Saved first, so leaving the dialog does not drop what the reader set in it.
  assert.match(screen, /onManageTokens=\{\(\) => void openTokensFromAiAccess\(\)\}/);
  assert.match(
    screen,
    /async function openTokensFromAiAccess\(\) \{\s*if \(!\(await submit\(\)\)\) return;\s*setAiAccessOpen\(false\);\s*selectTab\("tokens"\);\s*\}/,
  );
});

test("the desktop MCP panel links to the tab rather than naming a path", () => {
  assert.doesNotMatch(localApi, /Create and revoke tokens in Settings → Access tokens\./);
  assert.match(localApi, /href="#settings-tokens"/);
});

test("Experiments sends the reader to Access tokens, whose form starts on Experiments", () => {
  assert.doesNotMatch(experiments, /<LocalApiTokenCreate|SdkTokenView/);
  assert.match(experiments, /router\.push\("\/settings#settings-tokens"\)/);
  const create = read("components/local-api-tokens.tsx");
  assert.match(create, /fixed \?\? \["experiments"\]/, "the experiments permission is ticked to begin with");
});
