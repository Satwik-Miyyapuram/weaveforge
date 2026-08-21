import assert from "node:assert/strict";
import test from "node:test";
import { AiAssistantFacade } from "@/container/facades";
import type { AiAccessSettings, AiToolName } from "@weaveforge/core";

const PAPER = {
  id: "paper-1", title: "Attention", authors: ["A"], year: 2017, venue: "NeurIPS",
  abstract: "An abstract about attention.", status: "reading", tags: [], summary: "note body",
} as unknown as import("@weaveforge/core").Paper;

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"],
  proposalKinds: [],
};

const empty = { async list() { return []; } };

function facade(allowedTools: readonly AiToolName[]) {
  return new AiAssistantFacade({
    papers: { async list() { return [PAPER]; } } as never,
    vaultPages: empty as never, readingLists: empty as never, logEntries: empty as never,
    experiments: empty as never, milestones: empty as never,
    proposals: { async save() {}, async getById() { return null; }, async listPending() { return []; } } as never,
    isEncryptionUnlocked: () => true,
    newId: () => "session-1",
    now: () => "2026-01-02T00:00:00.000Z",
    allowedTools,
  });
}

async function session(allowedTools: readonly AiToolName[]) {
  const ai = facade(allowedTools);
  const options = await ai.listSourceOptions();
  const source = options.find((option) => option.resourceType === "paper");
  assert.ok(source, "the stub paper should be offerable as a source");
  const active = await ai.startSession({
    workspaceName: "w", sourceIds: [source.sourceId], settings, proposalCapabilities: [],
  });
  return { ai, sessionId: active.grant.id, sourceId: source.sourceId };
}

// The policy has always had a tool gate; every read asked it the same question.
// A grant that allowed one read tool therefore allowed the others too.
test("a read tool left out of the grant is refused, and the granted one still works", async () => {
  const search = await session(["search_workspace"]);
  assert.ok((await search.ai.searchWorkspace({ sessionId: search.sessionId, settings, query: "attention" })).length > 0);
  await assert.rejects(
    () => search.ai.getSourceExcerpt({ sessionId: search.sessionId, settings, sourceId: search.sourceId }),
    /tool_not_allowed/,
  );

  const excerpt = await session(["get_source_excerpt"]);
  assert.ok(await excerpt.ai.getSourceExcerpt({ sessionId: excerpt.sessionId, settings, sourceId: excerpt.sourceId }));
  await assert.rejects(
    () => excerpt.ai.searchWorkspace({ sessionId: excerpt.sessionId, settings, query: "attention" }),
    /tool_not_allowed/,
  );

  const outline = await session(["get_source_excerpt"]);
  await assert.rejects(
    () => outline.ai.getWorkspaceOutline({ sessionId: outline.sessionId, settings }),
    /tool_not_allowed/,
  );
});
