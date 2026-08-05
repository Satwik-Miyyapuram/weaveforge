import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AiAccessPolicy,
  SUGGESTED_AI_PROVIDER_IDS,
  normalizeAiAccessSettings,
  type AiAccessSettings,
  type AiSessionGrant,
} from "../src/index.js";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-14T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"],
  proposalKinds: ["append_paper_note"],
};
const grant: AiSessionGrant = {
  id: "grant-1",
  workspaceId: "workspace-1",
  expiresAt: "2026-07-15T00:00:00.000Z",
  readable: [{ sourceId: "source-1", resourceType: "paper", resourceId: "paper-1" }],
  allowedTools: ["get_source_excerpt", "propose_append_paper_note"],
  proposalCapabilities: ["append_paper_note"],
  requiresConfirmationForWrites: true,
};

const base = {
  settings,
  grant,
  tool: "get_source_excerpt" as const,
  resourceType: "paper" as const,
  resourceId: "paper-1",
  now: "2026-07-14T12:00:00.000Z",
  encryptionUnlocked: true,
};

test("Codex is the priority provider without coupling contracts to a model SDK", () => {
  // No provider is ranked: which model runs is an explicit user choice, and a
  // default ordering is how a supposedly neutral system acquires a favourite.
  assert.ok(SUGGESTED_AI_PROVIDER_IDS.includes("openai"));
  assert.ok(SUGGESTED_AI_PROVIDER_IDS.includes("ollama"));
});

test("AI settings normalize to an explicit opt-in and known capabilities", () => {
  assert.deepEqual(normalizeAiAccessSettings({}), {
    enabled: false,
    readCategories: [],
    proposalKinds: [],
    autoIncludeNewSourceCategories: [],
  });
  assert.deepEqual(
    normalizeAiAccessSettings({
      enabled: true,
      disclosureAcceptedAt: "  2026-07-14T00:00:00.000Z  ",
      readCategories: ["paper_notes", "paper_notes", "unknown" as never],
      proposalKinds: ["append_paper_note", "unknown" as never],
    }),
    {
      enabled: true,
      disclosureAcceptedAt: "2026-07-14T00:00:00.000Z",
      readCategories: ["paper_notes"],
      proposalKinds: ["append_paper_note"],
      autoIncludeNewSourceCategories: [],
    },
  );
});

test("policy allows a selected source when every gate is satisfied", () => {
  assert.deepEqual(new AiAccessPolicy().evaluate(base), { allowed: true });
});

for (const [name, change, reason] of [
  ["disabled master switch", { settings: { ...settings, enabled: false } }, "ai_disabled"],
  ["missing disclosure", { settings: { ...settings, disclosureAcceptedAt: undefined } }, "disclosure_missing"],
  ["locked encryption", { encryptionUnlocked: false }, "encryption_locked"],
  ["expired grant", { now: "2026-07-16T00:00:00.000Z" }, "grant_expired"],
  ["unselected source", { resourceId: "paper-2" }, "source_not_granted"],
  ["disabled category", { settings: { ...settings, readCategories: [] } }, "category_disabled"],
  ["unlisted tool", { tool: "search_workspace" as const }, "tool_not_allowed"],
] as const) {
  test(`policy denies ${name}`, () => {
    assert.deepEqual(new AiAccessPolicy().evaluate({ ...base, ...change }), { allowed: false, reason });
  });
}

test("proposal permissions require both settings and the short-lived grant", () => {
  const policy = new AiAccessPolicy();
  assert.deepEqual(
    policy.evaluate({ ...base, tool: "propose_append_paper_note", proposalKind: "append_paper_note" }),
    { allowed: true },
  );
  assert.deepEqual(
    policy.evaluate({
      ...base,
      tool: "propose_append_paper_note",
      proposalKind: "create_log_entry",
    }),
    { allowed: false, reason: "proposal_not_allowed" },
  );
});

test("policy permits review-only Zotero import proposals without exposing credentials", () => {
  const zoteroSettings: AiAccessSettings = { ...settings, proposalKinds: ["zotero_import"] };
  const zoteroGrant: AiSessionGrant = {
    ...grant,
    allowedTools: ["propose_zotero_import"],
    proposalCapabilities: ["zotero_import"],
  };
  assert.deepEqual(
    new AiAccessPolicy().evaluate({
      ...base,
      settings: zoteroSettings,
      grant: zoteroGrant,
      tool: "propose_zotero_import",
      proposalKind: "zotero_import",
    }),
    { allowed: true },
  );
});

test("a resource type without an id fails closed", () => {
  assert.deepEqual(
    new AiAccessPolicy().evaluate({ ...base, resourceType: "paper", resourceId: undefined }),
    { allowed: false, reason: "source_not_granted" },
  );
});

test("tools that name no resource still evaluate on tool and proposal rules alone", () => {
  assert.deepEqual(
    new AiAccessPolicy().evaluate({
      ...base,
      tool: "propose_append_paper_note",
      resourceType: undefined,
      resourceId: undefined,
      proposalKind: "append_paper_note",
    }),
    { allowed: true },
  );
});
